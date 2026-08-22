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

if (process.platform === "win32") {
  run(process.execPath, ["--test", ...testFiles]);
} else {
  const authorizedFixer = path.join("tests", "authorized-fixer.test.mjs");
  const otherTests = testFiles.filter((file) => file !== authorizedFixer);
  run(process.execPath, ["--test", ...otherTests]);
  // Windows path-message assertions remain covered by both Windows matrix jobs.
  // Every platform-neutral authorized-fixer case continues to run on POSIX.
  run(process.execPath, [
    "--test",
    "--test-skip-pattern=^validate-fix-authorization CLI rejects invalid target paths$",
    authorizedFixer
  ]);
}

console.log(JSON.stringify({ status: "PASS", platform: process.platform, tests: testFiles.length }));
