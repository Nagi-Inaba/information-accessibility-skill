import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { lookupRequirement } from "../codex/skills/information-accessibility-practice/scripts/show-requirement.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "codex/skills/information-accessibility-practice");
const proceduresPath = path.join(skill, "references", "criterion-procedures.json");
const procedures = JSON.parse(fs.readFileSync(proceduresPath, "utf8"));

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

test("SC 3.1.1 exposes a human review procedure with pass, fail, and cant_tell counterexamples", () => {
  const procedure = procedureFor("WCAG-2.2-SC-3.1.1");

  assert.equal(procedure.requirement_id, "WCAG-2.2-SC-3.1.1");
  assert.equal(procedure.procedure_kind, "human_manual_or_hybrid");
  assert.equal(procedure.automation_role, "supporting_only");
  assert.ok(procedure.primary_sources.includes("https://www.w3.org/TR/WCAG22/#language-of-page"));
  assert.ok(procedure.applicability_steps.some((step) => /default human language|page-level language/i.test(step)));
  assert.match(procedure.applicability_steps.join(" "), /separate SC 3\.1\.2/i);
  assert.ok(procedure.expected_results.some((result) => /language|announcement|decla/i.test(result)));
  assert.ok(procedure.required_evidence_types.includes("browser_inspection"));
  assert.ok(procedure.required_evidence_types.includes("manual_observation"));
  assert.equal(procedure.counterexamples.pass.length > 0, true);
  assert.equal(procedure.counterexamples.fail.length > 0, true);
  assert.equal(procedure.counterexamples.cant_tell.length > 0, true);
  assert.ok(procedure.cant_tell_when.some((condition) => /programmatic|language|dynamic/i.test(condition)));
  assert.match(procedure.ai_boundary, /must not record a profile outcome/i);
});

test("SC 2.4.1 exposes a mechanism-neutral manual review procedure with pass, fail, and cant_tell counterexamples", () => {
  const procedure = procedureFor("WCAG-2.2-SC-2.4.1");

  assert.equal(procedure.requirement_id, "WCAG-2.2-SC-2.4.1");
  assert.equal(procedure.procedure_kind, "human_manual_or_hybrid");
  assert.equal(procedure.automation_role, "supporting_only");
  assert.ok(procedure.primary_sources.includes("https://www.w3.org/TR/WCAG22/#bypass-blocks"));
  assert.ok(procedure.applicability_steps.some((step) => /repeat|page set|page|template/i.test(step)));
  assert.ok(procedure.procedure_steps.some((step) => /skip|heading|region|bypass/i.test(step)));
  assert.match(procedure.procedure_steps.join(" "), /do not require a skip link/i);
  assert.ok(procedure.expected_results.some((result) => /bypass|focus|content/i.test(result)));
  assert.ok(procedure.required_evidence_types.includes("browser_inspection"));
  assert.ok(procedure.required_evidence_types.includes("manual_observation"));
  assert.equal(procedure.required_evidence_types.includes("keyboard_test"), false);
  assert.equal(procedure.counterexamples.pass.length > 0, true);
  assert.equal(procedure.counterexamples.fail.length > 0, true);
  assert.equal(procedure.counterexamples.cant_tell.length > 0, true);
  assert.ok(procedure.cant_tell_when.some((condition) => /navigation mode|page set|repeat/i.test(condition)));
  assert.match(procedure.ai_boundary, /must not record a profile outcome/i);
});

test("SC 3.3.2 exposes a human review procedure with pass, fail, and cant_tell counterexamples", () => {
  const procedure = procedureFor("WCAG-2.2-SC-3.3.2");

  assert.equal(procedure.requirement_id, "WCAG-2.2-SC-3.3.2");
  assert.equal(procedure.procedure_kind, "human_manual_or_hybrid");
  assert.equal(procedure.automation_role, "supporting_only");
  assert.ok(procedure.primary_sources.includes("https://www.w3.org/TR/WCAG22/#labels-or-instructions"));
  assert.ok(procedure.applicability_steps.some((step) => /control|instruction|placeholder|format/i.test(step)));
  assert.ok(procedure.procedure_steps.some((step) => /label|instruction|error|format/i.test(step)));
  assert.match(procedure.procedure_steps.join(" "), /separate evidence for SC 1\.3\.1.*SC 4\.1\.2/i);
  assert.ok(procedure.expected_results.some((result) => /instruction|label|format|available/i.test(result)));
  assert.ok(procedure.required_evidence_types.includes("browser_inspection"));
  assert.ok(procedure.required_evidence_types.includes("manual_observation"));
  assert.equal(procedure.counterexamples.pass.length > 0, true);
  assert.equal(procedure.counterexamples.fail.length > 0, true);
  assert.equal(procedure.counterexamples.cant_tell.length > 0, true);
  assert.ok(procedure.cant_tell_when.some((condition) => /control|placeholder|metadata|state/i.test(condition)));
  assert.match(procedure.ai_boundary, /must not record a profile outcome/i);
});

