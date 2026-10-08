import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { lookupRequirement } from "../show-requirement.mjs";
import { resolveCriterionProcedure } from "./criterion-procedure-resolution.mjs";
import { queueContextErrors } from "./human-review-queue.mjs";
import { screeningMappings } from "./review-details.mjs";
import { validateJsonSchema } from "./json-schema.mjs";
import { inspectionRequestErrors } from "./inspection-request.mjs";
import { remediationPlanItems, findingRelationErrors, declaredFindings, declaredFindingErrors } from "./run-findings.mjs";
import { reviewEntries, resolveHumanReviews } from "./human-review-consensus.mjs";
import { compareInstants } from "./date-time.mjs";
import { interactionPolicyErrors } from "./interaction-policy.mjs";
import { networkPolicyErrors } from "./network-policy.mjs";
import { collectScreeningEvidence } from "./run-evidence.mjs";
import { validateContextBindings, collectContextEvidence } from "./audit-context.mjs";
import { validateParticipantBindings, collectParticipantEvidence } from "./participant-observation.mjs";
import { validateDeclaredChangeBindings, collectDeclaredChangeEvidence } from "./declared-change.mjs";
import { targetBindingErrors } from "./run-targets.mjs";
import { pathKey, hasTraversal, isInside, inspectRealComponents, readStableFile, resolveInside } from "./safe-file-io.mjs";
import { compareText } from "./text-order.mjs";
import { loadAuditResources } from "./audit-resources.mjs";

export function artifactRootFor(run, runFile) {
  if (!runFile) throw new Error("runFile is required to resolve artifact_root");
  if (typeof run?.artifact_root !== "string" || path.isAbsolute(run.artifact_root)
      || path.win32.isAbsolute(run.artifact_root) || /^[A-Za-z]:/u.test(run.artifact_root) || hasTraversal(run.artifact_root)) {
    throw new Error(`artifact_root must be a traversal-free relative path: ${String(run?.artifact_root)}`);
  }
  const parent = path.dirname(path.resolve(runFile));
  const resolved = path.resolve(parent, run.artifact_root);
  if (pathKey(parent) !== pathKey(resolved) && !isInside(parent, resolved)) throw new Error("artifact_root must stay inside the run directory.");
  return inspectRealComponents(resolved, {
    type: "directory",
    label: "artifact root"
  }).absolute;
}

export function roleFor(resources, roleId) {
  return resources.orchestrationRegistry.roles.find((role) => role.id === roleId);
}

function containsProfileOutcome(value) {
  if (Array.isArray(value)) return value.some(containsProfileOutcome);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(([key, item]) => key === "profile_outcome" || containsProfileOutcome(item));
  }
  return false;
}

const evidenceLevelRank = new Map([
  ["E0", 0],
  ["E1", 1],
  ["E2", 2],
  ["E3", 3],
  ["E4", 4],
  ["E5", 5]
]);

function evidenceLevelViolations(value, maximum, location = "$.payload") {
  const violations = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => violations.push(...evidenceLevelViolations(item, maximum, `${location}[${index}]`)));
    return violations;
  }
  if (value === null || typeof value !== "object") return violations;
  for (const [key, item] of Object.entries(value)) {
    const itemLocation = `${location}.${key}`;
    if (key === "evidence_level"
        && (!evidenceLevelRank.has(item) || evidenceLevelRank.get(item) > evidenceLevelRank.get(maximum))) {
      violations.push(`${itemLocation}=${String(item)}`);
    }
    violations.push(...evidenceLevelViolations(item, maximum, itemLocation));
  }
  return violations;
}

