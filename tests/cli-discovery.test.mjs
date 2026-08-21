import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs");
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

test("CLI exposes version and profile discovery", () => {
  const version = run("--version");
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /^0\.1\.0/u);
  const profiles = run("profiles", "--format", "json");
  assert.equal(profiles.status, 0, profiles.stderr);
  const value = JSON.parse(profiles.stdout);
  assert.ok(value.profiles.some((profile) => profile.id === "web-modern" && profile.active && profile.requirement_count === 55));
  assert.ok(value.profiles.some((profile) => profile.id === "authoring-agent" && !profile.active));
});

test("doctor reports installed runtime contracts", () => {
  const result = run("doctor", "--format", "json");
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.status, "PASS");
  assert.ok(value.active_profiles.includes("web-modern"));
  assert.ok(value.files.every((file) => file.present));
});

test("report and assessment help expose concrete interfaces", () => {
  const report = run("report", "--help");
  assert.equal(report.status, 0);
  assert.match(report.stdout, /--run <run\.json> --assessment <assessment\.json>/u);
  const assessment = run("assessment", "--help");
  assert.equal(assessment.status, 0);
  for (const flag of ["--target-name", "--target-version", "--target-ref", "--evaluator", "--evaluated-at"]) assert.match(assessment.stdout, new RegExp(flag));
});
