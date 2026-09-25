import { legacyAssessment } from "./helpers/legacy-assessment.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";
import { lookupRequirement } from "../codex/skills/information-accessibility-practice/scripts/show-requirement.mjs";
import { buildStandalonePresentation, buildRunBackedPresentation, renderReportMarkdown } from "../codex/skills/information-accessibility-practice/scripts/lib/report-presentation.mjs";
import { renderReportSummaryMarkdown } from "../codex/skills/information-accessibility-practice/scripts/lib/report-summary.mjs";
import { renderReportHtml } from "../codex/skills/information-accessibility-practice/scripts/lib/report-html.mjs";
import { applyReportVisibility } from "../codex/skills/information-accessibility-practice/scripts/lib/report-privacy.mjs";

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../codex/skills/information-accessibility-practice/references/${name}`, import.meta.url), "utf8"));
const registry = read("standards-registry.json");
const schema = read("assessment-record.schema.json");
const catalog = read("criteria-catalog.json");
const methods = read("web-audit-methods.json");
const record = (profile = "web-modern") => legacyAssessment(generateAssessment(profile, {
  targetName: "Reader regression fixture", targetVersion: "fixture-v1", targetRefs: ["https://example.com/"],
  evaluator: "Synthetic reviewer", evaluatedAt: "2026-09-14"
}));
function presentation(input, locale) {
  const validation = validateAssessment(input, registry, schema, catalog, methods);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  return buildStandalonePresentation({ record: input, validation, registry, catalog, locale });
}
const outputs = (model) => [renderReportMarkdown(model), renderReportSummaryMarkdown(model),
  renderReportHtml(model), renderReportHtml(model, { detail: "summary" })];

function humanFailure(input) {
  const row = input.assessment.results[0];
  row.mapping_status = "human_verified";
  row.outcome = "fail";
  row.method_kind = "manual";
  row.notes = "Recorded failure at the informative image.";
  row.evidence = lookupRequirement(input.assessment.profile.id, row.requirement_id).procedure_binding.required_evidence_types.map((type) => ({
    type, location: "Fixture image", observation: "Synthetic target-specific image evidence.", captured_at: "2026-09-14T00:00:00Z"
  }));
  input.assessment.evidence_level = "E2";
  input.assessment.scope.included = ["https://example.com/"];
  input.assessment.findings = [{ id: "failure-fixture", priority: "P0", requirement_ids: [row.requirement_id],
    location: "Fixture image", affected_users: ["Screen reader users"], observation: "Image text is missing.",
    remediation: "Add an equivalent text alternative.", verification: "Compare the image purpose and alternative." }];
  return row;
}

test("summary and full judgements agree for empty, partial and failed real assessments in both languages", () => {
  for (const locale of ["ja", "en"]) {
    for (const profile of registry.profiles.filter((item) => item.assessment_configuration?.active)) {
      const input = record(profile.id);
      const total = input.assessment.results.length;
      for (const output of outputs(presentation(input, locale))) {
        assert.match(output, locale === "ja" ? /総合判定(?:<\/dt><dd>|: )未確認/u : /Overall judgement(?:<\/dt><dd>|: )Not tested/u);
        assert.ok(output.includes(`${total}/${total}`));
      }
    }
    const input = record();
    humanFailure(input);
    const before = structuredClone(input);
    for (const output of outputs(presentation(input, locale))) {
      assert.match(output, locale === "ja" ? /総合判定(?:<\/dt><dd>|: )不適合/u : /Overall judgement(?:<\/dt><dd>|: )Fail/u);
      assert.ok(output.includes("1/55"));
      assert.ok(output.includes("54/55"));
    }
    assert.deepEqual(input, before, "rendering must preserve the saved evidence and outcomes");
  }
});

test("summaries retain pending reasons, performed checks and next steps, including notes-only older records", () => {
  const input = record();
  input.assessment.results[0].review_details = {
    reason: "meaning_review", performed_checks: [], next_checks: ["Compare the image purpose with its text alternative."]
  };
  input.assessment.results[1].notes = "Inspect the audio transcript with the content editor.";
  for (const locale of ["ja", "en"]) {
    for (const output of outputs(presentation(input, locale))) {
      assert.ok(output.includes("Compare the image purpose"));
      assert.ok(output.includes("Inspect the audio transcript"));
      assert.ok(output.includes(locale === "ja" ? "意味の確認待ち" : "Meaning review pending"));
      assert.ok(output.includes(locale === "ja" ? "構造化した検査記録なし" : "No structured test record"));
    }
  }
});

test("prioritized actions combine impact, remediation and evidence without dropping distinct issues on one criterion", () => {
  const input = record();
  const row = humanFailure(input);
  input.assessment.findings = ["P2", "P0", "P1"].map((priority, index) => ({
    id: `fixture-${index}`, priority, requirement_ids: [row.requirement_id], location: `Image ${index}`,
    affected_users: ["Screen reader users"], observation: `Distinct issue ${priority}`,
    remediation: `Remediation ${priority}`, verification: `Retest ${priority}`
  }));
  const model = presentation(input, "en");
  for (const output of outputs(model)) {
    assert.ok(output.indexOf("Distinct issue P0") < output.indexOf("Distinct issue P1"));
    assert.ok(output.indexOf("Distinct issue P1") < output.indexOf("Distinct issue P2"));
    for (const priority of ["P0", "P1", "P2"]) {
      assert.equal(output.split(`Distinct issue ${priority}`).length - 1, 1);
      assert.ok(output.includes(`Remediation ${priority}`));
      assert.ok(output.includes(`Retest ${priority}`));
    }
    assert.ok(output.includes("Screen reader users"));
  }
  const summary = renderReportSummaryMarkdown(model);
  assert.equal((summary.match(/^### /gmu) ?? []).length, 3);
  assert.doesNotMatch(summary, /Human-reviewed requirements\n/u);
});

test("successful screening checks are not promoted to problem actions", () => {
  // Renderer regression: a successful screening projection is evidence, not an issue.
  const model = presentation(record(), "en");
  Object.assign(model.rows[0], { source_kind: "screening", outcome: "pass", outcome_label: "Pass", source_label: "AI/automated screening" });
  for (const output of [renderReportSummaryMarkdown(model), renderReportHtml(model, { detail: "summary" })]) {
    assert.doesNotMatch(output, /(?:### 1\.|id="finding-1")/u);
    assert.ok(output.includes("No remediation item is recorded"));
  }
});

test("HTML places the target, coverage and actions before navigation and technical tiers", () => {
  const input = record();
  humanFailure(input);
  for (const detail of ["summary", "full"]) {
    const html = renderReportHtml(presentation(input, "ja"), { detail });
    assert.ok(html.indexOf('id="overview"') < html.indexOf('id="finding-1"'));
    assert.ok(html.indexOf('id="finding-1"') < html.indexOf("<nav"));
    assert.ok(html.indexOf('id="pending-checks"') < html.indexOf('id="claim"'));
    assert.ok(html.indexOf("1/55") < html.indexOf("E2"));
  }
});

test("newly visible action fields use public redaction and escaped rendering in every format", () => {
  const input = record();
  const row = humanFailure(input);
  input.assessment.findings = [{
    id: "privacy-fixture", priority: "P0", requirement_ids: [row.requirement_id], location: "Image",
    affected_users: ["reader@example.com <img src=x onerror=alert(1)>"], observation: "Image issue",
    remediation: "Fix image", verification: "Retest image"
  }];
  const model = presentation(input, "en");
  // Owner is present on run-backed remediation items, and follows the same sanitizer.
  model.findings[0].owner = "owner@example.com <script>alert(1)</script>";
  model.rows[0].rationale = "Contact notes@example.com about this observation.";
  model.rows[0].review_details = {
    reason: "meaning_review", performed_checks: [{ id: "text_resize_200", outcome: "cant_tell",
      environment: "C:\\Users\\PrivateReader\\audit", evidence: "Authorization: Bearer PRIVATE-REVIEW-SECRET-123456789" }],
    next_checks: ["Contact nextcheck@example.com to complete the meaning review."]
  };
  const before = structuredClone(model);
  const visible = applyReportVisibility(model, { visibility: "public", reviewerDisclosure: "redact" });
  for (const output of outputs(visible.presentation)) {
    assert.doesNotMatch(output, /reader@example\.com|owner@example\.com|notes@example\.com|nextcheck@example\.com|PrivateReader|PRIVATE-REVIEW-SECRET|<img src=x|<script>/u);
    assert.ok(output.includes("Affected users"));
    assert.ok(output.includes("Owner"));
  }
  assert.deepEqual(model, before);
  assert.ok(visible.manifest.redactions.some((entry) => entry.path.includes("review_details")));
  assert.doesNotMatch(JSON.stringify(visible.manifest), /nextcheck@example\.com|PrivateReader|PRIVATE-REVIEW-SECRET/u);
});

test("findings keep their own screening evidence when two checks map to one criterion", () => {
  const input = record();
  const id = input.assessment.results[0].requirement_id;
  const candidate = (name) => ({ requirement_id: `SCREEN-${name}`, profile_requirement_id: id,
    report_outcome: "cant_tell", evidence_level: "E1", report_rationale: `Evidence from check ${name}`,
    review_details: { reason: "meaning_review", performed_checks: [], next_checks: [`Next step for check ${name}`] } });
  const model = buildRunBackedPresentation({
    run: { profile: input.assessment.profile }, assessment: input,
    validation: validateAssessment(input, registry, schema, catalog, methods), registry, catalog, locale: "en",
    publicModel: { target: input.assessment.target, scope: input.assessment.scope, environment: input.assessment.environment,
      reportChecks: [{ requirement_id: id, outcome: "cant_tell", rationale: "Evidence from check A", review_details: candidate("A").review_details }],
      screeningCandidates: [candidate("A"), candidate("B")],
      remediation: [{ requirement_id: "SCREEN-B", evidence_status: "Unverified screening candidate", priority: "P0", issue: "B issue", proposed_change: "B change", verification: "B retest" }] }
  });
  for (const output of outputs(model)) {
    const action = output.startsWith("<!doctype") ? output.match(/<article id="finding-1">[\s\S]*?<\/article>/u)?.[0]
      : output.split("### 1. B issue")[1]?.split("### 2.")[0];
    assert.ok(action?.includes("Evidence from check B"));
    assert.ok(action?.includes("Next step for check B"));
    assert.ok(!action?.includes("Evidence from check A"));
    assert.ok(output.includes("Evidence from check A"), "the other pending check must remain visible");
  }
});