export function validateArtifact(artifact, resources = loadAuditResources(), { allowedPayloadVersions, envelopeSchema } = {}) {
  const errors = [];
  validateJsonSchema(artifact, envelopeSchema ?? resources.envelopeSchema, "$", errors);
  const payloadVersion = artifact?.payload?.schema_version;
  const payloadSchema = resources.payloadSchemas.get(artifact?.artifact_type)?.get(payloadVersion);
  if (!resources.payloadSchemas.has(artifact?.artifact_type)) {
    errors.push(`Unknown or unsupported artifact type: ${String(artifact?.artifact_type)}`);
  } else if (!payloadSchema) {
    errors.push(`Unsupported ${String(artifact?.artifact_type)} payload schema_version: ${String(payloadVersion)}.`);
  } else {
    validateJsonSchema(artifact?.payload, payloadSchema, "$.payload", errors);
  }
  const commandRecords = artifact?.artifact_type === "fix-authorization" && payloadVersion === "2.0.0"
    ? artifact?.payload?.verification_commands
    : artifact?.artifact_type === "change-record" && ["2.0.0", "3.0.0"].includes(payloadVersion)
      ? artifact?.payload?.command_results
      : undefined;
  if (Array.isArray(commandRecords)) {
    const commandIds = commandRecords.map((command) => command?.command_id);
    if (new Set(commandIds).size !== commandIds.length) errors.push(`${String(artifact.artifact_type)} command_id values must be unique.`);
  }
  if (artifact?.artifact_type === "change-record" && ["2.0.0", "3.0.0"].includes(payloadVersion) && Array.isArray(artifact?.payload?.changed_files)) {
    const changedPaths = artifact.payload.changed_files.map((changedFile) => changedFile?.path);
    if (new Set(changedPaths).size !== changedPaths.length) errors.push("change-record changed_files path values must be unique.");
  }
  const allowedPayloadVersion = allowedPayloadVersions?.get(artifact?.artifact_type);
  if (allowedPayloadVersion && payloadVersion !== allowedPayloadVersion) {
    errors.push(`${String(artifact?.artifact_type)} payload schema_version must be ${allowedPayloadVersion} for this orchestration registry; received ${String(payloadVersion)}.`);
  }
  const role = roleFor(resources, artifact?.producer?.role_id);
  if (!role) errors.push(`Unknown producer role: ${String(artifact?.producer?.role_id)}`);
  else {
    if (role.producer_kind !== artifact.producer?.producer_kind) errors.push(`Producer kind does not match role ${role.id}.`);
    if (role.output_type !== artifact.artifact_type) errors.push(`Producer role ${role.id} cannot output ${String(artifact.artifact_type)}.`);
    if (!role.can_record_profile_outcome && containsProfileOutcome(artifact.payload)) {
      errors.push(`Producer role ${role.id} cannot record a profile outcome.`);
    }
    if (role.producer_kind === "ai_agent") {
      for (const violation of evidenceLevelViolations(artifact.payload, role.max_ai_evidence_level)) {
        errors.push(`Producer role ${role.id} evidence ${violation} exceeds ${role.max_ai_evidence_level}.`);
      }
    }
    if (role.producer_kind === "ai_agent" && artifact.artifact_type === "fix-authorization") {
      errors.push("AI roles cannot produce fix-authorization; declared_authorizer is required.");
    }
  }
  const inputIds = artifact?.inputs?.map((input) => input.artifact_id) ?? [];
  if (new Set(inputIds).size !== inputIds.length) errors.push("Artifact input artifact IDs must be unique.");
  if (artifact?.artifact_type === "screening-observations" && payloadVersion === "4.0.0" && Array.isArray(artifact.payload.observations)) {
    const ids = artifact.payload.observations.map((item) => item?.requirement_id);
    if (new Set(ids).size !== ids.length) errors.push("Screening observation IDs must be unique.");
    for (const observation of artifact.payload.observations) {
      const ids = Array.isArray(observation?.profile_mappings) ? observation.profile_mappings.map((mapping) => mapping?.requirement_id) : [];
      if (new Set(ids).size !== ids.length) errors.push("Screening profile mapping requirement IDs must be unique per observation.");
    }
  }
  return { valid: errors.length === 0, errors };
}

export function registeredArtifactPath(root, entry) {
  if (typeof entry?.path !== "string" || path.isAbsolute(entry.path) || hasTraversal(entry.path)) {
    throw new Error(`Registered artifact path must be relative and traversal-free: ${String(entry?.path)}`);
  }
  return resolveInside(root, path.join(root, ...entry.path.split("/")));
}

export function canonicalPermissions(permissions) {
  const network = permissions?.network;
  const interaction = permissions?.interaction;
  const sourceWrite = permissions?.source_write;
  if (!["denied", "allowlisted"].includes(network)
      || !["read_only", "human_supervised"].includes(interaction)
      || !["denied", "authorized_only"].includes(sourceWrite)) return null;
  const allowedActions = ["inspect_without_mutation"];
  if (network === "allowlisted") allowedActions.push("read_allowlisted_resources");
  if (interaction === "human_supervised") allowedActions.push("human_supervised_interaction");
  if (sourceWrite === "authorized_only") {
    allowedActions.push("write_authorized_files", "execute_authorized_verification_commands");
  }
  const commandExecution = sourceWrite === "authorized_only" ? "authorized_verification_only" : "denied";
  const forbiddenActions = [sourceWrite === "authorized_only" ? "execute_unapproved_commands" : "execute_commands"];
  if (network === "allowlisted") forbiddenActions.push("network_outside_allowlist");
  else forbiddenActions.push("network_access");
  if (sourceWrite === "denied") forbiddenActions.push("write_target");
  const concreteInteraction = Object.hasOwn(permissions, "interaction_policy");
  if (concreteInteraction && (interaction === "read_only" ? permissions.interaction_policy !== null : interactionPolicyErrors(permissions.interaction_policy).length > 0)) return null;
  const concreteNetwork = Object.hasOwn(permissions, "network_policy");
  if (concreteNetwork && (network === "denied" ? permissions.network_policy !== null : networkPolicyErrors(permissions.network_policy).length > 0)) return null;
  return {
    network,
    ...(concreteNetwork ? { network_policy: structuredClone(permissions.network_policy) } : {}),
    interaction,
    ...(concreteInteraction ? { interaction_policy: structuredClone(permissions.interaction_policy) } : {}),
    source_write: sourceWrite,
    command_execution: commandExecution,
    allowed_actions: allowedActions.sort(compareText),
    forbidden_actions: forbiddenActions.sort(compareText)
  };
}

const remediationArtifactTypes = new Set(["fix-authorization", "fix-handoff", "change-record"]);

export function remediationPermissionError(run, artifacts) {
  if (!artifacts.some((artifact) => remediationArtifactTypes.has(artifact?.artifact_type))) return null;
  if (run?.permissions?.source_write === "authorized_only"
      && run?.permissions?.command_execution === "authorized_verification_only") return null;
  return "fix-authorization, fix-handoff and change-record artifacts require permissions.source_write authorized_only and permissions.command_execution authorized_verification_only.";
}

function normalizedArtifactPath(value) {
  if (typeof value !== "string") return String(value);
  return path.posix.normalize(value.replace(/\\/gu, "/"));
}

