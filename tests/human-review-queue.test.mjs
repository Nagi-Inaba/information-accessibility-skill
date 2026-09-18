import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import test from "node:test";
import { createAuditRun, bindTargetInventory, writeNewJson, validateAuditRun, validateArtifact, loadAuditResources } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { createHumanReviewQueue, queueContextErrors } from "../codex/skills/information-accessibility-practice/scripts/lib/human-review-queue.mjs";
import { fixtureInventory } from "./helpers/measured-targets.mjs";
import { fixtureReference, saveFixtureEvidence } from "./helpers/saved-evidence.mjs";
import { cli, pass, read } from "./helpers/scanner-import.mjs";

const requirement = "WCAG-2.2-SC-1.1.1";
const privateFields = ["origins", "reason", "priority", "priority_reason", "affected_users", "target_locations", "related_screening_observations", "status"];
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function fixture(t, targetRefs = ["https://example.com/product"]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "human-queue-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifactRoot = path.join(root, "artifacts"); fs.mkdirSync(artifactRoot);
  const runFile = path.join(root, "run.json");
  const initial = createAuditRun({ runFile, artifactRoot, runId: "RUN-20260919T000000Z-QUEUE001", profile: "web-modern",
    targetName: "Public example page", targetVersion: "v1", targetRefs, network: "none", interaction: "safe_read_only", sourceWrite: "none",
    inspectionMode: "quick", inspectionPurpose: "Find actionable review locations" });
  const run = bindTargetInventory(initial, fixtureInventory(initial, artifactRoot), { runFile });
  writeNewJson(runFile, run); saveFixtureEvidence(artifactRoot, run);
  const screening = { schema_version: "3.0.0", artifact_id: "ART-QUEUE-SCREEN", artifact_type: "screening-observations", run_id: run.run_id,
    producer: { role_id: "e1_inspector", producer_kind: "ai_agent", origin: "synthetic fixture" }, created_at: "2026-01-01T00:00:00Z", inputs: [],
    target_snapshot_ids: run.target_inventory.snapshots.map((snapshot) => snapshot.snapshot_id), payload: { schema_version: "3.0.0", observations: ["candidate_issue", "inconclusive", "no_automated_signal"].map((signal, index) => ({
      requirement_id: `SCREEN-IMAGE-${index}`, profile_requirement_id: requirement, evidence_level: "E1", method: "fixture DOM", location: index < 2 ? "Product image" : "Footer image",
      observation: "Machine observation awaiting review", captured_at: "2026-01-01T00:00:00Z", signal_class: signal, human_review_required: true,
      evidence_provenance: { collection_method: "static_inspection", tool_name: null, tool_version: null, rule_id: null, target_dom: null, viewport: null },
      report_outcome: "cant_tell", applicability: "undetermined", report_rationale: "Human review required", evidence_refs: [fixtureReference(run, "2026-01-01T00:00:00Z")]
    })) } };
  const screenFile = path.join(artifactRoot, "screen.json"); writeNewJson(screenFile, screening);
  const screenedFile = path.join(root, "screened.json");
  pass(cli(["register", "--run", runFile, "--artifact", screenFile, "--output", screenedFile]));
  const queueFile = path.join(artifactRoot, "queue.json");
  return { root, artifactRoot, run, runFile, screening, screenFile, screenedFile, queueFile };
}
function candidate(f, extra = []) {
  const result = cli(["review-queue", "--run", f.screenedFile, "--artifact-id", "ART-QUEUE-CANDIDATE", "--output", f.queueFile, ...extra]);
  pass(result); return read(f.queueFile);
}

test("queue CLI aggregates same-criterion locations and exactly retains all signal classes without inferring priority", (t) => {
  const f = fixture(t); const original = fs.readFileSync(f.screenedFile);
  const queue = candidate(f);
  assert.equal(queue.payload.schema_version, "3.0.0");
  assert.equal(queue.payload.items.length, 1);
  const item = queue.payload.items[0];
  assert.equal(item.target_locations.length, 2);
  assert.equal(item.related_screening_observations.length, 3);
  assert.deepEqual(item.origins, ["screening"]); assert.equal(item.priority, "unprioritized");
  assert.equal(item.status, "pending"); assert.deepEqual(item.affected_users, []);
  assert.deepEqual(fs.readFileSync(f.screenedFile), original);
  assert.notEqual(cli(["review-queue", "--run", f.screenedFile, "--artifact-id", "ART-QUEUE-CANDIDATE", "--output", f.queueFile]).status, 0);
  const queued = path.join(f.root, "queued.json"); pass(cli(["register", "--run", f.screenedFile, "--artifact", f.queueFile, "--output", queued]));
  assert.equal(read(queued).status, "human_queue_ready");
  queue.payload.items[0].target_locations = [null];
  fs.writeFileSync(f.queueFile, JSON.stringify(queue));
  const malformedRun = read(queued); malformedRun.artifacts.find((entry) => entry.artifact_id === queue.artifact_id).sha256 = hash(f.queueFile);
  assert.equal(validateAuditRun(malformedRun, { runFile: queued }).valid, false, "Malformed location returns validation errors without throwing");
});

