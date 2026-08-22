import assert from "node:assert/strict";
import test from "node:test";
import { analyzeScreeningMappings, normalizeScreeningMappings } from "../codex/skills/information-accessibility-practice/scripts/lib/screening-mappings.mjs";

test("one observed barrier maps to multiple profile requirements without increasing the barrier count", () => {
  const result = analyzeScreeningMappings([{
    requirement_id: "SCREEN-DIALOG-NAME",
    location: "Checkout dialog",
    observation: "The dialog name is missing and the visible heading is not programmatically associated.",
    evidence_level: "E1",
    profile_mappings: [
      { requirement_id: "WCAG-2.2-SC-1.3.1", applicability: "applicable", report_outcome: "fail", rationale: "The visual heading relationship is not exposed." },
      { requirement_id: "WCAG-2.2-SC-4.1.2", applicability: "applicable", report_outcome: "fail", rationale: "The dialog has no programmatic name." }
    ]
  }]);
  assert.equal(result.barrier_count, 1);
  assert.equal(result.mapping_count, 2);
  assert.equal(result.requirement_count, 2);
  assert.equal(result.conflicts.length, 0);
});

test("legacy single mapping observations normalize into the new array shape", () => {
  const normalized = normalizeScreeningMappings({
    requirement_id: "SCREEN-FOCUS",
    profile_requirement_id: "WCAG-2.2-SC-2.4.7",
    applicability: "applicable",
    report_outcome: "cant_tell",
    report_rationale: "Runtime focus visibility requires human confirmation."
  });
  assert.equal(normalized.profile_mappings.length, 1);
  assert.equal(normalized.profile_mappings[0].requirement_id, "WCAG-2.2-SC-2.4.7");
});

test("contradictory mappings are retained as explicit conflicts for human adjudication", () => {
  const result = analyzeScreeningMappings([
    {
      requirement_id: "SCREEN-A",
      profile_mappings: [{ requirement_id: "WCAG-2.2-SC-1.1.1", applicability: "applicable", report_outcome: "pass", rationale: "Candidate alternative is present." }]
    },
    {
      requirement_id: "SCREEN-B",
      profile_mappings: [{ requirement_id: "WCAG-2.2-SC-1.1.1", applicability: "applicable", report_outcome: "fail", rationale: "The alternative does not convey the chart trend." }]
    }
  ]);
  assert.equal(result.needs_human_adjudication, true);
  assert.deepEqual(result.conflicts[0].conflict_types, ["report_outcome"]);
  assert.deepEqual(result.conflicts[0].observation_ids, ["SCREEN-A", "SCREEN-B"]);
});

test("duplicate requirement mappings inside one observation fail closed", () => {
  assert.throws(() => normalizeScreeningMappings({
    requirement_id: "SCREEN-DUP",
    profile_mappings: [
      { requirement_id: "WCAG-2.2-SC-2.1.1", applicability: "applicable", report_outcome: "fail", rationale: "A" },
      { requirement_id: "WCAG-2.2-SC-2.1.1", applicability: "applicable", report_outcome: "fail", rationale: "B" }
    ]
  }), /duplicate profile requirement mappings/u);
});