export function validateRegisteredArtifactEntries(run, errors, { requireNormalizedPaths = true } = {}) {
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const artifactIds = new Set();
  const artifactPaths = new Set();
  const artifactsById = new Map();
  for (const [index, entry] of artifacts.entries()) {
    const location = `artifacts[${index}]`;
    if (entry?.validation_status !== "valid") errors.push(`${location}.validation_status must be valid for a registered artifact.`);
    if (artifactIds.has(entry?.artifact_id)) errors.push(`Duplicate artifact ID: ${String(entry?.artifact_id)}.`);
    artifactIds.add(entry?.artifact_id);
    if (!artifactsById.has(entry?.artifact_id)) artifactsById.set(entry?.artifact_id, entry);
    const normalizedPath = normalizedArtifactPath(entry?.path);
    if (requireNormalizedPaths && entry?.path !== normalizedPath) errors.push(`${location}.path must be normalized with forward slashes and no redundant segments: ${String(entry?.path)}.`);
    const normalizedPathKey = process.platform === "win32" ? normalizedPath.toLowerCase() : normalizedPath;
    if (artifactPaths.has(normalizedPathKey)) errors.push(`Duplicate normalized artifact path: ${normalizedPath}.`);
    artifactPaths.add(normalizedPathKey);
  }
  const sortedIds = [...artifacts]
    .sort((left, right) => compareText(String(left?.artifact_id), String(right?.artifact_id)))
    .map((entry) => entry?.artifact_id);
  if (!isDeepStrictEqual(artifacts.map((entry) => entry?.artifact_id), sortedIds)) errors.push("Run artifacts must be sorted by artifact_id.");
  return artifactsById;
}

function envelopeFromRecord(record) {
  return record?.envelope ?? record;
}

export function validateFixHandoffBinding(handoff, artifactsById, envelopesById, errors) {
  if (handoff?.artifact_type !== "fix-handoff") return;
  const payload = handoff.payload ?? {}, authorizationRef = payload.authorization_artifact ?? {};
  const entry = artifactsById.get(authorizationRef.artifact_id);
  const authorization = envelopeFromRecord(envelopesById.get(authorizationRef.artifact_id));
  if (entry?.artifact_type !== "fix-authorization" || authorization?.artifact_type !== "fix-authorization"
      || entry.sha256 !== authorizationRef.sha256) {
    errors.push("fix-handoff requires a registered exact fix-authorization input.");
    return;
  }
  const remediationRef = payload.remediation_artifact ?? {};
  const remediation = artifactsById.get(remediationRef.artifact_id);
  if (remediation?.artifact_type !== "remediation-plan" || remediation.sha256 !== remediationRef.sha256
      || !isDeepStrictEqual(remediationRef, authorization.payload?.remediation_artifact)) {
    errors.push("fix-handoff remediation must match the authorized registered plan.");
  }
  for (const ref of [authorizationRef, remediationRef]) {
    const matching = (handoff.inputs ?? []).filter((input) => input.artifact_id === ref.artifact_id && input.sha256 === ref.sha256);
    if (matching.length !== 1) errors.push(`fix-handoff must include exact input ${String(ref.artifact_id)}.`);
  }
  if ((handoff.inputs ?? []).length !== 2 || payload.run_id !== handoff.run_id
      || payload.run_id !== authorization.payload?.run_id
      || payload.source_root !== authorization.payload?.source_root
      || compareInstants(handoff.created_at, authorization.payload?.approved_at) < 0) {
    errors.push("fix-handoff run, source root, time and input set must match authorization.");
  }
  const binding = (authorization.payload?.change_bindings ?? []).find((item) =>
    item.path === payload.target && item.operation === payload.operation
    && item.expected_before_sha256 === payload.expected_before_sha256
    && item.expected_after_sha256 === payload.expected_after_sha256);
  if (!binding) errors.push("fix-handoff must select one exact authorized change binding.");
  const allowedCommands = new Set((authorization.payload?.verification_commands ?? []).map((item) => item.command_id));
  if (!payload.command_ids?.length || payload.command_ids.some((id) => !allowedCommands.has(id))) {
    errors.push("fix-handoff command IDs must be authorized verification commands.");
  }
}

