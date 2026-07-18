import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { lookupRequirement } from "../codex/skills/information-accessibility-practice/scripts/show-requirement.mjs";
import {
  loadAuditResources,
  mergeArtifacts as mergeArtifactRecords,
  registerArtifact as registerArtifactRecord,
  validateArtifact,
  validateAuditRun,
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

function resourceVersions(registryFile = "orchestration-registry.json") {
  const standards = readJson(path.join(references, "standards-registry.json"));
  const orchestration = readJson(path.join(references, registryFile));
  return {
    standards_registry_version: standards.schema_version,
    orchestration_registry_version: orchestration.schema_version,
    orchestration_registry_sha256: sha256File(path.join(references, registryFile)),
    criteria_catalog_sha256: sha256File(path.join(references, "criteria-catalog.json")),
    criterion_procedures_sha256: sha256File(path.join(references, "criterion-procedures.json")),
    audit_methods_sha256: sha256File(path.join(references, "web-audit-methods.json"))
  };
}

function initialRun(artifactRoot) {
  return {
    schema_version: "6.0.0",
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
      command_execution: "denied",
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

function authorizedInitialRun(artifactRoot) {
  const run = initialRun(artifactRoot);
  run.permissions = {
    network: "allowlisted",
    interaction: "read_only",
    source_write: "authorized_only",
    command_execution: "authorized_verification_only",
    allowed_actions: [
      "execute_authorized_verification_commands",
      "inspect_without_mutation",
      "read_allowlisted_resources",
      "write_authorized_files"
    ],
    forbidden_actions: ["execute_unapproved_commands", "network_outside_allowlist"]
  };
  return run;
}

function legacyV2InitialRun(artifactRoot) {
  const run = initialRun(artifactRoot);
  run.schema_version = "2.0.0";
  run.resource_versions = resourceVersions("orchestration-registry-1.0.0.json");
  delete run.permissions.command_execution;
  run.permissions.allowed_actions = ["read_target", "write_internal_artifacts"];
  run.permissions.forbidden_actions = ["record_profile_outcome", "write_target", "authorize_fix"];
  return run;
}

function legacyV3InitialRun(artifactRoot) {
  const run = initialRun(artifactRoot);
  run.schema_version = "3.0.0";
  run.resource_versions = resourceVersions("orchestration-registry-2.0.0.json");
  delete run.permissions.command_execution;
  return run;
}

function legacyV4InitialRun(artifactRoot) {
  const run = initialRun(artifactRoot);
  run.schema_version = "4.0.0";
  run.resource_versions = resourceVersions("orchestration-registry-3.0.0.json");
  return run;
}

function legacyV5InitialRun(artifactRoot) {
  const run = initialRun(artifactRoot);
  run.schema_version = "5.0.0";
  run.resource_versions = resourceVersions("orchestration-registry-4.0.0.json");
  return run;
}

function screeningEnvelope({ artifactId, requirementId, capturedAt = "2026-07-17T12:00:01Z" }) {
  return {
    schema_version: "2.0.0",
    artifact_id: artifactId,
    artifact_type: "screening-observations",
    run_id: runId,
    producer: { role_id: "e1_inspector", producer_kind: "ai_agent", origin: "test fixture" },
    created_at: capturedAt,
    inputs: [],
    payload: {
      schema_version: "2.0.0",
      observations: [{
        requirement_id: requirementId,
        evidence_level: "E1",
        method: "DOM inspection",
        location: "main heading",
        observation: `Unverified observation for ${requirementId}`,
        captured_at: capturedAt,
        profile_requirement_id: null,
        report_outcome: null,
        applicability: "undetermined",
        report_rationale: "This general screening observation is not mapped to an exact profile requirement."
      }]
    }
  };
}

function downgradeScreeningEnvelopeToV1(artifact) {
  artifact.schema_version = "1.0.0";
  artifact.payload.schema_version = "1.0.0";
  for (const observation of artifact.payload.observations) {
    delete observation.profile_requirement_id;
    delete observation.report_outcome;
    delete observation.applicability;
    delete observation.report_rationale;
  }
  return artifact;
}

function queuePayload(requirementId = "WCAG-2.2-SC-1.1.1") {
  return queuePayloadFor([requirementId]);
}

function queuePayloadFor(requirementIds) {
  const items = requirementIds.map((requirementId) => ({
    requirement_id: requirementId,
    ...lookupRequirement("web-modern", requirementId, skillRoot).procedure_binding
  }));
  return {
    schema_version: "2.0.0",
    items,
    procedure_coverage: {
      total_requirements: items.length,
      available_procedures: items.filter((item) => item.procedure_availability === "available").length,
      unavailable_procedures: items.filter((item) => item.procedure_availability === "unavailable").length
    }
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
    schema_version: "2.0.0",
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
      official_sources: [
        "https://www.w3.org/TR/WCAG22/#non-text-content",
        "https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html"
      ],
      target_specific_evidence: [{
        type: "browser_inspection",
        location: "main image",
        observation: "The computed alternative was inspected against the visible context.",
        captured_at: "2026-07-17T12:00:04Z"
      }, {
        type: "manual_observation",
        location: "main image",
        observation: "The visible purpose was compared manually with the text alternative.",
        captured_at: "2026-07-17T12:00:04Z"
      }],
      profile_outcome: profileOutcome,
      rationale: "The target-specific evidence supports the recorded result."
    }]
  };
}

function fixAuthorizationPayload() {
  return {
    schema_version: "2.0.0",
    authorization_id: "AUTH-20260717-TEST0001",
    run_id: runId,
    authorizer_role: "declared_authorizer",
    authorizer_kind: "external_requester",
    approved_by: "Requester",
    identity_authenticated: false,
    declaration: "I authorize only the listed files and structured command data.",
    approved_at: "2026-07-17T12:00:05Z",
    source_root: "C:\\work\\target",
    allowed_paths: ["index.html"],
    allowed_operations: ["modify"],
    change_bindings: [{
      path: "index.html",
      operation: "modify",
      expected_before_sha256: "a".repeat(64),
      expected_after_sha256: "b".repeat(64)
    }],
    verification_commands: [{ command_id: "VERIFY-001", executable: "npm", args: ["test"], cwd: "." }],
    remediation_artifact: { artifact_id: "ART-REMEDIATION-001", sha256: "a".repeat(64) }
  };
}

function legacyFixAuthorizationPayload() {
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
    allowed_files: ["target/index.html"],
    commands: [{ executable: "npm", args: ["test"], cwd: "." }],
    remediation_artifact: { artifact_id: "ART-REMEDIATION-001", sha256: "a".repeat(64) }
  };
}

function remediationPayload(sourceArtifactId, requirementId = "SCREEN-FIRST") {
  return {
    schema_version: "2.0.0",
    items: [{
      remediation_id: "REM-TEST0001",
      basis: "unverified_screening_candidate",
      requirement_id: requirementId,
      source_artifact_ids: [sourceArtifactId],
      priority: "P1",
      location: "target/index.html#main",
      affected_users: ["Screen reader users"],
      issue: "Unverified screening candidate requiring review.",
      proposed_change: "Prepare a bounded candidate change for authorization.",
      verification: "Retest the same screening check after an authorized change.",
      residual_limitation: "The candidate remains unverified until target-specific review is completed."
    }]
  };
}

function verifiedFailureRemediationPayload(sourceArtifactId, requirementId = "WCAG-2.2-SC-1.1.1") {
  return {
    schema_version: "2.0.0",
    items: [{
      remediation_id: "REM-FAIL0001",
      basis: "verified_failure",
      requirement_id: requirementId,
      source_artifact_ids: [sourceArtifactId],
      priority: "P0",
      location: "target/index.html#main-image",
      affected_users: ["Screen reader users"],
      issue: "The human review verified that the text alternative does not communicate the image purpose.",
      proposed_change: "Provide a text alternative that communicates the same purpose as the image.",
      verification: "Repeat the registered human review with browser inspection and manual observation.",
      owner: "Frontend team",
      residual_limitation: "The reviewer identity remains declared but unauthenticated."
    }]
  };
}

function changePayload(authorizationArtifactId, authorizationHash) {
  return {
    schema_version: "2.0.0",
    change_id: "CHANGE-20260717-TEST0001",
    run_id: runId,
    authorization_id: "AUTH-20260717-TEST0001",
    authorization_artifact: { artifact_id: authorizationArtifactId, sha256: authorizationHash },
    changed_files: [{ path: "index.html", operation: "modify", before_sha256: "a".repeat(64), after_sha256: "b".repeat(64), description: "Declared test change record." }],
    diff_sha256: "c".repeat(64),
    command_results: [{
      command_id: "VERIFY-001",
      executable: "npm",
      args: ["test"],
      cwd: ".",
      status: "exited",
      exit_code: 0,
      signal: null,
      stdout_sha256: "d".repeat(64),
      stderr_sha256: "e".repeat(64),
      started_at: "2026-07-17T12:00:06Z",
      completed_at: "2026-07-17T12:00:07Z"
    }],
    lease: {
      lease_id: "LEASE-20260717-TEST0001",
      source_root_sha256: "f".repeat(64),
      acquired_at: "2026-07-17T12:00:05Z",
      expires_at: "2026-07-17T12:05:05Z",
      recovery: null
    },
    next_status: "retest_required"
  };
}

