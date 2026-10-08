// Audit-run control plane. Run creation, target binding and artifact registration live here; the rest is split by
// concern and re-exported below so existing importers keep one stable entry point:
//   safe-file-io.mjs                file safety, stable reads, no-overwrite writes, hashing (leaf)
//   orchestration-contracts.mjs     pinned manifest contracts and registry semantics
//   audit-resources.mjs             loading and hash-checking the bundled reference resources
//   audit-artifact-validation.mjs   artifact envelopes, role bindings and candidate checks
//   audit-run-validation.mjs        whole-run validation
//   audit-run-merge.mjs             merging registered artifacts into an assessment
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createInspectionRequest } from "./inspection-request.mjs";
import { compareInstants } from "./date-time.mjs";
import { interactionPolicyErrors } from "./interaction-policy.mjs";
import { networkPolicyErrors } from "./network-policy.mjs";
import { afterChangeRun } from "./declared-change.mjs";
import { collectFixExecutionEvidence } from "./fix-execution-evidence.mjs";
import { targetInventoryErrors, targetBindingErrors, checkLocalRunTargets, consumeRunTargetCheck, checkRunTargets } from "./run-targets.mjs";
import { pathKey, isWithinPath, hasTraversal, inspectRealComponents, parseJsonBytes, readStableFile, assertStableFile, resolveInside } from "./safe-file-io.mjs";
import { defaultSkillRoot, loadAuditResources } from "./audit-resources.mjs";
import { compareText } from "./text-order.mjs";
import { roleFor, validateArtifact, registeredArtifactPath, canonicalPermissions, remediationPermissionError, validateFixHandoffBinding, validateChangeRecordAuthorizationBinding, assertCurrentOperationalRun } from "./audit-artifact-validation.mjs";
import { validateAuditRun } from "./audit-run-validation.mjs";

export { canonicalJson } from "./canonical-json.mjs";
export { inspectRealComponents, prepareSafeOutputDirectory, assertNewOutputPath, writeNewJson, writeNewText, writeNewBytes, sha256Bytes, sha256File, readStableFile, assertStableFile, resolveInside } from "./safe-file-io.mjs";
export { loadAuditResources, defaultSkillRoot } from "./audit-resources.mjs";
export { validateArtifact, validateArtifactCandidate, validateHumanReviewCandidate } from "./audit-artifact-validation.mjs";
export { validateAuditRun } from "./audit-run-validation.mjs";
export { mergeArtifacts } from "./audit-run-merge.mjs";

function normalizePermission(value, aliases, name) {
  const normalized = aliases[value];
  if (!normalized) throw new Error(`Unsupported ${name} permission: ${String(value)}`);
  return normalized;
}

