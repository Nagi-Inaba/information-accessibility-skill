import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import {
  loadAuditResources,
  mergeArtifacts as mergeArtifactRecords,
  writeNewJson
} from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "codex/skills/information-accessibility-practice");
const scripts = path.join(skillRoot, "scripts");
const createRun = path.join(scripts, "create-audit-run.mjs");
const validateRun = path.join(scripts, "validate-audit-run.mjs");
const registerArtifact = path.join(scripts, "register-audit-artifact.mjs");
const mergeArtifactsCli = path.join(scripts, "merge-audit-artifacts.mjs");
const references = path.join(skillRoot, "references");
const runId = "RUN-20260717T120000Z-TEST0001";

function runNode(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function resourceVersions() {
  const standards = readJson(path.join(references, "standards-registry.json"));
  const orchestration = readJson(path.join(references, "orchestration-registry.json"));
  return {
    standards_registry_version: standards.schema_version,
    orchestration_registry_version: orchestration.schema_version,
    orchestration_registry_sha256: sha256File(path.join(references, "orchestration-registry.json")),
    criteria_catalog_sha256: sha256File(path.join(references, "criteria-catalog.json")),
    criterion_procedures_sha256: sha256File(path.join(references, "criterion-procedures.json")),
    audit_methods_sha256: sha256File(path.join(references, "web-audit-methods.json"))
  };
}

function initialRun(artifactRoot) {
  return {
    schema_version: "1.0.0",
    run_id: runId,
    supersedes_run_id: null,
    status: "initialized",
    target: { name: "Local fixture", version_or_commit: "fixture-v1", urls_or_files: ["http://127.0.0.1:4173/"] },
    profile: { id: "web-modern", registry_version: "1.0.0" },
    scope: { included: ["http://127.0.0.1:4173/"], excluded: [], complete_processes: [], third_party_content: [], full_pages_reviewed: false },
    environment: { os: ["not_declared"], browsers: [], assistive_technologies: [], input_modes: [] },
    permissions: {
      network: "allowlisted",
      interaction: "read_only",
      source_write: "denied",
      allowed_actions: ["inspect_without_mutation", "read_allowlisted_resources"],
      forbidden_actions: ["execute_commands", "network_outside_allowlist", "write_target"]
    },
    resource_versions: resourceVersions(),
    artifact_root: path.basename(artifactRoot),
    artifacts: [],
    history: [],
    limitations: ["The environment was not declared; no profile outcome has been recorded."]
  };
}

function screeningEnvelope({ artifactId, requirementId, capturedAt = "2026-07-17T12:00:01Z" }) {
  return {
    schema_version: "1.0.0",
    artifact_id: artifactId,
    artifact_type: "screening-observations",
    run_id: runId,
    producer: { role_id: "e1_inspector", producer_kind: "ai_agent", origin: "test fixture" },
    created_at: capturedAt,
    inputs: [],
    payload: {
      schema_version: "1.0.0",
      observations: [{
        requirement_id: requirementId,
        evidence_level: "E1",
        method: "DOM inspection",
        location: "main heading",
        observation: `Unverified observation for ${requirementId}`,
        captured_at: capturedAt
      }]
    }
  };
}

function queuePayload(requirementId = "WCAG-2.2-SC-1.1.1") {
  return {
    schema_version: "1.0.0",
    items: [{
      requirement_id: requirementId,
      procedure_availability: "available",
      procedure_ref: "criterion-procedures:1.0.0#wcag22-sc-1-1-1-non-text-content",
      human_actions: ["Inspect the target-specific text alternative."],
      required_evidence_types: ["browser_inspection", "manual_observation"],
      cant_tell_conditions: ["The computed alternative cannot be observed."]
    }],
    procedure_coverage: { total_requirements: 1, available_procedures: 1, unavailable_procedures: 0 }
  };
}

function artifactEnvelope({
  artifactId,
  artifactType,
  roleId,
  producerKind = "ai_agent",
  inputs = [],
  payload,
  createdAt = "2026-07-17T12:00:03Z",
  envelopeRunId = runId
}) {
  return {
    schema_version: "1.0.0",
    artifact_id: artifactId,
    artifact_type: artifactType,
    run_id: envelopeRunId,
    producer: { role_id: roleId, producer_kind: producerKind, origin: "test fixture" },
    created_at: createdAt,
    inputs,
    payload
  };
}

function queueEnvelope({ artifactId = "ART-QUEUE-001", inputs = [], payload = queuePayload() } = {}) {
  return artifactEnvelope({ artifactId, artifactType: "human-review-queue", roleId: "human_queue_planner", inputs, payload });
}

function declaredHumanPayload(requirementId = "WCAG-2.2-SC-1.1.1", profileOutcome = "pass") {
  return {
    schema_version: "1.0.0",
    declaration: "I declare that I performed the recorded review as an external human reviewer.",
    reviewer_name: "External Reviewer",
    review_date: "2026-07-17",
    identity_authenticated: false,
    reviews: [{
      requirement_id: requirementId,
      procedure_availability: "available",
      criterion_procedure_ref: "criterion-procedures:1.0.0#wcag22-sc-1-1-1-non-text-content",
      generic_method_ref: null,
      official_sources: ["https://www.w3.org/TR/WCAG22/#non-text-content"],
      target_specific_evidence: [{
        type: "browser_inspection",
        location: "main image",
        observation: "The computed alternative was inspected against the visible context.",
        captured_at: "2026-07-17T12:00:04Z"
      }],
      profile_outcome: profileOutcome,
      rationale: "The target-specific evidence supports the recorded result."
    }]
  };
}

function fixAuthorizationPayload() {
  return {
    schema_version: "1.0.0",
    authorization_id: "AUTH-20260717-TEST0001",
    run_id: runId,
    authorizer_role: "declared_authorizer",
    authorizer_kind: "external_requester",
    authorized_by: "Requester",
    identity_authenticated: false,
    declaration: "I authorize only the listed files and structured command data.",
    issued_at: "2026-07-17T12:00:05Z",
    target_root: "target",
    allowed_files: ["index.html"],
    commands: [{ executable: "npm", args: ["test"], cwd: "target" }],
    remediation_artifact: { artifact_id: "ART-REMEDIATION-001", sha256: "a".repeat(64) }
  };
}

function remediationPayload(sourceArtifactId, requirementId = "SCREEN-FIRST") {
  return {
    schema_version: "1.0.0",
    items: [{
      remediation_id: "REM-TEST0001",
      basis: "unverified_screening_candidate",
      requirement_id: requirementId,
      source_artifact_ids: [sourceArtifactId],
      issue: "Unverified screening candidate requiring review.",
      proposed_change: "Prepare a bounded candidate change for authorization.",
      verification: "Retest the same screening check after an authorized change."
    }]
  };
}

function changePayload(authorizationArtifactId, authorizationHash) {
  return {
    schema_version: "1.0.0",
    change_id: "CHANGE-20260717-TEST0001",
    run_id: runId,
    authorization_id: "AUTH-20260717-TEST0001",
    authorization_artifact: { artifact_id: authorizationArtifactId, sha256: authorizationHash },
    changed_files: [{ path: "index.html", before_sha256: null, after_sha256: "b".repeat(64), description: "Declared test change record." }],
    verification: ["Recorded only; this orchestration code did not execute the command or write the target."],
    next_status: "retest_required"
  };
}

function makeHumanReviewRun(artifactRoot, requirementId = "WCAG-2.2-SC-1.1.1") {
  const screen = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-FIRST" });
  const screenFile = path.join(artifactRoot, "screen.json");
  writeJson(screenFile, screen);
  const screenHash = sha256File(screenFile);
  const queue = queueEnvelope({ inputs: [{ artifact_id: screen.artifact_id, run_id: runId, sha256: screenHash }] });
  const queueFile = path.join(artifactRoot, "queue.json");
  writeJson(queueFile, queue);
  const human = artifactEnvelope({
    artifactId: "ART-HUMAN-001",
    artifactType: "declared-human-review",
    roleId: "declared_external_human",
    producerKind: "external_human",
    createdAt: "2026-07-17T12:00:04Z",
    inputs: [{ artifact_id: queue.artifact_id, run_id: runId, sha256: sha256File(queueFile) }],
    payload: declaredHumanPayload(requirementId)
  });
  const humanFile = path.join(artifactRoot, "human.json");
  writeJson(humanFile, human);
  const run = initialRun(artifactRoot);
  run.status = "human_review_recorded";
  run.artifacts = [
    registerEntry(artifactRoot, screenFile, screen),
    registerEntry(artifactRoot, queueFile, queue),
    registerEntry(artifactRoot, humanFile, human)
  ].sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
  run.history = [
    { from: "initialized", to: "screened", at: screen.created_at, actor_role: "e1_inspector", artifact_ids: [screen.artifact_id] },
    { from: "screened", to: "human_queue_ready", at: queue.created_at, actor_role: "human_queue_planner", artifact_ids: [queue.artifact_id] },
    { from: "human_queue_ready", to: "human_review_recorded", at: human.created_at, actor_role: "declared_external_human", artifact_ids: [human.artifact_id] }
  ];
  return { run, screenFile, queueFile, humanFile, human };
}

function assessmentFixture() {
  const assessment = generateAssessment("web-modern", {
    targetName: "Local fixture",
    targetVersion: "fixture-v1",
    targetRefs: ["http://127.0.0.1:4173/"],
    evaluator: "Audit orchestrator",
    evaluatedAt: "2026-07-17"
  });
  assessment.assessment.scope.included = ["http://127.0.0.1:4173/"];
  assessment.assessment.environment = { os: ["not_declared"], browsers: [], assistive_technologies: [], input_modes: [] };
  return assessment;
}

function screenedRun(artifactRoot, artifactFile, artifact) {
  const run = initialRun(artifactRoot);
  run.status = "screened";
  run.artifacts = [registerEntry(artifactRoot, artifactFile, artifact)];
  run.history = [{
    from: "initialized",
    to: "screened",
    at: artifact.created_at,
    actor_role: "e1_inspector",
    artifact_ids: [artifact.artifact_id]
  }];
  return run;
}

function assertRejected(result, pattern) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(`${result.stderr}\n${result.stdout}`, pattern);
}