export function validateChangeRecordAuthorizationBinding(changeRecord, artifactsById, envelopesById, errors) {
  if (changeRecord?.artifact_type !== "change-record") return;
  const payload = changeRecord.payload ?? {};
  const authorizationRef = payload.authorization_artifact ?? {};
  const authorizationEntry = artifactsById.get(authorizationRef.artifact_id);
  const authorization = envelopeFromRecord(envelopesById.get(authorizationRef.artifact_id));
  if (!authorizationEntry || authorizationEntry.artifact_type !== "fix-authorization" || authorization?.artifact_type !== "fix-authorization") {
    errors.push("change-record authorization_artifact must reference a registered fix-authorization artifact.");
    return;
  }
  if (authorizationEntry.sha256 !== authorizationRef.sha256) {
    errors.push("change-record authorization_artifact SHA-256 must match the registered fix-authorization artifact.");
  }
  const authorizationInput = (Array.isArray(changeRecord.inputs) ? changeRecord.inputs : []).filter((input) => input?.artifact_id === authorizationRef.artifact_id);
  if (authorizationInput.length !== 1 || authorizationInput[0]?.sha256 !== authorizationRef.sha256) {
    errors.push("change-record must contain exactly one input matching authorization_artifact by ID and SHA-256.");
  }
  if (payload.authorization_id !== authorization.payload?.authorization_id) {
    errors.push("change-record authorization_id must match the referenced fix authorization.");
  }
  const bindings = Array.isArray(authorization.payload?.change_bindings) ? authorization.payload.change_bindings : [];
  for (const [index, changedFile] of (Array.isArray(payload.changed_files) ? payload.changed_files : []).entries()) {
    const exact = bindings.some((binding) => binding?.path === changedFile?.path
      && binding?.operation === changedFile?.operation
      && binding?.expected_before_sha256 === changedFile?.before_sha256
      && binding?.expected_after_sha256 === changedFile?.after_sha256);
    if (!exact) errors.push(`change-record changed_files[${index}] does not match an exact authorization change binding.`);
  }
  const authorizedCommands = new Map((Array.isArray(authorization.payload?.verification_commands)
    ? authorization.payload.verification_commands
    : []).map((command) => [command?.command_id, command]));
  for (const [index, result] of (Array.isArray(payload.command_results) ? payload.command_results : []).entries()) {
    const authorized = authorizedCommands.get(result?.command_id);
    if (!authorized) {
      errors.push(`change-record command_results[${index}] is not an authorized verification command ID.`);
    } else if (result?.executable !== authorized.executable
        || result?.cwd !== authorized.cwd
        || !isDeepStrictEqual(result?.args, authorized.args)) {
      errors.push(`change-record command_results[${index}] executable, args, and cwd must match the authorized verification command.`);
    }
  }
  if (payload.schema_version === "3.0.0") {
    const handoffRef = payload.handoff_artifact ?? {};
    const entry = artifactsById.get(handoffRef.artifact_id);
    const handoff = envelopeFromRecord(envelopesById.get(handoffRef.artifact_id));
    if (entry?.artifact_type !== "fix-handoff" || handoff?.artifact_type !== "fix-handoff"
        || entry.sha256 !== handoffRef.sha256) {
      errors.push("change-record requires an exact registered fix-handoff.");
      return;
    }
    const handoffInputs = (changeRecord.inputs ?? []).filter((input) =>
      input.artifact_id === handoffRef.artifact_id && input.sha256 === handoffRef.sha256);
    if (handoffInputs.length !== 1 || (changeRecord.inputs ?? []).length !== 3
        || !isDeepStrictEqual(handoff.payload.authorization_artifact, authorizationRef)
        || !isDeepStrictEqual(handoff.payload.remediation_artifact, authorization.payload?.remediation_artifact)) {
      errors.push("change-record input set and handoff must match its authorization and plan.");
    }
    const changed = payload.changed_files ?? [];
    if (changed.length !== 1 || changed[0]?.path !== handoff.payload.target
        || changed[0]?.operation !== handoff.payload.operation
        || changed[0]?.before_sha256 !== handoff.payload.expected_before_sha256
        || changed[0]?.after_sha256 !== handoff.payload.expected_after_sha256
        || changed[0]?.description !== handoff.payload.description
        || !isDeepStrictEqual((payload.command_results ?? []).map((item) => item.command_id), handoff.payload.command_ids)) {
      errors.push("change-record measured change and commands must match the registered handoff.");
    }
    if (compareInstants(payload.execution.started_at, handoff.created_at) < 0
        || compareInstants(payload.execution.completed_at, payload.execution.started_at) < 0
        || compareInstants(changeRecord.created_at, payload.execution.completed_at) < 0) {
      errors.push("change-record execution times must follow handoff and remain ordered.");
    }
  }
}

export function validateArtifactEnvelopeSemantics(run, resources, artifactsById, envelopesById, errors) {
  for (const [artifactId, record] of envelopesById) {
    const artifact = record?.envelope ?? record;
    const entry = artifactsById.get(artifactId);
    if (!entry) continue;
    if (artifact?.artifact_id !== entry.artifact_id
        || artifact?.artifact_type !== entry.artifact_type
        || artifact?.producer?.role_id !== entry.producer_role
        || artifact?.created_at !== entry.created_at) {
      errors.push(`Registered artifact metadata does not match its envelope: ${String(artifactId)}.`);
    }
    if (artifact?.run_id !== run?.run_id) errors.push(`Registered artifact belongs to another run: ${String(artifactId)}.`);
    const role = roleFor(resources, artifact?.producer?.role_id);
    const allowedInputTypes = new Set(role?.input_types ?? []);
    for (const input of Array.isArray(artifact?.inputs) ? artifact.inputs : []) {
      if (input?.run_id !== run?.run_id) errors.push(`Artifact input must belong to the same run: ${artifactId} -> ${String(input?.artifact_id)}.`);
      const registered = artifactsById.get(input?.artifact_id);
      if (!registered) {
        errors.push(`Artifact input is missing or not registered: ${artifactId} -> ${String(input?.artifact_id)}.`);
        continue;
      }
      if (registered.sha256 !== input?.sha256) errors.push(`Artifact input SHA-256 hash mismatch: ${artifactId} -> ${String(input?.artifact_id)}.`);
      if (!allowedInputTypes.has(registered.artifact_type)) errors.push(`Producer role ${String(role?.id)} does not allow input type ${registered.artifact_type}.`);
      if (compareInstants(registered.created_at, artifact?.created_at) > 0) errors.push(`Artifact input was created after its consumer: ${artifactId} -> ${String(input?.artifact_id)}.`);
    }
    validateFixHandoffBinding(artifact, artifactsById, envelopesById, errors);
    validateChangeRecordAuthorizationBinding(artifact, artifactsById, envelopesById, errors);
  }
}