export function createAuditRun(options) {
  const skillRoot = options.skillRoot ?? defaultSkillRoot;
  const resources = loadAuditResources(skillRoot);
  if (!options.runFile) throw new Error("runFile is required");
  const runFile = path.resolve(options.runFile);
  const artifactRoot = inspectRealComponents(options.artifactRoot, { type: "directory", label: "artifact root" }).absolute;
  const relativeRoot = path.relative(path.dirname(runFile), artifactRoot);
  if (!relativeRoot || path.isAbsolute(relativeRoot) || hasTraversal(relativeRoot)) {
    throw new Error("Unsafe output/artifact_root relationship: artifact_root must be inside the run manifest directory so the manifest can store a safe relative path.");
  }
  const profile = resources.standardsRegistry.profiles.find((item) => item.id === options.profile);
  if (!profile?.assessment_configuration?.active) throw new Error(`Unknown or inactive profile: ${String(options.profile)}`);
  const targetRefs = [...new Set(options.targetRefs ?? [])].sort(compareText);
  if (!targetRefs.length) throw new Error("At least one target reference is required.");
  const network = normalizePermission(options.network, { local_read_only: "allowlisted", allowlisted: "allowlisted", none: "denied", denied: "denied" }, "network");
  const interaction = normalizePermission(options.interaction, { safe_read_only: "read_only", read_only: "read_only", human_supervised: "human_supervised" }, "interaction");
  const sourceWrite = normalizePermission(options.sourceWrite, { none: "denied", denied: "denied", authorized_only: "authorized_only" }, "source-write");
  if (options.supersedesRunId && !options.supersedesRun) throw new Error("A naked supersedesRunId is not accepted; provide a validated supersedes run file.");
  const networkPolicy = options.networkPolicy ?? null;
  if (network === "allowlisted") {
    const errors = networkPolicyErrors(networkPolicy);
    if (errors.length) throw new Error(`--network allowlisted requires an explicit valid --network-policy file:\n- ${errors.join("\n- ")}`);
  } else if (networkPolicy !== null) throw new Error("Denied network mode requires a null network policy.");
  const interactionPolicy = options.interactionPolicy ?? null;
  if (interaction === "human_supervised") {
    const errors = interactionPolicyErrors(interactionPolicy, targetRefs);
    if (errors.length) throw new Error(`human_supervised requires an explicit valid --interaction-policy file:\n- ${errors.join("\n- ")}`);
  } else if (interactionPolicy !== null) throw new Error("Read-only interaction requires a null policy.");
  const permissions = canonicalPermissions({ network, network_policy: networkPolicy, interaction, interaction_policy: interactionPolicy, source_write: sourceWrite });
  const run = {
    schema_version: resources.auditRunSchema.properties.schema_version.const,
    run_id: options.runId,
    supersedes_run_id: options.supersedesRun?.run_id ?? null,
    status: "initialized",
    target: { name: options.targetName, version_or_commit: options.targetVersion, urls_or_files: targetRefs },
    target_inventory: null,
    profile: { id: profile.id, registry_version: resources.standardsRegistry.schema_version },
    scope: structuredClone(options.scope ?? options.supersedesRun?.scope ?? { included: targetRefs, excluded: [], complete_processes: [], third_party_content: [], full_pages_reviewed: false }),
    environment: structuredClone(options.environment ?? options.supersedesRun?.environment ?? { os: ["not_declared"], browsers: [], assistive_technologies: [], input_modes: [] }),
    inspection_request: createInspectionRequest(
      options.inspectionMode ?? options.supersedesRun?.inspection_request?.mode,
      options.inspectionPurpose ?? options.supersedesRun?.inspection_request?.purpose
    ),
    permissions,
    resource_versions: resources.resourceVersions,
    artifact_root: relativeRoot.split(path.sep).join("/"),
    artifacts: [],
    history: [],
    limitations: options.environment ? ["No profile outcome has been recorded."] : ["The environment was not declared; no profile outcome has been recorded."]
  };
  if (options.supersedesRun) {
    if (!options.supersedesRunFile) throw new Error("supersedesRunFile is required for fresh retest initialization.");
    const predecessorValidation = validateAuditRun(options.supersedesRun, { skillRoot, runFile: options.supersedesRunFile });
    if (!predecessorValidation.valid) throw new Error(`Invalid superseded audit run:\n- ${predecessorValidation.errors.join("\n- ")}`);
    if (!["5.0.0", "6.0.0", "7.0.0", "8.0.0", "9.0.0", "10.0.0", "11.0.0", "12.0.0", "13.0.0", "14.0.0", "15.0.0", "16.0.0", "17.0.0"].includes(options.supersedesRun.schema_version)) {
      throw new Error("Fresh retest predecessor must use supported audit-run schema_version 5.0.0 through 17.0.0.");
    }
    if (options.supersedesRun.status !== "retest_required") throw new Error("Fresh retest predecessor status must be retest_required.");
    if (run.run_id === options.supersedesRun.run_id) throw new Error("Fresh retest run ID must differ from the predecessor run ID.");
    if (sourceWrite !== "denied") throw new Error("Fresh retest source-write permission must be denied.");
    if (fs.readdirSync(artifactRoot).length !== 0) throw new Error("Fresh retest artifact root must be empty.");
    const oldRoot = predecessorValidation.artifactRoot;
    const rootsOverlap = isWithinPath(oldRoot, artifactRoot) || isWithinPath(artifactRoot, oldRoot);
    if (rootsOverlap) throw new Error("Fresh retest artifact root must differ from and not overlap the predecessor artifact root.");
    if (run.target.name !== options.supersedesRun.target.name) throw new Error("Fresh retest target name must match the predecessor.");
    if (run.target.version_or_commit === options.supersedesRun.target.version_or_commit) throw new Error("Fresh retest target version must change from the predecessor.");
    const declaredChange = options.supersedesRun.artifacts.find((entry) => entry.artifact_type === "declared-change-record");
    if (declaredChange) {
      const declaration = predecessorValidation.envelopesById.get(declaredChange.artifact_id)?.envelope;
      if (run.target.version_or_commit !== declaration?.payload?.after_version) {
        throw new Error("Fresh retest target version must match the registered declared change.");
      }
    }
    if (!isDeepStrictEqual(run.target.urls_or_files, options.supersedesRun.target.urls_or_files)) throw new Error("Fresh retest target references must match the predecessor.");
    if (!isDeepStrictEqual(run.profile, options.supersedesRun.profile)) throw new Error("Fresh retest profile must match the predecessor.");
    if (!isDeepStrictEqual(run.scope, options.supersedesRun.scope)) throw new Error("Fresh retest scope must match the predecessor.");
    if (options.supersedesRun.inspection_request && !isDeepStrictEqual(run.inspection_request, options.supersedesRun.inspection_request)) {
      throw new Error("Fresh retest inspection request must match the predecessor; start a separate inspection to change its level or purpose.");
    }
  }
  const validation = validateAuditRun(run, { skillRoot, runFile });
  if (!validation.valid) throw new Error(`Invalid initialized audit run:\n- ${validation.errors.join("\n- ")}`);
  return run;
}

