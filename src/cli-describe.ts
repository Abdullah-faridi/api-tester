import { describeRoute } from "./analyzer/describe.js";

const [dir, method, routePath] = process.argv.slice(2);
if (!dir || !method || !routePath) {
  console.log("Usage: npm run describe -- <backend-folder> <METHOD> <path>");
  process.exit(1);
}
console.log(
  JSON.stringify(
    await describeRoute({ projectDir: dir, method, path: routePath }),
    null,
    2,
  ),
);
process.exit(0);
