import crypto from "node:crypto";
import { digestBytes, isNonemptyText, isRealInstant, isSafeRelativePath } from "./evidence-identity-validation.mjs";
import { dateTimeExample } from "./date-time.mjs";

const evidenceTypes = new Set(["dom_snapshot", "accessibility_tree", "screenshot", "interaction_log", "network_log", "other"]);

export function validateEvidenceReference(reference) {
  const errors = [];
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) return ["reference must be an object"];
  if (!evidenceTypes.has(reference.evidence_type)) errors.push("evidence_type must be a registered evidence type");
  if (!isSafeRelativePath(reference.path)) errors.push("path must be a normalized relative path without traversal");
  if (typeof reference.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(reference.sha256)) errors.push("sha256 must be a lowercase SHA-256 digest");
  if (!isRealInstant(reference.captured_at)) errors.push(`captured_at must be a real ${dateTimeExample}`);
  if (!isNonemptyText(reference.environment_ref)) errors.push("environment_ref is required");
  if (!isNonemptyText(reference.target_snapshot_id)) errors.push("target_snapshot_id is required");
  if (reference.publication !== "private_by_default") errors.push("publication must be private_by_default");
  return errors;
}

export function createEvidenceReference({ evidenceType, relativePath, bytes, capturedAt, environmentRef, targetSnapshotId }) {
  const reference = {
    evidence_type: evidenceType,
    path: relativePath,
    sha256: crypto.createHash("sha256").update(digestBytes(bytes)).digest("hex"),
    captured_at: capturedAt,
    environment_ref: environmentRef,
    target_snapshot_id: targetSnapshotId,
    publication: "private_by_default"
  };
  const errors = validateEvidenceReference(reference);
  if (errors.length) throw new Error(`Invalid evidence reference:\n- ${errors.join("\n- ")}`);
  return Object.freeze(reference);
}

export function verifyEvidenceReference(reference, bytes) {
  const errors = validateEvidenceReference(reference);
  if (errors.length) throw new Error(`Invalid evidence reference:\n- ${errors.join("\n- ")}`);
  const actual = crypto.createHash("sha256").update(digestBytes(bytes)).digest("hex");
  if (actual !== reference.sha256) throw new Error(`Evidence hash mismatch for ${reference.path}`);
  return true;
}
