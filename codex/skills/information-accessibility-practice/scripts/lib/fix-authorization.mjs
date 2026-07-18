import fs from "node:fs";
import path from "node:path";

import { loadAuditResources, validateArtifact, validateAuditRun } from "./audit-run.mjs";

const EXACT_RUN_VERSION = "4.0.0";
const EXACT_AUTH_PAYLOAD_VERSION = "2.0.0";
const FIX_AUTH_ARTIFACT_TYPE = "fix-authorization";
const REQUIRED_FIX_AUTH_PRODUCER_ROLE = "declared_authorizer";
const REQUIRED_FIX_AUTH_PRODUCER_KIND = "external_requester";
const REQUIRED_FIX_AUTH_PRODUCER_ORIGIN = "external_input";
const REQUIRED_SOURCE_PERMISSION = "authorized_only";
const REQUIRED_COMMAND_PERMISSION = "authorized_verification_only";
const REQUIRED_FIX_AUTH_PAYLOAD_DISPATCH = "2.0.0";
const REQUIRED_REMEDIATION_ARTIFACT_TYPE = "remediation-plan";
const ALLOWED_OPERATIONS = new Set(["create", "modify", "delete"]);

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const RESERVED_DEVICE_BASENAME = /^(CON|PRN|AUX|NUL|CLOCK\$|COM[1-9]|LPT[1-9])(?:\..*)?$/i;
const WINDOWSSHELL_DENY = /[*?"]/;

function hasTextualValue(value) {
  return typeof value === "string";
}

function hasControlChar(value) {
  return /[\u0000-\u001f]/.test(value);
}

function normalizeAndValidateCandidatePath(candidate, errors, label) {
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    addError(errors, `${label} must be a non-empty file path string`);
    return { normalized: null };
  }

  if (candidate.includes(":")) {
    addError(errors, `${label} must not contain ':'`);
    return { normalized: null };
  }

  if (candidate.startsWith("\\\\")) {
    addError(errors, `${label} must not be UNC or extended-path namespace`);
    return { normalized: null };
  }
  if (path.posix.isAbsolute(candidate) || path.win32.isAbsolute(candidate) || /^[A-Za-z]:[^\\/]/.test(candidate)) {
    addError(errors, `${label} must be a relative path under source root`);
    return { normalized: null };
  }
  if (candidate.includes("//") || candidate.includes("\\\\")) {
    addError(errors, `${label} must not contain empty path segments`);
    return { normalized: null };
  }
  if (hasControlChar(candidate) || WINDOWSSHELL_DENY.test(candidate)) {
    addError(errors, `${label} contains forbidden shell/control characters`);
  }

  const segments = candidate.split(/[\\/]+/);
  if (!segments.length) {
    addError(errors, `${label} must be a relative path`);
    return { normalized: null };
  }

  const safeSegments = [];
  for (const segment of segments) {
    if (!hasTextualValue(segment) || segment.length === 0) {
      addError(errors, `${label} must not contain empty path segments`);
      return { normalized: null };
    }
    if (segment === "." || segment === "..") {
      addError(errors, `${label} must not contain relative traversal segments`);
      return { normalized: null };
    }
    if (segment.endsWith(".") || segment.endsWith(" ")) {
      addError(errors, `${label} has invalid segment ending`);
      return { normalized: null };
    }
    const segmentBase = segment.split(".")[0];
    if (RESERVED_DEVICE_BASENAME.test(segmentBase) || RESERVED_DEVICE_BASENAME.test(segment)) {
      addError(errors, `${label} uses reserved device-style segment`);
      return { normalized: null };
    }
    safeSegments.push(segment);
  }

  return { normalized: safeSegments.join("/") };
}