function legacyChangePayload() {
  return {
    schema_version: "1.0.0",
    change_id: "CHANGE-20260717-TEST0001",
    run_id: runId,
    authorization_id: "AUTH-20260717-TEST0001",
    authorization_artifact: { artifact_id: "ART-AUTHORIZATION-001", sha256: "a".repeat(64) },
    changed_files: [{
      path: "target/index.html",
      before_sha256: "a".repeat(64),
      after_sha256: "b".repeat(64),
      description: "Legacy change record."
    }],
    verification: ["The changed file was parsed successfully."],
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

function makeScreeningRemediationRun(artifactRoot) {
  const screen = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-FIRST" });
  const screenFile = path.join(artifactRoot, "screen.json");
  writeJson(screenFile, screen);
  const queue = queueEnvelope({ inputs: [{ artifact_id: screen.artifact_id, run_id: runId, sha256: sha256File(screenFile) }] });
  const queueFile = path.join(artifactRoot, "queue.json");
  writeJson(queueFile, queue);
  const remediation = artifactEnvelope({
    artifactId: "ART-REMEDIATION-001",
    artifactType: "remediation-plan",
    roleId: "remediation_planner",
    createdAt: "2026-07-17T12:00:04Z",
    inputs: [{ artifact_id: screen.artifact_id, run_id: runId, sha256: sha256File(screenFile) }],
    payload: remediationPayload(screen.artifact_id)
  });
  const remediationFile = path.join(artifactRoot, "remediation.json");
  writeJson(remediationFile, remediation);
  const run = initialRun(artifactRoot);
  run.status = "remediation_ready";
  run.artifacts = [
    registerEntry(artifactRoot, screenFile, screen),
    registerEntry(artifactRoot, queueFile, queue),
    registerEntry(artifactRoot, remediationFile, remediation)
  ].sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
  run.history = [
    { from: "initialized", to: "screened", at: screen.created_at, actor_role: "e1_inspector", artifact_ids: [screen.artifact_id] },
    { from: "screened", to: "human_queue_ready", at: queue.created_at, actor_role: "human_queue_planner", artifact_ids: [queue.artifact_id] },
    { from: "human_queue_ready", to: "remediation_ready", at: remediation.created_at, actor_role: "remediation_planner", artifact_ids: [remediation.artifact_id] }
  ];
  return {
    run,
    screen,
    screenFile,
    queue,
    queueFile,
    remediation,
    remediationFile,
    artifacts: [screen, queue, remediation]
  };
}

function makeVerifiedFailureRemediationRun(artifactRoot, profileOutcome = "fail") {
  const fixture = makeHumanReviewRun(artifactRoot);
  fixture.human.payload.reviews[0].profile_outcome = profileOutcome;
  writeJson(fixture.humanFile, fixture.human);
  fixture.run.artifacts.find((entry) => entry.artifact_id === fixture.human.artifact_id).sha256 = sha256File(fixture.humanFile);
  const remediation = artifactEnvelope({
    artifactId: "ART-REMEDIATION-001",
    artifactType: "remediation-plan",
    roleId: "remediation_planner",
    createdAt: "2026-07-17T12:00:05Z",
    inputs: [{ artifact_id: fixture.human.artifact_id, run_id: runId, sha256: sha256File(fixture.humanFile) }],
    payload: verifiedFailureRemediationPayload(fixture.human.artifact_id)
  });
  const remediationFile = path.join(artifactRoot, "remediation.json");
  writeJson(remediationFile, remediation);
  fixture.run.status = "remediation_ready";
  fixture.run.artifacts.push(registerEntry(artifactRoot, remediationFile, remediation));
  fixture.run.artifacts.sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
  fixture.run.history.push({
    from: "human_review_recorded",
    to: "remediation_ready",
    at: remediation.created_at,
    actor_role: "remediation_planner",
    artifact_ids: [remediation.artifact_id]
  });
  return {
    ...fixture,
    remediation,
    remediationFile,
    artifacts: [
      readJson(fixture.screenFile),
      readJson(fixture.queueFile),
      fixture.human,
      remediation
    ]
  };
}

function makeRetestRequiredRun(artifactRoot) {
  const fixture = makeScreeningRemediationRun(artifactRoot);
  fixture.run.permissions = authorizedInitialRun(artifactRoot).permissions;
  const authorizationPayload = fixAuthorizationPayload();
  authorizationPayload.remediation_artifact.sha256 = sha256File(fixture.remediationFile);
  const authorization = artifactEnvelope({
    artifactId: "ART-AUTHORIZATION-001",
    artifactType: "fix-authorization",
    roleId: "declared_authorizer",
    producerKind: "external_requester",
    createdAt: "2026-07-17T12:00:05Z",
    inputs: [{ artifact_id: fixture.remediation.artifact_id, run_id: runId, sha256: sha256File(fixture.remediationFile) }],
    payload: authorizationPayload
  });
  authorization.producer.origin = "external_input";
  const authorizationFile = path.join(artifactRoot, "authorization.json");
  writeJson(authorizationFile, authorization);
  const change = artifactEnvelope({
    artifactId: "ART-CHANGE-001",
    artifactType: "change-record",
    roleId: "authorized_fixer",
    createdAt: "2026-07-17T12:00:06Z",
    inputs: [
      { artifact_id: fixture.remediation.artifact_id, run_id: runId, sha256: sha256File(fixture.remediationFile) },
      { artifact_id: authorization.artifact_id, run_id: runId, sha256: sha256File(authorizationFile) }
    ],
    payload: changePayload(authorization.artifact_id, sha256File(authorizationFile))
  });
  const changeFile = path.join(artifactRoot, "change.json");
  writeJson(changeFile, change);
  fixture.run.status = "retest_required";
  fixture.run.artifacts.push(
    registerEntry(artifactRoot, authorizationFile, authorization),
    registerEntry(artifactRoot, changeFile, change)
  );
  fixture.run.artifacts.sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
  fixture.run.history.push(
    { from: "remediation_ready", to: "fix_authorized", at: authorization.created_at, actor_role: "declared_authorizer", artifact_ids: [authorization.artifact_id] },
    { from: "fix_authorized", to: "retest_required", at: change.created_at, actor_role: "authorized_fixer", artifact_ids: [change.artifact_id] }
  );
  return { ...fixture, authorization, authorizationFile, change, changeFile };
}

function rewriteFixtureArtifact(fixture, artifact, file) {
  writeJson(file, artifact);
  fixture.run.artifacts.find((entry) => entry.artifact_id === artifact.artifact_id).sha256 = sha256File(file);
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

function applyLegacyRunContract(run) {
  run.schema_version = "1.0.0";
  run.resource_versions = resourceVersions("orchestration-registry-1.0.0.json");
  delete run.resource_versions.orchestration_registry_sha256;
  delete run.permissions.command_execution;
  run.permissions.allowed_actions = ["read_target", "write_internal_artifacts"];
  run.permissions.forbidden_actions = ["record_profile_outcome", "write_target", "authorize_fix"];
  return run;
}

function legacyInitialRun(artifactRoot) {
  return applyLegacyRunContract(initialRun(artifactRoot));
}

function injectHumanResult(assessment, requirementId = "WCAG-2.2-SC-1.1.1", outcome = "pass") {
  const resources = loadAuditResources(skillRoot);
  const catalog = Object.values(resources.criteriaCatalog.catalogs).flat().find((item) => item.id === requirementId);
  const row = assessment.assessment.results.find((item) => item.requirement_id === requirementId);
  row.mapping_status = "human_verified";
  row.outcome = outcome;
  row.method_kind = "manual";
  row.method_ref = `web-audit-methods:${resources.auditMethods.schema_version}#${catalog.method_key}`;
  row.method = "Pre-existing human result without current-run provenance.";
  row.evidence = [{
    type: "manual_observation",
    location: "foreign assessment",
    observation: "This evidence was not reconstructed from the current run artifacts.",
    captured_at: "2026-07-17T11:00:00Z"
  }];
  row.notes = "Pre-existing human result without current-run provenance.";
  assessment.assessment.evidence_level = "E2";
  assessment.assessment.evaluator = "Foreign reviewer";
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

function pureMergeResources(run, artifactRoot) {
  const resources = loadAuditResources(skillRoot);
  resources.artifact_snapshots_by_id = new Map(run.artifacts.map((entry) => {
    const file = path.join(artifactRoot, ...entry.path.replace(/^\.\//u, "").split("/"));
    const bytes = fs.readFileSync(file);
    return [entry.artifact_id, { bytes, sha256: sha256Bytes(bytes) }];
  }));
  return resources;
}

function withTemp(t, callback) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-orchestration-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const artifactRoot = path.join(temp, "artifacts");
  fs.mkdirSync(artifactRoot);
  return callback({ temp, artifactRoot });
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourceEntry = path.join(source, entry.name);
    const destinationEntry = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(sourceEntry, destinationEntry);
    else fs.copyFileSync(sourceEntry, destinationEntry);
  }
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
  assert.equal(run.schema_version, "6.0.0");
  assert.equal(run.status, "initialized");
  assert.equal(run.artifact_root, "artifacts");
  assert.deepEqual(run.permissions, initialRun(artifactRoot).permissions);
  assert.deepEqual(run.resource_versions, resourceVersions());
  assert.equal(run.resource_versions.orchestration_registry_sha256, sha256File(path.join(references, "orchestration-registry.json")));

  const overwrite = runNode(createRun, [
    "--run-id", runId, "--profile", "web-modern", "--target-name", "Local fixture",
    "--target-version", "fixture-v1", "--target-ref", "http://127.0.0.1:4173/",
    "--artifact-root", artifactRoot, "--network", "local_read_only",
    "--interaction", "safe_read_only", "--source-write", "none", "--output", output
  ]);
  assert.notEqual(overwrite.status, 0);
  assert.match(overwrite.stderr, /overwrite/i);
}));

test("run 6 initialization couples authorized source writes to authorized verification-only command execution", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const output = path.join(temp, "authorized-run.json");
  const result = runNode(createRun, [
    "--run-id", runId,
    "--profile", "web-modern",
    "--target-name", "Local fixture",
    "--target-version", "fixture-v1",
    "--target-ref", "http://127.0.0.1:4173/",
    "--artifact-root", artifactRoot,
    "--network", "none",
    "--interaction", "safe_read_only",
    "--source-write", "authorized_only",
    "--output", output
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(readJson(output).permissions, {
    network: "denied",
    interaction: "read_only",
    source_write: "authorized_only",
    command_execution: "authorized_verification_only",
    allowed_actions: ["execute_authorized_verification_commands", "inspect_without_mutation", "write_authorized_files"],
    forbidden_actions: ["execute_unapproved_commands", "network_access"]
  });
}));

test("fresh retest initialization validates its predecessor and copies no prior evidence", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const predecessor = makeRetestRequiredRun(artifactRoot);
  const predecessorFile = path.join(temp, "predecessor-run.json");
  writeJson(predecessorFile, predecessor.run);
  const newArtifactRoot = path.join(temp, "retest-artifacts");
  fs.mkdirSync(newArtifactRoot);
  const output = path.join(temp, "retest-run.json");
  const newRunId = "RUN-20260718T120000Z-RETEST01";
  const result = runNode(createRun, [
    "--run-id", newRunId,
    "--profile", "web-modern",
    "--target-name", "Local fixture",
    "--target-version", "fixture-v2",
    "--target-ref", "http://127.0.0.1:4173/",
    "--artifact-root", newArtifactRoot,
    "--network", "local_read_only",
    "--interaction", "safe_read_only",
    "--source-write", "none",
    "--supersedes-run", predecessorFile,
    "--output", output
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const run = readJson(output);
  assert.equal(run.supersedes_run_id, predecessor.run.run_id);
  assert.equal(run.run_id, newRunId);
  assert.equal(run.status, "initialized");
  assert.equal(run.target.name, predecessor.run.target.name);
  assert.equal(run.target.version_or_commit, "fixture-v2");
  assert.deepEqual(run.target.urls_or_files, predecessor.run.target.urls_or_files);
  assert.deepEqual(run.profile, predecessor.run.profile);
  assert.deepEqual(run.scope, predecessor.run.scope);
  assert.deepEqual(run.artifacts, []);
  assert.deepEqual(run.history, []);
  assert.equal(run.permissions.source_write, "denied");
  assert.equal(run.permissions.command_execution, "denied");
  assert.deepEqual(run.resource_versions, resourceVersions());
  assert.deepEqual(fs.readdirSync(newArtifactRoot), []);

  const crossRunOutput = path.join(temp, "cross-run.json");
  const copiedOldArtifact = path.join(newArtifactRoot, "copied-old-screen.json");
  fs.copyFileSync(predecessor.screenFile, copiedOldArtifact);
  const crossRun = runNode(registerArtifact, ["--run", output, "--artifact", copiedOldArtifact, "--output", crossRunOutput]);
  assertRejected(crossRun, /run[_ -]?id|same run|does not match/i);
  assert.equal(fs.existsSync(crossRunOutput), false);
}));

test("fresh retest initialization rejects invalid predecessor and scope/root reuse", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const predecessor = makeRetestRequiredRun(artifactRoot);
  const predecessorFile = path.join(temp, "predecessor-run.json");
  writeJson(predecessorFile, predecessor.run);
  const baseArgs = [
    "--run-id", "RUN-20260718T120000Z-RETEST02",
    "--profile", "web-modern",
    "--target-name", "Local fixture",
    "--target-version", "fixture-v2",
    "--target-ref", "http://127.0.0.1:4173/",
    "--network", "local_read_only",
    "--interaction", "safe_read_only",
    "--source-write", "none",
    "--supersedes-run", predecessorFile
  ];
  const cases = [];
  const sameVersionRoot = path.join(temp, "same-version-artifacts");
  fs.mkdirSync(sameVersionRoot);
  cases.push([[...baseArgs.map((value, index, values) => values[index - 1] === "--target-version" ? "fixture-v1" : value), "--artifact-root", sameVersionRoot, "--output", path.join(temp, "same-version.json")], /version.*change|different.*version/i]);
  cases.push([[...baseArgs, "--artifact-root", artifactRoot, "--output", path.join(temp, "same-root.json")], /artifact.*root|different|overlap|empty/i]);
  const dotPrefixedChild = path.join(artifactRoot, "..retest");
  fs.mkdirSync(dotPrefixedChild);
  cases.push([[...baseArgs, "--artifact-root", dotPrefixedChild, "--output", path.join(temp, "dot-child.json")], /artifact.*root|different|overlap/i]);
  const nonempty = path.join(temp, "nonempty-artifacts");
  fs.mkdirSync(nonempty);
  fs.writeFileSync(path.join(nonempty, "old.json"), "{}\n", "utf8");
  cases.push([[...baseArgs, "--artifact-root", nonempty, "--output", path.join(temp, "nonempty.json")], /artifact.*empty|must be empty/i]);
  const mismatchRoot = path.join(temp, "mismatch-artifacts");
  fs.mkdirSync(mismatchRoot);
  cases.push([[...baseArgs.map((value, index, values) => values[index - 1] === "--target-name" ? "Other target" : value), "--artifact-root", mismatchRoot, "--output", path.join(temp, "mismatch.json")], /target.*match|name.*predecessor/i]);

  for (const [args, pattern] of cases) assertRejected(runNode(createRun, args), pattern);

  const invalid = initialRun(artifactRoot);
  writeJson(predecessorFile, invalid);
  const invalidRoot = path.join(temp, "invalid-predecessor-artifacts");
  fs.mkdirSync(invalidRoot);
  assertRejected(runNode(createRun, [...baseArgs, "--artifact-root", invalidRoot, "--output", path.join(temp, "invalid-predecessor.json")]), /retest_required|predecessor.*status/i);
}));

