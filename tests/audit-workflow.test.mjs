import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { lookupRequirement } from "../codex/skills/information-accessibility-practice/scripts/show-requirement.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "codex/skills/information-accessibility-practice");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(skill, relative), "utf8"));
const registry = readJson("references/standards-registry.json");
const catalog = readJson("references/criteria-catalog.json");
const assessmentSchema = readJson("references/assessment-record.schema.json");
const auditMethods = readJson("references/web-audit-methods.json");

function validate(record) {
  return validateAssessment(record, registry, assessmentSchema, catalog, auditMethods);
}

test("catalog has exact profile counts and level distributions", () => {
  const wcag = catalog.catalogs.web_modern;
  const jis = catalog.catalogs.jis_x_8341_3_2016;
  const additional = catalog.catalogs.jp_wcag_2_2_additional;
  assert.deepEqual([wcag.length, jis.length, additional.length], [55, 38, 18]);

  const levels = (records) => records.reduce((counts, record) => ({ ...counts, [record.level]: (counts[record.level] ?? 0) + 1 }), {});
  assert.deepEqual(levels(wcag), { A: 31, AA: 24 });
  assert.deepEqual(levels(jis), { A: 25, AA: 13 });
  assert.deepEqual(levels(additional), { A: 7, AA: 11 });

  const introduced = wcag.reduce((counts, record) => ({ ...counts, [record.introduced_in]: (counts[record.introduced_in] ?? 0) + 1 }), {});
  assert.deepEqual(introduced, { "2.0": 37, "2.1": 12, "2.2": 6 });
});

test("catalog IDs match registry and preserve the WCAG/JIS 4.1.1 difference", () => {
  const webIds = catalog.catalogs.web_modern.map((record) => record.id);
  const jpIds = [...catalog.catalogs.jis_x_8341_3_2016, ...catalog.catalogs.jp_wcag_2_2_additional].map((record) => record.id);
  assert.deepEqual([...webIds].sort(), [...registry.profiles.find((profile) => profile.id === "web-modern").requirement_ids].sort());
  assert.deepEqual([...jpIds].sort(), [...registry.profiles.find((profile) => profile.id === "jp-public-web").requirement_ids].sort());
  assert.equal(webIds.includes("WCAG-2.2-SC-4.1.1"), false);
  assert.equal(webIds.includes("WCAG-2.2-SC-4.1.2"), true);
  assert.equal(jpIds.includes("JIS-X-8341-3-2016-SC-4.1.1"), true);
  assert.equal(catalog.catalogs.jis_x_8341_3_2016.find((record) => record.success_criterion === "4.1.1").method_key, "parsing-legacy");
});

test("catalog metadata is safe, source-pinned, and review-oriented", () => {
  assert.equal(catalog.catalog_status, "metadata_complete");
  assert.ok(catalog.sources.every((source) => /^[a-f0-9]{64}$/.test(source.source_sha256)));
  const all = Object.values(catalog.catalogs).flat();
  const methods = readJson("references/web-audit-methods.json");
  const methodIds = new Set(methods.methods.map((method) => method.id));
  assert.equal(new Set(all.map((record) => record.id)).size, all.length);
  for (const record of all) {
    assert.equal(record.normative_text_included, false);
    assert.equal(record.method_requirement, "manual_or_hybrid");
    assert.equal(record.automation_role, "supporting_only");
    assert.equal(record.method_status, "profile_review_scaffold");
    assert.ok(methodIds.has(record.method_key), record.id);
    assert.ok(record.official_method_sources.length > 0);
    assert.ok(record.evidence_hints.length > 0);
    assert.ok(record.applicability_instruction.length > 0);
    assert.ok(record.expectation_instruction.length > 0);
  }
  assert.equal(readJson("references/criteria-catalog.schema.json").properties.catalog_status.const, "metadata_complete");
});