function canonicalSourceDirectory(rootPath, errors) {
  const messages = [];
  const localOnly = rootPath;
  if (!hasTextualValue(localOnly)) {
    messages.push(`${localOnly} is not a valid source root`);
    errors.push(...messages);
    return { valid: false, messages, canonical: null };
  }
  if (typeof localOnly !== "string") {
    messages.push("source root must be a string");
    errors.push(...messages);
    return { valid: false, messages, canonical: null };
  }
  if (localOnly.startsWith("\\\\") || localOnly.startsWith("//")) {
    messages.push("source root must not be UNC");
    errors.push(...messages);
    return { valid: false, messages, canonical: null };
  }
  let entryStat;
  try {
    entryStat = fs.lstatSync(localOnly);
  } catch {
    messages.push("--source-root and authorization.payload.source_root must both resolve to existing directories.");
    errors.push(...messages);
    return { valid: false, messages, canonical: null };
  }
  if (!entryStat.isDirectory()) {
    messages.push("source root from --source-root is not a directory");
    errors.push(...messages);
    return { valid: false, messages, canonical: null };
  }
  if (entryStat.isSymbolicLink()) {
    messages.push("source root must not be a symlink/junction");
    errors.push(...messages);
    return { valid: false, messages, canonical: null };
  }
  try {
    const entry = { valid: true, messages, canonical: fs.realpathSync(localOnly) };
    errors.push(...messages);
    return entry;
  } catch {
    messages.push("--source-root and authorization.payload.source_root must both resolve to existing directories.");
    errors.push(...messages);
    return { valid: false, messages, canonical: null };
  }
}

function canonicalPath(filePath) {
  return path.resolve(filePath);
}

function fileIsUnderRoot(targetPath, rootPath) {
  const target = canonicalPath(targetPath);
  const root = canonicalPath(rootPath);
  if (target === root) return true;
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const normalized = relative.split(path.sep).join("/");
  return !normalized.startsWith("..") && !path.isAbsolute(normalized);
}

function relativePath(targetPath, rootPath) {
  return path.relative(canonicalPath(rootPath), canonicalPath(targetPath)).split(path.sep).join("/");
}

function addError(errors, message) {
  errors.push(message);
}

function verifyVerificationCommands(verificationCommands, errors, warnings) {
  if (!Array.isArray(verificationCommands) || verificationCommands.length === 0) {
    errors.push("verification_commands must be a non-empty array");
    return;
  }
  verificationCommands.forEach((command, index) => {
    const prefix = `verification_commands[${index}]`;
    if (!hasText(typeof command?.command_id === "string" ? command.command_id : "")) addError(errors, `${prefix}.command_id is required`);
    if (!hasText(typeof command?.executable === "string" ? command.executable : "")) addError(errors, `${prefix}.executable is required`);
    if (!Array.isArray(command?.args)) addError(errors, `${prefix}.args must be an array`);
    if (!hasText(typeof command?.cwd === "string" ? command.cwd : "")) addError(errors, `${prefix}.cwd is required`);
  });
}

function requestedRelativePath(targetFile, sourceRoot) {
  if (!hasText(targetFile) || !hasText(sourceRoot)) return null;
  const source = fs.realpathSync(sourceRoot);
  const candidate = path.isAbsolute(targetFile)
    ? path.resolve(targetFile)
    : path.resolve(source, ...String(targetFile).split(/[\\/]+/u));
  const relative = path.relative(source, candidate);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) return null;
  return relative.split(path.sep).join("/");
}

function validateChangeBindings(payload, operation, targetFile, sourceRoot, errors) {
  const bindings = asArray(payload.change_bindings);
  if (bindings.length === 0) {
    addError(errors, "authorization.payload.change_bindings must be a non-empty array");
    return;
  }
  const seen = new Set();
  for (const [index, binding] of bindings.entries()) {
    const key = `${binding?.path ?? ""}\u0000${binding?.operation ?? ""}`;
    if (seen.has(key)) addError(errors, `authorization.payload.change_bindings has duplicate path and operation at index ${index}`);
    seen.add(key);
    if (!asArray(payload.allowed_paths).includes(binding?.path)) {
      addError(errors, `authorization.payload.change_bindings[${index}].path must be listed in allowed_paths`);
    }
    if (!asArray(payload.allowed_operations).includes(binding?.operation)) {
      addError(errors, `authorization.payload.change_bindings[${index}].operation must be listed in allowed_operations`);
    }
  }
  let relative;
  try {
    relative = requestedRelativePath(targetFile, sourceRoot);
  } catch {
    return;
  }
  if (relative && operation && !bindings.some((binding) => binding?.path === relative && binding?.operation === operation)) {
    addError(errors, `authorization.payload.change_bindings must include the requested ${operation} operation for ${relative}`);
  }
}