test("change-record registration enforces the referenced authorization change binding", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const fixture = makeRetestRequiredRun(artifactRoot);
  fixture.run.status = "fix_authorized";
  fixture.run.artifacts = fixture.run.artifacts.filter((entry) => entry.artifact_id !== fixture.change.artifact_id);
  fixture.run.history = fixture.run.history.slice(0, -1);
  const runFile = path.join(temp, "fix-authorized-run.json");
  writeJson(runFile, fixture.run);
  const cases = [
    ["path", (value) => { value.payload.changed_files[0].path = "other.html"; }],
    ["operation", (value) => { value.payload.changed_files[0].operation = "delete"; value.payload.changed_files[0].after_sha256 = null; }],
    ["before hash", (value) => { value.payload.changed_files[0].before_sha256 = "d".repeat(64); }],
    ["after hash", (value) => { value.payload.changed_files[0].after_sha256 = "e".repeat(64); }],
    ["authorization id", (value) => { value.payload.authorization_id = "AUTH-20260717-OTHER001"; }],
    ["command id", (value) => { value.payload.command_results[0].command_id = "VERIFY-OTHER"; }],
    ["command args", (value) => { value.payload.command_results[0].args = ["run", "other"]; }]
  ];
  for (const [label, mutate] of cases) {
    const forged = structuredClone(fixture.change);
    mutate(forged);
    const file = path.join(artifactRoot, `forged-${label.replaceAll(" ", "-")}.json`);
    writeJson(file, forged);
    assert.throws(
      () => registerArtifactRecord(fixture.run, forged, { skillRoot, runFile, artifactFile: file }),
      /authorization|change binding|authorized command|changed_files/i,
      label
    );
  }
}));

test("audit-run dispatch maps runs 1/2 to registry 1 through run 6 to registry 5", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const currentSchema = readJson(path.join(references, "audit-run.schema.json"));
  const legacyV1SchemaFile = path.join(references, "audit-run-1.0.0.schema.json");
  const legacyV2SchemaFile = path.join(references, "audit-run-2.0.0.schema.json");
  const legacyV3SchemaFile = path.join(references, "audit-run-3.0.0.schema.json");
  const legacyV4SchemaFile = path.join(references, "audit-run-4.0.0.schema.json");
  const legacyV5SchemaFile = path.join(references, "audit-run-5.0.0.schema.json");
  assert.equal(currentSchema.$id, "urn:information-accessibility:audit-run:6.0.0");
  assert.equal(currentSchema.properties.schema_version.const, "6.0.0");
  assert.equal(readJson(legacyV1SchemaFile).properties.schema_version.const, "1.0.0");
  assert.equal(readJson(legacyV2SchemaFile).properties.schema_version.const, "2.0.0");
  assert.equal(readJson(legacyV3SchemaFile).properties.schema_version.const, "3.0.0");
  assert.equal(readJson(legacyV4SchemaFile).properties.schema_version.const, "4.0.0");
  assert.equal(readJson(legacyV5SchemaFile).properties.schema_version.const, "5.0.0");

  const currentRegistry = readJson(path.join(references, "orchestration-registry.json"));
  const registryV1 = readJson(path.join(references, "orchestration-registry-1.0.0.json"));
  const registryV2 = readJson(path.join(references, "orchestration-registry-2.0.0.json"));
  const registryV3 = readJson(path.join(references, "orchestration-registry-3.0.0.json"));
  const registryV4 = readJson(path.join(references, "orchestration-registry-4.0.0.json"));
  assert.equal(currentRegistry.schema_version, "5.0.0");
  assert.equal(registryV1.schema_version, "1.0.0");
  assert.equal(registryV2.schema_version, "2.0.0");
  assert.equal(registryV3.schema_version, "3.0.0");
  assert.equal(registryV4.schema_version, "4.0.0");

  const runFile = path.join(temp, "run.json");
  const current = validateAuditRun(initialRun(artifactRoot), { skillRoot, runFile });
  assert.equal(current.valid, true, current.errors.join("\n"));

  const legacyV2 = validateAuditRun(legacyV2InitialRun(artifactRoot), { skillRoot, runFile });
  assert.equal(legacyV2.valid, true, legacyV2.errors.join("\n"));

  const legacyV3 = validateAuditRun(legacyV3InitialRun(artifactRoot), { skillRoot, runFile });
  assert.equal(legacyV3.valid, true, legacyV3.errors.join("\n"));

  const legacyV4 = validateAuditRun(legacyV4InitialRun(artifactRoot), { skillRoot, runFile });
  assert.equal(legacyV4.valid, true, legacyV4.errors.join("\n"));

  const legacyV5 = validateAuditRun(legacyV5InitialRun(artifactRoot), { skillRoot, runFile });
  assert.equal(legacyV5.valid, true, legacyV5.errors.join("\n"));

  const artifactFile = path.join(artifactRoot, "legacy-v2-screening.json");
  const artifact = screeningEnvelope({ artifactId: "ART-SCREEN-V2", requirementId: "SCREEN-LEGACY-V2" });
  writeJson(artifactFile, artifact);
  assert.throws(
    () => registerArtifactRecord(legacyV2InitialRun(artifactRoot), artifact, { skillRoot, runFile, artifactFile }),
    /latest.*audit-run.*6\.0\.0|legacy.*read.only|implicit upgrade/i
  );

  assert.throws(
    () => registerArtifactRecord(legacyV3InitialRun(artifactRoot), artifact, { skillRoot, runFile, artifactFile }),
    /latest.*audit-run.*6\.0\.0|legacy.*read.only|implicit upgrade/i
  );

  assert.throws(
    () => registerArtifactRecord(legacyV4InitialRun(artifactRoot), artifact, { skillRoot, runFile, artifactFile }),
    /latest.*audit-run.*6\.0\.0|legacy.*read.only|implicit upgrade/i
  );

  const legacy = validateAuditRun(legacyInitialRun(artifactRoot), { skillRoot, runFile });
  assert.equal(legacy.valid, true, legacy.errors.join("\n"));

  for (const [label, run, wrongRegistry] of [
    ["run 1 with registry 2", legacyInitialRun(artifactRoot), "orchestration-registry-2.0.0.json"],
    ["run 2 with registry 2", legacyV2InitialRun(artifactRoot), "orchestration-registry-2.0.0.json"],
    ["run 3 with registry 1", legacyV3InitialRun(artifactRoot), "orchestration-registry-1.0.0.json"],
    ["run 4 with registry 2", legacyV4InitialRun(artifactRoot), "orchestration-registry-2.0.0.json"],
    ["run 5 with registry 3", legacyV5InitialRun(artifactRoot), "orchestration-registry-3.0.0.json"],
    ["run 6 with registry 4", initialRun(artifactRoot), "orchestration-registry-4.0.0.json"]
  ]) {
    run.resource_versions = resourceVersions(wrongRegistry);
    const result = validateAuditRun(run, { skillRoot, runFile });
    assert.equal(result.valid, false, label);
    assert.match(result.errors.join("\n"), /requires orchestration registry|resource_versions\.orchestration_registry/i, label);
  }

  const unknownRun = initialRun(artifactRoot);
  unknownRun.schema_version = "9.9.9";
  const unknown = validateAuditRun(unknownRun, { skillRoot, runFile });
  assert.equal(unknown.valid, false);
  assert.match(unknown.errors.join("\n"), /unsupported.*schema.version|schema.version.*9\.9\.9/i);
}));

test("run validation enforces canonical permissions and the installed profile registry version", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const runFile = path.join(temp, "run.json");
  const baseline = validateAuditRun(initialRun(artifactRoot), { skillRoot, runFile });
  assert.equal(baseline.valid, true, baseline.errors.join("\n"));

  const mutations = [
    (run) => run.permissions.allowed_actions.push("execute_commands"),
    (run) => run.permissions.forbidden_actions.splice(run.permissions.forbidden_actions.indexOf("write_target"), 1),
    (run) => run.permissions.forbidden_actions.push("inspect_without_mutation"),
    (run) => { run.profile.registry_version = "9.9.9"; }
  ];
  for (const mutate of mutations) {
    const run = initialRun(artifactRoot);
    mutate(run);
    const result = validateAuditRun(run, { skillRoot, runFile });
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /permissions.*canonical|allowed_actions|forbidden_actions|profile\.registry_version/i);
  }
}));

test("validateAuditRun is total for null runs and null structural entries", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const runFile = path.join(temp, "run.json");
  const malformedRuns = [
    null,
    { ...initialRun(artifactRoot), history: [null] },
    { ...initialRun(artifactRoot), artifacts: [null] }
  ];
  for (const run of malformedRuns) {
    let result;
    assert.doesNotThrow(() => { result = validateAuditRun(run, { skillRoot, runFile }); });
    assert.equal(result.valid, false);
    assert.equal(Array.isArray(result.errors), true);
    assert.ok(result.errors.length > 0);
  }
}));

test("latest-only operational gate rejects legacy runs in direct artifact registration while preserving read compatibility", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const runFile = path.join(temp, "legacy-run.json");
  const artifactFile = path.join(artifactRoot, "screening.json");
  const artifact = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-ARIA-NAME" });
  const legacyRun = legacyInitialRun(artifactRoot);
  writeJson(runFile, legacyRun);
  writeJson(artifactFile, artifact);

  const readable = validateAuditRun(legacyRun, { skillRoot, runFile });
  assert.equal(readable.valid, true, readable.errors.join("\n"));
  assert.throws(
    () => registerArtifactRecord(legacyRun, artifact, { skillRoot, runFile, artifactFile }),
    /latest.*audit-run.*6\.0\.0|legacy.*read.only|implicit upgrade/i
  );
}));

