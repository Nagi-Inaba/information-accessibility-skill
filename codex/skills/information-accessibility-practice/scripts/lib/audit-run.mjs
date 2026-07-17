import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import { validateAssessment } from "../validate-assessment.mjs";
import { validateJsonSchema } from "./json-schema.mjs";

const defaultSkillRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0);

function pathKey(value) {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
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

function removeCreatedOutput(inspected, writtenIdentity) {
  if (!writtenIdentity) return;
  const parentIdentity = directoryIdentity(fs.statSync(path.dirname(inspected.absolute), { bigint: true }));
  if (!sameIdentity(inspected.parentIdentity, parentIdentity)) throw new Error(`Output parent identity changed; refusing unsafe cleanup: ${path.dirname(inspected.absolute)}`);
  const stats = fs.lstatSync(inspected.absolute);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`Output identity changed; refusing unsafe cleanup: ${inspected.absolute}`);
  const currentIdentity = statIdentity(fs.statSync(inspected.absolute, { bigint: true }));
  if (!sameIdentity(writtenIdentity, currentIdentity)) throw new Error(`Output file identity changed; refusing unsafe cleanup: ${inspected.absolute}`);
  fs.unlinkSync(inspected.absolute);
}

export function writeNewJson(output, value, hooks = {}) {
  const inspected = inspectSafeOutput(output);
  let descriptor;
  let writtenIdentity;
  try {
    descriptor = fs.openSync(inspected.absolute, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow, 0o600);
    writtenIdentity = statIdentity(fs.fstatSync(descriptor, { bigint: true }));
    const currentParent = directoryIdentity(fs.statSync(path.dirname(inspected.absolute), { bigint: true }));
    if (!sameIdentity(inspected.parentIdentity, currentParent)) throw new Error(`Unsafe output parent changed before write: ${path.dirname(inspected.absolute)}`);
    fs.writeFileSync(descriptor, canonicalJson(value), "utf8");
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
      removeCreatedOutput(inspected, writtenIdentity);
    } catch (cleanupError) {
      throw new Error(`${error.message}; output cleanup failed: ${cleanupError.message}`);
    }
    throw error;
  }
}

export function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
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

