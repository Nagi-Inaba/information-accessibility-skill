import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createAuditRun, validateAuditRun } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";
import { buildRunBackedPresentation, renderReportMarkdown } from "../codex/skills/information-accessibility-practice/scripts/lib/report-presentation.mjs";
import { renderReportSummaryMarkdown } from "../codex/skills/information-accessibility-practice/scripts/lib/report-summary.mjs";
import { renderReportHtml } from "../codex/skills/information-accessibility-practice/scripts/lib/report-html.mjs";
import { applyReportVisibility } from "../codex/skills/information-accessibility-practice/scripts/lib/report-privacy.mjs";

const skillRoot = fileURLToPath(new URL("../codex/skills/information-accessibility-practice/", import.meta.url));
const read = (name) => JSON.parse(fs.readFileSync(path.join(skillRoot, "references", name), "utf8"));
const registry = read("standards-registry.json"), catalog = read("criteria-catalog.json");
const schema = read("assessment-record.schema.json"), methods = read("web-audit-methods.json");
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "inspection-intake-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const artifactRoot = path.join(temp, "artifacts");
  fs.mkdirSync(artifactRoot);
  return { temp, options: {
    skillRoot, artifactRoot, runFile: path.join(temp, "run.json"), runId: "RUN-20260914T000000Z-INTAKE01",
    profile: "web-modern", targetName: "Intake fixture", targetVersion: "v1", targetRefs: ["https://example.com/"],
    network: "none", interaction: "safe_read_only", sourceWrite: "none"
  } };
}
function cliArgs(options) {
  return [path.join(skillRoot, "scripts/create-audit-run.mjs"),
    "--run-id", options.runId, "--profile", options.profile, "--target-name", options.targetName,
    "--target-version", options.targetVersion, "--target-ref", options.targetRefs[0],
    "--artifact-root", options.artifactRoot, "--network", options.network,
    "--interaction", options.interaction, "--source-write", options.sourceWrite, "--output", options.runFile];
}
function model(run, locale) {
  const assessment = generateAssessment("web-modern", {
    targetName: run.target.name, targetVersion: run.target.version_or_commit, targetRefs: run.target.urls_or_files,
    evaluator: "Intake fixture", evaluatedAt: "2026-09-14"
  });
  const validation = validateAssessment(assessment, registry, schema, catalog, methods);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  return buildRunBackedPresentation({ run, assessment, validation, registry, catalog, locale,
    publicModel: { target: run.target, scope: run.scope, environment: run.environment, limitations: [], reportChecks: [], remediation: [] } });
}
const outputs = (presentation) => [renderReportMarkdown(presentation), renderReportSummaryMarkdown(presentation),
  renderReportHtml(presentation), renderReportHtml(presentation, { detail: "summary" })];

test("new inspections reject missing or ambiguous intake without creating any output", (t) => {
  const { options } = fixture(t);
  for (const [args, pattern] of [
    [[], /--inspection-mode/],
    [["--inspection-mode", "quick"], /--inspection-purpose/],
    [["--inspection-purpose", "Plan improvements"], /--inspection-mode/],
    [["--inspection-mode", "auto", "--inspection-purpose", "Plan improvements"], /--inspection-mode/],
    [["--inspection-mode", "detailed", "--inspection-purpose", "   "], /--inspection-purpose/]
  ]) {
    const result = spawnSync(process.execPath, [...cliArgs(options), ...args], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, pattern);
    assert.equal(fs.existsSync(options.runFile), false);
    assert.deepEqual(fs.readdirSync(options.artifactRoot), []);
  }
});