test("legacy Task 4 declared-human runs remain readable without retroactive current binding eligibility", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const fixture = makeHumanReviewRun(artifactRoot);
  const screen = readJson(fixture.screenFile);
  downgradeScreeningEnvelopeToV1(screen);
  writeJson(fixture.screenFile, screen);
  const human = readJson(fixture.humanFile);
  human.schema_version = "1.0.0";
  human.payload.reviews[0].official_sources = [];
  human.payload.reviews[0].target_specific_evidence = human.payload.reviews[0].target_specific_evidence
    .filter((item) => item.type === "manual_observation");
  writeJson(fixture.humanFile, human);
  const queue = readJson(fixture.queueFile);
  queue.schema_version = "1.0.0";
  queue.inputs[0].sha256 = sha256File(fixture.screenFile);
  queue.payload.schema_version = "1.0.0";
  delete queue.payload.items[0].generic_method_ref;
  delete queue.payload.items[0].official_sources;
  writeJson(fixture.queueFile, queue);
  human.inputs[0].sha256 = sha256File(fixture.queueFile);
  writeJson(fixture.humanFile, human);
  const run = applyLegacyRunContract(fixture.run);
  run.artifacts.find((entry) => entry.artifact_type === "screening-observations").path = "./screen.json";
  run.artifacts.find((entry) => entry.artifact_type === "screening-observations").sha256 = sha256File(fixture.screenFile);
  run.artifacts.find((entry) => entry.artifact_id === queue.artifact_id).sha256 = sha256File(fixture.queueFile);
  run.artifacts.find((entry) => entry.artifact_id === human.artifact_id).sha256 = sha256File(fixture.humanFile);
  const runFile = path.join(temp, "legacy-human-run.json");

  const readable = validateAuditRun(run, { skillRoot, runFile });
  assert.equal(readable.valid, true, readable.errors.join("\n"));
  const runV2 = structuredClone(run);
  runV2.schema_version = "2.0.0";
  runV2.resource_versions = resourceVersions("orchestration-registry-1.0.0.json");
  const readableV2 = validateAuditRun(runV2, { skillRoot, runFile });
  assert.equal(readableV2.valid, true, readableV2.errors.join("\n"));
  assert.throws(
    () => mergeArtifactRecords({
      run,
      assessment: assessmentFixture(),
      artifacts: [readJson(fixture.screenFile), readJson(fixture.queueFile), human],
      registries: pureMergeResources(run, artifactRoot)
    }),
    /latest.*audit-run.*6\.0\.0|legacy.*read.only|implicit upgrade/i
  );
}));

test("latest-only operational gate rejects legacy runs in the register CLI without creating output", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const runFile = path.join(temp, "legacy-run.json");
  const artifactFile = path.join(artifactRoot, "screening.json");
  const output = path.join(temp, "registered.json");
  const artifact = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-ARIA-NAME" });
  writeJson(runFile, legacyInitialRun(artifactRoot));
  writeJson(artifactFile, artifact);

  const result = runNode(registerArtifact, ["--run", runFile, "--artifact", artifactFile, "--output", output]);
  assertRejected(result, /latest.*audit-run.*6\.0\.0|legacy.*read.only|implicit upgrade/i);
  assert.equal(fs.existsSync(output), false);
}));

test("latest-only operational gate rejects legacy runs in pure merge while preserving read compatibility", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const artifactFile = path.join(artifactRoot, "screening.json");
  const artifact = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-ARIA-NAME" });
  downgradeScreeningEnvelopeToV1(artifact);
  writeJson(artifactFile, artifact);
  const legacyRun = screenedRun(artifactRoot, artifactFile, artifact);
  legacyRun.schema_version = "1.0.0";
  legacyRun.resource_versions = resourceVersions("orchestration-registry-1.0.0.json");
  delete legacyRun.resource_versions.orchestration_registry_sha256;
  delete legacyRun.permissions.command_execution;
  const runFile = path.join(temp, "legacy-run.json");
  const readable = validateAuditRun(legacyRun, { skillRoot, runFile });
  assert.equal(readable.valid, true, readable.errors.join("\n"));

  const resources = pureMergeResources(legacyRun, artifactRoot);
  assert.throws(
    () => mergeArtifactRecords({ run: legacyRun, assessment: assessmentFixture(), artifacts: [artifact], registries: resources }),
    /latest.*audit-run.*6\.0\.0|legacy.*read.only|implicit upgrade/i
  );
}));

test("latest-only operational gate rejects legacy runs in the merge CLI without creating output", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const artifactFile = path.join(artifactRoot, "screening.json");
  const artifact = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-ARIA-NAME" });
  downgradeScreeningEnvelopeToV1(artifact);
  writeJson(artifactFile, artifact);
  const legacyRun = screenedRun(artifactRoot, artifactFile, artifact);
  legacyRun.schema_version = "1.0.0";
  legacyRun.resource_versions = resourceVersions("orchestration-registry-1.0.0.json");
  delete legacyRun.resource_versions.orchestration_registry_sha256;
  delete legacyRun.permissions.command_execution;
  const runFile = path.join(temp, "legacy-run.json");
  const assessmentFile = path.join(temp, "assessment.json");
  const output = path.join(temp, "merged.json");
  writeJson(runFile, legacyRun);
  writeJson(assessmentFile, assessmentFixture());

  const result = runNode(mergeArtifactsCli, [
    "--run", runFile, "--assessment", assessmentFile, "--artifact", artifactFile, "--output", output
  ]);
  assertRejected(result, /latest.*audit-run.*6\.0\.0|legacy.*read.only|implicit upgrade/i);
  assert.equal(fs.existsSync(output), false);
}));

test("latest-only operational gate makes pure merge fail closed on exact current run bindings", (t) => withTemp(t, ({ artifactRoot }) => {
  const artifactFile = path.join(artifactRoot, "screening.json");
  const artifact = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-ARIA-NAME" });
  writeJson(artifactFile, artifact);
  const currentRun = screenedRun(artifactRoot, artifactFile, artifact);
  const mutations = [
    ["schema_version", (run) => { run.schema_version = "9.9.9"; }],
    ["resource_versions.orchestration_registry_sha256", (run) => { run.resource_versions.orchestration_registry_sha256 = "0".repeat(64); }],
    ["profile.registry_version", (run) => { run.profile.registry_version = "9.9.9"; }],
    ["permissions canonical", (run) => { run.permissions.allowed_actions.push("execute_commands"); }]
  ];

  for (const [binding, mutate] of mutations) {
    const run = structuredClone(currentRun);
    mutate(run);
    const resources = pureMergeResources(run, artifactRoot);
    assert.throws(
      () => mergeArtifactRecords({ run, assessment: assessmentFixture(), artifacts: [artifact], registries: resources }),
      /current operational run|latest.*audit-run|schema_version|resource_versions|profile\.registry_version|permissions.*canonical/i,
      binding
    );
  }
}));

test("latest-only operational gate rejects inactive profiles in pure merge", (t) => withTemp(t, ({ artifactRoot }) => {
  const run = initialRun(artifactRoot);
  run.profile.id = "authoring-agent";
  const assessment = assessmentFixture();
  assessment.assessment.profile.id = "authoring-agent";
  assessment.assessment.results = [];

  assert.throws(
    () => mergeArtifactRecords({ run, assessment, artifacts: [], registries: pureMergeResources(run, artifactRoot) }),
    /known active profile|unknown or inactive profile/i
  );
}));

test("pure merge rejects filesystem-independent registration and history semantic corruption", (t) => withTemp(t, ({ artifactRoot }) => {
  const firstFile = path.join(artifactRoot, "first.json");
  const secondFile = path.join(artifactRoot, "second.json");
  const first = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-FIRST" });
  const second = screeningEnvelope({ artifactId: "ART-SCREEN-002", requirementId: "SCREEN-SECOND", capturedAt: "2026-07-17T12:00:02Z" });
  writeJson(firstFile, first);
  writeJson(secondFile, second);
  const baseRun = screenedRun(artifactRoot, firstFile, first);
  baseRun.artifacts.push(registerEntry(artifactRoot, secondFile, second));
  baseRun.artifacts.sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
  const variants = [
    ["status/history disagreement", () => {
      const run = structuredClone(baseRun);
      run.status = "initialized";
      run.history = [];
      return { run, artifacts: [first, second] };
    }],
    ["invalid registration status", () => {
      const run = structuredClone(baseRun);
      run.artifacts[0].validation_status = "invalid";
      return { run, artifacts: [first, second] };
    }],
    ["duplicate artifact IDs", () => {
      const run = screenedRun(artifactRoot, firstFile, first);
      const duplicateId = registerEntry(artifactRoot, secondFile, second);
      duplicateId.artifact_id = first.artifact_id;
      duplicateId.created_at = first.created_at;
      run.artifacts.push(duplicateId);
      return { run, artifacts: [first] };
    }],
    ["duplicate normalized artifact paths", () => {
      const run = structuredClone(baseRun);
      run.artifacts[1].path = run.artifacts[0].path;
      return { run, artifacts: [first, second] };
    }],
    ["non-normalized artifact path", () => {
      const run = structuredClone(baseRun);
      run.artifacts[0].path = `./${run.artifacts[0].path}`;
      return { run, artifacts: [first, second] };
    }],
    ["unsorted artifact registrations", () => {
      const run = structuredClone(baseRun);
      run.artifacts.reverse();
      return { run, artifacts: [first, second] };
    }]
  ];
  const accepted = [];
  for (const [name, build] of variants) {
    const { run, artifacts } = build();
    try {
      mergeArtifactRecords({ run, assessment: assessmentFixture(), artifacts, registries: pureMergeResources(run, artifactRoot) });
      accepted.push(name);
    } catch {}
  }
  assert.deepEqual(accepted, [], `Pure merge accepted corrupt run semantics: ${accepted.join(", ")}`);
}));

test("pure merge rejects filesystem-independent artifact input semantic corruption", (t) => withTemp(t, ({ artifactRoot }) => {
  const fixture = makeHumanReviewRun(artifactRoot);
  const baseArtifacts = [readJson(fixture.screenFile), readJson(fixture.queueFile), readJson(fixture.humanFile)];
  const variants = [
    ["cross-run input", (artifacts) => { artifacts[1].inputs[0].run_id = "RUN-20260717T120000Z-OTHER001"; }],
    ["unregistered input", (artifacts) => { artifacts[1].inputs[0].artifact_id = "ART-MISSING-001"; }],
    ["input SHA mismatch", (artifacts) => { artifacts[1].inputs[0].sha256 = "0".repeat(64); }],
    ["disallowed future input type", (artifacts) => {
      artifacts[1].inputs[0] = {
        artifact_id: artifacts[2].artifact_id,
        run_id: runId,
        sha256: fixture.run.artifacts.find((entry) => entry.artifact_id === artifacts[2].artifact_id).sha256
      };
    }]
  ];
  const accepted = [];
  for (const [name, mutate] of variants) {
    const artifacts = structuredClone(baseArtifacts);
    mutate(artifacts);
    try {
      mergeArtifactRecords({
        run: structuredClone(fixture.run),
        assessment: assessmentFixture(),
        artifacts,
        registries: pureMergeResources(fixture.run, artifactRoot)
      });
      accepted.push(name);
    } catch {}
  }
  assert.deepEqual(accepted, [], `Pure merge accepted corrupt artifact input semantics: ${accepted.join(", ")}`);
}));

test("pure merge rejects a legacy queue payload in a current run", (t) => withTemp(t, ({ artifactRoot }) => {
  const fixture = makeHumanReviewRun(artifactRoot);
  const queue = readJson(fixture.queueFile);
  queue.payload.schema_version = "1.0.0";
  delete queue.payload.items[0].generic_method_ref;
  delete queue.payload.items[0].official_sources;
  assert.throws(
    () => mergeArtifactRecords({
      run: fixture.run,
      assessment: assessmentFixture(),
      artifacts: [readJson(fixture.screenFile), queue, readJson(fixture.humanFile)],
      registries: pureMergeResources(fixture.run, artifactRoot)
    }),
    /human-review-queue.*schema_version.*2\.0\.0|current.*payload|orchestration registry/i
  );
}));

test("pure merge rejects a current queue whose machine binding differs from lookup", (t) => withTemp(t, ({ artifactRoot }) => {
  const fixture = makeHumanReviewRun(artifactRoot);
  const queue = readJson(fixture.queueFile);
  queue.payload.items[0].official_sources = ["https://example.invalid/not-authoritative"];
  writeJson(fixture.queueFile, queue);
  fixture.run.artifacts.find((entry) => entry.artifact_id === queue.artifact_id).sha256 = sha256File(fixture.queueFile);
  const human = readJson(fixture.humanFile);
  human.inputs[0].sha256 = sha256File(fixture.queueFile);
  writeJson(fixture.humanFile, human);
  fixture.run.artifacts.find((entry) => entry.artifact_id === human.artifact_id).sha256 = sha256File(fixture.humanFile);
  assert.throws(
    () => mergeArtifactRecords({
      run: fixture.run,
      assessment: assessmentFixture(),
      artifacts: [readJson(fixture.screenFile), queue, human],
      registries: pureMergeResources(fixture.run, artifactRoot)
    }),
    /human review queue.*binding|lookup version|official_sources/i
  );
}));