test("ARIA checks remain SCREEN-only supporting evidence requiring human review", () => {
  const aria = readJson("references/aria-review-rules.json");
  assert.equal(aria.claim_effect, "supporting_only");
  assert.equal(aria.rules.length, 12);
  assert.equal(new Set(aria.rules.map((rule) => rule.id)).size, 12);
  for (const rule of aria.rules) {
    assert.match(rule.id, /^SCREEN-ARIA-[A-Z0-9-]+$/);
    assert.equal(rule.human_review_required, true);
    assert.match(rule.source_url, /^https:\/\/www\.w3\.org\/TR\//);
  }
  assert.ok(registry.profiles.find((profile) => profile.id === "web-modern").standards.some((standard) => standard.id.startsWith("ARIA-IN-HTML-2026")));
});

test("audit generators initialize complete catalogs without claiming evaluation", () => {
  for (const [profile, expected] of [["web-modern", 55], ["jp-public-web", 56]]) {
    const record = generateAssessment(profile, {
      targetName: "Generic target",
      targetVersion: "version-1",
      evaluator: "Auditor",
      evaluatedAt: "2026-07-12"
    });
    assert.equal(record.assessment.results.length, expected);
    assert.deepEqual(record.assessment.findings, []);
    assert.ok(record.assessment.results.every((result) => result.outcome === "not_tested" && result.mapping_status === "unverified" && result.evidence.length === 0));
    const result = validate(record);
    assert.equal(result.valid, true);
    assert.equal(result.guard.catalog_coverage.complete, true);
    assert.equal(result.guard.evaluation_coverage.complete, false);
    assert.equal(result.guard.evaluation_coverage.human_verified, 0);
    assert.equal(result.guard.max_tier, "reference_only");
    if (profile === "jp-public-web") {
      assert.equal(result.guard.profile_group_outcome_counts.jis_x_8341_3_2016.not_tested, 38);
      assert.equal(result.guard.profile_group_outcome_counts.jp_wcag_2_2_additional.not_tested, 18);
    }
  }
});

test("unregistered upper claim tier is rejected even if a future profile ceiling changes", () => {
  const record = generateAssessment("web-modern", {
    targetName: "Generic target",
    targetVersion: "version-1",
    evaluator: "Auditor",
    evaluatedAt: "2026-07-12"
  });
  record.assessment.claim.requested_tier = "evaluated_complete";
  record.assessment.claim.proposed_wording = "";
  const result = validate(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("no registered claim template")));
});

test("placeholder audit identity and invalid evidence timestamps are rejected", () => {
  const placeholder = generateAssessment("web-modern");
  const placeholderResult = validate(placeholder);
  assert.equal(placeholderResult.valid, false);
  assert.ok(placeholderResult.errors.some((error) => error.includes("Template placeholders")));
  assert.ok(placeholderResult.errors.some((error) => error.includes("evaluated_at")));

  const record = generateAssessment("web-modern", {
    targetName: "Generic target",
    targetVersion: "version-1",
    evaluator: "Auditor",
    evaluatedAt: "2026-07-12"
  });
  record.assessment.evidence_level = "E2";
  record.assessment.claim.requested_tier = "evaluated_subset";
  record.assessment.claim.proposed_wording = registry.claim_templates.evaluated_subset[0];
  record.assessment.results[0] = {
    ...record.assessment.results[0],
    mapping_status: "human_verified",
    outcome: "pass",
    evidence: [{ type: "manual_observation", location: "page 1", observation: "Observed", captured_at: "not-a-date" }]
  };
  const result = validate(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("parseable ISO 8601")));
});

test("generic audit report template exposes scope, findings, coverage, limits, and retest", () => {
  const report = fs.readFileSync(path.join(skill, "assets/audit-report.template.md"), "utf8");
  for (const heading of ["## 3. Scope", "## 6. Findings", "## 7. Profile Coverage", "## 9. Limitations And Residual Risk", "## 10. Remediation And Retest"]) {
    assert.ok(report.includes(heading), heading);
  }
});

