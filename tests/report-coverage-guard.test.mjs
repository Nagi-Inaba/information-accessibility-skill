import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { overallReportJudgement } from "../codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "codex/skills/information-accessibility-practice");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(skill, relative), "utf8"));
const registry = readJson("references/standards-registry.json");
const schema = readJson("references/assessment-record.schema.json");
const catalog = readJson("references/criteria-catalog.json");
const methods = readJson("references/web-audit-methods.json");

test("missing profile rows remain visible as not tested", () => {
  for (const recordedCount of [0, 1, 55]) {
    const record = generateAssessment("web-modern", {
      targetName: "Coverage fixture",
      targetVersion: "v1",
      evaluator: "Reviewer",
      evaluatedAt: "2026-08-21"
    });
    record.assessment.results = record.assessment.results.slice(0, recordedCount);
    const result = validateAssessment(record, registry, schema, catalog, methods);
    assert.equal(result.valid, true, result.errors.join("\n"));
    assert.equal(result.guard.catalog_coverage.recorded, recordedCount);
    assert.equal(result.guard.catalog_coverage.expected, 55);
    assert.equal(result.guard.profile_outcome_counts.not_tested, 55);
    assert.equal(result.guard.profile_group_outcome_counts.wcag_2_2.not_tested, 55);
    assert.equal(overallReportJudgement(result.guard.profile_outcome_counts), "未確認");
  }
});