test("schema manifest loader rejects same-version schema swaps and duplicate schema-file references", (t) => withTemp(t, ({ temp }) => {
  for (const [label, mutate, pattern] of [
    ["same-version swap", (registry) => {
      const authorization = registry.artifact_types.find((item) => item.id === "fix-authorization");
      const change = registry.artifact_types.find((item) => item.id === "change-record");
      [authorization.schema_versions[0].schema_file, change.schema_versions[0].schema_file] = [
        change.schema_versions[0].schema_file,
        authorization.schema_versions[0].schema_file
      ];
    }, /canonical artifact type manifest changed|artifact_types.*must equal|schema.*\$id|artifact type.*schema/i],
    ["duplicate schema file", (registry) => {
      const authorization = registry.artifact_types.find((item) => item.id === "fix-authorization");
      const change = registry.artifact_types.find((item) => item.id === "change-record");
      change.schema_versions[0].schema_file = authorization.schema_versions[0].schema_file;
    }, /canonical artifact type manifest changed|artifact_types.*must equal|duplicate.*schema.*file|schema.*file.*duplicate/i]
  ]) {
    const copiedSkill = path.join(temp, label.replaceAll(" ", "-"));
    copyDirectory(path.join(skillRoot, "references"), path.join(copiedSkill, "references"));
    const registryFile = path.join(copiedSkill, "references/orchestration-registry.json");
    const registry = readJson(registryFile);
    mutate(registry);
    writeJson(registryFile, registry);
    assert.throws(() => loadAuditResources(copiedSkill), pattern, label);
  }
}));

test("current registry binds normalized change-record schema content", (t) => withTemp(t, ({ temp }) => {
  const copiedSkill = path.join(temp, "schema-hash-mismatch");
  copyDirectory(path.join(skillRoot, "references"), path.join(copiedSkill, "references"));
  const schemaFile = path.join(copiedSkill, "references/change-record.schema.json");
  fs.writeFileSync(schemaFile, fs.readFileSync(schemaFile, "utf8").replace(/\r?\n/gu, "\r\n"), "utf8");
  assert.doesNotThrow(() => loadAuditResources(copiedSkill), "line-ending conversion must preserve the schema binding");
  fs.appendFileSync(schemaFile, " ", "utf8");
  assert.throws(() => loadAuditResources(copiedSkill), /change-record.*schema SHA-256 mismatch|schema SHA-256 mismatch.*change-record/i);
}));

test("frozen registry 1 payload compatibility stays fixed at 1.0.0 alongside newer current schemas", () => {
  const resources = loadAuditResources(skillRoot);
  const frozenPolicy = resources.orchestrationRegistries.get("1.0.0").payloadVersions;
  assert.equal(frozenPolicy.get("human-review-queue"), "1.0.0");
  assert.equal(frozenPolicy.get("remediation-plan"), "1.0.0");
  assert.equal(resources.currentPayloadVersions.get("human-review-queue"), "2.0.0");
  assert.equal(resources.currentPayloadVersions.get("remediation-plan"), "2.0.0");
});

test("each registry derives its own exact per-artifact payload compatibility policy", () => {
  const resources = loadAuditResources(skillRoot);
  const expected = new Map([
    ["1.0.0", {
      "screening-observations": "1.0.0",
      "human-review-queue": "1.0.0",
      "declared-human-review": "1.0.0",
      "remediation-plan": "1.0.0",
      "fix-authorization": "1.0.0",
      "change-record": "1.0.0"
    }],
    ["2.0.0", {
      "screening-observations": "1.0.0",
      "human-review-queue": "2.0.0",
      "declared-human-review": "1.0.0",
      "remediation-plan": "2.0.0",
      "fix-authorization": "1.0.0",
      "change-record": "1.0.0"
    }],
    ["3.0.0", {
      "screening-observations": "1.0.0",
      "human-review-queue": "2.0.0",
      "declared-human-review": "1.0.0",
      "remediation-plan": "2.0.0",
      "fix-authorization": "2.0.0",
      "change-record": "2.0.0"
    }],
    ["4.0.0", {
      "screening-observations": "1.0.0",
      "human-review-queue": "2.0.0",
      "declared-human-review": "1.0.0",
      "remediation-plan": "2.0.0",
      "fix-authorization": "2.0.0",
      "change-record": "2.0.0"
    }],
    ["5.0.0", {
      "screening-observations": "2.0.0",
      "human-review-queue": "2.0.0",
      "declared-human-review": "1.0.0",
      "remediation-plan": "2.0.0",
      "fix-authorization": "2.0.0",
      "change-record": "2.0.0"
    }]
  ]);
  assert.deepEqual([...resources.orchestrationRegistries.keys()], [...expected.keys()]);
  for (const [registryVersion, payloadVersions] of expected) {
    assert.deepEqual(
      Object.fromEntries(resources.orchestrationRegistries.get(registryVersion).payloadVersions),
      payloadVersions,
      registryVersion
    );
  }
});

test("registry 2 rejects remediation artifact payload 2 while registry 3 rejects payload 1 through shared validation and registration", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const resources = loadAuditResources(skillRoot);
  const registry2Policy = resources.orchestrationRegistries.get("2.0.0").payloadVersions;
  const currentPolicy = resources.orchestrationRegistries.get("3.0.0").payloadVersions;
  const currentArtifacts = [
    artifactEnvelope({
      artifactId: "ART-AUTHORIZATION-V2",
      artifactType: "fix-authorization",
      roleId: "declared_authorizer",
      producerKind: "external_requester",
      payload: fixAuthorizationPayload()
    }),
    artifactEnvelope({
      artifactId: "ART-CHANGE-V2",
      artifactType: "change-record",
      roleId: "authorized_fixer",
      payload: changePayload("ART-AUTHORIZATION-001", "a".repeat(64))
    })
  ];
  for (const artifact of currentArtifacts) {
    const validation = validateArtifact(artifact, resources, { allowedPayloadVersions: registry2Policy });
    assert.equal(validation.valid, false, `${artifact.artifact_type} v2 unexpectedly passed registry 2`);
    assert.match(validation.errors.join("\n"), /payload schema_version.*1\.0\.0|allowed.*1\.0\.0/i);
  }

  for (const artifactType of ["fix-authorization", "change-record"]) {
    const legacyRoot = path.join(temp, `run3-${artifactType}`);
    fs.mkdirSync(legacyRoot);
    const legacyFixture = makeScreeningRemediationRun(legacyRoot);
    legacyFixture.run.schema_version = "3.0.0";
    legacyFixture.run.resource_versions = resourceVersions("orchestration-registry-2.0.0.json");
    delete legacyFixture.run.permissions.command_execution;
    let legacyAuthorization;
    let legacyAuthorizationFile;
    if (artifactType === "change-record") {
      const payload = legacyFixAuthorizationPayload();
      payload.remediation_artifact.sha256 = sha256File(legacyFixture.remediationFile);
      legacyAuthorization = artifactEnvelope({
        artifactId: "ART-AUTHORIZATION-V1",
        artifactType: "fix-authorization",
        roleId: "declared_authorizer",
        producerKind: "external_requester",
        createdAt: "2026-07-17T12:00:05Z",
        inputs: [{ artifact_id: legacyFixture.remediation.artifact_id, run_id: runId, sha256: sha256File(legacyFixture.remediationFile) }],
        payload
      });
      legacyAuthorizationFile = path.join(legacyRoot, "authorization-v1.json");
      writeJson(legacyAuthorizationFile, legacyAuthorization);
      legacyFixture.run.artifacts.push(registerEntry(legacyRoot, legacyAuthorizationFile, legacyAuthorization));
      legacyFixture.run.history.push({
        from: "remediation_ready", to: "fix_authorized", at: legacyAuthorization.created_at,
        actor_role: "declared_authorizer", artifact_ids: [legacyAuthorization.artifact_id]
      });
      legacyFixture.run.status = "fix_authorized";
    }
    const artifact = artifactType === "fix-authorization"
      ? artifactEnvelope({
          artifactId: "ART-AUTHORIZATION-V2",
          artifactType,
          roleId: "declared_authorizer",
          producerKind: "external_requester",
          createdAt: "2026-07-17T12:00:05Z",
          inputs: [{ artifact_id: legacyFixture.remediation.artifact_id, run_id: runId, sha256: sha256File(legacyFixture.remediationFile) }],
          payload: { ...fixAuthorizationPayload(), remediation_artifact: { artifact_id: legacyFixture.remediation.artifact_id, sha256: sha256File(legacyFixture.remediationFile) } }
        })
      : artifactEnvelope({
          artifactId: "ART-CHANGE-V2",
          artifactType,
          roleId: "authorized_fixer",
          createdAt: "2026-07-17T12:00:06Z",
          inputs: [
            { artifact_id: legacyFixture.remediation.artifact_id, run_id: runId, sha256: sha256File(legacyFixture.remediationFile) },
            { artifact_id: legacyAuthorization.artifact_id, run_id: runId, sha256: sha256File(legacyAuthorizationFile) }
          ],
          payload: changePayload(legacyAuthorization.artifact_id, sha256File(legacyAuthorizationFile))
        });
    const artifactFile = path.join(legacyRoot, `${artifactType}-v2.json`);
    writeJson(artifactFile, artifact);
    legacyFixture.run.artifacts.push(registerEntry(legacyRoot, artifactFile, artifact));
    legacyFixture.run.artifacts.sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
    legacyFixture.run.history.push({
      from: artifactType === "fix-authorization" ? "remediation_ready" : "fix_authorized",
      to: artifactType === "fix-authorization" ? "fix_authorized" : "retest_required",
      at: artifact.created_at,
      actor_role: artifact.producer.role_id,
      artifact_ids: [artifact.artifact_id]
    });
    legacyFixture.run.status = artifactType === "fix-authorization" ? "fix_authorized" : "retest_required";
    const validation = validateAuditRun(legacyFixture.run, {
      skillRoot,
      runFile: path.join(temp, `run3-${artifactType}.json`)
    });
    assert.equal(validation.valid, false, `run 3 unexpectedly accepted ${artifactType} v2`);
    assert.match(validation.errors.join("\n"), /payload schema_version.*1\.0\.0|allowed.*1\.0\.0/i);
  }

  const fixture = makeScreeningRemediationRun(artifactRoot);
  fixture.run = authorizedInitialRun(artifactRoot);
  fixture.run.status = "remediation_ready";
  fixture.run.artifacts = [
    registerEntry(artifactRoot, fixture.screenFile, fixture.screen),
    registerEntry(artifactRoot, fixture.queueFile, fixture.queue),
    registerEntry(artifactRoot, fixture.remediationFile, fixture.remediation)
  ].sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
  fixture.run.history = [
    { from: "initialized", to: "screened", at: fixture.screen.created_at, actor_role: "e1_inspector", artifact_ids: [fixture.screen.artifact_id] },
    { from: "screened", to: "human_queue_ready", at: fixture.queue.created_at, actor_role: "human_queue_planner", artifact_ids: [fixture.queue.artifact_id] },
    { from: "human_queue_ready", to: "remediation_ready", at: fixture.remediation.created_at, actor_role: "remediation_planner", artifact_ids: [fixture.remediation.artifact_id] }
  ];
  const legacyArtifacts = [
    artifactEnvelope({
      artifactId: "ART-AUTHORIZATION-V1",
      artifactType: "fix-authorization",
      roleId: "declared_authorizer",
      producerKind: "external_requester",
      inputs: [{ artifact_id: fixture.remediation.artifact_id, run_id: runId, sha256: sha256File(fixture.remediationFile) }],
      payload: legacyFixAuthorizationPayload()
    }),
    artifactEnvelope({
      artifactId: "ART-CHANGE-V1",
      artifactType: "change-record",
      roleId: "authorized_fixer",
      inputs: [{ artifact_id: fixture.remediation.artifact_id, run_id: runId, sha256: sha256File(fixture.remediationFile) }],
      payload: legacyChangePayload()
    })
  ];
  for (const artifact of legacyArtifacts) {
    const validation = validateArtifact(artifact, resources, { allowedPayloadVersions: currentPolicy });
    assert.equal(validation.valid, false, `${artifact.artifact_type} v1 unexpectedly passed registry 3`);
    assert.match(validation.errors.join("\n"), /payload schema_version.*2\.0\.0|allowed.*2\.0\.0/i);
    const artifactFile = path.join(artifactRoot, `${artifact.artifact_id}.json`);
    writeJson(artifactFile, artifact);
    assert.throws(
      () => registerArtifactRecord(fixture.run, artifact, { skillRoot, runFile: path.join(temp, "run.json"), artifactFile }),
      /payload schema_version.*2\.0\.0|allowed.*2\.0\.0/i
    );
  }
}));

