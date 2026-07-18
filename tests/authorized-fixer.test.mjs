import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadAuditResources, registerArtifact, sha256File, validateArtifact, validateAuditRun } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { lookupRequirement } from "../codex/skills/information-accessibility-practice/scripts/show-requirement.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "codex/skills/information-accessibility-practice");
const references = path.join(skillRoot, "references");
const validateFixAuthorizationScript = path.join(skillRoot, "scripts/validate-fix-authorization.mjs");
const fixAuthorizationLib = path.join(skillRoot, "scripts/lib/fix-authorization.mjs");
const fixVerificationLib = path.join(skillRoot, "scripts/lib/fix-verification.mjs");
const verifyAuthorizedFileScript = path.join(skillRoot, "scripts/verify-authorized-file.mjs");
const fixLeaseLib = path.join(skillRoot, "scripts/lib/fix-lease.mjs");
const acquireFixLeaseScript = path.join(skillRoot, "scripts/acquire-fix-lease.mjs");
const releaseFixLeaseScript = path.join(skillRoot, "scripts/release-fix-lease.mjs");
const fixTransactionLib = path.join(skillRoot, "scripts/lib/fix-transaction.mjs");
const applyAuthorizedFixScript = path.join(skillRoot, "scripts/apply-authorized-fix.mjs");
const agentManifest = path.join(root, "shared/agents/agent-manifest.json");
const authorizedFixerBody = path.join(root, "shared/agents/information-accessibility-authorized-fixer.md");
const resources = loadAuditResources(skillRoot);

const RUN_ID = "RUN-20260718T100000Z-TEST0001";

test("authorized fixer remains opt-in and declares every runtime trust boundary", () => {
  const manifest = JSON.parse(fs.readFileSync(agentManifest, "utf8"));
  const agent = manifest.agents.find((entry) => entry.id === "information-accessibility-authorized-fixer");
  assert.ok(agent);
  assert.equal(agent.install_by_default, false);
  assert.equal(agent.codex.sandbox_mode, "read-only");
  assert.deepEqual(agent.claude.tools, ["Read", "Grep", "Glob"]);

  const body = fs.readFileSync(authorizedFixerBody, "utf8");
  for (const pattern of [
    /exact(?:ly)? validated external authorization/i,
    /exclusive (?:operator control|control of the source tree)/i,
    /host[- ]protected consumption ledger/i,
    /not a kernel sandbox/i,
    /preserve unrelated changes/i,
    /do not (?:invoke|run|use).*(?:arbitrary|unapproved).*(?:shell|interpreter|command)/i,
    /apply-authorized-fix\.mjs/i,
    /do not (?:record|claim).*(?:pass|fail)/i,
    /human_verified/i,
    /\bE2\b/i,
    /conformance/i,
    /retest_required/i,
    /do not (?:create|issue|invent).*(?:authorization|approval)/i
  ]) {
    assert.match(body, pattern);
  }

  assert.doesNotMatch(body, /--expected-after-sha256/u);
  for (const flag of [
    "--authorization",
    "--run",
    "--source-root",
    "--operation",
    "--target",
    "--description",
    "--command-id",
    "--lock-dir",
    "--output"
  ]) {
    assert.match(body, new RegExp(flag, "u"), `prompt must include required ${flag}`);
  }
  assert.match(body, /after SHA-256.*authorization.*change binding/i);
  assert.match(body, /do not execute.*apply-authorized-fix\.mjs/i);
  assert.match(body, /trusted (?:operator|orchestrator)/i);
});

test("public guidance describes the current read-only handoff without development history", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const orchestration = fs.readFileSync(path.join(references, "agent-orchestration.md"), "utf8");
  assert.match(readme, /認可済み修正[^]*読み取り専用[^]*信頼された運用者/u);
  assert.match(orchestration, /authorized fixer[^]*(?:read-only|generic command or write access)[^]*trusted (?:operator|orchestrator)/i);
  assert.match(readme, /-IncludeAuthorizedFixer/i);
  assert.match(orchestration, /-IncludeAuthorizedFixer/i);
  assert.doesNotMatch(readme, /Task\s+8|after Task|not yet included|not included yet/i);
});

