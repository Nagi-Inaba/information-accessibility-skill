import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(fs.readFileSync(path.join(root, "codex/skills/information-accessibility-practice/references/standards-registry.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(root, "codex/skills/information-accessibility-practice/references/assessment-record.schema.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(root, "codex/skills/information-accessibility-practice/references/criteria-catalog.json"), "utf8"));
const auditMethods = JSON.parse(fs.readFileSync(path.join(root, "codex/skills/information-accessibility-practice/references/web-audit-methods.json"), "utf8"));
const template = JSON.parse(fs.readFileSync(path.join(root, "codex/skills/information-accessibility-practice/assets/assessment-record.template.json"), "utf8"));

function record() {
  const value = structuredClone(template);
  value.assessment.target.name = "Example application";
  value.assessment.target.version_or_commit = "abc123";
  value.assessment.target.urls_or_files = ["https://example.invalid/"];
  value.assessment.scope.included = ["https://example.invalid/"];
  value.assessment.evaluator = "Accessibility reviewer";
  value.assessment.evaluated_at = "2026-07-12";
  return value;
}

function evidence(type = "manual_observation") {
  return [{
    type,
    location: "https://example.invalid/#main",
    observation: "Observed result",
    captured_at: "2026-07-12T12:00:00+09:00"
  }];
}

function profileResult(overrides = {}) {
  return {
    requirement_id: "WCAG-2.2-SC-1.1.1",
    requirement_kind: "profile_requirement",
    requirement_source: "https://www.w3.org/TR/WCAG22/#non-text-content",
    mapping_status: "human_verified",
    outcome: "pass",
    method_kind: "manual",
    method_ref: "web-audit-methods:1.0.0#non-text-content",
    method: "manual criterion review",
    evidence: evidence(),
    notes: "",
    ...overrides
  };
}

function screeningResult(overrides = {}) {
  return {
    requirement_id: "SCREEN-AXE-SERIOUS",
    requirement_kind: "screening_check",
    requirement_source: "",
    mapping_status: "unverified",
    outcome: "cant_tell",
    method_kind: "automated",
    method: "automated axe screening",
    evidence: evidence("automated_scan"),
    notes: "Automated screening does not determine the requirement outcome.",
    ...overrides
  };
}

function validate(value) {
  return validateAssessment(value, registry, schema, catalog, auditMethods);
}

test("reference-only template shape passes with placeholders replaced", () => {
  const result = validate(record());
  assert.equal(result.valid, true);
  assert.equal(result.guard.max_tier, "reference_only");
});

test("E1 evidence can be screened", () => {
  const value = record();
  value.assessment.evidence_level = "E1";
  value.assessment.claim.requested_tier = "screened";
  value.assessment.claim.proposed_wording = registry.claim_templates.screened[0];
  value.assessment.results = [screeningResult()];
  const result = validate(value);
  assert.equal(result.valid, true);
  assert.equal(result.guard.max_tier, "screened");
});

test("not_tested blocks conformance requests", () => {
  const value = record();
  value.assessment.evidence_level = "E2";
  value.assessment.claim.requested_tier = "conformance_candidate";
  value.assessment.results = [profileResult({ requirement_id: "WCAG-2.2-SC-1.2.1", outcome: "not_tested", evidence: [], notes: "Awaiting media review" })];
  const result = validate(value);
  assert.equal(result.valid, false);
  assert.ok(result.guard.blocking_outcomes.includes("not_tested"));
});

test("method-incomplete profile cannot become a conformance candidate", () => {
  const value = record();
  value.assessment.evidence_level = "E3";
  value.assessment.scope.full_pages_reviewed = true;
  value.assessment.scope.complete_processes = ["Submit form"];
  value.assessment.environment.os = ["Windows 11"];
  value.assessment.environment.browsers = ["Chrome"];
  value.assessment.environment.assistive_technologies = ["NVDA"];
  value.assessment.environment.input_modes = ["keyboard"];
  value.assessment.claim.requested_tier = "conformance_candidate";
  value.assessment.results = [profileResult()];
  const result = validate(value);
  assert.equal(result.valid, false);
  assert.equal(result.guard.max_tier, "evaluated_subset");
});

test("not_applicable requires a rationale", () => {
  const value = record();
  value.assessment.evidence_level = "E2";
  value.assessment.claim.requested_tier = "evaluated_subset";
  value.assessment.results = [profileResult({ requirement_id: "WCAG-2.2-SC-1.2.4", outcome: "not_applicable", evidence: [], notes: "" })];
  const result = validate(value);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("must explain not_applicable")));
});

test("pass requires evidence", () => {
  const value = record();
  value.assessment.evidence_level = "E2";
  value.assessment.claim.requested_tier = "evaluated_subset";
  value.assessment.results = [profileResult({ requirement_id: "WCAG-2.2-SC-2.1.1", evidence: [] })];
  const result = validate(value);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("evidence is required for pass")));
});

test("prohibited certification wording is rejected", () => {
  const value = record();
  value.assessment.claim.proposed_wording = "W3C certified";
  const result = validate(value);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("prohibited claim")));
});

test("positive conformance wording is rejected above the profile ceiling", () => {
  const value = record();
  value.assessment.evidence_level = "E2";
  value.assessment.claim.requested_tier = "evaluated_subset";
  value.assessment.claim.proposed_wording = "The target conforms to WCAG 2.2 at Level AA.";
  value.assessment.results = [profileResult()];
  const result = validate(value);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("formal conformance determination term")));
});