test("denied run cannot register, validate, or merge fix authorization and change records", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const fixture = makeScreeningRemediationRun(artifactRoot);
  const authorizationPayload = fixAuthorizationPayload();
  authorizationPayload.remediation_artifact.sha256 = sha256File(fixture.remediationFile);
  const authorization = artifactEnvelope({
    artifactId: "ART-AUTHORIZATION-001",
    artifactType: "fix-authorization",
    roleId: "declared_authorizer",
    producerKind: "external_requester",
    createdAt: "2026-07-17T12:00:05Z",
    inputs: [{ artifact_id: fixture.remediation.artifact_id, run_id: runId, sha256: sha256File(fixture.remediationFile) }],
    payload: authorizationPayload
  });
  const authorizationFile = path.join(artifactRoot, "authorization.json");
  writeJson(authorizationFile, authorization);
  const change = artifactEnvelope({
    artifactId: "ART-CHANGE-001",
    artifactType: "change-record",
    roleId: "authorized_fixer",
    createdAt: "2026-07-17T12:00:06Z",
    inputs: [
      { artifact_id: fixture.remediation.artifact_id, run_id: runId, sha256: sha256File(fixture.remediationFile) },
      { artifact_id: authorization.artifact_id, run_id: runId, sha256: sha256File(authorizationFile) }
    ],
    payload: changePayload(authorization.artifact_id, sha256File(authorizationFile))
  });
  const changeFile = path.join(artifactRoot, "change.json");
  writeJson(changeFile, change);
  const permissionPattern = /source_write.*authorized_only[^]*command_execution.*authorized_verification_only|remediation artifact.*permissions/i;

  for (const [artifact, artifactFile] of [[authorization, authorizationFile], [change, changeFile]]) {
    assert.throws(
      () => registerArtifactRecord(fixture.run, artifact, { skillRoot, runFile: path.join(temp, "run.json"), artifactFile }),
      permissionPattern,
      `${artifact.artifact_type} registration must fail closed`
    );
  }

  fixture.run.status = "retest_required";
  fixture.run.artifacts.push(
    registerEntry(artifactRoot, authorizationFile, authorization),
    registerEntry(artifactRoot, changeFile, change)
  );
  fixture.run.artifacts.sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
  fixture.run.history.push(
    { from: "remediation_ready", to: "fix_authorized", at: authorization.created_at, actor_role: "declared_authorizer", artifact_ids: [authorization.artifact_id] },
    { from: "fix_authorized", to: "retest_required", at: change.created_at, actor_role: "authorized_fixer", artifact_ids: [change.artifact_id] }
  );
  const validation = validateAuditRun(fixture.run, { skillRoot, runFile: path.join(temp, "run.json") });
  assert.equal(validation.valid, false, "denied run validation unexpectedly accepted remediation artifacts");
  assert.match(validation.errors.join("\n"), permissionPattern);
  assert.throws(
    () => mergeArtifactRecords({
      run: fixture.run,
      assessment: assessmentFixture(),
      artifacts: [...fixture.artifacts, authorization, change],
      registries: pureMergeResources(fixture.run, artifactRoot)
    }),
    permissionPattern
  );
}));

test("current artifact validation rejects duplicate remediation semantic keys even when records differ", () => {
  const resources = loadAuditResources(skillRoot);
  const cases = [];
  const authorization = artifactEnvelope({
    artifactId: "ART-AUTHORIZATION-DUP",
    artifactType: "fix-authorization",
    roleId: "declared_authorizer",
    producerKind: "external_requester",
    payload: fixAuthorizationPayload()
  });
  authorization.payload.verification_commands.push({
    ...structuredClone(authorization.payload.verification_commands[0]),
    args: ["run", "different"]
  });
  cases.push([authorization, /fix-authorization.*command_id.*unique/i]);

  const duplicatePath = artifactEnvelope({
    artifactId: "ART-CHANGE-PATH-DUP",
    artifactType: "change-record",
    roleId: "authorized_fixer",
    payload: changePayload("ART-AUTHORIZATION-001", "a".repeat(64))
  });
  duplicatePath.payload.changed_files.push({
    ...structuredClone(duplicatePath.payload.changed_files[0]),
    operation: "delete",
    after_sha256: null,
    description: "A different record using the same path."
  });
  cases.push([duplicatePath, /change-record.*changed_files.*path.*unique/i]);

  const duplicateCommand = artifactEnvelope({
    artifactId: "ART-CHANGE-COMMAND-DUP",
    artifactType: "change-record",
    roleId: "authorized_fixer",
    payload: changePayload("ART-AUTHORIZATION-001", "a".repeat(64))
  });
  duplicateCommand.payload.command_results.push({
    ...structuredClone(duplicateCommand.payload.command_results[0]),
    args: ["run", "different"],
    stdout_sha256: "f".repeat(64)
  });
  cases.push([duplicateCommand, /change-record.*command_id.*unique/i]);

  for (const [artifact, pattern] of cases) {
    const validation = validateArtifact(artifact, resources, { allowedPayloadVersions: resources.currentPayloadVersions });
    assert.equal(validation.valid, false, `${artifact.artifact_id} unexpectedly passed`);
    assert.match(validation.errors.join("\n"), pattern);
  }
});

test("run 3 with frozen registry 2 stays readable but register and merge remain read-only", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const artifactFile = path.join(artifactRoot, "screening.json");
  const artifact = screeningEnvelope({ artifactId: "ART-SCREEN-003", requirementId: "SCREEN-LEGACY-V3" });
  downgradeScreeningEnvelopeToV1(artifact);
  writeJson(artifactFile, artifact);
  const run = screenedRun(artifactRoot, artifactFile, artifact);
  run.schema_version = "3.0.0";
  run.resource_versions = resourceVersions("orchestration-registry-2.0.0.json");
  delete run.permissions.command_execution;
  const runFile = path.join(temp, "run-3.json");
  assert.equal(validateAuditRun(run, { skillRoot, runFile }).valid, true);
  assert.throws(
    () => registerArtifactRecord(run, artifact, { skillRoot, runFile, artifactFile }),
    /latest.*audit-run.*6\.0\.0|legacy.*read.only|implicit upgrade/i
  );
  assert.throws(
    () => mergeArtifactRecords({ run, assessment: assessmentFixture(), artifacts: [artifact], registries: pureMergeResources(run, artifactRoot) }),
    /latest.*audit-run.*6\.0\.0|legacy.*read.only|implicit upgrade/i
  );
}));