test("SC 1.4.4 exposes a human review procedure with pass, fail, and cant_tell counterexamples", () => {
  const procedure = procedureFor("WCAG-2.2-SC-1.4.4");

  assert.equal(procedure.requirement_id, "WCAG-2.2-SC-1.4.4");
  assert.equal(procedure.procedure_kind, "human_manual_or_hybrid");
  assert.equal(procedure.automation_role, "supporting_only");
  assert.ok(procedure.primary_sources.includes("https://www.w3.org/TR/WCAG22/#resize-text"));
  assert.ok(procedure.applicability_steps.some((step) => /text size|viewport|overflow|reflow|scal/i.test(step)));
  assert.ok(procedure.procedure_steps.some((step) => /zoom|text size|reflow|overflow|clipping/i.test(step)));
  assert.match(procedure.procedure_steps.join(" "), /not automatic failures.*criterion/i);
  assert.match(procedure.procedure_steps.join(" "), /SC 1\.4\.10/i);
  assert.ok(procedure.expected_results.some((result) => /reduced|readable|overlap|clipping|usable/i.test(result)));
  assert.ok(procedure.required_evidence_types.includes("browser_inspection"));
  assert.ok(procedure.required_evidence_types.includes("manual_observation"));
  assert.equal(procedure.counterexamples.pass.length > 0, true);
  assert.equal(procedure.counterexamples.fail.length > 0, true);
  assert.equal(procedure.counterexamples.cant_tell.length > 0, true);
  assert.ok(procedure.cant_tell_when.some((condition) => /zoom|scale|renderer|inspection/i.test(condition)));
  assert.match(procedure.ai_boundary, /must not record a profile outcome/i);
});

