import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertNewOutputPath,
  assertStableFile,
  canonicalJson,
  loadAuditResources,
  readStableFile,
  sha256Bytes,
  validateArtifact,
  validateAuditRun,
  writeNewJson
} from "./audit-run.mjs";
import { authorizedChangeBinding, validateFixAuthorization } from "./fix-authorization.mjs";
import { acquireFixLease, DEFAULT_FIX_LEASE_DIRECTORY, releaseFixLease } from "./fix-lease.mjs";
import { executeAuthorizedVerificationCommands } from "./fix-verification.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_TEXT_BYTES = 1024 * 1024;
const SYSTEM_ACCOUNT_HOME = os.userInfo().homedir;
if (typeof SYSTEM_ACCOUNT_HOME !== "string" || !path.isAbsolute(SYSTEM_ACCOUNT_HOME)) {
  throw new Error("The operating system account home directory is unavailable for the fix consumption ledger.");
}
export const DEFAULT_FIX_CONSUMPTION_LEDGER_DIRECTORY = path.join(SYSTEM_ACCOUNT_HOME, ".information-accessibility-practice", "fix-authorization-ledger-v1");

function pathKey(value) {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function samePath(left, right) {
  return pathKey(left) === pathKey(right);
}

function pathsOverlap(left, right) {
  const leftToRight = path.relative(path.resolve(left), path.resolve(right));
  const rightToLeft = path.relative(path.resolve(right), path.resolve(left));
  return samePath(left, right)
    || (!path.isAbsolute(leftToRight) && leftToRight !== ".." && !leftToRight.startsWith(`..${path.sep}`))
    || (!path.isAbsolute(rightToLeft) && rightToLeft !== ".." && !rightToLeft.startsWith(`..${path.sep}`));
}

function timestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Transaction clock returned an invalid date.");
  return date.toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function randomId(prefix, date) {
  return `${prefix}-${date.toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function parseStableJson(file, label) {
  const snapshot = readStableFile(file, { label });
  let value;
  try {
    value = JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${error.message}`);
  }
  return { value, snapshot };
}

function inspectDirectory(directory, label) {
  const absolute = path.resolve(directory);
  const stats = fs.lstatSync(absolute);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`${label} must be a non-link directory.`);
  const real = fs.realpathSync.native(absolute);
  if (!samePath(real, absolute)) throw new Error(`${label} must not traverse a symbolic link or junction.`);
  return real;
}

function artifactRootFor(run, runFile) {
  if (typeof run?.artifact_root !== "string" || run.artifact_root.length === 0) throw new Error("run.artifact_root is required.");
  return inspectDirectory(path.resolve(path.dirname(path.resolve(runFile)), run.artifact_root), "run artifact root");
}

function directNewArtifactOutput(output, artifactRoot, label) {
  const absolute = path.resolve(output);
  if (!samePath(path.dirname(absolute), artifactRoot)) throw new Error(`${label} must be a direct child of the run artifact root.`);
  return assertNewOutputPath(absolute);
}

function consumptionDirectory(artifactRoot) {
  const directory = path.join(artifactRoot, ".fix-consumption");
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
  return inspectDirectory(directory, "fix consumption directory");
}

function consumptionMarkerPath(artifactRoot, authorizationSha256) {
  return path.join(artifactRoot, ".fix-consumption", `${authorizationSha256}.json`);
}

function assertNotConsumed(artifactRoot, authorizationSha256) {
  const marker = consumptionMarkerPath(artifactRoot, authorizationSha256);
  if (fs.existsSync(marker)) throw new Error(`Fix authorization was already consumed and is single-use: ${marker}`);
  return marker;
}

function ensureGlobalConsumptionLedger() {
  const directory = DEFAULT_FIX_CONSUMPTION_LEDGER_DIRECTORY;
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
  return inspectDirectory(directory, "global fix consumption ledger");
}