export function assertCurrentOperationalRun(run, resources, operation) {
  const errors = [];
  const runRecord = run !== null && typeof run === "object" && !Array.isArray(run) ? run : {};
  const latestSchemaVersion = resources?.auditRunSchema?.properties?.schema_version?.const;
  if (typeof latestSchemaVersion !== "string") {
    errors.push("The installed latest audit-run schema_version is unavailable.");
  } else if (runRecord.schema_version !== latestSchemaVersion) {
    errors.push(`schema_version must be the installed latest version ${latestSchemaVersion}; received ${String(runRecord.schema_version)}.`);
  }
  if (!resources?.auditRunSchema || typeof resources.auditRunSchema !== "object") {
    errors.push("The installed latest audit-run schema is unavailable.");
  } else {
    validateJsonSchema(run, resources.auditRunSchema, "$", errors);
  }
  if (!resources?.resourceVersions || !isDeepStrictEqual(runRecord.resource_versions, resources.resourceVersions)) {
    errors.push("resource_versions must exactly match every installed current resource version and SHA-256 hash, including orchestration_registry_sha256.");
  }
  const profile = resources?.standardsRegistry?.profiles?.find((item) => item.id === runRecord.profile?.id);
  if (!profile?.assessment_configuration?.active) {
    errors.push(`Run profile must be a known active profile: ${String(runRecord.profile?.id)}.`);
  }
  if (runRecord.profile?.registry_version !== resources?.standardsRegistry?.schema_version) {
    errors.push(`profile.registry_version must match the installed standards registry version ${String(resources?.standardsRegistry?.schema_version)}.`);
  }
  if (runRecord.permissions?.interaction_policy) errors.push(...interactionPolicyErrors(runRecord.permissions.interaction_policy, runRecord.target?.urls_or_files));
  const expectedPermissions = canonicalPermissions(runRecord.permissions);
  if (!expectedPermissions || !isDeepStrictEqual(runRecord.permissions, expectedPermissions)) {
    errors.push("permissions must exactly match the canonical command_execution, allowed_actions, and forbidden_actions for network, interaction, and source_write.");
  }
  errors.push(...inspectionRequestErrors(runRecord.inspection_request));
  if (errors.length) {
    throw new Error(`${operation} requires the latest audit-run schema_version ${String(latestSchemaVersion)}. Legacy and other non-latest audit runs are read-only; no implicit upgrade is performed.\n- ${errors.join("\n- ")}`);
  }
}

function normalizedStrings(values) {
  return Array.isArray(values) ? [...values].sort(compareText) : [];
}

function exactStringSet(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected)
    && isDeepStrictEqual(normalizedStrings(actual), normalizedStrings(expected));
}

function profileCatalogRecord(requirementId, profileId, resources) {
  const profile = resources.standardsRegistry.profiles.find((item) => item.id === profileId);
  for (const key of profile?.assessment_configuration?.catalog_keys ?? []) {
    const record = resources.criteriaCatalog.catalogs[key]?.find((item) => item.id === requirementId);
    if (record) return record;
  }
  return null;
}

export function validateHumanQueueBindings(envelopesById, profileId, resources, errors, run) {
  if (!errors.length) errors.push(...queueContextErrors(run, envelopesById, resources.standardsRegistry.profiles.find((profile) => profile.id === profileId)?.requirement_ids ?? []));
  for (const [artifactId, record] of envelopesById) {
    const artifact = record?.envelope ?? record;
    if (artifact?.artifact_type !== "human-review-queue") continue;
    const items = Array.isArray(artifact.payload?.items) ? artifact.payload.items : [];
    const coverage = artifact.payload?.procedure_coverage ?? {};
    const available = items.filter((item) => item?.procedure_availability === "available").length;
    const unavailable = items.filter((item) => item?.procedure_availability === "unavailable").length;
    if (coverage.total_requirements !== items.length
        || coverage.available_procedures !== available
        || coverage.unavailable_procedures !== unavailable
        || items.length !== available + unavailable) {
      errors.push(`Human review queue ${artifactId} procedure coverage must exactly equal its item, available, and unavailable counts.`);
    }
    const seen = new Set();
    for (const item of items) {
      const requirementId = item?.requirement_id;
      if (seen.has(requirementId)) {
        errors.push(`Human review queue ${artifactId} contains a duplicate requirement: ${String(requirementId)}.`);
        continue;
      }
      seen.add(requirementId);
      let lookup;
      try {
        lookup = lookupRequirement(profileId, requirementId, resources.skillRoot);
      } catch (error) {
        errors.push(`Human review queue ${artifactId} requirement is not registered for profile ${String(profileId)}: ${String(requirementId)} (${error.message}).`);
        continue;
      }
      const actualBinding = {
        procedure_availability: item.procedure_availability,
        procedure_ref: item.procedure_ref,
        generic_method_ref: item.generic_method_ref,
        official_sources: item.official_sources,
        human_actions: item.human_actions,
        required_evidence_types: item.required_evidence_types,
        cant_tell_conditions: item.cant_tell_conditions
      };
      if (!isDeepStrictEqual(actualBinding, lookup.procedure_binding)) {
        errors.push(`Human review queue ${artifactId} binding must exactly match lookup version ${lookup.lookup_version} for ${requirementId}.`);
      }
    }
  }
}

export function validateScreeningProfileBindings(run, envelopesById, resources, errors) {
  if (!["12.0.0", "13.0.0", "14.0.0", "15.0.0", "16.0.0", "17.0.0"].includes(run.schema_version) || errors.length) return;
  const profileIds = new Set(resources.standardsRegistry.profiles.find((profile) => profile.id === run.profile.id).requirement_ids);
  const observedIds = new Set();
  for (const record of envelopesById.values()) {
    const artifact = record?.envelope ?? record;
    if (artifact.artifact_type !== "screening-observations") continue;
    for (const observation of artifact.payload.observations) {
      if (observedIds.has(observation.requirement_id)) errors.push(`Duplicate screening observation ID in this run: ${observation.requirement_id}.`);
      observedIds.add(observation.requirement_id);
      for (const mapping of screeningMappings(observation)) {
        if (!profileIds.has(mapping.requirement_id)) errors.push(`Screening mapping is not a requirement of this run's profile: ${mapping.requirement_id}.`);
      }
    }
  }
}

