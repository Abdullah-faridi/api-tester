import { discoverRoutes } from "./analyzer/routes.js";

const dir = process.argv[2];
if (!dir) {
  console.log("Usage: npm run routes -- <path-to-backend-folder>");
  process.exit(1);
}
const r = discoverRoutes({ projectDir: dir });
console.log(`App file(s): ${r.appFiles.join(", ")}`);
for (const x of r.routes) {
  console.log(
    `${x.method.padEnd(7)} ${x.path.padEnd(24)} ${x.likelyRequiresAuth ? "[auth]" : "      "} ${x.file}:${x.line}  ${x.middleware.join(", ")}`,
  );
}
console.log(
  `${r.routes.length} routes`,
  r.warnings.length ? `| warnings: ${r.warnings.join("; ")}` : "",
);