function registerEntry(artifactRoot, file, artifact) {
  return {
    artifact_id: artifact.artifact_id,
    artifact_type: artifact.artifact_type,
    path: path.relative(artifactRoot, file).split(path.sep).join("/"),
    sha256: sha256File(file),
    producer_role: artifact.producer.role_id,
    created_at: artifact.created_at,
    validation_status: "valid"
  };
}

function withTemp(t, callback) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-orchestration-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const artifactRoot = path.join(temp, "artifacts");
  fs.mkdirSync(artifactRoot);
  return callback({ temp, artifactRoot });
}

test("run initialization creates a schema-valid immutable manifest with installed resource hashes", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const output = path.join(temp, "audit-run.v1.json");
  const result = runNode(createRun, [
    "--run-id", runId,
    "--profile", "web-modern",
    "--target-name", "Local fixture",
    "--target-version", "fixture-v1",
    "--target-ref", "http://127.0.0.1:4173/",
    "--artifact-root", artifactRoot,
    "--network", "local_read_only",
    "--interaction", "safe_read_only",
    "--source-write", "none",
    "--output", output
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const run = readJson(output);
  assert.equal(run.status, "initialized");
  assert.equal(run.artifact_root, "artifacts");
  assert.deepEqual(run.permissions, initialRun(artifactRoot).permissions);
  assert.deepEqual(run.resource_versions, resourceVersions());
  assert.equal(run.resource_versions.orchestration_registry_sha256, "75485a0c4c616261963f1cdc92f39841ac6d31a668e789431eb0b5a35fa90fe5");

  const overwrite = runNode(createRun, [
    "--run-id", runId, "--profile", "web-modern", "--target-name", "Local fixture",
    "--target-version", "fixture-v1", "--target-ref", "http://127.0.0.1:4173/",
    "--artifact-root", artifactRoot, "--network", "local_read_only",
    "--interaction", "safe_read_only", "--source-write", "none", "--output", output
  ]);
  assert.notEqual(overwrite.status, 0);
  assert.match(overwrite.stderr, /overwrite/i);
}));

