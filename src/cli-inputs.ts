import { generateTestInputs } from "./runner/generateInput.js";
const [dir, method, routePath] = process.argv.slice(2);
if (!dir || !method || !routePath) {
  console.log("Usage: npm run inputs -- <backend-folder> <METHOD> <path>");
  process.exit(1);
}
console.log(
  JSON.stringify(
    await generateTestInputs({ projectDir: dir, method, path: routePath }),
    null,
    2,
  ),
);
process.exit(0);