test("catalog procedures include the expected unique requirement IDs", () => {
  const requirementIds = procedures.procedures.map((procedure) => procedure.requirement_id);
  const unique = new Set(requirementIds);
  const expected = new Set([
    "WCAG-2.2-SC-1.1.1",
    "WCAG-2.2-SC-1.3.1",
    "WCAG-2.2-SC-3.1.1",
    "WCAG-2.2-SC-2.4.1",
    "WCAG-2.2-SC-3.3.2",
    "WCAG-2.2-SC-1.4.4",
    "WCAG-2.2-SC-2.1.1",
    "WCAG-2.2-SC-4.1.2",
    "WCAG-2.2-SC-2.4.11",
    "WCAG-2.2-SC-3.3.1",
    "WCAG-2.2-SC-1.4.10",
    "WCAG-2.2-SC-4.1.3",
    "WCAG-2.2-SC-2.4.3",
    "WCAG-2.2-SC-2.4.7",
    "WCAG-2.2-SC-2.1.2",
    "WCAG-2.2-SC-3.3.3",
    "WCAG-2.2-SC-1.4.3",
    "WCAG-2.2-SC-1.4.11",
    "WCAG-2.2-SC-1.4.1",
    "WCAG-2.2-SC-3.3.4",
    "WCAG-2.2-SC-3.3.7"
  ]);

  assert.equal(requirementIds.length, procedures.procedures.length);
  assert.equal(unique.size, procedures.procedures.length);
  assert.ok(unique.size >= 21);
  for (const req of expected) {
    assert.equal(unique.has(req), true, `missing requirement ${req}`);
  }
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

test("focus order and visibility require observed keyboard paths and remain separate", () => {
  const order = procedureFor("WCAG-2.2-SC-2.4.3");
  const visible = procedureFor("WCAG-2.2-SC-2.4.7");
  for (const procedure of [order, visible]) {
    assert.deepEqual(procedure.required_evidence_types, ["keyboard_test", "manual_observation"]);
    assert.equal(procedure.primary_sources.length, 2);
    assert.ok(procedure.counterexamples.cant_tell.length > 0);
  }
  assert.match(order.procedure_steps.join(" "), /visual or DOM order/u);
  assert.match(visible.procedure_steps.join(" "), /indicator persists/u);
});

test("SC 2.1.2 checks keyboard exit from contained focus without treating every modal cycle as a trap", () => {
  const procedure = procedureFor("WCAG-2.2-SC-2.1.2");
  assert.deepEqual(procedure.primary_sources, [
    "https://www.w3.org/TR/WCAG22/#no-keyboard-trap",
    "https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html"
  ]);
  assert.deepEqual(procedure.required_evidence_types, ["keyboard_test", "manual_observation"]);
  assert.match(procedure.applicability_steps.join(" "), /not by itself a failure/u);
  assert.match(procedure.procedure_steps.join(" "), /nonstandard key sequence.*advised/u);
  assert.match(procedure.procedure_steps.join(" "), /SC 2\.1\.1.*SC 2\.4\.3/u);
  assert.ok(procedure.counterexamples.pass.length && procedure.counterexamples.fail.length && procedure.counterexamples.cant_tell.length);
  assert.match(procedure.ai_boundary, /must not infer a profile outcome/u);
});

test("SC 3.3.3 requires known safe correction guidance after an automatically detected error", () => {
  const procedure = procedureFor("WCAG-2.2-SC-3.3.3");
  assert.deepEqual(procedure.primary_sources, [
    "https://www.w3.org/TR/WCAG22/#error-suggestion",
    "https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html"
  ]);
  assert.deepEqual(procedure.required_evidence_types, ["browser_inspection", "manual_observation"]);
  assert.match(procedure.applicability_steps.join(" "), /automatically detected.*security or content-purpose/u);
  assert.match(procedure.procedure_steps.join(" "), /do not treat every sensitive form as exempt/u);
  assert.match(procedure.procedure_steps.join(" "), /SC 3\.3\.1.*SC 3\.3\.2.*SC 3\.3\.4/u);
  assert.ok(procedure.counterexamples.pass.length && procedure.counterexamples.fail.length && procedure.counterexamples.cant_tell.length);
  assert.match(procedure.ai_boundary, /must not decide whether an exception applies/u);
});

test("SC 1.4.3 checks unrounded text contrast with large-text and incidental exceptions", () => {
  const procedure = procedureFor("WCAG-2.2-SC-1.4.3");
  assert.deepEqual(procedure.primary_sources, [
    "https://www.w3.org/TR/WCAG22/#contrast-minimum",
    "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html"
  ]);
  assert.deepEqual(procedure.required_evidence_types, ["browser_inspection", "manual_observation"]);
  assert.match(procedure.applicability_steps.join(" "), /placeholder.*hover.*keyboard focus/u);
  assert.match(procedure.procedure_steps.join(" "), /unrounded ratio.*4\.5:1.*3:1.*equivalent CJK sizing/u);
  assert.match(procedure.procedure_steps.join(" "), /SC 1\.4\.11/u);
  assert.match(procedure.counterexamples.fail.join(" "), /4\.49:1/u);
  assert.ok(procedure.cant_tell_when.length && procedure.counterexamples.pass.length && procedure.counterexamples.cant_tell.length);
});

test("SC 1.4.11 limits non-text contrast review to required visual information", () => {
  const procedure = procedureFor("WCAG-2.2-SC-1.4.11");
  assert.deepEqual(procedure.primary_sources, [
    "https://www.w3.org/TR/WCAG22/#non-text-contrast",
    "https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html"
  ]);
  assert.deepEqual(procedure.required_evidence_types, ["browser_inspection", "manual_observation"]);
  assert.match(procedure.procedure_steps.join(" "), /boundary need not be tested.*SC 1\.4\.3.*3:1.*parts needed to understand/u);
  assert.match(procedure.procedure_steps.join(" "), /inactive component.*unmodified by the author.*nonadjacent states/u);
  assert.ok(procedure.cant_tell_when.length && procedure.counterexamples.fail.length);
});

test("SC 1.4.1 requires a visible way to understand author-defined color cues", () => {
  const procedure = procedureFor("WCAG-2.2-SC-1.4.1");
  assert.deepEqual(procedure.primary_sources, [
    "https://www.w3.org/TR/WCAG22/#use-of-color",
    "https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html"
  ]);
  assert.deepEqual(procedure.required_evidence_types, ["browser_inspection", "manual_observation"]);
  assert.match(procedure.procedure_steps.join(" "), /visible text.*non-hue cue.*3:1.*specific hue/u);
  assert.match(procedure.procedure_steps.join(" "), /hidden text alone.*SC 1\.4\.3.*SC 1\.4\.11.*visited history/u);
  assert.ok(procedure.cant_tell_when.length && procedure.counterexamples.fail.length);
});

test("SC 3.3.4 checks one working safeguard for consequential submissions", () => {
  const procedure = procedureFor("WCAG-2.2-SC-3.3.4");
  assert.deepEqual(procedure.primary_sources, [
    "https://www.w3.org/TR/WCAG22/#error-prevention-legal-financial-data",
    "https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html"
  ]);
  assert.deepEqual(procedure.required_evidence_types, ["browser_inspection", "manual_observation"]);
  assert.match(procedure.applicability_steps.join(" "), /legal commitment.*financial transaction.*user-controllable data.*test responses/u);
  assert.match(procedure.procedure_steps.join(" "), /reversible submission.*input errors.*review, confirmation, and correction.*SC 3\.3\.1.*SC 3\.3\.3/u);
  assert.match(procedure.cant_tell_when.join(" "), /without causing a real transaction/u);
});

test("SC 3.3.7 checks repeated entry in the same process and exact exceptions", () => {
  const procedure = procedureFor("WCAG-2.2-SC-3.3.7");
  assert.deepEqual(procedure.primary_sources, [
    "https://www.w3.org/TR/WCAG22/#redundant-entry",
    "https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html"
  ]);
  assert.deepEqual(procedure.required_evidence_types, ["browser_inspection", "manual_observation"]);
  assert.match(procedure.applicability_steps.join(" "), /another domain.*same activity.*later session/u);
  assert.match(procedure.procedure_steps.join(" "), /auto-populates.*available for selection.*browser autocomplete alone.*essential, security, or invalid-value reason/u);
  assert.ok(procedure.cant_tell_when.length && procedure.counterexamples.fail.length);
});

test("SC 3.3.8 reviews every authentication step and its AA exceptions", () => {
  const procedure = procedureFor("WCAG-2.2-SC-3.3.8");
  assert.deepEqual(procedure.primary_sources, [
    "https://www.w3.org/TR/WCAG22/#accessible-authentication-minimum",
    "https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html"
  ]);
  assert.deepEqual(procedure.required_evidence_types, ["browser_inspection", "manual_observation"]);
  assert.match(procedure.applicability_steps.join(" "), /second factors.*recovery authentication.*challenges.*initial account creation/u);
  assert.match(procedure.procedure_steps.join(" "), /complete value can be pasted.*object recognition.*non-text content previously provided by the user/u);
  assert.match(procedure.cant_tell_when.join(" "), /No authorized test account.*real credentials/u);
  assert.ok(procedure.counterexamples.pass.length && procedure.counterexamples.fail.length && procedure.counterexamples.cant_tell.length);
});

test("SC 2.5.8 measures pointer targets and checks spacing before other exceptions", () => {
  const procedure = procedureFor("WCAG-2.2-SC-2.5.8");
  assert.deepEqual(procedure.primary_sources, [
    "https://www.w3.org/TR/WCAG22/#target-size-minimum",
    "https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html"
  ]);
  assert.deepEqual(procedure.required_evidence_types, ["browser_inspection", "manual_observation"]);
  assert.match(procedure.procedure_steps.join(" "), /24 by 24 CSS pixel square.*24 CSS pixel diameter circle.*same-page control/u);
  assert.match(procedure.procedure_steps.join(" "), /inline.*unmodified user-agent.*essential-presentation.*legal-presentation/u);
  assert.match(procedure.counterexamples.fail.join(" "), /keyboard shortcut/u);
  assert.ok(procedure.cant_tell_when.length && procedure.counterexamples.cant_tell.length);
});

test("SC 2.5.7 requires a non-drag single-pointer route for author-controlled dragging", () => {
  const procedure = procedureFor("WCAG-2.2-SC-2.5.7");
  assert.deepEqual(procedure.primary_sources, [
    "https://www.w3.org/TR/WCAG22/#dragging-movements",
    "https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html"
  ]);
  assert.deepEqual(procedure.required_evidence_types, ["browser_inspection", "manual_observation"]);
  assert.match(procedure.procedure_steps.join(" "), /one pointer through taps or clicks.*keyboard-only controls.*swipe-only/u);
  assert.match(procedure.procedure_steps.join(" "), /user agent alone.*fundamentally change/u);
  assert.match(procedure.counterexamples.fail.join(" "), /keyboard arrow keys.*no click or tap/u);
  assert.ok(procedure.cant_tell_when.length && procedure.counterexamples.cant_tell.length);
});

test("SC 2.5.1 separates path-based gestures from dragging and checks a single-pointer route", () => {
  const procedure = procedureFor("WCAG-2.2-SC-2.5.1");
  assert.deepEqual(procedure.primary_sources, [
    "https://www.w3.org/TR/WCAG22/#pointer-gestures",
    "https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html"
  ]);
  assert.deepEqual(procedure.required_evidence_types, ["browser_inspection", "manual_observation"]);
  assert.match(procedure.applicability_steps.join(" "), /multiple simultaneous pointers.*path.*unrestricted drag-and-drop/u);
  assert.match(procedure.procedure_steps.join(" "), /one pointer.*keyboard-only.*SC 2\.5\.7.*essential exception/u);
  assert.match(procedure.counterexamples.fail.join(" "), /horizontal flick.*no tap or click/u);
  assert.ok(procedure.cant_tell_when.length && procedure.counterexamples.cant_tell.length);
});

test("SC 2.5.2 distinguishes pointer down/up routes and unsafe verification", () => {
  const procedure = procedureFor("WCAG-2.2-SC-2.5.2");
  assert.deepEqual(procedure.primary_sources, [
    "https://www.w3.org/TR/WCAG22/#pointer-cancellation",
    "https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html"
  ]);
  assert.deepEqual(procedure.required_evidence_types, ["browser_inspection", "manual_observation"]);
  assert.match(procedure.procedure_steps.join(" "), /down-event.*up-event.*abort.*undo.*reverses.*essential timing reason/u);
  assert.match(procedure.cant_tell_when.join(" "), /real consequential action.*no safe fixture/u);
  assert.ok(procedure.counterexamples.pass.length && procedure.counterexamples.fail.length && procedure.counterexamples.cant_tell.length);
});

test("SC 2.5.3 compares the visible label with the computed name", () => {
  const procedure = procedureFor("WCAG-2.2-SC-2.5.3");
  assert.deepEqual(procedure.primary_sources, [
    "https://www.w3.org/TR/WCAG22/#label-in-name",
    "https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html"
  ]);
  assert.match(procedure.procedure_steps.join(" "), /computed accessible name.*aria-label.*same order.*not require.*start/u);
  assert.match(procedure.applicability_steps.join(" "), /placeholder.*only nearby visible text/u);
  assert.match(procedure.expected_results.join(" "), /no accessible name does not pass/u);
  assert.ok(procedure.cant_tell_when.length && procedure.counterexamples.cant_tell.length);
});

test("SC 2.5.4 checks both alternate controls and motion-response disablement", () => {
  const procedure = procedureFor("WCAG-2.2-SC-2.5.4");
  assert.deepEqual(procedure.primary_sources, [
    "https://www.w3.org/TR/WCAG22/#motion-actuation",
    "https://www.w3.org/WAI/WCAG22/Understanding/motion-actuation.html"
  ]);
  assert.match(procedure.applicability_steps.join(" "), /device motion.*user motion.*geolocation/u);
  assert.match(procedure.procedure_steps.join(" "), /user interface components.*disables response.*essential/u);
  assert.match(procedure.expected_results.join(" "), /same outcome.*disable motion response/u);
  assert.ok(procedure.cant_tell_when.length && procedure.counterexamples.fail.length);
});

test("page title and link purpose procedures preserve their distinct navigation evidence", () => {
  const title = procedureFor("WCAG-2.2-SC-2.4.2");
  const link = procedureFor("WCAG-2.2-SC-2.4.4");
  assert.ok(title.primary_sources.includes("https://www.w3.org/TR/WCAG22/#page-titled"));
  assert.match(title.procedure_steps.join(" "), /browser tab.*single-page application view.*site branding alone/u);
  assert.ok(link.primary_sources.includes("https://www.w3.org/TR/WCAG22/#link-purpose-in-context"));
  assert.match(link.procedure_steps.join(" "), /computed name.*programmatically determinable context.*ambiguous to users in general/u);
  assert.match(link.applicability_steps.join(" "), /image-only links.*table cell and associated headers/u);
  assert.ok(title.cant_tell_when.length && link.cant_tell_when.length);
});

test("new focus and input-error procedures keep their criterion boundaries and primary sources", () => {
  const focus = procedureFor("WCAG-2.2-SC-2.4.11");
  assert.ok(focus.primary_sources.includes("https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum"));
  assert.ok(focus.procedure_steps.some((step) => /entirely hides the component/i.test(step)));
  assert.ok(focus.procedure_steps.some((step) => /without advancing focus/i.test(step)));
  assert.ok(focus.procedure_steps.some((step) => /2\.4\.7/u.test(step)));
  assert.ok(focus.counterexamples.fail.some((example) => /entirely covers/i.test(example)));

  const errors = procedureFor("WCAG-2.2-SC-3.3.1");
  assert.ok(errors.primary_sources.includes("https://www.w3.org/TR/WCAG22/#error-identification"));
  assert.ok(errors.applicability_steps.some((step) => /automatically detect/i.test(step)));
  assert.ok(errors.procedure_steps.some((step) => /identity of the item.*what is wrong/i.test(step)));
  assert.ok(errors.procedure_steps.some((step) => /3\.3\.3/u.test(step)));
  assert.ok(errors.counterexamples.fail.some((example) => /no text identifies/i.test(example)));
});

test("reflow and status procedures retain scoped exceptions and distinct speech evidence", () => {
  const reflow = procedureFor("WCAG-2.2-SC-1.4.10");
  assert.ok(reflow.primary_sources.includes("https://www.w3.org/TR/WCAG22/#reflow"));
  assert.match(reflow.procedure_steps.join(" "), /320 CSS pixels.*256 CSS pixels/u);
  assert.match(reflow.procedure_steps.join(" "), /smallest section/u);
  assert.ok(reflow.counterexamples.fail.some((example) => /horizontal and vertical scrolling/u.test(example)));

  const status = procedureFor("WCAG-2.2-SC-4.1.3");
  assert.ok(status.primary_sources.includes("https://www.w3.org/TR/WCAG22/#status-messages"));
  assert.match(status.applicability_steps.join(" "), /without changing context/u);
  assert.match(status.procedure_steps.join(" "), /programmatically determinable/u);
  assert.match(status.procedure_steps.join(" "), /actual announcement separately/u);
  assert.ok(status.counterexamples.fail.some((example) => /without a role or property/u.test(example)));
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

test("lookup exposes exact versioned bindings for available criterion procedures", () => {
  const expectedRefs = new Map([
    ["WCAG-2.2-SC-1.1.1", "criterion-procedures:1.0.0#wcag22-sc-1-1-1-non-text-content"],
    ["WCAG-2.2-SC-2.1.1", "criterion-procedures:1.0.0#wcag22-sc-2-1-1-keyboard"],
    ["WCAG-2.2-SC-3.1.1", "criterion-procedures:1.0.0#wcag22-sc-3-1-1-language-of-page"],
    ["WCAG-2.2-SC-2.4.1", "criterion-procedures:1.0.0#wcag22-sc-2-4-1-bypass-blocks"],
    ["WCAG-2.2-SC-3.3.2", "criterion-procedures:1.0.0#wcag22-sc-3-3-2-labels-or-instructions"],
    ["WCAG-2.2-SC-1.4.4", "criterion-procedures:1.0.0#wcag22-sc-1-4-4-resize-text"],
    ["WCAG-2.2-SC-1.3.1", "criterion-procedures:1.0.0#wcag22-sc-1-3-1-info-and-relationships"],
    ["WCAG-2.2-SC-4.1.2", "criterion-procedures:1.0.0#wcag22-sc-4-1-2-name-role-value"],
    ["WCAG-2.2-SC-2.4.11", "criterion-procedures:1.0.0#wcag22-sc-2-4-11-focus-not-obscured-minimum"],
    ["WCAG-2.2-SC-3.3.1", "criterion-procedures:1.0.0#wcag22-sc-3-3-1-error-identification"],
    ["WCAG-2.2-SC-1.4.10", "criterion-procedures:1.0.0#wcag22-sc-1-4-10-reflow"],
    ["WCAG-2.2-SC-4.1.3", "criterion-procedures:1.0.0#wcag22-sc-4-1-3-status-messages"]
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
