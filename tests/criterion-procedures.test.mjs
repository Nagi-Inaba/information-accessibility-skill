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

test("SC 2.1.1 exposes a scoped keyboard-only human review procedure", () => {
  const procedure = procedureFor("WCAG-2.2-SC-2.1.1");

  assert.equal(procedure.requirement_id, "WCAG-2.2-SC-2.1.1");
  assert.equal(procedure.procedure_kind, "human_manual_or_hybrid");
  assert.equal(procedure.automation_role, "supporting_only");
  assert.deepEqual(procedure.primary_sources, [
    "https://www.w3.org/TR/WCAG22/#keyboard",
    "https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html"
  ]);
  assert.ok(procedure.applicability_steps.some((step) => /fixed scope|interactive state/i.test(step)));
  assert.ok(procedure.procedure_steps.some((step) => /keyboard interface only|keyboard-only/i.test(step)));
  assert.ok(procedure.procedure_steps.some((step) => /keys|unreachable|path-dependent/i.test(step)));
  assert.ok(procedure.expected_results.some((result) => /keyboard interface|keystroke timing/i.test(result)));
  assert.deepEqual(procedure.required_evidence_types, ["keyboard_test", "manual_observation"]);
  assert.ok(procedure.cant_tell_when.some((condition) => /interactive runtime|required state|keyboard path/i.test(condition)));
  assert.equal(procedure.counterexamples.pass.length > 0, true);
  assert.equal(procedure.counterexamples.fail.length > 0, true);
  assert.equal(procedure.counterexamples.cant_tell.length > 0, true);
  assert.ok(procedure.procedure_steps.some((step) => /trap|character-key shortcut|focus visibility|separate/i.test(step)));
  assert.match(procedure.ai_boundary, /must not record a profile outcome/i);
});

test("SC 4.1.2 exposes a component semantics and change-exposure human review procedure", () => {
  const procedure = procedureFor("WCAG-2.2-SC-4.1.2");

  assert.equal(procedure.requirement_id, "WCAG-2.2-SC-4.1.2");
  assert.equal(procedure.procedure_kind, "human_manual_or_hybrid");
  assert.equal(procedure.automation_role, "supporting_only");
  assert.deepEqual(procedure.primary_sources, [
    "https://www.w3.org/TR/WCAG22/#name-role-value",
    "https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html"
  ]);
  assert.ok(procedure.applicability_steps.some((step) => /native|custom|component/i.test(step)));
  assert.ok(procedure.procedure_steps.some((step) => /DOM|accessibility tree/i.test(step)));
  assert.match(procedure.procedure_steps.join(" "), /before.*after/i);
  const programmaticSetStep = procedure.procedure_steps.find((step) =>
    /attempt.*programmatically set/i.test(step)
    && /assistive technology|accessibility API|accessibility interface/i.test(step)
  );
  assert.ok(programmaticSetStep, "SC 4.1.2 must attempt a programmatic set through an accessibility interface");
  assert.doesNotMatch(programmaticSetStep, /DOM mutation|script mutation|page script/i);
  assert.ok(procedure.procedure_steps.some((step) =>
    /before.*requested.*resulting.*after/i.test(step)
    && /value|state|property/i.test(step)
  ));
  assert.ok(procedure.expected_results.some((result) => /name|role/i.test(result)));
  assert.ok(procedure.expected_results.some((result) => /state|property|value|change/i.test(result)));
  assert.deepEqual(procedure.required_evidence_types, ["browser_inspection", "assistive_technology_test"]);
  assert.ok(procedure.cant_tell_when.some((condition) => /accessibility-tree exposure|component behavior|assistive-technology notification/i.test(condition)));
  assert.ok(procedure.cant_tell_when.some((condition) =>
    /assistive-technology|accessibility API|accessibility interface/i.test(condition)
    && /control path|programmatic set|set operation/i.test(condition)
  ));
  assert.equal(procedure.counterexamples.pass.length > 0, true);
  assert.equal(procedure.counterexamples.fail.length > 0, true);
  assert.equal(procedure.counterexamples.cant_tell.length > 0, true);
  assert.ok(procedure.counterexamples.pass.some((example) =>
    /programmatically set|set request/i.test(example)
    && /assistive technology|accessibility API|accessibility interface/i.test(example)
    && /notification|announced|exposed/i.test(example)
  ));
  assert.ok(procedure.counterexamples.fail.some((example) =>
    /notification|announced|exposed/i.test(example)
    && /cannot be programmatically set|rejects.*set request|set request.*fails/i.test(example)
  ));
  assert.ok(procedure.procedure_steps.some((step) => /4\.1\.3|status message|separate/i.test(step)));
  assert.match(procedure.ai_boundary, /must not record a profile outcome/i);
});

test("unimplemented criteria retain the generic playbook without a criterion-specific procedure", () => {
  const result = lookupRequirement("web-modern", "WCAG-2.2-SC-2.2.1", skill);
  assert.equal("criterion_procedure" in result, false);
  assert.equal(result.audit_method.id, "timing-and-motion");
});

test("lookup normalizes an available criterion procedure into an exact versioned queue binding", () => {
  const result = lookupRequirement("web-modern", "WCAG-2.2-SC-1.1.1", skill);
  assert.equal(result.lookup_version, "2.0.0");
  assert.deepEqual(result.procedure_binding, {
    procedure_availability: "available",
    procedure_ref: "criterion-procedures:1.0.0#wcag22-sc-1-1-1-non-text-content",
    generic_method_ref: null,
    official_sources: result.criterion_procedure.primary_sources,
    human_actions: result.criterion_procedure.procedure_steps,
    required_evidence_types: result.criterion_procedure.required_evidence_types,
    cant_tell_conditions: result.criterion_procedure.cant_tell_when
  });
});

test("lookup normalizes an unavailable criterion procedure into the exact generic method binding", () => {
  const result = lookupRequirement("web-modern", "WCAG-2.2-SC-2.2.1", skill);
  assert.equal(result.lookup_version, "2.0.0");
  assert.deepEqual(result.procedure_binding, {
    procedure_availability: "unavailable",
    procedure_ref: null,
    generic_method_ref: "web-audit-methods:1.0.0#timing-and-motion",
    official_sources: result.criterion.official_method_sources,
    human_actions: result.audit_method.procedure_steps,
    required_evidence_types: result.audit_method.required_evidence_types,
    cant_tell_conditions: [result.audit_method.cant_tell_when]
  });
});

test("lookup exposes exact versioned bindings sourced from both new criterion procedures", () => {
  const expectedRefs = new Map([
    ["WCAG-2.2-SC-2.1.1", "criterion-procedures:1.0.0#wcag22-sc-2-1-1-keyboard"],
    ["WCAG-2.2-SC-4.1.2", "criterion-procedures:1.0.0#wcag22-sc-4-1-2-name-role-value"]
  ]);

  for (const [requirementId, procedureRef] of expectedRefs) {
    const result = lookupRequirement("web-modern", requirementId, skill);
    assert.equal(result.criterion_procedure_status, "available", requirementId);
    assert.equal(result.lookup_version, "2.0.0", requirementId);
    assert.deepEqual(result.procedure_binding, {
      procedure_availability: "available",
      procedure_ref: procedureRef,
      generic_method_ref: null,
      official_sources: result.criterion_procedure.primary_sources,
      human_actions: result.criterion_procedure.procedure_steps,
      required_evidence_types: result.criterion_procedure.required_evidence_types,
      cant_tell_conditions: result.criterion_procedure.cant_tell_when
    }, requirementId);
  }
});