function runNode(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

function runNodeAsync(script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

function runOutput(result) {
  return `${result.stderr}\n${result.stdout}`;
}

function resourceVersions() {
  const orchestrationRegistryBytes = fs.readFileSync(path.join(references, "orchestration-registry.json"));
  return {
    standards_registry_version: resources.standardsRegistry.schema_version,
    orchestration_registry_version: resources.orchestrationRegistry.schema_version,
    orchestration_registry_sha256: crypto.createHash("sha256").update(orchestrationRegistryBytes).digest("hex"),
    criteria_catalog_sha256: sha256File(path.join(references, "criteria-catalog.json")),
    criterion_procedures_sha256: sha256File(path.join(references, "criterion-procedures.json")),
    audit_methods_sha256: sha256File(path.join(references, "web-audit-methods.json"))
  };
}

function withTemp(t, callback) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-authorized-fixer-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const sourceRoot = path.join(temp, "target");
  const artifactRoot = path.join(temp, "artifacts");
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(artifactRoot);
  return callback({ temp, sourceRoot, artifactRoot });
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertRejected(result, pattern) {
  assert.notEqual(result.status, 0, runOutput(result));
  assert.match(runOutput(result), pattern);
}

function initialRun(artifactRoot) {
  return {
    schema_version: "5.0.0",
    run_id: RUN_ID,
    supersedes_run_id: null,
    status: "initialized",
    target: {
      name: "Local fixture",
      version_or_commit: "fixture-v1",
      urls_or_files: ["target/index.html"]
    },
    profile: { id: "web-modern", registry_version: "1.0.0" },
    scope: {
      included: ["target/index.html"],
      excluded: [],
      complete_processes: [],
      third_party_content: [],
      full_pages_reviewed: false
    },
    environment: {
      os: ["not_declared"],
      browsers: [],
      assistive_technologies: [],
      input_modes: []
    },
    permissions: {
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
    },
    resource_versions: resourceVersions(),
    artifact_root: path.basename(artifactRoot),
    artifacts: [],
    history: [],
    limitations: ["The environment was not declared; no profile outcome has been recorded."]
  };
}

function screeningPayload() {
  return {
    schema_version: "1.0.0",
    observations: [{
      requirement_id: "SCREEN-FIRST",
      evidence_level: "E1",
      method: "DOM inspection",
      location: "main heading",
      observation: "Unverified observation for SCREEN-FIRST",
      captured_at: "2026-07-18T10:00:01Z"
    }]
  };
}

function queuePayloadFor(requirementId = "WCAG-2.2-SC-1.1.1") {
  const binding = lookupRequirement("web-modern", requirementId, skillRoot).procedure_binding;
  return {
    schema_version: "2.0.0",
    items: [{
      requirement_id: requirementId,
      procedure_ref: binding.procedure_ref,
      procedure_availability: binding.procedure_availability,
      generic_method_ref: binding.generic_method_ref,
      official_sources: binding.official_sources,
      human_actions: binding.human_actions,
      required_evidence_types: binding.required_evidence_types,
      cant_tell_conditions: binding.cant_tell_conditions
    }],
    procedure_coverage: {
      total_requirements: 1,
      available_procedures: binding.procedure_availability === "available" ? 1 : 0,
      unavailable_procedures: binding.procedure_availability === "unavailable" ? 1 : 0
    }
  };
}

function remediationPayload() {
  return {
    schema_version: "2.0.0",
    items: [{
      remediation_id: "REM-TEST0001",
      basis: "verified_failure",
      requirement_id: "WCAG-2.2-SC-1.1.1",
      source_artifact_ids: ["ART-DECLARED-HUMAN-001"],
      priority: "P1",
      location: "target/index.html#main",
      affected_users: ["Screen reader users"],
      issue: "Candidate needs deterministic change.",
      proposed_change: "Provide a minimal fix with unchanged semantics.",
      verification: "Retest this check after applying the authorized change.",
      residual_limitation: "Identity remains declared but unauthenticated."
    }]
  };
}

function declaredHumanReviewPayload(requirementId = "WCAG-2.2-SC-1.1.1") {
  const binding = lookupRequirement("web-modern", requirementId, skillRoot).procedure_binding;
  return {
    schema_version: "1.0.0",
    declaration: "I declare that I performed the review in accordance with the specified requirement.",
    reviewer_name: "Authorized reviewer",
    review_date: "2026-07-18",
    identity_authenticated: false,
    reviews: [{
      requirement_id: requirementId,
      procedure_availability: binding.procedure_availability,
      criterion_procedure_ref: binding.procedure_availability === "available" ? binding.procedure_ref : null,
      generic_method_ref: binding.procedure_availability === "available" ? binding.generic_method_ref : "web-audit-methods:1.0.0#manual-verification",
      official_sources: binding.official_sources,
      target_specific_evidence: [{
        type: "manual_observation",
        location: "target/index.html#main",
        observation: "Manual verification indicates the criterion requires adjustment.",
        captured_at: "2026-07-18T10:00:04Z"
      }, {
        type: "browser_inspection",
        location: "target/index.html#main",
        observation: "Browser inspection confirms the criterion issue.",
        captured_at: "2026-07-18T10:00:04Z"
      }],
      profile_outcome: "fail",
      rationale: "Visual/manual inspection observed missing or incorrect accessibility support."
    }]
  };
}

function artifactEnvelope({ artifactId, artifactType, roleId, producerKind, inputs = [], payload, createdAt }) {
  return {
    schema_version: "2.0.0",
    artifact_id: artifactId,
    artifact_type: artifactType,
    run_id: RUN_ID,
    producer: { role_id: roleId, producer_kind: producerKind, origin: "test fixture" },
    created_at: createdAt,
    inputs,
    payload
  };
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

function makeRemediationReadyFixture({ sourceRoot, artifactRoot }) {
  const targetFile = path.join(sourceRoot, "index.html");
  fs.writeFileSync(targetFile, "<h1>fixture</h1>\n", "utf8");

  const screeningFile = path.join(artifactRoot, "screening.json");
  const queueFile = path.join(artifactRoot, "queue.json");
  const remediationFile = path.join(artifactRoot, "remediation.json");

  const screening = artifactEnvelope({
    artifactId: "ART-SCREEN-001",
    artifactType: "screening-observations",
    roleId: "e1_inspector",
    producerKind: "ai_agent",
    createdAt: "2026-07-18T10:00:01Z",
    payload: screeningPayload()
  });
  writeJson(screeningFile, screening);
  const screeningSha256 = sha256File(screeningFile);

  const queue = artifactEnvelope({
    artifactId: "ART-QUEUE-001",
    artifactType: "human-review-queue",
    roleId: "human_queue_planner",
    producerKind: "ai_agent",
    createdAt: "2026-07-18T10:00:02Z",
    inputs: [{ artifact_id: "ART-SCREEN-001", run_id: RUN_ID, sha256: screeningSha256 }],
    payload: queuePayloadFor()
  });
  writeJson(queueFile, queue);
  const queueSha256 = sha256File(queueFile);

  const declaredHumanReview = artifactEnvelope({
    artifactId: "ART-DECLARED-HUMAN-001",
    artifactType: "declared-human-review",
    roleId: "declared_external_human",
    producerKind: "external_human",
    createdAt: "2026-07-18T10:00:03Z",
    inputs: [{ artifact_id: "ART-QUEUE-001", run_id: RUN_ID, sha256: queueSha256 }],
    payload: declaredHumanReviewPayload()
  });
  const declaredHumanReviewFile = path.join(artifactRoot, "declared-human-review.json");
  writeJson(declaredHumanReviewFile, declaredHumanReview);
  const declaredHumanReviewSha256 = sha256File(declaredHumanReviewFile);

  const remediation = artifactEnvelope({
    artifactId: "ART-REMEDIATION-001",
    artifactType: "remediation-plan",
    roleId: "remediation_planner",
    producerKind: "ai_agent",
    createdAt: "2026-07-18T10:00:04Z",
    inputs: [
      { artifact_id: "ART-DECLARED-HUMAN-001", run_id: RUN_ID, sha256: declaredHumanReviewSha256 }
    ],
    payload: remediationPayload()
  });
  writeJson(remediationFile, remediation);

  const run = initialRun(artifactRoot);
  run.status = "remediation_ready";
  run.artifacts = [
    registerEntry(artifactRoot, screeningFile, screening),
    registerEntry(artifactRoot, queueFile, queue),
    registerEntry(artifactRoot, declaredHumanReviewFile, declaredHumanReview),
    registerEntry(artifactRoot, remediationFile, remediation)
  ].sort((left, right) => left.artifact_id.localeCompare(right.artifact_id));
  run.history = [
    { from: "initialized", to: "screened", at: screening.created_at, actor_role: "e1_inspector", artifact_ids: ["ART-SCREEN-001"] },
    { from: "screened", to: "human_queue_ready", at: queue.created_at, actor_role: "human_queue_planner", artifact_ids: ["ART-QUEUE-001"] },
    { from: "human_queue_ready", to: "human_review_recorded", at: declaredHumanReview.created_at, actor_role: "declared_external_human", artifact_ids: ["ART-DECLARED-HUMAN-001"] },
    { from: "human_review_recorded", to: "remediation_ready", at: remediation.created_at, actor_role: "remediation_planner", artifact_ids: ["ART-REMEDIATION-001"] }
  ];

  return {
    run,
    runFile: path.join(path.dirname(sourceRoot), "run.json"),
    sourceRoot,
    targetFile,
    remediationFile
  };
}

function defaultChangeBindings(allowedPaths, allowedOperations) {
  return allowedPaths.flatMap((targetPath) => allowedOperations.map((operation) => ({
    path: targetPath,
    operation,
    expected_before_sha256: operation === "create" ? null : "a".repeat(64),
    expected_after_sha256: operation === "delete" ? null : "b".repeat(64)
  })));
}

function makeAuthPayload({
  allowedOperations = ["modify"],
  allowedPaths = ["index.html"],
  changeBindings = defaultChangeBindings(allowedPaths, allowedOperations),
  runId = RUN_ID,
  sourceRootPath,
  remediationArtifact
}) {
  return {
    schema_version: "2.0.0",
    authorization_id: "AUTH-20260718-TEST0001",
    run_id: runId,
    authorizer_role: "declared_authorizer",
    authorizer_kind: "external_requester",
    approved_by: "Authorized Requester",
    identity_authenticated: false,
    declaration: "I authorize only deterministic scoped change operations.",
    approved_at: "2026-07-18T10:00:10Z",
    source_root: sourceRootPath,
    allowed_paths: allowedPaths,
    allowed_operations: allowedOperations,
    change_bindings: changeBindings,
    verification_commands: [{ command_id: "VERIFY-001", executable: "node", args: ["-e", "process.exit(0)"], cwd: "." }],
    remediation_artifact: remediationArtifact
  };
}

function makeAuthEnvelope(payload, artifactId = "ART-AUTH-001", origin = "external_input") {
  return {
    schema_version: "2.0.0",
    artifact_id: artifactId,
    artifact_type: "fix-authorization",
    run_id: payload.run_id,
    producer: { role_id: "declared_authorizer", producer_kind: "external_requester", origin },
    created_at: "2026-07-18T10:00:05Z",
    inputs: [{ artifact_id: "ART-REMEDIATION-001", run_id: payload.run_id, sha256: payload.remediation_artifact.sha256 }],
    payload
  };
}

function makeTargetAuthResult({
  artifactRoot,
  sourceRoot,
  targetPath,
  operation,
  allowedPaths,
  allowedOperations,
  runFile,
  remediationSha256,
  runId = RUN_ID,
  sourceRootPath = sourceRoot
}) {
  const payload = makeAuthPayload({
    sourceRootPath,
    runId,
    allowedOperations,
    allowedPaths,
    remediationArtifact: { artifact_id: "ART-REMEDIATION-001", sha256: remediationSha256 }
  });
  const auth = makeAuthEnvelope(payload, `ART-AUTH-${operation.toUpperCase()}-${Date.now()}`);
  const authFile = path.join(artifactRoot, `auth-${operation}-${Date.now()}.json`);
  writeJson(authFile, auth);
  return runNode(validateFixAuthorizationScript, [
    "--authorization", authFile,
    "--target", targetPath,
    "--run", runFile,
    "--source-root", sourceRoot,
    "--operation", operation
  ]);
}


test("validate-fix-authorization CLI accepts create and modify operations and warns unauthenticated identity", (t) => withTemp(t, ({ sourceRoot, artifactRoot }) => {
  const fixture = makeRemediationReadyFixture({ sourceRoot, artifactRoot });
  writeJson(fixture.runFile, fixture.run);

  const remediationSha256 = sha256File(fixture.remediationFile);
  const createPayload = makeAuthPayload({
    sourceRootPath: sourceRoot,
    allowedOperations: ["create", "modify"],
    allowedPaths: ["draft/new.html"],
    remediationArtifact: { artifact_id: "ART-REMEDIATION-001", sha256: remediationSha256 }
  });
  const createAuth = makeAuthEnvelope(createPayload, "ART-AUTH-CREATE");
  const createAuthFile = path.join(artifactRoot, "authorization-create.json");
  writeJson(createAuthFile, createAuth);

  fs.mkdirSync(path.join(sourceRoot, "draft"), { recursive: true });
  const createTarget = path.join(sourceRoot, "draft/new.html");
  const createResult = runNode(validateFixAuthorizationScript, [
    "--authorization", createAuthFile,
    "--target", createTarget,
    "--run", fixture.runFile,
    "--source-root", sourceRoot,
    "--operation", "create"
  ]);
  assert.equal(createResult.status, 0, runOutput(createResult));
  assert.match(runOutput(createResult), /Authorization validation succeeded|Identity is not authenticated/);

  const modifyPayload = makeAuthPayload({
    sourceRootPath: sourceRoot,
    allowedOperations: ["modify", "delete"],
    allowedPaths: ["index.html"],
    remediationArtifact: { artifact_id: "ART-REMEDIATION-001", sha256: remediationSha256 }
  });
  const modifyAuth = makeAuthEnvelope(modifyPayload, "ART-AUTH-MODIFY");
  const modifyAuthFile = path.join(artifactRoot, "authorization-modify.json");
  writeJson(modifyAuthFile, modifyAuth);

  const modifyResult = runNode(validateFixAuthorizationScript, [
    "--authorization", modifyAuthFile,
    "--target", fixture.targetFile,
    "--run", fixture.runFile,
    "--source-root", sourceRoot,
    "--operation", "modify"
  ]);
  assert.equal(modifyResult.status, 0, runOutput(modifyResult));
  assert.match(runOutput(modifyResult), /Identity is not authenticated/i);
}));

test("authorized-fixer validator module exports the current API", async () => {
  const module = await import(pathToFileURL(fixAuthorizationLib).href);
  assert.equal(typeof module.validateFixAuthorization, "function");
});

test("validate-fix-authorization CLI rejects bad producer metadata", (t) => withTemp(t, ({ sourceRoot, artifactRoot }) => {
  const fixture = makeRemediationReadyFixture({ sourceRoot, artifactRoot });
  writeJson(fixture.runFile, fixture.run);
  const remediationSha256 = sha256File(fixture.remediationFile);
  const payload = makeAuthPayload({
    sourceRootPath: sourceRoot,
    remediationArtifact: { artifact_id: "ART-REMEDIATION-001", sha256: remediationSha256 }
  });

  const roles = [
    ["role", (auth) => { auth.producer.role_id = "authorized_fixer"; }, /declared_authorizer|producer\.role_id/],
    ["kind", (auth) => { auth.producer.producer_kind = "ai_agent"; }, /producer kind|AI role|producer\.producer_kind/],
    ["origin", (auth) => { auth.producer.origin = "internal_input"; }, /producer\.origin|external_input/]
  ];

  for (const [suffix, mutate, pattern] of roles) {
    const auth = makeAuthEnvelope(payload, `ART-AUTH-${suffix}`);
    mutate(auth);
    const file = path.join(artifactRoot, `${suffix}.json`);
    writeJson(file, auth);
    assertRejected(
      runNode(validateFixAuthorizationScript, [
        "--authorization", file,
        "--target", fixture.targetFile,
        "--run", fixture.runFile,
        "--source-root", sourceRoot,
        "--operation", "modify"
      ]),
      pattern
    );
  }
}));

test("validate-fix-authorization CLI rejects missing operation permissions and malformed run references", (t) => withTemp(t, ({ sourceRoot, artifactRoot }) => {
  const fixture = makeRemediationReadyFixture({ sourceRoot, artifactRoot });
  const remediationSha256 = sha256File(fixture.remediationFile);

  const deniedCanonicalPermissions = {
    network: "allowlisted",
    interaction: "read_only",
    source_write: "denied",
    command_execution: "denied",
    allowed_actions: ["inspect_without_mutation", "read_allowlisted_resources"],
    forbidden_actions: ["execute_commands", "network_outside_allowlist", "write_target"]
  };

  const payload = makeAuthPayload({
    sourceRootPath: sourceRoot,
    remediationArtifact: { artifact_id: "ART-REMEDIATION-001", sha256: remediationSha256 }
  });
  const auth = makeAuthEnvelope(payload, "ART-AUTH-INVALID");
  const authFile = path.join(artifactRoot, "authorization-invalid.json");
  writeJson(authFile, auth);

  const permissionCases = [
    [(run) => { run.permissions = { ...deniedCanonicalPermissions }; }, /run\.permissions\.(source_write|command_execution) must be/],
    [(run) => { run.permissions.command_execution = "denied"; }, /command_execution must be authorized_verification_only|permissions must exactly match/],
    [(run) => { run.permissions.allowed_actions = ["execute_authorized_verification_commands", "inspect_without_mutation", "read_allowlisted_resources"]; }, /permissions must exactly match|allowed_actions/],
    [(run) => { run.permissions.allowed_actions = ["write_authorized_files", "inspect_without_mutation", "read_allowlisted_resources"]; }, /permissions must exactly match|allowed_actions/]
  ];

  for (const [patch, pattern] of permissionCases) {
    const run = structuredClone(fixture.run);
    patch(run);
    writeJson(fixture.runFile, run);
    assertRejected(
      runNode(validateFixAuthorizationScript, [
        "--authorization", authFile,
        "--target", fixture.targetFile,
        "--run", fixture.runFile,
        "--source-root", sourceRoot,
        "--operation", "modify"
      ]),
      pattern
    );
  }

  const legacyRun = structuredClone(fixture.run);
  legacyRun.schema_version = "3.0.0";
  writeJson(fixture.runFile, legacyRun);
  assertRejected(
    runNode(validateFixAuthorizationScript, [
      "--authorization", authFile,
      "--target", fixture.targetFile,
      "--run", fixture.runFile,
      "--source-root", sourceRoot,
      "--operation", "modify"
    ]),
    /run\.schema_version must be exactly 5\.0\.0|audit run invalid: audit-run 3\.0\.0 requires orchestration registry 2\.0\.0/
  );

  const badHistoryRun = structuredClone(fixture.run);
  badHistoryRun.history = [badHistoryRun.history[0]];
  writeJson(fixture.runFile, badHistoryRun);
  assertRejected(
    runNode(validateFixAuthorizationScript, [
      "--authorization", authFile,
      "--target", fixture.targetFile,
      "--run", fixture.runFile,
      "--source-root", sourceRoot,
      "--operation", "modify"
    ]),
    /history|remediation_ready|history record|invalid/i
  );

  const runIdMismatch = makeAuthPayload({
    runId: "RUN-20260718T000000Z-MISMATCH",
    sourceRootPath: sourceRoot,
    remediationArtifact: { artifact_id: "ART-REMEDIATION-001", sha256: remediationSha256 }
  });
  const runIdAuth = makeAuthEnvelope(runIdMismatch, "ART-AUTH-RUN-MISMATCH");
  const runIdFile = path.join(artifactRoot, "authorization-runid.json");
  writeJson(fixture.runFile, fixture.run);
  writeJson(runIdFile, runIdAuth);
  assertRejected(
    runNode(validateFixAuthorizationScript, [
      "--authorization", runIdFile,
      "--target", fixture.targetFile,
      "--run", fixture.runFile,
      "--source-root", sourceRoot,
      "--operation", "modify"
    ]),
    /run_id mismatch/
  );
}));

test("validate-fix-authorization CLI rejects malformed remediation bindings and legacy authorization", (t) => withTemp(t, ({ sourceRoot, artifactRoot }) => {
  const fixture = makeRemediationReadyFixture({ sourceRoot, artifactRoot });
  writeJson(fixture.runFile, fixture.run);
  const remediationSha256 = sha256File(fixture.remediationFile);
  const screeningArtifact = fixture.run.artifacts.find((artifact) => artifact.artifact_id === "ART-SCREEN-001");
  const screeningSha256 = screeningArtifact?.sha256 ?? "";

  const makeAuth = (remediationArtifact, schema = "2.0.0") => {
    const payload = makeAuthPayload({
      sourceRootPath: sourceRoot,
      schemaVersion: schema,
      remediationArtifact
    });
    if (schema === "1.0.0") payload.schema_version = schema;
    return makeAuthEnvelope(payload, `ART-AUTH-MALFORMED-${remediationArtifact.artifact_id}`);
  };

  const malformed = [
    ["badType", { artifact_id: "ART-SCREEN-001", sha256: screeningSha256 }, /must reference a remediation-plan artifact|remediation-plan/i],
    ["badId", { artifact_id: "ART-MISSING-001", sha256: remediationSha256 }, /match a registered run artifact/],
    ["badHash", { artifact_id: "ART-REMEDIATION-001", sha256: "0".repeat(64) }, /match a registered run artifact/]
  ];

  for (const [suffix, rem, pattern] of malformed) {
    const auth = makeAuth(rem);
    const file = path.join(artifactRoot, `${suffix}.json`);
    writeJson(file, auth);
    assertRejected(
      runNode(validateFixAuthorizationScript, [
        "--authorization", file,
        "--target", fixture.targetFile,
        "--run", fixture.runFile,
        "--source-root", sourceRoot,
        "--operation", "modify"
      ]),
      pattern
    );
  }

  const legacy = makeAuth({ artifact_id: "ART-REMEDIATION-001", sha256: remediationSha256 }, "1.0.0");
  const legacyFile = path.join(artifactRoot, "legacy-auth.json");
  writeJson(legacyFile, legacy);
  assertRejected(
    runNode(validateFixAuthorizationScript, [
      "--authorization", legacyFile,
      "--target", fixture.targetFile,
      "--run", fixture.runFile,
      "--source-root", sourceRoot,
      "--operation", "modify"
    ]),
    /authorization\.payload\.schema_version must be exactly 2\.0\.0/
  );
}));

test("validate-fix-authorization CLI rejects invalid target paths", (t) => withTemp(t, ({ sourceRoot, artifactRoot }) => {
  const fixture = makeRemediationReadyFixture({ sourceRoot, artifactRoot });
  writeJson(fixture.runFile, fixture.run);
  const remediationSha256 = sha256File(fixture.remediationFile);

  fs.mkdirSync(path.join(sourceRoot, "nested"), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "ok.txt"), "<h1>ok</h1>\n", "utf8");
  fs.mkdirSync(path.join(sourceRoot, "existing-dir"), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "existing-regular.txt"), "<h1>regular</h1>\n", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "hardlink-a.txt"), "<h1>hard</h1>\n", "utf8");
  fs.linkSync(path.join(sourceRoot, "hardlink-a.txt"), path.join(sourceRoot, "hardlink-b.txt"));

  const rejectCases = [
    [".. traversal", path.join(".."), "target file path must not contain relative traversal segments", "modify"],
    ["posix absolute", "/forbidden/index.html", "target is outside the supplied source root", "modify"],
    ["windows absolute", "C:\\forbidden\\index.html", "target is outside the supplied source root", "modify"],
    ["windows drive-relative", "C:forbidden\\index.html", "must not contain ':'", "modify"],
    ["unc path", `\\\\server\\share\\index.html`, "target is outside the supplied source root", "modify"],
    ["windows namespace question", `\\\\?\\C:\\Windows\\system32`, "target is outside the supplied source root", "modify"],
    ["windows namespace dot", `\\\\.\\C:\\Windows\\system32`, "target is outside the supplied source root", "modify"],
    ["ads stream", path.join("index.html:stream"), "must not contain ':'", "modify"],
    ["reserved device", "CON.txt", "reserved device-style segment", "create"],
    ["reserved device com", "COM1.txt", "reserved device-style segment", "create"],
    ["reserved device lpt", "LPT9.txt", "reserved device-style segment", "create"],
    ["trailing dot", "trailing.", "invalid segment ending", "create"],
    ["trailing space", "trailing ", "invalid segment ending", "create"],
    ["control chars", `bad${String.fromCharCode(31)}file.txt`, "forbidden shell/control characters", "create"],
    ["wildcard", "wild*card.txt", "forbidden shell/control characters", "create"],
    ["wildcard2", "wild?card.txt", "forbidden shell/control characters", "create"],
    ["empty segment", `nested${path.sep}${path.sep}deep.txt`, "empty path segments", "create"],
    ["dot segment", "nested/./deep.txt", "relative traversal segments", "create"],
    ["missing intermediate", path.join("missing", "leaf.txt"), "missing intermediate directory", "create"],
    ["target root", sourceRoot, "must not be source root", "modify"],
    ["non-regular directory", path.join("existing-dir", "index.html"), "existing regular file", "modify"],
    ["hardlink target", "hardlink-b.txt", "single-link file", "modify"]
  ];

  for (const [name, target, expected, operation] of rejectCases) {
    let targetPath = target;
    if (name === "target root") targetPath = sourceRoot;
    const result = makeTargetAuthResult({
      artifactRoot,
      sourceRoot,
      targetPath,
      operation,
      allowedPaths: ["ok.txt", "nested/ok.txt", "missing/leaf.txt", "hardlink-b.txt", "trailing.", "trailing ", "bad0file.txt", "wild*card.txt", "wild?card.txt", "CON.txt", "COM1.txt", "LPT9.txt", "index.html"],
      allowedOperations: ["modify", "delete", "create"],
      runFile: fixture.runFile,
      remediationSha256
    });
    assertRejected(result, new RegExp(expected, "i"));
  }

  const junctionTarget = path.join(path.dirname(sourceRoot), "outside-root");
  const junctionLink = path.join(sourceRoot, "outside-junction");
  fs.mkdirSync(junctionTarget, { recursive: true });
  fs.writeFileSync(path.join(junctionTarget, "escape.txt"), "outside\n", "utf8");
  try {
    fs.symlinkSync(junctionTarget, junctionLink, "junction");
    const result = makeTargetAuthResult({
      artifactRoot,
      sourceRoot,
      targetPath: path.join("outside-junction", "escape.txt"),
      operation: "modify",
      allowedPaths: [path.join("outside-junction", "escape.txt")],
      allowedOperations: ["modify"],
      runFile: fixture.runFile,
      remediationSha256
    });
    assertRejected(result, /outside the supplied source root|symbolic link|junction|reparse/i);
  } finally {
    fs.rmSync(junctionLink, { recursive: true, force: true, maxRetries: 2 });
  }
}));

