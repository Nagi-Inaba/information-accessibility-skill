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
import { buildPublicReportModel } from "../codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs";
import { buildInternalRunBackedModel } from "../codex/skills/information-accessibility-practice/scripts/lib/report-privacy.mjs";
import { buildRunBackedPresentation } from "../codex/skills/information-accessibility-practice/scripts/lib/report-presentation.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";

const requirement = "WCAG-2.2-SC-1.1.1";
const privateFields = ["origins", "reason", "priority", "priority_reason", "affected_users", "target_locations", "related_screening_observations", "status"];
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function fixture(t, targetRefs = ["https://example.com/product"], prepareScreening = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "human-queue-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifactRoot = path.join(root, "artifacts"); fs.mkdirSync(artifactRoot);
  const runFile = path.join(root, "run.json");
  const initial = createAuditRun({ runFile, artifactRoot, runId: "RUN-20260919T000000Z-QUEUE001", profile: "web-modern",
    targetName: "Public example page", targetVersion: "v1", targetRefs, network: "none", interaction: "safe_read_only", sourceWrite: "none",
    inspectionMode: "quick", inspectionPurpose: "Find actionable review locations" });
  const run = bindTargetInventory(initial, fixtureInventory(initial, artifactRoot), { runFile });
  writeNewJson(runFile, run); saveFixtureEvidence(artifactRoot, run);
  const screening = { schema_version: "4.0.0", artifact_id: "ART-QUEUE-SCREEN", artifact_type: "screening-observations", run_id: run.run_id,
    producer: { role_id: "e1_inspector", producer_kind: "ai_agent", origin: "synthetic fixture" }, created_at: "2026-01-01T00:00:00Z", inputs: [],
    target_snapshot_ids: run.target_inventory.snapshots.map((snapshot) => snapshot.snapshot_id), payload: { schema_version: "4.0.0", observations: ["candidate_issue", "inconclusive", "no_automated_signal"].map((signal, index) => ({
      requirement_id: `SCREEN-IMAGE-${index}`, profile_requirement_id: requirement, evidence_level: "E1", method: "fixture DOM", location: index < 2 ? "Product image" : "Footer image",
      observation: "Machine observation awaiting review", captured_at: "2026-01-01T00:00:00Z", signal_class: signal, human_review_required: true,
      evidence_provenance: { collection_method: "static_inspection", tool_name: null, tool_version: null, rule_id: null, target_dom: null, viewport: null },
      report_outcome: "cant_tell", applicability: "undetermined", report_rationale: "Human review required", evidence_refs: [fixtureReference(run, "2026-01-01T00:00:00Z")]
    })) } };
  prepareScreening(screening);
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

test("queue locations and priority reasons survive public Japanese/English Markdown/HTML while IDs stay private; frozen runs 10 and 11 remain readable", (t) => {
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
  for (const [version, registryVersion] of [["10.0.0", "9.0.0"], ["11.0.0", "10.0.0"]]) {
    const historical = read(queued); historical.schema_version = version;
    const frozen = loadAuditResources().orchestrationRegistries.get(registryVersion);
    historical.resource_versions.orchestration_registry_version = registryVersion;
    historical.resource_versions.orchestration_registry_sha256 = frozen.sha256;
    const oldScreen = structuredClone(f.screening); oldScreen.schema_version = "3.0.0"; oldScreen.payload.schema_version = "3.0.0";
    const oldScreenFile = path.join(f.artifactRoot, `screen-${version}.json`); writeNewJson(oldScreenFile, oldScreen);
    const oldQueue = structuredClone(q);
    oldQueue.schema_version = "3.0.0";
    oldQueue.inputs.find((input) => input.artifact_id === oldScreen.artifact_id).sha256 = hash(oldScreenFile);
    if (version === "10.0.0") {
      oldQueue.payload.schema_version = "2.0.0";
      for (const entry of oldQueue.payload.items) for (const field of privateFields) delete entry[field];
    }
    const oldQueueFile = path.join(f.artifactRoot, `queue-${version}.json`); writeNewJson(oldQueueFile, oldQueue);
    for (const [artifact, file] of [[oldScreen, oldScreenFile], [oldQueue, oldQueueFile]]) {
      Object.assign(historical.artifacts.find((entry) => entry.artifact_id === artifact.artifact_id), { path: path.relative(f.artifactRoot, file).split(path.sep).join("/"), sha256: hash(file) });
    }
    const oldFile = path.join(f.root, `historical-${version}.json`); writeNewJson(oldFile, historical);
    const validation = validateAuditRun(historical, { runFile: oldFile }); assert.equal(validation.valid, true, validation.errors.join("\n"));
    pass(cli(["report", "--run", oldFile, "--assessment", merged, "--output", path.join(f.root, `historical-${version}.md`)]));
    assert.notEqual(cli(["review-queue", "--run", oldFile, "--artifact-id", "ART-OLD", "--output", path.join(f.artifactRoot, `old-${version}.json`)]).status, 0);
  }
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

test("conflicting observations keep every rationale and target in the queue and public/internal reports", (t) => {
  const f = fixture(t, undefined, (screening) => {
    screening.payload.observations.forEach((item, index) => {
      delete item.signal_class; delete item.human_review_required; delete item.evidence_provenance;
      item.report_outcome = ["pass", "fail", null][index];
      item.applicability = index === 2 ? "not_applicable" : "applicable";
      item.location = ["Product image", "Footer image", "Decorative image"][index];
      item.report_rationale = `Retained rationale ${index}`;
      item.observation = `Distinct observation ${index}`;
    });
    screening.payload.observations[1].report_rationale += " C:\\Users\\PrivateConflict\\evidence.txt";
  });
  const queue = candidate(f);
  assert.match(queue.payload.items[0].reason, /判定候補・適用判断が一致しません/);
  assert.equal(queue.payload.items[0].related_screening_observations.length, 3);
  const queued = path.join(f.root, "conflict-run.json");
  pass(cli(["register", "--run", f.screenedFile, "--artifact", f.queueFile, "--output", queued]));
  const baseline = path.join(f.root, "baseline.json"), merged = path.join(f.root, "merged.json");
  pass(cli(["assessment", "--profile", f.run.profile.id, "--target-name", f.run.target.name, "--target-version", f.run.target.version_or_commit,
    "--target-ref", f.run.target.urls_or_files[0], "--evaluator", "Synthetic fixture", "--evaluated-at", "2026-09-23", "--output", baseline]));
  const baselineValue = read(baseline); baselineValue.assessment.scope = f.run.scope; baselineValue.assessment.environment = f.run.environment;
  fs.writeFileSync(baseline, JSON.stringify(baselineValue), "utf8");
  pass(cli(["merge", "--run", queued, "--assessment", baseline, "--artifact", f.screenFile, "--artifact", f.queueFile, "--output", merged]));
  const run = read(queued), assessment = read(merged), validated = validateAuditRun(run, { runFile: queued });
  const publicModel = buildPublicReportModel({ run, assessment, envelopesById: validated.envelopesById, resources: validated.resources });
  const row = publicModel.reportChecks.find((item) => item.requirement_id === requirement);
  assert.equal(row.outcome, "cant_tell"); assert.equal(row.applicability, "undetermined");
  assert.deepEqual(row.screening_conflicts, ["report_outcome", "applicability"]);
  assert.equal(row.screening_observations.length, 3);
  assert.equal(publicModel.reportOutcomeCounts.cant_tell, 1);
  assert.doesNotMatch(JSON.stringify(publicModel), /PrivateConflict/);
  const internal = buildInternalRunBackedModel({ run, assessment, publicModel, envelopesById: validated.envelopesById });
  assert.match(JSON.stringify(internal.reportChecks.find((item) => item.requirement_id === requirement)), /PrivateConflict/);
  for (const [visibility, locale, format] of [["public", "ja", "markdown"], ["internal", "en", "html"]]) {
    const output = path.join(f.root, `conflicts-${visibility}.${format === "html" ? "html" : "md"}`);
    pass(cli(["report", "--run", queued, "--assessment", merged, "--visibility", visibility, "--locale", locale, "--format", format, "--output", output,
      ...(visibility === "public" ? ["--reviewer-disclosure", "redact", "--redaction-manifest", `${output}.redaction.json`] : [])]));
    const text = fs.readFileSync(output, "utf8");
    for (let index = 0; index < 3; index++) { assert.ok(text.includes(`Retained rationale ${index}`)); assert.ok(text.includes(`Distinct observation ${index}`)); }
    assert.ok(text.includes(locale === "ja" ? "判定候補・適用判断が一致しません" : "Observations disagree on outcome and applicability"));
    if (visibility === "public") assert.doesNotMatch(text, /PrivateConflict|ART-QUEUE-SCREEN|TARGET-[a-f0-9]{64}/);
  }
  // A unanimous not-applicable projection remains a valid report judgement.
  const unanimous = new Map([...validated.envelopesById].map(([id, record]) => [id, structuredClone(record.envelope)]));
  for (const observation of unanimous.get(f.screening.artifact_id).payload.observations) {
    observation.report_outcome = null; observation.applicability = "not_applicable";
  }
  const notApplicable = buildPublicReportModel({ run, assessment, envelopesById: unanimous, resources: validated.resources });
  assert.equal(notApplicable.notApplicableChecks[0].outcome, "not_applicable");
  assert.equal(notApplicable.notApplicableChecks[0].screening_observations.length, 3);
  assert.deepEqual(notApplicable.notApplicableChecks[0].screening_conflicts, []);
});

test("one saved observation maps to several criteria without duplicating evidence, counts or a remediation", (t) => {
  const secondRequirement = "WCAG-2.2-SC-1.3.1";
  const f = fixture(t, undefined, (screening) => {
    screening.payload.observations.length = 2;
    screening.payload.observations.forEach((item, index) => {
      for (const key of ["profile_requirement_id", "report_outcome", "applicability", "report_rationale", "signal_class", "human_review_required", "evidence_provenance"]) delete item[key];
      item.observation = `Single saved observation ${index}`;
      item.profile_mappings = [
        { requirement_id: requirement, report_outcome: index ? "pass" : "fail", applicability: "applicable", rationale: `Alternative text rationale ${index}` },
        { requirement_id: secondRequirement, report_outcome: "cant_tell", applicability: "undetermined", rationale: `Structure rationale ${index}` }
      ];
    });
  });
  const queue = candidate(f);
  assert.equal(f.screening.payload.observations.length, 2);
  assert.equal(f.screening.payload.observations.flatMap((item) => item.evidence_refs).length, 2);
  assert.equal(queue.payload.items.length, 2);
  for (const item of queue.payload.items) assert.equal(item.related_screening_observations.length, 2);
  assert.match(queue.payload.items.find((item) => item.requirement_id === requirement).reason, /判定候補が一致しません/);
  const invalidFile = path.join(f.artifactRoot, "invalid-mapping.json");
  for (const [mutate, message] of [
    [(artifact) => { artifact.payload.observations[0].profile_mappings.push({ ...artifact.payload.observations[0].profile_mappings[0], rationale: "Duplicate criterion" }); }, /must be unique per observation/],
    [(artifact) => { artifact.payload.observations[0].profile_requirement_id = requirement; }, /not allowed by schema/],
    [(artifact) => { artifact.payload.observations[0].profile_mappings[0].requirement_id = "JIS-X-8341-3-2016-SC-1.1.1"; }, /this run's profile/],
    [(artifact) => { artifact.payload.observations[1].requirement_id = artifact.payload.observations[0].requirement_id; }, /observation IDs must be unique/]
  ]) {
    const invalid = structuredClone(f.screening); mutate(invalid); fs.writeFileSync(invalidFile, JSON.stringify(invalid), "utf8");
    const result = cli(["artifact", "validate", "--run", f.runFile, "--artifact", invalidFile]);
    assert.notEqual(result.status, 0); assert.match(result.stderr, message);
  }
  const incompleteQueue = structuredClone(queue); incompleteQueue.payload.items.pop();
  assert.match(queueContextErrors(f.run, new Map([[f.screening.artifact_id, f.screening], [queue.artifact_id, incompleteQueue]]),
    loadAuditResources().standardsRegistry.profiles.find((profile) => profile.id === f.run.profile.id).requirement_ids).join("\n"), /explicitly route mapped observation/);
  const queued = path.join(f.root, "queued.json");
  pass(cli(["register", "--run", f.screenedFile, "--artifact", f.queueFile, "--output", queued]));
  const planPayload = path.join(f.artifactRoot, "plan-payload.json"), planFile = path.join(f.artifactRoot, "plan.json");
  fs.writeFileSync(planPayload, JSON.stringify({ items: [{ remediation_id: "REM-MULTI001", basis: "unverified_screening_candidate",
    requirement_id: f.screening.payload.observations[0].requirement_id, source_artifact_ids: [f.screening.artifact_id], priority: "P1",
    location: "Product image", affected_users: ["Screen reader users"], issue: "One synthetic barrier candidate",
    proposed_change: "Review the shared label and structure", verification: "Check both related criteria", residual_limitation: "Human confirmation is pending" }] }), "utf8");
  pass(cli(["artifact", "init", "--run", queued, "--type", "remediation-plan", "--payload", planPayload, "--input", f.screening.artifact_id, "--output", planFile]));
  const finalRun = path.join(f.root, "planned.json");
  pass(cli(["register", "--run", queued, "--artifact", planFile, "--output", finalRun]));
  const baseline = path.join(f.root, "baseline.json"), merged = path.join(f.root, "merged.json");
  pass(cli(["assessment", "--profile", f.run.profile.id, "--target-name", f.run.target.name, "--target-version", f.run.target.version_or_commit,
    "--target-ref", f.run.target.urls_or_files[0], "--evaluator", "Synthetic fixture", "--evaluated-at", "2026-09-23", "--output", baseline]));
  const initial = read(baseline); initial.assessment.scope = f.run.scope; initial.assessment.environment = f.run.environment;
  fs.writeFileSync(baseline, JSON.stringify(initial), "utf8");
  pass(cli(["merge", "--run", finalRun, "--assessment", baseline, "--artifact", f.screenFile, "--artifact", f.queueFile, "--artifact", planFile, "--output", merged]));
  const run = read(finalRun), assessment = read(merged), validated = validateAuditRun(run, { runFile: finalRun }), resources = validated.resources;
  const model = buildPublicReportModel({ run, assessment, envelopesById: validated.envelopesById, resources });
  const presentation = buildRunBackedPresentation({ run, assessment, publicModel: model, registry: resources.standardsRegistry, catalog: resources.criteriaCatalog, locale: "en",
    validation: validateAssessment(assessment, resources.standardsRegistry, resources.assessmentSchema, resources.criteriaCatalog, resources.auditMethods) });
  assert.deepEqual(presentation.screening_summary, { observation_count: 2, barrier_candidate_count: 1, mapped_requirement_count: 2, conflicting_requirement_count: 1 });
  assert.equal(presentation.inspection_records.length, 2);
  assert.equal(presentation.findings.length, 1);
  assert.deepEqual(presentation.findings[0].related_requirement_ids, [requirement, secondRequirement]);
  for (const criterion of [requirement, secondRequirement]) {
    const row = presentation.rows.find((item) => item.requirement_id === criterion);
    assert.equal(row.outcome, "cant_tell"); assert.equal(row.screening_observations.length, 2);
  }
  for (const [locale, format] of [["ja", "markdown"], ["en", "html"]]) {
    const output = path.join(f.root, `multi-${locale}.${format === "html" ? "html" : "md"}`);
    pass(cli(["report", "--run", finalRun, "--assessment", merged, "--locale", locale, "--format", format, "--output", output]));
    const text = fs.readFileSync(output, "utf8");
    for (const phrase of ["Alternative text rationale 0", "Alternative text rationale 1", "Structure rationale 0", "Structure rationale 1"]) assert.ok(text.includes(phrase));
    assert.ok(text.includes(locale === "ja" ? "問題候補数（人手未確認）" : "Unique barrier candidates (unverified)"));
  }
});
