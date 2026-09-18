import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { fixtureInventory } from "./helpers/measured-targets.mjs";
import { createAuditRun, registerArtifact, validateAuditRun, validateArtifact, mergeArtifacts, loadAuditResources, readStableFile, writeNewJson } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { createRunEvidenceReference, collectScreeningEvidence, compareEvidenceReferences } from "../codex/skills/information-accessibility-practice/scripts/lib/run-evidence.mjs";
import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { buildPublicReportModel } from "../codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs";

const scripts = fileURLToPath(new URL("../codex/skills/information-accessibility-practice/scripts/", import.meta.url));
const at = "2026-09-18T09:00:00+09:00";
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const cli = (args) => spawnSync(process.execPath, [path.join(scripts, "accessibility-audit.mjs"), ...args], { encoding: "utf8" });
const pass = (result) => assert.equal(result.status, 0, result.stderr || result.stdout);

function fixture(t, { suffix = "0001", version = "release-1", bytes = Buffer.from("<main>PRIVATE_CAPTURE_MARKER</main>") } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-saved-evidence-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const artifactRoot = path.join(temp, "artifacts");
  fs.mkdirSync(artifactRoot);
  const runFile = path.join(temp, "run.json");
  const run = createAuditRun({ runFile, artifactRoot, runId: `RUN-20260918T000000Z-EVID${suffix}`, profile: "web-modern", targetName: "Evidence fixture", targetVersion: version,
    targetRefs: ["https://example.invalid/"], network: "none", interaction: "safe_read_only", sourceWrite: "none", inspectionMode: "quick", inspectionPurpose: "Inspect saved evidence" });
  run.target_inventory = fixtureInventory(run, artifactRoot, bytes);
  writeNewJson(runFile, run);
  const rawFile = path.join(artifactRoot, "private-dom.html");
  fs.writeFileSync(rawFile, bytes);
  const reference = createRunEvidenceReference({ run, targetRef: run.target.urls_or_files[0], evidenceType: "dom_snapshot", relativePath: "private-dom.html", bytes, capturedAt: at });
  const artifact = { schema_version: "3.0.0", target_snapshot_ids: run.target_inventory.snapshots.map((snapshot) => snapshot.snapshot_id), artifact_id: "ART-SCREEN-EVIDENCE", artifact_type: "screening-observations", run_id: run.run_id,
    producer: { role_id: "e1_inspector", producer_kind: "ai_agent", origin: "saved evidence test" }, created_at: at, inputs: [],
    payload: { schema_version: "3.0.0", observations: [{ requirement_id: "SCREEN-DOM", evidence_level: "E1", method: "DOM inspection", location: "main", observation: "An observed structure requires human review.", captured_at: at,
      profile_requirement_id: null, report_outcome: null, applicability: "undetermined", report_rationale: "Unmapped observation.", evidence_refs: [reference] }] } };
  const artifactFile = path.join(artifactRoot, "screen.json");
  const register = () => {
    fs.writeFileSync(artifactFile, JSON.stringify(artifact), "utf8");
    return registerArtifact(run, artifact, { runFile, artifactFile });
  };
  return { temp, artifactRoot, runFile, run, rawFile, bytes, reference, artifact, artifactFile, register };
}

function mergedFixture(f) {
  const registered = f.register();
  const validation = validateAuditRun(registered, { runFile: f.runFile });
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  const resources = loadAuditResources();
  resources.artifact_snapshots_by_id = new Map([[f.artifact.artifact_id, readStableFile(f.artifactFile)]]);
  resources.evidence_snapshots_by_path = validation.evidenceSnapshots;
  const baseline = generateAssessment("web-modern", { targetName: f.run.target.name, targetVersion: f.run.target.version_or_commit, targetRefs: f.run.target.urls_or_files, evaluator: "Fixture", evaluatedAt: "2026-09-18" });
  baseline.assessment.scope = structuredClone(f.run.scope);
  baseline.assessment.environment = structuredClone(f.run.environment);
  const args = { run: registered, assessment: baseline, artifacts: [f.artifact], registries: resources };
  const assessment = mergeArtifacts(args);
  return { registered, validation, args, assessment };
}

test("saved evidence binds exact run, target context, version and environment before registration", (t) => {
  const f = fixture(t);
  assert.equal(validateAuditRun(f.register(), { runFile: f.runFile }).valid, true);
  for (const [field, value] of [["run_id", "RUN-20260918T000000Z-OTHER001"], ["target_version", "other"], ["target_ref", "https://other.invalid/"], ["environment_ref", `ENV-${"0".repeat(64)}`], ["target_context_sha256", "0".repeat(64)]]) {
    f.artifact.payload.observations[0].evidence_refs = [{ ...f.reference, [field]: value }];
    assert.throws(f.register, /Evidence|target_ref/i, field);
  }
});

