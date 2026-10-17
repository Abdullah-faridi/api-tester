import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { discoverRoutes } from "./analyzer/routes.js";
import { describeRoute } from "./analyzer/describe.js";
import { callEndpoint } from "./runner/callEndpoint.js";
import { generateTestInputs } from "./runner/generateInput.js";
const server = new McpServer({
  name: "mcp-api-tester",
  version: "0.1.0",
});

server.registerTool(
  "say_hello",
  {
    description: "Greets a person by name. Used to check the server works.",
    inputSchema: { name: z.string().describe("The name to greet") },
  },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello, ${name}! Your MCP server works.` }],
  }),
);

server.registerTool(
  "list_routes",
  {
    description:
      "Reads an Express + TypeScript backend's source code (without running it) and lists every route: " +
      "method, full path (including mount prefixes), file and line, middleware, and whether it likely needs auth.",
    inputSchema: {
      projectDir: z
        .string()
        .describe(
          "Absolute path to the backend folder (where its .ts files or tsconfig.json live)",
        ),
      entryFile: z
        .string()
        .optional()
        .describe(
          "Optional: file containing `express()`, relative to projectDir. Auto-detected if omitted.",
        ),
    },
  },
  async ({ projectDir, entryFile }) => {
    try {
      const result = discoverRoutes({ projectDir, entryFile });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `list_routes failed: ${message}` }],
      };
    }
  },
);

server.registerTool(
  "describe_route",
  {
    description:
      "Describes ONE route of an Express + Zod backend: URL path params, whether it likely needs auth, " +
      "and the JSON Schema of the request body (read from the Zod schema used in validate(...)). " +
      "Use list_routes first to see the routes.",
    inputSchema: {
      projectDir: z.string().describe("Absolute path to the backend folder"),
      method: z.string().describe("HTTP method, e.g. POST"),
      path: z
        .string()
        .describe(
          "Route path exactly as list_routes shows it, e.g. /posts/:id/comments",
        ),
    },
  },
  async ({ projectDir, method, path }) => {
    try {
      const result = await describeRoute({ projectDir, method, path });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `describe_route failed: ${message}` }],
      };
    }
  },
);

server.registerTool(
  "call_endpoint",
  {
    description:
      "Sends ONE real HTTP request to a RUNNING dev server and returns status, response body, timing, " +
      "or a network error (server down / timeout). Localhost only by default. " +
      "Fill in path params yourself (e.g. /posts/5). Use describe_route first to know what to send.",
    inputSchema: {
      baseUrl: z
        .string()
        .optional()
        .describe("Server address. Default http://localhost:3000"),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: z
        .string()
        .describe(
          "Path starting with /, params filled in, e.g. /posts/5/comments",
        ),
      body: z
        .unknown()
        .optional()
        .describe("JSON request body, if the route needs one"),
      token: z
        .string()
        .optional()
        .describe("Auth token. Sent as 'Authorization: Bearer <token>'"),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Extra headers, if needed"),
      timeoutMs: z
        .number()
        .int()
        .min(100)
        .max(60000)
        .optional()
        .describe("Default 10000"),
    },
  },
  async (input) => {
    try {
      const result = await callEndpoint(input);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `call_endpoint failed: ${message}` }],
      };
    }
  },
);

server.registerTool(
  "generate_test_inputs",
  {
    description:
      "For ONE route, generates a VALID request body plus several INVALID ones (missing field, wrong type, " +
      "too short/long, bad email...) from the route's Zod schema. Use call_endpoint to send them. " +
      "Valid should succeed; invalid should return 4xx (a 5xx means a bug).",
    inputSchema: {
      projectDir: z.string().describe("Absolute path to the backend folder"),
      method: z.string().describe("HTTP method, e.g. POST"),
      path: z
        .string()
        .describe(
          "Route path exactly as list_routes shows it, e.g. /posts/:id/comments",
        ),
    },
  },
  async ({ projectDir, method, path }) => {
    try {
      const result = await generateTestInputs({ projectDir, method, path });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          { type: "text", text: `generate_test_inputs failed: ${message}` },
        ],
      };
    }
  },
);
const transport = new StdioServerTransport();
async function main() {
  await server.connect(transport);
  console.error("mcp-api-tester running on stdio");
}
void main();
