import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "codex/skills/information-accessibility-practice/scripts");
const generator = path.join(skill, "generate-assessment.mjs");
const validator = path.join(skill, "validate-assessment.mjs");
const renderer = path.join(skill, "render-audit-report.mjs");
const target = path.join(root, "examples/basic-standalone/target/index.html");

function run(args) {
  return spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
}

test("basic standalone example creates, validates, and reports a complete untested ledger", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "basic-standalone-"));
  const assessmentPath = path.join(temp, "assessment.json");
  const reportPath = path.join(temp, "audit-report.md");

  const generated = run([
    generator,
    "--profile", "web-modern",
    "--target-name", "Basic standalone fixture",
    "--target-version", "fixture-v1",
    "--target-ref", target,
    "--evaluator", "Example reviewer",
    "--evaluated-at", "2026-08-22",
    "--output", assessmentPath
  ]);
  assert.equal(generated.status, 0, generated.stderr);

  const assessment = JSON.parse(fs.readFileSync(assessmentPath, "utf8"));
  const profileRows = assessment.assessment.results.filter((result) => result.requirement_kind === "profile_requirement");
  assert.equal(profileRows.length, 55);
  assert.equal(new Set(profileRows.map((result) => result.requirement_id)).size, 55);
  assert.ok(profileRows.every((result) => result.mapping_status === "unverified" && result.outcome === "not_tested" && result.evidence.length === 0));

  const validated = run([validator, assessmentPath]);
  assert.equal(validated.status, 0, validated.stderr);
  const validation = JSON.parse(validated.stdout);
  assert.equal(validation.valid, true);
  assert.equal(validation.guard.catalog_coverage.recorded, 55);
  assert.equal(validation.guard.evaluation_coverage.human_verified, 0);

  const rendered = run([renderer, "--input", assessmentPath, "--output", reportPath]);
  assert.equal(rendered.status, 0, rendered.stderr);
  const report = fs.readFileSync(reportPath, "utf8");
  assert.match(report, /- 総合判定: 未確認/u);
  assert.match(report, /登録件数: 55\/55/u);
  assert.match(report, /人による確認済み件数: 0/u);
});

test("example documentation warns that ledger generation is not browser inspection", () => {
  const text = fs.readFileSync(path.join(root, "examples/basic-standalone/README.md"), "utf8");
  assert.match(text, /do not inspect its rendered DOM or accessibility tree/u);
  assert.match(text, /not_tested/u);
  assert.match(text, /55 `web-modern` profile requirements/u);
});
