import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { describeRoute } from "./analyzer/describe.js";
import { listRoutesCached } from "./analyzer/fingerprint.js";
import { callEndpoint } from "./runner/callEndpoint.js";
import { generateTestInputs } from "./runner/generateInput.js";
import { runBatch } from "./runner/batch.js";
import { diagnose } from "./runner/diagnose.js";
import { buildPlan } from "./runner/plan.js";
import { testRoute } from "./runner/testRoute.js";

const server = new McpServer({ name: "mcp-api-tester", version: "1.0.0" });

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const fail = (tool: string, err: unknown) => ({
  isError: true,
  content: [
    {
      type: "text" as const,
      text: `${tool} failed: ${err instanceof Error ? err.message : String(err)}`,
    },
  ],
});

const projectDir = z
  .string()
  .describe(
    "Absolute path to the backend folder (where its .ts files or tsconfig.json live)",
  );
const baseUrl = z
  .string()
  .optional()
  .describe(
    "Where the running dev server is, e.g. http://localhost:3002. Defaults to API_TESTER_BASE_URL or http://localhost:3000",
  );
const method = z.string().describe("HTTP method, e.g. POST");
const routePath = z
  .string()
  .describe(
    "Route path exactly as list_routes shows it, e.g. /posts/:id/comments",
  );

server.registerTool(
  "say_hello",
  {
    description: "Greets someone. Used to check that the server is connected.",
    inputSchema: { name: z.string().describe("The name to greet") },
    annotations: { readOnlyHint: true },
  },
  async ({ name }) => ok(`Hello, ${name}! Your MCP server works.`),
);

