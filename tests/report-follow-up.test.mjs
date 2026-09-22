import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { guardScreeningProjection } from "../codex/skills/information-accessibility-practice/scripts/lib/review-details.mjs";
import { validateJsonSchema } from "../codex/skills/information-accessibility-practice/scripts/lib/json-schema.mjs";
import { schemaFixtureReference } from "./helpers/saved-evidence.mjs";
import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";
import { buildStandalonePresentation, renderReportMarkdown } from "../codex/skills/information-accessibility-practice/scripts/lib/report-presentation.mjs";
import { renderReportHtml } from "../codex/skills/information-accessibility-practice/scripts/lib/report-html.mjs";

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../codex/skills/information-accessibility-practice/references/${name}`, import.meta.url), "utf8"));
const registry = read("standards-registry.json");
const schema = read("assessment-record.schema.json");
const catalog = read("criteria-catalog.json");
const methods = read("web-audit-methods.json");
const screeningSchema = read("screening-observations.schema.json");
const validate = (record) => validateAssessment(record, registry, schema, catalog, methods);
const makeRecord = (profile = "web-modern") => generateAssessment(profile, {
  targetName: "Follow-up fixture", targetVersion: "fixture-v1", targetRefs: ["https://example.com/"],
  evaluator: "Fixture author", evaluatedAt: "2026-09-14"
});

test("recorded reasons and next checks survive bilingual Markdown and HTML without changing outcomes", () => {
  const record = makeRecord();
  const reasons = ["test_not_run", "applicability_pending", "meaning_review", "scope_incomplete"];
  reasons.forEach((reason, index) => {
    record.assessment.results[index].review_details = {
      reason, performed_checks: [], next_checks: [`Follow-up ${index}: <img src=x onerror=alert(1)> | check`]
    };
  });
  const before = structuredClone(record);
  const validation = validate(record);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  for (const locale of ["ja", "en"]) {
    const presentation = buildStandalonePresentation({ record, validation, registry, catalog, locale });
    assert.equal(presentation.counts.not_tested, 55);
    const markdown = renderReportMarkdown(presentation);
    const html = renderReportHtml(presentation);
    for (const content of [markdown, html]) {
      for (let index = 0; index < reasons.length; index++) assert.ok(content.includes(`Follow-up ${index}`));
      assert.equal(content.includes("<img src=x"), false);
      for (const label of locale === "ja"
        ? ["検査未実施", "適用条件の確認待ち", "意味の確認待ち", "対象範囲の不足", "次の確認", "理由の記録なし"]
        : ["Test not performed", "Applicability pending", "Meaning review pending", "Scope incomplete", "Next check", "Reason not recorded"]) {
        assert.ok(content.includes(label), `${locale}: missing ${label}`);
      }
    }
  }
  assert.deepEqual(record, before);
});

test("old records need no review details and invalid reason/check metadata is rejected", () => {
  assert.equal(validate(makeRecord()).valid, true);
  for (const details of [
    { reason: "assume_no_content", performed_checks: [], next_checks: [] },
    { reason: null, performed_checks: [{ id: "text_resize_200", outcome: "pass" }], next_checks: [] }
  ]) {
    const record = makeRecord();
    record.assessment.results[0].review_details = details;
    assert.equal(validate(record).valid, false);
  }
});

test("report passes for resize and skip links require a completed E1 test record", () => {
  for (const prefix of ["WCAG-2.2", "JIS-X-8341-3-2016"]) {
    for (const [criterion, id] of [["1.4.4", "text_resize_200"], ["2.4.1", "skip_link_navigation"]]) {
      const observation = {
        evidence_refs: [schemaFixtureReference("2026-09-13T15:00:00Z")],
        requirement_id: "SCREEN-FOLLOW-UP", evidence_level: "E1", method: "Limited browser check",
        location: "https://example.com/", observation: "Only viewport settings or the link presence were inspected.",
        captured_at: "2026-09-13T15:00:00Z", profile_requirement_id: `${prefix}-SC-${criterion}`,
        report_outcome: "pass", applicability: "applicable", report_rationale: "Partial observation."
      };
      const before = structuredClone(observation);
      assert.equal(guardScreeningProjection(observation).report_outcome, "cant_tell");
      assert.deepEqual(observation, before);
      observation.review_details = {
        reason: null, performed_checks: [{ id, outcome: "pass", environment: "Fixture browser 1 / OS 1",
          evidence: criterion === "1.4.4" ? "Up to 200%: content and functions retained." : "Activation reaches main content; next Tab reaches its first link." }],
        next_checks: []
      };
      assert.deepEqual(validateJsonSchema({ schema_version: "4.0.0", observations: [observation] }, screeningSchema), []);
      assert.equal(guardScreeningProjection(observation).report_outcome, "pass");
      for (const mutate of [
        (item) => { item.review_details.performed_checks[0].environment = " "; },
        (item) => { item.review_details.performed_checks[0].evidence = " "; },
        (item) => { item.review_details.performed_checks[0].outcome = "fail"; },
        (item) => { item.review_details.next_checks.push("A required check remains."); },
        (item) => { item.review_details.reason = "scope_incomplete"; },
        (item) => { item.evidence_level = "E0"; }
      ]) {
        const incomplete = structuredClone(observation);
        mutate(incomplete);
        assert.equal(guardScreeningProjection(incomplete).report_outcome, "cant_tell");
      }
      const invalid = structuredClone(observation);
      delete invalid.review_details.performed_checks[0].evidence;
      assert.ok(validateJsonSchema({ schema_version: "4.0.0", observations: [invalid] }, screeningSchema).length > 0);
      observation.report_outcome = "fail";
      assert.equal(guardScreeningProjection(observation).report_outcome, "fail");
    }
  }
});

test("each active profile renders exactly its registered IDs and coherent counts", () => {
  for (const profile of registry.profiles.filter((item) => item.assessment_configuration?.active)) {
    const record = makeRecord(profile.id);
    record.assessment.results = record.assessment.results.slice(0, 1);
    const validation = validate(record);
    assert.equal(validation.valid, true, validation.errors.join("\n"));
    const presentation = buildStandalonePresentation({ record, validation, registry, catalog });
    assert.deepEqual(presentation.rows.map((row) => row.requirement_id).sort(), [...profile.requirement_ids].sort());
    assert.equal(presentation.counts.not_tested, profile.requirement_ids.length);
    assert.equal(presentation.groups.reduce((sum, group) => sum + group.expected_count, 0), profile.requirement_ids.length);
  }
});

test("a missing or duplicate catalog row cannot silently shrink a report", () => {
  const record = makeRecord();
  const validation = validate(record);
  for (const change of ["missing", "duplicate"]) {
    const broken = structuredClone(catalog);
    const entries = broken.catalogs.web_modern;
    if (change === "missing") entries.pop();
    else entries.push(structuredClone(entries[0]));
    assert.throws(() => buildStandalonePresentation({ record, validation, registry, catalog: broken }), /catalog|requirement|duplicate/iu);
  }
});
