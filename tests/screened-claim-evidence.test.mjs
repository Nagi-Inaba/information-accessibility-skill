import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "codex/skills/information-accessibility-practice");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(skill, relative), "utf8"));
const registry = readJson("references/standards-registry.json");
const schema = readJson("references/assessment-record.schema.json");
const catalog = readJson("references/criteria-catalog.json");
const methods = readJson("references/web-audit-methods.json");

function baseline() {
  const record = generateAssessment("web-modern", {
    targetName: "Screening fixture",
    targetVersion: "v1",
    targetRefs: ["https://example.invalid/"],
    evaluator: "Reviewer",
    evaluatedAt: "2026-08-21"
  });
  record.assessment.scope.included = ["https://example.invalid/"];
  record.assessment.evidence_level = "E1";
  record.assessment.claim.requested_tier = "screened";
  record.assessment.claim.proposed_wording = registry.claim_templates.screened[0];
  return record;
}

function targetEvidence() {
  return {
    type: "automated_scan",
    location: "https://example.invalid/",
    observation: "A target-specific screening result was recorded.",
    captured_at: "2026-08-21T00:00:00Z"
  };
}

function screeningResult(evidence) {
  return {
    requirement_id: "SCREEN-EVIDENCE-GUARD",
    requirement_kind: "screening_check",
    requirement_source: "",
    mapping_status: "unverified",
    outcome: "cant_tell",
    method_kind: "automated",
    method: "Target-specific screening",
    evidence,
    notes: "Supporting screening only."
  };
}

function validate(record) {
  return validateAssessment(record, registry, schema, catalog, methods);
}

test("screened claims require a screening row with target-specific evidence", () => {
  const withoutScreening = validate(baseline());
  assert.equal(withoutScreening.valid, false);
  assert.equal(withoutScreening.guard.max_tier, "reference_only");
  assert.ok(withoutScreening.errors.some((error) => error.includes("screening_check with target-specific evidence")));

  const profileEvidenceRecord = baseline();
  profileEvidenceRecord.assessment.results[0].evidence = [targetEvidence()];
  const profileEvidence = validate(profileEvidenceRecord);
  assert.equal(profileEvidence.valid, false);
  assert.equal(profileEvidence.guard.max_tier, "reference_only");

  const emptyEvidenceRecord = baseline();
  emptyEvidenceRecord.assessment.results.push(screeningResult([]));
  const emptyEvidence = validate(emptyEvidenceRecord);
  assert.equal(emptyEvidence.valid, false);
  assert.equal(emptyEvidence.guard.max_tier, "reference_only");

  const evidencedRecord = baseline();
  evidencedRecord.assessment.results.push(screeningResult([targetEvidence()]));
  const evidenced = validate(evidencedRecord);
  assert.equal(evidenced.valid, true, evidenced.errors.join("\n"));
  assert.equal(evidenced.guard.max_tier, "screened");
});