test("criterion source must match the exact catalog record and automated profile passes are rejected", () => {
  const record = generateAssessment("web-modern", {
    targetName: "Generic target", targetVersion: "version-1", targetRefs: ["https://example.invalid/"], evaluator: "Auditor", evaluatedAt: "2026-07-12"
  });
  record.assessment.scope.included = ["https://example.invalid/"];
  record.assessment.evidence_level = "E2";
  record.assessment.claim.requested_tier = "evaluated_subset";
  record.assessment.claim.proposed_wording = registry.claim_templates.evaluated_subset[0];
  record.assessment.results[0] = {
    ...record.assessment.results[0],
    requirement_source: "https://www.w3.org/TR/WCAG22/#not-the-mapped-criterion",
    mapping_status: "human_verified",
    outcome: "pass",
    method_kind: "automated",
    evidence: [{ type: "automated_scan", location: "page", observation: "Tool pass", captured_at: "2026-07-12T12:00:00+09:00" }],
    notes: ""
  };
  const result = validate(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("catalog source")));
  assert.ok(result.errors.some((error) => error.includes("method_kind must be manual or hybrid")));
  assert.ok(result.errors.some((error) => error.includes("manual evidence type")));
});

test("evaluation coverage counts only evidence-backed human review", () => {
  const record = generateAssessment("web-modern", {
    targetName: "Generic target", targetVersion: "version-1", targetRefs: ["https://example.invalid/"], evaluator: "Auditor", evaluatedAt: "2026-07-12"
  });
  record.assessment.scope.included = ["https://example.invalid/"];
  for (const result of record.assessment.results) {
    result.mapping_status = "human_verified";
    result.outcome = "not_applicable";
    result.method_kind = "automated";
    result.notes = "Declared not applicable without manual evidence.";
  }
  const first = record.assessment.results[0];
  first.outcome = "pass";
  first.method_kind = "manual";
  first.evidence = [{ type: "manual_observation", location: "page", observation: "Observed", captured_at: "2026-07-12T12:00:00+09:00" }];
  const result = validate(record);
  assert.equal(result.valid, false);
  assert.equal(result.guard.evaluation_coverage.human_verified, 1);
  assert.equal(result.guard.evaluation_coverage.complete, false);
});

test("profile and screening outcome counts are separated", () => {
  const record = generateAssessment("web-modern", {
    targetName: "Generic target", targetVersion: "version-1", evaluator: "Auditor", evaluatedAt: "2026-07-12"
  });
  record.assessment.evidence_level = "E1";
  record.assessment.claim.requested_tier = "screened";
  record.assessment.claim.proposed_wording = registry.claim_templates.screened[0];
  record.assessment.results.push({
    requirement_id: "SCREEN-ARIA-ROLE-PERMITTED",
    requirement_kind: "screening_check",
    requirement_source: "https://www.w3.org/TR/html-aria/",
    mapping_status: "unverified",
    outcome: "pass",
    method_kind: "automated",
    method: "ARIA screening",
    evidence: [{ type: "automated_scan", location: "page", observation: "No candidate issue", captured_at: "2026-07-12T12:00:00+09:00" }],
    notes: "Supporting screening only."
  });
  const result = validate(record);
  assert.equal(result.valid, true);
  assert.equal(result.guard.profile_outcome_counts.pass, 0);
  assert.equal(result.guard.profile_outcome_counts.not_tested, 55);
  assert.equal(result.guard.screening_outcome_counts.pass, 1);
  assert.equal(result.guard.evaluation_coverage.not_tested, 55);
});