test("merge baseline rejects current-run-unprovable participation assurance claim and review metadata", (t) => withTemp(t, ({ artifactRoot }) => {
  const artifactFile = path.join(artifactRoot, "screening.json");
  const artifact = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-FIRST" });
  writeJson(artifactFile, artifact);
  const run = screenedRun(artifactRoot, artifactFile, artifact);
  const resources = pureMergeResources(run, artifactRoot);
  const referenceTemplates = resources.standardsRegistry.claim_templates.reference_only;
  const variants = [
    ["participation pass", (assessment) => { assessment.assessment.participation_coverage.find = "pass"; }],
    ["independent audit", (assessment) => {
      assessment.assessment.assurance.independent_audit = {
        performed: true,
        evaluator_independent: true,
        scope_method: "Injected prior audit scope",
        report_location: "prior-audit.json"
      };
    }],
    ["legal or procurement dossier", (assessment) => {
      assessment.assessment.assurance.legal_or_procurement_dossier = {
        prepared: true,
        responsible_owner: "Injected owner",
        artifacts: ["prior-dossier.json"]
      };
    }],
    ["noncanonical reference claim", (assessment) => { assessment.assessment.claim.proposed_wording = referenceTemplates[1]; }],
    ["next review date", (assessment) => { assessment.assessment.next_review_at = "2027-07-17"; }]
  ];
  const accepted = [];
  for (const [name, mutate] of variants) {
    const assessment = assessmentFixture();
    mutate(assessment);
    try {
      mergeArtifactRecords({ run, assessment, artifacts: [artifact], registries: resources });
      accepted.push(name);
    } catch {}
  }
  assert.deepEqual(accepted, [], `Merge accepted unprovable E0 baseline data: ${accepted.join(", ")}`);
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

test("run 4 queue registration enforces exact lookup bindings, unique profile requirements, and exact coverage counts", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const screenFile = path.join(artifactRoot, "screening.json");
  const screen = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-FIRST" });
  writeJson(screenFile, screen);
  const runFile = path.join(temp, "audit-run.json");
  const run = screenedRun(artifactRoot, screenFile, screen);
  const input = [{ artifact_id: screen.artifact_id, run_id: runId, sha256: sha256File(screenFile) }];

  const validQueue = queueEnvelope({ artifactId: "ART-QUEUE-VALID", inputs: input });
  const validFile = path.join(artifactRoot, "queue-valid.json");
  writeJson(validFile, validQueue);
  const registered = registerArtifactRecord(run, validQueue, { skillRoot, runFile, artifactFile: validFile });
  assert.equal(registered.status, "human_queue_ready");

  const twoProcedurePayload = queuePayloadFor([
    "WCAG-2.2-SC-2.1.1",
    "WCAG-2.2-SC-4.1.2"
  ]);
  assert.deepEqual(twoProcedurePayload.procedure_coverage, {
    total_requirements: 2,
    available_procedures: 2,
    unavailable_procedures: 0
  });
  assert.deepEqual(twoProcedurePayload.items.map((item) => item.procedure_availability), ["available", "available"]);
  const twoProcedureQueue = queueEnvelope({ artifactId: "ART-QUEUE-TWO-PROCEDURES", inputs: input, payload: twoProcedurePayload });
  const twoProcedureFile = path.join(artifactRoot, "queue-two-procedures.json");
  writeJson(twoProcedureFile, twoProcedureQueue);
  const registeredTwoProcedureQueue = registerArtifactRecord(run, twoProcedureQueue, {
    skillRoot,
    runFile,
    artifactFile: twoProcedureFile
  });
  assert.equal(registeredTwoProcedureQueue.status, "human_queue_ready");

  const cases = [
    ["stale procedure ref", (payload) => { payload.items[0].procedure_ref = "criterion-procedures:0.9.0#wcag22-sc-1-1-1-non-text-content"; }],
    ["wrong sources", (payload) => { payload.items[0].official_sources = ["https://example.invalid/not-authoritative"]; }],
    ["wrong actions", (payload) => { payload.items[0].human_actions = ["Guess the result."]; }],
    ["wrong evidence", (payload) => { payload.items[0].required_evidence_types = ["manual_observation"]; }],
    ["wrong cannot-tell", (payload) => { payload.items[0].cant_tell_conditions = ["Never."]; }],
    ["unregistered requirement", (payload) => { payload.items[0].requirement_id = "WCAG-2.2-SC-9.9.9"; }],
    ["duplicate requirement", (payload) => {
      payload.items.push(structuredClone(payload.items[0]));
      payload.procedure_coverage = { total_requirements: 2, available_procedures: 2, unavailable_procedures: 0 };
    }],
    ["false total", (payload) => { payload.procedure_coverage.total_requirements = 55; }],
    ["false split", (payload) => { payload.procedure_coverage = { total_requirements: 1, available_procedures: 0, unavailable_procedures: 1 }; }]
  ];
  for (const [index, [label, mutate]] of cases.entries()) {
    const payload = queuePayload();
    mutate(payload);
    const queue = queueEnvelope({ artifactId: `ART-QUEUE-BAD-${String(index + 1).padStart(2, "0")}`, inputs: input, payload });
    const file = path.join(artifactRoot, `queue-bad-${index}.json`);
    writeJson(file, queue);
    assert.throws(
      () => registerArtifactRecord(run, queue, { skillRoot, runFile, artifactFile: file }),
      /queue|binding|requirement|procedure|source|evidence|coverage|duplicate|lookup/i,
      label
    );
  }

  const unavailablePayload = queuePayload("WCAG-2.2-SC-2.2.1");
  unavailablePayload.items[0].generic_method_ref = "web-audit-methods:1.0.0#adaptable-structure";
  const unavailable = queueEnvelope({ artifactId: "ART-QUEUE-BAD-GENERIC", inputs: input, payload: unavailablePayload });
  const unavailableFile = path.join(artifactRoot, "queue-bad-generic.json");
  writeJson(unavailableFile, unavailable);
  assert.throws(
    () => registerArtifactRecord(run, unavailable, { skillRoot, runFile, artifactFile: unavailableFile }),
    /queue|binding|generic|method|lookup/i
  );
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

test("declared human review is bound to its registered queue, current procedure, sources, and required evidence", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const fixture = makeHumanReviewRun(artifactRoot);
  const runFile = path.join(temp, "run.json");
  const baseline = validateAuditRun(fixture.run, { skillRoot, runFile });
  assert.equal(baseline.valid, true, baseline.errors.join("\n"));
  const humanEntry = fixture.run.artifacts.find((entry) => entry.artifact_id === fixture.human.artifact_id);

  function validateMutation(mutate) {
    const human = structuredClone(fixture.human);
    mutate(human.payload.reviews[0]);
    writeJson(fixture.humanFile, human);
    humanEntry.sha256 = sha256File(fixture.humanFile);
    return validateAuditRun(fixture.run, { skillRoot, runFile });
  }

  const outsideQueue = validateMutation((review) => {
    review.requirement_id = "WCAG-2.2-SC-1.3.1";
    review.criterion_procedure_ref = "criterion-procedures:1.0.0#wcag22-sc-1-3-1-info-and-relationships";
    review.official_sources = [
      "https://www.w3.org/TR/WCAG22/#info-and-relationships",
      "https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html"
    ];
  });
  assert.equal(outsideQueue.valid, false);
  assert.match(outsideQueue.errors.join("\n"), /queue.*WCAG-2\.2-SC-1\.3\.1|not.*queued/i);

  const wrongProcedure = validateMutation((review) => {
    review.criterion_procedure_ref = "criterion-procedures:1.0.0#wcag22-sc-1-3-1-info-and-relationships";
  });
  assert.equal(wrongProcedure.valid, false);
  assert.match(wrongProcedure.errors.join("\n"), /procedure.*queue|registered procedure|procedure_ref/i);

  const wrongSources = validateMutation((review) => {
    review.official_sources = ["https://www.w3.org/TR/WCAG22/#non-text-content"];
  });
  assert.equal(wrongSources.valid, false);
  assert.match(wrongSources.errors.join("\n"), /official_sources|primary sources/i);

  const missingEvidenceType = validateMutation((review) => {
    review.target_specific_evidence = review.target_specific_evidence.filter((item) => item.type !== "manual_observation");
  });
  assert.equal(missingEvidenceType.valid, false);
  assert.match(missingEvidenceType.errors.join("\n"), /required evidence|manual_observation/i);
}));

test("unavailable declared review uses the queued criterion's current generic method and catalog sources", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const fixture = makeHumanReviewRun(artifactRoot);
  const queue = readJson(fixture.queueFile);
  queue.payload = queuePayload("WCAG-2.2-SC-1.2.1");
  writeJson(fixture.queueFile, queue);

  const resources = loadAuditResources(skillRoot);
  const catalog = Object.values(resources.criteriaCatalog.catalogs).flat().find((item) => item.id === "WCAG-2.2-SC-1.2.1");
  const human = readJson(fixture.humanFile);
  human.inputs[0].sha256 = sha256File(fixture.queueFile);
  human.payload.reviews = [{
    requirement_id: "WCAG-2.2-SC-1.2.1",
    procedure_availability: "unavailable",
    criterion_procedure_ref: null,
    generic_method_ref: `web-audit-methods:${resources.auditMethods.schema_version}#${catalog.method_key}`,
    official_sources: structuredClone(catalog.official_method_sources),
    target_specific_evidence: [{
      type: "manual_observation",
      location: "media player",
      observation: "The media alternative was reviewed manually.",
      captured_at: "2026-07-17T12:00:04Z"
    }, {
      type: "assistive_technology_test",
      location: "media player",
      observation: "The media alternative was checked with assistive technology.",
      captured_at: "2026-07-17T12:00:04Z"
    }],
    profile_outcome: "pass",
    rationale: "The queued generic review was completed."
  }];
  writeJson(fixture.humanFile, human);
  fixture.run.artifacts.find((entry) => entry.artifact_id === queue.artifact_id).sha256 = sha256File(fixture.queueFile);
  fixture.run.artifacts.find((entry) => entry.artifact_id === human.artifact_id).sha256 = sha256File(fixture.humanFile);

  const runFile = path.join(temp, "run.json");
  const baseline = validateAuditRun(fixture.run, { skillRoot, runFile });
  assert.equal(baseline.valid, true, baseline.errors.join("\n"));

  human.payload.reviews[0].generic_method_ref = `web-audit-methods:${resources.auditMethods.schema_version}#adaptable-structure`;
  writeJson(fixture.humanFile, human);
  fixture.run.artifacts.find((entry) => entry.artifact_id === human.artifact_id).sha256 = sha256File(fixture.humanFile);
  const wrongMethod = validateAuditRun(fixture.run, { skillRoot, runFile });
  assert.equal(wrongMethod.valid, false);
  assert.match(wrongMethod.errors.join("\n"), /generic_method_ref|current generic method/i);

  human.payload.reviews[0].generic_method_ref = `web-audit-methods:${resources.auditMethods.schema_version}#${catalog.method_key}`;
  human.payload.reviews[0].official_sources = [catalog.official_method_sources[0]];
  writeJson(fixture.humanFile, human);
  fixture.run.artifacts.find((entry) => entry.artifact_id === human.artifact_id).sha256 = sha256File(fixture.humanFile);
  const wrongSources = validateAuditRun(fixture.run, { skillRoot, runFile });
  assert.equal(wrongSources.valid, false);
  assert.match(wrongSources.errors.join("\n"), /official_sources|catalog sources/i);
}));

test("merge reconstructs only from an E0 assessment baseline with no prior results, findings, or evidence", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const screen = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-CURRENT" });
  const screenFile = path.join(artifactRoot, "screen.json");
  writeJson(screenFile, screen);
  const run = screenedRun(artifactRoot, screenFile, screen);
  const runFile = path.join(temp, "run.json");
  writeJson(runFile, run);

  const cases = [
    ["foreign-human", injectHumanResult(assessmentFixture())],
    ["prior-screening", (() => {
      const assessment = assessmentFixture();
      assessment.assessment.evidence_level = "E1";
      assessment.assessment.results.push({
        requirement_id: "SCREEN-PRIOR",
        requirement_kind: "screening_check",
        requirement_source: "",
        mapping_status: "unverified",
        outcome: "cant_tell",
        method_kind: "automated",
        method: "Prior screening",
        evidence: [{ type: "other", location: "prior", observation: "Prior evidence", captured_at: "2026-07-17T11:00:00Z" }],
        notes: "Prior screening evidence."
      });
      return assessment;
    })()],
    ["prior-finding", (() => {
      const assessment = assessmentFixture();
      assessment.assessment.findings.push({
        id: "FIND-PRIOR",
        priority: "P2",
        requirement_ids: [],
        location: "prior",
        affected_users: ["Prior users"],
        observation: "Prior finding.",
        remediation: "Prior remediation.",
        verification: "Prior verification."
      });
      return assessment;
    })()],
    ["prior-profile-evidence", (() => {
      const assessment = assessmentFixture();
      assessment.assessment.results[0].evidence = [{
        type: "other",
        location: "prior",
        observation: "Prior evidence on an unevaluated profile row.",
        captured_at: "2026-07-17T11:00:00Z"
      }];
      return assessment;
    })()]
  ];

  for (const [name, assessment] of cases) {
    const assessmentFile = path.join(temp, `${name}.json`);
    writeJson(assessmentFile, assessment);
    const result = runNode(mergeArtifactsCli, [
      "--run", runFile, "--assessment", assessmentFile, "--artifact", screenFile,
      "--output", path.join(temp, `${name}-merged.json`)
    ]);
    assertRejected(result, /E0 assessment baseline|baseline.*unverified|prior.*screening|prior.*finding|prior.*evidence|current.run provenance/i);
  }
}));

