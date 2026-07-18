import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import { validateAssessment } from "../validate-assessment.mjs";
import { lookupRequirement } from "../show-requirement.mjs";
import { validateJsonSchema } from "./json-schema.mjs";

const defaultSkillRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0);
const auditRunRegistryCompatibility = new Map([
  ["1.0.0", "1.0.0"],
  ["2.0.0", "1.0.0"],
  ["3.0.0", "2.0.0"],
  ["4.0.0", "3.0.0"],
  ["5.0.0", "4.0.0"],
  ["6.0.0", "5.0.0"]
]);
const auditRunEnvelopeCompatibility = new Map([
  ["1.0.0", "1.0.0"],
  ["2.0.0", "1.0.0"],
  ["3.0.0", "1.0.0"],
  ["4.0.0", "1.0.0"],
  ["5.0.0", "2.0.0"],
  ["6.0.0", "2.0.0"]
]);
const currentAuditRunManifestContract = {
  id: "audit-run",
  latest_schema_version: "6.0.0",
  schema_versions: [
    { version: "1.0.0", schema_file: "audit-run-1.0.0.schema.json", mode: "read_only" },
    { version: "2.0.0", schema_file: "audit-run-2.0.0.schema.json", mode: "read_only" },
    { version: "3.0.0", schema_file: "audit-run-3.0.0.schema.json", mode: "read_only" },
    { version: "4.0.0", schema_file: "audit-run-4.0.0.schema.json", mode: "read_only" },
    { version: "5.0.0", schema_file: "audit-run-5.0.0.schema.json", mode: "read_only" },
    {
      version: "6.0.0",
      schema_file: "audit-run.schema.json",
      schema_sha256: "9809a64eeb9b93394cf0213e7291e8bdf489853f6e8d660a6756cae32f2178a4",
      mode: "current"
    }
  ]
};
const currentScreeningManifestContract = {
  id: "screening-observations",
  latest_schema_version: "2.0.0",
  schema_versions: [
    { version: "1.0.0", schema_file: "screening-observations-1.0.0.schema.json", mode: "read_only" },
    {
      version: "2.0.0",
      schema_file: "screening-observations.schema.json",
      schema_sha256: "c1d50902738383184fe5ca27831f65f8f6926214bc7370a4ada6752b326033fa",
      mode: "current"
    }
  ]
};

function pathKey(value) {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isWithinPath(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function compareText(left, right) {
  return left.localeCompare(right, "en");
}

function hasTraversal(value) {
  return String(value).split(/[\\/]+/u).includes("..");
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function statIdentity(stats) {
  return {
    dev: stats.dev.toString(),
    ino: stats.ino.toString(),
    size: stats.size.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    ctimeNs: stats.ctimeNs.toString()
  };
}

function directoryIdentity(stats) {
  return { dev: stats.dev.toString(), ino: stats.ino.toString() };
}

function sameIdentity(left, right) {
  return isDeepStrictEqual(left, right);
}

function inspectRealComponents(target, { type, label = "path" } = {}) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stats;
    try {
      stats = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`Missing ${label}: ${current}`);
      throw error;
    }
    if (stats.isSymbolicLink()) throw new Error(`Unsafe ${label}: symbolic link, junction, or reparse point at ${current}`);
    const real = fs.realpathSync.native(current);
    if (pathKey(real) !== pathKey(current)) throw new Error(`Unsafe ${label}: reparse traversal from ${current} to ${real}`);
  }
  const stats = fs.lstatSync(absolute);
  if (type === "file" && !stats.isFile()) throw new Error(`Expected artifact file for ${label}: ${absolute}`);
  if (type === "directory" && !stats.isDirectory()) throw new Error(`Expected directory for ${label}: ${absolute}`);
  return { absolute, stats };
}

function inspectSafeOutput(output) {
  const absolute = path.resolve(output);
  try {
    fs.lstatSync(absolute);
    throw new Error(`Refusing to overwrite existing file: ${absolute}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const parent = inspectRealComponents(path.dirname(absolute), { type: "directory", label: "output parent" });
  return { absolute, parentIdentity: directoryIdentity(fs.statSync(parent.absolute, { bigint: true })) };
}

export function assertNewOutputPath(output) {
  return inspectSafeOutput(output).absolute;
}

export function canonicalJson(value) {
  function normalize(item) {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(Object.keys(item).sort(compareText).map((key) => [key, normalize(item[key])]));
    }
    return item;
  }
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

function removeCreatedOutput(inspected, createdIdentity) {
  if (!createdIdentity) return;
  const parentIdentity = directoryIdentity(fs.statSync(path.dirname(inspected.absolute), { bigint: true }));
  if (!sameIdentity(inspected.parentIdentity, parentIdentity)) throw new Error(`Output parent identity changed; refusing unsafe cleanup: ${path.dirname(inspected.absolute)}`);
  const stats = fs.lstatSync(inspected.absolute);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`Output identity changed; refusing unsafe cleanup: ${inspected.absolute}`);
  const currentIdentity = directoryIdentity(fs.statSync(inspected.absolute, { bigint: true }));
  if (!sameIdentity(createdIdentity, currentIdentity)) throw new Error(`Output file identity changed; refusing unsafe cleanup: ${inspected.absolute}`);
  fs.unlinkSync(inspected.absolute);
}

function writeNewContent(output, content, hooks = {}) {
  const inspected = inspectSafeOutput(output);
  let descriptor;
  let createdIdentity;
  let writtenIdentity;
  try {
    descriptor = fs.openSync(inspected.absolute, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow, 0o600);
    const openedStats = fs.fstatSync(descriptor, { bigint: true });
    createdIdentity = directoryIdentity(openedStats);
    writtenIdentity = statIdentity(openedStats);
    const currentParent = directoryIdentity(fs.statSync(path.dirname(inspected.absolute), { bigint: true }));
    if (!sameIdentity(inspected.parentIdentity, currentParent)) throw new Error(`Unsafe output parent changed before write: ${path.dirname(inspected.absolute)}`);
    hooks.beforeWrite?.(inspected.absolute);
    fs.writeFileSync(descriptor, content, "utf8");
    writtenIdentity = statIdentity(fs.fstatSync(descriptor, { bigint: true }));
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    hooks.afterClose?.(inspected.absolute);
    inspectRealComponents(inspected.absolute, { type: "file", label: "output file" });
    const currentIdentity = statIdentity(fs.statSync(inspected.absolute, { bigint: true }));
    if (!sameIdentity(writtenIdentity, currentIdentity)) throw new Error(`Output file identity changed after close: ${inspected.absolute}`);
    const finalParent = directoryIdentity(fs.statSync(path.dirname(inspected.absolute), { bigint: true }));
    if (!sameIdentity(inspected.parentIdentity, finalParent)) throw new Error(`Unsafe output parent changed during write: ${path.dirname(inspected.absolute)}`);
    return inspected.absolute;
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      removeCreatedOutput(inspected, createdIdentity);
    } catch (cleanupError) {
      throw new Error(`${error.message}; output cleanup failed: ${cleanupError.message}`);
    }
    throw error;
  }
}

export function writeNewJson(output, value, hooks = {}) {
  return writeNewContent(output, canonicalJson(value), hooks);
}

export function writeNewText(output, value, hooks = {}) {
  if (typeof value !== "string") throw new Error("Text output must be a string.");
  return writeNewContent(output, value, hooks);
}

export function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function sha256NormalizedTextBytes(bytes) {
  return sha256Bytes(Buffer.from(bytes.toString("utf8").replace(/\r\n/gu, "\n"), "utf8"));
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${error.message}`);
  }
}