function assertValidRun(run, options) {
  const validation = validateAuditRun(run, options);
  if (!validation.valid) throw new Error(`Invalid audit run:\n- ${validation.errors.join("\n- ")}`);
  return validation;
}

export function bindTargetInventory(run, inventory, options = {}) {
  const validation = assertValidRun(run, options);
  assertCurrentOperationalRun(run, validation.resources, "Target binding");
  if (run.status !== "initialized" || run.artifacts.length || run.history.length || run.target_inventory !== null) {
    throw new Error("Targets can only be bound once to an initialized run before any artifact is registered; start a fresh run to change targets.");
  }
  const errors = targetInventoryErrors(inventory, run);
  if (errors.length) throw new Error(`Invalid target inventory:\n- ${errors.join("\n- ")}`);
  const check = options.targetCheck ?? checkLocalRunTargets(run, inventory, { baseDir: path.dirname(path.resolve(options.runFile)) });
  consumeRunTargetCheck(check, run, inventory);
  const next = { ...structuredClone(run), target_inventory: structuredClone(inventory) };
  const nextValidation = validateAuditRun(next, options);
  if (!nextValidation.valid) throw new Error(`Invalid bound run:\n- ${nextValidation.errors.join("\n- ")}`);
  return next;
}

export async function registerArtifactChecked(run, artifact, options = {}) {
  const validation = assertValidRun(run, options);
  assertCurrentOperationalRun(run, validation.resources, "Artifact registration");
  const artifactFile = resolveInside(validation.artifactRoot, options.artifactFile);
  const snapshot = readStableFile(artifactFile);
  const installed = parseJsonBytes(snapshot.bytes, "artifact file");
  if (artifact !== undefined && !isDeepStrictEqual(artifact, installed)) throw new Error("Artifact object does not match the exact artifact file bytes.");
  if (installed.run_id !== run.run_id) throw new Error(`Artifact must belong to the same run: ${installed.run_id}`);
  const errors = [...validateArtifact(installed, validation.resources, { allowedPayloadVersions: validation.resources.currentPayloadVersions }).errors,
    ...targetBindingErrors(run, [installed])];
  if (errors.length) throw new Error(`Invalid artifact:\n- ${errors.join("\n- ")}`);
  const afterRun = installed.artifact_type === "declared-change-record" ? afterChangeRun(run, installed.payload.after_version) : null;
  const afterTargetCheck = afterRun ? await checkRunTargets(afterRun, installed.payload.after_target_inventory,
    { baseDir: path.dirname(path.resolve(options.runFile)), networkPolicy: options.networkPolicy, onNetworkEvidence: options.onNetworkEvidence }) : undefined;
  const targetCheck = run.target_inventory && !["change-record", "declared-change-record"].includes(installed.artifact_type)
    ? await checkRunTargets(run, run.target_inventory, { baseDir: path.dirname(path.resolve(options.runFile)), networkPolicy: options.networkPolicy, onNetworkEvidence: options.onNetworkEvidence }) : undefined;
  assertStableFile(snapshot, "artifact file");
  return registerArtifact(run, installed, { ...options, targetCheck, afterTargetCheck });
}

