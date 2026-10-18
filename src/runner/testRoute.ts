import { generateTestInputs } from "./generateInput.js";
import { runBatch } from "./batch.js";
import { BatchRequest } from "../types/batch.js";

export interface TestRouteOptions {
  projectDir: string;
  baseUrl?: string;
  method: string;
  path: string;
  token?: string;
  pathValues?: Record<string, string>;
  maxInvalid?: number;
}

export async function testRoute(options: TestRouteOptions) {
  const inputs = await generateTestInputs({
    projectDir: options.projectDir,
    method: options.method,
    path: options.path,
  });

  let path = options.path;
  for (const [key, value] of Object.entries(options.pathValues ?? {}))
    path = path.replace(`:${key}`, value);
  const missing = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  if (missing.length > 0) {
    throw new Error(
      `Missing values for path params: ${missing.join(", ")}. Pass them in pathValues.`,
    );
  }

  const requests: BatchRequest[] = [
    {
      name: "valid",
      method: options.method,
      path,
      body: inputs.valid ?? undefined,
      token: options.token,
      expect: "success",
    },
  ];

  for (const invalid of inputs.invalid.slice(0, options.maxInvalid ?? 20)) {
    requests.push({
      name: invalid.name,
      method: options.method,
      path,
      body: invalid.body,
      token: options.token,
      expect: "invalid_input",
    });
  }

  if (inputs.requiresAuth && options.token) {
    requests.push({
      name: "no_token",
      method: options.method,
      path,
      body: inputs.valid ?? undefined,
      auth: "none",
      expect: "needs_auth",
    });
  }

  return {
    route: inputs.route,
    ...(await runBatch({ baseUrl: options.baseUrl, requests })),
  };
}