test("E3 requires recorded keyboard and assistive-technology evidence", () => {
  const record = generateAssessment("web-modern", {
    targetName: "Generic target", targetVersion: "version-1", targetRefs: ["https://example.invalid/"], evaluator: "Auditor", evaluatedAt: "2026-07-12"
  });
  record.assessment.scope.included = ["https://example.invalid/"];
  record.assessment.scope.full_pages_reviewed = true;
  record.assessment.scope.complete_processes = ["Submit form"];
  record.assessment.environment = { os: ["Windows"], browsers: ["Chrome"], assistive_technologies: ["NVDA"], input_modes: ["keyboard"] };
  record.assessment.evidence_level = "E3";
  record.assessment.claim.requested_tier = "evaluated_subset";
  record.assessment.claim.proposed_wording = registry.claim_templates.evaluated_subset[0];
  record.assessment.results[0] = {
    ...record.assessment.results[0], mapping_status: "human_verified", outcome: "pass", method_kind: "manual",
    evidence: [{ type: "manual_observation", location: "page", observation: "Visual observation", captured_at: "2026-07-12T12:00:00+09:00" }], notes: ""
  };
  const result = validate(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("keyboard_test")));
  assert.ok(result.errors.some((error) => error.includes("assistive_technology_test")));
});

test("CLI validator accepts a UTF-8 BOM assessment written on Windows", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-audit-bom-"));
  try {
    const record = generateAssessment("web-modern", {
      targetName: "Generic target", targetVersion: "version-1", evaluator: "Auditor", evaluatedAt: "2026-07-12"
    });
    const file = path.join(temp, "audit.json");
    fs.writeFileSync(file, `\uFEFF${JSON.stringify(record)}`, "utf8");
    const validator = path.join(skill, "scripts/validate-assessment.mjs");
    const run = spawnSync(process.execPath, [validator, file], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr || run.stdout);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("criterion pass must include evidence required by its routed playbook", () => {
  const record = generateAssessment("web-modern", {
    targetName: "Generic target", targetVersion: "version-1", targetRefs: ["https://example.invalid/"], evaluator: "Auditor", evaluatedAt: "2026-07-12"
  });
  record.assessment.scope.included = ["https://example.invalid/"];
  record.assessment.evidence_level = "E2";
  record.assessment.claim.requested_tier = "evaluated_subset";
  record.assessment.claim.proposed_wording = registry.claim_templates.evaluated_subset[0];
  const index = record.assessment.results.findIndex((result) => result.requirement_id === "WCAG-2.2-SC-2.1.1");
  record.assessment.results[index] = {
    ...record.assessment.results[index], mapping_status: "human_verified", outcome: "pass", method_kind: "manual",
    evidence: [{ type: "manual_observation", location: "page", observation: "Looked at the control", captured_at: "2026-07-12T12:00:00+09:00" }], notes: ""
  };
  const result = validate(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("playbook keyboard-operation")));
});

test("requirement lookup returns only the selected criterion and its method", () => {
  const result = lookupRequirement("web-modern", "WCAG-2.2-SC-2.1.1", skill);
  assert.equal(result.criterion.id, "WCAG-2.2-SC-2.1.1");
  assert.equal(result.audit_method.id, "keyboard-operation");
  assert.deepEqual(result.audit_method.required_evidence_types, ["keyboard_test"]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("WCAG-2.2-SC-1.1.1"), false);
  assert.ok(Buffer.byteLength(serialized, "utf8") < 8000);
});

test("Japanese legacy parsing lookup uses the dedicated playbook", () => {
  const result = lookupRequirement("jp-public-web", "JIS-X-8341-3-2016-SC-4.1.1", skill);
  assert.equal(result.audit_method.id, "parsing-legacy");
  assert.ok(result.audit_method.required_evidence_types.includes("document_structure_inspection"));
});

test("every active registered requirement resolves and profile mismatches are rejected", () => {
  for (const profile of registry.profiles.filter((item) => item.implementation_status === "active" && item.requirement_ids?.length)) {
    for (const requirementId of profile.requirement_ids) {
      const result = lookupRequirement(profile.id, requirementId, skill);
      assert.equal(result.criterion.id, requirementId);
      assert.equal(result.audit_method.id, result.criterion.method_key);
    }
  }
  assert.throws(
    () => lookupRequirement("web-modern", "JIS-X-8341-3-2016-SC-4.1.1", skill),
    /not registered for profile/
  );
  assert.throws(
    () => lookupRequirement("authoring-agent", "ATAG-2.0-B.1.1.1", skill),
    /does not have an active requirement catalog/
  );
});