export function globalConsumptionMarkerPath({ authorizationSha256, sourceRoot, runId }) {
  const canonicalSourceRoot = inspectDirectory(sourceRoot, "trusted source root");
  const sourceRootSha256 = sha256Bytes(Buffer.from(pathKey(canonicalSourceRoot), "utf8"));
  const ledgerKey = sha256Bytes(Buffer.from(canonicalJson({
    authorization_sha256: authorizationSha256,
    run_id: runId,
    source_root_sha256: sourceRootSha256
  }), "utf8"));
  return {
    markerPath: path.join(ensureGlobalConsumptionLedger(), `${ledgerKey}.json`),
    sourceRootSha256
  };
}

function assertGlobalNotConsumed(record) {
  if (fs.existsSync(record.markerPath)) {
    throw new Error(`Fix authorization was already consumed in the global single-use ledger: ${record.markerPath}`);
  }
}

function claimGlobalConsumption(record, value) {
  try {
    writeNewJson(record.markerPath, { ...value, source_root_sha256: record.sourceRootSha256 });
  } catch (error) {
    if (error?.code === "EEXIST" || /exist|consum|single.use/iu.test(error?.message ?? "")) {
      throw new Error(`Fix authorization was already consumed in the global single-use ledger: ${record.markerPath}`);
    }
    throw new Error(`Global fix consumption ledger claim failed closed: ${error.message}`);
  }
}

function readTextSnapshot(file, label) {
  const snapshot = readStableFile(file, { label });
  if (snapshot.bytes.length > MAX_TEXT_BYTES) throw new Error(`${label} exceeds the ${MAX_TEXT_BYTES}-byte transaction limit.`);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes);
  } catch {
    throw new Error(`${label} must be valid UTF-8 text.`);
  }
  return { snapshot, text };
}

function validateInputs({ operation, contentFile, expectedBeforeSha256, target, description, commandIds }) {
  if (!new Set(["create", "modify", "delete"]).has(operation)) throw new Error("operation must be create|modify|delete.");
  if (typeof target !== "string" || target.length === 0) throw new Error("target is required.");
  if (typeof description !== "string" || description.trim().length === 0) throw new Error("description is required.");
  if (!Array.isArray(commandIds) || commandIds.length === 0 || new Set(commandIds).size !== commandIds.length) {
    throw new Error("At least one unique command ID is required.");
  }
  if (operation === "create") {
    if (!contentFile) throw new Error("contentFile is required for create.");
    if (expectedBeforeSha256 !== null && expectedBeforeSha256 !== undefined) throw new Error("create must not declare an expected before SHA-256.");
  } else if (operation === "modify") {
    if (!contentFile) throw new Error("contentFile is required for modify.");
    if (!SHA256_PATTERN.test(expectedBeforeSha256 ?? "")) throw new Error("modify requires expectedBeforeSha256.");
  } else {
    if (contentFile) throw new Error("delete must not include contentFile.");
    if (!SHA256_PATTERN.test(expectedBeforeSha256 ?? "")) throw new Error("delete requires expectedBeforeSha256.");
  }
}

function stableTargetSnapshot(sourceRoot, target, operation) {
  const absolute = path.resolve(sourceRoot, ...target.split("/"));
  if (operation === "create") return { absolute, snapshot: null, text: null };
  const read = readTextSnapshot(absolute, "authorized target before change");
  return { absolute, snapshot: read.snapshot, text: read.text };
}

function directorySnapshot(directory, label) {
  const absolute = path.resolve(directory);
  const stats = fs.lstatSync(absolute, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`${label} must remain a non-link directory.`);
  const real = fs.realpathSync.native(absolute);
  if (!samePath(real, absolute)) throw new Error(`${label} must not resolve through a symbolic link or junction.`);
  return { path: absolute, dev: String(stats.dev), ino: String(stats.ino), real: pathKey(real) };
}

function captureTargetParentChain(sourceRoot, targetFile) {
  const root = inspectDirectory(sourceRoot, "trusted source root");
  const parent = path.dirname(path.resolve(targetFile));
  const relative = path.relative(root, parent);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("Authorized target parent is outside the trusted source root.");
  }
  const chain = [directorySnapshot(root, "trusted source root")];
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    chain.push(directorySnapshot(current, "authorized target parent component"));
  }
  return chain;
}