test("mode selection records distinct deliverables but creates no evidence or extra authority", (t) => {
  const { options } = fixture(t);
  for (const mode of ["quick", "detailed"]) {
    const result = spawnSync(process.execPath, [...cliArgs({ ...options, runFile: path.join(path.dirname(options.runFile), `${mode}.json`) }),
      "--inspection-mode", mode, "--inspection-purpose", "  Plan improvements  "], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const run = JSON.parse(fs.readFileSync(path.join(path.dirname(options.runFile), `${mode}.json`), "utf8"));
    assert.equal(run.inspection_request.mode, mode);
    assert.equal(run.inspection_request.purpose, "Plan improvements");
    assert.deepEqual(run.inspection_request.deliverables, mode === "quick"
      ? ["decision_summary", "remaining_checks"] : ["decision_summary", "remediation_details", "complete_results", "remaining_checks"]);
    assert.equal(run.status, "initialized");
    assert.deepEqual(run.artifacts, []);
    assert.deepEqual(run.history, []);
    assert.equal(run.permissions.source_write, "denied");
    assert.equal(run.permissions.command_execution, "denied");
  }
});

test("current validation rejects requests whose mode contract was weakened or removed", (t) => {
  const { options } = fixture(t);
  const run = createAuditRun({ ...options, inspectionMode: "detailed", inspectionPurpose: "Plan improvements" });
  for (const mutate of [
    (value) => { delete value.inspection_request; },
    (value) => { value.inspection_request.deliverables = ["decision_summary"]; },
    (value) => { value.inspection_request.completion_criteria.pop(); },
    (value) => { value.inspection_request.mode = "quick"; },
    (value) => { value.inspection_request.purpose = " "; }
  ]) {
    const changed = structuredClone(run); mutate(changed);
    const validation = validateAuditRun(changed, { skillRoot, runFile: options.runFile });
    assert.equal(validation.valid, false);
    assert.match(validation.errors.join("\n"), /inspection_request|inspection-purpose/);
  }
});

test("historical run 6 remains readable without inventing an inspection level", (t) => {
  const { options } = fixture(t);
  const run = createAuditRun({ ...options, inspectionMode: "quick", inspectionPurpose: "Plan improvements" });
  delete run.inspection_request;
  run.schema_version = "6.0.0";
  delete run.target_inventory;
  run.resource_versions.orchestration_registry_version = "5.0.0";
  run.resource_versions.orchestration_registry_sha256 = crypto.createHash("sha256")
    .update(fs.readFileSync(path.join(skillRoot, "references/orchestration-registry-5.0.0.json"))).digest("hex");
  const before = JSON.stringify(run);
  const validation = validateAuditRun(run, { skillRoot, runFile: options.runFile });
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  for (const output of outputs(model(run, "en"))) assert.doesNotMatch(output, /Inspection level|Requested deliverables/);
  assert.equal(JSON.stringify(run), before);
});

test("all four report formats show the agreed level and criteria without declaring completion", (t) => {
  const { options } = fixture(t);
  for (const mode of ["quick", "detailed"]) for (const locale of ["ja", "en"]) {
    const run = createAuditRun({ ...options, inspectionMode: mode, inspectionPurpose: "Purpose <script>alert(1)</script>" });
    const presentation = model(run, locale);
    assert.equal(presentation.rows.length, 55);
    assert.ok(presentation.rows.every((row) => row.source_kind === "not_run" && row.outcome === "not_tested"));
    for (const output of outputs(presentation)) {
      assert.ok(output.includes(locale === "ja" ? (mode === "quick" ? "簡易チェック" : "詳細検査・改善用") : (mode === "quick" ? "Quick check" : "Detailed inspection for remediation")));
      assert.ok(output.includes("Purpose &lt;script&gt;"));
      assert.ok(output.includes(locale === "ja" ? "達成済みという意味ではありません" : "listing them does not mean they are met"));
      assert.equal(output.includes(locale === "ja" ? "指摘ごとの改善手順" : "Remediation instructions for each finding"), mode === "detailed");
      assert.doesNotMatch(output, /<script>/);
    }
  }
});

test("public reports redact sensitive purpose text and leave the saved request intact", (t) => {
  const { options } = fixture(t);
  const purpose = "Contact private@example.com about C:\\Users\\PrivateReader\\audit and https://localhost/private?token=123";
  const run = createAuditRun({ ...options, inspectionMode: "detailed", inspectionPurpose: purpose });
  const presentation = model(run, "en");
  const visible = applyReportVisibility(presentation, { visibility: "public", reviewerDisclosure: "redact" });
  for (const output of outputs(visible.presentation)) assert.doesNotMatch(output, /private@example\.com|PrivateReader|localhost|token=123/);
  assert.equal(run.inspection_request.purpose, purpose);
  assert.equal(presentation.inspection_request.purpose, purpose);
  assert.ok(visible.manifest.redactions.some((entry) => entry.path === "inspection_request.purpose"));
  assert.doesNotMatch(JSON.stringify(visible.manifest), /PrivateReader|private@example\.com/);
});