export function authorizedChangeBinding({ authorization, targetFile, sourceRoot, operation }) {
  const relative = requestedRelativePath(targetFile, sourceRoot);
  return asArray(authorization?.payload?.change_bindings).find((binding) => binding?.path === relative && binding?.operation === operation) ?? null;
}

function validateRunPermissions(run, errors, warnings) {
  const permissions = run?.permissions ?? {};
  if (permissions.source_write !== REQUIRED_SOURCE_PERMISSION) {
    addError(errors, `run.permissions.source_write must be ${REQUIRED_SOURCE_PERMISSION}`);
  }
  if (permissions.command_execution !== REQUIRED_COMMAND_PERMISSION) {
    addError(errors, `run.permissions.command_execution must be ${REQUIRED_COMMAND_PERMISSION}`);
  }
  if (!asArray(permissions?.allowed_actions).includes("write_authorized_files")) {
    addError(errors, "run.permissions.allowed_actions must include write_authorized_files");
  }
  if (!asArray(permissions?.allowed_actions).includes("execute_authorized_verification_commands")) {
    addError(errors, "run.permissions.allowed_actions must include execute_authorized_verification_commands");
  }
  if (asArray(permissions?.forbidden_actions).includes("execute_unapproved_commands")) {
    warnings.push("run.permissions.forbidden_actions includes execute_unapproved_commands");
  }
}

function validateAuthorizationEnvelope(authorization, resources, errors, warnings, operation) {
  if (!authorization || typeof authorization !== "object") {
    addError(errors, "authorization envelope is required");
    return;
  }
  if (authorization.artifact_type !== FIX_AUTH_ARTIFACT_TYPE) {
    addError(errors, `authorization artifact_type must be ${FIX_AUTH_ARTIFACT_TYPE}`);
  }
  if (authorization.producer?.role_id !== REQUIRED_FIX_AUTH_PRODUCER_ROLE) {
    addError(errors, `authorization.producer.role_id must be ${REQUIRED_FIX_AUTH_PRODUCER_ROLE}`);
  }
  if (authorization.producer?.producer_kind !== REQUIRED_FIX_AUTH_PRODUCER_KIND) {
    addError(errors, `authorization.producer.producer_kind must be ${REQUIRED_FIX_AUTH_PRODUCER_KIND}`);
  }
  if (authorization.producer?.origin !== REQUIRED_FIX_AUTH_PRODUCER_ORIGIN) {
    addError(errors, `authorization.producer.origin must be ${REQUIRED_FIX_AUTH_PRODUCER_ORIGIN}`);
  }

  const artifactValidation = validateArtifact(authorization, resources, {
    allowedPayloadVersions: resources.currentPayloadVersions
  });
  if (!artifactValidation.valid) {
    errors.push(...artifactValidation.errors.map((item) => `authorization artifact: ${item}`));
  }

  const payload = authorization.payload ?? {};
  if (!hasText(payload.authorization_id)) addError(errors, "authorization.payload.authorization_id is required");
  if (!hasText(payload.run_id)) addError(errors, "authorization.payload.run_id is required");
  if (payload.authorizer_role !== REQUIRED_FIX_AUTH_PRODUCER_ROLE) addError(errors, `authorization.payload.authorizer_role must be ${REQUIRED_FIX_AUTH_PRODUCER_ROLE}`);
  if (payload.authorizer_kind !== REQUIRED_FIX_AUTH_PRODUCER_KIND) addError(errors, `authorization.payload.authorizer_kind must be ${REQUIRED_FIX_AUTH_PRODUCER_KIND}`);
  if (!hasText(payload.approved_by)) addError(errors, "authorization.payload.approved_by is required");
  if (!hasText(payload.approved_at)) addError(errors, "authorization.payload.approved_at is required");
  if (payload.identity_authenticated !== false) addError(errors, "authorization.payload.identity_authenticated must be false");
  if (payload.identity_authenticated === false) {
    warnings.push("Identity is not authenticated; do not infer authenticated identity from this authorization.");
  }
  if (!hasText(payload.source_root)) addError(errors, "authorization.payload.source_root is required");
  if (!Array.isArray(payload.allowed_paths) || payload.allowed_paths.length === 0) {
    addError(errors, "authorization.payload.allowed_paths is required");
  } else if (new Set(payload.allowed_paths.filter((value) => hasText(value)).map((value) => String(value)).filter((value) => value)).size !== payload.allowed_paths.length) {
    addError(errors, "authorization.payload.allowed_paths must be unique");
  }
  if (!Array.isArray(payload.allowed_operations) || payload.allowed_operations.length === 0) {
    addError(errors, "authorization.payload.allowed_operations must be a non-empty array");
  } else {
    const normalizedAllowedOperations = payload.allowed_operations.map((value) => String(value ?? "").trim()).filter((value) => hasText(value));
    for (const item of normalizedAllowedOperations) {
      if (!ALLOWED_OPERATIONS.has(item)) {
        addError(errors, `authorization.payload.allowed_operations contains unsupported value: ${item}`);
      }
    }
    if (!normalizedAllowedOperations.includes(operation)) {
      addError(errors, `authorization.payload.allowed_operations must include the requested operation ${operation}`);
    }
    if (normalizedAllowedOperations.includes("create") && normalizedAllowedOperations.length > 1) {
      warnings.push("authorization.payload.allowed_operations contains operation subset beyond create; this is accepted.");
    }
  }
  verifyVerificationCommands(payload.verification_commands, errors, warnings);
  if (!payload.remediation_artifact || typeof payload.remediation_artifact !== "object") {
    addError(errors, "authorization.payload.remediation_artifact is required");
  } else {
    if (!hasText(payload.remediation_artifact.artifact_id)) addError(errors, "authorization.payload.remediation_artifact.artifact_id is required");
    if (!hasText(payload.remediation_artifact.sha256) || !/^[0-9a-f]{64}$/i.test(payload.remediation_artifact.sha256)) {
      addError(errors, "authorization.payload.remediation_artifact.sha256 must be a SHA-256 hex value");
    }
  }
}

