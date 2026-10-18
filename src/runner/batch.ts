import { callEndpoint } from "./callEndpoint.js";
import type { CallResult } from "../types/callResults.js";
import { diagnose } from "./diagnose.js";
import { maxRequests } from "./safety.js";
import { Vars, BatchOptions, BatchRequest, BatchStep } from "../types/batch.js";

const ID_KEYS = ["id", "_id", "uuid"];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isScalar = (value: unknown) =>
  value !== undefined && value !== null && typeof value !== "object";

export function findId(body: unknown): unknown {
  if (!isObject(body)) return undefined;
  for (const key of ID_KEYS) if (isScalar(body[key])) return body[key];
  for (const value of Object.values(body)) {
    if (!isObject(value)) continue;
    for (const key of ID_KEYS) if (isScalar(value[key])) return value[key];
  }
  return undefined;
}

export function findToken(body: unknown, depth = 0): string | undefined {
  if (!isObject(body) || depth > 3) return undefined;
  for (const [key, value] of Object.entries(body)) {
    if (
      typeof value === "string" &&
      /^(access_?token|token|jwt|id_?token)$/i.test(key)
    )
      return value;
  }
  for (const [key, value] of Object.entries(body)) {
    if (
      typeof value === "string" &&
      /token/i.test(key) &&
      !/refresh/i.test(key)
    )
      return value;
  }
  for (const value of Object.values(body)) {
    const nested = findToken(value, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

export function pickPath(source: unknown, pathText: string): unknown {
  return pathText.split(".").reduce<unknown>((current, key) => {
    if (current !== null && typeof current === "object")
      return (current as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

export function fillTemplate(
  input: unknown,
  vars: Vars,
  missing: Set<string>,
): unknown {
  if (typeof input === "string") {
    const whole = input.match(/^\{\{\s*([\w.-]+)\s*\}\}$/);
    if (whole) {
      if (!(whole[1] in vars)) {
        missing.add(whole[1]);
        return input;
      }
      return vars[whole[1]];
    }
    return input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) => {
      if (!(name in vars)) {
        missing.add(name);
        return match;
      }
      return String(vars[name]);
    });
  }
  if (Array.isArray(input))
    return input.map((item) => fillTemplate(item, vars, missing));
  if (isObject(input)) {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        fillTemplate(value, vars, missing),
      ]),
    );
  }
  return input;
}

function pickSaved(spec: string, result: CallResult): unknown {
  if (spec === "auto:id") return findId(result.body);
  if (spec === "auto:token") return findToken(result.body);
  return pickPath({ status: result.status, body: result.body }, spec);
}

class CookieJar {
  private cookies = new Map<string, string>();

  store(setCookies: string[] | undefined) {
    for (const line of setCookies ?? []) {
      const [pair, ...attributes] = line.split(";");
      const index = pair.indexOf("=");
      if (index < 1) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some((attribute) =>
        /^\s*max-age\s*=\s*0\s*$/i.test(attribute),
      );
      if (value === "" || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string | undefined {
    if (this.cookies.size === 0) return undefined;
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

const preview = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 300 ? text.slice(0, 300) + "..." : text;
};

const skippedStep = (
  name: string,
  request: string,
  reason: string,
): BatchStep => ({
  name,
  request,
  status: null,
  durationMs: 0,
  outcome: "skipped",
  category: "skipped",
  reason,
  saved: [],
});

export function summarize(steps: BatchStep[]) {
  const problemsByCategory: Record<string, number> = {};
  for (const step of steps) {
    if (step.outcome !== "pass")
      problemsByCategory[step.category] =
        (problemsByCategory[step.category] ?? 0) + 1;
  }
  return {
    total: steps.length,
    passed: steps.filter((s) => s.outcome === "pass").length,
    failed: steps.filter((s) => s.outcome === "fail").length,
    skipped: steps.filter((s) => s.outcome === "skipped").length,
    problemsByCategory,
    totalMs: steps.reduce((sum, s) => sum + s.durationMs, 0),
  };
}

export async function runBatch(options: BatchOptions) {
  const limit = maxRequests();
  if (options.requests.length > limit) {
    throw new Error(
      `Too many requests (${options.requests.length}). The limit is ${limit}. Raise it with API_TESTER_MAX_REQUESTS.`,
    );
  }

  const vars: Vars = { ...options.vars };
  const jar = new CookieJar();
  const steps: BatchStep[] = [];
  let halted = false;

  for (const request of options.requests) {
    const method = request.method.toUpperCase();
    const name = request.name ?? `${method} ${request.path}`;

    if (halted) {
      steps.push(
        skippedStep(
          name,
          `${method} ${request.path}`,
          "An earlier step failed and stopOnFail is on.",
        ),
      );
      continue;
    }

    const missing = new Set<string>();
    const path = fillTemplate(request.path, vars, missing) as string;
    const body = fillTemplate(request.body, vars, missing);
    const headers = fillTemplate(request.headers, vars, missing) as
      | Record<string, string>
      | undefined;
    const explicitToken = fillTemplate(request.token, vars, missing) as
      | string
      | undefined;

    if (missing.size > 0) {
      steps.push(
        skippedStep(
          name,
          `${method} ${path}`,
          `Needs ${[...missing].join(", ")} from an earlier step, but it was not captured. That step probably failed.`,
        ),
      );
      continue;
    }

    const anonymous = request.auth === "none";
    let token = anonymous ? undefined : explicitToken;
    if (!token && request.auth === "user" && typeof vars.token === "string")
      token = vars.token;

    const sendHeaders: Record<string, string> = { ...headers };
    const cookie = anonymous ? undefined : jar.header();
    if (
      cookie &&
      !Object.keys(sendHeaders).some((h) => h.toLowerCase() === "cookie")
    )
      sendHeaders["Cookie"] = cookie;

    const result = await callEndpoint({
      baseUrl: options.baseUrl,
      method,
      path,
      body,
      token,
      headers: sendHeaders,
    });
    jar.store(result.setCookies);

    const expectedStatuses =
      request.expectStatus === undefined
        ? undefined
        : Array.isArray(request.expectStatus)
          ? request.expectStatus
          : [request.expectStatus];
    const diagnosis = diagnose(
      request.expect ?? "success",
      result,
      Boolean(token) || Boolean(cookie),
      expectedStatuses,
    );

    const saved: string[] = [];
    if (result.ok) {
      for (const [varName, spec] of Object.entries(request.save ?? {})) {
        const value = pickSaved(spec, result);
        if (value !== undefined) {
          vars[varName] = value;
          saved.push(varName);
        }
      }
    }

    const outcome = diagnosis.category === "pass" ? "pass" : "fail";
    steps.push({
      name,
      request: result.request,
      status: result.status,
      durationMs: result.durationMs,
      outcome,
      category: diagnosis.category,
      reason: diagnosis.reason,
      saved,
      body:
        outcome === "fail" || options.includeBodies
          ? preview(result.body ?? result.error)
          : undefined,
    });

    if (outcome === "fail" && options.stopOnFail) halted = true;
  }

  return { summary: summarize(steps), steps, variables: Object.keys(vars) };
}
