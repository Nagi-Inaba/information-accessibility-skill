import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runExample(relativeScript, args = []) {
  return spawnSync(process.execPath, [path.join(root, relativeScript), ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertPublicFixtureText(text, label) {
  assert.doesNotMatch(text, /(?:[A-Za-z]:\\|\/Users\/|\/home\/[^\s/]+\/|localhost|127\.0\.0\.1|token=|authorization:)/iu, label);
}

test("examples index documents the three supported entry paths and artifact handoffs", () => {
  const files = [
    "examples/README.md",
    "examples/natural-language-review/README.md",
    "examples/standalone-ledger/README.md",
    "examples/standalone-ledger/run.mjs",
    "examples/run-backed-web-audit/README.md",
    "examples/run-backed-web-audit/run.mjs"
  ];
  for (const relative of files) assert.equal(fs.existsSync(path.join(root, relative)), true, relative);

  const index = fs.readFileSync(path.join(root, "examples/README.md"), "utf8");
  for (const value of ["Natural-language review", "Standalone assessment", "Run-backed audit"]) {
    assert.match(index, new RegExp(value, "iu"));
  }
  assert.match(index, /screening[^]*human review[^]*remediation[^]*merge[^]*report/iu);
});

test("standalone example generates a complete 55-row ledger and guarded report", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-example-standalone-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const result = runExample("examples/standalone-ledger/run.mjs", ["--output", temp]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const assessmentFile = path.join(temp, "assessment.json");
  const reportFile = path.join(temp, "audit-report.md");
  assert.equal(fs.existsSync(assessmentFile), true);
  assert.equal(fs.existsSync(reportFile), true);
  const assessment = readJson(assessmentFile);
  assert.equal(assessment.assessment.results.length, 55);
  assert.ok(assessment.assessment.results.every((row) => row.outcome === "not_tested"));
  const report = fs.readFileSync(reportFile, "utf8");
  assert.match(report, /^# WCAG 2\.2 A\/AA 監査レポート$/mu);
  assert.match(report, /^## 主張可能な範囲$/mu);
  assert.match(report, /人による確認済み: 0\/55/u);
  assertPublicFixtureText(report, "standalone public example");
});

test("run-backed example creates ordered artifacts, merged assessment, and report for screening-only and human-reviewed paths", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-example-run-backed-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const result = runExample("examples/run-backed-web-audit/run.mjs", ["--output", temp]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  for (const scenario of ["screening-only", "human-reviewed"]) {
    const directory = path.join(temp, scenario);
    for (const name of [
      "audit-run.json",
      "baseline-assessment.json",
      "screening-observations.json",
      "human-review-queue.json",
      "remediation-plan.json",
      "merged-assessment.json",
      "audit-report.md"
    ]) assert.equal(fs.existsSync(path.join(directory, name)), true, `${scenario}/${name}`);

    const run = readJson(path.join(directory, "audit-run.json"));
    assert.ok(run.artifacts.length >= 3);
    assert.deepEqual(
      run.artifacts.map((entry) => entry.artifact_id),
      [...run.artifacts.map((entry) => entry.artifact_id)].sort()
    );
    const merged = readJson(path.join(directory, "merged-assessment.json"));
    const profileRows = merged.assessment.results.filter((row) => row.requirement_id.startsWith("WCAG-2.2-SC-"));
    const screeningRows = merged.assessment.results.filter((row) => row.requirement_id.startsWith("SCREEN-"));
    assert.equal(profileRows.length, 55);
    assert.equal(screeningRows.length, 1);
    const report = fs.readFileSync(path.join(directory, "audit-report.md"), "utf8");
    assert.match(report, /登録済み達成基準/u);
    assertPublicFixtureText(report, `${scenario} public example`);
  }

  assert.equal(fs.existsSync(path.join(temp, "human-reviewed", "declared-human-review.json")), true);
  const screeningAssessment = readJson(path.join(temp, "screening-only", "merged-assessment.json"));
  const humanAssessment = readJson(path.join(temp, "human-reviewed", "merged-assessment.json"));
  assert.ok(screeningAssessment.assessment.results.every((row) => row.mapping_status !== "human_verified"));
  assert.ok(humanAssessment.assessment.results.some((row) => row.mapping_status === "human_verified"));
});

test("example documentation uses repository-relative commands and contains no private fixture data", () => {
  const markdownFiles = [
    "examples/README.md",
    "examples/natural-language-review/README.md",
    "examples/standalone-ledger/README.md",
    "examples/run-backed-web-audit/README.md"
  ];
  for (const relative of markdownFiles) {
    const text = fs.readFileSync(path.join(root, relative), "utf8");
    assertPublicFixtureText(text, relative);
    assert.doesNotMatch(text, /<replace-me>|TODO|TBD/iu, relative);
  }
});