function assertTargetParentChain(chain) {
  for (const expected of chain) {
    const current = directorySnapshot(expected.path, "authorized target parent component");
    if (current.dev !== expected.dev || current.ino !== expected.ino || current.real !== expected.real) {
      throw new Error(`Authorized target parent identity changed before mutation: ${expected.path}`);
    }
  }
}

function revalidateAuthorization(params, authorization, run, runSnapshot) {
  const result = validateFixAuthorization({
    authorization,
    run,
    runFile: runSnapshot.path,
    targetFile: params.target,
    sourceRoot: params.sourceRoot,
    operation: params.operation
  });
  if (!result.valid) throw new Error(`Fix authorization validation failed:\n- ${result.errors.join("\n- ")}`);
}

function exactAuthorizedChange(params, authorization) {
  const binding = authorizedChangeBinding({
    authorization,
    targetFile: params.target,
    sourceRoot: params.sourceRoot,
    operation: params.operation
  });
  if (!binding) throw new Error("Fix authorization does not contain an exact change binding for the requested path and operation.");
  return binding;
}

function assertRequestedHashes(binding, params, content) {
  const requestedBefore = params.expectedBeforeSha256 ?? null;
  const requestedAfter = content?.snapshot.sha256 ?? null;
  if (binding.expected_before_sha256 !== requestedBefore) {
    throw new Error(`Requested before SHA-256 does not match the authorization binding: authorized ${binding.expected_before_sha256}, requested ${requestedBefore}.`);
  }
  if (binding.expected_after_sha256 !== requestedAfter) {
    throw new Error(`Replacement content SHA-256 does not match the authorization binding: authorized ${binding.expected_after_sha256}, measured ${requestedAfter}.`);
  }
}

function assertMeasuredHashes(binding, before, after) {
  const measuredBefore = before.snapshot?.sha256 ?? null;
  const measuredAfter = after?.snapshot?.sha256 ?? null;
  if (binding.expected_before_sha256 !== measuredBefore) {
    throw new Error(`Measured before SHA-256 does not match the authorization binding: authorized ${binding.expected_before_sha256}, measured ${measuredBefore}.`);
  }
  if (binding.expected_after_sha256 !== measuredAfter) {
    throw new Error(`Measured after SHA-256 does not match the authorization binding: authorized ${binding.expected_after_sha256}, measured ${measuredAfter}.`);
  }
}

