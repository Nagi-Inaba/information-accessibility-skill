import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import {
  buildPublicReportModel,
  overallReportJudgement,
  renderAuditReport,
  renderRunBackedReport
} from "../codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "codex/skills/information-accessibility-practice");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(skill, relative), "utf8"));
const registry = readJson("references/standards-registry.json");
const schema = readJson("references/assessment-record.schema.json");
const catalog = readJson("references/criteria-catalog.json");
const methods = readJson("references/web-audit-methods.json");

test("an empty outcome set is never converted into an implicit pass", () => {
  assert.equal(overallReportJudgement({}), "未確認");
  assert.equal(overallReportJudgement({ pass: 0, fail: 0, not_applicable: 0, not_tested: 0, cant_tell: 0 }), "未確認");
  assert.equal(overallReportJudgement({ pass: 0, fail: 0, not_applicable: 2, not_tested: 0, cant_tell: 0 }), "適合");
});

test("standalone reference-only records render as guidance rather than a standards judgement report", () => {
  const record = generateAssessment("web-modern", {
    targetName: "Reference fixture",
    targetVersion: "v1.0.0",
    targetRefs: ["https://example.com/reference"],
    evaluator: "Reviewer",
    evaluatedAt: "2026-08-22"
  });
  record.assessment.results = [];

  const validation = validateAssessment(record, registry, schema, catalog, methods);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  const report = renderAuditReport(record, validation);

  assert.match(report, /^# WCAG参照ガイダンス/mu);
  assert.match(report, /^- 文書区分: 規格参照ガイダンス$/mu);
  assert.match(report, /^- 確認状況: 未確認$/mu);
  assert.match(report, /^- 登録件数: 0\/55$/mu);
  assert.doesNotMatch(report, /^- 総合判定: 適合$/mu);
  assert.doesNotMatch(report, /^# WCAG検査レポート$/mu);
});

test("run-backed reporting counts every missing profile row as untested and marks the handoff", () => {
  const expectedRequirementIds = ["WCAG-2.2-SC-1.1.1", "WCAG-2.2-SC-1.3.1"];
  const run = {
    target: {
      name: "Public fixture",
      version_or_commit: "v1.0.0",
      urls_or_files: ["https://example.com/checkout"]
    },
    profile: { id: "web-modern", registry_version: "1.0.0" },
    scope: {
      included: ["Checkout process"],
      excluded: [],
      complete_processes: [],
      third_party_content: [],
      full_pages_reviewed: false
    },
    environment: {
      os: ["not_declared"],
      browsers: [],
      assistive_technologies: [],
      input_modes: []
    },
    artifacts: [],
    history: []
  };
  const assessment = {
    assessment: {
      results: [],
      findings: [],
      evaluated_at: "2026-08-22",
      limitations: [
        "All profile requirements are initialized as not_tested; no accessibility conclusion has been made.",
        "Automated checks, if added, are supporting screening evidence and do not determine requirement outcomes."
      ],
      claim: {
        requested_tier: "reference_only",
        proposed_wording: "Reference-only fixture"
      },
      evidence_level: "E0"
    }
  };
  const resources = {
    standardsRegistry: {
      schema_version: "1.0.0",
      profiles: [{ id: "web-modern", requirement_ids: expectedRequirementIds }]
    }
  };

  const model = buildPublicReportModel({
    run,
    assessment,
    envelopesById: new Map(),
    resources
  });

  assert.equal(model.catalogCoverage.recorded, 0);
  assert.equal(model.catalogCoverage.expected, 2);
  assert.equal(model.reportOutcomeCounts.not_tested, 2);
  assert.equal(model.profileOutcomeCounts.not_tested, 2);
  assert.deepEqual(model.reportChecks.map((item) => item.requirement_id), expectedRequirementIds);
  assert.ok(model.reportChecks.every((item) => item.outcome === "not_tested"));

  const report = renderRunBackedReport(model);
  assert.match(report, /^> 文書区分：検査・改善ハンドオフ（規格参照のみ）$/mu);
  assert.match(report, /^- 総合判定: 未確認$/mu);
  assert.match(report, /^- 登録済み達成基準: 0\/2$/mu);
  assert.doesNotMatch(report, /^- 総合判定: 適合$/mu);
});

test("README distinguishes immediate reference guidance from evidence-backed judgement reporting", () => {
  const japanese = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const english = fs.readFileSync(path.join(root, "README.en.md"), "utf8");

  assert.match(japanese, /参照ガイダンス/u);
  assert.match(japanese, /検査レポート/u);
  assert.match(japanese, /reference_only/u);
  assert.match(english, /reference guidance/iu);
  assert.match(english, /inspection report/iu);
  assert.match(english, /reference_only/u);
});