test("validate-fix-authorization CLI rejects a symlink target", (t) => withTemp(t, ({ sourceRoot, artifactRoot }) => {
  const fixture = makeRemediationReadyFixture({ sourceRoot, artifactRoot });
  writeJson(fixture.runFile, fixture.run);
  const sourceFile = path.join(sourceRoot, "symlink-source.txt");
  const symlinkFile = path.join(sourceRoot, "symlink-target.txt");
  fs.writeFileSync(sourceFile, "source\n", "utf8");
  try {
    fs.symlinkSync(sourceFile, symlinkFile, "file");
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("symlink creation is not permitted in this environment");
      return;
    }
    throw error;
  }
  const result = makeTargetAuthResult({
    artifactRoot,
    sourceRoot,
    targetPath: "symlink-target.txt",
    operation: "modify",
    allowedPaths: ["symlink-target.txt"],
    allowedOperations: ["modify"],
    runFile: fixture.runFile,
    remediationSha256: sha256File(fixture.remediationFile)
  });
  assertRejected(result, /symbolic link|junction|reparse/i);
}));

test("validate-fix-authorization CLI accepts safe create/modify/delete targets", (t) => withTemp(t, ({ sourceRoot, artifactRoot }) => {
  const fixture = makeRemediationReadyFixture({ sourceRoot, artifactRoot });
  writeJson(fixture.runFile, fixture.run);
  const remediationSha256 = sha256File(fixture.remediationFile);

  const createTarget = path.join(sourceRoot, "created.txt");
  const createResult = makeTargetAuthResult({
    artifactRoot,
    sourceRoot,
    targetPath: createTarget,
    operation: "create",
    allowedPaths: ["created.txt"],
    allowedOperations: ["create"],
    runFile: fixture.runFile,
    remediationSha256
  });
  assert.equal(createResult.status, 0, runOutput(createResult));

  const modifyTarget = path.join(sourceRoot, "ok.txt");
  fs.writeFileSync(modifyTarget, "<h1>modify</h1>\n", "utf8");
  const modifyResult = makeTargetAuthResult({
    artifactRoot,
    sourceRoot,
    targetPath: modifyTarget,
    operation: "modify",
    allowedPaths: ["ok.txt"],
    allowedOperations: ["modify"],
    runFile: fixture.runFile,
    remediationSha256
  });
  assert.equal(modifyResult.status, 0, runOutput(modifyResult));

  const deleteTarget = path.join(sourceRoot, "delete.txt");
  fs.writeFileSync(deleteTarget, "<h1>delete</h1>\n", "utf8");
  const deleteResult = makeTargetAuthResult({
    artifactRoot,
    sourceRoot,
    targetPath: deleteTarget,
    operation: "delete",
    allowedPaths: ["delete.txt"],
    allowedOperations: ["delete"],
    runFile: fixture.runFile,
    remediationSha256
  });
  assert.equal(deleteResult.status, 0, runOutput(deleteResult));
}));