test("artifact registration validates and versions the run without mutating v1", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const runV1 = path.join(temp, "audit-run.v1.json");
  const runV2 = path.join(temp, "audit-run.v2.json");
  const artifactFile = path.join(artifactRoot, "screening.json");
  const artifact = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-ARIA-NAME" });
  writeJson(runV1, initialRun(artifactRoot));
  writeJson(artifactFile, artifact);
  const before = fs.readFileSync(runV1);

  const result = runNode(registerArtifact, ["--run", runV1, "--artifact", artifactFile, "--output", runV2]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(fs.readFileSync(runV1), before);
  const next = readJson(runV2);
  assert.equal(next.status, "screened");
  assert.deepEqual(next.artifacts.map((entry) => entry.artifact_id), ["ART-SCREEN-001"]);
  assert.deepEqual(next.history, [{
    from: "initialized",
    to: "screened",
    at: artifact.created_at,
    actor_role: "e1_inspector",
    artifact_ids: [artifact.artifact_id]
  }]);
}));

test("merge output is byte-identical when registered screening artifacts are supplied in opposite orders", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const firstFile = path.join(artifactRoot, "first.json");
  const secondFile = path.join(artifactRoot, "second.json");
  const first = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-ARIA-NAME" });
  const second = screeningEnvelope({ artifactId: "ART-SCREEN-002", requirementId: "SCREEN-ARIA-ROLE", capturedAt: "2026-07-17T12:00:02Z" });
  writeJson(firstFile, first);
  writeJson(secondFile, second);

  const run = initialRun(artifactRoot);
  run.status = "screened";
  run.artifacts = [registerEntry(artifactRoot, secondFile, second), registerEntry(artifactRoot, firstFile, first)]
    .sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
  run.history = [{ from: "initialized", to: "screened", at: first.created_at, actor_role: "e1_inspector", artifact_ids: [first.artifact_id] }];
  const runFile = path.join(temp, "audit-run.v3.json");
  writeJson(runFile, run);

  const assessment = generateAssessment("web-modern", {
    targetName: "Local fixture",
    targetVersion: "fixture-v1",
    targetRefs: ["http://127.0.0.1:4173/"],
    evaluator: "Audit orchestrator",
    evaluatedAt: "2026-07-17"
  });
  assessment.assessment.scope.included = ["http://127.0.0.1:4173/"];
  assessment.assessment.environment = { os: ["not_declared"], browsers: [], assistive_technologies: [], input_modes: [] };
  const assessmentFile = path.join(temp, "assessment.json");
  writeJson(assessmentFile, assessment);
  const outputA = path.join(temp, "merged-a.json");
  const outputB = path.join(temp, "merged-b.json");

  const common = ["--run", runFile, "--assessment", assessmentFile];
  const a = runNode(mergeArtifactsCli, [...common, "--artifact", firstFile, "--artifact", secondFile, "--output", outputA]);
  const b = runNode(mergeArtifactsCli, [...common, "--artifact", secondFile, "--artifact", firstFile, "--output", outputB]);
  assert.equal(a.status, 0, a.stderr || a.stdout);
  assert.equal(b.status, 0, b.stderr || b.stdout);
  assert.deepEqual(fs.readFileSync(outputA), fs.readFileSync(outputB));
  const merged = readJson(outputA);
  const screening = merged.assessment.results.filter((item) => item.requirement_kind === "screening_check");
  assert.deepEqual(screening.map((item) => item.requirement_id), ["SCREEN-ARIA-NAME", "SCREEN-ARIA-ROLE"]);
  assert.ok(screening.every((item) => item.mapping_status === "unverified" && item.outcome === "cant_tell"));
  assert.deepEqual(merged.assessment.findings, []);
}));

