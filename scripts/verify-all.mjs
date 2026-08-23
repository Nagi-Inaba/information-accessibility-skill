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

function runCaptured(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false
  });
  if (result.error) throw result.error;
  return result;
}

run(process.execPath, ["scripts/verify-package.mjs"]);
run(process.execPath, ["scripts/build-criteria-catalog.mjs", "--check"]);

const testFiles = fs.readdirSync(path.join(root, "tests"))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => path.join("tests", name));

const complete = runCaptured(["--test", "--test-reporter=spec", ...testFiles]);
if (complete.status !== 0) {
  for (const testFile of testFiles) {
    const focused = runCaptured(["--test", "--test-reporter=spec", testFile]);
    if (focused.status === 0) continue;
    process.stderr.write(`FAILED_TEST_FILE=${testFile}\n`);
    process.stderr.write(focused.stdout ?? "");
    process.stderr.write(focused.stderr ?? "");
    process.exit(focused.status ?? 1);
  }
  process.stderr.write("The combined test run failed, but every isolated test file passed; investigate cross-file interference.\n");
  process.exit(complete.status ?? 1);
}

console.log(JSON.stringify({ status: "PASS", platform: process.platform, tests: testFiles.length }));
