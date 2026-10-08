import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { validateJsonSchema } from "./json-schema.mjs";
import { inspectionRequestErrors } from "./inspection-request.mjs";
import { compareInstants } from "./date-time.mjs";
import { interactionPolicyErrors } from "./interaction-policy.mjs";
import { collectScreeningEvidence } from "./run-evidence.mjs";
import { validateContextBindings, collectContextEvidence } from "./audit-context.mjs";
import { validateParticipantBindings, collectParticipantEvidence } from "./participant-observation.mjs";
import { validateDeclaredChangeBindings, collectDeclaredChangeEvidence } from "./declared-change.mjs";
import { collectFixExecutionEvidence } from "./fix-execution-evidence.mjs";
import { targetBindingErrors } from "./run-targets.mjs";
import { pathKey, parseJsonBytes, readStableFile, resolveInside } from "./safe-file-io.mjs";
import { defaultSkillRoot, loadAuditResources } from "./audit-resources.mjs";
import { auditRunRegistryCompatibility, auditRunEnvelopeCompatibility } from "./orchestration-contracts.mjs";
import { artifactRootFor, validateArtifact, registeredArtifactPath, canonicalPermissions, remediationPermissionError, validateRegisteredArtifactEntries, validateArtifactEnvelopeSemantics, validateHumanQueueBindings, validateScreeningProfileBindings, validateDeclaredHumanBindings, validateRemediationBindings } from "./audit-artifact-validation.mjs";

export function validateHistory(run, resources, artifactsById, errors) {
  let current = "initialized";
  let previousAt = "";
  const representedTypes = new Set();
  const history = Array.isArray(run?.history) ? run.history : [];
  for (const [index, rawEntry] of history.entries()) {
    const entry = rawEntry !== null && typeof rawEntry === "object" ? rawEntry : {};
    const location = `history[${index}]`;
    if (entry.from !== current) errors.push(`${location} continuity error: expected from ${current}, received ${String(entry.from)}.`);
    const transition = resources.orchestrationRegistry.transitions.find((item) => item.from === entry.from && item.to === entry.to);
    if (!transition) errors.push(`${location} contains an invalid transition ${String(entry.from)} -> ${String(entry.to)}.`);
    if (previousAt && compareInstants(entry.at, previousAt) < 0) errors.push(`${location}.at is earlier than the preceding history entry.`);
    previousAt = entry.at ?? previousAt;
    const artifactIds = Array.isArray(entry.artifact_ids) ? entry.artifact_ids : [];
    const referenced = artifactIds.map((id) => artifactsById.get(id));
    for (const [artifactIndex, artifact] of referenced.entries()) {
      if (!artifact) errors.push(`${location}.artifact_ids[${artifactIndex}] is not a registered artifact: ${artifactIds[artifactIndex]}.`);
    }
    if (transition) {
      const actualTypes = new Set(referenced.filter(Boolean).map((artifact) => artifact.artifact_type));
      for (const type of transition.required_artifact_types) {
        if (!actualTypes.has(type)) errors.push(`${location} is missing required registered artifact type ${type}.`);
        representedTypes.add(type);
      }
      for (const type of actualTypes) {
        if (!transition.required_artifact_types.includes(type)) errors.push(`${location} references unexpected artifact type ${type}.`);
      }
    }
    for (const artifact of referenced.filter(Boolean)) {
      if (artifact.producer_role !== entry.actor_role) errors.push(`${location}.actor_role does not match producer ${artifact.producer_role}.`);
      if (compareInstants(artifact.created_at, entry.at) > 0) errors.push(`${location}.at precedes registered artifact ${artifact.artifact_id}.`);
    }
    current = entry.to ?? current;
  }
  if (run?.status !== current) errors.push(`Run status/history continuity error: status is ${String(run?.status)} but history ends at ${current}.`);
  for (const artifact of Array.isArray(run?.artifacts) ? run.artifacts : []) {
    if (!["audit-context", "participant-usability-observation", "fix-handoff"].includes(artifact?.artifact_type)
        && !representedTypes.has(artifact?.artifact_type)) errors.push(`Registered artifact type is not represented by run history: ${String(artifact?.artifact_type)} (${String(artifact?.artifact_id)}).`);
  }
}

