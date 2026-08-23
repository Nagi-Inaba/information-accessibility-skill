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

function failureExcerpt(output) {
  const lines = String(output ?? "").split(/\r?\n/u);
  const selected = new Set();
  const patterns = [/^\s*[✖✗]/u, /not ok/iu, /AssertionError/iu, /ERR_[A-Z_]+/u, /SyntaxError/iu, /ReferenceError/iu, /TypeError/iu, /Error:/u, /fail(?:ed|ure)/iu];
  for (let index = 0; index < lines.length; index += 1) {
    if (!patterns.some((pattern) => pattern.test(lines[index]))) continue;
    for (let cursor = Math.max(0, index - 5); cursor <= Math.min(lines.length - 1, index + 12); cursor += 1) selected.add(cursor);
  }
  for (let index = Math.max(0, lines.length - 35); index < lines.length; index += 1) selected.add(index);
  return [...selected].sort((a, b) => a - b).map((index) => lines[index]).join("\n");
}

function runTests(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(`${failureExcerpt(`${result.stdout ?? ""}\n${result.stderr ?? ""}`)}\n`);
    process.exit(result.status ?? 1);
  }
}

run(process.execPath, ["scripts/verify-package.mjs"]);
run(process.execPath, ["scripts/build-criteria-catalog.mjs", "--check"]);

const testFiles = fs.readdirSync(path.join(root, "tests"))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => path.join("tests", name));

runTests(["--test", "--test-reporter=spec", ...testFiles]);

console.log(JSON.stringify({ status: "PASS", platform: process.platform, tests: testFiles.length }));
