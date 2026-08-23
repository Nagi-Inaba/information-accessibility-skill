import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as createRunModule from "../codex/skills/information-accessibility-practice/scripts/create-audit-run.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "codex/skills/information-accessibility-practice");
const script = path.join(skillRoot, "scripts/create-audit-run.mjs");
const targetRef = "https://example.invalid/checkout";

function args(temp, configPath, output, runId) {
  return [script, "--run-id", runId, "--profile", "web-modern", "--target-name", "Example", "--target-version", "v1", "--target-ref", targetRef, "--artifact-root", path.join(temp, "artifacts"), "--network", "denied", "--interaction", "read_only", "--source-write", "denied", "--config", configPath, "--output", output];
}

function runWithConfig(config, runId) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-config-"));
  fs.mkdirSync(path.join(temp, "artifacts"));
  const configPath = path.join(temp, "config.json");
  const output = path.join(temp, "run.json");
  fs.writeFileSync(configPath, JSON.stringify(config));
  const result = spawnSync(process.execPath, args(temp, configPath, output, runId), { encoding: "utf8" });
  return { result, output };
}

const declaredScope = {
  included: ["Checkout page"],
  excluded: ["Payment iframe"],
  complete_processes: ["Complete checkout"],
  third_party_content: ["Payment iframe"],
  full_pages_reviewed: true
};

const declaredEnvironment = {
  os: ["Windows 11"],
  browsers: ["Chrome 140"],
  assistive_technologies: ["NVDA 2026.2"],
  input_modes: ["keyboard"]
};

test("audit init records declared scope and environment", () => {
  const { result, output } = runWithConfig(
    { scope: declaredScope, environment: declaredEnvironment },
    "RUN-20260822T000000Z-CONFIG01"
  );
  assert.equal(result.status, 0, result.stderr);
  const run = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(run.scope, declaredScope);
  assert.deepEqual(run.environment, declaredEnvironment);
  assert.deepEqual(run.limitations, ["No profile outcome has been recorded."]);
});

test("audit init rejects malformed config before output", () => {
  const { result, output } = runWithConfig(
    { environment: { os: "Windows" } },
    "RUN-20260822T000000Z-CONFIG02"
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid audit initialization config/);
  assert.equal(fs.existsSync(output), false);
});

test("scope-only config keeps the default undeclared environment", () => {
  const { result, output } = runWithConfig(
    { scope: declaredScope },
    "RUN-20260822T000000Z-CONFIG03"
  );
  assert.equal(result.status, 0, result.stderr);
  const run = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(run.scope, declaredScope);
  assert.deepEqual(run.environment, {
    os: ["not_declared"],
    browsers: [],
    assistive_technologies: [],
    input_modes: []
  });
  assert.deepEqual(run.limitations, ["The environment was not declared; no profile outcome has been recorded."]);
});

test("environment-only config keeps the target-based default scope", () => {
  const { result, output } = runWithConfig(
    { environment: declaredEnvironment },
    "RUN-20260822T000000Z-CONFIG04"
  );
  assert.equal(result.status, 0, result.stderr);
  const run = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.deepEqual(run.scope, {
    included: [targetRef],
    excluded: [],
    complete_processes: [],
    third_party_content: [],
    full_pages_reviewed: false
  });
  assert.deepEqual(run.environment, declaredEnvironment);
  assert.deepEqual(run.limitations, ["No profile outcome has been recorded."]);
});

test("retest context inherits declared scope and environment without an undeclared limitation", () => {
  assert.equal(typeof createRunModule.resolveAuditInitContext, "function");
  const predecessor = { scope: declaredScope, environment: declaredEnvironment };
  const resolved = createRunModule.resolveAuditInitContext({ targetRefs: [targetRef], predecessor });
  assert.deepEqual(resolved.scope, declaredScope);
  assert.deepEqual(resolved.environment, declaredEnvironment);
  assert.equal(resolved.environmentDeclared, true);
  assert.deepEqual(resolved.limitations, ["No profile outcome has been recorded."]);
});

test("partial retest context inherits the omitted half from the predecessor", () => {
  assert.equal(typeof createRunModule.resolveAuditInitContext, "function");
  const predecessor = { scope: declaredScope, environment: declaredEnvironment };
  const changedEnvironment = {
    os: ["macOS 26"],
    browsers: ["Safari 26"],
    assistive_technologies: ["VoiceOver"],
    input_modes: ["keyboard", "touch"]
  };

  const scopeOnly = createRunModule.resolveAuditInitContext({
    targetRefs: [targetRef],
    config: { scope: declaredScope },
    predecessor
  });
  assert.deepEqual(scopeOnly.scope, declaredScope);
  assert.deepEqual(scopeOnly.environment, declaredEnvironment);

  const environmentOnly = createRunModule.resolveAuditInitContext({
    targetRefs: [targetRef],
    config: { environment: changedEnvironment },
    predecessor
  });
  assert.deepEqual(environmentOnly.scope, declaredScope);
  assert.deepEqual(environmentOnly.environment, changedEnvironment);
  assert.equal(environmentOnly.environmentDeclared, true);
  assert.deepEqual(environmentOnly.limitations, ["No profile outcome has been recorded."]);
});

test("audit init config and schema snapshots are both checked before commit", () => {
  assert.equal(typeof createRunModule.loadAuditInitConfig, "function");
  assert.equal(typeof createRunModule.assertAuditInitConfigStable, "function");

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-config-stability-"));
  const configPath = path.join(temp, "config.json");
  const schemaPath = path.join(temp, "audit-init-config.schema.json");
  fs.writeFileSync(configPath, JSON.stringify({ environment: declaredEnvironment }));
  fs.copyFileSync(path.join(skillRoot, "references/audit-init-config.schema.json"), schemaPath);

  const loaded = createRunModule.loadAuditInitConfig(configPath, { schemaFile: schemaPath });
  fs.appendFileSync(schemaPath, "\n");
  assert.throws(
    () => createRunModule.assertAuditInitConfigStable(loaded),
    /audit initialization config schema changed before commit/
  );
});
