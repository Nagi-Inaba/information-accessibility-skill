import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertStableFile,
  canonicalJson,
  loadAuditResources,
  readStableFile,
  sha256Bytes,
  validateArtifact,
  writeNewJson
} from "./audit-run.mjs";
import { validateAuthorizedTarget } from "./fix-authorization.mjs";

export const FIX_LEASE_VERSION = "1.0.0";
export const FIX_LEASE_TTL_MS = 120 * 60 * 1000;
export const DEFAULT_FIX_LEASE_DIRECTORY = path.join(os.tmpdir(), "information-accessibility-practice", "fix-leases");

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function pathKey(value) {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function samePath(left, right) {
  return pathKey(left) === pathKey(right);
}

function isStrictlyInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertNoOverlap(left, right, leftLabel, rightLabel) {
  if (samePath(left, right) || isStrictlyInside(left, right) || isStrictlyInside(right, left)) {
    throw new Error(`${leftLabel} must be outside and must not overlap ${rightLabel}.`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 value.`);
  }
}

function nowValue(now) {
  const value = typeof now === "function" ? now() : now ?? new Date();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("now must resolve to a valid timestamp.");
  return date;
}

function timestamp(value) {
  return value.toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function parseTimestamp(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be a timestamp string.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid timestamp.`);
  return parsed;
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function makeLeaseId(acquiredAt) {
  const date = acquiredAt.toISOString().slice(0, 10).replaceAll("-", "");
  return `LEASE-${date}-${randomHex(4).toUpperCase()}`;
}

function inspectExistingPathComponents(absolute, label) {
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const components = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const component of components) {
    current = path.join(current, component);
    const stats = fs.lstatSync(current);
    if (stats.isSymbolicLink()) {
      throw new Error(`${label} must not use a symbolic link, junction, or reparse point: ${current}`);
    }
  }
}

function inspectSafeDirectory(directory, label, { create = false } = {}) {
  const absolute = path.resolve(directory);
  if (create && !fs.existsSync(absolute)) {
    const missing = [];
    let cursor = absolute;
    while (!fs.existsSync(cursor)) {
      missing.push(cursor);
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new Error(`Cannot establish ${label}: ${absolute}`);
      cursor = parent;
    }
    inspectExistingPathComponents(cursor, label);
    for (const item of missing.reverse()) {
      fs.mkdirSync(item, { mode: 0o700 });
      const created = fs.lstatSync(item);
      if (!created.isDirectory() || created.isSymbolicLink()) throw new Error(`Unsafe ${label}: ${item}`);
    }
  }
  inspectExistingPathComponents(absolute, label);
  const stats = fs.lstatSync(absolute);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`${label} must be a local non-reparse directory.`);
  const real = fs.realpathSync.native(absolute);
  if (!samePath(real, absolute)) throw new Error(`${label} must not traverse a symbolic link, junction, or reparse point.`);
  return real;
}

function inspectSafeFile(file, label) {
  const absolute = path.resolve(file);
  inspectExistingPathComponents(absolute, label);
  const stats = fs.lstatSync(absolute);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} must be a local regular file.`);
  if (typeof stats.nlink === "number" && stats.nlink > 1) throw new Error(`${label} must not be a hard-linked file.`);
  const real = fs.realpathSync.native(absolute);
  if (!samePath(real, absolute)) throw new Error(`${label} must not traverse a symbolic link, junction, or reparse point.`);
  return real;
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

function validateAuthorizationEnvelope(authorization, runId) {
  const resources = loadAuditResources();
  const result = validateArtifact(authorization, resources, { allowedPayloadVersions: resources.currentPayloadVersions });
  if (!result.valid) throw new Error(`Invalid fix authorization: ${result.errors.join("; ")}`);
  if (authorization?.artifact_type !== "fix-authorization" || authorization?.payload?.schema_version !== "2.0.0") {
    throw new Error("Fix authorization must use the current fix-authorization 2.0.0 contract.");
  }
  if (authorization?.producer?.role_id !== "declared_authorizer" || authorization?.producer?.producer_kind !== "external_requester" || authorization?.producer?.origin !== "external_input") {
    throw new Error("Fix authorization must come from declared_authorizer/external_requester with external_input origin.");
  }
  if (authorization?.run_id !== runId || authorization?.payload?.run_id !== runId) {
    throw new Error("Fix authorization run ID does not match the requested lease run ID.");
  }
  if (!Array.isArray(authorization?.payload?.allowed_paths) || authorization.payload.allowed_paths.length === 0) {
    throw new Error("Fix authorization must contain at least one allowed path.");
  }
}

function canonicalSourceRoot(authorization, sourceRoot, runId) {
  validateAuthorizationEnvelope(authorization, runId);
  const supplied = inspectSafeDirectory(sourceRoot, "source root");
  const authorized = inspectSafeDirectory(authorization.payload.source_root, "authorized source root");
  if (!samePath(supplied, authorized)) throw new Error("source root must exactly match authorization.payload.source_root.");
  return supplied;
}

export function sourceRootSha256(sourceRoot) {
  const canonical = inspectSafeDirectory(sourceRoot, "source root");
  return sha256Bytes(pathKey(canonical));
}

function leasePathFor(lockDir, rootSha256) {
  return path.join(lockDir, `${rootSha256}.lease.json`);
}

function normalizedAllowedPaths(authorization) {
  const paths = authorization.payload.allowed_paths.map((value) => String(value));
  if (new Set(paths).size !== paths.length) throw new Error("allowed_paths must be unique before acquiring a lease.");
  return paths.sort((left, right) => left.localeCompare(right, "en"));
}

function collectBaseline(authorization, sourceRoot) {
  return normalizedAllowedPaths(authorization).map((relative) => {
    const target = path.resolve(sourceRoot, relative);
    if (fs.existsSync(target)) {
      const validation = validateAuthorizedTarget({ authorization, targetFile: relative, sourceRoot, operation: "modify" });
      if (validation.errors.length) throw new Error(`Unsafe allowed path ${relative}: ${validation.errors.join("; ")}`);
      const snapshot = readStableFile(target, { label: `allowed path ${relative}` });
      assertStableFile(snapshot, `allowed path ${relative}`);
      return { path: relative.split("\\").join("/"), state: "file", sha256: snapshot.sha256 };
    }
    const validation = validateAuthorizedTarget({ authorization, targetFile: relative, sourceRoot, operation: "create" });
    if (validation.errors.length) throw new Error(`Unsafe allowed path ${relative}: ${validation.errors.join("; ")}`);
    return { path: relative.split("\\").join("/"), state: "missing", sha256: null };
  });
}

function verifyBaseline(lease, authorization, sourceRoot) {
  if (!Array.isArray(lease.allowed_path_baseline) || lease.allowed_path_baseline.length === 0) {
    throw new Error("Existing lease has no allowed-path baseline; manual recovery is required.");
  }
  const current = collectBaseline(authorization, sourceRoot);
  if (canonicalJson(current) !== canonicalJson(lease.allowed_path_baseline)) {
    throw new Error("Allowed-path baseline changed; automatic recovery is denied and manual review is required.");
  }
}

function validateLeaseRecord(lease) {
  if (lease?.schema_version !== FIX_LEASE_VERSION) throw new Error("Unsupported fix lease version.");
  if (typeof lease?.lease_id !== "string" || !/^LEASE-\d{8}-[A-F0-9]{8}$/u.test(lease.lease_id)) throw new Error("Existing lease has an invalid lease ID.");
  for (const [label, value] of [
    ["lease.authorization_sha256", lease.authorization_sha256],
    ["lease.source_root_sha256", lease.source_root_sha256],
    ["lease.release_token_sha256", lease.release_token_sha256]
  ]) assertSha256(value, label);
  parseTimestamp(lease.acquired_at, "lease.acquired_at");
  parseTimestamp(lease.expires_at, "lease.expires_at");
}

function readLease(leasePath) {
  const { value, snapshot } = parseStableJson(leasePath, "fix lease");
  validateLeaseRecord(value);
  assertStableFile(snapshot, "fix lease");
  return { lease: value, snapshot };
}

function recoveryTombstonePath(leasePath, leaseId) {
  return path.join(path.dirname(leasePath), `${path.basename(leasePath)}.${leaseId}.${randomHex(8)}.recovered`);
}

function releaseTombstonePath(leasePath, leaseId) {
  return path.join(path.dirname(leasePath), `${path.basename(leasePath)}.${leaseId}.${randomHex(8)}.released`);
}

function leaseGuardPath(leasePath) {
  return `${leasePath}.guard`;
}

function assertNoLeaseGuard(leasePath) {
  const guard = leaseGuardPath(leasePath);
  if (fs.existsSync(guard)) throw new Error(`Fix lease is quarantined by a recovery/release guard; manual reconciliation is required: ${guard}`);
}

function createLeaseGuard(leasePath, operation, leaseSnapshot) {
  const guard = leaseGuardPath(leasePath);
  writeNewJson(guard, {
    schema_version: FIX_LEASE_VERSION,
    operation,
    lease_path: leasePath,
    lease_sha256: leaseSnapshot.sha256,
    process_id: process.pid,
    created_at: timestamp(new Date())
  });
  return guard;
}

function clearLeaseGuard(guard) {
  if (!guard) return;
  const snapshot = readStableFile(guard, { label: "fix lease guard" });
  assertStableFile(snapshot, "fix lease guard");
  fs.unlinkSync(snapshot.path);
}

function restoreVerifiedTombstone(tombstone, leasePath, expectedSnapshot) {
  if (!tombstone || !fs.existsSync(tombstone) || fs.existsSync(leasePath)) return false;
  const moved = readStableFile(tombstone, { label: "fix lease tombstone before restoration" });
  if (moved.sha256 !== expectedSnapshot.sha256 || !moved.bytes.equals(expectedSnapshot.bytes)) return false;
  fs.renameSync(tombstone, leasePath);
  const restored = readStableFile(leasePath, { label: "restored fix lease" });
  return restored.sha256 === expectedSnapshot.sha256 && restored.bytes.equals(expectedSnapshot.bytes);
}

function makeReceipt(lease, leasePath, leaseHash, releaseToken) {
  return {
    schema_version: FIX_LEASE_VERSION,
    lease_id: lease.lease_id,
    lease_path: leasePath,
    lease_hash: leaseHash,
    run_id: lease.run_id,
    authorization_sha256: lease.authorization_sha256,
    source_root_sha256: lease.source_root_sha256,
    acquired_at: lease.acquired_at,
    expires_at: lease.expires_at,
    release_token: releaseToken,
    recovery: lease.recovery,
    recovery_tombstone_path: lease.recovery_tombstone_path
  };
}

function writeLease(leasePath, lease, releaseToken) {
  writeNewJson(leasePath, lease);
  const snapshot = readStableFile(leasePath, { label: "new fix lease" });
  assertStableFile(snapshot, "new fix lease");
  return makeReceipt(lease, snapshot.path, snapshot.sha256, releaseToken);
}

function abortNewLeaseAfterGuardRace(receipt) {
  const snapshot = readStableFile(receipt.lease_path, { label: "guard-conflicted new fix lease" });
  if (snapshot.sha256 !== receipt.lease_hash) throw new Error("Guard conflict found, but the newly created lease identity is ambiguous; manual reconciliation is required.");
  const tombstone = `${receipt.lease_path}.${receipt.lease_id}.${randomHex(8)}.guard-conflict`;
  fs.renameSync(receipt.lease_path, tombstone);
  const moved = readStableFile(tombstone, { label: "guard-conflicted lease tombstone" });
  if (moved.sha256 !== snapshot.sha256 || !moved.bytes.equals(snapshot.bytes)) {
    throw new Error("Guard-conflicted lease changed during tombstoning; manual reconciliation is required.");
  }
  fs.unlinkSync(tombstone);
}

export function acquireFixLease({
  authorization,
  authorizationSha256,
  sourceRoot,
  lockDir = DEFAULT_FIX_LEASE_DIRECTORY,
  runId,
  now = () => new Date(),
  recoverExpired = false,
  expectedRunId,
  expectedAuthorizationSha256,
  hooks = {}
} = {}) {
  assertSha256(authorizationSha256, "authorizationSha256");
  if (typeof runId !== "string" || runId.length === 0) throw new Error("runId is required.");
  const canonicalRoot = canonicalSourceRoot(authorization, sourceRoot, runId);
  const canonicalLockDir = inspectSafeDirectory(lockDir, "fix lease directory", { create: true });
  assertNoOverlap(canonicalLockDir, canonicalRoot, "fix lease directory", "source root");
  const rootSha256 = sourceRootSha256(canonicalRoot);
  const leasePath = leasePathFor(canonicalLockDir, rootSha256);
  assertNoLeaseGuard(leasePath);
  hooks.afterInitialGuardCheck?.({ leasePath });
  const acquiredAt = nowValue(now);
  const releaseToken = randomHex(32);
  const baseline = collectBaseline(authorization, canonicalRoot);
  let recovery = null;
  let recoveryTombstone = null;
  let recoveryGuard = null;
  let previousSnapshot = null;

  try {
    if (recoverExpired) {
      if (expectedRunId !== runId) throw new Error("Expired lease recovery requires the exact prior run ID.");
      if (expectedAuthorizationSha256 !== authorizationSha256) throw new Error("Expired lease recovery requires the exact prior authorization SHA-256.");
      const previous = readLease(leasePath);
      previousSnapshot = previous.snapshot;
      if (previous.lease.run_id !== expectedRunId || previous.lease.authorization_sha256 !== expectedAuthorizationSha256 || previous.lease.source_root_sha256 !== rootSha256) {
        throw new Error("Expired lease identity does not match the expected prior lease.");
      }
      if (acquiredAt.getTime() < parseTimestamp(previous.lease.expires_at, "lease.expires_at")) {
        throw new Error("Existing lease is not expired; recovery conflicts with the active lease.");
      }
      verifyBaseline(previous.lease, authorization, canonicalRoot);
      recoveryGuard = createLeaseGuard(leasePath, "recover", previous.snapshot);
      recoveryTombstone = recoveryTombstonePath(leasePath, previous.lease.lease_id);
      fs.renameSync(leasePath, recoveryTombstone);
      hooks.afterRecoveryRename?.({ leasePath, tombstone: recoveryTombstone });
      const moved = readStableFile(recoveryTombstone, { label: "recovered fix lease tombstone" });
      if (moved.sha256 !== previous.snapshot.sha256 || !moved.bytes.equals(previous.snapshot.bytes)) {
        throw new Error("Recovered lease changed during atomic tombstoning.");
      }
      recovery = {
        previous_lease_id: previous.lease.lease_id,
        previous_run_id: previous.lease.run_id,
        previous_lease_sha256: previous.snapshot.sha256,
        recovered_at: timestamp(acquiredAt)
      };
    }

    const lease = {
      schema_version: FIX_LEASE_VERSION,
      lease_id: makeLeaseId(acquiredAt),
      run_id: runId,
      authorization_sha256: authorizationSha256,
      source_root: canonicalRoot,
      source_root_sha256: rootSha256,
      process_id: process.pid,
      acquired_at: timestamp(acquiredAt),
      expires_at: timestamp(new Date(acquiredAt.getTime() + FIX_LEASE_TTL_MS)),
      allowed_path_baseline: baseline,
      release_token_sha256: sha256Bytes(releaseToken),
      recovery,
      recovery_tombstone_path: recoveryTombstone
    };
    const receipt = writeLease(leasePath, lease, releaseToken);
    if (fs.existsSync(leaseGuardPath(leasePath)) && !recoveryGuard) {
      abortNewLeaseAfterGuardRace(receipt);
      throw new Error("Fix lease guard appeared during acquisition; acquisition was aborted for manual reconciliation.");
    }
    clearLeaseGuard(recoveryGuard);
    return receipt;
  } catch (error) {
    let restored = false;
    if (recoveryTombstone && previousSnapshot) {
      try {
        restored = restoreVerifiedTombstone(recoveryTombstone, leasePath, previousSnapshot);
      } catch {
        restored = false;
      }
    }
    if (recoveryGuard && restored) clearLeaseGuard(recoveryGuard);
    if (recoveryGuard && !restored) throw new Error(`${error.message}; prior lease could not be restored and remains quarantined for manual reconciliation.`);
    throw error;
  }
}

function verifyRecoveryTombstone(lease, leaseDirectory) {
  if (!lease.recovery_tombstone_path) return null;
  const tombstone = inspectSafeFile(lease.recovery_tombstone_path, "recovery tombstone");
  if (pathKey(path.dirname(tombstone)) !== pathKey(leaseDirectory)) throw new Error("Recovery tombstone is outside the lease directory.");
  const snapshot = readStableFile(tombstone, { label: "recovery tombstone" });
  if (snapshot.sha256 !== lease.recovery?.previous_lease_sha256) throw new Error("Recovery tombstone hash mismatch.");
  return snapshot;
}

export function releaseFixLease({ receipt, runId, authorizationSha256, hooks = {} } = {}) {
  if (!receipt || typeof receipt !== "object") throw new Error("Exact lease receipt is required.");
  assertSha256(authorizationSha256, "authorizationSha256");
  if (receipt.run_id !== runId || receipt.authorization_sha256 !== authorizationSha256) {
    throw new Error("Lease receipt run or authorization identity mismatch.");
  }
  assertSha256(receipt.lease_hash, "receipt.lease_hash");
  if (typeof receipt.release_token !== "string" || !SHA256_PATTERN.test(receipt.release_token)) {
    throw new Error("Lease receipt release token is invalid.");
  }
  const leasePath = inspectSafeFile(receipt.lease_path, "fix lease");
  const { lease, snapshot } = readLease(leasePath);
  if (snapshot.sha256 !== receipt.lease_hash) throw new Error("Lease receipt hash mismatch.");
  if (lease.lease_id !== receipt.lease_id || lease.run_id !== runId || lease.authorization_sha256 !== authorizationSha256 || lease.source_root_sha256 !== receipt.source_root_sha256) {
    throw new Error("Lease receipt does not identify the active lease exactly.");
  }
  if (sha256Bytes(receipt.release_token) !== lease.release_token_sha256) throw new Error("Lease release token mismatch.");
  if (path.basename(leasePath) !== `${lease.source_root_sha256}.lease.json`) throw new Error("Lease path does not match the source-root lease key.");
  const leaseDirectory = path.dirname(leasePath);
  const recoverySnapshot = verifyRecoveryTombstone(lease, leaseDirectory);
  const releaseTombstone = releaseTombstonePath(leasePath, lease.lease_id);
  assertNoLeaseGuard(leasePath);
  const releaseGuard = createLeaseGuard(leasePath, "release", snapshot);
  let activeRemoved = false;
  try {
    fs.renameSync(leasePath, releaseTombstone);
    hooks.afterReleaseRename?.({ leasePath, tombstone: releaseTombstone });
    const moved = readStableFile(releaseTombstone, { label: "released fix lease tombstone" });
    if (moved.sha256 !== snapshot.sha256 || !moved.bytes.equals(snapshot.bytes)) throw new Error("Lease changed during release.");
    hooks.beforeReleaseLeaseUnlink?.({ tombstone: releaseTombstone });
    fs.unlinkSync(releaseTombstone);
    activeRemoved = true;
    hooks.afterReleaseLeaseUnlink?.({ tombstone: releaseTombstone });
    if (recoverySnapshot) {
      hooks.beforeRecoveryTombstoneUnlink?.({ tombstone: recoverySnapshot.path });
      assertStableFile(recoverySnapshot, "recovery tombstone");
      fs.unlinkSync(recoverySnapshot.path);
    }
    clearLeaseGuard(releaseGuard);
  } catch (error) {
    let restored = false;
    if (!activeRemoved) {
      try {
        restored = restoreVerifiedTombstone(releaseTombstone, leasePath, snapshot);
      } catch {
        restored = false;
      }
    }
    if (restored) clearLeaseGuard(releaseGuard);
    if (!restored) throw new Error(`${error.message}; lease release remains quarantined for manual reconciliation.`);
    throw error;
  }
  return { lease_id: lease.lease_id, released_at: timestamp(new Date()) };
}

export function loadFixAuthorization(file, runId) {
  const safeFile = inspectSafeFile(file, "fix authorization");
  const { value, snapshot } = parseStableJson(safeFile, "fix authorization");
  validateAuthorizationEnvelope(value, runId);
  assertStableFile(snapshot, "fix authorization");
  return { authorization: value, snapshot };
}

export function assertLeaseOutputPath(output, sourceRoot, lockDir) {
  const absolute = path.resolve(output);
  const parent = inspectSafeDirectory(path.dirname(absolute), "lease receipt output parent");
  const canonicalRoot = inspectSafeDirectory(sourceRoot, "source root");
  const canonicalLockDir = inspectSafeDirectory(lockDir, "fix lease directory", { create: true });
  assertNoOverlap(absolute, canonicalRoot, "lease receipt output", "source root");
  assertNoOverlap(absolute, canonicalLockDir, "lease receipt output", "fix lease directory");
  if (!samePath(parent, path.dirname(absolute))) throw new Error("Lease receipt output parent must not traverse a reparse point.");
  if (fs.existsSync(absolute)) throw new Error(`Refusing to overwrite existing lease receipt: ${absolute}`);
  return absolute;
}