export function validateAuditRun(run, { skillRoot = defaultSkillRoot, runFile, readArtifactFile = readStableFile, historicalResourceRoot } = {}) {
  const errors = [];
  const runRecord = run !== null && typeof run === "object" && !Array.isArray(run) ? run : {};
  let resources;
  const historicalResourceSnapshots = [];
  try {
    resources = loadAuditResources(skillRoot);
    if (historicalResourceRoot) {
      const files = [
        ["standardsRegistry", "standards-registry.json", "standards_registry_version"],
        ["criteriaCatalog", "criteria-catalog.json", "criteria_catalog_sha256"],
        ["criterionProcedures", "criterion-procedures.json", "criterion_procedures_sha256"],
        ["auditMethods", "web-audit-methods.json", "audit_methods_sha256"]
      ];
      const historical = {};
      const versions = { ...resources.resourceVersions };
      for (const [key, name, binding] of files) {
        const snapshot = readStableFile(path.join(path.resolve(historicalResourceRoot), "references", name), {
          label: `historical ${name}`, maxBytes: 2 * 1024 * 1024
        });
        historicalResourceSnapshots.push(snapshot);
        const value = parseJsonBytes(snapshot.bytes, `historical ${name}`);
        const actual = binding === "standards_registry_version" ? value?.schema_version : snapshot.sha256;
        if (runRecord.resource_versions?.[binding] !== actual) {
          throw new Error(`Historical ${name} does not match run resource_versions.${binding}.`);
        }
        historical[key] = value;
        versions[binding] = actual;
      }
      resources = { ...resources, ...historical, resourceVersions: versions };
    }
  } catch (error) {
    return { valid: false, errors: [error.message], historicalResourceSnapshots };
  }
  const schema = resources.auditRunSchemas.get(runRecord.schema_version);
  if (!schema) errors.push(`Unsupported audit-run schema_version: ${String(runRecord.schema_version)}.`);
  else validateJsonSchema(run, schema, "$", errors);
  // Invalid paths and malformed collections must not cause artifact I/O before
  // the schema rejection. Bundle verification also supplies a bounded reader.
  if (errors.length) return { valid: false, errors, resources, envelopesById: new Map(), evidenceSnapshots: new Map(), historicalResourceSnapshots };
  const registryVersion = runRecord.resource_versions?.orchestration_registry_version;
  const registryRecord = resources.orchestrationRegistries.get(registryVersion);
  if (!registryRecord) errors.push(`Unsupported orchestration_registry_version: ${String(registryVersion)}.`);
  const runResources = registryRecord
    ? { ...resources, orchestrationRegistry: registryRecord.value }
    : resources;
  const expectedRegistryVersion = auditRunRegistryCompatibility.get(runRecord.schema_version);
  const compatibleRegistryVersions = runRecord.schema_version === "17.0.0"
    ? ["16.0.0", "17.0.0"] : expectedRegistryVersion ? [expectedRegistryVersion] : [];
  if (!compatibleRegistryVersions.length) {
    errors.push(`Unsupported audit-run registry compatibility: ${String(runRecord.schema_version)}.`);
  } else if (!compatibleRegistryVersions.includes(registryVersion)) {
    errors.push(`audit-run ${runRecord.schema_version} requires orchestration registry ${compatibleRegistryVersions.join(" or ")}; received ${String(registryVersion)}.`);
  }
  const expectedResourceVersions = {
    ...resources.resourceVersions,
    orchestration_registry_version: registryRecord?.value.schema_version,
    orchestration_registry_sha256: registryRecord?.sha256
  };
  const resourceVersionRequirements = schema?.properties?.resource_versions?.required ?? [];
  if (!resourceVersionRequirements.includes("orchestration_registry_sha256")) {
    delete expectedResourceVersions.orchestration_registry_sha256;
  }
  for (const [key, expected] of Object.entries(expectedResourceVersions)) {
    if (runRecord.resource_versions?.[key] !== expected) errors.push(`resource_versions.${key} must match the exact installed resource hash or version ${expected}.`);
  }
  const currentSchemaVersion = resources.auditRunSchema.properties.schema_version.const;
  // Run 10 has the same target/permission/human-binding checks; freezing its
  // payload schema must not weaken validation of existing records.
  const usesCurrentPolicy = ["10.0.0", "11.0.0", "12.0.0", "13.0.0", "14.0.0", "15.0.0", "16.0.0", currentSchemaVersion].includes(runRecord.schema_version);
  if (usesCurrentPolicy) {
    errors.push(...inspectionRequestErrors(runRecord.inspection_request));
    const profile = resources.standardsRegistry.profiles.find((item) => item.id === runRecord.profile?.id);
    if (!profile?.assessment_configuration?.active) errors.push(`Run profile must be a known active profile: ${String(runRecord.profile?.id)}.`);
    if (runRecord.profile?.registry_version !== resources.standardsRegistry.schema_version) {
      errors.push(`profile.registry_version must match the installed standards registry version ${resources.standardsRegistry.schema_version}.`);
    }
    if (runRecord.permissions?.interaction_policy) errors.push(...interactionPolicyErrors(runRecord.permissions.interaction_policy, runRecord.target?.urls_or_files));
    const expectedPermissions = canonicalPermissions(runRecord.permissions);
    if (expectedPermissions && !isDeepStrictEqual(runRecord.permissions, expectedPermissions)) {
      errors.push("permissions must exactly match the canonical command_execution, allowed_actions, and forbidden_actions for network, interaction, and source_write.");
    }
  }
  let artifactRoot;
  try {
    artifactRoot = artifactRootFor(runRecord, runFile);
  } catch (error) {
    errors.push(error.message);
  }
  const artifacts = Array.isArray(runRecord.artifacts) ? runRecord.artifacts : [];
  if (usesCurrentPolicy) {
    const permissionError = remediationPermissionError(runRecord, artifacts);
    if (permissionError) errors.push(permissionError);
  }
  const artifactsById = validateRegisteredArtifactEntries(runRecord, errors, { requireNormalizedPaths: usesCurrentPolicy });
  const canonicalArtifactPaths = new Set();
  const envelopesById = new Map();
  for (const [index, entry] of artifacts.entries()) {
    const location = `artifacts[${index}]`;
    if (!artifactRoot) continue;
    try {
      const file = registeredArtifactPath(artifactRoot, entry);
      const canonicalPath = pathKey(file);
      if (canonicalArtifactPaths.has(canonicalPath)) errors.push(`Duplicate canonical artifact path: ${String(entry?.path)}.`);
      canonicalArtifactPaths.add(canonicalPath);
      const snapshot = readArtifactFile(file, { label: `registered artifact ${String(entry?.artifact_id)}` });
      if (snapshot.sha256 !== entry?.sha256) errors.push(`Registered artifact current hash mismatch: ${String(entry?.artifact_id)}.`);
      const envelope = parseJsonBytes(snapshot.bytes, `registered artifact ${String(entry?.artifact_id)}`);
      envelopesById.set(entry?.artifact_id, { envelope, snapshot });
      const envelopeVersion = registryVersion === "17.0.0" ? "4.0.0"
        : auditRunEnvelopeCompatibility.get(runRecord.schema_version);
      const envelopeSchema = resources.envelopeSchemas.get(envelopeVersion);
      if (!envelopeSchema) errors.push(`Unsupported artifact envelope schema for audit-run ${String(runRecord.schema_version)}.`);
      const validation = validateArtifact(envelope, runResources, {
        allowedPayloadVersions: registryRecord?.payloadVersions,
        envelopeSchema
      });
      errors.push(...validation.errors.map((error) => `${location}: ${error}`));
    } catch (error) {
      errors.push(error.message);
    }
  }
  validateArtifactEnvelopeSemantics(runRecord, runResources, artifactsById, envelopesById, errors);
  if (usesCurrentPolicy) {
    validateScreeningProfileBindings(runRecord, envelopesById, runResources, errors);
    validateHumanQueueBindings(envelopesById, runRecord.profile?.id, runResources, errors, runRecord);
    validateDeclaredHumanBindings(envelopesById, runRecord.profile?.id, runResources, errors);
    validateRemediationBindings(envelopesById, errors);
    validateContextBindings(envelopesById, errors);
    validateParticipantBindings(envelopesById, errors);
    validateDeclaredChangeBindings(runRecord, envelopesById, errors);
  }
  validateHistory(runRecord, runResources, artifactsById, errors);
  errors.push(...targetBindingErrors(runRecord, [...envelopesById.values()].map(({ envelope }) => envelope)));
  const evidence = errors.length ? { errors: [], snapshots: new Map() } : collectScreeningEvidence(
    runRecord,
    [...envelopesById.values()].map(({ envelope }) => envelope),
    (relativePath) => readArtifactFile(resolveInside(artifactRoot, path.join(artifactRoot, ...relativePath.split("/"))))
  );
  errors.push(...evidence.errors);
  const contextEvidence = errors.length ? { errors: [], snapshots: new Map() } : collectContextEvidence(
    runRecord,
    [...envelopesById.values()].map(({ envelope }) => envelope),
    (relativePath) => readArtifactFile(resolveInside(artifactRoot, path.join(artifactRoot, ...relativePath.split("/"))))
  );
  errors.push(...contextEvidence.errors);
  const participantEvidence = errors.length ? { errors: [], snapshots: new Map() } : collectParticipantEvidence(
    runRecord,
    [...envelopesById.values()].map(({ envelope }) => envelope),
    (relativePath) => readArtifactFile(resolveInside(artifactRoot, path.join(artifactRoot, ...relativePath.split("/"))))
  );
  errors.push(...participantEvidence.errors);
  const changeEvidence = errors.length ? { errors: [], snapshots: new Map() } : collectDeclaredChangeEvidence(
    runRecord,
    [...envelopesById.values()].map(({ envelope }) => envelope),
    (relativePath) => readArtifactFile(resolveInside(artifactRoot, path.join(artifactRoot, ...relativePath.split("/"))))
  );
  errors.push(...changeEvidence.errors);
  const fixEvidence = errors.length ? { errors: [], snapshots: new Map() } : collectFixExecutionEvidence(
    runRecord,
    [...envelopesById.values()].map(({ envelope, snapshot }) => ({ envelope, sha256: snapshot.sha256 })),
    readArtifactFile,
    { artifactRoot }
  );
  errors.push(...fixEvidence.errors);
  return { valid: errors.length === 0, errors, resources: runResources, artifactRoot, envelopesById, historicalResourceSnapshots,
    evidenceSnapshots: new Map([...evidence.snapshots, ...contextEvidence.snapshots, ...participantEvidence.snapshots, ...changeEvidence.snapshots, ...fixEvidence.snapshots]) };
}
