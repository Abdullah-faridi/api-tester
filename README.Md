# MCP API Tester

An MCP server that reads an Express + TypeScript + Zod backend, finds its routes and schemas, generates valid and invalid inputs, calls the endpoints, and explains failures. Development use only.

## Tools

| Tool                   | What it does                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_routes`          | Lists every route from source code. Returns a fingerprint; pass it back as `sinceFingerprint` to get "unchanged" or only added and removed routes. |
| `describe_route`       | Path params, auth guess and request body as JSON Schema for one route.                                                                             |
| `generate_test_inputs` | One valid body and several invalid bodies for one route.                                                                                           |
| `call_endpoint`        | Sends one request and returns status, body, duration and network errors.                                                                           |
| `run_batch`            | Runs many requests in order. Saves ids and tokens from responses and reuses them with `{{name}}`.                                                  |
| `test_route`           | Generates and runs the valid and invalid cases for one route.                                                                                      |
| `run_workflow`         | Orders all routes (signup, login, create, read, update, delete), runs them, and diagnoses each step.                                               |
| `diagnose_failure`     | Explains one result: app bug, bad test input, auth, network or wrong assumption.                                                                   |

## Setup

    npm install
    npm run build

Add to `claude_desktop_config.json`:

    {
      "mcpServers": {
        "api-tester": {
          "command": "node",
          "args": ["/absolute/path/to/mcp/dist/index.js"],
          "env": { "API_TESTER_BASE_URL": "http://localhost:3002" }
        }
      }
    }

Restart Claude Desktop after every rebuild.

## Safety

| Variable                      | Meaning                                                           |
| ----------------------------- | ----------------------------------------------------------------- |
| `API_TESTER_BASE_URL`         | Default server address. Default `http://localhost:3000`.          |
| `API_TESTER_ALLOWED_HOSTS`    | Comma-separated non-local hosts that may be called. Default none. |
| `API_TESTER_ALLOW_WRITES`     | `true` to allow POST, PUT, PATCH and DELETE on non-local hosts.   |
| `API_TESTER_ALLOW_PRODUCTION` | `true` to call hosts that look like production.                   |
| `API_TESTER_MAX_REQUESTS`     | Most requests in one batch. Default 200.                          |

Every request carries the header `X-API-Tester: 1` so test traffic is easy to spot. `run_workflow` creates real rows, so point the backend at a development database. It reports any created data that no DELETE route removes.

## Limits

- Routes registered inside a function that receives the app, such as `registerRoutes(app)`, are not followed.
- Only request body schemas are read, not query or params schemas.
- A schema written inline inside the validation middleware is not found. Export it as a named constant.
- Routers exported with `module.exports` are not supported.

## Development

    npm test
    npm run routes -- /path/to/backend
    npm run describe -- /path/to/backend POST /auth/login
    npm run inputs -- /path/to/backend POST /auth/login
