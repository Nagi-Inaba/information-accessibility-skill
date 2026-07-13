import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "codex/skills/information-accessibility-practice");
const registry = JSON.parse(fs.readFileSync(path.join(skill, "references/standards-registry.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(skill, "references/assessment-record.schema.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(skill, "references/criteria-catalog.json"), "utf8"));
const methods = JSON.parse(fs.readFileSync(path.join(skill, "references/web-audit-methods.json"), "utf8"));

function validate(record) {
  return validateAssessment(record, registry, schema, catalog, methods);
}

function reviewedRecord() {
  const record = generateAssessment("web-modern", {
    targetName: "Example service",
    targetVersion: "release-1",
    targetRefs: ["https://example.invalid/checkout"],
    evaluator: "Accessibility reviewer",
    evaluatedAt: "2026-07-13"
  });
  record.assessment.scope.included = ["Checkout form"];
  record.assessment.evidence_level = "E2";
  record.assessment.claim.requested_tier = "evaluated_subset";
  record.assessment.claim.proposed_wording = registry.claim_templates.evaluated_subset[0];
  const result = record.assessment.results.find((item) => item.requirement_id === "WCAG-2.2-SC-2.1.1");
  result.mapping_status = "human_verified";
  result.outcome = "fail";
  result.method_kind = "manual";
  result.evidence = [{
    type: "keyboard_test",
    location: "Checkout: payment-method selector",
    observation: "The selector cannot receive keyboard focus.",
    captured_at: "2026-07-13T10:00:00+09:00"
  }];
  result.notes = "Keyboard operation was blocked during the checkout flow.";
  record.assessment.findings = [{
    id: "F-001",
    priority: "P1",
    requirement_ids: ["WCAG-2.2-SC-2.1.1"],
    location: "Checkout: payment-method selector",
    affected_users: ["Keyboard-only users", "Screen-reader users"],
    observation: "The selector cannot receive keyboard focus.",
    remediation: "Use a native control or implement complete keyboard focus and operation.",
    verification: "Retest the full checkout process with keyboard-only operation."
  }];
  return record;
}

test("renderer creates a self-contained report from a validated record with an actionable finding", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-audit-report-"));
  try {
    const input = path.join(temp, "assessment.json");
    fs.writeFileSync(input, JSON.stringify(reviewedRecord(), null, 2), "utf8");
    const renderer = path.join(skill, "scripts/render-audit-report.mjs");
    const run = spawnSync(process.execPath, [renderer, "--input", input], { encoding: "utf8" });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /^# Accessibility Audit Report/m);
    assert.match(run.stdout, /Example service/);
    assert.match(run.stdout, /P1 findings: 1/);
    assert.match(run.stdout, /F-001/);
    assert.match(run.stdout, /WCAG-2\.2-SC-2\.1\.1/);
    assert.match(run.stdout, /The selector cannot receive keyboard focus\./);
    assert.match(run.stdout, /Selected requirements were manually reviewed; the full requirement set was not reviewed\./);
    assert.equal(run.stdout.includes("REPLACE_ME"), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("validator requires structured findings for failed results and meaningful affected users", () => {
  const missingFinding = reviewedRecord();
  missingFinding.assessment.findings = [];
  const missingFindingResult = validate(missingFinding);
  assert.equal(missingFindingResult.valid, false);
  assert.ok(missingFindingResult.errors.some((error) => error.includes("A finding must reference failed requirement")));

  const missingUsers = reviewedRecord();
  missingUsers.assessment.findings[0].affected_users = [];
  const missingUsersResult = validate(missingUsers);
  assert.equal(missingUsersResult.valid, false);
  assert.ok(missingUsersResult.errors.some((error) => error.includes("affected_users must name at least one")));

  const nonFailureLink = reviewedRecord();
  nonFailureLink.assessment.results.find((result) => result.requirement_id === "WCAG-2.2-SC-2.1.1").outcome = "pass";
  const nonFailureLinkResult = validate(nonFailureLink);
  assert.equal(nonFailureLinkResult.valid, false);
  assert.ok(nonFailureLinkResult.errors.some((error) => error.includes("must reference a failed result")));
});

test("renderer refuses invalid records and existing report files", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-audit-report-refusal-"));
  try {
    const renderer = path.join(skill, "scripts/render-audit-report.mjs");
    const output = path.join(temp, "report.md");
    fs.writeFileSync(output, "preserve", "utf8");
    const validInput = path.join(temp, "valid.json");
    fs.writeFileSync(validInput, JSON.stringify(reviewedRecord(), null, 2), "utf8");
    const existing = spawnSync(process.execPath, [renderer, "--input", validInput, "--output", output], { encoding: "utf8" });
    assert.notEqual(existing.status, 0);
    assert.match(existing.stderr || existing.stdout, /Refusing to overwrite existing file/);
    assert.equal(fs.readFileSync(output, "utf8"), "preserve");

    fs.rmSync(output);
    const invalid = reviewedRecord();
    invalid.assessment.findings = [];
    const invalidInput = path.join(temp, "invalid.json");
    fs.writeFileSync(invalidInput, JSON.stringify(invalid, null, 2), "utf8");
    const rejected = spawnSync(process.execPath, [renderer, "--input", invalidInput, "--output", output], { encoding: "utf8" });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr || rejected.stdout, /Assessment validation failed/);
    assert.equal(fs.existsSync(output), false);

    const legacy = reviewedRecord();
    delete legacy.assessment.findings;
    const legacyInput = path.join(temp, "legacy.json");
    fs.writeFileSync(legacyInput, JSON.stringify(legacy, null, 2), "utf8");
    const legacyRejected = spawnSync(process.execPath, [renderer, "--input", legacyInput], { encoding: "utf8" });
    assert.notEqual(legacyRejected.status, 0);
    assert.match(legacyRejected.stderr || legacyRejected.stdout, /failed results without structured findings/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("renderer escapes record text so it cannot inject report structure or HTML", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-audit-report-escape-"));
  try {
    const input = path.join(temp, "assessment.json");
    const record = reviewedRecord();
    record.assessment.target.name = "Example <script>alert(1)</script>\n## Forged claim";
    record.assessment.scope.included = ["Checkout\n## Forged section"];
    record.assessment.findings[0].observation = "Observed <img src=x onerror=alert(1)>\n## Forged finding";
    fs.writeFileSync(input, JSON.stringify(record, null, 2), "utf8");
    const renderer = path.join(skill, "scripts/render-audit-report.mjs");
    const run = spawnSync(process.execPath, [renderer, "--input", input], { encoding: "utf8" });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /Example &lt;script&gt;alert\\\(1\\\)&lt;\/script&gt;<br>\\#\\# Forged claim/);
    assert.match(run.stdout, /Observed &lt;img src=x onerror=alert\\\(1\\\)&gt;<br>\\#\\# Forged finding/);
    assert.equal(run.stdout.includes("<script>"), false);
    assert.equal(run.stdout.includes("<img src=x"), false);
    assert.equal(run.stdout.includes("\n## Forged claim"), false);
    assert.equal(run.stdout.includes("\n## Forged finding"), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