export function validateScreeningQueueCoverage(envelopesById, errors) {
  for (const [screeningId, record] of envelopesById) {
    const screening = record?.envelope ?? record;
    if (screening?.artifact_type !== "screening-observations") continue;
    const mappedRequirementIds = new Set((screening.payload?.observations ?? [])
      .filter((observation) => observation?.signal_class)
      .flatMap((observation) => screeningMappings(observation).map((mapping) => mapping.requirement_id))
      .filter((requirementId) => typeof requirementId === "string"));
    if (mappedRequirementIds.size === 0) continue;

    const queuedRequirementIds = new Set();
    for (const queueRecord of envelopesById.values()) {
      const queue = queueRecord?.envelope ?? queueRecord;
      if (queue?.artifact_type !== "human-review-queue") continue;
      if (!(queue.inputs ?? []).some((input) => input?.artifact_id === screeningId)) continue;
      for (const item of queue.payload?.items ?? []) queuedRequirementIds.add(item?.requirement_id);
    }
    for (const requirementId of mappedRequirementIds) {
      if (!queuedRequirementIds.has(requirementId)) {
        errors.push(`Screening observation ${screeningId} mapped to ${requirementId} must be routed through an input-linked human-review-queue; an automated signal or no-signal observation is never a profile result.`);
      }
    }
  }
}

export function validateDeclaredHumanBindings(envelopesById, profileId, resources, errors) {
  if (!errors.length) {
    const sources = [...envelopesById.values()].map((record) => record?.envelope ?? record)
      .filter((artifact) => artifact.artifact_type === "declared-human-review");
    if (sources.some((artifact) => artifact.payload.schema_version === "3.0.0")) {
      try { resolveHumanReviews(reviewEntries(sources.map((artifact) => ({ payload: artifact.payload, artifact_id: artifact.artifact_id, recorded_at: artifact.created_at })))); }
      catch (error) { errors.push(error.message); }
    }
  }
  for (const [artifactId, record] of envelopesById) {
    const artifact = record?.envelope ?? record;
    if (artifact?.artifact_type !== "declared-human-review") continue;
    const queuedItems = new Map();
    for (const input of Array.isArray(artifact.inputs) ? artifact.inputs : []) {
      const queueRecord = envelopesById.get(input?.artifact_id);
      const queue = queueRecord?.envelope ?? queueRecord;
      if (queue?.artifact_type !== "human-review-queue") {
        errors.push(`Declared human review ${artifactId} must reference a registered human-review-queue input: ${String(input?.artifact_id)}.`);
        continue;
      }
      for (const item of Array.isArray(queue.payload?.items) ? queue.payload.items : []) {
        if (queuedItems.has(item?.requirement_id)) {
          errors.push(`Declared human review ${artifactId} has an ambiguous duplicate queued requirement: ${String(item?.requirement_id)}.`);
        } else {
          queuedItems.set(item?.requirement_id, item);
        }
      }
    }
    const reviewed = new Set();
    for (const review of Array.isArray(artifact.payload?.reviews) ? artifact.payload.reviews : []) {
      const requirementId = review?.requirement_id;
      if (declaredFindings(review).length && review.profile_outcome !== "fail") {
        errors.push(`Declared human review ${artifactId} finding requires profile_outcome fail for ${requirementId}.`);
      }
      if (reviewed.has(requirementId)) errors.push(`Declared human review ${artifactId} repeats queued requirement ${String(requirementId)}.`);
      reviewed.add(requirementId);
      errors.push(...declaredFindingErrors([review]));
      const queueItem = queuedItems.get(requirementId);
      if (!queueItem) {
        errors.push(`Declared human review ${artifactId} requirement was not queued by its registered inputs: ${String(requirementId)}.`);
        continue;
      }
      if (review.procedure_availability !== queueItem.procedure_availability) {
        errors.push(`Declared human review ${artifactId} procedure_availability does not match its queue for ${requirementId}.`);
      }
      if (review.criterion_procedure_ref !== queueItem.procedure_ref) {
        errors.push(`Declared human review ${artifactId} criterion_procedure_ref does not match its queue procedure_ref for ${requirementId}.`);
      }
      const catalog = profileCatalogRecord(requirementId, profileId, resources);
      if (!catalog) {
        errors.push(`Declared human review ${artifactId} requirement is not registered in profile ${String(profileId)}: ${String(requirementId)}.`);
        continue;
      }
      const { procedure, officialSources } = resolveCriterionProcedure(catalog, resources.criterionProcedures);
      const requiredEvidenceTypes = new Set(queueItem.required_evidence_types ?? []);
      if (procedure) {
        const expectedProcedureRef = `criterion-procedures:${resources.criterionProcedures.schema_version}#${procedure.id}`;
        if (queueItem.procedure_availability !== "available" || queueItem.procedure_ref !== expectedProcedureRef
            || review.procedure_availability !== "available" || review.criterion_procedure_ref !== expectedProcedureRef) {
          errors.push(`Declared human review ${artifactId} must use the current registered procedure ${expectedProcedureRef} for ${requirementId}.`);
        }
        if (review.generic_method_ref !== null) errors.push(`Declared human review ${artifactId} generic_method_ref must be null when a criterion procedure is available for ${requirementId}.`);
        if (!exactStringSet(review.official_sources, officialSources)) {
          errors.push(`Declared human review ${artifactId} official_sources must exactly match the registered official sources for ${requirementId}.`);
        }
        for (const evidenceType of procedure.required_evidence_types ?? []) requiredEvidenceTypes.add(evidenceType);
      } else {
        if (queueItem.procedure_availability !== "unavailable" || queueItem.procedure_ref !== null
            || review.procedure_availability !== "unavailable" || review.criterion_procedure_ref !== null) {
          errors.push(`Declared human review ${artifactId} must preserve unavailable procedure status from its queue for ${requirementId}.`);
        }
        const expectedGenericMethod = expectedMethodRef(requirementId, resources, profileId);
        if (review.generic_method_ref !== expectedGenericMethod) {
          errors.push(`Declared human review ${artifactId} generic_method_ref must use the current generic method ${expectedGenericMethod} for ${requirementId}.`);
        }
        if (!exactStringSet(review.official_sources, catalog.official_method_sources)) {
          errors.push(`Declared human review ${artifactId} official_sources must exactly match the current catalog sources for ${requirementId}.`);
        }
      }
      const evidenceTypes = new Set((review.target_specific_evidence ?? []).map((item) => item?.type));
      // Current run 11 may explicitly record non-performance without inventing
      // keyboard/browser/AT results. Frozen run 10 keeps its original checks.
      if (["10.0.0", "11.0.0", "12.0.0", "13.0.0", "14.0.0", "15.0.0", "16.0.0", "17.0.0"].includes(resources.orchestrationRegistry.schema_version) && review.profile_outcome === "not_tested") {
        requiredEvidenceTypes.clear();
        requiredEvidenceTypes.add("manual_observation");
        if ([...evidenceTypes].some((type) => type !== "manual_observation")) errors.push(`Declared human review ${artifactId} not_tested accepts only manual_observation non-performance notes for ${requirementId}.`);
      }
      for (const requiredType of requiredEvidenceTypes) {
        if (!evidenceTypes.has(requiredType)) {
          errors.push(`Declared human review ${artifactId} is missing required evidence type ${requiredType} for ${requirementId}.`);
        }
      }
    }
  }
}

