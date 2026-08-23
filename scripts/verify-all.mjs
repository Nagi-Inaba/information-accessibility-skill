import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ["scripts/verify-package.mjs"]);
run(process.execPath, ["scripts/build-criteria-catalog.mjs", "--check"]);

const testFiles = fs.readdirSync(path.join(root, "tests"))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => path.join("tests", name));

run(process.execPath, ["--test", "--test-reporter=spec", ...testFiles]);

console.log(JSON.stringify({ status: "PASS", platform: process.platform, tests: testFiles.length }));
