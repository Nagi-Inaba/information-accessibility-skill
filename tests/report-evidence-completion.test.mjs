import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";
import { createInspectionRequest } from "../codex/skills/information-accessibility-practice/scripts/lib/inspection-request.mjs";
import { buildRunBackedPresentation, renderReportMarkdown } from "../codex/skills/information-accessibility-practice/scripts/lib/report-presentation.mjs";
import { renderReportSummaryMarkdown } from "../codex/skills/information-accessibility-practice/scripts/lib/report-summary.mjs";
import { renderReportHtml } from "../codex/skills/information-accessibility-practice/scripts/lib/report-html.mjs";
import { applyReportVisibility } from "../codex/skills/information-accessibility-practice/scripts/lib/report-privacy.mjs";

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../codex/skills/information-accessibility-practice/references/${name}`, import.meta.url), "utf8"));
const registry = read("standards-registry.json"), catalog = read("criteria-catalog.json");
const schema = read("assessment-record.schema.json"), methods = read("web-audit-methods.json");
const outputs = (model) => [renderReportMarkdown(model), renderReportSummaryMarkdown(model), renderReportHtml(model), renderReportHtml(model, { detail: "summary" })];
function fixture(locale = "ja", mode = "detailed") {
  const assessment = generateAssessment("web-modern", { targetName: "Report fixture", targetVersion: "v1", targetRefs: ["https://example.com/"], evaluator: "Fixture", evaluatedAt: "2026-09-14" });
  const observations = [
    { requirement_id: "SCREEN-NAV", profile_requirement_id: "WCAG-2.2-SC-1.4.10", report_outcome: "cant_tell",
      evidence_level: "E1", location: "Mobile navigation", method: "Keyboard and rendered DOM",
      observation: "At 320px, the navigation measures 386px; Tab reveals the final link.", captured_at: "2026-09-14T00:00:00Z",
      report_rationale: "Check the reflow applicability before deciding.",
      review_details: { reason: "meaning_review", performed_checks: [], next_checks: ["Review each link at 400% zoom."] } },
    { requirement_id: "SCREEN-RESIZE", profile_requirement_id: "WCAG-2.2-SC-1.4.4", report_outcome: "not_tested",
      evidence_level: "E1", location: "200% text resize", method: "Attempted browser zoom",
      observation: "The shortcut left text at 16px; 200% was not reached.", report_rationale: "Resize remains untested.",
      review_details: { reason: "test_not_run", performed_checks: [], next_checks: ["Set 200% in a supported browser and retest."] } }
  ];
  const publicModel = { target: assessment.assessment.target, scope: { ...assessment.assessment.scope, included: ["Homepage navigation"], excluded: ["Account pages"] },
    environment: assessment.assessment.environment, limitations: [], screeningCandidates: observations, remediation: [] };
  const build = () => buildRunBackedPresentation({ assessment, validation: validateAssessment(assessment, registry, schema, catalog, methods), registry, catalog, locale,
    run: { profile: assessment.assessment.profile, inspection_request: createInspectionRequest(mode, "Decide improvements") },
    publicModel: { ...publicModel, reportChecks: observations.map((item) => ({ requirement_id: item.profile_requirement_id, outcome: item.report_outcome, rationale: item.report_rationale, review_details: item.review_details })) } });
  return { observations, publicModel, build };
}

test("registered observations retain location, method and measurements in all reader formats", () => {
  for (const locale of ["ja", "en"]) {
    const { observations, build } = fixture(locale);
    const before = structuredClone(observations);
    for (const output of outputs(build())) {
      assert.ok(output.includes("Mobile navigation"));
      assert.ok(output.includes("Keyboard and rendered DOM"));
      assert.ok(output.includes("the navigation measures 386px"));
      assert.ok(output.includes("The shortcut left text at 16px"));
      const records = output.split(locale === "ja" ? "登録した検査記録" : "Registered inspection records")[1]?.split("</details>")[0];
      assert.ok(records);
      assert.doesNotMatch(records, /構造化した検査記録なし|No structured test record/u);
    }
    assert.deepEqual(observations, before);
  }
});

test("completion reports the explicit unperformed check and keeps agreement verification separate from record counts", () => {
  for (const locale of ["ja", "en"]) {
    const { build } = fixture(locale);
    for (const output of outputs(build())) {
      assert.ok(output.includes(locale === "ja" ? "完了確認待ち" : "Completion review pending"));
      assert.ok(output.includes(locale === "ja" ? "未実施の検査: 1件" : "Unperformed checks: 1"));
      assert.ok(output.includes("200% text resize"));
      assert.ok(output.includes(locale === "ja" ? "照合待ち" : "Needs comparison"));
      assert.ok(output.includes(locale === "ja" ? "記録あり" : "Recorded"));
      assert.ok(output.includes(locale === "ja" ? "記録不足" : "Missing records"));
      assert.ok(output.includes("Account pages"));
      assert.ok(output.includes("Set 200% in a supported browser"));
    }
  }
});

test("quick scope is not declared incomplete from untouched catalog rows or complete from passing screening", () => {
  const { observations, build } = fixture("en", "quick");
  observations.splice(1);
  Object.assign(observations[0], { report_outcome: "pass", review_details: { performed_checks: [], next_checks: [], reason: null } });
  for (const output of outputs(build())) {
    assert.ok(output.includes("Completion review pending"));
    assert.ok(output.includes("Unperformed checks: 0"));
    assert.ok(!output.includes("Unperformed checks: 54"));
    assert.ok(output.includes("At 320px"), "successful checks also remain available in a summary");
  }
});

test("checks sharing a criterion retain separate observations and completion follow-up", () => {
  const { observations, publicModel, build } = fixture("en");
  observations[1].profile_requirement_id = observations[0].profile_requirement_id;
  publicModel.remediation.push({ requirement_id: "SCREEN-NAV", evidence_status: "Unverified screening candidate", priority: "P2", issue: "Navigation issue", location: "Mobile navigation", affected_users: ["Keyboard users"], proposed_change: "Show all links", verification: "Repeat Tab navigation" });
  for (const output of outputs(build())) {
    assert.ok(output.includes("navigation measures 386px"));
    assert.ok(output.includes("shortcut left text at 16px"));
    assert.ok(output.includes("Unperformed checks: 1"));
  }
});

test("new evidence surfaces redact private values, escape markup and preserve saved input", () => {
  const { observations, build } = fixture("en");
  Object.assign(observations[0], { location: "C:\\Users\\PrivateEvidence\\audit", method: "Email evidence@example.com",
    observation: "Authorization: Bearer EVIDENCE-PRIVATE-SECRET-123456789 <img src=x onerror=alert(1)>" });
  const model = build(), before = structuredClone(model);
  const visible = applyReportVisibility(model, { visibility: "public", reviewerDisclosure: "redact" });
  for (const output of outputs(visible.presentation)) {
    assert.doesNotMatch(output, /PrivateEvidence|evidence@example\.com|EVIDENCE-PRIVATE-SECRET|<img src=x/u);
  }
  assert.deepEqual(model, before);
  assert.doesNotMatch(JSON.stringify(visible.manifest), /PrivateEvidence|evidence@example\.com|EVIDENCE-PRIVATE-SECRET/u);
});

test("evidence Markdown images, links and code remain literal in all four formats", () => {
  const { observations, build } = fixture("en");
  observations[0].observation = "![proof](https://example.org/pixel) [open](https://example.org/action) `code`";
  observations[0].method = "![method](https://example.org/method)";
  const model = applyReportVisibility(build(), { visibility: "public", reviewerDisclosure: "redact" }).presentation;
  for (const output of outputs(model)) {
    if (output.startsWith("<!doctype")) {
      assert.doesNotMatch(output, /<img|<a\b[^>]*example\.org|<code>code<\/code>/u);
      assert.ok(output.includes("![proof](https://example.org/pixel)"));
    } else {
      assert.doesNotMatch(output, /(?<!\\)!\[(?:proof|method)\]|(?<!\\)\[open\]|(?<!\\)`code/u);
      assert.ok(output.includes("\\!\\[proof\\]\\(https://example.org/pixel\\)"));
    }
  }
});

test("registered evidence keeps required-test guards and counts one check only once", () => {
  const { observations, build } = fixture("en");
  observations.splice(0, 1);
  Object.assign(observations[0], { report_outcome: "pass", review_details: { reason: null, next_checks: [], performed_checks: [] } });
  observations.push(structuredClone(observations[0]));
  const model = build();
  assert.equal(model.inspection_records.length, 1);
  assert.equal(model.inspection_records[0].outcome, "cant_tell", "declared pass without the required resize test must remain unconfirmed");
  assert.equal(model.inspection_records[0].review_details.reason, "evidence_incomplete");
});
