import crypto from "node:crypto";
import path from "node:path";

const evidenceTypes = new Set(["dom_snapshot", "accessibility_tree", "screenshot", "interaction_log", "network_log", "other"]);
const utcInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

function isRealUtcInstant(value) {
  return typeof value === "string" && utcInstant.test(value) && !Number.isNaN(Date.parse(value));
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || !value || path.isAbsolute(value) || value.includes("\\")) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && !normalized.startsWith("../") && normalized !== "..";
}

export function validateEvidenceReference(reference) {
  const errors = [];
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) return ["reference must be an object"];
  if (!evidenceTypes.has(reference.evidence_type)) errors.push("evidence_type must be a registered evidence type");
  if (!isSafeRelativePath(reference.path)) errors.push("path must be a normalized relative path without traversal");
  if (typeof reference.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(reference.sha256)) errors.push("sha256 must be a lowercase SHA-256 digest");
  if (!isRealUtcInstant(reference.captured_at)) errors.push("captured_at must be a real UTC RFC 3339 instant ending in Z");
  if (typeof reference.environment_ref !== "string" || !reference.environment_ref) errors.push("environment_ref is required");
  if (typeof reference.target_snapshot_id !== "string" || !reference.target_snapshot_id) errors.push("target_snapshot_id is required");
  return errors;
}

export function createEvidenceReference({ evidenceType, relativePath, bytes, capturedAt, environmentRef, targetSnapshotId }) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new Error("bytes must be Buffer or Uint8Array");
  const reference = {
    evidence_type: evidenceType,
    path: relativePath,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    captured_at: capturedAt,
    environment_ref: environmentRef,
    target_snapshot_id: targetSnapshotId,
    publication: "private_by_default"
  };
  const errors = validateEvidenceReference(reference);
  if (errors.length) throw new Error(`Invalid evidence reference:\n- ${errors.join("\n- ")}`);
  return reference;
}

export function verifyEvidenceReference(reference, bytes) {
  const errors = validateEvidenceReference(reference);
  if (errors.length) throw new Error(`Invalid evidence reference:\n- ${errors.join("\n- ")}`);
  const actual = crypto.createHash("sha256").update(bytes).digest("hex");
  if (actual !== reference.sha256) throw new Error(`Evidence hash mismatch for ${reference.path}`);
  return true;
}
