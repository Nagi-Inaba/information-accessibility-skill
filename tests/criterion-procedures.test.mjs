import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { lookupRequirement } from "../codex/skills/information-accessibility-practice/scripts/show-requirement.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "codex/skills/information-accessibility-practice");

function procedureFor(requirementId) {
  const result = lookupRequirement("web-modern", requirementId, skill);
  assert.ok(result.criterion_procedure, `${requirementId} must expose a criterion-specific procedure`);
  return result.criterion_procedure;
}

test("SC 1.1.1 exposes a human review procedure with pass, fail, and cant_tell counterexamples", () => {
  const procedure = procedureFor("WCAG-2.2-SC-1.1.1");

  assert.equal(procedure.requirement_id, "WCAG-2.2-SC-1.1.1");
  assert.equal(procedure.procedure_kind, "human_manual_or_hybrid");
  assert.equal(procedure.automation_role, "supporting_only");
  assert.ok(procedure.primary_sources.includes("https://www.w3.org/TR/WCAG22/#non-text-content"));
  assert.ok(procedure.applicability_steps.some((step) => /informative|functional|decorative/i.test(step)));
  assert.ok(procedure.expected_results.some((result) => /equivalent purpose|ignored by assistive technology/i.test(result)));
  assert.ok(procedure.required_evidence_types.includes("manual_observation"));
  assert.equal(procedure.counterexamples.pass.length > 0, true);
  assert.equal(procedure.counterexamples.fail.length > 0, true);
  assert.equal(procedure.counterexamples.cant_tell.length > 0, true);
  assert.ok(procedure.cant_tell_when.some((condition) => /purpose|context|computed/i.test(condition)));
  assert.match(procedure.ai_boundary, /must not record a profile outcome/i);
});

test("SC 1.3.1 exposes a human review procedure with pass, fail, and cant_tell counterexamples", () => {
  const procedure = procedureFor("WCAG-2.2-SC-1.3.1");

  assert.equal(procedure.requirement_id, "WCAG-2.2-SC-1.3.1");
  assert.equal(procedure.procedure_kind, "human_manual_or_hybrid");
  assert.equal(procedure.automation_role, "supporting_only");
  assert.ok(procedure.primary_sources.includes("https://www.w3.org/TR/WCAG22/#info-and-relationships"));
  assert.ok(procedure.applicability_steps.some((step) => /visual|auditory|presentation/i.test(step)));
  assert.ok(procedure.expected_results.some((result) => /programmatically determined|available in text/i.test(result)));
  assert.ok(procedure.required_evidence_types.includes("browser_inspection"));
  assert.equal(procedure.counterexamples.pass.length > 0, true);
  assert.equal(procedure.counterexamples.fail.length > 0, true);
  assert.equal(procedure.counterexamples.cant_tell.length > 0, true);
  assert.ok(procedure.cant_tell_when.some((condition) => /relationship|linearized|accessibility tree/i.test(condition)));
  assert.match(procedure.ai_boundary, /must not record a profile outcome/i);
});

test("unimplemented criteria retain the generic playbook without a criterion-specific procedure", () => {
  const result = lookupRequirement("web-modern", "WCAG-2.2-SC-2.1.1", skill);
  assert.equal("criterion_procedure" in result, false);
  assert.equal(result.audit_method.id, "keyboard-operation");
});
