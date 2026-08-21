import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { overallReportJudgement } from "../codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "codex/skills/information-accessibility-practice");
const registry = JSON.parse(fs.readFileSync(path.join(skillRoot, "references/standards-registry.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, "references/assessment-record.schema.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(skillRoot, "references/criteria-catalog.json"), "utf8"));
const auditMethods = JSON.parse(fs.readFileSync(path.join(skillRoot, "references/web-audit-methods.json"), "utf8"));
const template = JSON.parse(fs.readFileSync(path.join(skillRoot, "assets/assessment-record.template.json"), "utf8"));

function record() {
  const value = structuredClone(template);
  value.assessment.target.name = "Example application";
  value.assessment.target.version_or_commit = "abc123";
  value.assessment.target.urls_or_files = ["https://example.invalid/"];
  value.assessment.scope.included = ["https://example.invalid/"];
  value.assessment.evaluator = "Accessibility reviewer";
  value.assessment.evaluated_at = "2026-08-21";
  return value;
}

function profileRows() {
  const profile = registry.profiles.find((item) => item.id === "web-modern");
  const recordsById = new Map(profile.assessment_configuration.catalog_keys
    .flatMap((key) => catalog.catalogs[key])
    .map((item) => [item.id, item]));
  return profile.requirement_ids.map((requirementId) => {
    const item = recordsById.get(requirementId);
    return {
      requirement_id: requirementId,
      requirement_kind: "profile_requirement",
      requirement_source: item.normative_url ?? item.checklist_source_url ?? item.profile_source_url,
      mapping_status: "unverified",
      outcome: "not_tested",
      method_kind: "manual",
      method: "Not yet evaluated.",
      evidence: [],
      notes: "Not yet evaluated."
    };
  });
}

function validate(value) {
  const result = validateAssessment(value, registry, schema, catalog, auditMethods);
  assert.equal(result.valid, true, result.errors.join("\n"));
  return result;
}

test("zero recorded profile rows are projected as all requirements not tested", () => {
  const result = validate(record());
  assert.equal(result.guard.catalog_coverage.recorded, 0);
  assert.equal(result.guard.catalog_coverage.expected, 55);
  assert.equal(result.guard.profile_outcome_counts.not_tested, 55);
  assert.equal(overallReportJudgement(result.guard.profile_outcome_counts), "未確認");
});

test("partial profile coverage counts every missing requirement as not tested", () => {
  const value = record();
  value.assessment.results = profileRows().slice(0, 1);
  const result = validate(value);
  assert.equal(result.guard.catalog_coverage.recorded, 1);
  assert.equal(result.guard.catalog_coverage.expected, 55);
  assert.equal(result.guard.profile_outcome_counts.not_tested, 55);
  assert.equal(overallReportJudgement(result.guard.profile_outcome_counts), "未確認");
});

test("complete not-tested ledger is not double counted", () => {
  const value = record();
  value.assessment.results = profileRows();
  const result = validate(value);
  assert.equal(result.guard.catalog_coverage.recorded, 55);
  assert.equal(result.guard.catalog_coverage.expected, 55);
  assert.equal(result.guard.profile_outcome_counts.not_tested, 55);
  assert.equal(overallReportJudgement(result.guard.profile_outcome_counts), "未確認");
});