test("all-profile and manual origins are explicit; partial profile_all, duplicate locations and forged observations are rejected", (t) => {
  const f = fixture(t, ["https://example.com/product", "https://example.com/help"]); const queue = candidate(f, ["--scope", "profile_all", "--requirement", requirement]);
  const resources = loadAuditResources();
  const profileIds = resources.standardsRegistry.profiles.find((profile) => profile.id === f.run.profile.id).requirement_ids;
  assert.equal(queue.payload.items.length, profileIds.length);
  assert.deepEqual(queue.payload.items.find((item) => item.requirement_id === requirement).origins, ["screening", "profile_all", "manual"]);
  const contexts = (q, source = f.screening) => new Map([[source.artifact_id, source], [q.artifact_id, q]]);
  assert.deepEqual(queueContextErrors(f.run, contexts(queue), profileIds), []);
  const changes = [
    (q) => { q.payload.items.pop(); },
    (q) => { q.payload.items[0].target_locations = q.payload.items[0].target_locations.filter((location) => location.target_snapshot_id !== f.run.target_inventory.snapshots[1].snapshot_id); },
    (q) => { q.payload.items[0].target_locations.push({ ...q.payload.items[0].target_locations[0], location: ` ${q.payload.items[0].target_locations[0].location} ` }); },
    (q) => { q.payload.items[0].target_locations[0].target_snapshot_id = "fake-snapshot"; },
    (q) => { q.payload.items[0].target_locations[0].target_ref = "https://evil.invalid/"; },
    (q) => { q.payload.items[0].related_screening_observations[0].artifact_id = "ART-UNREGISTERED"; },
    (q) => { q.payload.items[0].related_screening_observations[0].requirement_id = "SCREEN-UNKNOWN"; },
    (q) => { q.payload.items[0].related_screening_observations.pop(); },
    (q) => { q.payload.items[0].origins = ["manual"]; },
    (q) => { q.inputs = []; },
    (q) => { q.target_snapshot_ids = []; },
    (q) => { q.payload.items[0].target_locations[0].location = "Unrelated heading"; }
  ];
  for (const change of changes) { const q = structuredClone(queue); change(q); assert.ok(queueContextErrors(f.run, contexts(q), profileIds).length, String(change)); }
  const otherRun = structuredClone(f.screening); otherRun.run_id = "RUN-20260919T000000Z-OTHER001";
  assert.ok(queueContextErrors(f.run, contexts(queue, otherRun), profileIds).length);
  const otherCriterion = structuredClone(f.screening); otherCriterion.payload.observations[0].profile_requirement_id = "WCAG-2.2-SC-1.3.1";
  assert.ok(queueContextErrors(f.run, contexts(queue, otherCriterion), profileIds).length);
  const secondQueue = structuredClone(queue); secondQueue.artifact_id = "ART-SECOND-QUEUE";
  assert.match(queueContextErrors(f.run, new Map([...contexts(queue), [secondQueue.artifact_id, secondQueue]]), profileIds).join("\n"), /duplicates a queued requirement/);
  const completed = structuredClone(queue); completed.payload.items[0].status = "completed";
  assert.equal(validateArtifact(completed, resources).valid, false);
});

test("queue registration rejects altered provenance and old payloads without creating a run", (t) => {
  const f = fixture(t); const q = candidate(f);
  q.payload.items[0].related_screening_observations[0].requirement_id = "SCREEN-UNKNOWN";
  fs.writeFileSync(f.queueFile, JSON.stringify(q));
  const output = path.join(f.root, "bad-run.json");
  const bad = cli(["register", "--run", f.screenedFile, "--artifact", f.queueFile, "--output", output]);
  assert.notEqual(bad.status, 0); assert.match(bad.stderr, /observation reference|explicitly route/); assert.equal(fs.existsSync(output), false);
  q.payload.schema_version = "2.0.0";
  for (const item of q.payload.items) for (const field of privateFields) delete item[field];
  fs.writeFileSync(f.queueFile, JSON.stringify(q));
  assert.notEqual(cli(["register", "--run", f.screenedFile, "--artifact", f.queueFile, "--output", output]).status, 0);
  assert.equal(fs.existsSync(output), false);
});

