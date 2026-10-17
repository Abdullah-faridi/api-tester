import { CallOptions } from "../types/callOptions.js";
const MAX_BODY_CHARS = 4000;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function assertAllowedHost(url: URL) {
  const extra = (process.env.API_TESTER_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (![...LOCAL_HOSTS, ...extra].includes(url.hostname)) {
    throw new Error(
      `Host "${url.hostname}" is not allowed (localhost only by default). ` +
        `To allow it, set the env var API_TESTER_ALLOWED_HOSTS=${url.hostname}`,
    );
  }
}

export async function callEndpoint(opts: CallOptions) {
  if (!opts.path.startsWith("/"))
    throw new Error(`path must start with "/", got "${opts.path}"`);

  const url = new URL(opts.path, opts.baseUrl ?? "http://localhost:3000");

  const headers: Record<string, string> = { ...opts.headers };
  const hasHeader = (name: string) =>
    Object.keys(headers).some((h) => h.toLowerCase() === name);
  if (opts.token && !hasHeader("authorization"))
    headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts.body !== undefined && !hasHeader("content-type"))
    headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10000);
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  try {
    const res = await fetch(url, {
      method: opts.method.toUpperCase(),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();

    let body: unknown = text === "" ? null : text;
    try {
      if (text !== "") body = JSON.parse(text);
    } catch {}
    if (text.length > MAX_BODY_CHARS)
      body =
        text.slice(0, MAX_BODY_CHARS) +
        `...[truncated, ${text.length} chars total]`;

    return {
      request: `${opts.method.toUpperCase()} ${url.pathname}${url.search}`,
      ok: res.ok,
      status: res.status,
      durationMs: elapsed(),
      body,
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const code = (err as { cause?: { code?: string } }).cause?.code;
    return {
      request: `${opts.method.toUpperCase()} ${url.pathname}${url.search}`,
      ok: false,
      status: null,
      durationMs: elapsed(),
      error: {
        kind: isTimeout ? "timeout" : "network",
        code: code ?? null,
        message: isTimeout
          ? `No response within ${opts.timeoutMs ?? 10000}ms`
          : (err as Error).message,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
