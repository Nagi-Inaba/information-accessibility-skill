import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";
import { renderAuditReport, reportTitleForProfile } from "../codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs";

const skill = path.resolve("codex/skills/information-accessibility-practice");
const read = (name) => JSON.parse(fs.readFileSync(path.join(skill, "references", name), "utf8"));

test("profile report title distinguishes JIS plus additional WCAG from WCAG-only review", () => {
  assert.equal(reportTitleForProfile("web-modern"), "# WCAG検査レポート");
  assert.equal(reportTitleForProfile("jp-public-web"), "# JIS X 8341-3:2016＋追加WCAG検査レポート");
});

test("standalone jp-public-web report uses the JIS-aware title and keeps group counts", () => {
  const record = generateAssessment("jp-public-web", {
    targetName: "Example Japan site",
    targetVersion: "v1",
    targetRefs: ["https://example.invalid/"],
    evaluator: "Reviewer",
    evaluatedAt: "2026-08-22"
  });
  const validation = validateAssessment(record, read("standards-registry.json"), read("assessment-record.schema.json"), read("criteria-catalog.json"), read("web-audit-methods.json"));
  assert.equal(validation.valid, true, validation.errors.join("; "));
  const report = renderAuditReport(record, validation);
  assert.match(report, /^# JIS X 8341-3:2016＋追加WCAG検査レポート/mu);
  assert.match(report, /達成基準の区分別件数/u);
  assert.match(report, /JIS/u);
});