export function registerArtifact(run, artifact, options = {}) {
  const skillRoot = options.skillRoot ?? defaultSkillRoot;
  if (!options.runFile || !options.artifactFile) throw new Error("runFile and artifactFile are required for registration");
  const validation = assertValidRun(run, { skillRoot, runFile: options.runFile });
  assertCurrentOperationalRun(run, validation.resources, "Artifact registration");
  const artifactPath = resolveInside(validation.artifactRoot, options.artifactFile);
  const relativePath = path.relative(validation.artifactRoot, artifactPath).split(path.sep).join("/");
  const relativeSegments = relativePath.split("/");
  if (relativeSegments.includes(".fix-consumption") || relativeSegments.some((segment) => segment.includes("pending-change-record"))) {
    throw new Error(`Internal fixer runtime evidence is not registerable as a completed artifact: ${relativePath}`);
  }
  if (run.artifacts.some((entry) => pathKey(registeredArtifactPath(validation.artifactRoot, entry)) === pathKey(artifactPath))) {
    throw new Error(`Duplicate artifact path: ${relativePath}`);
  }
  const snapshot = readStableFile(artifactPath, { label: "artifact file" });
  const installedArtifact = parseJsonBytes(snapshot.bytes, "artifact file");
  if (artifact !== undefined && !isDeepStrictEqual(artifact, installedArtifact)) throw new Error("Artifact object does not match the exact artifact file bytes.");
  const artifactValidation = validateArtifact(installedArtifact, validation.resources, {
    allowedPayloadVersions: validation.resources.currentPayloadVersions
  });
  if (!artifactValidation.valid) throw new Error(`Invalid artifact:\n- ${artifactValidation.errors.join("\n- ")}`);
  const permissionError = remediationPermissionError(run, [installedArtifact]);
  if (permissionError) throw new Error(permissionError);
  if (installedArtifact.run_id !== run.run_id) throw new Error(`Artifact must belong to the same run: ${installedArtifact.run_id}`);
  if (run.artifacts.some((entry) => entry.artifact_id === installedArtifact.artifact_id)) throw new Error(`Duplicate artifact ID: ${installedArtifact.artifact_id}`);
  const artifactsById = new Map(run.artifacts.map((entry) => [entry.artifact_id, entry]));
  const role = roleFor(validation.resources, installedArtifact.producer.role_id);
  const allowedInputTypes = new Set(role.input_types);
  for (const input of installedArtifact.inputs) {
    if (input.run_id !== run.run_id) throw new Error(`Artifact input must belong to the same run: ${input.artifact_id}`);
    const registered = artifactsById.get(input.artifact_id);
    if (!registered) throw new Error(`Artifact input is missing or not registered: ${input.artifact_id}`);
    if (registered.sha256 !== input.sha256) throw new Error(`Artifact input SHA-256 hash mismatch: ${input.artifact_id}`);
    if (!allowedInputTypes.has(registered.artifact_type)) throw new Error(`Producer role ${role.id} does not allow input type ${registered.artifact_type}`);
  }
  const authorizationBindingErrors = [];
  validateFixHandoffBinding(installedArtifact, artifactsById, validation.envelopesById, authorizationBindingErrors);
  validateChangeRecordAuthorizationBinding(installedArtifact, artifactsById, validation.envelopesById, authorizationBindingErrors);
  if (authorizationBindingErrors.length > 0) {
    throw new Error(`Invalid change-record authorization binding:\n- ${authorizationBindingErrors.join("\n- ")}`);
  }
  if (installedArtifact.artifact_type === "change-record" && installedArtifact.payload.schema_version === "3.0.0") {
    const fixEvidence = collectFixExecutionEvidence(run, [
      ...[...validation.envelopesById.values()].map(({ envelope, snapshot: prior }) => ({ envelope, sha256: prior.sha256 })),
      { envelope: installedArtifact, sha256: snapshot.sha256 }
    ], readStableFile, { artifactRoot: validation.artifactRoot, requireGlobal: true });
    if (fixEvidence.errors.length) throw new Error(`Invalid fix execution evidence:\n- ${fixEvidence.errors.join("\n- ")}`);
    for (const evidenceSnapshot of fixEvidence.snapshots.values()) assertStableFile(evidenceSnapshot, "fix execution receipt");
  }
  const outgoing = validation.resources.orchestrationRegistry.transitions.filter((transition) => transition.from === run.status && transition.required_artifact_types.includes(installedArtifact.artifact_type));
  const targetErrors = targetBindingErrors(run, [installedArtifact]);
  if (targetErrors.length) throw new Error(`Invalid artifact target binding:\n- ${targetErrors.join("\n- ")}`);
  const incomingCurrent = validation.resources.orchestrationRegistry.transitions.some((transition) => transition.to === run.status && transition.required_artifact_types.includes(installedArtifact.artifact_type));
  if (outgoing.length > 1) throw new Error(`Ambiguous transition for ${run.status} and ${installedArtifact.artifact_type}`);
  const supplementalContext = (["audit-context", "participant-usability-observation"].includes(installedArtifact.artifact_type)
    && run.status !== "retest_required") || (installedArtifact.artifact_type === "fix-handoff" && run.status === "fix_authorized");
  if (outgoing.length === 0 && !incomingCurrent && !supplementalContext) throw new Error(`Artifact type ${installedArtifact.artifact_type} is a future or invalid transition from ${run.status}`);
  const lastHistoryAt = run.history.at(-1)?.at;
  if (lastHistoryAt && compareInstants(installedArtifact.created_at, lastHistoryAt) < 0) throw new Error("Artifact created_at precedes the current run state.");
  if (installedArtifact.artifact_type === "declared-change-record") {
    const afterRun = afterChangeRun(run, installedArtifact.payload.after_version);
    const check = options.afterTargetCheck ?? checkLocalRunTargets(afterRun, installedArtifact.payload.after_target_inventory,
      { baseDir: path.dirname(path.resolve(options.runFile)) });
    consumeRunTargetCheck(check, afterRun, installedArtifact.payload.after_target_inventory);
  } else if (run.target_inventory && installedArtifact.artifact_type !== "change-record") {
    const check = options.targetCheck ?? checkLocalRunTargets(run, run.target_inventory, { baseDir: path.dirname(path.resolve(options.runFile)) });
    consumeRunTargetCheck(check, run, run.target_inventory);
  }
  const entry = {
    artifact_id: installedArtifact.artifact_id,
    artifact_type: installedArtifact.artifact_type,
    path: relativePath,
    sha256: snapshot.sha256,
    producer_role: installedArtifact.producer.role_id,
    created_at: installedArtifact.created_at,
    validation_status: "valid"
  };
  const next = structuredClone(run);
  next.artifacts.push(entry);
  next.artifacts.sort((left, right) => compareText(left.artifact_id, right.artifact_id));
  if (outgoing.length === 1) {
    const transition = outgoing[0];
    next.status = transition.to;
    next.history.push({
      from: transition.from,
      to: transition.to,
      at: installedArtifact.created_at,
      actor_role: installedArtifact.producer.role_id,
      artifact_ids: [installedArtifact.artifact_id]
    });
  }
  assertStableFile(snapshot, "artifact file");
  const nextValidation = validateAuditRun(next, { skillRoot, runFile: options.runFile });
  if (!nextValidation.valid) throw new Error(`Registered run is invalid:\n- ${nextValidation.errors.join("\n- ")}`);
  assertStableFile(snapshot, "artifact file");
  for (const { snapshot: registeredSnapshot } of nextValidation.envelopesById.values()) assertStableFile(registeredSnapshot, "registered artifact");
  for (const evidenceSnapshot of nextValidation.evidenceSnapshots.values()) assertStableFile(evidenceSnapshot, "raw evidence");
  return next;
}