test("E1 requires saved bytes; E0 may explicitly record unavailable capture; legacy payloads are read-only", (t) => {
  const f = fixture(t);
  f.artifact.payload.observations[0].evidence_refs = [];
  assert.throws(f.register, /minItems|at least|evidence_refs|saved evidence/i);
  f.artifact.payload.observations[0].evidence_level = "E0";
  assert.doesNotThrow(f.register);
  f.artifact.payload.schema_version = "2.0.0";
  delete f.artifact.payload.observations[0].evidence_refs;
  assert.equal(validateArtifact(f.artifact, loadAuditResources()).valid, true, "archived payload schema still reads");
  assert.throws(f.register, /3\.0\.0|current|read.only/i);
});

test("missing, changed and future-dated capture is rejected before registration", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.rawFile, "changed");
  assert.throws(f.register, /hash mismatch/i);
  fs.unlinkSync(f.rawFile);
  assert.throws(f.register, /Missing|ENOENT/i);
  fs.writeFileSync(f.rawFile, f.bytes);
  f.artifact.payload.observations[0].evidence_refs = [{ ...f.reference, captured_at: "2026-09-18T00:00:00.0001Z" }];
  assert.throws(f.register, /capture must not follow/i);
});

test("post-registration tampering fails validate, status, merge and report without new output", (t) => {
  const f = fixture(t);
  const { registered, assessment } = mergedFixture(f);
  const registeredFile = path.join(f.temp, "registered.json");
  const assessmentFile = path.join(f.temp, "assessment.json");
  writeNewJson(registeredFile, registered);
  writeNewJson(assessmentFile, assessment);
  fs.writeFileSync(f.rawFile, "tampered PRIVATE_CAPTURE_MARKER");
  assert.equal(validateAuditRun(registered, { runFile: registeredFile }).valid, false);
  const reportOutput = path.join(f.temp, "report.md");
  const mergeOutput = path.join(f.temp, "merged.json");
  for (const args of [["status", "--run", registeredFile, "--format", "json"], ["merge", "--run", registeredFile, "--assessment", assessmentFile, "--artifact", f.artifactFile, "--output", mergeOutput], ["report", "--run", registeredFile, "--assessment", assessmentFile, "--output", reportOutput]]) {
    const result = cli(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr + result.stdout, /hash mismatch/i);
  }
  assert.equal(fs.existsSync(reportOutput), false);
  assert.equal(fs.existsSync(mergeOutput), false);
});

test("pure merge verifies raw bytes rather than trusting reference or snapshot hashes", (t) => {
  const f = fixture(t);
  const { args } = mergedFixture(f);
  delete args.registries.evidence_snapshots_by_path;
  assert.throws(() => mergeArtifacts(args), /raw evidence bytes/i);
  args.registries.evidence_snapshots_by_path = new Map([[f.reference.path, { bytes: Buffer.from("changed"), sha256: f.reference.sha256 }]]);
  assert.throws(() => mergeArtifacts(args), /hash mismatch/i);
});

test("evidence paths reject cross-platform traversal and symlink escapes", (t) => {
  const f = fixture(t);
  for (const bad of ["../private-dom.html", "C:/private.html", "/private.html", "sub/../private.html", "private.html:stream", "CON.html", "sub\\file.html"]) {
    f.artifact.payload.observations[0].evidence_refs = [{ ...f.reference, path: bad }];
    assert.throws(f.register, /path.*normalized|relative|traversal/i, bad);
  }
  const outside = path.join(f.temp, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "private-dom.html"), f.bytes);
  fs.symlinkSync(outside, path.join(f.artifactRoot, "escape"), process.platform === "win32" ? "junction" : "dir");
  f.artifact.payload.observations[0].evidence_refs = [{ ...f.reference, path: "escape/private-dom.html" }];
  assert.throws(f.register, /symbolic link|junction|reparse/i);
});