function validateRunCompliance(runValidation, run, errors, warnings) {
  if (!runValidation.valid) {
    errors.push(...runValidation.errors.map((item) => `audit run invalid: ${item}`));
    return;
  }
  if (run?.schema_version !== EXACT_RUN_VERSION) {
    addError(errors, `run.schema_version must be exactly ${EXACT_RUN_VERSION}`);
  }
  if (runValidation.resources?.orchestrationRegistry?.schema_version !== "3.0.0") {
    addError(errors, "run must use orchestration registry version 3.0.0");
  }
  if (runValidation.resources?.currentPayloadVersions?.get(FIX_AUTH_ARTIFACT_TYPE) !== REQUIRED_FIX_AUTH_PAYLOAD_DISPATCH) {
    addError(errors, `fix-authorization dispatch must be ${REQUIRED_FIX_AUTH_PAYLOAD_DISPATCH}`);
  }
  validateRunPermissions(run, errors, warnings);
}

function validateRemediationBinding(authorization, run, errors) {
  const payload = authorization.payload ?? {};
  const artifactMatch = asArray(run?.artifacts).find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return entry.artifact_id === payload.remediation_artifact?.artifact_id && entry.sha256 === payload.remediation_artifact?.sha256;
  });
  if (!artifactMatch) {
    addError(errors, "authorization.payload.remediation_artifact must match a registered run artifact by artifact_id and sha256");
    return;
  }
  if (artifactMatch.artifact_type !== REQUIRED_REMEDIATION_ARTIFACT_TYPE) {
    addError(errors, "authorization.payload.remediation_artifact must reference a remediation-plan artifact");
  }
}

function pathIsUnderRoot(targetPath, rootPath) {
  if (!targetPath || !rootPath) return false;
  const relative = path.relative(rootPath, targetPath);
  if (path.isAbsolute(relative)) return false;
  if (relative.startsWith("..")) return false;
  return true;
}