export function readStableFile(file, { label = "input file" } = {}) {
  const inspected = inspectRealComponents(file, { type: "file", label });
  const descriptor = fs.openSync(inspected.absolute, fs.constants.O_RDONLY | noFollow);
  try {
    const before = statIdentity(fs.fstatSync(descriptor, { bigint: true }));
    const bytes = fs.readFileSync(descriptor);
    const after = statIdentity(fs.fstatSync(descriptor, { bigint: true }));
    if (!sameIdentity(before, after)) throw new Error(`${label} changed while it was read: ${inspected.absolute}`);
    return { path: inspected.absolute, bytes, sha256: sha256Bytes(bytes), identity: after };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function assertStableFile(snapshot, label = "input file") {
  const current = readStableFile(snapshot.path, { label });
  if (!sameIdentity(snapshot.identity, current.identity) || snapshot.sha256 !== current.sha256 || !snapshot.bytes.equals(current.bytes)) {
    throw new Error(`${label} changed before commit: ${snapshot.path}`);
  }
  return current;
}

function readJson(relative, skillRoot) {
  const file = path.join(skillRoot, ...relative.split("/"));
  const bytes = fs.readFileSync(file);
  return { file, bytes, value: parseJsonBytes(bytes, relative) };
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort(compareText);
}

function canonicalComparableManifest(installedManifest, canonicalManifest) {
  const canonicalSchemas = new Map((canonicalManifest?.schema_versions ?? []).map((entry) => [entry.version, entry]));
  return {
    ...installedManifest,
    schema_versions: (installedManifest?.schema_versions ?? []).map((entry) => {
      if (canonicalSchemas.get(entry.version)?.schema_sha256) return entry;
      const { schema_sha256: _schemaSha256, ...withoutAddedHash } = entry;
      return withoutAddedHash;
    })
  };
}

function validateOrchestrationRegistrySemantics(registry, canonicalRegistry) {
  const errors = [];
  const roles = Array.isArray(registry?.roles) ? registry.roles : [];
  const artifactTypes = Array.isArray(registry?.artifact_types) ? registry.artifact_types : [];
  const transitions = Array.isArray(registry?.transitions) ? registry.transitions : [];
  const roleIds = roles.map((role) => role?.id);
  const agentIds = roles.map((role) => role?.agent_id).filter((agentId) => agentId !== null && agentId !== undefined);
  const artifactTypeIds = artifactTypes.map((artifactType) => artifactType?.id);
  for (const duplicate of duplicateValues(roleIds)) errors.push(`Duplicate role ID: ${String(duplicate)}.`);
  for (const duplicate of duplicateValues(agentIds)) errors.push(`Duplicate agent ID: ${String(duplicate)}.`);
  for (const duplicate of duplicateValues(artifactTypeIds)) errors.push(`Duplicate artifact type ID: ${String(duplicate)}.`);

  const roleById = new Map(roles.map((role) => [role?.id, role]));
  const artifactTypeSet = new Set(artifactTypeIds);
  const canonicalRoles = new Map((canonicalRegistry?.roles ?? []).map((role) => [role.id, role]));
  for (const [roleId, canonicalRole] of canonicalRoles) {
    const installedRole = roleById.get(roleId);
    if (!installedRole) errors.push(`Missing canonical role: ${roleId}.`);
    else if (!isDeepStrictEqual(installedRole, canonicalRole)) errors.push(`Canonical role contract changed: ${roleId}.`);
  }
  const installedArtifactTypes = new Map(artifactTypes.map((artifactType) => [artifactType?.id, artifactType]));
  for (const canonicalArtifactType of canonicalRegistry?.artifact_types ?? []) {
    const installedArtifactType = installedArtifactTypes.get(canonicalArtifactType.id);
    if (!installedArtifactType) errors.push(`Missing canonical artifact type: ${canonicalArtifactType.id}.`);
    else if (canonicalArtifactType.id === "audit-run") {
      if (!isDeepStrictEqual(installedArtifactType, currentAuditRunManifestContract)) errors.push("Canonical audit-run manifest changed.");
    } else if (canonicalArtifactType.id === "screening-observations") {
      if (!isDeepStrictEqual(installedArtifactType, currentScreeningManifestContract)) errors.push("Canonical screening-observations manifest changed.");
    } else if (!isDeepStrictEqual(canonicalComparableManifest(installedArtifactType, canonicalArtifactType), canonicalArtifactType)) {
      errors.push(`Canonical artifact type manifest changed: ${canonicalArtifactType.id}.`);
    }
  }

  for (const role of roles) {
    const roleId = String(role?.id);
    if (!artifactTypeSet.has(role?.output_type)) errors.push(`Role ${roleId} has an unregistered output artifact type: ${String(role?.output_type)}.`);
    for (const inputType of Array.isArray(role?.input_types) ? role.input_types : []) {
      if (!artifactTypeSet.has(inputType)) errors.push(`Role ${roleId} has an unregistered input artifact type: ${String(inputType)}.`);
    }
    if (role?.producer_kind === "ai_agent") {
      if (!['E0', 'E1'].includes(role?.max_ai_evidence_level)) errors.push(`AI role ${roleId} must not exceed E1 evidence.`);
      if (role?.can_record_profile_outcome) errors.push(`AI role ${roleId} cannot record profile outcomes.`);
    }
    if (role?.can_record_profile_outcome && roleId !== "declared_external_human") {
      errors.push(`Only declared_external_human may record profile outcomes; received ${roleId}.`);
    }
    if (role?.can_write_target && roleId !== "authorized_fixer") errors.push(`Only authorized_fixer may write the target; received ${roleId}.`);
    if (role?.can_write_target && role?.install_by_default) errors.push(`A target-writing role cannot be installed by default: ${roleId}.`);
    if (role?.output_type === "fix-authorization" && roleId !== "declared_authorizer") {
      errors.push(`Only declared_authorizer may produce fix-authorization; received ${roleId}.`);
    }
    if (!canonicalRoles.has(role?.id)) {
      if (role?.producer_kind !== "ai_agent"
          || !['E0', 'E1'].includes(role?.max_ai_evidence_level)
          || role?.can_record_profile_outcome !== false
          || role?.can_write_target !== false
          || ["audit-run", "fix-authorization", "change-record"].includes(role?.output_type)) {
        errors.push(`Extension role ${roleId} must remain a safe read-only AI role without orchestration, authorization, or change output.`);
      }
    }
  }
  const writers = roles.filter((role) => role?.can_write_target).map((role) => role.id);
  if (!isDeepStrictEqual(writers, ["authorized_fixer"])) errors.push("The registry must contain exactly one target writer: authorized_fixer.");
  const authorizers = roles.filter((role) => role?.output_type === "fix-authorization").map((role) => role.id);
  if (!isDeepStrictEqual(authorizers, ["declared_authorizer"])) errors.push("The registry must contain exactly one fix authorizer: declared_authorizer.");

  const transitionKeys = [];
  const routeKeys = [];
  const states = new Set(["initialized"]);
  const adjacency = new Map();
  const transitionArtifactTypes = new Set();
  const canonicalTransitions = canonicalRegistry?.transitions ?? [];
  const canonicalStates = new Set([
    "initialized",
    ...canonicalTransitions.flatMap((transition) => [transition.from, transition.to])
  ]);
  for (const canonicalTransition of canonicalTransitions) {
    if (!transitions.some((transition) => isDeepStrictEqual(transition, canonicalTransition))) {
      errors.push(`Missing or changed canonical transition: ${canonicalTransition.from} -> ${canonicalTransition.to}.`);
    }
  }
  for (const transition of transitions) {
    const isCanonicalTransition = canonicalTransitions.some((canonicalTransition) => isDeepStrictEqual(transition, canonicalTransition));
    const required = Array.isArray(transition?.required_artifact_types) ? transition.required_artifact_types : [];
    if (required.length !== 1) errors.push(`Transition ${String(transition?.from)} -> ${String(transition?.to)} must require exactly one artifact type.`);
    const artifactType = required[0];
    if (artifactType && !artifactTypeSet.has(artifactType)) errors.push(`Transition requires an unregistered artifact type: ${artifactType}.`);
    if (artifactType && !roles.some((role) => role?.output_type === artifactType)) errors.push(`Transition artifact type has no producer role: ${artifactType}.`);
    if (transition?.from === transition?.to) errors.push(`Transition cannot form a self-cycle: ${String(transition?.from)}.`);
    if (["fix-authorization", "change-record"].includes(artifactType) && !isCanonicalTransition) {
      errors.push(`Privileged artifact type cannot define an extension transition: ${String(artifactType)}.`);
    }
    if (!isCanonicalTransition && canonicalStates.has(transition?.to)) {
      errors.push(`Extension transition cannot enter canonical orchestration state: ${String(transition?.to)}.`);
    }
    transitionKeys.push(`${String(transition?.from)}\u0000${String(artifactType)}`);
    routeKeys.push(`${String(transition?.from)}\u0000${String(transition?.to)}`);
    states.add(transition?.from);
    states.add(transition?.to);
    if (!adjacency.has(transition?.from)) adjacency.set(transition?.from, []);
    adjacency.get(transition?.from).push(transition?.to);
    if (artifactType) transitionArtifactTypes.add(artifactType);
  }
  for (const duplicate of duplicateValues(transitionKeys)) errors.push(`Ambiguous transition for state and artifact type: ${duplicate.replace("\u0000", " + ")}.`);
  for (const duplicate of duplicateValues(routeKeys)) errors.push(`Duplicate transition route: ${duplicate.replace("\u0000", " -> ")}.`);
  for (const artifactType of artifactTypeIds.filter((id) => id !== "audit-run")) {
    if (!roles.some((role) => role?.output_type === artifactType)) errors.push(`Registered artifact type has no producer role: ${artifactType}.`);
    if (!transitionArtifactTypes.has(artifactType)) errors.push(`Registered artifact type has no transition: ${artifactType}.`);
  }

  const reachable = new Set();
  const queue = ["initialized"];
  while (queue.length) {
    const state = queue.shift();
    if (reachable.has(state)) continue;
    reachable.add(state);
    queue.push(...(adjacency.get(state) ?? []));
  }
  for (const state of states) if (!reachable.has(state)) errors.push(`Unreachable orchestration state: ${String(state)}.`);

  const visiting = new Set();
  const visited = new Set();
  function visit(state) {
    if (visiting.has(state)) {
      errors.push(`Orchestration transition cycle detected at state: ${String(state)}.`);
      return;
    }
    if (visited.has(state)) return;
    visiting.add(state);
    for (const next of adjacency.get(state) ?? []) visit(next);
    visiting.delete(state);
    visited.add(state);
  }
  visit("initialized");
  return errors;
}

export function loadAuditResources(skillRoot = defaultSkillRoot) {
  const names = {
    standardsRegistry: "references/standards-registry.json",
    orchestrationRegistry: "references/orchestration-registry.json",
    orchestrationSchema: "references/orchestration-registry.schema.json",
    orchestrationRegistryV1: "references/orchestration-registry-1.0.0.json",
    orchestrationSchemaV1: "references/orchestration-registry-1.0.0.schema.json",
    orchestrationRegistryV2: "references/orchestration-registry-2.0.0.json",
    orchestrationSchemaV2: "references/orchestration-registry-2.0.0.schema.json",
    orchestrationRegistryV3: "references/orchestration-registry-3.0.0.json",
    orchestrationSchemaV3: "references/orchestration-registry-3.0.0.schema.json",
    orchestrationRegistryV4: "references/orchestration-registry-4.0.0.json",
    orchestrationSchemaV4: "references/orchestration-registry-4.0.0.schema.json",
    envelopeSchema: "references/audit-artifact-envelope.schema.json",
    envelopeSchemaV1: "references/audit-artifact-envelope-1.0.0.schema.json",
    assessmentSchema: "references/assessment-record.schema.json",
    criteriaCatalog: "references/criteria-catalog.json",
    criterionProcedures: "references/criterion-procedures.json",
    auditMethods: "references/web-audit-methods.json"
  };
  const loaded = Object.fromEntries(Object.entries(names).map(([key, relative]) => [key, readJson(relative, skillRoot)]));
  for (const [label, registry, schema] of [
    ["installed", loaded.orchestrationRegistry, loaded.orchestrationSchema],
    ["frozen 1.0.0", loaded.orchestrationRegistryV1, loaded.orchestrationSchemaV1],
    ["frozen 2.0.0", loaded.orchestrationRegistryV2, loaded.orchestrationSchemaV2],
    ["frozen 3.0.0", loaded.orchestrationRegistryV3, loaded.orchestrationSchemaV3],
    ["frozen 4.0.0", loaded.orchestrationRegistryV4, loaded.orchestrationSchemaV4]
  ]) {
    const registryErrors = [];
    validateJsonSchema(registry.value, schema.value, "$", registryErrors);
    if (registryErrors.length) throw new Error(`Invalid ${label} orchestration registry:\n- ${registryErrors.join("\n- ")}`);
  }
  const semanticErrors = validateOrchestrationRegistrySemantics(
    loaded.orchestrationRegistry.value,
    loaded.orchestrationRegistryV4.value
  );
  if (semanticErrors.length) throw new Error(`Invalid installed orchestration registry semantics:\n- ${semanticErrors.join("\n- ")}`);
  const schemaManifests = new Map();
  const artifactTypeIds = new Set();
  const schemaFiles = new Set();
  for (const manifest of loaded.orchestrationRegistry.value.artifact_types) {
    if (artifactTypeIds.has(manifest.id)) throw new Error(`Duplicate artifact type manifest: ${manifest.id}`);
    artifactTypeIds.add(manifest.id);
    const schemas = new Map();
    const currentEntries = manifest.schema_versions.filter((entry) => entry.mode === "current");
    if (currentEntries.length !== 1 || currentEntries[0].version !== manifest.latest_schema_version) {
      throw new Error(`Artifact type ${manifest.id} must have exactly one current schema matching latest_schema_version.`);
    }
    for (const entry of manifest.schema_versions) {
      if (schemas.has(entry.version)) throw new Error(`Duplicate schema version ${entry.version} for artifact type ${manifest.id}.`);
      if (schemaFiles.has(entry.schema_file)) throw new Error(`Duplicate schema file reference in orchestration registry: ${entry.schema_file}.`);
      schemaFiles.add(entry.schema_file);
      const schemaRecord = readJson(`references/${entry.schema_file}`, skillRoot);
      const schema = schemaRecord.value;
      if (entry.mode === "current" && !entry.schema_sha256) {
        throw new Error(`Current schema manifest requires schema_sha256 for ${manifest.id} ${entry.version}: ${entry.schema_file}.`);
      }
      if (entry.schema_sha256 && sha256NormalizedTextBytes(schemaRecord.bytes) !== entry.schema_sha256) {
        throw new Error(`Schema SHA-256 mismatch for ${manifest.id} ${entry.version}: ${entry.schema_file}.`);
      }
      if (schema?.properties?.schema_version?.const !== entry.version) {
        throw new Error(`Schema manifest version mismatch for ${manifest.id} ${entry.version}: ${entry.schema_file}.`);
      }
      const expectedSchemaId = `urn:information-accessibility:${manifest.id}:${entry.version}`;
      if (schema?.$id !== expectedSchemaId) {
        throw new Error(`Schema $id must match artifact type and version ${expectedSchemaId}: ${entry.schema_file}.`);
      }
      schemas.set(entry.version, { ...entry, schema });
    }
    schemaManifests.set(manifest.id, { ...manifest, schemas });
  }
  const auditRunManifest = schemaManifests.get("audit-run");
  if (!auditRunManifest) throw new Error("The orchestration registry does not declare the audit-run schema manifest.");
  const auditRunSchemas = new Map([...auditRunManifest.schemas].map(([version, entry]) => [version, entry.schema]));
  const auditRunSchema = auditRunSchemas.get(auditRunManifest.latest_schema_version);
  const payloadSchemas = new Map([...schemaManifests]
    .filter(([artifactType]) => artifactType !== "audit-run")
    .map(([artifactType, manifest]) => [
      artifactType,
      new Map([...manifest.schemas].map(([version, entry]) => [version, entry.schema]))
    ]));
  function payloadVersionsForRegistry(registry) {
    return new Map(registry.value.artifact_types
      .filter((artifactType) => artifactType.id !== "audit-run")
      .map((artifactType) => {
        // Registry 1 predates versioned manifests; every schema it published was 1.0.0.
        const version = artifactType.latest_schema_version ?? "1.0.0";
        if (!payloadSchemas.get(artifactType.id)?.has(version)) {
          throw new Error(`Orchestration registry ${registry.value.schema_version} requires missing ${artifactType.id} payload schema ${version}.`);
        }
        return [artifactType.id, version];
      }));
  }
  const registryFiles = [
    loaded.orchestrationRegistryV1,
    loaded.orchestrationRegistryV2,
    loaded.orchestrationRegistryV3,
    loaded.orchestrationRegistryV4,
    loaded.orchestrationRegistry
  ];
  const orchestrationRegistries = new Map(registryFiles.map((registry) => [
    registry.value.schema_version,
    {
      value: registry.value,
      sha256: sha256Bytes(registry.bytes),
      payloadVersions: payloadVersionsForRegistry(registry)
    }
  ]));
  const currentPayloadVersions = orchestrationRegistries.get(loaded.orchestrationRegistry.value.schema_version).payloadVersions;
  const envelopeSchemas = new Map([
    ["1.0.0", loaded.envelopeSchemaV1.value],
    ["2.0.0", loaded.envelopeSchema.value]
  ]);
  return {
    skillRoot,
    standardsRegistry: loaded.standardsRegistry.value,
    orchestrationRegistry: loaded.orchestrationRegistry.value,
    schemaManifests,
    auditRunSchema,
    auditRunSchemas,
    envelopeSchema: loaded.envelopeSchema.value,
    envelopeSchemas,
    assessmentSchema: loaded.assessmentSchema.value,
    criteriaCatalog: loaded.criteriaCatalog.value,
    criterionProcedures: loaded.criterionProcedures.value,
    auditMethods: loaded.auditMethods.value,
    payloadSchemas,
    currentPayloadVersions,
    orchestrationRegistries,
    resourceVersions: {
      standards_registry_version: loaded.standardsRegistry.value.schema_version,
      orchestration_registry_version: loaded.orchestrationRegistry.value.schema_version,
      orchestration_registry_sha256: sha256Bytes(loaded.orchestrationRegistry.bytes),
      criteria_catalog_sha256: sha256Bytes(loaded.criteriaCatalog.bytes),
      criterion_procedures_sha256: sha256Bytes(loaded.criterionProcedures.bytes),
      audit_methods_sha256: sha256Bytes(loaded.auditMethods.bytes)
    }
  };
}

function artifactRootFor(run, runFile) {
  if (!runFile) throw new Error("runFile is required to resolve artifact_root");
  if (typeof run?.artifact_root !== "string" || path.isAbsolute(run.artifact_root) || hasTraversal(run.artifact_root)) {
    throw new Error(`artifact_root must be a traversal-free relative path: ${String(run?.artifact_root)}`);
  }
  return inspectRealComponents(path.resolve(path.dirname(path.resolve(runFile)), run.artifact_root), {
    type: "directory",
    label: "artifact root"
  }).absolute;
}

export function resolveInside(root, candidate) {
  if (hasTraversal(candidate)) throw new Error(`Artifact path contains traversal: ${candidate}`);
  const safeRoot = inspectRealComponents(root, { type: "directory", label: "artifact root" }).absolute;
  const resolved = path.resolve(candidate);
  if (pathKey(resolved) === pathKey(safeRoot)) throw new Error(`Artifact path names the artifact root itself: ${candidate}`);
  const inspected = inspectRealComponents(resolved, { type: "file", label: "artifact path" });
  const canonicalRoot = fs.realpathSync.native(safeRoot);
  const canonicalCandidate = fs.realpathSync.native(inspected.absolute);
  if (!isInside(canonicalRoot, canonicalCandidate)) throw new Error(`Artifact path is outside the declared root: ${candidate}`);
  return canonicalCandidate;
}

function roleFor(resources, roleId) {
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
    : artifact?.artifact_type === "change-record" && payloadVersion === "2.0.0"
      ? artifact?.payload?.command_results
      : undefined;
  if (Array.isArray(commandRecords)) {
    const commandIds = commandRecords.map((command) => command?.command_id);
    if (new Set(commandIds).size !== commandIds.length) errors.push(`${String(artifact.artifact_type)} command_id values must be unique.`);
  }
  if (artifact?.artifact_type === "change-record" && payloadVersion === "2.0.0" && Array.isArray(artifact?.payload?.changed_files)) {
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
  return { valid: errors.length === 0, errors };
}

function registeredArtifactPath(root, entry) {
  if (typeof entry?.path !== "string" || path.isAbsolute(entry.path) || hasTraversal(entry.path)) {
    throw new Error(`Registered artifact path must be relative and traversal-free: ${String(entry?.path)}`);
  }
  return resolveInside(root, path.join(root, ...entry.path.split("/")));
}

function canonicalPermissions(permissions) {
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
  return {
    network,
    interaction,
    source_write: sourceWrite,
    command_execution: commandExecution,
    allowed_actions: allowedActions.sort(compareText),
    forbidden_actions: forbiddenActions.sort(compareText)
  };
}

const remediationArtifactTypes = new Set(["fix-authorization", "change-record"]);

function remediationPermissionError(run, artifacts) {
  if (!artifacts.some((artifact) => remediationArtifactTypes.has(artifact?.artifact_type))) return null;
  if (run?.permissions?.source_write === "authorized_only"
      && run?.permissions?.command_execution === "authorized_verification_only") return null;
  return "fix-authorization and change-record artifacts require permissions.source_write authorized_only and permissions.command_execution authorized_verification_only.";
}

function normalizedArtifactPath(value) {
  if (typeof value !== "string") return String(value);
  return path.posix.normalize(value.replace(/\\/gu, "/"));
}

function validateRegisteredArtifactEntries(run, errors, { requireNormalizedPaths = true } = {}) {
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

function validateChangeRecordAuthorizationBinding(changeRecord, artifactsById, envelopesById, errors) {
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
}

function validateArtifactEnvelopeSemantics(run, resources, artifactsById, envelopesById, errors) {
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
      if (registered.created_at > artifact?.created_at) errors.push(`Artifact input was created after its consumer: ${artifactId} -> ${String(input?.artifact_id)}.`);
    }
    validateChangeRecordAuthorizationBinding(artifact, artifactsById, envelopesById, errors);
  }
}

function assertCurrentOperationalRun(run, resources, operation) {
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
  const expectedPermissions = canonicalPermissions(runRecord.permissions);
  if (!expectedPermissions || !isDeepStrictEqual(runRecord.permissions, expectedPermissions)) {
    errors.push("permissions must exactly match the canonical command_execution, allowed_actions, and forbidden_actions for network, interaction, and source_write.");
  }
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

function validateHumanQueueBindings(envelopesById, profileId, resources, errors) {
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

function validateDeclaredHumanBindings(envelopesById, profileId, resources, errors) {
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
      if (reviewed.has(requirementId)) errors.push(`Declared human review ${artifactId} repeats queued requirement ${String(requirementId)}.`);
      reviewed.add(requirementId);
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
      const procedure = resources.criterionProcedures.procedures.find((item) => item.requirement_id === requirementId);
      const requiredEvidenceTypes = new Set(queueItem.required_evidence_types ?? []);
      if (procedure) {
        const expectedProcedureRef = `criterion-procedures:${resources.criterionProcedures.schema_version}#${procedure.id}`;
        if (queueItem.procedure_availability !== "available" || queueItem.procedure_ref !== expectedProcedureRef
            || review.procedure_availability !== "available" || review.criterion_procedure_ref !== expectedProcedureRef) {
          errors.push(`Declared human review ${artifactId} must use the current registered procedure ${expectedProcedureRef} for ${requirementId}.`);
        }
        if (review.generic_method_ref !== null) errors.push(`Declared human review ${artifactId} generic_method_ref must be null when a criterion procedure is available for ${requirementId}.`);
        if (!exactStringSet(review.official_sources, procedure.primary_sources)) {
          errors.push(`Declared human review ${artifactId} official_sources must exactly match the registered procedure primary sources for ${requirementId}.`);
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

function remediationItems(envelopesById) {
  const items = [];
  for (const [artifactId, record] of envelopesById) {
    const artifact = artifactEnvelopeFromRecord(record);
    if (artifact?.artifact_type !== "remediation-plan") continue;
    for (const item of Array.isArray(artifact.payload?.items) ? artifact.payload.items : []) {
      items.push({ artifactId, artifact, item });
    }
  }
  return items.sort((left, right) => compareText(String(left.item?.remediation_id), String(right.item?.remediation_id))
    || compareText(String(left.artifactId), String(right.artifactId)));
}

function validateRemediationBindings(envelopesById, errors) {
  const seenRemediationIds = new Set();
  for (const [artifactId, record] of envelopesById) {
    const artifact = artifactEnvelopeFromRecord(record);
    if (artifact?.artifact_type !== "remediation-plan") continue;
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

function validateHistory(run, resources, artifactsById, errors) {
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
    if (previousAt && entry.at < previousAt) errors.push(`${location}.at is earlier than the preceding history entry.`);
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
      if (artifact.created_at > entry.at) errors.push(`${location}.at precedes registered artifact ${artifact.artifact_id}.`);
    }
    current = entry.to ?? current;
  }
  if (run?.status !== current) errors.push(`Run status/history continuity error: status is ${String(run?.status)} but history ends at ${current}.`);
  for (const artifact of Array.isArray(run?.artifacts) ? run.artifacts : []) {
    if (!representedTypes.has(artifact?.artifact_type)) errors.push(`Registered artifact type is not represented by run history: ${String(artifact?.artifact_type)} (${String(artifact?.artifact_id)}).`);
  }
}

export function validateAuditRun(run, { skillRoot = defaultSkillRoot, runFile } = {}) {
  const errors = [];
  let resources;
  try {
    resources = loadAuditResources(skillRoot);
  } catch (error) {
    return { valid: false, errors: [error.message] };
  }
  const runRecord = run !== null && typeof run === "object" && !Array.isArray(run) ? run : {};
  const schema = resources.auditRunSchemas.get(runRecord.schema_version);
  if (!schema) errors.push(`Unsupported audit-run schema_version: ${String(runRecord.schema_version)}.`);
  else validateJsonSchema(run, schema, "$", errors);
  const registryVersion = runRecord.resource_versions?.orchestration_registry_version;
  const registryRecord = resources.orchestrationRegistries.get(registryVersion);
  if (!registryRecord) errors.push(`Unsupported orchestration_registry_version: ${String(registryVersion)}.`);
  const runResources = registryRecord
    ? { ...resources, orchestrationRegistry: registryRecord.value }
    : resources;
  const expectedRegistryVersion = auditRunRegistryCompatibility.get(runRecord.schema_version);
  if (!expectedRegistryVersion) {
    errors.push(`Unsupported audit-run registry compatibility: ${String(runRecord.schema_version)}.`);
  } else if (registryVersion !== expectedRegistryVersion) {
    errors.push(`audit-run ${runRecord.schema_version} requires orchestration registry ${expectedRegistryVersion}; received ${String(registryVersion)}.`);
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
  const usesCurrentPolicy = runRecord.schema_version === currentSchemaVersion;
  if (usesCurrentPolicy) {
    const profile = resources.standardsRegistry.profiles.find((item) => item.id === runRecord.profile?.id);
    if (!profile?.assessment_configuration?.active) errors.push(`Run profile must be a known active profile: ${String(runRecord.profile?.id)}.`);
    if (runRecord.profile?.registry_version !== resources.standardsRegistry.schema_version) {
      errors.push(`profile.registry_version must match the installed standards registry version ${resources.standardsRegistry.schema_version}.`);
    }
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
      const snapshot = readStableFile(file, { label: `registered artifact ${String(entry?.artifact_id)}` });
      if (snapshot.sha256 !== entry?.sha256) errors.push(`Registered artifact current hash mismatch: ${String(entry?.artifact_id)}.`);
      const envelope = parseJsonBytes(snapshot.bytes, `registered artifact ${String(entry?.artifact_id)}`);
      envelopesById.set(entry?.artifact_id, { envelope, snapshot });
      const envelopeVersion = auditRunEnvelopeCompatibility.get(runRecord.schema_version);
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
    validateHumanQueueBindings(envelopesById, runRecord.profile?.id, runResources, errors);
    validateDeclaredHumanBindings(envelopesById, runRecord.profile?.id, runResources, errors);
    validateRemediationBindings(envelopesById, errors);
  }
  validateHistory(runRecord, runResources, artifactsById, errors);
  return { valid: errors.length === 0, errors, resources: runResources, artifactRoot, envelopesById };
}

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
  const permissions = canonicalPermissions({ network, interaction, source_write: sourceWrite });
  const run = {
    schema_version: resources.auditRunSchema.properties.schema_version.const,
    run_id: options.runId,
    supersedes_run_id: options.supersedesRun?.run_id ?? null,
    status: "initialized",
    target: { name: options.targetName, version_or_commit: options.targetVersion, urls_or_files: targetRefs },
    profile: { id: profile.id, registry_version: resources.standardsRegistry.schema_version },
    scope: { included: targetRefs, excluded: [], complete_processes: [], third_party_content: [], full_pages_reviewed: false },
    environment: { os: ["not_declared"], browsers: [], assistive_technologies: [], input_modes: [] },
    permissions,
    resource_versions: resources.resourceVersions,
    artifact_root: relativeRoot.split(path.sep).join("/"),
    artifacts: [],
    history: [],
    limitations: ["The environment was not declared; no profile outcome has been recorded."]
  };
  if (options.supersedesRun) {
    if (!options.supersedesRunFile) throw new Error("supersedesRunFile is required for fresh retest initialization.");
    const predecessorValidation = validateAuditRun(options.supersedesRun, { skillRoot, runFile: options.supersedesRunFile });
    if (!predecessorValidation.valid) throw new Error(`Invalid superseded audit run:\n- ${predecessorValidation.errors.join("\n- ")}`);
    if (!["5.0.0", "6.0.0"].includes(options.supersedesRun.schema_version)) {
      throw new Error("Fresh retest predecessor must use supported audit-run schema_version 5.0.0 or 6.0.0.");
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
    if (!isDeepStrictEqual(run.target.urls_or_files, options.supersedesRun.target.urls_or_files)) throw new Error("Fresh retest target references must match the predecessor.");
    if (!isDeepStrictEqual(run.profile, options.supersedesRun.profile)) throw new Error("Fresh retest profile must match the predecessor.");
    if (!isDeepStrictEqual(run.scope, options.supersedesRun.scope)) throw new Error("Fresh retest scope must match the predecessor.");
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
  validateChangeRecordAuthorizationBinding(installedArtifact, artifactsById, validation.envelopesById, authorizationBindingErrors);
  if (authorizationBindingErrors.length > 0) {
    throw new Error(`Invalid change-record authorization binding:\n- ${authorizationBindingErrors.join("\n- ")}`);
  }
  const outgoing = validation.resources.orchestrationRegistry.transitions.filter((transition) => transition.from === run.status && transition.required_artifact_types.includes(installedArtifact.artifact_type));
  const incomingCurrent = validation.resources.orchestrationRegistry.transitions.some((transition) => transition.to === run.status && transition.required_artifact_types.includes(installedArtifact.artifact_type));
  if (outgoing.length > 1) throw new Error(`Ambiguous transition for ${run.status} and ${installedArtifact.artifact_type}`);
  if (outgoing.length === 0 && !incomingCurrent) throw new Error(`Artifact type ${installedArtifact.artifact_type} is a future or invalid transition from ${run.status}`);
  const lastHistoryAt = run.history.at(-1)?.at;
  if (lastHistoryAt && installedArtifact.created_at < lastHistoryAt) throw new Error("Artifact created_at precedes the current run state.");
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
  return next;
}

function expectedMethodRef(requirementId, resources, profileId) {
  const record = profileCatalogRecord(requirementId, profileId, resources);
  if (!record) throw new Error(`Exact profile row is not registered for declared human review: ${requirementId}`);
  const method = resources.auditMethods.methods.find((item) => item.id === record.method_key);
  if (!method) throw new Error(`No registered audit method for exact profile row: ${requirementId}`);
  return `web-audit-methods:${resources.auditMethods.schema_version}#${method.id}`;
}

function validateAssessmentOrThrow(assessment, resources, label) {
  const result = validateAssessment(assessment, resources.standardsRegistry, resources.assessmentSchema, resources.criteriaCatalog, resources.auditMethods);
  if (!result.valid) throw new Error(`${label}:\n- ${result.errors.join("\n- ")}`);
  return result;
}

function assertAssessmentMergeBaseline(assessment, resources) {
  const record = assessment?.assessment;
  if (record?.evidence_level !== "E0") {
    throw new Error("Merge input must be an E0 assessment baseline reconstructed only from current-run artifacts.");
  }
  if (!Array.isArray(record.findings) || record.findings.length !== 0) {
    throw new Error("Merge input E0 assessment baseline must not contain prior findings.");
  }
  for (const result of Array.isArray(record.results) ? record.results : []) {
    if (result?.requirement_kind !== "profile_requirement") {
      throw new Error("Merge input E0 assessment baseline must not contain prior screening rows.");
    }
    if (result.mapping_status !== "unverified" || result.outcome !== "not_tested") {
      throw new Error("Merge input profile rows must be unverified and not_tested before current-run artifact reconstruction.");
    }
    if (!Array.isArray(result.evidence) || result.evidence.length !== 0) {
      throw new Error("Merge input E0 assessment baseline must not contain prior evidence.");
    }
  }
  const expectedParticipationCoverage = {
    find: "not_tested",
    receive: "not_tested",
    understand: "not_tested",
    participate: "not_tested",
    continue: "not_tested"
  };
  if (!isDeepStrictEqual(record.participation_coverage, expectedParticipationCoverage)) {
    throw new Error("Merge input E0 assessment baseline participation_coverage must be entirely not_tested.");
  }
  const expectedAssurance = {
    independent_audit: {
      performed: false,
      evaluator_independent: false,
      scope_method: "",
      report_location: ""
    },
    legal_or_procurement_dossier: {
      prepared: false,
      responsible_owner: "",
      artifacts: []
    }
  };
  if (!isDeepStrictEqual(record.assurance, expectedAssurance)) {
    throw new Error("Merge input E0 assessment baseline must not claim an independent audit or legal/procurement dossier.");
  }
  const expectedClaim = {
    requested_tier: "reference_only",
    proposed_wording: resources.standardsRegistry.claim_templates.reference_only?.[0]
  };
  if (!isDeepStrictEqual(record.claim, expectedClaim)) {
    throw new Error("Merge input E0 assessment baseline claim must be the canonical reference_only registry template.");
  }
  if (record.next_review_at !== null) {
    throw new Error("Merge input E0 assessment baseline next_review_at must be null.");
  }
}

export function mergeArtifacts({ run, assessment, artifacts, registries }) {
  const resources = registries ?? loadAuditResources();
  assertCurrentOperationalRun(run, resources, "Artifact merge");
  const permissionError = remediationPermissionError(run, artifacts);
  if (permissionError) throw new Error(permissionError);
  validateAssessmentOrThrow(assessment, resources, "Invalid input assessment");
  if (assessment.assessment.profile.id !== run.profile.id || assessment.assessment.profile.registry_version !== run.profile.registry_version) {
    throw new Error("Assessment profile does not match the audit run.");
  }
  if (!isDeepStrictEqual(assessment.assessment.target, run.target)) throw new Error("Assessment target does not match the audit run.");
  if (!isDeepStrictEqual(assessment.assessment.scope, run.scope)) throw new Error("Assessment scope does not match the audit run.");
  if (!isDeepStrictEqual(assessment.assessment.environment, run.environment)) throw new Error("Assessment environment does not match the audit run.");
  assertAssessmentMergeBaseline(assessment, resources);
  const runSemanticErrors = [];
  const registered = validateRegisteredArtifactEntries(run, runSemanticErrors);
  validateHistory(run, resources, registered, runSemanticErrors);
  if (runSemanticErrors.length) throw new Error(`Invalid pure merge audit-run semantics:\n- ${runSemanticErrors.join("\n- ")}`);
  const suppliedIds = new Set();
  const suppliedEnvelopesById = new Map();
  if (!(resources.artifact_snapshots_by_id instanceof Map)) {
    throw new Error("Pure merge requires registered artifact byte snapshots and fails closed without them.");
  }
  const sorted = [...artifacts].sort((left, right) => compareText(left.artifact_type, right.artifact_type) || compareText(left.artifact_id, right.artifact_id));
  for (const artifact of sorted) {
    if (suppliedIds.has(artifact.artifact_id)) throw new Error(`Duplicate supplied artifact ID: ${artifact.artifact_id}`);
    suppliedIds.add(artifact.artifact_id);
    const artifactValidation = validateArtifact(artifact, resources, {
      allowedPayloadVersions: resources.currentPayloadVersions
    });
    if (!artifactValidation.valid) throw new Error(`Invalid merge artifact ${artifact.artifact_id}:\n- ${artifactValidation.errors.join("\n- ")}`);
    const entry = registered.get(artifact.artifact_id);
    if (!entry) throw new Error(`Merge artifact is not registered in the run: ${artifact.artifact_id}`);
    if (entry.artifact_type !== artifact.artifact_type || entry.producer_role !== artifact.producer.role_id || artifact.run_id !== run.run_id) {
      throw new Error(`Merge artifact metadata does not match its registered run entry: ${artifact.artifact_id}`);
    }
    const snapshot = resources.artifact_snapshots_by_id.get(artifact.artifact_id);
    if (!snapshot || !Buffer.isBuffer(snapshot.bytes) || typeof snapshot.sha256 !== "string") {
      throw new Error(`Pure merge requires a registered byte snapshot for artifact: ${artifact.artifact_id}`);
    }
    const snapshotBytes = Buffer.from(snapshot.bytes);
    const snapshotHash = sha256Bytes(snapshotBytes);
    if (snapshotHash !== snapshot.sha256 || snapshotHash !== entry.sha256) {
      throw new Error(`Merge artifact registered byte snapshot hash mismatch: ${artifact.artifact_id}`);
    }
    const registeredEnvelope = parseJsonBytes(snapshotBytes, `registered byte snapshot ${artifact.artifact_id}`);
    if (!isDeepStrictEqual(registeredEnvelope, artifact)) {
      throw new Error(`Merge artifact does not match its registered bytes: ${artifact.artifact_id}`);
    }
    suppliedEnvelopesById.set(artifact.artifact_id, artifact);
  }
  const registeredIds = [...registered.keys()].sort(compareText);
  const suppliedRegisteredIds = [...suppliedIds].sort(compareText);
  if (!isDeepStrictEqual(suppliedRegisteredIds, registeredIds)) {
    const omitted = registeredIds.filter((id) => !suppliedIds.has(id));
    throw new Error(`Merge requires the complete registered artifact set; missing registered artifacts: ${omitted.join(", ")}`);
  }
  const bindingErrors = [];
  validateArtifactEnvelopeSemantics(run, resources, registered, suppliedEnvelopesById, bindingErrors);
  validateHumanQueueBindings(suppliedEnvelopesById, run.profile.id, resources, bindingErrors);
  validateDeclaredHumanBindings(suppliedEnvelopesById, run.profile.id, resources, bindingErrors);
  validateRemediationBindings(suppliedEnvelopesById, bindingErrors);
  if (bindingErrors.length) throw new Error(`Invalid merge artifact binding:\n- ${bindingErrors.join("\n- ")}`);
  const merged = structuredClone(assessment);
  const existingIds = new Set(merged.assessment.results.map((item) => item.requirement_id));
  const screeningResults = [];
  const humanReviews = new Map();
  const reviewerNames = new Set();
  const reviewDates = [];
  for (const artifact of sorted) {
    if (artifact.artifact_type === "screening-observations") {
      for (const observation of [...artifact.payload.observations].sort((left, right) => compareText(left.requirement_id, right.requirement_id))) {
        if (existingIds.has(observation.requirement_id)) throw new Error(`Duplicate screening requirement ID conflict: ${observation.requirement_id}`);
        existingIds.add(observation.requirement_id);
        screeningResults.push({
          requirement_id: observation.requirement_id,
          requirement_kind: "screening_check",
          requirement_source: "",
          mapping_status: "unverified",
          outcome: "cant_tell",
          method_kind: "automated",
          method: observation.method,
          evidence: [{ type: "other", location: observation.location, observation: observation.observation, captured_at: observation.captured_at }],
          notes: `Unverified ${observation.evidence_level} screening observation; no profile outcome was recorded.`
        });
      }
    } else if (artifact.artifact_type === "declared-human-review") {
      if (artifact.producer.role_id !== "declared_external_human" || artifact.producer.producer_kind !== "external_human") {
        throw new Error("Only declared_external_human may merge a declared profile outcome.");
      }
      reviewerNames.add(artifact.payload.reviewer_name);
      reviewDates.push(artifact.payload.review_date);
      for (const review of artifact.payload.reviews) {
        if (humanReviews.has(review.requirement_id)) throw new Error(`Duplicate declared-human profile row conflict: ${review.requirement_id}`);
        const index = merged.assessment.results.findIndex((item) => item.requirement_kind === "profile_requirement" && item.requirement_id === review.requirement_id);
        if (index < 0) throw new Error(`Exact profile row is not registered for declared human review: ${review.requirement_id}`);
        humanReviews.set(review.requirement_id, review);
        const current = merged.assessment.results[index];
        merged.assessment.results[index] = {
          ...current,
          mapping_status: "human_verified",
          outcome: review.profile_outcome,
          method_kind: "manual",
          method_ref: expectedMethodRef(review.requirement_id, resources, run.profile.id),
          method: `Declared external human review: ${review.rationale}`,
          evidence: structuredClone(review.target_specific_evidence),
          notes: review.rationale
        };
      }
    }
  }
  screeningResults.sort((left, right) => compareText(left.requirement_id, right.requirement_id));
  merged.assessment.results.push(...screeningResults);
  const reflectedProfileIds = merged.assessment.results
    .filter((item) => item.requirement_kind === "profile_requirement" && (item.mapping_status === "human_verified" || item.outcome !== "not_tested"))
    .map((item) => item.requirement_id)
    .sort(compareText);
  const declaredReviewIds = [...humanReviews.keys()].sort(compareText);
  if (!isDeepStrictEqual(reflectedProfileIds, declaredReviewIds)) {
    throw new Error("Merged assessment profile outcomes must exactly match the current run declared review set.");
  }
  if (humanReviews.size) {
    merged.assessment.evidence_level = "E2";
    merged.assessment.evaluator = [...reviewerNames].sort(compareText).join(", ");
    merged.assessment.evaluated_at = reviewDates.sort(compareText).at(-1);
    const identityLimitation = "External human reviewer identity was declared but not authenticated (identity_authenticated: false).";
    if (!merged.assessment.limitations.includes(identityLimitation)) merged.assessment.limitations.push(identityLimitation);
  } else if (screeningResults.length && merged.assessment.evidence_level === "E0") {
    merged.assessment.evidence_level = "E1";
  }
  const sortedRemediationItems = remediationItems(suppliedEnvelopesById);
  const verifiedFailureRequirements = new Set(sortedRemediationItems
    .filter(({ item }) => item.basis === "verified_failure")
    .map(({ item }) => item.requirement_id));
  for (const [requirementId, review] of humanReviews) {
    if (review.profile_outcome === "fail" && !verifiedFailureRequirements.has(requirementId)) {
      throw new Error(`Human fail requires a matching verified_failure remediation item: ${requirementId}.`);
    }
  }
  merged.assessment.findings = sortedRemediationItems
    .filter(({ item }) => item.basis === "verified_failure")
    .map(({ item }) => ({
      id: item.remediation_id,
      priority: item.priority,
      requirement_ids: [item.requirement_id],
      location: item.location,
      affected_users: structuredClone(item.affected_users),
      observation: item.issue,
      remediation: item.proposed_change,
      verification: item.verification
    }));
  for (const { item } of sortedRemediationItems) {
    if (!merged.assessment.limitations.includes(item.residual_limitation)) {
      merged.assessment.limitations.push(item.residual_limitation);
    }
  }
  validateAssessmentOrThrow(merged, resources, "Merged assessment failed existing assessment validation");
  return merged;
}

export { defaultSkillRoot };