test("queue locations and priority reasons survive public Japanese/English Markdown/HTML while IDs stay private; frozen run 10 remains readable", (t) => {
  const f = fixture(t); const q = candidate(f);
  const item = q.payload.items[0]; item.priority = "P1"; item.priority_reason = "Product purchase decision depends on this image.";
  item.reason = "Confirm the product description."; item.target_locations[0].required_state = "Product gallery expanded";
  fs.writeFileSync(f.queueFile, JSON.stringify(q));
  const queued = path.join(f.root, "queued.json"); pass(cli(["register", "--run", f.screenedFile, "--artifact", f.queueFile, "--output", queued]));
  const baseline = path.join(f.root, "baseline.json");
  pass(cli(["assessment", "--profile", f.run.profile.id, "--target-name", f.run.target.name, "--target-version", f.run.target.version_or_commit,
    "--target-ref", f.run.target.urls_or_files[0], "--evaluator", "Fixture", "--evaluated-at", "2026-09-19", "--output", baseline]));
  const assessment = read(baseline); assessment.assessment.scope = f.run.scope; assessment.assessment.environment = f.run.environment;
  fs.writeFileSync(baseline, JSON.stringify(assessment));
  const merged = path.join(f.root, "merged.json");
  pass(cli(["merge", "--run", queued, "--assessment", baseline, "--artifact", f.screenFile, "--artifact", f.queueFile, "--output", merged]));
  for (const locale of ["ja", "en"]) for (const format of ["markdown", "html"]) for (const layout of ["full", "summary", "appendix"]) {
    const output = path.join(f.root, `report-${locale}-${format}-${layout}.${format === "html" ? "html" : "md"}`);
    pass(cli(["report", "--run", queued, "--assessment", merged, "--visibility", "public", "--reviewer-disclosure", "redact", "--redaction-manifest", `${output}.redaction.json`, "--locale", locale, "--format", format,
      ...(layout === "appendix" ? ["--detail", "summary", "--output", `${output}.summary`, "--appendix", output] : ["--detail", layout, "--output", output])]));
    const report = fs.readFileSync(output, "utf8");
    assert.match(report, /Product image/); assert.match(report, /Product gallery expanded/); assert.match(report, /Product purchase decision/); assert.match(report, /P1/);
    for (const privateValue of [q.artifact_id, f.screening.artifact_id, ...q.target_snapshot_ids, f.root]) assert.equal(report.includes(privateValue), false, privateValue);
  }
  // Construct a historical fixture, never migrate an actual registered record.
  const historical = read(queued); historical.schema_version = "10.0.0";
  const resources = loadAuditResources(); const frozen = resources.orchestrationRegistries.get("9.0.0");
  historical.resource_versions.orchestration_registry_version = "9.0.0";
  historical.resource_versions.orchestration_registry_sha256 = frozen.sha256;
  q.payload.schema_version = "2.0.0";
  for (const entry of q.payload.items) for (const field of privateFields) delete entry[field];
  fs.writeFileSync(f.queueFile, JSON.stringify(q));
  historical.artifacts.find((entry) => entry.artifact_id === q.artifact_id).sha256 = hash(f.queueFile);
  const oldFile = path.join(f.root, "historical.json"); writeNewJson(oldFile, historical);
  const validation = validateAuditRun(historical, { runFile: oldFile }); assert.equal(validation.valid, true, validation.errors.join("\n"));
  pass(cli(["report", "--run", oldFile, "--assessment", merged, "--output", path.join(f.root, "historical.md")]));
  assert.notEqual(cli(["review-queue", "--run", oldFile, "--artifact-id", "ART-OLD", "--output", path.join(f.artifactRoot, "old.json")]).status, 0);
});

test("manual-only candidate has explicit locations and cannot escape the private output root", (t) => {
  const f = fixture(t);
  const payload = createHumanReviewQueue({ run: f.run, manualRequirements: [requirement] });
  assert.deepEqual(payload.items[0].origins, ["manual"]); assert.equal(payload.items[0].related_screening_observations.length, 0);
  assert.equal(payload.items[0].target_locations[0].target_ref, f.run.target.urls_or_files[0]);
  const output = path.join(f.root, "outside.json");
  assert.notEqual(cli(["review-queue", "--run", f.runFile, "--requirement", requirement, "--artifact-id", "ART-MANUAL", "--output", output]).status, 0);
  assert.equal(fs.existsSync(output), false);
  const manualFile = path.join(f.artifactRoot, "manual.json");
  pass(cli(["review-queue", "--run", f.runFile, "--requirement", requirement, "--artifact-id", "ART-MANUAL", "--output", manualFile]));
  const manualRun = path.join(f.root, "manual-run.json");
  pass(cli(["register", "--run", f.runFile, "--artifact", manualFile, "--output", manualRun]));
  assert.equal(read(manualRun).status, "human_queue_ready");
});