export function validateAuthorizedTarget({ authorization, targetFile, sourceRoot, operation }) {
  const errors = [];
  const warnings = [];
  const payload = authorization?.payload ?? {};
  if (!hasText(payload.source_root)) {
    errors.push("authorization.payload.source_root is required");
    return { errors, warnings };
  }
  if (!hasText(sourceRoot)) {
    errors.push("--source-root is required");
    return { errors, warnings };
  }

  if (/\s/.test(targetFile) && targetFile.trim() !== targetFile) {
    warnings.push("target path includes leading or trailing spaces");
  }

  const validatedSourceRoot = canonicalSourceDirectory(sourceRoot, errors);
  const validatedAuthSourceRoot = canonicalSourceDirectory(payload.source_root, errors);
  if (!validatedSourceRoot.valid || !validatedAuthSourceRoot.valid) {
    return { errors, warnings };
  }

  if (validatedSourceRoot.canonical !== validatedAuthSourceRoot.canonical) {
    errors.push("source root from --source-root does not exactly match authorization.payload.source_root");
    return { errors, warnings };
  }

  const canonicalSourceRoot = validatedSourceRoot.canonical;
  const canonicalAuthSourceRoot = validatedAuthSourceRoot.canonical;

  let targetCandidate = targetFile;
  if (path.isAbsolute(targetCandidate)) {
    const relativeFromRoot = path.relative(canonicalAuthSourceRoot, targetCandidate);
    if (!relativeFromRoot) {
      errors.push("target must not be source root");
      return { errors, warnings };
    }
    if (relativeFromRoot.startsWith(`..${path.sep}`) || relativeFromRoot === ".." || path.isAbsolute(relativeFromRoot)) {
      errors.push("target is outside the supplied source root");
      return { errors, warnings };
    }
    targetCandidate = relativeFromRoot;
  }

  const normalizedTarget = normalizeAndValidateCandidatePath(targetCandidate, errors, "target file path");
  if (!normalizedTarget.normalized) {
    return { errors, warnings };
  }

  const resolvedTarget = path.resolve(canonicalAuthSourceRoot, normalizedTarget.normalized);

  if (!pathIsUnderRoot(resolvedTarget, canonicalAuthSourceRoot)) {
    errors.push("target is outside the supplied source root");
    return { errors, warnings };
  }
  const canonicalTargetRelative = path.relative(canonicalAuthSourceRoot, resolvedTarget).split(path.sep).join("/");
  if (!canonicalTargetRelative || canonicalTargetRelative === ".") {
    errors.push("target must not be source root");
    return { errors, warnings };
  }
  if (normalizedTarget.normalized.endsWith("/") || normalizedTarget.normalized.endsWith("\\")) {
    errors.push("target must be a file path, not a directory path");
    return { errors, warnings };
  }

  if (operation === "create") {
    const parentPath = path.dirname(resolvedTarget);
    try {
      const parentStat = fs.lstatSync(parentPath);
      if (!parentStat.isDirectory()) {
        errors.push("target parent must be an existing directory for create operations");
      } else if (parentStat.isSymbolicLink()) {
        errors.push("target parent must not be a symlink/junction");
      }
      if (errors.length > 0) return { errors, warnings };
      const realParent = fs.realpathSync(parentPath);
      if (!pathIsUnderRoot(realParent, canonicalAuthSourceRoot)) {
        errors.push("target must be within source root");
        return { errors, warnings };
      }
      try {
        fs.lstatSync(resolvedTarget);
        errors.push(`target must not exist for create operations`);
      } catch (error) {
        if (error.code !== "ENOENT") {
          errors.push(`target cannot be accessed for create validation`);
        }
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        errors.push("missing intermediate directory");
      } else {
        errors.push("target parent must be an existing directory for create operations");
      }
    }
  } else if (operation === "modify" || operation === "delete") {
    let targetEntry;
    let targetStats;
    try {
      targetStats = fs.lstatSync(resolvedTarget);
    } catch (error) {
      errors.push(`target must be an existing regular file for ${operation} operations`);
      return { errors, warnings };
    }
    targetEntry = resolvedTarget;
    if (targetStats.isSymbolicLink()) {
      errors.push("target must not be a symbolic link");
      return { errors, warnings };
    }
    if (!targetStats.isFile()) {
      errors.push(`target must be an existing regular file for ${operation} operations`);
      return { errors, warnings };
    }
    if (typeof targetStats.nlink === "number" && targetStats.nlink > 1) {
      errors.push("target must be a single-link file");
    }
    try {
      const realTarget = fs.realpathSync(targetEntry);
      if (!pathIsUnderRoot(realTarget, canonicalAuthSourceRoot)) {
        errors.push("target is outside the supplied source root");
        return { errors, warnings };
      }
    } catch {
      errors.push("target must be an existing regular file for modify operations");
      return { errors, warnings };
    }
  } else {
    errors.push("operation must be create|modify|delete");
    return { errors, warnings };
  }

  if (errors.length > 0) return { errors, warnings };

  const allowedRelativeTargets = asArray(payload.allowed_paths).map((value) => String(value ?? ""));
  const relativeTarget = path.relative(canonicalAuthSourceRoot, resolvedTarget).split(path.sep).join("/");
  if (!allowedRelativeTargets.includes(relativeTarget)) {
    errors.push("target file is not covered by allowed_paths");
  }
  if (operation === "create") {
    // Ensure real path for creates is tested under an existing parent, not on target.
    const parentReal = fs.realpathSync(path.dirname(resolvedTarget));
    const canonicalCreateRelative = path.relative(canonicalAuthSourceRoot, path.join(parentReal, path.basename(resolvedTarget))).split(path.sep).join("/");
    if (!allowedRelativeTargets.includes(canonicalCreateRelative)) {
      errors.push("target file is not covered by allowed_paths");
    }
  }
  return { errors, warnings };
}

