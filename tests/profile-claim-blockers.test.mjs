import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyClaimBlockers,
  validateAssessment
} from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "codex/skills/information-accessibility-practice");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(skill, relative), "utf8"));
const registry = readJson("references/standards-registry.json");
const schema = readJson("references/assessment-record.schema.json");
const catalog = readJson("references/criteria-catalog.json");
const methods = readJson("references/web-audit-methods.json");
const template = readJson("assets/assessment-record.template.json");

function zeroCounts() {
  return { pass: 0, fail: 0, not_applicable: 0, not_tested: 0, cant_tell: 0 };
}

function screeningResult(outcome = "cant_tell") {
  return {
    requirement_id: "SCREEN-CLAIM-CANDIDATE",
    requirement_kind: "screening_check",
    requirement_source: "",
    mapping_status: "unverified",
    outcome,
    method_kind: "automated",
    method: "Target-specific automated screening",
    evidence: [{
      type: "automated_scan",
      location: "https://example.invalid/",
      observation: "A supporting candidate was recorded.",
      captured_at: "2026-08-22T00:00:00Z"
    }],
    notes: "Supporting screening only."
  };
}

test("screening candidates do not become formal profile blockers", () => {
  const summary = classifyClaimBlockers({
    profileOutcomeCounts: { ...zeroCounts(), pass: 55 },
    missingRequirementIds: [],
    screeningResults: [screeningResult()]
  });

  assert.deepEqual(summary.profile_blocking_outcomes, []);
  assert.deepEqual(summary.screening_open_candidates, ["SCREEN-CLAIM-CANDIDATE"]);
});

test("missing and failed profile requirements remain formal blockers", () => {
  const missing = classifyClaimBlockers({
    profileOutcomeCounts: { ...zeroCounts(), pass: 54 },
    missingRequirementIds: ["WCAG-2.2-SC-4.1.3"],
    screeningResults: []
  });
  assert.deepEqual(missing.profile_blocking_outcomes, ["not_tested"]);

  const failed = classifyClaimBlockers({
    profileOutcomeCounts: { ...zeroCounts(), pass: 54, fail: 1 },
    missingRequirementIds: [],
    screeningResults: [screeningResult("fail")]
  });
  assert.deepEqual(failed.profile_blocking_outcomes, ["fail"]);
  assert.deepEqual(failed.screening_open_candidates, ["SCREEN-CLAIM-CANDIDATE"]);
});

test("validator exposes formal blockers and screening candidates separately", () => {
  const record = structuredClone(template);
  record.assessment.target.name = "Claim blocker fixture";
  record.assessment.target.version_or_commit = "v1.0.0";
  record.assessment.target.urls_or_files = ["https://example.invalid/"];
  record.assessment.scope.included = ["https://example.invalid/"];
  record.assessment.evaluator = "Reviewer";
  record.assessment.evaluated_at = "2026-08-22";
  record.assessment.evidence_level = "E1";
  record.assessment.claim.requested_tier = "screened";
  record.assessment.claim.proposed_wording = registry.claim_templates.screened[0];
  record.assessment.results = [screeningResult()];

  const result = validateAssessment(record, registry, schema, catalog, methods);
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.deepEqual(result.guard.profile_blocking_outcomes, ["not_tested"]);
  assert.deepEqual(result.guard.blocking_outcomes, result.guard.profile_blocking_outcomes);
  assert.deepEqual(result.guard.screening_open_candidates, ["SCREEN-CLAIM-CANDIDATE"]);
  assert.equal(result.guard.screening_outcome_counts.cant_tell, 1);
  assert.equal(result.guard.max_tier, "screened");
});
