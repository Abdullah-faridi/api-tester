const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
const PRODUCTION_LOOKING = /(^|[.-])(prod|production|live)([.-]|$)/i;

const listFrom = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.includes(hostname.toLowerCase());
}

export function checkRequest(url: URL, method: string): void {
  const host = url.hostname.toLowerCase();
  if (isLocalHost(host)) return;

  if (!listFrom(process.env.API_TESTER_ALLOWED_HOSTS).includes(host)) {
    throw new Error(
      `Host "${host}" is not allowed. Only localhost is allowed by default. ` +
        `To allow it, set API_TESTER_ALLOWED_HOSTS=${host}`,
    );
  }
  if (
    PRODUCTION_LOOKING.test(host) &&
    process.env.API_TESTER_ALLOW_PRODUCTION !== "true"
  ) {
    throw new Error(
      `Host "${host}" looks like production and is blocked. Set API_TESTER_ALLOW_PRODUCTION=true to override.`,
    );
  }
  if (
    WRITE_METHODS.includes(method.toUpperCase()) &&
    process.env.API_TESTER_ALLOW_WRITES !== "true"
  ) {
    throw new Error(
      `${method.toUpperCase()} requests to non-local host "${host}" are blocked. ` +
        `Set API_TESTER_ALLOW_WRITES=true to allow writes.`,
    );
  }
}

export function maxRequests(): number {
  const value = Number(process.env.API_TESTER_MAX_REQUESTS);
  return Number.isFinite(value) && value > 0 ? value : 200;
}
