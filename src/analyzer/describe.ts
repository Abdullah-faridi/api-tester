import path from "node:path";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import { z } from "zod";
import { discoverRoutes } from "./routes.js";
import { DescribeOptions } from "../types/describeOptions.js";

const clean = (p: string) => (p.length > 1 ? p.replace(/\/$/, "") : p);

export async function describeRoute({
  projectDir,
  method,
  path: routePath,
}: DescribeOptions) {
  const { routes } = discoverRoutes({ projectDir });

  const route = routes.find(
    (r) =>
      r.method === method.toUpperCase() && clean(r.path) === clean(routePath),
  );
  if (!route) {
    const available = routes
      .slice(0, 30)
      .map((r) => `${r.method} ${r.path}`)
      .join(", ");
    throw new Error(
      `No route "${method.toUpperCase()} ${routePath}" found. Available: ${available}`,
    );
  }

  const pathParams = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map(
    (m) => m[1],
  );

  let bodyJsonSchema: unknown;
  let bodySchemaError: string | undefined;
  if (route.bodySchema) {
    try {
      if (!route.bodySchema.exported)
        throw new Error("the schema is not exported, so it can't be loaded");
      const file = path.resolve(projectDir, route.bodySchema.file);
      const mod = await tsImport(pathToFileURL(file).href, import.meta.url);
      const schema =
        mod[route.bodySchema.name] ?? mod.default?.[route.bodySchema.name];
      if (!schema)
        throw new Error(
          `"${route.bodySchema.name}" not found in ${route.bodySchema.file}`,
        );
      const json = z.toJSONSchema(schema, {
        io: "input",
        unrepresentable: "any",
      }) as Record<string, unknown>;
      delete json.$schema;
      for (const prop of Object.values(
        (json.properties ?? {}) as Record<string, Record<string, unknown>>,
      )) {
        if (prop.format === "email") delete prop.pattern;
      }
      bodyJsonSchema = json;
    } catch (err) {
      bodySchemaError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    method: route.method,
    path: route.path,
    definedAt: `${route.file}:${route.line}`,
    pathParams,
    requiresAuth: route.likelyRequiresAuth,
    middleware: route.middleware,
    bodySchemaName: route.bodySchema?.name ?? null,
    bodyJsonSchema,
    bodySchemaError,
  };
}
