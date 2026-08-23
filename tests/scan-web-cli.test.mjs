import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "codex", "skills", "information-accessibility-practice", "scripts", "accessibility-audit.mjs");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
}

function freshOutput(name = "scan.json") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scan-web-cli-"));
  return path.join(directory, name);
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

test("scan-web treats a flag-looking allow-origin value as a usage error", () => {
  const result = run(["scan-web", "--url", "https://example.com/", "--profile", "web-modern", "--output", freshOutput(), "--allow-origin", "--width", "320"]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /Missing value for --allow-origin/u);
});

test("scan-web rejects identical scan and context paths as usage", () => {
  const output = freshOutput();
  const result = run(["scan-web", "--url", "https://example.com/", "--profile", "web-modern", "--output", output, "--context-output", output]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /different paths/u);
});

test("scan-web rejects existing outputs before loading browser dependencies", () => {
  const output = freshOutput();
  fs.writeFileSync(output, "occupied");
  const result = run(["scan-web", "--url", "https://example.com/", "--profile", "web-modern", "--output", output]);
  assert.equal(result.status, 6, result.stderr);
  assert.match(result.stderr, /safe new output path/u);
});

test("scan-web reports unknown profiles as usage before dependency checks", () => {
  const result = run(["scan-web", "--url", "https://example.com/", "--profile", "missing-profile", "--output", freshOutput()]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /unknown or inactive/u);
});