test("validate-fix-authorization CLI enforces allowed operations for requested create/modify/delete", (t) => withTemp(t, ({ sourceRoot, artifactRoot }) => {
  const fixture = makeRemediationReadyFixture({ sourceRoot, artifactRoot });
  writeJson(fixture.runFile, fixture.run);
  const remediationSha256 = sha256File(fixture.remediationFile);

  const cases = [
    ["create", "draft/new.html", ["modify", "delete"], /requested operation create/],
    ["modify", "index.html", ["create"], /requested operation modify/],
    ["delete", "index.html", ["create", "modify"], /requested operation delete/]
  ];

  for (const [operation, target, allowedOps, pattern] of cases) {
    if (operation === "create") fs.mkdirSync(path.join(sourceRoot, "draft"), { recursive: true });
    const payload = makeAuthPayload({
      sourceRootPath: sourceRoot,
      allowedPaths: [target],
      allowedOperations: allowedOps,
      remediationArtifact: { artifact_id: "ART-REMEDIATION-001", sha256: remediationSha256 }
    });
    const auth = makeAuthEnvelope(payload, `ART-AUTH-${operation}`);
    const file = path.join(artifactRoot, `${operation}.json`);
    writeJson(file, auth);
    const targetFile = path.join(sourceRoot, target);
    if (operation !== "create") fs.writeFileSync(targetFile, "<h1>existing</h1>", "utf8");

    const result = runNode(validateFixAuthorizationScript, [
      "--authorization", file,
      "--target", targetFile,
      "--run", fixture.runFile,
      "--source-root", sourceRoot,
      "--operation", operation
    ]);
    assertRejected(result, pattern);
  }
}));

test("validate-fix-authorization CLI rejects raw payload object", (t) => withTemp(t, ({ sourceRoot, artifactRoot }) => {
  const fixture = makeRemediationReadyFixture({ sourceRoot, artifactRoot });
  writeJson(fixture.runFile, fixture.run);
  const payload = makeAuthPayload({
    sourceRootPath: sourceRoot,
    remediationArtifact: { artifact_id: "ART-REMEDIATION-001", sha256: sha256File(fixture.remediationFile) }
  });
  const raw = path.join(artifactRoot, "raw-payload.json");
  writeJson(raw, payload);
  assertRejected(
    runNode(validateFixAuthorizationScript, [
      "--authorization", raw,
      "--target", fixture.targetFile,
      "--run", fixture.runFile,
      "--source-root", sourceRoot,
      "--operation", "modify"
    ]),
    /fix-authorization|artifact_type/i
  );
}));

test("validate-fix-authorization CLI requires invocation arguments", () => {
  assertRejected(runNode(validateFixAuthorizationScript, []), /authorization|run|target|source-root|operation|usage/i);
});

function makeBrokerAuthorization(sourceRoot, commands, allowedPaths) {
  const payload = makeAuthPayload({
    sourceRootPath: sourceRoot,
    allowedPaths,
    remediationArtifact: { artifact_id: "ART-REMEDIATION-001", sha256: "a".repeat(64) }
  });
  payload.verification_commands = commands;
  return makeAuthEnvelope(payload, "ART-AUTH-BROKER");
}

test("verification broker executes only authorization-sourced package verifier commands", async (t) => withTemp(t, async ({ sourceRoot }) => {
  const textFile = path.join(sourceRoot, "index.html");
  const jsonFile = path.join(sourceRoot, "data.json");
  fs.writeFileSync(textFile, "<main>safe</main>\n", "utf8");
  fs.writeFileSync(jsonFile, '{"ok":true}\n', "utf8");
  const before = [sha256File(textFile), sha256File(jsonFile)];
  const commands = [
    { command_id: "VERIFY-TEXT", executable: "a11y-file-verify", args: ["--mode", "utf8", "--path", "index.html"], cwd: "." },
    { command_id: "VERIFY-JSON", executable: "a11y-file-verify", args: ["--mode", "json", "--path", "data.json"], cwd: "." }
  ];
  const authorization = makeBrokerAuthorization(sourceRoot, commands, ["index.html", "data.json"]);
  const { executeAuthorizedVerificationCommands } = await import(pathToFileURL(fixVerificationLib));
  const results = executeAuthorizedVerificationCommands({
    authorization,
    commandIds: ["VERIFY-TEXT", "VERIFY-JSON"],
    sourceRoot
  });
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((item) => item.status), ["exited", "exited"]);
  assert.deepEqual(results.map((item) => item.exit_code), [0, 0]);
  assert.deepEqual(results.map((item) => item.executable), ["a11y-file-verify", "a11y-file-verify"]);
  assert.deepEqual(results.map((item) => item.args), commands.map((item) => item.args));
  assert.deepEqual([sha256File(textFile), sha256File(jsonFile)], before);
}));

test("verification broker fixes the executable and shell-free spawn options", async (t) => withTemp(t, async ({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "index.html"), "safe\n", "utf8");
  const command = { command_id: "VERIFY-EXISTS", executable: "a11y-file-verify", args: ["--mode", "exists", "--path", "index.html"], cwd: "." };
  const authorization = makeBrokerAuthorization(sourceRoot, [command], ["index.html"]);
  const calls = [];
  const spawnSyncImpl = (...args) => {
    calls.push(args);
    return { status: 0, signal: null, stdout: Buffer.from("ok"), stderr: Buffer.alloc(0) };
  };
  const { executeAuthorizedVerificationCommands } = await import(pathToFileURL(fixVerificationLib));
  const [result] = executeAuthorizedVerificationCommands({
    authorization,
    commandIds: ["VERIFY-EXISTS"],
    sourceRoot,
    spawnSyncImpl,
    executable: "cmd.exe",
    args: ["/c", "whoami"],
    cwd: "C:\\"
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], process.execPath);
  assert.match(calls[0][1][0], /verify-authorized-file\.mjs$/);
  assert.equal(calls[0][2].shell, false);
  assert.equal(calls[0][2].windowsHide, true);
  assert.equal(calls[0][2].cwd, fs.realpathSync.native(sourceRoot));
  assert.ok(calls[0][2].maxBuffer <= 1024 * 1024);
  assert.equal(Object.hasOwn(calls[0][2].env, "NODE_OPTIONS"), false);
  assert.equal(Object.hasOwn(calls[0][2].env, "NODE_PATH"), false);
  assert.deepEqual(result.args, command.args);
  assert.equal(result.cwd, ".");
}));

