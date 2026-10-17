export interface CallOptions {
  baseUrl?: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  token?: string;
  timeoutMs?: number;
}
