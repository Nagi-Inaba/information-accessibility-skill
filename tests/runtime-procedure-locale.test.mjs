import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "codex/skills/information-accessibility-practice");
const cli = path.join(skillRoot, "scripts/accessibility-audit.mjs");
const methodOverlayFile = path.join(skillRoot, "references/web-audit-methods.ja.json");
const procedureOverlayFile = path.join(skillRoot, "references/criterion-procedures.ja.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
}

function exactRequirement(id, locale, format = "json") {
  const result = runCli([
    "requirement",
    "--profile", "web-modern",
    "--id", id,
    "--locale", locale,
    "--format", format
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return format === "json" ? JSON.parse(result.stdout) : result.stdout;
}

function assertTranslatedString(value, canonical, location) {
  assert.equal(typeof value, "string", `${location} must be a string`);
  assert.ok(value.trim().length > 0, `${location} must not be empty`);
  assert.notEqual(value, canonical, `${location} must not fall back to the English canonical string`);
  assert.match(value, /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u, `${location} must contain Japanese text`);
}

test("Japanese procedure overlays cover every canonical method and criterion procedure without shape drift", () => {
  assert.equal(fs.existsSync(methodOverlayFile), true, "missing web-audit-methods.ja.json");
  assert.equal(fs.existsSync(procedureOverlayFile), true, "missing criterion-procedures.ja.json");

  const canonicalMethods = readJson(path.join(skillRoot, "references/web-audit-methods.json"));
  const localizedMethods = readJson(methodOverlayFile);
  assert.deepEqual(localizedMethods.methods.map((item) => item.id), canonicalMethods.methods.map((item) => item.id));
  for (const [index, canonical] of canonicalMethods.methods.entries()) {
    const localized = localizedMethods.methods[index];
    assertTranslatedString(localized.applicability_gate, canonical.applicability_gate, `${canonical.id}.applicability_gate`);
    assert.equal(localized.procedure_steps.length, canonical.procedure_steps.length, `${canonical.id}.procedure_steps length`);
    localized.procedure_steps.forEach((value, stepIndex) => {
      assertTranslatedString(value, canonical.procedure_steps[stepIndex], `${canonical.id}.procedure_steps[${stepIndex}]`);
    });
    assertTranslatedString(localized.cant_tell_when, canonical.cant_tell_when, `${canonical.id}.cant_tell_when`);
  }

  const canonicalProcedures = readJson(path.join(skillRoot, "references/criterion-procedures.json"));
  const localizedProcedures = readJson(procedureOverlayFile);
  assert.deepEqual(localizedProcedures.procedures.map((item) => item.id), canonicalProcedures.procedures.map((item) => item.id));
  for (const [index, canonical] of canonicalProcedures.procedures.entries()) {
    const localized = localizedProcedures.procedures[index];
    for (const field of ["applicability_steps", "procedure_steps", "expected_results", "cant_tell_when"]) {
      assert.equal(localized[field].length, canonical[field].length, `${canonical.id}.${field} length`);
      localized[field].forEach((value, itemIndex) => {
        assertTranslatedString(value, canonical[field][itemIndex], `${canonical.id}.${field}[${itemIndex}]`);
      });
    }
    for (const outcome of ["pass", "fail", "cant_tell"]) {
      assert.equal(localized.counterexamples[outcome].length, canonical.counterexamples[outcome].length, `${canonical.id}.counterexamples.${outcome} length`);
      localized.counterexamples[outcome].forEach((value, itemIndex) => {
        assertTranslatedString(value, canonical.counterexamples[outcome][itemIndex], `${canonical.id}.counterexamples.${outcome}[${itemIndex}]`);
      });
    }
    assertTranslatedString(localized.ai_boundary, canonical.ai_boundary, `${canonical.id}.ai_boundary`);
  }
});

test("legacy exact requirement lookup localizes generic and criterion-specific procedure prose while preserving machine fields", () => {
  const japanese = exactRequirement("WCAG-2.2-SC-1.1.1", "ja");
  const english = exactRequirement("WCAG-2.2-SC-1.1.1", "en");

  assert.equal(japanese.lookup_version, english.lookup_version);
  assert.equal(japanese.audit_method.id, english.audit_method.id);
  assert.equal(japanese.criterion_procedure.id, english.criterion_procedure.id);
  assert.deepEqual(japanese.audit_method.required_evidence_types, english.audit_method.required_evidence_types);
  assert.deepEqual(japanese.criterion_procedure.required_evidence_types, english.criterion_procedure.required_evidence_types);

  assertTranslatedString(japanese.audit_method.applicability_gate, english.audit_method.applicability_gate, "audit_method.applicability_gate");
  japanese.audit_method.procedure_steps.forEach((value, index) => {
    assertTranslatedString(value, english.audit_method.procedure_steps[index], `audit_method.procedure_steps[${index}]`);
  });
  assertTranslatedString(japanese.audit_method.cant_tell_when, english.audit_method.cant_tell_when, "audit_method.cant_tell_when");

  for (const field of ["applicability_steps", "procedure_steps", "expected_results", "cant_tell_when"]) {
    japanese.criterion_procedure[field].forEach((value, index) => {
      assertTranslatedString(value, english.criterion_procedure[field][index], `criterion_procedure.${field}[${index}]`);
    });
  }
  assertTranslatedString(japanese.criterion_procedure.ai_boundary, english.criterion_procedure.ai_boundary, "criterion_procedure.ai_boundary");
});

test("Japanese requirement Markdown does not retain the canonical English procedure prose", () => {
  const markdown = exactRequirement("WCAG-2.2-SC-1.1.1", "ja", "markdown");
  assert.match(markdown, /適用条件/u);
  assert.match(markdown, /確認手順/u);
  assert.match(markdown, /AIの境界/u);
  assert.doesNotMatch(markdown, /Inventory informative, functional|Classify each non-text item|For every applicable item|AI may inventory candidate non-text items/u);
});