test("merge rejects human result injection that is not the current run's declared review set", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const fixture = makeHumanReviewRun(artifactRoot);
  const runFile = path.join(temp, "run.json");
  const assessmentFile = path.join(temp, "assessment.json");
  writeJson(runFile, fixture.run);
  writeJson(assessmentFile, injectHumanResult(assessmentFixture(), "WCAG-2.2-SC-1.3.1"));
  const result = runNode(mergeArtifactsCli, [
    "--run", runFile, "--assessment", assessmentFile,
    "--artifact", fixture.screenFile, "--artifact", fixture.queueFile, "--artifact", fixture.humanFile,
    "--output", path.join(temp, "merged.json")
  ]);
  assertRejected(result, /E0 assessment baseline|current.run provenance|declared review set/i);
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
  assertRejected(unregisteredResult, /not registered|exact profile row|not queued/i);

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
  const run = authorizedInitialRun(artifactRoot);
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

test("merge requires the complete registered artifact set and pure merge requires registered byte snapshots", (t) => withTemp(t, ({ temp, artifactRoot }) => {
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
  resources.artifact_sha256_by_id = new Map(run.artifacts.map((entry) => [entry.artifact_id, entry.sha256]));
  assert.throws(
    () => mergeArtifactRecords({ run, assessment: assessmentFixture(), artifacts: [first, second], registries: resources }),
    /registered artifact byte snapshots|snapshot.*fail.closed|fails closed/i
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

test("run validation and pure merge enforce the same remediation evidence semantics", (t) => withTemp(t, ({ temp }) => {
  function assertBothReject(name, fixture, pattern) {
    const runFile = path.join(temp, `${name}-run.json`);
    const validation = validateAuditRun(fixture.run, { skillRoot, runFile });
    assert.equal(validation.valid, false, `${name} unexpectedly passed run validation`);
    assert.match(validation.errors.join("\n"), pattern, `${name} run validation used the wrong rejection reason`);
    assert.throws(
      () => mergeArtifactRecords({
        run: fixture.run,
        assessment: assessmentFixture(),
        artifacts: fixture.artifacts,
        registries: pureMergeResources(fixture.run, path.dirname(fixture.screenFile))
      }),
      pattern,
      `${name} unexpectedly passed pure merge`
    );
  }

  function caseRoot(name) {
    const root = path.join(temp, name);
    fs.mkdirSync(root);
    return root;
  }

  {
    const fixture = makeScreeningRemediationRun(caseRoot("source-not-input"));
    fixture.remediation.payload.items[0].source_artifact_ids = ["ART-SCREEN-MISSING"];
    rewriteFixtureArtifact(fixture, fixture.remediation, fixture.remediationFile);
    assertBothReject("source-not-input", fixture, /source_artifact_ids|registered.*input|missing.*source/i);
  }

  {
    const fixture = makeScreeningRemediationRun(caseRoot("wrong-screening-requirement"));
    fixture.remediation.payload.items[0].requirement_id = "SCREEN-OTHER";
    rewriteFixtureArtifact(fixture, fixture.remediation, fixture.remediationFile);
    assertBothReject("wrong-screening-requirement", fixture, /SCREEN-OTHER|exact.*screening|matching.*observation/i);
  }

  {
    const fixture = makeVerifiedFailureRemediationRun(caseRoot("wrong-source-type"));
    const item = fixture.remediation.payload.items[0];
    item.basis = "unverified_screening_candidate";
    item.requirement_id = "SCREEN-FIRST";
    rewriteFixtureArtifact(fixture, fixture.remediation, fixture.remediationFile);
    assertBothReject("wrong-source-type", fixture, /screening-observations|source.*type|screening.*source/i);
  }

  {
    const fixture = makeVerifiedFailureRemediationRun(caseRoot("asserted-only"), "pass");
    assertBothReject("asserted-only", fixture, /verified_failure|profile_outcome.*fail|matching.*failure/i);
  }

  {
    const fixture = makeVerifiedFailureRemediationRun(caseRoot("unused-input"));
    const screen = fixture.artifacts.find((artifact) => artifact.artifact_type === "screening-observations");
    const screenEntry = fixture.run.artifacts.find((entry) => entry.artifact_id === screen.artifact_id);
    fixture.remediation.inputs.push({ artifact_id: screen.artifact_id, run_id: runId, sha256: screenEntry.sha256 });
    rewriteFixtureArtifact(fixture, fixture.remediation, fixture.remediationFile);
    assertBothReject("unused-input", fixture, /unused.*input|input.*must be used|evidence input/i);
  }

  {
    const fixture = makeScreeningRemediationRun(caseRoot("cross-run-input"));
    fixture.remediation.inputs[0].run_id = "RUN-20260717T120000Z-OTHER001";
    rewriteFixtureArtifact(fixture, fixture.remediation, fixture.remediationFile);
    assertBothReject("cross-run-input", fixture, /same run|another run|run_id/i);
  }

  {
    const fixture = makeScreeningRemediationRun(caseRoot("stale-input-hash"));
    fixture.remediation.inputs[0].sha256 = "f".repeat(64);
    rewriteFixtureArtifact(fixture, fixture.remediation, fixture.remediationFile);
    assertBothReject("stale-input-hash", fixture, /hash mismatch|SHA-256/i);
  }
}));

test("legacy run 2 keeps remediation payload 1 readable without retroactive evidence semantics", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const fixture = makeScreeningRemediationRun(artifactRoot);
  fixture.run.schema_version = "2.0.0";
  fixture.run.resource_versions = resourceVersions("orchestration-registry-1.0.0.json");
  delete fixture.run.permissions.command_execution;
  downgradeScreeningEnvelopeToV1(fixture.screen);
  rewriteFixtureArtifact(fixture, fixture.screen, fixture.screenFile);
  fixture.queue.schema_version = "1.0.0";
  fixture.queue.inputs[0].sha256 = sha256File(fixture.screenFile);
  fixture.queue.payload.schema_version = "1.0.0";
  delete fixture.queue.payload.items[0].generic_method_ref;
  delete fixture.queue.payload.items[0].official_sources;
  rewriteFixtureArtifact(fixture, fixture.queue, fixture.queueFile);
  fixture.remediation.schema_version = "1.0.0";
  fixture.remediation.inputs[0].sha256 = sha256File(fixture.screenFile);
  fixture.remediation.payload.schema_version = "1.0.0";
  fixture.remediation.payload.items[0].source_artifact_ids = ["ART-SCREEN-MISSING"];
  for (const field of ["priority", "location", "affected_users", "owner", "residual_limitation"]) {
    delete fixture.remediation.payload.items[0][field];
  }
  rewriteFixtureArtifact(fixture, fixture.remediation, fixture.remediationFile);
  const validation = validateAuditRun(fixture.run, { skillRoot, runFile: path.join(temp, "legacy-run.json") });
  assert.equal(validation.valid, true, validation.errors.join("\n"));
}));

test("merge requires a matching verified-failure remediation for every human failure", (t) => withTemp(t, ({ artifactRoot }) => {
  const fixture = makeHumanReviewRun(artifactRoot);
  fixture.human.payload.reviews[0].profile_outcome = "fail";
  rewriteFixtureArtifact(fixture, fixture.human, fixture.humanFile);
  assert.throws(
    () => mergeArtifactRecords({
      run: fixture.run,
      assessment: assessmentFixture(),
      artifacts: [readJson(fixture.screenFile), readJson(fixture.queueFile), fixture.human],
      registries: pureMergeResources(fixture.run, artifactRoot)
    }),
    /matching.*verified_failure|human.*fail.*remediation/i
  );
}));

test("verified-failure remediation deterministically creates findings and residual limitations", (t) => withTemp(t, ({ artifactRoot }) => {
  const fixture = makeVerifiedFailureRemediationRun(artifactRoot);
  const second = structuredClone(fixture.remediation.payload.items[0]);
  second.remediation_id = "REM-FAIL0002";
  second.priority = "P1";
  second.issue = "A second independently actionable consequence of the same verified failure.";
  second.residual_limitation = "A second residual limitation remains after this planned change.";
  fixture.remediation.payload.items.push(second);
  rewriteFixtureArtifact(fixture, fixture.remediation, fixture.remediationFile);
  const resources = pureMergeResources(fixture.run, artifactRoot);
  const forward = mergeArtifactRecords({
    run: fixture.run,
    assessment: assessmentFixture(),
    artifacts: fixture.artifacts,
    registries: resources
  });
  fixture.remediation.payload.items.reverse();
  rewriteFixtureArtifact(fixture, fixture.remediation, fixture.remediationFile);
  const reverse = mergeArtifactRecords({
    run: fixture.run,
    assessment: assessmentFixture(),
    artifacts: [...fixture.artifacts].reverse(),
    registries: pureMergeResources(fixture.run, artifactRoot)
  });
  assert.deepEqual(reverse, forward);
  assert.deepEqual(forward.assessment.findings, [
    {
      id: "REM-FAIL0001",
      priority: "P0",
      requirement_ids: ["WCAG-2.2-SC-1.1.1"],
      location: "target/index.html#main-image",
      affected_users: ["Screen reader users"],
      observation: "The human review verified that the text alternative does not communicate the image purpose.",
      remediation: "Provide a text alternative that communicates the same purpose as the image.",
      verification: "Repeat the registered human review with browser inspection and manual observation."
    },
    {
      id: "REM-FAIL0002",
      priority: "P1",
      requirement_ids: ["WCAG-2.2-SC-1.1.1"],
      location: "target/index.html#main-image",
      affected_users: ["Screen reader users"],
      observation: "A second independently actionable consequence of the same verified failure.",
      remediation: "Provide a text alternative that communicates the same purpose as the image.",
      verification: "Repeat the registered human review with browser inspection and manual observation."
    }
  ]);
  assert.equal(Object.hasOwn(forward.assessment.findings[0], "owner"), false);
  assert.ok(forward.assessment.limitations.includes("The reviewer identity remains declared but unauthenticated."));
  assert.ok(forward.assessment.limitations.includes("A second residual limitation remains after this planned change."));
}));

test("unverified screening candidates stay out of assessment findings and profile outcomes", (t) => withTemp(t, ({ artifactRoot }) => {
  const fixture = makeScreeningRemediationRun(artifactRoot);
  const merged = mergeArtifactRecords({
    run: fixture.run,
    assessment: assessmentFixture(),
    artifacts: fixture.artifacts,
    registries: pureMergeResources(fixture.run, artifactRoot)
  });
  assert.deepEqual(merged.assessment.findings, []);
  const screening = merged.assessment.results.find((item) => item.requirement_id === "SCREEN-FIRST");
  assert.equal(screening.mapping_status, "unverified");
  assert.equal(screening.outcome, "cant_tell");
  assert.ok(merged.assessment.limitations.includes("The candidate remains unverified until target-specific review is completed."));
}));

test("duplicate or conflicting remediation IDs are rejected before merge", (t) => withTemp(t, ({ temp, artifactRoot }) => {
  const fixture = makeVerifiedFailureRemediationRun(artifactRoot);
  const conflict = structuredClone(fixture.remediation.payload.items[0]);
  conflict.issue = "Conflicting content under the same remediation identifier.";
  fixture.remediation.payload.items.push(conflict);
  rewriteFixtureArtifact(fixture, fixture.remediation, fixture.remediationFile);
  const validation = validateAuditRun(fixture.run, { skillRoot, runFile: path.join(temp, "run.json") });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /duplicate.*REM-FAIL0001|conflict.*remediation/i);
  assert.throws(
    () => mergeArtifactRecords({
      run: fixture.run,
      assessment: assessmentFixture(),
      artifacts: fixture.artifacts,
      registries: pureMergeResources(fixture.run, artifactRoot)
    }),
    /duplicate.*REM-FAIL0001|conflict.*remediation/i
  );
}));

test("pure merge rejects an in-memory human failure that differs from the registered artifact bytes", (t) => withTemp(t, ({ artifactRoot }) => {
  const fixture = makeVerifiedFailureRemediationRun(artifactRoot, "pass");
  const suppliedArtifacts = structuredClone(fixture.artifacts);
  suppliedArtifacts.find((artifact) => artifact.artifact_type === "declared-human-review")
    .payload.reviews[0].profile_outcome = "fail";
  assert.throws(
    () => mergeArtifactRecords({
      run: fixture.run,
      assessment: assessmentFixture(),
      artifacts: suppliedArtifacts,
      registries: pureMergeResources(fixture.run, artifactRoot)
    }),
    /registered.*bytes|snapshot.*artifact|artifact.*does not match/i
  );
}));

test("pure merge recomputes each registered snapshot hash instead of trusting snapshot metadata", (t) => withTemp(t, ({ artifactRoot }) => {
  const screen = screeningEnvelope({ artifactId: "ART-SCREEN-001", requirementId: "SCREEN-FIRST" });
  const screenFile = path.join(artifactRoot, "screen.json");
  writeJson(screenFile, screen);
  const run = screenedRun(artifactRoot, screenFile, screen);
  const resources = pureMergeResources(run, artifactRoot);
  resources.artifact_snapshots_by_id.get(screen.artifact_id).sha256 = "0".repeat(64);
  assert.throws(
    () => mergeArtifactRecords({ run, assessment: assessmentFixture(), artifacts: [screen], registries: resources }),
    /snapshot hash mismatch/i
  );
}));

test("post-close output verification failure removes the newly created output", (t) => withTemp(t, ({ temp }) => {
  const output = path.join(temp, "post-close-failure.json");
  assert.throws(
    () => writeNewJson(output, { status: "should-not-remain" }, { afterClose: () => { throw new Error("simulated post-close verification failure"); } }),
    /post-close verification failure/i
  );
  assert.equal(fs.existsSync(output), false);
}));

test("partial write failure removes the O_EXCL-created file when its inode is unchanged", (t) => withTemp(t, ({ temp }) => {
  const output = path.join(temp, "partial-write-failure.json");
  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = (descriptor) => {
    fs.writeSync(descriptor, Buffer.from("{\"partial\":"));
    throw new Error("simulated partial write failure");
  };
  try {
    assert.throws(
      () => writeNewJson(output, { status: "should-not-remain" }),
      /partial write failure/i
    );
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
  assert.equal(fs.existsSync(output), false);
}));