export function loadAuditResources(skillRoot = defaultSkillRoot) {
  const names = {
    standardsRegistry: "references/standards-registry.json",
    orchestrationRegistry: "references/orchestration-registry.json",
    orchestrationSchema: "references/orchestration-registry.schema.json",
    auditRunSchema: "references/audit-run.schema.json",
    envelopeSchema: "references/audit-artifact-envelope.schema.json",
    assessmentSchema: "references/assessment-record.schema.json",
    criteriaCatalog: "references/criteria-catalog.json",
    criterionProcedures: "references/criterion-procedures.json",
    auditMethods: "references/web-audit-methods.json"
  };
  const loaded = Object.fromEntries(Object.entries(names).map(([key, relative]) => [key, readJson(relative, skillRoot)]));
  const registryErrors = [];
  validateJsonSchema(loaded.orchestrationRegistry.value, loaded.orchestrationSchema.value, "$", registryErrors);
  if (registryErrors.length) throw new Error(`Invalid installed orchestration registry:\n- ${registryErrors.join("\n- ")}`);
  const payloadSchemas = new Map();
  for (const artifactType of loaded.orchestrationRegistry.value.artifact_types) {
    if (artifactType.id === "audit-run") continue;
    payloadSchemas.set(artifactType.id, readJson(`references/${artifactType.schema_file}`, skillRoot).value);
  }
  return {
    skillRoot,
    standardsRegistry: loaded.standardsRegistry.value,
    orchestrationRegistry: loaded.orchestrationRegistry.value,
    auditRunSchema: loaded.auditRunSchema.value,
    envelopeSchema: loaded.envelopeSchema.value,
    assessmentSchema: loaded.assessmentSchema.value,
    criteriaCatalog: loaded.criteriaCatalog.value,
    criterionProcedures: loaded.criterionProcedures.value,
    auditMethods: loaded.auditMethods.value,
    payloadSchemas,
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

export function validateArtifact(artifact, resources = loadAuditResources()) {
  const errors = [];
  validateJsonSchema(artifact, resources.envelopeSchema, "$", errors);
  const payloadSchema = resources.payloadSchemas.get(artifact?.artifact_type);
  if (!payloadSchema) errors.push(`Unknown or unsupported artifact type: ${String(artifact?.artifact_type)}`);
  else validateJsonSchema(artifact?.payload, payloadSchema, "$.payload", errors);
  const role = roleFor(resources, artifact?.producer?.role_id);
  if (!role) errors.push(`Unknown producer role: ${String(artifact?.producer?.role_id)}`);
  else {
    if (role.producer_kind !== artifact.producer?.producer_kind) errors.push(`Producer kind does not match role ${role.id}.`);
    if (role.output_type !== artifact.artifact_type) errors.push(`Producer role ${role.id} cannot output ${String(artifact.artifact_type)}.`);
    if (!role.can_record_profile_outcome && containsProfileOutcome(artifact.payload)) {
      errors.push(`Producer role ${role.id} cannot record a profile outcome.`);
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

function validateHistory(run, resources, artifactsById, errors) {
  let current = "initialized";
  let previousAt = "";
  const representedTypes = new Set();
  for (const [index, entry] of (run.history ?? []).entries()) {
    const location = `history[${index}]`;
    if (entry.from !== current) errors.push(`${location} continuity error: expected from ${current}, received ${String(entry.from)}.`);
    const transition = resources.orchestrationRegistry.transitions.find((item) => item.from === entry.from && item.to === entry.to);
    if (!transition) errors.push(`${location} contains an invalid transition ${String(entry.from)} -> ${String(entry.to)}.`);
    if (previousAt && entry.at < previousAt) errors.push(`${location}.at is earlier than the preceding history entry.`);
    previousAt = entry.at ?? previousAt;
    const referenced = (entry.artifact_ids ?? []).map((id) => artifactsById.get(id));
    for (const [artifactIndex, artifact] of referenced.entries()) {
      if (!artifact) errors.push(`${location}.artifact_ids[${artifactIndex}] is not a registered artifact: ${entry.artifact_ids[artifactIndex]}.`);
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
  if (run.status !== current) errors.push(`Run status/history continuity error: status is ${String(run.status)} but history ends at ${current}.`);
  for (const artifact of run.artifacts ?? []) {
    if (!representedTypes.has(artifact.artifact_type)) errors.push(`Registered artifact type is not represented by run history: ${artifact.artifact_type} (${artifact.artifact_id}).`);
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
  validateJsonSchema(run, resources.auditRunSchema, "$", errors);
  for (const [key, expected] of Object.entries(resources.resourceVersions)) {
    if (run?.resource_versions?.[key] !== expected) errors.push(`resource_versions.${key} must match the exact installed resource hash or version ${expected}.`);
  }
  const profile = resources.standardsRegistry.profiles.find((item) => item.id === run?.profile?.id);
  if (!profile?.assessment_configuration?.active) errors.push(`Run profile must be a known active profile: ${String(run?.profile?.id)}.`);
  let artifactRoot;
  try {
    artifactRoot = artifactRootFor(run, runFile);
  } catch (error) {
    errors.push(error.message);
  }
  const artifacts = Array.isArray(run?.artifacts) ? run.artifacts : [];
  const artifactIds = new Set();
  const artifactPaths = new Set();
  const canonicalArtifactPaths = new Set();
  const artifactsById = new Map();
  const envelopesById = new Map();
  for (const [index, entry] of artifacts.entries()) {
    const location = `artifacts[${index}]`;
    if (entry.validation_status !== "valid") errors.push(`${location}.validation_status must be valid for a registered artifact.`);
    if (artifactIds.has(entry.artifact_id)) errors.push(`Duplicate artifact ID: ${entry.artifact_id}.`);
    artifactIds.add(entry.artifact_id);
    const normalizedPath = typeof entry.path === "string" ? entry.path.replace(/\\/gu, "/") : String(entry.path);
    if (artifactPaths.has(normalizedPath)) errors.push(`Duplicate artifact path: ${normalizedPath}.`);
    artifactPaths.add(normalizedPath);
    artifactsById.set(entry.artifact_id, entry);
    if (!artifactRoot) continue;
    try {
      const file = registeredArtifactPath(artifactRoot, entry);
      const canonicalPath = pathKey(file);
      if (canonicalArtifactPaths.has(canonicalPath)) errors.push(`Duplicate canonical artifact path: ${entry.path}.`);
      canonicalArtifactPaths.add(canonicalPath);
      const snapshot = readStableFile(file, { label: `registered artifact ${entry.artifact_id}` });
      if (snapshot.sha256 !== entry.sha256) errors.push(`Registered artifact current hash mismatch: ${entry.artifact_id}.`);
      const envelope = parseJsonBytes(snapshot.bytes, `registered artifact ${entry.artifact_id}`);
      envelopesById.set(entry.artifact_id, { envelope, snapshot });
      const validation = validateArtifact(envelope, resources);
      errors.push(...validation.errors.map((error) => `${location}: ${error}`));
      if (envelope.artifact_id !== entry.artifact_id || envelope.artifact_type !== entry.artifact_type || envelope.producer?.role_id !== entry.producer_role || envelope.created_at !== entry.created_at) {
        errors.push(`Registered artifact metadata does not match its envelope: ${entry.artifact_id}.`);
      }
      if (envelope.run_id !== run.run_id) errors.push(`Registered artifact belongs to another run: ${entry.artifact_id}.`);
    } catch (error) {
      errors.push(error.message);
    }
  }
  const sortedIds = [...artifacts].sort((left, right) => compareText(left.artifact_id, right.artifact_id)).map((entry) => entry.artifact_id);
  if (!isDeepStrictEqual(artifacts.map((entry) => entry.artifact_id), sortedIds)) errors.push("Run artifacts must be sorted by artifact_id.");
  for (const [artifactId, record] of envelopesById) {
    const role = roleFor(resources, record.envelope.producer.role_id);
    const allowedInputTypes = new Set(role?.input_types ?? []);
    for (const input of record.envelope.inputs) {
      if (input.run_id !== run.run_id) errors.push(`Artifact input must belong to the same run: ${artifactId} -> ${input.artifact_id}.`);
      const registered = artifactsById.get(input.artifact_id);
      if (!registered) {
        errors.push(`Artifact input is missing or not registered: ${artifactId} -> ${input.artifact_id}.`);
        continue;
      }
      if (registered.sha256 !== input.sha256) errors.push(`Artifact input SHA-256 hash mismatch: ${artifactId} -> ${input.artifact_id}.`);
      if (!allowedInputTypes.has(registered.artifact_type)) errors.push(`Producer role ${role.id} does not allow input type ${registered.artifact_type}.`);
      if (registered.created_at > record.envelope.created_at) errors.push(`Artifact input was created after its consumer: ${artifactId} -> ${input.artifact_id}.`);
    }
  }
  validateHistory(run, resources, artifactsById, errors);
  return { valid: errors.length === 0, errors, resources, artifactRoot, envelopesById };
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
  const allowedActions = ["inspect_without_mutation"];
  if (network === "allowlisted") allowedActions.push("read_allowlisted_resources");
  if (interaction === "human_supervised") allowedActions.push("human_supervised_interaction");
  if (sourceWrite === "authorized_only") allowedActions.push("write_authorized_files");
  const forbiddenActions = ["execute_commands"];
  if (network === "allowlisted") forbiddenActions.push("network_outside_allowlist");
  else forbiddenActions.push("network_access");
  if (sourceWrite === "denied") forbiddenActions.push("write_target");
  const run = {
    schema_version: "1.0.0",
    run_id: options.runId,
    supersedes_run_id: options.supersedesRunId ?? null,
    status: "initialized",
    target: { name: options.targetName, version_or_commit: options.targetVersion, urls_or_files: targetRefs },
    profile: { id: profile.id, registry_version: resources.standardsRegistry.schema_version },
    scope: { included: targetRefs, excluded: [], complete_processes: [], third_party_content: [], full_pages_reviewed: false },
    environment: { os: ["not_declared"], browsers: [], assistive_technologies: [], input_modes: [] },
    permissions: {
      network,
      interaction,
      source_write: sourceWrite,
      allowed_actions: allowedActions.sort(compareText),
      forbidden_actions: forbiddenActions.sort(compareText)
    },
    resource_versions: resources.resourceVersions,
    artifact_root: relativeRoot.split(path.sep).join("/"),
    artifacts: [],
    history: [],
    limitations: ["The environment was not declared; no profile outcome has been recorded."]
  };
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
  const artifactPath = resolveInside(validation.artifactRoot, options.artifactFile);
  const relativePath = path.relative(validation.artifactRoot, artifactPath).split(path.sep).join("/");
  if (run.artifacts.some((entry) => pathKey(registeredArtifactPath(validation.artifactRoot, entry)) === pathKey(artifactPath))) {
    throw new Error(`Duplicate artifact path: ${relativePath}`);
  }
  const snapshot = readStableFile(artifactPath, { label: "artifact file" });
  const installedArtifact = parseJsonBytes(snapshot.bytes, "artifact file");
  if (artifact !== undefined && !isDeepStrictEqual(artifact, installedArtifact)) throw new Error("Artifact object does not match the exact artifact file bytes.");
  const artifactValidation = validateArtifact(installedArtifact, validation.resources);
  if (!artifactValidation.valid) throw new Error(`Invalid artifact:\n- ${artifactValidation.errors.join("\n- ")}`);
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

function expectedMethodRef(requirementId, resources) {
  const record = Object.values(resources.criteriaCatalog.catalogs).flat().find((item) => item.id === requirementId);
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

export function mergeArtifacts({ run, assessment, artifacts, registries }) {
  const resources = registries ?? loadAuditResources();
  validateAssessmentOrThrow(assessment, resources, "Invalid input assessment");
  if (assessment.assessment.profile.id !== run.profile.id || assessment.assessment.profile.registry_version !== run.profile.registry_version) {
    throw new Error("Assessment profile does not match the audit run.");
  }
  if (!isDeepStrictEqual(assessment.assessment.target, run.target)) throw new Error("Assessment target does not match the audit run.");
  if (!isDeepStrictEqual(assessment.assessment.scope, run.scope)) throw new Error("Assessment scope does not match the audit run.");
  if (!isDeepStrictEqual(assessment.assessment.environment, run.environment)) throw new Error("Assessment environment does not match the audit run.");
  const registered = new Map(run.artifacts.map((entry) => [entry.artifact_id, entry]));
  const suppliedIds = new Set();
  const sorted = [...artifacts].sort((left, right) => compareText(left.artifact_type, right.artifact_type) || compareText(left.artifact_id, right.artifact_id));
  for (const artifact of sorted) {
    if (suppliedIds.has(artifact.artifact_id)) throw new Error(`Duplicate supplied artifact ID: ${artifact.artifact_id}`);
    suppliedIds.add(artifact.artifact_id);
    const artifactValidation = validateArtifact(artifact, resources);
    if (!artifactValidation.valid) throw new Error(`Invalid merge artifact ${artifact.artifact_id}:\n- ${artifactValidation.errors.join("\n- ")}`);
    const entry = registered.get(artifact.artifact_id);
    if (!entry) throw new Error(`Merge artifact is not registered in the run: ${artifact.artifact_id}`);
    if (entry.artifact_type !== artifact.artifact_type || entry.producer_role !== artifact.producer.role_id || artifact.run_id !== run.run_id) {
      throw new Error(`Merge artifact metadata does not match its registered run entry: ${artifact.artifact_id}`);
    }
    if (!(resources.artifact_sha256_by_id instanceof Map)) throw new Error("Pure merge requires an exact artifact hash map and fails closed without one.");
    const exactHash = resources.artifact_sha256_by_id.get(artifact.artifact_id);
    if (!exactHash || exactHash !== entry.sha256) throw new Error(`Merge artifact exact current hash mismatch: ${artifact.artifact_id}`);
  }
  const registeredIds = [...registered.keys()].sort(compareText);
  const suppliedRegisteredIds = [...suppliedIds].sort(compareText);
  if (!isDeepStrictEqual(suppliedRegisteredIds, registeredIds)) {
    const omitted = registeredIds.filter((id) => !suppliedIds.has(id));
    throw new Error(`Merge requires the complete registered artifact set; missing registered artifacts: ${omitted.join(", ")}`);
  }
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
          method_ref: expectedMethodRef(review.requirement_id, resources),
          method: `Declared external human review: ${review.rationale}`,
          evidence: structuredClone(review.target_specific_evidence),
          notes: review.rationale
        };
      }
    }
  }
  screeningResults.sort((left, right) => compareText(left.requirement_id, right.requirement_id));
  merged.assessment.results.push(...screeningResults);
  if (humanReviews.size) {
    merged.assessment.evidence_level = "E2";
    merged.assessment.evaluator = [...reviewerNames].sort(compareText).join(", ");
    merged.assessment.evaluated_at = reviewDates.sort(compareText).at(-1);
    const identityLimitation = "External human reviewer identity was declared but not authenticated (identity_authenticated: false).";
    if (!merged.assessment.limitations.includes(identityLimitation)) merged.assessment.limitations.push(identityLimitation);
  } else if (screeningResults.length && merged.assessment.evidence_level === "E0") {
    merged.assessment.evidence_level = "E1";
  }
  validateAssessmentOrThrow(merged, resources, "Merged assessment failed existing assessment validation");
  return merged;
}

export { defaultSkillRoot };