test("public models and public reports withhold raw contents and reference metadata", (t) => {
  const f = fixture(t);
  const { registered, validation, assessment } = mergedFixture(f);
  const model = buildPublicReportModel({ run: registered, assessment, envelopesById: validation.envelopesById, resources: validation.resources });
  const serialized = JSON.stringify(model);
  for (const privateValue of [f.reference.path, f.reference.sha256, f.reference.environment_ref, f.reference.target_snapshot_id, "PRIVATE_CAPTURE_MARKER"]) assert.ok(!serialized.includes(privateValue), privateValue);
  const registeredFile = path.join(f.temp, "registered.json");
  const assessmentFile = path.join(f.temp, "assessment.json");
  writeNewJson(registeredFile, registered);
  writeNewJson(assessmentFile, assessment);
  const output = path.join(f.temp, "public.md");
  pass(cli(["report", "--run", registeredFile, "--assessment", assessmentFile, "--visibility", "public", "--reviewer-disclosure", "redact", "--redaction-manifest", path.join(f.temp, "redaction.json"), "--output", output]));
  const report = fs.readFileSync(output, "utf8");
  for (const privateValue of [f.reference.path, f.reference.sha256, f.reference.environment_ref, f.reference.target_snapshot_id, "PRIVATE_CAPTURE_MARKER"]) assert.ok(!report.includes(privateValue), privateValue);
});

test("bind-evidence creates a new artifact from captured bytes without changing its conclusion", (t) => {
  const f = fixture(t);
  f.artifact.payload.observations[0].evidence_refs = [];
  writeNewJson(f.artifactFile, f.artifact);
  const original = fs.readFileSync(f.artifactFile);
  const output = path.join(f.artifactRoot, "bound.json");
  const args = ["bind-evidence", "--run", f.runFile, "--artifact", f.artifactFile, "--observation", "SCREEN-DOM", "--file", f.rawFile, "--type", "dom_snapshot", "--target-ref", f.run.target.urls_or_files[0], "--captured-at", at, "--output", output];
  pass(cli(args));
  const bound = json(output);
  assert.deepEqual(bound.payload.observations[0].evidence_refs, [f.reference]);
  assert.equal(bound.payload.observations[0].evidence_level, "E1");
  assert.equal(bound.payload.observations[0].observation, f.artifact.payload.observations[0].observation);
  assert.deepEqual(fs.readFileSync(f.artifactFile), original);
  assert.equal(cli(args).status, 1, "existing output is never overwritten");
  const outsideOutput = path.join(f.temp, "outside-new", "bound.json");
  const outsideResult = cli([...args.slice(0, -1), outsideOutput]);
  assert.equal(outsideResult.status, 1);
  assert.match(outsideResult.stderr, /within the artifact root/i);
  assert.equal(fs.existsSync(path.dirname(outsideOutput)), false);
  assert.doesNotThrow(() => registerArtifact(f.run, bound, { runFile: f.runFile, artifactFile: output }));
});

test("comparison records before/after bytes, dates and versions without interpreting outcomes", (t) => {
  const before = fixture(t);
  const after = fixture(t, { suffix: "0002", version: "release-2", bytes: Buffer.from("<main>Changed content</main>") });
  const beforeFile = path.join(before.temp, "registered.json");
  const afterFile = path.join(after.temp, "registered.json");
  writeNewJson(beforeFile, before.register());
  writeNewJson(afterFile, after.register());
  const output = path.join(after.temp, "comparison.json");
  pass(cli(["compare-evidence", "--before", beforeFile, "--after", afterFile, "--output", output]));
  const result = json(output);
  assert.equal(result.publication, "private_by_default");
  assert.equal(result.comparisons[0].status, "bytes_changed");
  assert.equal(result.comparisons[0].context_changed, true);
  assert.equal(result.comparisons[0].before[0].sha256, hash(before.bytes));
  assert.equal(result.comparisons[0].after[0].target_version, "release-2");
  const rows = before.artifact.payload.observations;
  assert.equal(compareEvidenceReferences(rows, rows)[0].status, "bytes_unchanged");
  assert.equal(compareEvidenceReferences(rows, rows)[0].context_changed, false);
  const otherContext = structuredClone(rows);
  otherContext[0].evidence_refs[0].environment_ref = `ENV-${"0".repeat(64)}`;
  const contextComparison = compareEvidenceReferences(rows, otherContext)[0];
  assert.equal(contextComparison.status, "bytes_unchanged");
  assert.equal(contextComparison.context_changed, true);
  assert.equal(compareEvidenceReferences([], rows)[0].status, "added");
  assert.equal(compareEvidenceReferences(rows, [])[0].status, "removed");
  const evidence = collectScreeningEvidence(before.run, [before.artifact], () => ({ bytes: before.bytes, sha256: hash(before.bytes) }));
  assert.deepEqual(evidence.errors, []);
});