function artifactEnvelopeFromRecord(record) {
  return record?.envelope ?? record;
}

// Validates a new candidate without writing a temporary artifact.
// Registration still performs the live target check and immutable file binding.
export function validateArtifactCandidate(run, artifact, validation) {
  const resources = validation.resources;
  const errors = [...validation.errors, ...validateArtifact(artifact, resources, { allowedPayloadVersions: resources.currentPayloadVersions }).errors];
  try { assertCurrentOperationalRun(run, resources, "Artifact authoring"); } catch (error) { errors.push(error.message); }
  if (run.artifacts.some((entry) => entry.artifact_id === artifact?.artifact_id)) errors.push("Duplicate artifact ID.");
  if (errors.length) return { valid: false, errors };
  const permissionError = remediationPermissionError(run, [artifact]);
  if (permissionError) errors.push(permissionError);
  const outgoing = resources.orchestrationRegistry.transitions.filter((transition) => transition.from === run.status && transition.required_artifact_types.includes(artifact.artifact_type));
  const incoming = resources.orchestrationRegistry.transitions.some((transition) => transition.to === run.status && transition.required_artifact_types.includes(artifact.artifact_type));
  const supplementalContext = (["audit-context", "participant-usability-observation"].includes(artifact.artifact_type)
    && run.status !== "retest_required") || (artifact.artifact_type === "fix-handoff" && run.status === "fix_authorized");
  if (outgoing.length > 1 || (!outgoing.length && !incoming && !supplementalContext)) errors.push(`Artifact type ${artifact.artifact_type} is not registerable from ${run.status}.`);
  if (run.history.at(-1)?.at && compareInstants(artifact.created_at, run.history.at(-1).at) < 0) errors.push("Artifact created_at precedes the current run state.");
  const envelopes = new Map([...validation.envelopesById, [artifact.artifact_id, artifact]]);
  const entries = new Map(run.artifacts.map((entry) => [entry.artifact_id, entry]));
  entries.set(artifact.artifact_id, { artifact_id: artifact.artifact_id, artifact_type: artifact.artifact_type,
    producer_role: artifact.producer.role_id, created_at: artifact.created_at });
  validateArtifactEnvelopeSemantics(run, resources, entries, envelopes, errors);
  validateScreeningProfileBindings(run, envelopes, resources, errors);
  validateHumanQueueBindings(envelopes, run.profile.id, resources, errors, run);
  validateDeclaredHumanBindings(envelopes, run.profile.id, resources, errors);
  validateRemediationBindings(envelopes, errors);
  validateContextBindings(envelopes, errors);
  validateParticipantBindings(envelopes, errors);
  validateDeclaredChangeBindings(run, envelopes, errors);
  errors.push(...targetBindingErrors(run, [artifact]));
  const reader = (relativePath) => readStableFile(resolveInside(validation.artifactRoot, path.join(validation.artifactRoot, ...relativePath.split("/"))));
  const evidence = errors.length ? { errors: [], snapshots: new Map() } : collectScreeningEvidence(run, [artifact], reader);
  const contextEvidence = errors.length ? { errors: [], snapshots: new Map() } : collectContextEvidence(run, [artifact], reader);
  const participantEvidence = errors.length ? { errors: [], snapshots: new Map() } : collectParticipantEvidence(run, [artifact], reader);
  const changeEvidence = errors.length ? { errors: [], snapshots: new Map() } : collectDeclaredChangeEvidence(run, [artifact], reader);
  errors.push(...evidence.errors, ...contextEvidence.errors, ...participantEvidence.errors, ...changeEvidence.errors);
  return { valid: errors.length === 0, errors,
    evidenceSnapshots: new Map([...evidence.snapshots, ...contextEvidence.snapshots, ...participantEvidence.snapshots, ...changeEvidence.snapshots]) };
}

