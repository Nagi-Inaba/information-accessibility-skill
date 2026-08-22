import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { renderAuditReport } from "../codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "codex/skills/information-accessibility-practice");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(skill, relative), "utf8"));
const registry = readJson("references/standards-registry.json");
const schema = readJson("references/assessment-record.schema.json");
const catalog = readJson("references/criteria-catalog.json");
const methods = readJson("references/web-audit-methods.json");

function failedRecord() {
  const record = generateAssessment("web-modern", {
    targetName: "Reportability fixture",
    targetVersion: "v1.0.0",
    targetRefs: ["https://example.invalid/checkout"],
    evaluator: "External reviewer",
    evaluatedAt: "2026-08-22"
  });
  record.assessment.scope.included = ["Checkout"];
  record.assessment.evidence_level = "E2";
  record.assessment.claim.requested_tier = "evaluated_subset";
  record.assessment.claim.proposed_wording = registry.claim_templates.evaluated_subset[0];
  const result = record.assessment.results.find((item) => item.requirement_id === "WCAG-2.2-SC-2.1.1");
  result.mapping_status = "human_verified";
  result.outcome = "fail";
  result.method_kind = "manual";
  result.evidence = [{
    type: "keyboard_test",
    location: "Checkout payment method",
    observation: "The control could not be reached with the keyboard.",
    captured_at: "2026-08-22T00:00:00Z"
  }];
  result.notes = "Keyboard operation failed.";
  return record;
}

function validate(record) {
  return validateAssessment(record, registry, schema, catalog, methods);
}

function finding() {
  return {
    id: "F-REPORTABLE-001",
    priority: "P1",
    requirement_ids: ["WCAG-2.2-SC-2.1.1"],
    location: "Checkout payment method",
    affected_users: ["Keyboard-only users"],
    observation: "The control could not be reached with the keyboard.",
    remediation: "Use a keyboard-operable native control or provide equivalent keyboard behavior.",
    verification: "Repeat the checkout flow with keyboard-only input."
  };
}

test("failed records without a findings property are invalid and not reportable", () => {
  const record = failedRecord();
  delete record.assessment.findings;
  const validation = validate(record);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("findings is required when assessment contains failed results")));
  assert.throws(() => renderAuditReport(record, validation), /must pass validation/iu);
});

test("failed records with an empty findings array are invalid", () => {
  const record = failedRecord();
  record.assessment.findings = [];
  const validation = validate(record);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("A finding must reference failed requirement")));
});

test("a validated failed record with a structured finding remains reportable", () => {
  const record = failedRecord();
  record.assessment.findings = [finding()];
  const validation = validate(record);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  const report = renderAuditReport(record, validation);
  assert.match(report, /^# WCAG検査レポート/mu);
  assert.match(report, /F-REPORTABLE-001/u);
});