server.registerTool(
  "list_routes",
  {
    description:
      "Reads an Express + TypeScript backend's source code (without running it) and lists every route: method, full path, " +
      "file and line, middleware, whether it likely needs auth. The result includes a fingerprint. " +
      "On later calls pass it as sinceFingerprint to get 'unchanged' or just the added and removed routes instead of the full list.",
    inputSchema: {
      projectDir,
      entryFile: z
        .string()
        .optional()
        .describe(
          "Optional: file containing `express()`, relative to projectDir. Auto-detected if omitted.",
        ),
      sinceFingerprint: z
        .string()
        .optional()
        .describe("Fingerprint from a previous list_routes call"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ projectDir, entryFile, sinceFingerprint }) => {
    try {
      return ok(listRoutesCached(projectDir, entryFile, sinceFingerprint));
    } catch (err) {
      return fail("list_routes", err);
    }
  },
);

server.registerTool(
  "describe_route",
  {
    description:
      "For ONE route, returns the inputs it needs: path params, whether it needs auth, and the request body as JSON Schema (from its Zod schema).",
    inputSchema: { projectDir, method, path: routePath },
    annotations: { readOnlyHint: true },
  },
  async ({ projectDir, method, path }) => {
    try {
      return ok(await describeRoute({ projectDir, method, path }));
    } catch (err) {
      return fail("describe_route", err);
    }
  },
);

server.registerTool(
  "generate_test_inputs",
  {
    description:
      "For ONE route, generates a VALID request body plus several INVALID ones (missing field, wrong type, too short or long, bad format) from its Zod schema.",
    inputSchema: { projectDir, method, path: routePath },
    annotations: { readOnlyHint: true },
  },
  async ({ projectDir, method, path }) => {
    try {
      return ok(await generateTestInputs({ projectDir, method, path }));
    } catch (err) {
      return fail("generate_test_inputs", err);
    }
  },
);

server.registerTool(
  "call_endpoint",
  {
    description:
      "Sends ONE HTTP request to the running dev server and returns status, body, duration and any network error. " +
      "Any HTTP status is returned as data. Only localhost is allowed unless API_TESTER_ALLOWED_HOSTS is set.",
    inputSchema: {
      baseUrl,
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: z.string().describe('Path starting with "/", e.g. /posts/1'),
      body: z.unknown().optional().describe("JSON body"),
      token: z
        .string()
        .optional()
        .describe("Bearer token, sent as the Authorization header"),
      headers: z.record(z.string(), z.string()).optional(),
      timeoutMs: z.number().int().min(100).max(60000).optional(),
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  async (input) => {
    try {
      return ok(await callEndpoint(input));
    } catch (err) {
      return fail("call_endpoint", err);
    }
  },
);

const expectEnum = z.enum([
  "success",
  "invalid_input",
  "needs_auth",
  "not_found",
  "any",
]);

server.registerTool(
  "run_batch",
  {
    description:
      "Runs many requests in order in ONE call and returns a compact table with a diagnosis for each step. " +
      "Values can be saved from a response and used later with {{name}} in path, body, headers or token. " +
      "In `save`, use 'auto:id' (finds the id), 'auto:token' (finds the login token) or a path like 'body.data.id'. " +
      "Set auth to 'user' to send the saved token, or 'none' to send no credentials. Cookies from responses are kept automatically.",
    inputSchema: {
      baseUrl,
      requests: z
        .array(
          z.object({
            name: z.string().optional(),
            method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
            path: z.string(),
            body: z.unknown().optional(),
            token: z.string().optional(),
            headers: z.record(z.string(), z.string()).optional(),
            expect: expectEnum
              .optional()
              .describe("What a correct server should do. Default: success"),
            save: z.record(z.string(), z.string()).optional(),
            auth: z.enum(["user", "none"]).optional(),
          }),
        )
        .min(1),
      stopOnFail: z
        .boolean()
        .optional()
        .describe("Skip the remaining steps after the first failure"),
      vars: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Starting values for {{name}} placeholders"),
      includeBodies: z
        .boolean()
        .optional()
        .describe(
          "Include response bodies for passing steps too. Failed steps always include theirs.",
        ),
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  async (input) => {
    try {
      return ok(await runBatch(input));
    } catch (err) {
      return fail("run_batch", err);
    }
  },
);

server.registerTool(
  "test_route",
  {
    description:
      "Tests ONE route fully: generates a valid body and invalid bodies from its schema, sends them all, and returns a summary with a diagnosis for each. " +
      "For routes with :params pass pathValues. For protected routes pass a token.",
    inputSchema: {
      projectDir,
      baseUrl,
      method,
      path: routePath,
      token: z.string().optional(),
      pathValues: z
        .record(z.string(), z.string())
        .optional()
        .describe('Values for path params, e.g. {"id": "3"}'),
      maxInvalid: z.number().int().min(0).max(40).optional(),
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  async (input) => {
    try {
      return ok(await testRoute(input));
    } catch (err) {
      return fail("test_route", err);
    }
  },
);

server.registerTool(
  "run_workflow",
  {
    description:
      "Tests the WHOLE backend automatically. Orders routes (signup, login, create, read, update, delete), captures the token and ids from responses, " +
      "adds invalid-input, missing-token and unknown-id checks, runs everything and returns a compact summary with a diagnosis per step. " +
      "Use dryRun to see the plan without sending anything. This creates real data in the target server's database, so point it at a dev database.",
    inputSchema: {
      projectDir,
      baseUrl,
      dryRun: z.boolean().optional(),
      includeNegative: z
        .boolean()
        .optional()
        .describe(
          "Add invalid-input, no-token and unknown-id checks. Default true",
        ),
      maxInvalidPerRoute: z.number().int().min(0).max(20).optional(),
      skip: z
        .array(z.string())
        .optional()
        .describe('Routes to leave out, e.g. ["DELETE /admin/users/:id"]'),
      stopOnFail: z.boolean().optional(),
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  async ({
    projectDir,
    baseUrl,
    dryRun,
    includeNegative,
    maxInvalidPerRoute,
    skip,
    stopOnFail,
  }) => {
    try {
      const plan = await buildPlan({
        projectDir,
        includeNegative,
        maxInvalidPerRoute,
        skip,
      });
      if (dryRun) {
        return ok({
          steps: plan.requests.length,
          order: plan.requests.map((r) => r.name),
          notes: plan.notes,
        });
      }
      const result = await runBatch({
        baseUrl,
        requests: plan.requests,
        stopOnFail,
      });
      return ok({ ...result, notes: plan.notes });
    } catch (err) {
      return fail("run_workflow", err);
    }
  },
);

server.registerTool(
  "diagnose_failure",
  {
    description:
      "Explains one test result. Says whether it points to an app bug, bad test input, an auth problem, a network problem or a wrong test assumption.",
    inputSchema: {
      expect: expectEnum.describe("What the request should have done"),
      status: z
        .number()
        .int()
        .nullable()
        .describe("HTTP status, or null if there was no response"),
      body: z.unknown().optional(),
      networkError: z
        .object({
          kind: z.enum(["timeout", "network"]),
          code: z.string().nullable().optional(),
          message: z.string(),
        })
        .optional(),
      sentAuth: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ expect, status, body, networkError, sentAuth }) => {
    const result = {
      request: "",
      ok: status !== null && status < 400,
      status,
      durationMs: 0,
      body,
      error: networkError
        ? {
            kind: networkError.kind,
            code: networkError.code ?? null,
            message: networkError.message,
          }
        : undefined,
    };
    return ok(diagnose(expect, result, sentAuth ?? false));
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("mcp-api-tester running on stdio");
