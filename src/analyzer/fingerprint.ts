import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { discoverRoutes } from "./routes.js";
import { DiscoveryResult } from "../types/discoveryResult.js";

const SKIP = new Set(["node_modules", "dist", "build", ".git", "coverage"]);

function collect(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, files);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"))
      files.push(full);
  }
  return files;
}

export function fingerprintProject(projectDir: string): string {
  const root = path.resolve(projectDir);
  if (!fs.existsSync(root))
    throw new Error(`Project folder not found: ${root}`);
  const hash = createHash("sha1");
  for (const file of collect(root).sort()) {
    hash.update(path.relative(root, file));
    hash.update(fs.readFileSync(file));
  }
  return hash.digest("hex").slice(0, 16);
}

const cache = new Map<string, DiscoveryResult>();

const routeKey = (r: { method: string; path: string }) =>
  `${r.method} ${r.path}`;

export function listRoutesCached(
  projectDir: string,
  entryFile?: string,
  sinceFingerprint?: string,
) {
  const root = path.resolve(projectDir);
  const fingerprint = fingerprintProject(root);
  const cacheKey = `${root}|${entryFile ?? ""}|${fingerprint}`;

  if (sinceFingerprint && sinceFingerprint === fingerprint) {
    return { fingerprint, unchanged: true as const };
  }

  let result = cache.get(cacheKey);
  if (!result) {
    result = discoverRoutes({ projectDir: root, entryFile });
    cache.set(cacheKey, result);
  }

  if (sinceFingerprint) {
    const previous = cache.get(
      `${root}|${entryFile ?? ""}|${sinceFingerprint}`,
    );
    if (previous) {
      const before = new Map(previous.routes.map((r) => [routeKey(r), r]));
      const after = new Map(result.routes.map((r) => [routeKey(r), r]));
      return {
        fingerprint,
        unchanged: false as const,
        added: [...after.keys()].filter((k) => !before.has(k)),
        removed: [...before.keys()].filter((k) => !after.has(k)),
        note: "Only route additions and removals are listed. Call again without sinceFingerprint for the full list.",
      };
    }
  }

  return { fingerprint, unchanged: false as const, ...result };
}