test("verification broker rejects unapproved executables, arguments, paths, cwd, and command ids before spawn", async (t) => withTemp(t, async ({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "index.html"), "safe\n", "utf8");
  const { executeAuthorizedVerificationCommands } = await import(pathToFileURL(fixVerificationLib));
  let spawnCount = 0;
  const spawnSyncImpl = () => {
    spawnCount += 1;
    return { status: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };
  const cases = [
    [{ command_id: "VERIFY-BAD", executable: "cmd.exe", args: ["/c", "whoami"], cwd: "." }, /a11y-file-verify|executable/i],
    [{ command_id: "VERIFY-BAD", executable: "node", args: ["-e", "process.exit(0)"], cwd: "." }, /a11y-file-verify|executable/i],
    [{ command_id: "VERIFY-BAD", executable: "npm", args: ["test"], cwd: "." }, /a11y-file-verify|executable/i],
    [{ command_id: "VERIFY-BAD", executable: "a11y-file-verify", args: ["--mode", "utf8", "--path", "../outside.txt"], cwd: "." }, /path|traversal|allowed/i],
    [{ command_id: "VERIFY-BAD", executable: "a11y-file-verify", args: ["--mode", "utf8", "--path", "index.html", "-e"], cwd: "." }, /arguments|args|exact/i],
    [{ command_id: "VERIFY-BAD", executable: "a11y-file-verify", args: ["--mode", "utf8", "--path", "other.html"], cwd: "." }, /allowed_paths|authorized/i],
    [{ command_id: "VERIFY-BAD", executable: "a11y-file-verify", args: ["--mode", "utf8", "--path", "index.html"], cwd: ".." }, /cwd|relative|traversal/i]
  ];
  for (const [command, pattern] of cases) {
    const authorization = makeBrokerAuthorization(sourceRoot, [command], ["index.html"]);
    assert.throws(() => executeAuthorizedVerificationCommands({ authorization, commandIds: ["VERIFY-BAD"], sourceRoot, spawnSyncImpl }), pattern);
  }
  const valid = { command_id: "VERIFY-ONE", executable: "a11y-file-verify", args: ["--mode", "exists", "--path", "index.html"], cwd: "." };
  const authorization = makeBrokerAuthorization(sourceRoot, [valid], ["index.html"]);
  assert.throws(() => executeAuthorizedVerificationCommands({ authorization, commandIds: ["UNKNOWN"], sourceRoot, spawnSyncImpl }), /unknown|authorization/i);
  assert.throws(() => executeAuthorizedVerificationCommands({ authorization, commandIds: ["VERIFY-ONE", "VERIFY-ONE"], sourceRoot, spawnSyncImpl }), /duplicate/i);
  assert.equal(spawnCount, 0);
}));

test("verification broker records exited, signaled, and spawn_error states without extra fields", async (t) => withTemp(t, async ({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "index.html"), "safe\n", "utf8");
  const command = { command_id: "VERIFY-STATE", executable: "a11y-file-verify", args: ["--mode", "exists", "--path", "index.html"], cwd: "." };
  const authorization = makeBrokerAuthorization(sourceRoot, [command], ["index.html"]);
  const { executeAuthorizedVerificationCommands } = await import(pathToFileURL(fixVerificationLib));
  const states = [
    { status: 2, signal: null, stdout: Buffer.from("out"), stderr: Buffer.from("err") },
    { status: null, signal: "SIGTERM", stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) },
    { status: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: Object.assign(new Error("spawn denied"), { code: "EACCES" }) }
  ];
  const results = states.map((state) => executeAuthorizedVerificationCommands({
    authorization,
    commandIds: ["VERIFY-STATE"],
    sourceRoot,
    spawnSyncImpl: () => state
  })[0]);
  assert.deepEqual(results.map((item) => item.status), ["exited", "signaled", "spawn_error"]);
  assert.deepEqual(results.map((item) => item.exit_code), [2, null, null]);
  assert.deepEqual(results.map((item) => item.signal), [null, "SIGTERM", null]);
  for (const result of results) {
    assert.deepEqual(Object.keys(result).sort(), ["args", "command_id", "completed_at", "cwd", "executable", "exit_code", "signal", "started_at", "status", "stderr_sha256", "stdout_sha256"].sort());
    assert.match(result.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.match(result.completed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  }
  assert.notEqual(results[2].stderr_sha256, crypto.createHash("sha256").update("").digest("hex"));
}));

test("package verifier reports invalid JSON as a nonzero command result without changing the file", async (t) => withTemp(t, async ({ sourceRoot }) => {
  const target = path.join(sourceRoot, "data.json");
  fs.writeFileSync(target, "{invalid\n", "utf8");
  const before = sha256File(target);
  const command = { command_id: "VERIFY-JSON-BAD", executable: "a11y-file-verify", args: ["--mode", "json", "--path", "data.json"], cwd: "." };
  const authorization = makeBrokerAuthorization(sourceRoot, [command], ["data.json"]);
  const { executeAuthorizedVerificationCommands } = await import(pathToFileURL(fixVerificationLib));
  const [result] = executeAuthorizedVerificationCommands({ authorization, commandIds: ["VERIFY-JSON-BAD"], sourceRoot });
  assert.equal(result.status, "exited");
  assert.notEqual(result.exit_code, 0);
  assert.equal(sha256File(target), before);
}));

test("package verifier rejects an atomic path replacement after reading", async (t) => withTemp(t, async ({ temp, sourceRoot }) => {
  const target = path.join(sourceRoot, "data.json");
  const replacement = path.join(temp, "replacement.json");
  fs.writeFileSync(target, '{"safe":true}\n', "utf8");
  fs.writeFileSync(replacement, "{invalid\n", "utf8");
  const verifier = await import(`${pathToFileURL(verifyAuthorizedFileScript).href}?identity-test=${Date.now()}`);
  assert.equal(typeof verifier.verifyAuthorizedFile, "function");
  assert.throws(() => verifier.verifyAuthorizedFile({
    sourceRoot,
    mode: "json",
    relativePath: "data.json",
    hooks: {
      afterRead() {
        fs.renameSync(replacement, target);
      }
    }
  }), /identity|changed|replacement/i);
  assert.equal(fs.readFileSync(target, "utf8"), "{invalid\n");
}));

test("verification broker passes a minimal environment without loader injection variables", async (t) => withTemp(t, async ({ sourceRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "index.html"), "safe\n", "utf8");
  const command = { command_id: "VERIFY-ENV", executable: "a11y-file-verify", args: ["--mode", "utf8", "--path", "index.html"], cwd: "." };
  const authorization = makeBrokerAuthorization(sourceRoot, [command], ["index.html"]);
  const injected = {
    NODE_OPTIONS: "--require=attacker.js",
    LD_PRELOAD: "/tmp/attacker.so",
    LD_LIBRARY_PATH: "/tmp",
    DYLD_INSERT_LIBRARIES: "/tmp/attacker.dylib",
    OPENSSL_CONF: "/tmp/attacker.cnf",
    PYTHONPATH: "/tmp/attacker"
  };
  const previous = Object.fromEntries(Object.keys(injected).map((key) => [key, process.env[key]]));
  Object.assign(process.env, injected);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let childEnvironment;
  const { executeAuthorizedVerificationCommands } = await import(pathToFileURL(fixVerificationLib));
  executeAuthorizedVerificationCommands({
    authorization,
    commandIds: ["VERIFY-ENV"],
    sourceRoot,
    spawnSyncImpl: (_executable, _args, options) => {
      childEnvironment = options.env;
      return { status: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    }
  });
  for (const key of Object.keys(injected)) assert.equal(Object.hasOwn(childEnvironment, key), false, `${key} leaked into verifier environment`);
}));

