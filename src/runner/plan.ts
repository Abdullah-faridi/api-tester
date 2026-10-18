import { discoverRoutes } from "../analyzer/routes.js";
import { DiscoveredRoute } from "../types/discoveredRoutes.js";
import { generateTestInputs } from "./generateInput.js";
import { BatchRequest } from "../types/batch.js";

export interface PlanOptions {
  projectDir: string;
  includeNegative?: boolean;
  maxInvalidPerRoute?: number;
  skip?: string[];
}

const isSignup = (r: DiscoveredRoute) =>
  r.method === "POST" && /sign-?up|register/i.test(r.path);
const isLogin = (r: DiscoveredRoute) =>
  r.method === "POST" && /log-?in|sign-?in/i.test(r.path);
const hasParam = (r: DiscoveredRoute) => r.path.includes(":");

function rank(r: DiscoveredRoute): number {
  if (isSignup(r)) return 1;
  if (isLogin(r)) return 2;
  if (r.method === "DELETE") return 7;
  if (r.method === "PUT" || r.method === "PATCH") return 6;
  if (r.method === "POST" && hasParam(r)) return 5;
  if (r.method === "POST") return 3;
  if (r.method === "GET" && !hasParam(r) && !r.likelyRequiresAuth) return 0;
  return 4;
}

function resourceName(path: string): string {
  const parts = path.split("/").filter((p) => p && !p.startsWith(":"));
  return parts[parts.length - 1] ?? "item";
}

function idVar(
  path: string,
  param: string,
  index: number,
  segments: string[],
): string {
  const before = segments.slice(0, index).filter((p) => !p.startsWith(":"));
  const owner = before[before.length - 1];
  return owner ? `${owner}Id` : param === "id" ? "id" : param;
}

function fillParams(path: string, values?: Record<string, string>): string {
  const segments = path.split("/");
  return segments
    .map((segment, index) => {
      if (!segment.startsWith(":")) return segment;
      const param = segment.slice(1);
      if (values && values[param] !== undefined) return values[param];
      return `{{${idVar(path, param, index, segments)}}}`;
    })
    .join("/");
}

function bogusPath(path: string): string {
  return path
    .split("/")
    .map((s) => (s.startsWith(":") ? "999999999" : s))
    .join("/");
}

export async function buildPlan(options: PlanOptions) {
  const { routes } = discoverRoutes({ projectDir: options.projectDir });
  const skip = new Set((options.skip ?? []).map((s) => s.toUpperCase()));
  const negative = options.includeNegative !== false;
  const maxInvalid = options.maxInvalidPerRoute ?? 4;

  const ordered = routes
    .filter(
      (r) =>
        !r.path.includes("<dynamic:") &&
        !skip.has(`${r.method} ${r.path}`.toUpperCase()),
    )
    .filter(
      (r) =>
        r.method !== "ALL" && r.method !== "HEAD" && r.method !== "OPTIONS",
    )
    .map((route, index) => ({ route, index }))
    .sort((a, b) => rank(a.route) - rank(b.route) || a.index - b.index)
    .map((entry) => entry.route);

  const requests: BatchRequest[] = [];
  const notes: string[] = [];
  const created: { varName: string; route: string }[] = [];
  const deletedVars = new Set<string>();
  let signupBody: Record<string, unknown> | undefined;

  for (const route of ordered) {
    const label = `${route.method} ${route.path}`;
    let inputs: Awaited<ReturnType<typeof generateTestInputs>>;
    try {
      inputs = await generateTestInputs({
        projectDir: options.projectDir,
        method: route.method,
        path: route.path,
      });
    } catch (err) {
      notes.push(
        `${label}: could not generate inputs (${err instanceof Error ? err.message : String(err)})`,
      );
      continue;
    }

    let validBody: unknown = inputs.valid ?? undefined;
    if (isSignup(route) && validBody && typeof validBody === "object")
      signupBody = validBody as Record<string, unknown>;
    if (
      isLogin(route) &&
      signupBody &&
      validBody &&
      typeof validBody === "object"
    ) {
      const merged = { ...(validBody as Record<string, unknown>) };
      for (const key of Object.keys(merged))
        if (key in signupBody) merged[key] = signupBody[key];
      validBody = merged;
    }

    const save: Record<string, string> = {};
    if (isLogin(route)) save.token = "auto:token";
    if (route.method === "POST" && !isLogin(route) && !isSignup(route)) {
      const varName = `${resourceName(route.path)}Id`;
      save[varName] = "auto:id";
      created.push({ varName, route: label });
    }

    const path = fillParams(route.path);
    const auth = route.likelyRequiresAuth ? ("user" as const) : undefined;

    requests.push({
      name: `${label} (valid)`,
      method: route.method,
      path,
      body: validBody,
      auth,
      expect: "success",
      save: Object.keys(save).length ? save : undefined,
    });

    if (route.method === "DELETE") {
      for (const match of path.matchAll(/\{\{(\w+)\}\}/g))
        deletedVars.add(match[1]);
    }

    if (!negative) continue;

    if (inputs.invalid && inputs.invalid.length > 0) {
      for (const invalid of inputs.invalid.slice(0, maxInvalid)) {
        requests.push({
          name: `${label} (${invalid.name})`,
          method: route.method,
          path,
          body: invalid.body,
          auth,
          expect: "invalid_input",
        });
      }
    }

    if (route.likelyRequiresAuth) {
      requests.push({
        name: `${label} (no token)`,
        method: route.method,
        path,
        body: validBody,
        auth: "none",
        expect: "needs_auth",
      });
    }

    if (hasParam(route) && route.method !== "POST") {
      requests.push({
        name: `${label} (unknown id)`,
        method: route.method,
        path: bogusPath(route.path),
        auth,
        expect: "not_found",
      });
    }
  }

  const deleteLast = requests.filter((r) => r.method === "DELETE");
  const rest = requests.filter((r) => r.method !== "DELETE");
  const finalRequests = [...rest, ...deleteLast];

  for (const item of created) {
    if (!deletedVars.has(item.varName)) {
      notes.push(
        `${item.route} creates data that no DELETE route removes (${item.varName}). Clean it up in the dev database yourself.`,
      );
    }
  }

  return { requests: finalRequests, notes };
}
