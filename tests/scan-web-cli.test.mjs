import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "codex", "skills", "information-accessibility-practice", "scripts", "accessibility-audit.mjs");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
}

test("unified CLI exposes scan-web", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\bscan-web\b/u);
});

test("scan-web help documents machine-scan inputs and defaults", () => {
  const result = run(["scan-web", "--help"]);
  assert.equal(result.status, 0, result.stderr);
  for (const token of ["--url", "--profile", "--output", "--context-output", "--allow-origin", "--focus-steps", "--width", "--height", "--reflow-width", "320", "1280", "800"]) {
    assert.ok(result.stdout.includes(token), token);
  }
});

test("scan-web requires url, profile, and output", () => {
  const result = run(["scan-web"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--url|--profile|--output/u);
});