function writeLeaseAuthorization(artifactRoot, sourceRoot, allowedPaths = ["index.html"]) {
  const command = { command_id: "VERIFY-LEASE", executable: "a11y-file-verify", args: ["--mode", "exists", "--path", allowedPaths[0]], cwd: "." };
  const authorization = makeBrokerAuthorization(sourceRoot, [command], allowedPaths);
  const authorizationFile = path.join(artifactRoot, `lease-authorization-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  writeJson(authorizationFile, authorization);
  return { authorization, authorizationFile, authorizationSha256: sha256File(authorizationFile) };
}

function acquireLeaseArgs({ authorizationFile, lockDir, output, runId = RUN_ID, recover = false, expectedAuthorizationSha256 }) {
  const args = ["--authorization", authorizationFile, "--run-id", runId, "--lock-dir", lockDir, "--output", output];
  if (recover) args.push("--recover-expired", "--expected-run-id", runId, "--expected-authorization-sha256", expectedAuthorizationSha256);
  return args;
}

test("fix lease module exports acquisition and release APIs", async () => {
  const module = await import(pathToFileURL(fixLeaseLib));
  assert.equal(typeof module.acquireFixLease, "function");
  assert.equal(typeof module.releaseFixLease, "function");
  assert.equal(typeof module.sourceRootSha256, "function");
});

test("lease CLI permits exactly one contender and release requires the exact receipt", async (t) => withTemp(t, async ({ temp, sourceRoot, artifactRoot }) => {
  const target = path.join(sourceRoot, "index.html");
  fs.writeFileSync(target, "unchanged\n", "utf8");
  const before = sha256File(target);
  const lockDir = path.join(temp, "locks");
  fs.mkdirSync(lockDir);
  const { authorizationFile } = writeLeaseAuthorization(artifactRoot, sourceRoot);
  const outputs = [path.join(artifactRoot, "receipt-1.json"), path.join(artifactRoot, "receipt-2.json")];
  const contenders = await Promise.all(outputs.map((output) => runNodeAsync(acquireFixLeaseScript, acquireLeaseArgs({ authorizationFile, lockDir, output }))));
  assert.equal(contenders.filter((item) => item.status === 0).length, 1, JSON.stringify(contenders));
  assert.equal(contenders.filter((item) => item.status !== 0).length, 1, JSON.stringify(contenders));
  const receiptFile = outputs.find((file) => fs.existsSync(file));
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  assert.match(receipt.lease_id, /^LEASE-\d{8}-[A-Z0-9]{8}$/);
  assert.equal(receipt.run_id, RUN_ID);
  assert.match(receipt.release_token, /^[a-f0-9]{64}$/);
  assert.equal(sha256File(target), before);

  const wrong = structuredClone(receipt);
  wrong.release_token = "0".repeat(64);
  const wrongReceipt = path.join(artifactRoot, "wrong-receipt.json");
  writeJson(wrongReceipt, wrong);
  assertRejected(runNode(releaseFixLeaseScript, ["--receipt", wrongReceipt, "--run-id", RUN_ID, "--authorization", authorizationFile]), /token|receipt|lease/i);
  assert.equal(fs.existsSync(receipt.lease_path), true);

  const released = runNode(releaseFixLeaseScript, ["--receipt", receiptFile, "--run-id", RUN_ID, "--authorization", authorizationFile]);
  assert.equal(released.status, 0, runOutput(released));
  assert.equal(fs.existsSync(receipt.lease_path), false);
  assert.equal(sha256File(target), before);
}));

test("different canonical source roots use different lease keys", async (t) => withTemp(t, async ({ temp, sourceRoot, artifactRoot }) => {
  const otherRoot = path.join(temp, "other-target");
  fs.mkdirSync(otherRoot);
  fs.writeFileSync(path.join(sourceRoot, "index.html"), "one\n", "utf8");
  fs.writeFileSync(path.join(otherRoot, "index.html"), "two\n", "utf8");
  const lockDir = path.join(temp, "locks");
  fs.mkdirSync(lockDir);
  const first = writeLeaseAuthorization(artifactRoot, sourceRoot);
  const second = writeLeaseAuthorization(artifactRoot, otherRoot);
  const firstOutput = path.join(artifactRoot, "first-root.json");
  const secondOutput = path.join(artifactRoot, "second-root.json");
  assert.equal(runNode(acquireFixLeaseScript, acquireLeaseArgs({ authorizationFile: first.authorizationFile, lockDir, output: firstOutput })).status, 0);
  assert.equal(runNode(acquireFixLeaseScript, acquireLeaseArgs({ authorizationFile: second.authorizationFile, lockDir, output: secondOutput })).status, 0);
  const firstReceipt = JSON.parse(fs.readFileSync(firstOutput, "utf8"));
  const secondReceipt = JSON.parse(fs.readFileSync(secondOutput, "utf8"));
  assert.notEqual(firstReceipt.source_root_sha256, secondReceipt.source_root_sha256);
  assert.notEqual(firstReceipt.lease_path, secondReceipt.lease_path);
}));

test("expired lease recovery requires unchanged baseline and exact prior identity", async (t) => withTemp(t, async ({ temp, sourceRoot, artifactRoot }) => {
  const target = path.join(sourceRoot, "index.html");
  fs.writeFileSync(target, "baseline\n", "utf8");
  const lockDir = path.join(temp, "locks");
  fs.mkdirSync(lockDir);
  const auth = writeLeaseAuthorization(artifactRoot, sourceRoot);
  const { acquireFixLease, releaseFixLease } = await import(pathToFileURL(fixLeaseLib));
  const start = new Date("2026-07-18T00:00:00Z");
  const first = acquireFixLease({ authorization: auth.authorization, authorizationSha256: auth.authorizationSha256, sourceRoot, lockDir, runId: RUN_ID, now: () => start });
  assert.equal(first.acquired_at, "2026-07-18T00:00:00Z");
  assert.equal(first.expires_at, "2026-07-18T02:00:00Z");
  assert.throws(() => acquireFixLease({
    authorization: auth.authorization,
    authorizationSha256: auth.authorizationSha256,
    sourceRoot,
    lockDir,
    runId: RUN_ID,
    recoverExpired: true,
    expectedRunId: RUN_ID,
    expectedAuthorizationSha256: auth.authorizationSha256,
    now: () => new Date("2026-07-18T01:59:59Z")
  }), /not expired|conflict/i);
  const recovered = acquireFixLease({
    authorization: auth.authorization,
    authorizationSha256: auth.authorizationSha256,
    sourceRoot,
    lockDir,
    runId: RUN_ID,
    recoverExpired: true,
    expectedRunId: RUN_ID,
    expectedAuthorizationSha256: auth.authorizationSha256,
    now: () => new Date("2026-07-18T02:00:01Z")
  });
  assert.equal(recovered.recovery.previous_lease_id, first.lease_id);
  assert.equal(recovered.recovery.previous_run_id, RUN_ID);
  assert.match(recovered.recovery.previous_lease_sha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(recovered.recovery_tombstone_path), true);
  releaseFixLease({ receipt: recovered, runId: RUN_ID, authorizationSha256: auth.authorizationSha256 });
  assert.equal(fs.existsSync(recovered.lease_path), false);
  assert.equal(fs.existsSync(recovered.recovery_tombstone_path), false);
}));

test("expired recovery fails closed after an allowed path changes or appears", async (t) => withTemp(t, async ({ temp, sourceRoot, artifactRoot }) => {
  const target = path.join(sourceRoot, "index.html");
  fs.writeFileSync(target, "baseline\n", "utf8");
  const lockDir = path.join(temp, "locks");
  fs.mkdirSync(lockDir);
  const auth = writeLeaseAuthorization(artifactRoot, sourceRoot, ["index.html", "new.html"]);
  const { acquireFixLease } = await import(pathToFileURL(fixLeaseLib));
  const first = acquireFixLease({ authorization: auth.authorization, authorizationSha256: auth.authorizationSha256, sourceRoot, lockDir, runId: RUN_ID, now: () => new Date("2026-07-18T00:00:00Z") });
  fs.writeFileSync(target, "changed\n", "utf8");
  assert.throws(() => acquireFixLease({
    authorization: auth.authorization,
    authorizationSha256: auth.authorizationSha256,
    sourceRoot,
    lockDir,
    runId: RUN_ID,
    recoverExpired: true,
    expectedRunId: RUN_ID,
    expectedAuthorizationSha256: auth.authorizationSha256,
    now: () => new Date("2026-07-18T03:00:00Z")
  }), /baseline|changed|manual/i);
  assert.equal(fs.existsSync(first.lease_path), true);
  fs.writeFileSync(target, "baseline\n", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "new.html"), "appeared\n", "utf8");
  assert.throws(() => acquireFixLease({
    authorization: auth.authorization,
    authorizationSha256: auth.authorizationSha256,
    sourceRoot,
    lockDir,
    runId: RUN_ID,
    recoverExpired: true,
    expectedRunId: RUN_ID,
    expectedAuthorizationSha256: auth.authorizationSha256,
    now: () => new Date("2026-07-18T03:00:01Z")
  }), /baseline|changed|manual/i);
  assert.equal(fs.existsSync(first.lease_path), true);
}));

test("lease rejects source-root overlap and a junction lock directory", async (t) => withTemp(t, async ({ temp, sourceRoot, artifactRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "index.html"), "baseline\n", "utf8");
  const auth = writeLeaseAuthorization(artifactRoot, sourceRoot);
  const { acquireFixLease } = await import(pathToFileURL(fixLeaseLib));
  const inside = path.join(sourceRoot, "locks");
  fs.mkdirSync(inside);
  assert.throws(() => acquireFixLease({ authorization: auth.authorization, authorizationSha256: auth.authorizationSha256, sourceRoot, lockDir: inside, runId: RUN_ID }), /outside|overlap|source root/i);
  const realLocks = path.join(temp, "real-locks");
  const junctionLocks = path.join(temp, "junction-locks");
  fs.mkdirSync(realLocks);
  fs.symlinkSync(realLocks, junctionLocks, "junction");
  assert.throws(() => acquireFixLease({ authorization: auth.authorization, authorizationSha256: auth.authorizationSha256, sourceRoot, lockDir: junctionLocks, runId: RUN_ID }), /junction|reparse|symbolic/i);
}));

test("lease recovery and release restore or quarantine the canonical lock after post-rename failures", async (t) => withTemp(t, async ({ temp, sourceRoot, artifactRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "index.html"), "baseline\n", "utf8");
  const lockDir = path.join(temp, "locks");
  fs.mkdirSync(lockDir);
  const auth = writeLeaseAuthorization(artifactRoot, sourceRoot);
  const { acquireFixLease, releaseFixLease } = await import(pathToFileURL(fixLeaseLib));
  const first = acquireFixLease({
    authorization: auth.authorization,
    authorizationSha256: auth.authorizationSha256,
    sourceRoot,
    lockDir,
    runId: RUN_ID,
    now: () => new Date("2026-07-18T00:00:00Z")
  });
  assert.throws(() => acquireFixLease({
    authorization: auth.authorization,
    authorizationSha256: auth.authorizationSha256,
    sourceRoot,
    lockDir,
    runId: RUN_ID,
    recoverExpired: true,
    expectedRunId: RUN_ID,
    expectedAuthorizationSha256: auth.authorizationSha256,
    now: () => new Date("2026-07-18T03:00:00Z"),
    hooks: { afterRecoveryRename() { throw new Error("injected recovery fault"); } }
  }), /injected recovery fault/i);
  assert.equal(fs.existsSync(first.lease_path), true, "failed recovery removed the canonical lease");

  const recovered = acquireFixLease({
    authorization: auth.authorization,
    authorizationSha256: auth.authorizationSha256,
    sourceRoot,
    lockDir,
    runId: RUN_ID,
    recoverExpired: true,
    expectedRunId: RUN_ID,
    expectedAuthorizationSha256: auth.authorizationSha256,
    now: () => new Date("2026-07-18T03:00:01Z")
  });
  assert.throws(() => releaseFixLease({
    receipt: recovered,
    runId: RUN_ID,
    authorizationSha256: auth.authorizationSha256,
    hooks: { afterReleaseRename() { throw new Error("injected release fault"); } }
  }), /injected release fault/i);
  assert.equal(fs.existsSync(recovered.lease_path), true, "failed release removed the canonical lease");
  releaseFixLease({ receipt: recovered, runId: RUN_ID, authorizationSha256: auth.authorizationSha256 });
  assert.equal(fs.existsSync(recovered.lease_path), false);
}));

test("lease cleanup failure leaves a guard that blocks a new acquisition", async (t) => withTemp(t, async ({ temp, sourceRoot, artifactRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "index.html"), "baseline\n", "utf8");
  const lockDir = path.join(temp, "locks");
  fs.mkdirSync(lockDir);
  const auth = writeLeaseAuthorization(artifactRoot, sourceRoot);
  const { acquireFixLease, releaseFixLease } = await import(pathToFileURL(fixLeaseLib));
  acquireFixLease({
    authorization: auth.authorization,
    authorizationSha256: auth.authorizationSha256,
    sourceRoot,
    lockDir,
    runId: RUN_ID,
    now: () => new Date("2026-07-18T00:00:00Z")
  });
  const recovered = acquireFixLease({
    authorization: auth.authorization,
    authorizationSha256: auth.authorizationSha256,
    sourceRoot,
    lockDir,
    runId: RUN_ID,
    recoverExpired: true,
    expectedRunId: RUN_ID,
    expectedAuthorizationSha256: auth.authorizationSha256,
    now: () => new Date("2026-07-18T03:00:00Z")
  });
  assert.throws(() => releaseFixLease({
    receipt: recovered,
    runId: RUN_ID,
    authorizationSha256: auth.authorizationSha256,
    hooks: { beforeRecoveryTombstoneUnlink() { throw new Error("injected cleanup fault"); } }
  }), /quarantined|manual reconciliation/i);
  assert.equal(fs.existsSync(recovered.lease_path), false);
  assert.throws(() => acquireFixLease({
    authorization: auth.authorization,
    authorizationSha256: auth.authorizationSha256,
    sourceRoot,
    lockDir,
    runId: RUN_ID
  }), /quarantined|guard|manual reconciliation/i);
}));

test("acquisition aborts if a release guard appears after its initial guard check", async (t) => withTemp(t, async ({ temp, sourceRoot, artifactRoot }) => {
  fs.writeFileSync(path.join(sourceRoot, "index.html"), "baseline\n", "utf8");
  const lockDir = path.join(temp, "locks");
  fs.mkdirSync(lockDir);
  const auth = writeLeaseAuthorization(artifactRoot, sourceRoot);
  const { acquireFixLease, releaseFixLease } = await import(pathToFileURL(fixLeaseLib));
  const first = acquireFixLease({
    authorization: auth.authorization,
    authorizationSha256: auth.authorizationSha256,
    sourceRoot,
    lockDir,
    runId: RUN_ID
  });
  assert.throws(() => acquireFixLease({
    authorization: auth.authorization,
    authorizationSha256: auth.authorizationSha256,
    sourceRoot,
    lockDir,
    runId: RUN_ID,
    hooks: {
      afterInitialGuardCheck() {
        assert.throws(() => releaseFixLease({
          receipt: first,
          runId: RUN_ID,
          authorizationSha256: auth.authorizationSha256,
          hooks: { afterReleaseLeaseUnlink() { throw new Error("injected post-unlink fault"); } }
        }), /quarantined|manual reconciliation/i);
      }
    }
  }), /guard|aborted|manual reconciliation/i);
  assert.equal(fs.existsSync(first.lease_path), false, "guard-conflicted acquisition left a canonical lease");
  assert.equal(fs.existsSync(`${first.lease_path}.guard`), true, "quarantine guard was removed");
}));

function prepareTransaction({ temp, sourceRoot, artifactRoot }, {
  operation = "modify",
  target = "index.html",
  initialContent = "<main>before</main>\n",
  nextContent = "<main>after</main>\n",
  authorizedNextContent = nextContent,
  verificationMode = "utf8"
} = {}) {
  const fixture = makeRemediationReadyFixture({ sourceRoot, artifactRoot });
  const targetFile = path.join(sourceRoot, ...target.split("/"));
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  if (operation === "create") {
    if (fs.existsSync(targetFile)) fs.rmSync(targetFile);
  } else {
    fs.writeFileSync(targetFile, initialContent, "utf8");
  }
  writeJson(fixture.runFile, fixture.run);
  const payload = makeAuthPayload({
    sourceRootPath: sourceRoot,
    allowedOperations: [operation],
    allowedPaths: [target],
    remediationArtifact: { artifact_id: "ART-REMEDIATION-001", sha256: sha256File(fixture.remediationFile) }
  });
  payload.verification_commands = [{
    command_id: "VERIFY-TRANSACTION",
    executable: "a11y-file-verify",
    args: ["--mode", verificationMode, "--path", target],
    cwd: "."
  }];
  const authorization = makeAuthEnvelope(payload, `ART-AUTH-TRANSACTION-${operation.toUpperCase()}`);
  const authorizationFile = path.join(artifactRoot, `authorization-${operation}.json`);
  writeJson(authorizationFile, authorization);
  const contentFile = operation === "delete" ? null : path.join(artifactRoot, `content-${operation}.txt`);
  if (contentFile) fs.writeFileSync(contentFile, nextContent, "utf8");
  const output = path.join(artifactRoot, `change-${operation}.json`);
  const lockDir = path.join(temp, `locks-${operation}`);
  fs.mkdirSync(lockDir);
  const expectedBeforeSha256 = operation === "create" ? null : sha256File(targetFile);
  const expectedAfterSha256 = operation === "delete"
    ? null
    : crypto.createHash("sha256").update(Buffer.from(authorizedNextContent, "utf8")).digest("hex");
  payload.change_bindings = [{
    path: target,
    operation,
    expected_before_sha256: expectedBeforeSha256,
    expected_after_sha256: expectedAfterSha256
  }];
  writeJson(authorizationFile, authorization);
  const args = [
    "--authorization", authorizationFile,
    "--run", fixture.runFile,
    "--source-root", sourceRoot,
    "--operation", operation,
    "--target", target,
    "--description", `${operation} authorized accessibility fix`,
    "--command-id", "VERIFY-TRANSACTION",
    "--lock-dir", lockDir,
    "--output", output
  ];
  if (contentFile) args.push("--content-file", contentFile);
  if (expectedBeforeSha256) args.push("--expected-before-sha256", expectedBeforeSha256);
  return {
    ...fixture,
    operation,
    target,
    targetFile,
    initialContent,
    nextContent,
    authorization,
    authorizationFile,
    authorizationSha256: sha256File(authorizationFile),
    contentFile,
    expectedBeforeSha256,
    expectedAfterSha256,
    output,
    diffOutput: path.join(artifactRoot, `change-${operation}.diff.json`),
    consumptionMarker: path.join(artifactRoot, ".fix-consumption", `${sha256File(authorizationFile)}.json`),
    lockDir,
    args
  };
}

test("authorized fix transaction module exports the single target-write API", async () => {
  const module = await import(pathToFileURL(fixTransactionLib));
  assert.equal(typeof module.applyAuthorizedFix, "function");
});

for (const operation of ["create", "modify", "delete"]) {
  test(`authorized fix transaction records measured ${operation} and consumes authorization once`, async (t) => withTemp(t, async (roots) => {
    const prepared = prepareTransaction(roots, {
      operation,
      target: operation === "create" ? "draft/new.html" : "index.html",
      verificationMode: operation === "delete" ? "exists" : "utf8"
    });
    const result = runNode(applyAuthorizedFixScript, prepared.args);
    assert.equal(result.status, 0, runOutput(result));
    assert.equal(fs.existsSync(prepared.output), true);
    assert.equal(fs.existsSync(prepared.diffOutput), true);
    assert.equal(fs.existsSync(prepared.consumptionMarker), true);
    assert.equal(fs.readdirSync(prepared.lockDir).some((name) => name.endsWith(".lease.json") || name.endsWith(".guard")), false);

    const artifact = JSON.parse(fs.readFileSync(prepared.output, "utf8"));
    const validation = validateArtifact(artifact, resources, { allowedPayloadVersions: resources.currentPayloadVersions });
    assert.equal(validation.valid, true, validation.errors.join("\n"));
    assert.equal(artifact.artifact_type, "change-record");
    assert.equal(artifact.producer.role_id, "authorized_fixer");
    assert.equal(artifact.payload.next_status, "retest_required");
    assert.equal(artifact.payload.authorization_artifact.artifact_id, prepared.authorization.artifact_id);
    assert.equal(artifact.payload.authorization_artifact.sha256, prepared.authorizationSha256);
    assert.equal(artifact.payload.diff_sha256, sha256File(prepared.diffOutput));
    assert.equal(artifact.payload.changed_files.length, 1);
    const changed = artifact.payload.changed_files[0];
    assert.equal(changed.path, prepared.target);
    assert.equal(changed.operation, operation);
    assert.equal(changed.before_sha256, operation === "create" ? null : prepared.expectedBeforeSha256);
    assert.equal(changed.after_sha256, operation === "delete" ? null : sha256File(prepared.targetFile));
    assert.equal(artifact.payload.command_results.length, 1);
    assert.equal(artifact.payload.command_results[0].command_id, "VERIFY-TRANSACTION");
    assert.equal(artifact.payload.command_results[0].status, "exited");
    if (operation === "delete") {
      assert.equal(fs.existsSync(prepared.targetFile), false);
      assert.notEqual(artifact.payload.command_results[0].exit_code, 0);
    } else {
      assert.equal(fs.readFileSync(prepared.targetFile, "utf8"), prepared.nextContent);
      assert.equal(artifact.payload.command_results[0].exit_code, 0);
    }

    const secondOutput = path.join(path.dirname(prepared.output), `second-${operation}.json`);
    const reuseArgs = prepared.args.map((value, index, values) => values[index - 1] === "--output" ? secondOutput : value);
    if (operation !== "create" && fs.existsSync(prepared.targetFile)) {
      const expectedIndex = reuseArgs.indexOf("--expected-before-sha256") + 1;
      reuseArgs[expectedIndex] = sha256File(prepared.targetFile);
    }
    const reuse = runNode(applyAuthorizedFixScript, reuseArgs);
    assertRejected(reuse, /consumed|single.use|authorization.*used/i);
    assert.equal(fs.existsSync(secondOutput), false);
  }));
}

test("authorized fix rejects a pre-change hash mismatch without mutation or consumption", (t) => withTemp(t, (roots) => {
  const prepared = prepareTransaction(roots, { operation: "modify" });
  const args = [...prepared.args];
  args[args.indexOf("--expected-before-sha256") + 1] = "0".repeat(64);
  const before = fs.readFileSync(prepared.targetFile, "utf8");
  assertRejected(runNode(applyAuthorizedFixScript, args), /before|pre.change|sha-256|hash/i);
  assert.equal(fs.readFileSync(prepared.targetFile, "utf8"), before);
  assert.equal(fs.existsSync(prepared.output), false);
  assert.equal(fs.existsSync(prepared.diffOutput), false);
  assert.equal(fs.existsSync(prepared.consumptionMarker), false);
  assert.equal(fs.readdirSync(prepared.lockDir).some((name) => name.endsWith(".lease.json") || name.endsWith(".guard")), false);
}));

test("authorized fix rejects replacement bytes outside the exact after hash binding", (t) => withTemp(t, (roots) => {
  const prepared = prepareTransaction(roots, {
    operation: "modify",
    authorizedNextContent: "<main>authorized bytes</main>\n",
    nextContent: "<main>different bytes</main>\n"
  });
  const before = fs.readFileSync(prepared.targetFile, "utf8");
  assertRejected(runNode(applyAuthorizedFixScript, prepared.args), /after|replacement|authorization binding|sha-256/i);
  assert.equal(fs.readFileSync(prepared.targetFile, "utf8"), before);
  assert.equal(fs.existsSync(prepared.output), false);
  assert.equal(fs.existsSync(prepared.diffOutput), false);
  assert.equal(fs.existsSync(prepared.consumptionMarker), false);
}));

test("authorization remains consumed after the run artifact tree is cloned", (t) => withTemp(t, (roots) => {
  const prepared = prepareTransaction(roots, { operation: "modify" });
  const cloneRoot = path.join(roots.temp, "clone");
  const cloneArtifactRoot = path.join(cloneRoot, "artifacts");
  fs.mkdirSync(cloneRoot);
  fs.cpSync(roots.artifactRoot, cloneArtifactRoot, { recursive: true });
  const cloneRunFile = path.join(cloneRoot, "run.json");
  fs.copyFileSync(prepared.runFile, cloneRunFile);
  const cloneAuthorizationFile = path.join(cloneArtifactRoot, path.basename(prepared.authorizationFile));
  const cloneContentFile = path.join(cloneArtifactRoot, path.basename(prepared.contentFile));
  const cloneOutput = path.join(cloneArtifactRoot, "cloned-change.json");
  const cloneLockDir = path.join(roots.temp, "clone-locks");
  fs.mkdirSync(cloneLockDir);
  const cloneArgs = prepared.args.map((value, index, values) => {
    if (values[index - 1] === "--authorization") return cloneAuthorizationFile;
    if (values[index - 1] === "--run") return cloneRunFile;
    if (values[index - 1] === "--content-file") return cloneContentFile;
    if (values[index - 1] === "--lock-dir") return cloneLockDir;
    if (values[index - 1] === "--output") return cloneOutput;
    return value;
  });

  const first = runNode(applyAuthorizedFixScript, prepared.args);
  assert.equal(first.status, 0, runOutput(first));
  fs.writeFileSync(prepared.targetFile, prepared.initialContent, "utf8");
  const spoofedHome = path.join(roots.temp, "spoofed-home");
  fs.mkdirSync(spoofedHome);
  const replay = spawnSync(process.execPath, [applyAuthorizedFixScript, ...cloneArgs], {
    encoding: "utf8",
    env: { ...process.env, HOME: spoofedHome, USERPROFILE: spoofedHome }
  });
  assertRejected(replay, /consumed|single.use|authorization.*used/i);
  assert.equal(fs.readFileSync(prepared.targetFile, "utf8"), prepared.initialContent);
  assert.equal(fs.existsSync(cloneOutput), false);
}));

for (const operation of ["create", "modify", "delete"]) {
  test(`parent replacement after authorization validation cannot redirect ${operation}`, async (t) => withTemp(t, async (roots) => {
    const targetName = operation === "create" ? "new.html" : "index.html";
    const prepared = prepareTransaction(roots, { operation, target: `safe/${targetName}` });
    const safeParent = path.dirname(prepared.targetFile);
    const movedParent = path.join(roots.sourceRoot, "safe-original");
    const outsideParent = path.join(roots.temp, "outside-parent");
    fs.mkdirSync(outsideParent);
    const outsideTarget = path.join(outsideParent, targetName);
    if (operation !== "create") fs.writeFileSync(outsideTarget, prepared.initialContent, "utf8");
    const probe = path.join(roots.temp, "junction-probe");
    try {
      fs.symlinkSync(outsideParent, probe, "junction");
      fs.rmSync(probe, { recursive: true, force: true });
    } catch (error) {
      if (error.code === "EPERM") {
        t.skip("junction creation is not permitted in this environment");
        return;
      }
      throw error;
    }
    let swapped = false;
    const { applyAuthorizedFix } = await import(pathToFileURL(fixTransactionLib));
    try {
      assert.throws(() => applyAuthorizedFix({
        authorizationFile: prepared.authorizationFile,
        runFile: prepared.runFile,
        sourceRoot: prepared.sourceRoot,
        operation: prepared.operation,
        target: prepared.target,
        description: "parent identity race fixture",
        commandIds: ["VERIFY-TRANSACTION"],
        lockDir: prepared.lockDir,
        output: prepared.output,
        contentFile: prepared.contentFile,
        expectedBeforeSha256: prepared.expectedBeforeSha256,
        hooks: {
          beforeMutation() {
            fs.renameSync(safeParent, movedParent);
            fs.symlinkSync(outsideParent, safeParent, "junction");
            swapped = true;
          }
        }
      }), /parent|identity|junction|symbolic|changed/i);
      assert.equal(swapped, true);
      if (operation === "create") {
        assert.equal(fs.existsSync(outsideTarget), false);
        assert.equal(fs.existsSync(path.join(movedParent, targetName)), false);
      } else {
        assert.equal(fs.readFileSync(outsideTarget, "utf8"), prepared.initialContent);
        assert.equal(fs.readFileSync(path.join(movedParent, targetName), "utf8"), prepared.initialContent);
      }
      assert.equal(fs.existsSync(prepared.output), false);
    } finally {
      if (swapped && fs.existsSync(safeParent)) fs.rmSync(safeParent, { recursive: true, force: true });
      if (swapped && fs.existsSync(movedParent)) fs.renameSync(movedParent, safeParent);
    }
  }));
}

test("post-mutation failure emits no completed change record and still blocks authorization reuse", async (t) => withTemp(t, async (roots) => {
  const prepared = prepareTransaction(roots, { operation: "modify" });
  const { applyAuthorizedFix } = await import(pathToFileURL(fixTransactionLib));
  assert.throws(() => applyAuthorizedFix({
    authorizationFile: prepared.authorizationFile,
    runFile: prepared.runFile,
    sourceRoot: prepared.sourceRoot,
    operation: prepared.operation,
    target: prepared.target,
    description: "injected failure fixture",
    commandIds: ["VERIFY-TRANSACTION"],
    lockDir: prepared.lockDir,
    output: prepared.output,
    contentFile: prepared.contentFile,
    expectedBeforeSha256: prepared.expectedBeforeSha256,
    hooks: { afterMutation() { throw new Error("injected post-mutation failure"); } }
  }), /injected post-mutation failure/i);
  assert.equal(fs.readFileSync(prepared.targetFile, "utf8"), prepared.initialContent);
  assert.equal(fs.existsSync(prepared.output), false);
  assert.equal(fs.existsSync(prepared.consumptionMarker), true);
  assertRejected(runNode(applyAuthorizedFixScript, prepared.args), /consumed|single.use|authorization.*used/i);
}));

test("completed change evidence is not published when lease release fails", async (t) => withTemp(t, async (roots) => {
  const prepared = prepareTransaction(roots, { operation: "modify" });
  const { applyAuthorizedFix } = await import(pathToFileURL(fixTransactionLib));
  assert.throws(() => applyAuthorizedFix({
    authorizationFile: prepared.authorizationFile,
    runFile: prepared.runFile,
    sourceRoot: prepared.sourceRoot,
    operation: prepared.operation,
    target: prepared.target,
    description: "lease release failure fixture",
    commandIds: ["VERIFY-TRANSACTION"],
    lockDir: prepared.lockDir,
    output: prepared.output,
    contentFile: prepared.contentFile,
    expectedBeforeSha256: prepared.expectedBeforeSha256,
    hooks: { lease: { afterReleaseRename() { throw new Error("injected lease release failure"); } } }
  }), /injected lease release failure/i);
  assert.equal(fs.existsSync(prepared.output), false);
  assert.equal(fs.readFileSync(prepared.targetFile, "utf8"), prepared.nextContent);
  assert.equal(fs.existsSync(prepared.consumptionMarker), true);
  const pendingName = fs.readdirSync(path.dirname(prepared.authorizationFile)).find((name) => name.includes("pending-change-record"));
  assert.equal(Boolean(pendingName), true);
  assert.throws(() => registerArtifact(prepared.run, undefined, {
    runFile: prepared.runFile,
    artifactFile: path.join(path.dirname(prepared.authorizationFile), pendingName)
  }), /internal|pending|staging|not registerable/i);
  assert.equal(fs.readdirSync(prepared.lockDir).some((name) => name.endsWith(".lease.json") || name.endsWith(".guard")), true);
}));

test("completed change evidence publication never overwrites a concurrently created output", async (t) => withTemp(t, async (roots) => {
  const prepared = prepareTransaction(roots, { operation: "modify" });
  const blocker = "preexisting concurrent artifact\n";
  const { applyAuthorizedFix } = await import(pathToFileURL(fixTransactionLib));
  assert.throws(() => applyAuthorizedFix({
    authorizationFile: prepared.authorizationFile,
    runFile: prepared.runFile,
    sourceRoot: prepared.sourceRoot,
    operation: prepared.operation,
    target: prepared.target,
    description: "evidence publication collision fixture",
    commandIds: ["VERIFY-TRANSACTION"],
    lockDir: prepared.lockDir,
    output: prepared.output,
    contentFile: prepared.contentFile,
    expectedBeforeSha256: prepared.expectedBeforeSha256,
    hooks: { beforeEvidencePublish() { fs.writeFileSync(prepared.output, blocker, { encoding: "utf8", flag: "wx" }); } }
  }), /exist|EEXIST|output|publish/i);
  assert.equal(fs.readFileSync(prepared.output, "utf8"), blocker);
  assert.equal(fs.readFileSync(prepared.targetFile, "utf8"), prepared.nextContent);
  assert.equal(fs.readdirSync(path.dirname(prepared.authorizationFile)).some((name) => name.includes("pending-change-record")), true);
}));

test("post-change path replacement cannot commit a stale after hash", async (t) => withTemp(t, async (roots) => {
  const prepared = prepareTransaction(roots, { operation: "modify" });
  const replacement = path.join(roots.temp, "external-replacement.txt");
  fs.writeFileSync(replacement, "<main>external replacement</main>\n", "utf8");
  const { applyAuthorizedFix } = await import(pathToFileURL(fixTransactionLib));
  assert.throws(() => applyAuthorizedFix({
    authorizationFile: prepared.authorizationFile,
    runFile: prepared.runFile,
    sourceRoot: prepared.sourceRoot,
    operation: prepared.operation,
    target: prepared.target,
    description: "stale after hash fixture",
    commandIds: ["VERIFY-TRANSACTION"],
    lockDir: prepared.lockDir,
    output: prepared.output,
    contentFile: prepared.contentFile,
    expectedBeforeSha256: prepared.expectedBeforeSha256,
    hooks: { afterMutation() { fs.renameSync(replacement, prepared.targetFile); } }
  }), /changed|identity|rollback failed|manual reconciliation/i);
  assert.equal(fs.existsSync(prepared.output), false);
  assert.equal(fs.existsSync(prepared.consumptionMarker), true);
  assert.equal(fs.readFileSync(prepared.targetFile, "utf8"), "<main>external replacement</main>\n");
  assert.equal(fs.readdirSync(prepared.lockDir).some((name) => name.endsWith(".lease.json") || name.endsWith(".guard")), true);
}));
