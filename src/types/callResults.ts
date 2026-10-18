export interface CallResult {
  request: string;
  ok: boolean;
  status: number | null;
  durationMs: number;
  body?: unknown;
  setCookies?: string[];
  error?: { kind: "timeout" | "network"; code: string | null; message: string };
}