export function validateFixAuthorization(params = {}) {
  const errors = [];
  const warnings = [];
  const { authorization, run, runFile, targetFile, sourceRoot, operation } = params;

  if (!operation) {
    addError(errors, "operation is required");
  } else if (!ALLOWED_OPERATIONS.has(operation)) {
    addError(errors, "operation must be create|modify|delete");
  }
  if (!runFile) {
    addError(errors, "runFile is required");
  }
  const runValidation = run ? validateAuditRun(run, { runFile }) : { valid: false, errors: ["run payload is required"] };
  const resources = runValidation.resources ?? loadAuditResources();
  if (!run) {
    addError(errors, "run payload is required");
  }
  validateRunCompliance(runValidation, run, errors, warnings);
  validateAuthorizationEnvelope(authorization, resources, errors, warnings, operation);
  if (run && authorization) {
    const payload = authorization.payload ?? {};
    if (payload.run_id !== run.run_id) {
      addError(errors, "run_id mismatch");
    }
    if (payload.remediation_artifact?.artifact_id && payload.remediation_artifact?.sha256) {
      validateRemediationBinding(authorization, run, errors);
    }
    const targetValidation = validateAuthorizedTarget({ authorization, targetFile, sourceRoot, operation });
    targetValidation.errors.forEach((item) => errors.push(item));
    targetValidation.warnings.forEach((item) => warnings.push(item));
    validateChangeBindings(payload, operation, targetFile, sourceRoot, errors);
  }
  if (resources.currentPayloadVersions?.get(FIX_AUTH_ARTIFACT_TYPE) !== EXACT_AUTH_PAYLOAD_VERSION) {
    addError(errors, `authorization payload dispatch must be ${EXACT_AUTH_PAYLOAD_VERSION}`);
  }
  if (!authorization || authorization.payload?.schema_version !== EXACT_AUTH_PAYLOAD_VERSION) {
    addError(errors, `authorization.payload.schema_version must be exactly ${EXACT_AUTH_PAYLOAD_VERSION}`);
  }
  if (authorization?.payload?.schema_version === EXACT_AUTH_PAYLOAD_VERSION && !asArray(authorization.payload?.verification_commands).length) {
    addError(errors, "authorization.payload.verification_commands must be non-empty");
  }
  warnings.push("Direct target writes require exclusive operator control of the source tree; this runtime is not a kernel directory-handle sandbox.");

  return {
    status: errors.length === 0 ? "valid" : "invalid",
    valid: errors.length === 0,
    errors,
    warnings
  };
}