export function validateHumanReviewCandidate(run, artifact, validation) {
  if (artifact?.artifact_type !== "declared-human-review") return { valid: false, errors: ["Expected declared-human-review candidate."] };
  return validateArtifactCandidate(run, artifact, validation);
}

export function remediationItems(envelopesById) {
  const items = [];
  for (const [artifactId, record] of envelopesById) {
    const artifact = artifactEnvelopeFromRecord(record);
    if (artifact?.artifact_type !== "remediation-plan") continue;
    for (const item of remediationPlanItems(artifact.payload)) {
      items.push({ artifactId, artifact, item });
    }
  }
  return items.sort((left, right) => compareText(String(left.item?.remediation_id), String(right.item?.remediation_id))
    || compareText(String(left.artifactId), String(right.artifactId)));
}

export function validateRemediationBindings(envelopesById, errors) {
  if (errors.length) return;
  const seenRemediationIds = new Set();
  const seenFindingIds = new Set();
  const envelopes = new Map([...envelopesById].map(([id, record]) => [id, artifactEnvelopeFromRecord(record)]));
  for (const [artifactId, record] of envelopesById) {
    const artifact = artifactEnvelopeFromRecord(record);
    if (artifact?.artifact_type !== "remediation-plan") continue;
    if (Array.isArray(artifact.payload?.findings)) {
      errors.push(...findingRelationErrors(artifact, envelopes));
      for (const finding of artifact.payload.findings) {
        if (seenFindingIds.has(finding.finding_id)) errors.push(`Duplicate finding ID: ${finding.finding_id}.`);
        seenFindingIds.add(finding.finding_id);
      }
      for (const item of artifact.payload.items) {
        if (seenRemediationIds.has(item.remediation_id)) errors.push(`Duplicate remediation ID: ${item.remediation_id}.`);
        seenRemediationIds.add(item.remediation_id);
      }
      continue;
    }
    const inputIds = new Set((Array.isArray(artifact.inputs) ? artifact.inputs : []).map((input) => input?.artifact_id));
    const usedInputIds = new Set();
    for (const item of Array.isArray(artifact.payload?.items) ? artifact.payload.items : []) {
      const remediationId = item?.remediation_id;
      if (seenRemediationIds.has(remediationId)) {
        errors.push(`Duplicate or conflicting remediation ID ${String(remediationId)}.`);
      } else {
        seenRemediationIds.add(remediationId);
      }
      for (const sourceArtifactId of Array.isArray(item?.source_artifact_ids) ? item.source_artifact_ids : []) {
        if (!inputIds.has(sourceArtifactId)) {
          errors.push(`Remediation ${String(remediationId)} source_artifact_ids must name a registered envelope input: ${String(sourceArtifactId)}.`);
          continue;
        }
        usedInputIds.add(sourceArtifactId);
        const source = artifactEnvelopeFromRecord(envelopesById.get(sourceArtifactId));
        if (!source) {
          errors.push(`Remediation ${String(remediationId)} source is missing or not registered: ${String(sourceArtifactId)}.`);
          continue;
        }
        if (source.run_id !== artifact.run_id) {
          errors.push(`Remediation ${String(remediationId)} source must belong to the same run: ${String(sourceArtifactId)}.`);
          continue;
        }
        if (item?.basis === "verified_failure") {
          if (source.artifact_type !== "declared-human-review") {
            errors.push(`Remediation ${String(remediationId)} verified_failure source must be declared-human-review: ${String(sourceArtifactId)}.`);
            continue;
          }
          const matchingFailure = (source.payload?.reviews ?? []).some((review) => review?.requirement_id === item?.requirement_id
            && review?.profile_outcome === "fail");
          if ((source.payload?.reviews ?? []).some((review) => review.requirement_id === item.requirement_id && declaredFindings(review).length > 1)) {
            errors.push(`Multiple human findings require explicit finding_id remediation links: ${String(item.requirement_id)}.`);
          }
          if (!matchingFailure) {
            errors.push(`Remediation ${String(remediationId)} verified_failure requires a matching declared-human-review profile_outcome fail for ${String(item?.requirement_id)}.`);
          }
        } else if (item?.basis === "unverified_screening_candidate") {
          if (source.artifact_type !== "screening-observations") {
            errors.push(`Remediation ${String(remediationId)} unverified screening source must be screening-observations: ${String(sourceArtifactId)}.`);
            continue;
          }
          const matchingObservation = (source.payload?.observations ?? []).some((observation) => observation?.requirement_id === item?.requirement_id);
          if (!matchingObservation) {
            errors.push(`Remediation ${String(remediationId)} requires an exact screening observation for ${String(item?.requirement_id)}.`);
          }
        }
      }
    }
    for (const inputId of inputIds) {
      if (!usedInputIds.has(inputId)) errors.push(`Remediation plan ${String(artifactId)} has an unused evidence input: ${String(inputId)}.`);
    }
  }
}

export function expectedMethodRef(requirementId, resources, profileId) {
  const record = profileCatalogRecord(requirementId, profileId, resources);
  if (!record) throw new Error(`Exact profile row is not registered for declared human review: ${requirementId}`);
  const method = resources.auditMethods.methods.find((item) => item.id === record.method_key);
  if (!method) throw new Error(`No registered audit method for exact profile row: ${requirementId}`);
  return `web-audit-methods:${resources.auditMethods.schema_version}#${method.id}`;
}