function writeBytesExclusive(file, bytes) {
  const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow, 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function applyMutation({ operation, targetState, contentSnapshot, authorization, run, runSnapshot, params, parentChain, mutationState }) {
  revalidateAuthorization(params, authorization, run, runSnapshot);
  params.hooks?.beforeMutation?.({ targetFile: targetState.absolute });
  assertTargetParentChain(parentChain);
  if (targetState.snapshot) assertStableFile(targetState.snapshot, "authorized target before mutation");
  const targetFile = targetState.absolute;
  let temporary = null;
  try {
    if (operation === "create") {
      assertTargetParentChain(parentChain);
      mutationState.started = true;
      writeBytesExclusive(targetFile, contentSnapshot.bytes);
    } else if (operation === "modify") {
      temporary = path.join(path.dirname(targetFile), `.${path.basename(targetFile)}.a11y-fix-${crypto.randomBytes(8).toString("hex")}`);
      writeBytesExclusive(temporary, contentSnapshot.bytes);
      assertTargetParentChain(parentChain);
      assertStableFile(targetState.snapshot, "authorized target before atomic replacement");
      mutationState.started = true;
      fs.renameSync(temporary, targetFile);
      temporary = null;
    } else {
      assertTargetParentChain(parentChain);
      assertStableFile(targetState.snapshot, "authorized target before deletion");
      mutationState.started = true;
      fs.unlinkSync(targetFile);
    }
    assertTargetParentChain(parentChain);
  } finally {
    if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function measuredAfterState(targetFile, operation, expectedBytes) {
  if (operation === "delete") {
    if (fs.existsSync(targetFile)) throw new Error("Authorized delete did not remove the target.");
    return { snapshot: null, text: null };
  }
  const after = readTextSnapshot(targetFile, "authorized target after change");
  if (!after.snapshot.bytes.equals(expectedBytes)) throw new Error("Authorized target bytes do not match the requested content after change.");
  return after;
}

function assertMeasuredAfterState(after, targetFile, operation) {
  if (operation === "delete") {
    if (fs.existsSync(targetFile)) throw new Error("Authorized target reappeared after deletion; change evidence was not committed.");
    return;
  }
  assertStableFile(after.snapshot, "authorized target before change evidence commit");
}

function rollbackMutation({ operation, targetFile, before, requestedBytes }) {
  const requestedSha256 = requestedBytes ? sha256Bytes(requestedBytes) : null;
  if (operation === "create") {
    if (!fs.existsSync(targetFile)) return;
    const current = readTextSnapshot(targetFile, "created target during rollback");
    if (current.snapshot.sha256 !== requestedSha256) throw new Error("Created target no longer matches the transaction bytes.");
    assertStableFile(current.snapshot, "created target during rollback");
    fs.unlinkSync(targetFile);
    if (fs.existsSync(targetFile)) throw new Error("Created target remained after rollback.");
    return;
  }
  if (operation === "modify") {
    const current = readTextSnapshot(targetFile, "modified target during rollback");
    if (current.snapshot.sha256 === before.snapshot.sha256) return;
    if (current.snapshot.sha256 !== requestedSha256) throw new Error("Modified target no longer matches either the before state or transaction bytes.");
    const temporary = path.join(path.dirname(targetFile), `.${path.basename(targetFile)}.a11y-rollback-${crypto.randomBytes(8).toString("hex")}`);
    try {
      writeBytesExclusive(temporary, before.snapshot.bytes);
      assertStableFile(current.snapshot, "modified target immediately before rollback");
      fs.renameSync(temporary, targetFile);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    const restored = readStableFile(targetFile, { label: "restored modified target" });
    if (restored.sha256 !== before.snapshot.sha256) throw new Error("Modified target rollback hash mismatch.");
    return;
  }
  if (fs.existsSync(targetFile)) {
    const current = readTextSnapshot(targetFile, "deleted target during rollback");
    if (current.snapshot.sha256 === before.snapshot.sha256) return;
    throw new Error("Deleted target path was replaced before rollback.");
  }
  writeBytesExclusive(targetFile, before.snapshot.bytes);
  const restored = readStableFile(targetFile, { label: "restored deleted target" });
  if (restored.sha256 !== before.snapshot.sha256) throw new Error("Deleted target rollback hash mismatch.");
}

function removeExactGeneratedFile(snapshot, label) {
  if (!snapshot || !fs.existsSync(snapshot.path)) return;
  assertStableFile(snapshot, label);
  fs.unlinkSync(snapshot.path);
}

function sameFileObject(left, right) {
  return left?.identity?.dev === right?.identity?.dev && left?.identity?.ino === right?.identity?.ino;
}

function changeEnvelope({ params, authorization, authorizationSnapshot, remediation, lease, before, after, diffSha256, commandResults, createdAt }) {
  const payload = {
    schema_version: "2.0.0",
    change_id: randomId("CHANGE", createdAt),
    run_id: authorization.payload.run_id,
    authorization_id: authorization.payload.authorization_id,
    authorization_artifact: { artifact_id: authorization.artifact_id, sha256: authorizationSnapshot.sha256 },
    changed_files: [{
      path: params.target,
      operation: params.operation,
      before_sha256: before.snapshot?.sha256 ?? null,
      after_sha256: after.snapshot?.sha256 ?? null,
      description: params.description
    }],
    diff_sha256: diffSha256,
    command_results: commandResults,
    lease: {
      lease_id: lease.lease_id,
      source_root_sha256: lease.source_root_sha256,
      acquired_at: lease.acquired_at,
      expires_at: lease.expires_at,
      recovery: lease.recovery
    },
    next_status: "retest_required"
  };
  return {
    schema_version: "1.0.0",
    artifact_id: randomId("ART-CHANGE", createdAt),
    artifact_type: "change-record",
    run_id: authorization.payload.run_id,
    producer: { role_id: "authorized_fixer", producer_kind: "ai_agent", origin: "local_authorized_fix_runtime" },
    created_at: timestamp(createdAt),
    inputs: [
      { artifact_id: remediation.artifact_id, run_id: authorization.payload.run_id, sha256: remediation.sha256 },
      { artifact_id: authorization.artifact_id, run_id: authorization.payload.run_id, sha256: authorizationSnapshot.sha256 }
    ],
    payload
  };
}

export function applyAuthorizedFix(params = {}) {
  validateInputs(params);
  const authorizationInput = parseStableJson(params.authorizationFile, "fix authorization");
  const runInput = parseStableJson(params.runFile, "audit run");
  const runValidation = validateAuditRun(runInput.value, { runFile: runInput.snapshot.path });
  if (!runValidation.valid) throw new Error(`Audit run validation failed:\n- ${runValidation.errors.join("\n- ")}`);
  if (runInput.value.schema_version !== "4.0.0") throw new Error("Authorized fixes require audit-run 4.0.0.");
  const artifactRoot = artifactRootFor(runInput.value, runInput.snapshot.path);
  const canonicalSourceRoot = inspectDirectory(params.sourceRoot, "trusted source root");
  if (pathsOverlap(artifactRoot, canonicalSourceRoot)) throw new Error("Run artifact root must be outside and must not overlap the trusted source root.");
  if (pathsOverlap(path.resolve(params.lockDir ?? DEFAULT_FIX_LEASE_DIRECTORY), artifactRoot)) throw new Error("Fix lease directory must be outside and must not overlap the run artifact root.");
  if (pathsOverlap(DEFAULT_FIX_CONSUMPTION_LEDGER_DIRECTORY, canonicalSourceRoot) || pathsOverlap(DEFAULT_FIX_CONSUMPTION_LEDGER_DIRECTORY, artifactRoot)) {
    throw new Error("Global fix consumption ledger must be outside and must not overlap source or run artifact roots.");
  }
  const globalConsumption = globalConsumptionMarkerPath({
    authorizationSha256: authorizationInput.snapshot.sha256,
    sourceRoot: canonicalSourceRoot,
    runId: runInput.value.run_id
  });
  assertGlobalNotConsumed(globalConsumption);
  const markerPath = assertNotConsumed(artifactRoot, authorizationInput.snapshot.sha256);
  const output = directNewArtifactOutput(params.output, artifactRoot, "change-record output");
  const parsedOutput = path.parse(output);
  const diffOutput = directNewArtifactOutput(path.join(parsedOutput.dir, `${parsedOutput.name}.diff.json`), artifactRoot, "diff output");
  const stagingOutput = directNewArtifactOutput(
    path.join(parsedOutput.dir, `.${parsedOutput.name}.${authorizationInput.snapshot.sha256.slice(0, 16)}.pending-change-record.json`),
    artifactRoot,
    "pending change-record staging output"
  );
  revalidateAuthorization(params, authorizationInput.value, runInput.value, runInput.snapshot);
  const content = params.contentFile ? readTextSnapshot(params.contentFile, "authorized replacement content") : null;
  if (content && samePath(content.snapshot.path, path.resolve(params.sourceRoot))) throw new Error("Replacement content must not be the source root.");
  const changeBinding = exactAuthorizedChange(params, authorizationInput.value);
  assertRequestedHashes(changeBinding, params, content);

  let lease = null;
  let released = false;
  let leaseReleaseAttempted = false;
  let before = null;
  let after = null;
  const mutationState = { started: false };
  let parentChain = null;
  let evidenceCommitted = false;
  let diffSnapshot = null;
  let stagingSnapshot = null;
  try {
    lease = acquireFixLease({
      authorization: authorizationInput.value,
      authorizationSha256: authorizationInput.snapshot.sha256,
      sourceRoot: params.sourceRoot,
      lockDir: params.lockDir ?? DEFAULT_FIX_LEASE_DIRECTORY,
      runId: runInput.value.run_id
    });
    assertStableFile(authorizationInput.snapshot, "fix authorization");
    assertStableFile(runInput.snapshot, "audit run");
    if (content) assertStableFile(content.snapshot, "authorized replacement content");
    revalidateAuthorization(params, authorizationInput.value, runInput.value, runInput.snapshot);
    before = stableTargetSnapshot(params.sourceRoot, params.target, params.operation);
    parentChain = captureTargetParentChain(params.sourceRoot, before.absolute);
    assertMeasuredHashes(changeBinding, before, { snapshot: content?.snapshot ?? null });
    if (params.operation !== "create" && before.snapshot.sha256 !== params.expectedBeforeSha256) {
      throw new Error(`Pre-change SHA-256 mismatch: expected ${params.expectedBeforeSha256}, measured ${before.snapshot.sha256}.`);
    }
    if (params.operation === "modify" && before.snapshot.sha256 === content.snapshot.sha256) {
      throw new Error("Authorized modify must change the target bytes; before and after SHA-256 values would be identical.");
    }

    const consumptionRecord = {
      schema_version: "1.0.0",
      authorization_artifact_id: authorizationInput.value.artifact_id,
      authorization_sha256: authorizationInput.snapshot.sha256,
      run_id: runInput.value.run_id,
      lease_id: lease.lease_id,
      operation: params.operation,
      path: params.target,
      before_sha256: before.snapshot?.sha256 ?? null,
      before_base64: before.snapshot?.bytes.toString("base64") ?? null,
      requested_after_sha256: content?.snapshot.sha256 ?? null,
      consumed_at: timestamp(new Date())
    };
    claimGlobalConsumption(globalConsumption, consumptionRecord);
    consumptionDirectory(artifactRoot);
    writeNewJson(markerPath, consumptionRecord);

    applyMutation({
      operation: params.operation,
      targetState: before,
      contentSnapshot: content?.snapshot,
      authorization: authorizationInput.value,
      run: runInput.value,
      runSnapshot: runInput.snapshot,
      params,
      parentChain,
      mutationState
    });
    after = measuredAfterState(before.absolute, params.operation, content?.snapshot.bytes);
    assertMeasuredHashes(changeBinding, before, after);
    params.hooks?.afterMutation?.({ before, after, targetFile: before.absolute });
    assertMeasuredAfterState(after, before.absolute, params.operation);
    assertMeasuredHashes(changeBinding, before, after);
    const diff = {
      schema_version: "1.0.0",
      run_id: runInput.value.run_id,
      authorization_id: authorizationInput.value.payload.authorization_id,
      path: params.target,
      operation: params.operation,
      before: before.snapshot ? { sha256: before.snapshot.sha256, text: before.text } : null,
      after: after.snapshot ? { sha256: after.snapshot.sha256, text: after.text } : null
    };
    writeNewJson(diffOutput, diff);
    diffSnapshot = readStableFile(diffOutput, { label: "authorized change diff" });
    const commandResults = executeAuthorizedVerificationCommands({
      authorization: authorizationInput.value,
      commandIds: params.commandIds,
      sourceRoot: params.sourceRoot,
      now: params.now
    });
    const remediation = authorizationInput.value.payload.remediation_artifact;
    const createdAt = typeof params.now === "function" ? params.now() : new Date();
    const envelope = changeEnvelope({
      params,
      authorization: authorizationInput.value,
      authorizationSnapshot: authorizationInput.snapshot,
      remediation,
      lease,
      before,
      after,
      diffSha256: diffSnapshot.sha256,
      commandResults,
      createdAt
    });
    const resources = loadAuditResources();
    const artifactValidation = validateArtifact(envelope, resources, { allowedPayloadVersions: resources.currentPayloadVersions });
    if (!artifactValidation.valid) throw new Error(`Generated change record is invalid:\n- ${artifactValidation.errors.join("\n- ")}`);
    assertStableFile(authorizationInput.snapshot, "fix authorization before evidence commit");
    assertStableFile(runInput.snapshot, "audit run before evidence commit");
    assertMeasuredAfterState(after, before.absolute, params.operation);
    writeNewJson(stagingOutput, envelope);
    stagingSnapshot = readStableFile(stagingOutput, { label: "pending change record" });
    assertMeasuredAfterState(after, before.absolute, params.operation);
    leaseReleaseAttempted = true;
    releaseFixLease({
      receipt: lease,
      runId: runInput.value.run_id,
      authorizationSha256: authorizationInput.snapshot.sha256,
      hooks: params.hooks?.lease ?? {}
    });
    released = true;
    assertMeasuredAfterState(after, before.absolute, params.operation);
    assertStableFile(stagingSnapshot, "pending change record before publication");
    params.hooks?.beforeEvidencePublish?.({ stagingOutput, output });
    fs.linkSync(stagingOutput, output);
    let outputSnapshot;
    try {
      outputSnapshot = readStableFile(output, { label: "published change record" });
      const linkedStagingSnapshot = readStableFile(stagingOutput, { label: "linked pending change record" });
      if (!sameFileObject(outputSnapshot, linkedStagingSnapshot)
          || outputSnapshot.sha256 !== stagingSnapshot.sha256
          || !outputSnapshot.bytes.equals(stagingSnapshot.bytes)
          || linkedStagingSnapshot.sha256 !== stagingSnapshot.sha256
          || !linkedStagingSnapshot.bytes.equals(stagingSnapshot.bytes)) {
        throw new Error("Published change record does not match the staged evidence bytes.");
      }
      assertMeasuredAfterState(after, before.absolute, params.operation);
      fs.unlinkSync(stagingOutput);
      outputSnapshot = readStableFile(output, { label: "published change record after staging cleanup" });
      if (outputSnapshot.sha256 !== stagingSnapshot.sha256 || !outputSnapshot.bytes.equals(stagingSnapshot.bytes)) {
        throw new Error("Published change record changed during staging cleanup.");
      }
    } catch (error) {
      if (fs.existsSync(output)) {
        const candidate = readStableFile(output, { label: "failed published change record" });
        const stagedCandidate = fs.existsSync(stagingOutput)
          ? readStableFile(stagingOutput, { label: "failed pending change record" })
          : null;
        if (stagedCandidate
            && sameFileObject(candidate, stagedCandidate)
            && candidate.sha256 === stagingSnapshot.sha256
            && candidate.bytes.equals(stagingSnapshot.bytes)) {
          fs.unlinkSync(output);
        } else if (!stagedCandidate
            && candidate.sha256 === stagingSnapshot.sha256
            && candidate.bytes.equals(stagingSnapshot.bytes)) {
          fs.linkSync(output, stagingOutput);
          fs.unlinkSync(output);
        }
      }
      throw error;
    }
    evidenceCommitted = true;
    return {
      artifact: envelope,
      output,
      diffOutput,
      consumptionMarker: markerPath,
      globalConsumptionMarker: globalConsumption.markerPath
    };
  } catch (error) {
    if (mutationState.started && !evidenceCommitted && !leaseReleaseAttempted && before) {
      try {
        assertTargetParentChain(parentChain);
        rollbackMutation({
          operation: params.operation,
          targetFile: before.absolute,
          before,
          requestedBytes: content?.snapshot.bytes ?? null
        });
        removeExactGeneratedFile(diffSnapshot, "failed transaction diff");
        removeExactGeneratedFile(stagingSnapshot, "failed pending change record");
      } catch (rollbackError) {
        throw new Error(`${error.message}; rollback failed and the lease was retained for manual reconciliation: ${rollbackError.message}`);
      }
    }
    if (lease && !released && !leaseReleaseAttempted) {
      try {
        releaseFixLease({ receipt: lease, runId: runInput.value.run_id, authorizationSha256: authorizationInput.snapshot.sha256 });
      } catch (releaseError) {
        throw new Error(`${error.message}; lease release after transaction failure also failed: ${releaseError.message}`);
      }
    }
    throw error;
  }
}