test("formal determination terms are blocked throughout the method-incomplete release", () => {
  for (const wording of [
    "WCAG 2.2 AA 準拠",
    "JIS X 8341-3:2016 AA準拠",
    "WCAG 2.2 AA compliant",
    "The target is WCAG 2.2 AA conformant.",
    "The target does not conform to WCAG 2.2 AA.",
    "Fully meets WCAG 2.2 Level AA.",
    "WCAG 2.2 AA compliance verified.",
    "WCAG 2.2 AA conformance verified.",
    "W3C-certified.",
    "JIS 認証済み.",
    "Profile-informed guidance: the target achieves WCAG 2.2 Level AA.",
    "参考: WCAG 2.2 AAを達成済み"
  ]) {
    const value = record();
    value.assessment.claim.proposed_wording = wording;
    const result = validate(value);
    assert.equal(result.valid, false, wording);
    assert.ok(result.errors.some((error) => error.includes("formal conformance determination term") || error.includes("must exactly match")), wording);
  }
});

test("E4 cannot be self-declared without independent audit evidence", () => {
  const value = record();
  value.assessment.evidence_level = "E4";
  value.assessment.scope.full_pages_reviewed = true;
  value.assessment.scope.complete_processes = ["Submit form"];
  value.assessment.environment.os = ["Windows 11"];
  value.assessment.environment.browsers = ["Chrome"];
  value.assessment.environment.assistive_technologies = ["NVDA"];
  value.assessment.environment.input_modes = ["keyboard"];
  value.assessment.claim.requested_tier = "evaluated_subset";
  value.assessment.results = [profileResult()];
  const result = validate(value);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("independent evaluator")));
});

test("schema validation rejects missing fields, extra properties, and wrong array item types", () => {
  for (const mutate of [
    (value) => { delete value.assessment.evaluator; },
    (value) => { delete value.assessment.limitations; },
    (value) => { value.assessment.unexpected = true; },
    (value) => { value.assessment.scope.included = [42]; }
  ]) {
    const value = record();
    mutate(value);
    assert.equal(validate(value).valid, false);
  }
});

test("E2 rejects arbitrary identifiers and automated-only evidence", () => {
  const value = record();
  value.assessment.evidence_level = "E2";
  value.assessment.claim.requested_tier = "evaluated_subset";
  value.assessment.results = [screeningResult({ requirement_id: "NOT-A-REAL-WCAG-ID" })];
  const result = validate(value);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("must start with SCREEN-") || error.includes("human-verified profile requirement")));
});

test("E2 rejects fake IDs, a different W3C document, and machine-only evidence", () => {
  const value = record();
  value.assessment.evidence_level = "E2";
  value.assessment.claim.requested_tier = "evaluated_subset";
  value.assessment.results = [profileResult({
    requirement_id: "WCAG-2.2-SC-4.99.99",
    requirement_source: "https://www.w3.org/TR/ATAG20/",
    method_kind: "automated",
    method: "AI criterion review",
    evidence: evidence("automated_scan")
  })];
  const result = validate(value);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("is not registered")));
  assert.ok(result.errors.some((error) => error.includes("registered source document")));
  assert.ok(result.errors.some((error) => error.includes("human-verified profile requirement")));
});

test("registered source matching rejects normalized dot-segment escapes", () => {
  const value = record();
  value.assessment.evidence_level = "E2";
  value.assessment.claim.requested_tier = "evaluated_subset";
  value.assessment.results = [profileResult({
    requirement_source: "https://www.w3.org/TR/WCAG22/../ATAG20/"
  })];
  const result = validate(value);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("registered source document")));
});

test("E5 rejects empty dossier artifacts", () => {
  const value = record();
  value.assessment.evidence_level = "E5";
  value.assessment.scope.full_pages_reviewed = true;
  value.assessment.scope.complete_processes = ["Submit form"];
  value.assessment.environment.os = ["Windows 11"];
  value.assessment.environment.browsers = ["Chrome"];
  value.assessment.environment.assistive_technologies = ["NVDA"];
  value.assessment.environment.input_modes = ["keyboard"];
  value.assessment.assurance.independent_audit = {
    performed: true,
    evaluator_independent: true,
    scope_method: "Independent representative sample",
    report_location: "https://example.invalid/audit"
  };
  value.assessment.assurance.legal_or_procurement_dossier = {
    prepared: true,
    responsible_owner: "Procurement owner",
    artifacts: [""]
  };
  value.assessment.claim.requested_tier = "evaluated_subset";
  value.assessment.results = [profileResult()];
  const result = validate(value);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("dossier artifact") || error.includes("must not be empty")));
});

test("registered requirement ID catalogs have expected unique counts", () => {
  const web = registry.profiles.find((profile) => profile.id === "web-modern");
  const jp = registry.profiles.find((profile) => profile.id === "jp-public-web");
  assert.equal(web.requirement_ids.length, 55);
  assert.equal(new Set(web.requirement_ids).size, 55);
  assert.equal(jp.requirement_ids.length, 56);
  assert.equal(new Set(jp.requirement_ids).size, 56);
});

test("a manually mapped subset record can reach evaluated_subset with bounded wording", () => {
  const value = record();
  value.assessment.evidence_level = "E2";
  value.assessment.claim.requested_tier = "evaluated_subset";
  value.assessment.claim.proposed_wording = registry.claim_templates.evaluated_subset[0];
  value.assessment.results = [profileResult()];
  const result = validate(value);
  assert.equal(result.valid, true);
  assert.equal(result.guard.max_tier, "evaluated_subset");
});