test("initialization rejects invalid run IDs and output paths redirected through a junction", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const invalidOutput = path.join(temp, "invalid-run.json");
  const invalid = runNode(createRun, [
    "--run-id", "AUDIT-TEST-001", "--profile", "web-modern", "--target-name", "Local fixture",
    "--target-version", "fixture-v1", "--target-ref", "http://127.0.0.1:4173/",
    "--artifact-root", artifactRoot, "--network", "local_read_only",
    "--interaction", "safe_read_only", "--source-write", "none", "--output", invalidOutput
  ]);
  assertRejected(invalid, /run[_ -]?id|RUN-/i);
  assert.equal(fs.existsSync(invalidOutput), false);

  const actualOutput = path.join(temp, "redirect-target");
  const redirectedOutput = path.join(temp, "redirected-output");
  fs.mkdirSync(actualOutput);
  try {
    fs.symlinkSync(actualOutput, redirectedOutput, "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "UNKNOWN"].includes(error.code)) {
      t.skip(`Junction creation unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const redirected = runNode(createRun, [
    "--run-id", runId, "--profile", "web-modern", "--target-name", "Local fixture",
    "--target-version", "fixture-v1", "--target-ref", "http://127.0.0.1:4173/",
    "--artifact-root", artifactRoot, "--network", "local_read_only",
    "--interaction", "safe_read_only", "--source-write", "none",
    "--output", path.join(redirectedOutput, "run.json")
  ]);
  assertRejected(redirected, /unsafe|reparse|symbolic|junction/i);
  assert.equal(fs.existsSync(path.join(actualOutput, "run.json")), false);
}));

test("validation rejects caller-tampered installed resource hashes", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const run = initialRun(artifactRoot);
  run.resource_versions.orchestration_registry_sha256 = "0".repeat(64);
  const input = path.join(temp, "tampered-run.json");
  const output = path.join(temp, "validation.json");
  writeJson(input, run);
  const result = runNode(validateRun, ["--input", input, "--output", output]);
  assertRejected(result, /orchestration.*sha|resource.*hash/i);
  assert.equal(readJson(output).valid, false);
}));

test("registration rejects traversal, outside absolute paths, the artifact root, and directories", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const runFile = path.join(temp, "audit-run.v1.json");
  writeJson(runFile, initialRun(artifactRoot));
  const outside = path.join(temp, "outside.json");
  writeJson(outside, screeningEnvelope({ artifactId: "ART-OUTSIDE-001", requirementId: "SCREEN-OUTSIDE" }));
  const cases = [
    [path.join(artifactRoot, "..", "outside.json"), /traversal|outside.*root/i],
    [outside, /outside.*root/i],
    [artifactRoot, /artifact.*file|root itself/i],
    [path.join(artifactRoot, "directory"), /artifact.*file|directory/i]
  ];
  fs.mkdirSync(path.join(artifactRoot, "directory"));
  for (const [candidate, pattern] of cases) {
    const output = path.join(temp, `rejected-${crypto.randomUUID()}.json`);
    const result = runNode(registerArtifact, ["--run", runFile, "--artifact", candidate, "--output", output]);
    assertRejected(result, pattern);
    assert.equal(fs.existsSync(output), false);
  }
}));

test("registration rejects artifact access through file symlinks and directory junctions", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const runFile = path.join(temp, "audit-run.v1.json");
  writeJson(runFile, initialRun(artifactRoot));
  const outsideDir = path.join(temp, "outside-dir");
  fs.mkdirSync(outsideDir);
  const outsideFile = path.join(outsideDir, "artifact.json");
  writeJson(outsideFile, screeningEnvelope({ artifactId: "ART-REPARSE-001", requirementId: "SCREEN-REPARSE" }));
  const linkFile = path.join(artifactRoot, "linked-artifact.json");
  const junctionDir = path.join(artifactRoot, "linked-directory");
  let fileLinkAvailable = true;
  try {
    fs.symlinkSync(outsideFile, linkFile, "file");
  } catch (error) {
    if (["EPERM", "EACCES", "UNKNOWN"].includes(error.code)) fileLinkAvailable = false;
    else throw error;
  }
  try {
    fs.symlinkSync(outsideDir, junctionDir, "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "UNKNOWN"].includes(error.code)) {
      if (!fileLinkAvailable) t.skip(`Reparse creation unavailable: ${error.code}`);
    } else throw error;
  }
  const candidates = [];
  if (fileLinkAvailable) candidates.push(linkFile);
  if (fs.existsSync(junctionDir)) candidates.push(path.join(junctionDir, "artifact.json"));
  for (const candidate of candidates) {
    const output = path.join(temp, `reparse-${crypto.randomUUID()}.json`);
    const result = runNode(registerArtifact, ["--run", runFile, "--artifact", candidate, "--output", output]);
    assertRejected(result, /unsafe|reparse|symbolic|junction|outside.*root/i);
    assert.equal(fs.existsSync(output), false);
  }
}));

test("registration rejects duplicate artifact IDs and canonical artifact paths", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const firstFile = path.join(artifactRoot, "first.json");
  const duplicateIdFile = path.join(artifactRoot, "duplicate-id.json");
  const first = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-FIRST" });
  const duplicateId = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-SECOND", capturedAt: "2026-07-17T12:00:02Z" });
  writeJson(firstFile, first);
  writeJson(duplicateIdFile, duplicateId);
  const run = screenedRun(artifactRoot, firstFile, first);
  const runFile = path.join(temp, "audit-run.v2.json");
  writeJson(runFile, run);
  const duplicateIdResult = runNode(registerArtifact, ["--run", runFile, "--artifact", duplicateIdFile, "--output", path.join(temp, "duplicate-id-run.json")]);
  assertRejected(duplicateIdResult, /duplicate artifact id/i);

  const samePathArtifact = screeningEnvelope({ artifactId: "ART-SCREEN-NEW", requirementId: "SCREEN-NEW" });
  writeJson(firstFile, samePathArtifact);
  run.artifacts[0] = { ...registerEntry(artifactRoot, firstFile, samePathArtifact), artifact_id: "ART-SCREEN-OLD" };
  writeJson(runFile, run);
  const duplicatePathResult = runNode(registerArtifact, ["--run", runFile, "--artifact", firstFile, "--output", path.join(temp, "duplicate-path-run.json")]);
  assertRejected(duplicatePathResult, /duplicate artifact path|registered artifact metadata/i);
}));

test("registration dispatches the type-specific payload schema and enforces exact producer output", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const runFile = path.join(temp, "audit-run.v1.json");
  writeJson(runFile, initialRun(artifactRoot));
  const wrongPayloadFile = path.join(artifactRoot, "wrong-payload.json");
  const wrongPayload = screeningEnvelope({ artifactId: "ART-WRONG-PAYLOAD", requirementId: "SCREEN-WRONG" });
  wrongPayload.payload = queuePayload();
  writeJson(wrongPayloadFile, wrongPayload);
  assertRejected(
    runNode(registerArtifact, ["--run", runFile, "--artifact", wrongPayloadFile, "--output", path.join(temp, "wrong-payload-run.json")]),
    /payload|screening-observations/i
  );

  const wrongProducerFile = path.join(artifactRoot, "wrong-producer.json");
  const wrongProducer = artifactEnvelope({
    artifactId: "ART-HUMAN-WRONG",
    artifactType: "declared-human-review",
    roleId: "e1_inspector",
    payload: declaredHumanPayload()
  });
  writeJson(wrongProducerFile, wrongProducer);
  assertRejected(
    runNode(registerArtifact, ["--run", runFile, "--artifact", wrongProducerFile, "--output", path.join(temp, "wrong-producer-run.json")]),
    /producer|role|output/i
  );
}));

test("every AI role is rejected as a producer of fix authorization", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const runFile = path.join(temp, "audit-run.v1.json");
  writeJson(runFile, initialRun(artifactRoot));
  const aiRoles = ["orchestrator", "e1_inspector", "human_queue_planner", "remediation_planner", "authorized_fixer"];
  for (const [index, roleId] of aiRoles.entries()) {
    const artifact = artifactEnvelope({
      artifactId: `ART-AI-AUTH-${String(index + 1).padStart(2, "0")}`,
      artifactType: "fix-authorization",
      roleId,
      payload: fixAuthorizationPayload()
    });
    const file = path.join(artifactRoot, `ai-auth-${index}.json`);
    writeJson(file, artifact);
    const result = runNode(registerArtifact, ["--run", runFile, "--artifact", file, "--output", path.join(temp, `ai-auth-run-${index}.json`)]);
    assertRejected(result, /fix-authorization|declared_authorizer|AI role|producer/i);
  }
}));

test("registration rejects missing, cross-run, and mismatched input artifact references", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const screenFile = path.join(artifactRoot, "screening.json");
  const screen = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-FIRST" });
  writeJson(screenFile, screen);
  const runFile = path.join(temp, "audit-run.v2.json");
  writeJson(runFile, screenedRun(artifactRoot, screenFile, screen));
  const recordedHash = sha256File(screenFile);
  const cases = [
    [{ artifact_id: "ART-MISSING-001", run_id: runId, sha256: recordedHash }, /missing|not registered/i],
    [{ artifact_id: screen.artifact_id, run_id: "RUN-20260717T120000Z-OTHER001", sha256: recordedHash }, /same run|run[_ -]?id/i],
    [{ artifact_id: screen.artifact_id, run_id: runId, sha256: "0".repeat(64) }, /input.*sha|hash mismatch/i]
  ];
  for (const [index, [input, pattern]] of cases.entries()) {
    const queue = queueEnvelope({ artifactId: `ART-QUEUE-00${index + 1}`, inputs: [input] });
    const file = path.join(artifactRoot, `queue-${index}.json`);
    writeJson(file, queue);
    const result = runNode(registerArtifact, ["--run", runFile, "--artifact", file, "--output", path.join(temp, `queue-run-${index}.json`)]);
    assertRejected(result, pattern);
  }
}));

test("registration detects mutation of a previously registered input before accepting a dependent artifact", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const screenFile = path.join(artifactRoot, "screening.json");
  const screen = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-FIRST" });
  writeJson(screenFile, screen);
  const recordedHash = sha256File(screenFile);
  const runFile = path.join(temp, "audit-run.v2.json");
  writeJson(runFile, screenedRun(artifactRoot, screenFile, screen));
  screen.payload.observations[0].observation = "Mutated after registration";
  writeJson(screenFile, screen);

  const queue = queueEnvelope({ inputs: [{ artifact_id: screen.artifact_id, run_id: runId, sha256: recordedHash }] });
  const queueFile = path.join(artifactRoot, "queue.json");
  writeJson(queueFile, queue);
  const output = path.join(temp, "audit-run.v3.json");
  const result = runNode(registerArtifact, ["--run", runFile, "--artifact", queueFile, "--output", output]);
  assertRejected(result, /changed|current.*hash|hash mismatch/i);
  assert.equal(fs.existsSync(output), false);
}));

test("registration allows another current-stage screening artifact but rejects a future-stage artifact", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const firstFile = path.join(artifactRoot, "first.json");
  const first = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-FIRST" });
  writeJson(firstFile, first);
  const runFile = path.join(temp, "audit-run.v2.json");
  writeJson(runFile, screenedRun(artifactRoot, firstFile, first));

  const secondFile = path.join(artifactRoot, "second.json");
  const second = screeningEnvelope({ artifactId: "ART-SCREEN-002", requirementId: "SCREEN-SECOND", capturedAt: "2026-07-17T12:00:02Z" });
  writeJson(secondFile, second);
  const sameStageOutput = path.join(temp, "audit-run.v3.json");
  const sameStage = runNode(registerArtifact, ["--run", runFile, "--artifact", secondFile, "--output", sameStageOutput]);
  assert.equal(sameStage.status, 0, sameStage.stderr || sameStage.stdout);
  const sameStageRun = readJson(sameStageOutput);
  assert.equal(sameStageRun.status, "screened");
  assert.equal(sameStageRun.history.length, 1);
  assert.deepEqual(sameStageRun.artifacts.map((entry) => entry.artifact_id), ["ART-SCREEN-001", "ART-SCREEN-002"]);

  const initialFile = path.join(temp, "initial-run.json");
  writeJson(initialFile, initialRun(artifactRoot));
  const queueFile = path.join(artifactRoot, "future-queue.json");
  writeJson(queueFile, queueEnvelope());
  const future = runNode(registerArtifact, ["--run", initialFile, "--artifact", queueFile, "--output", path.join(temp, "future-run.json")]);
  assertRejected(future, /transition|future|initialized/i);
}));

test("run validation rejects invalid transition continuity and status/history disagreement", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const cases = [];
  const skipped = initialRun(artifactRoot);
  skipped.status = "retest_required";
  skipped.history = [{ from: "initialized", to: "retest_required", at: "2026-07-17T12:00:01Z", actor_role: "authorized_fixer", artifact_ids: ["ART-CHANGE-001"] }];
  cases.push([skipped, /transition|initialized.*retest_required/i]);
  const disagreement = initialRun(artifactRoot);
  disagreement.status = "screened";
  cases.push([disagreement, /status|history|continuity/i]);
  for (const [index, [run, pattern]] of cases.entries()) {
    const input = path.join(temp, `invalid-history-${index}.json`);
    const output = path.join(temp, `invalid-history-result-${index}.json`);
    writeJson(input, run);
    const result = runNode(validateRun, ["--input", input, "--output", output]);
    assertRejected(result, pattern);
    assert.equal(readJson(output).valid, false);
  }
}));

test("merge rejects duplicate screening IDs instead of order-dependent overwrite", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const firstFile = path.join(artifactRoot, "first.json");
  const secondFile = path.join(artifactRoot, "second.json");
  const first = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-DUPLICATE" });
  const second = screeningEnvelope({ artifactId: "ART-SCREEN-002", requirementId: "SCREEN-DUPLICATE", capturedAt: "2026-07-17T12:00:02Z" });
  writeJson(firstFile, first);
  writeJson(secondFile, second);
  const run = screenedRun(artifactRoot, firstFile, first);
  run.artifacts.push(registerEntry(artifactRoot, secondFile, second));
  const runFile = path.join(temp, "run.json");
  const assessmentFile = path.join(temp, "assessment.json");
  writeJson(runFile, run);
  writeJson(assessmentFile, assessmentFixture());
  const result = runNode(mergeArtifactsCli, [
    "--run", runFile, "--assessment", assessmentFile,
    "--artifact", firstFile, "--artifact", secondFile,
    "--output", path.join(temp, "merged.json")
  ]);
  assertRejected(result, /duplicate.*SCREEN-DUPLICATE|screening.*conflict/i);
}));

test("merge rejects AI-produced declared human review and any profile-outcome injection", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const maliciousFile = path.join(artifactRoot, "malicious-human.json");
  const malicious = artifactEnvelope({
    artifactId: "ART-HUMAN-MALICIOUS",
    artifactType: "declared-human-review",
    roleId: "e1_inspector",
    payload: declaredHumanPayload()
  });
  writeJson(maliciousFile, malicious);
  const run = initialRun(artifactRoot);
  run.status = "human_review_recorded";
  run.artifacts = [registerEntry(artifactRoot, maliciousFile, malicious)];
  run.history = [
    { from: "initialized", to: "screened", at: "2026-07-17T12:00:01Z", actor_role: "e1_inspector", artifact_ids: ["ART-PLACEHOLDER-SCREEN"] },
    { from: "screened", to: "human_queue_ready", at: "2026-07-17T12:00:02Z", actor_role: "human_queue_planner", artifact_ids: ["ART-PLACEHOLDER-QUEUE"] },
    { from: "human_queue_ready", to: "human_review_recorded", at: malicious.created_at, actor_role: "e1_inspector", artifact_ids: [malicious.artifact_id] }
  ];
  const runFile = path.join(temp, "run.json");
  const assessmentFile = path.join(temp, "assessment.json");
  writeJson(runFile, run);
  writeJson(assessmentFile, assessmentFixture());
  const result = runNode(mergeArtifactsCli, [
    "--run", runFile, "--assessment", assessmentFile,
    "--artifact", maliciousFile, "--output", path.join(temp, "merged.json")
  ]);
  assertRejected(result, /declared_external_human|producer|profile outcome|role/i);
}));

test("declared external human review updates only the exact profile row and passes the existing validator", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const { run, screenFile, queueFile, humanFile } = makeHumanReviewRun(artifactRoot);
  const runFile = path.join(temp, "run.json");
  const assessmentFile = path.join(temp, "assessment.json");
  const output = path.join(temp, "merged.json");
  writeJson(runFile, run);
  writeJson(assessmentFile, assessmentFixture());
  const result = runNode(mergeArtifactsCli, [
    "--run", runFile, "--assessment", assessmentFile,
    "--artifact", screenFile, "--artifact", queueFile, "--artifact", humanFile,
    "--output", output
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const merged = readJson(output);
  const reviewed = merged.assessment.results.filter((item) => item.mapping_status === "human_verified");
  assert.deepEqual(reviewed.map((item) => item.requirement_id), ["WCAG-2.2-SC-1.1.1"]);
  assert.equal(reviewed[0].outcome, "pass");
  assert.equal(merged.assessment.evidence_level, "E2");
  assert.equal(JSON.parse(result.stdout).assessment_valid, true);
}));

test("merge rejects unregistered and duplicate declared-human profile rows", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const unregistered = makeHumanReviewRun(artifactRoot, "WCAG-9.9-SC-9.9.9");
  const unregisteredRunFile = path.join(temp, "unregistered-run.json");
  const assessmentFile = path.join(temp, "assessment.json");
  writeJson(unregisteredRunFile, unregistered.run);
  writeJson(assessmentFile, assessmentFixture());
  const unregisteredResult = runNode(mergeArtifactsCli, [
    "--run", unregisteredRunFile, "--assessment", assessmentFile,
    "--artifact", unregistered.screenFile, "--artifact", unregistered.queueFile, "--artifact", unregistered.humanFile,
    "--output", path.join(temp, "unregistered-merged.json")
  ]);
  assertRejected(unregisteredResult, /not registered|exact profile row/i);

  fs.rmSync(artifactRoot, { recursive: true, force: true });
  fs.mkdirSync(artifactRoot);
  const valid = makeHumanReviewRun(artifactRoot);
  const duplicate = JSON.parse(fs.readFileSync(valid.humanFile, "utf8"));
  duplicate.artifact_id = "ART-HUMAN-002";
  duplicate.created_at = "2026-07-17T12:00:05Z";
  const duplicateFile = path.join(artifactRoot, "human-duplicate.json");
  writeJson(duplicateFile, duplicate);
  valid.run.artifacts.push(registerEntry(artifactRoot, duplicateFile, duplicate));
  valid.run.artifacts.sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
  const duplicateRunFile = path.join(temp, "duplicate-run.json");
  writeJson(duplicateRunFile, valid.run);
  const duplicateResult = runNode(mergeArtifactsCli, [
    "--run", duplicateRunFile, "--assessment", assessmentFile,
    "--artifact", valid.screenFile, "--artifact", valid.queueFile, "--artifact", valid.humanFile, "--artifact", duplicateFile,
    "--output", path.join(temp, "duplicate-merged.json")
  ]);
  assertRejected(duplicateResult, /duplicate.*WCAG-2\.2-SC-1\.1\.1|profile.*conflict/i);
}));

test("queue, remediation, authorization, and change records never alter profile outcomes", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const screen = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-FIRST" });
  const screenFile = path.join(artifactRoot, "screen.json");
  writeJson(screenFile, screen);
  const queue = queueEnvelope({ inputs: [{ artifact_id: screen.artifact_id, run_id: runId, sha256: sha256File(screenFile) }] });
  const queueFile = path.join(artifactRoot, "queue.json");
  writeJson(queueFile, queue);
  const remediation = artifactEnvelope({
    artifactId: "ART-REMEDIATION-001", artifactType: "remediation-plan", roleId: "remediation_planner",
    createdAt: "2026-07-17T12:00:04Z",
    inputs: [{ artifact_id: screen.artifact_id, run_id: runId, sha256: sha256File(screenFile) }],
    payload: remediationPayload(screen.artifact_id)
  });
  const remediationFile = path.join(artifactRoot, "remediation.json");
  writeJson(remediationFile, remediation);
  const authorizationPayload = fixAuthorizationPayload();
  authorizationPayload.remediation_artifact.sha256 = sha256File(remediationFile);
  const authorization = artifactEnvelope({
    artifactId: "ART-AUTHORIZATION-001", artifactType: "fix-authorization", roleId: "declared_authorizer",
    producerKind: "external_requester", createdAt: "2026-07-17T12:00:05Z",
    inputs: [{ artifact_id: remediation.artifact_id, run_id: runId, sha256: sha256File(remediationFile) }],
    payload: authorizationPayload
  });
  const authorizationFile = path.join(artifactRoot, "authorization.json");
  writeJson(authorizationFile, authorization);
  const change = artifactEnvelope({
    artifactId: "ART-CHANGE-001", artifactType: "change-record", roleId: "authorized_fixer",
    createdAt: "2026-07-17T12:00:06Z",
    inputs: [
      { artifact_id: remediation.artifact_id, run_id: runId, sha256: sha256File(remediationFile) },
      { artifact_id: authorization.artifact_id, run_id: runId, sha256: sha256File(authorizationFile) }
    ],
    payload: changePayload(authorization.artifact_id, sha256File(authorizationFile))
  });
  const changeFile = path.join(artifactRoot, "change.json");
  writeJson(changeFile, change);
  const artifacts = [[screenFile, screen], [queueFile, queue], [remediationFile, remediation], [authorizationFile, authorization], [changeFile, change]];
  const run = initialRun(artifactRoot);
  run.status = "retest_required";
  run.artifacts = artifacts.map(([file, artifact]) => registerEntry(artifactRoot, file, artifact)).sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
  run.history = [
    { from: "initialized", to: "screened", at: screen.created_at, actor_role: "e1_inspector", artifact_ids: [screen.artifact_id] },
    { from: "screened", to: "human_queue_ready", at: queue.created_at, actor_role: "human_queue_planner", artifact_ids: [queue.artifact_id] },
    { from: "human_queue_ready", to: "remediation_ready", at: remediation.created_at, actor_role: "remediation_planner", artifact_ids: [remediation.artifact_id] },
    { from: "remediation_ready", to: "fix_authorized", at: authorization.created_at, actor_role: "declared_authorizer", artifact_ids: [authorization.artifact_id] },
    { from: "fix_authorized", to: "retest_required", at: change.created_at, actor_role: "authorized_fixer", artifact_ids: [change.artifact_id] }
  ];
  const runFile = path.join(temp, "run.json");
  const assessmentFile = path.join(temp, "assessment.json");
  const output = path.join(temp, "merged.json");
  const assessment = assessmentFixture();
  const before = assessment.assessment.results.filter((item) => item.requirement_kind === "profile_requirement").map(({ requirement_id, outcome, mapping_status }) => ({ requirement_id, outcome, mapping_status }));
  writeJson(runFile, run);
  writeJson(assessmentFile, assessment);
  const result = runNode(mergeArtifactsCli, [
    "--run", runFile, "--assessment", assessmentFile,
    "--artifact", screenFile, "--artifact", queueFile, "--artifact", remediationFile, "--artifact", authorizationFile, "--artifact", changeFile,
    "--output", output
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const after = readJson(output).assessment.results.filter((item) => item.requirement_kind === "profile_requirement").map(({ requirement_id, outcome, mapping_status }) => ({ requirement_id, outcome, mapping_status }));
  assert.deepEqual(after, before);
}));

test("registration and merge refuse existing output files", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const runFile = path.join(temp, "run.json");
  const artifactFile = path.join(artifactRoot, "screen.json");
  const screen = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-FIRST" });
  writeJson(runFile, initialRun(artifactRoot));
  writeJson(artifactFile, screen);
  const existingRegisterOutput = path.join(temp, "existing-register.json");
  fs.writeFileSync(existingRegisterOutput, "do not replace", "utf8");
  const registerResult = runNode(registerArtifact, ["--run", runFile, "--artifact", artifactFile, "--output", existingRegisterOutput]);
  assertRejected(registerResult, /overwrite/i);
  assert.equal(fs.readFileSync(existingRegisterOutput, "utf8"), "do not replace");

  const screened = screenedRun(artifactRoot, artifactFile, screen);
  writeJson(runFile, screened);
  const assessmentFile = path.join(temp, "assessment.json");
  writeJson(assessmentFile, assessmentFixture());
  const existingMergeOutput = path.join(temp, "existing-merge.json");
  fs.writeFileSync(existingMergeOutput, "do not replace", "utf8");
  const mergeResult = runNode(mergeArtifactsCli, [
    "--run", runFile, "--assessment", assessmentFile, "--artifact", artifactFile, "--output", existingMergeOutput
  ]);
  assertRejected(mergeResult, /overwrite/i);
  assert.equal(fs.readFileSync(existingMergeOutput, "utf8"), "do not replace");
}));

test("run validation rejects unknown or inactive profiles and non-valid artifact registrations", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  for (const [index, profile] of ["unknown-profile", "authoring-agent"].entries()) {
    const run = initialRun(artifactRoot);
    run.profile.id = profile;
    const input = path.join(temp, `profile-${index}.json`);
    const output = path.join(temp, `profile-validation-${index}.json`);
    writeJson(input, run);
    const result = runNode(validateRun, ["--input", input, "--output", output]);
    assertRejected(result, /unknown|inactive|active profile/i);
  }

  const artifactFile = path.join(artifactRoot, "screen.json");
  const artifact = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-FIRST" });
  writeJson(artifactFile, artifact);
  const run = screenedRun(artifactRoot, artifactFile, artifact);
  run.artifacts[0].validation_status = "invalid";
  const input = path.join(temp, "invalid-registration.json");
  const output = path.join(temp, "invalid-registration-validation.json");
  writeJson(input, run);
  const result = runNode(validateRun, ["--input", input, "--output", output]);
  assertRejected(result, /validation_status|validated artifact/i);
}));

test("Windows path aliases differing only by case are duplicate canonical artifact paths", { skip: process.platform !== "win32" }, (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const artifactFile = path.join(artifactRoot, "Screen.json");
  const artifact = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-FIRST" });
  writeJson(artifactFile, artifact);
  const run = screenedRun(artifactRoot, artifactFile, artifact);
  run.artifacts.push({ ...run.artifacts[0], artifact_id: "ART-SCREEN-002", path: "screen.json" });
  run.artifacts.sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
  const input = path.join(temp, "case-alias-run.json");
  const output = path.join(temp, "case-alias-validation.json");
  writeJson(input, run);
  const result = runNode(validateRun, ["--input", input, "--output", output]);
  assertRejected(result, /duplicate canonical artifact path/i);
}));

test("merge requires run scope and environment to exactly match the assessment", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const artifactFile = path.join(artifactRoot, "screen.json");
  const artifact = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-FIRST" });
  writeJson(artifactFile, artifact);
  const runFile = path.join(temp, "run.json");
  const assessmentFile = path.join(temp, "assessment.json");
  writeJson(runFile, screenedRun(artifactRoot, artifactFile, artifact));
  const assessment = assessmentFixture();
  assessment.assessment.scope.excluded = ["intentionally different scope"];
  assessment.assessment.environment = { os: ["Different OS"], browsers: [], assistive_technologies: [], input_modes: [] };
  writeJson(assessmentFile, assessment);
  const result = runNode(mergeArtifactsCli, [
    "--run", runFile, "--assessment", assessmentFile, "--artifact", artifactFile,
    "--output", path.join(temp, "merged.json")
  ]);
  assertRejected(result, /scope|environment|does not match/i);
}));

test("merge requires the complete registered artifact set and pure merge requires exact hashes", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const firstFile = path.join(artifactRoot, "first.json");
  const secondFile = path.join(artifactRoot, "second.json");
  const first = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-FIRST" });
  const second = screeningEnvelope({ artifactId: "ART-SCREEN-002", requirementId: "SCREEN-SECOND", capturedAt: "2026-07-17T12:00:02Z" });
  writeJson(firstFile, first);
  writeJson(secondFile, second);
  const run = screenedRun(artifactRoot, firstFile, first);
  run.artifacts.push(registerEntry(artifactRoot, secondFile, second));
  run.artifacts.sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
  const runFile = path.join(temp, "run.json");
  const assessmentFile = path.join(temp, "assessment.json");
  writeJson(runFile, run);
  writeJson(assessmentFile, assessmentFixture());
  const omitted = runNode(mergeArtifactsCli, [
    "--run", runFile, "--assessment", assessmentFile, "--artifact", firstFile,
    "--output", path.join(temp, "omitted.json")
  ]);
  assertRejected(omitted, /complete.*artifact|omitted|missing registered/i);

  const resources = loadAuditResources(skillRoot);
  assert.throws(
    () => mergeArtifactRecords({ run, assessment: assessmentFixture(), artifacts: [first, second], registries: resources }),
    /exact.*hash|hash map|fail.closed/i
  );
}));

test("declared human merge preserves the unauthenticated identity limitation", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const { run, screenFile, queueFile, humanFile } = makeHumanReviewRun(artifactRoot);
  const runFile = path.join(temp, "run.json");
  const assessmentFile = path.join(temp, "assessment.json");
  const output = path.join(temp, "merged.json");
  writeJson(runFile, run);
  writeJson(assessmentFile, assessmentFixture());
  const result = runNode(mergeArtifactsCli, [
    "--run", runFile, "--assessment", assessmentFile,
    "--artifact", screenFile, "--artifact", queueFile, "--artifact", humanFile,
    "--output", output
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(readJson(output).assessment.limitations.some((item) => /identity.*not authenticated|unauthenticated identity/i.test(item)));
}));

test("post-close output verification failure removes the newly created output", (t) => withTemp(t, ({ temp }) => {
  const output = path.join(temp, "post-close-failure.json");
  assert.throws(
    () => writeNewJson(output, { status: "should-not-remain" }, { afterClose: () => { throw new Error("simulated post-close verification failure"); } }),
    /post-close verification failure/i
  );
  assert.equal(fs.existsSync(output), false);
}));
