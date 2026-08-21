import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "codex/skills/information-accessibility-practice/scripts/create-audit-run.mjs");

function args(temp, configPath, output, runId) {
  return [script, "--run-id", runId, "--profile", "web-modern", "--target-name", "Example", "--target-version", "v1", "--target-ref", "https://example.invalid/checkout", "--artifact-root", path.join(temp, "artifacts"), "--network", "denied", "--interaction", "read_only", "--source-write", "denied", "--config", configPath, "--output", output];
}

test("audit init records declared scope and environment", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-config-"));
  fs.mkdirSync(path.join(temp, "artifacts"));
  const configPath = path.join(temp, "config.json");
  const output = path.join(temp, "run.json");
  const config = {
    scope: { included: ["Checkout page"], excluded: ["Payment iframe"], complete_processes: ["Complete checkout"], third_party_content: ["Payment iframe"], full_pages_reviewed: true },
    environment: { os: ["Windows 11"], browsers: ["Chrome 140"], assistive_technologies: ["NVDA 2026.2"], input_modes: ["keyboard"] }
  };
  fs.writeFileSync(configPath, JSON.stringify(config));
  const result = spawnSync(process.execPath, args(temp, configPath, output, "RUN-20260822T000000Z-CONFIG01"), { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const run = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(run.scope, config.scope);
  assert.deepEqual(run.environment, config.environment);
  assert.deepEqual(run.limitations, ["No profile outcome has been recorded."]);
});

test("audit init rejects malformed config before output", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-bad-config-"));
  fs.mkdirSync(path.join(temp, "artifacts"));
  const configPath = path.join(temp, "config.json");
  const output = path.join(temp, "run.json");
  fs.writeFileSync(configPath, JSON.stringify({ environment: { os: "Windows" } }));
  const result = spawnSync(process.execPath, args(temp, configPath, output, "RUN-20260822T000000Z-CONFIG02"), { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid audit initialization config/);
  assert.equal(fs.existsSync(output), false);
});
