import { checkRequest } from "./safety.js";
import { CallOptions } from "../types/callOptions.js";
import { CallResult } from "../types/callResults.js";

const MAX_BODY_CHARS = 4000;

export const defaultBaseUrl = () =>
  process.env.API_TESTER_BASE_URL ?? "http://localhost:3000";

export async function callEndpoint(opts: CallOptions): Promise<CallResult> {
  if (!opts.path.startsWith("/"))
    throw new Error(`path must start with "/", got "${opts.path}"`);

  const method = opts.method.toUpperCase();
  const url = new URL(opts.path, opts.baseUrl ?? defaultBaseUrl());
  checkRequest(url, method);

  const headers: Record<string, string> = {
    "X-API-Tester": "1",
    ...opts.headers,
  };
  const hasHeader = (name: string) =>
    Object.keys(headers).some((h) => h.toLowerCase() === name);
  if (opts.token && !hasHeader("authorization"))
    headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts.body !== undefined && !hasHeader("content-type"))
    headers["Content-Type"] = "application/json";

  const label = `${method} ${url.pathname}${url.search}`;
  const timeoutMs = opts.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();

    let body: unknown = text === "" ? null : text;
    try {
      if (text !== "") body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (text.length > MAX_BODY_CHARS) {
      body =
        text.slice(0, MAX_BODY_CHARS) +
        `...[truncated, ${text.length} chars total]`;
    }

    return {
      request: label,
      ok: res.ok,
      status: res.status,
      durationMs: elapsed(),
      body,
      setCookies: res.headers.getSetCookie(),
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const code = (err as { cause?: { code?: string } }).cause?.code ?? null;
    return {
      request: label,
      ok: false,
      status: null,
      durationMs: elapsed(),
      error: {
        kind: isTimeout ? "timeout" : "network",
        code,
        message: isTimeout
          ? `No response within ${timeoutMs}ms`
          : (err as Error).message,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
