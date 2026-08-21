import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = path.join(root, "codex/skills/information-accessibility-practice/scripts");
const createRun = path.join(scripts, "create-audit-run.mjs");
const statusScript = path.join(scripts, "audit-status.mjs");

function createInitializedRun(temp) {
  const artifactRoot = path.join(temp, "artifacts");
  const runFile = path.join(temp, "run.json");
  fs.mkdirSync(artifactRoot);
  const result = spawnSync(process.execPath, [
    createRun,
    "--run-id", "RUN-20260822T010203Z-STATUS01",
    "--profile", "web-modern",
    "--target-name", "Status fixture",
    "--target-version", "fixture-v1",
    "--target-ref", "https://example.invalid/",
    "--artifact-root", artifactRoot,
    "--network", "denied",
    "--interaction", "read_only",
    "--source-write", "denied",
    "--output", runFile
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return runFile;
}

test("status JSON identifies the current run and the missing next artifact", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-status-"));
  const runFile = createInitializedRun(temp);
  const result = spawnSync(process.execPath, [statusScript, "--run", runFile, "--format", "json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.valid, true);
  assert.equal(status.run.status, "initialized");
  assert.equal(status.run.current_schema, true);
  assert.deepEqual(status.artifacts, []);
  assert.deepEqual(status.next_ready_transitions, []);
  assert.deepEqual(status.next_blocked_transitions, [{
    to: "screened",
    missing_artifact_types: ["screening-observations"]
  }]);
  assert.equal(status.operations.register_artifact, true);
  assert.equal(status.operations.retest, false);
});

test("text status gives a human-readable next action without mutating the run", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-status-text-"));
  const runFile = createInitializedRun(temp);
  const before = fs.readFileSync(runFile);
  const result = spawnSync(process.execPath, [statusScript, "--run", runFile], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /State: initialized/u);
  assert.match(result.stdout, /blocked; missing screening-observations/u);
  assert.match(result.stdout, /No audit artifacts are registered yet/u);
  assert.deepEqual(fs.readFileSync(runFile), before);
});

test("Codex and Claude status implementations remain identical", () => {
  const codex = fs.readFileSync("codex/skills/information-accessibility-practice/scripts/audit-status.mjs", "utf8");
  const claude = fs.readFileSync("claude/skills/information-accessibility-practice/scripts/audit-status.mjs", "utf8");
  assert.equal(codex, claude);
});
