import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { discoverRoutes } from "./analyzer/routes.js";
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

const transport = new StdioServerTransport();
async function main() {
  await server.connect(transport);
  console.error("mcp-api-tester running on stdio");
}
void main();
