import crypto from "node:crypto";
import fs from "node:fs";
import { canonicalJson } from "./canonical-json.mjs";
import { compareInstants } from "./date-time.mjs";
import { validateJsonSchema } from "./json-schema.mjs";

const schema = JSON.parse(fs.readFileSync(new URL("../../references/target-identity.schema.json", import.meta.url), "utf8"));
export const targetDigest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function identityKey(snapshot) {
  return { kind: snapshot.kind, target_ref: snapshot.target_ref, identity: snapshot.identity, evidence_bindings: snapshot.evidence_bindings };
}

function freeze(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

export function targetIdentityErrors(snapshot) {
  const errors = validateJsonSchema(snapshot, schema);
  if (errors.length) return errors;
  if (compareInstants(snapshot.captured_at, snapshot.observed_at) > 0) errors.push("Target capture cannot follow its observation time.");
  if (snapshot.snapshot_id !== `TARGET-${targetDigest(canonicalJson(identityKey(snapshot)))}`) errors.push("Target snapshot ID does not match its measured identity.");
  return errors;
}

export function createTargetIdentity({ kind, targetRef, identity, observedAt = new Date().toISOString(), capturedAt = observedAt, evidenceBindings = [], limitations = [] }) {
  const snapshot = { schema_version: "1.0.0", kind, target_ref: targetRef, observed_at: observedAt, captured_at: capturedAt,
    publication: "private_by_default", identity: structuredClone(identity),
    evidence_bindings: [...new Map(evidenceBindings.map((binding) => [canonicalJson(binding), structuredClone(binding)])).values()]
      .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b), "en")), limitations: [...new Set(limitations)] };
  snapshot.snapshot_id = `TARGET-${targetDigest(canonicalJson(identityKey(snapshot)))}`;
  const errors = targetIdentityErrors(snapshot);
  if (errors.length) throw new Error(`Invalid measured target identity:\n- ${errors.join("\n- ")}`);
  return freeze(snapshot);
}

export function compareTargetIdentities(before, after) {
  for (const snapshot of [before, after]) {
    const errors = targetIdentityErrors(snapshot);
    if (errors.length) throw new Error(errors.join("\n"));
  }
  const keys = [...new Set([...Object.keys(before.identity), ...Object.keys(after.identity)])].sort();
  return {
    changed: before.snapshot_id !== after.snapshot_id,
    kind_changed: before.kind !== after.kind,
    target_ref_changed: before.target_ref !== after.target_ref,
    changed_identity_fields: keys.filter((key) => canonicalJson(before.identity[key] ?? null) !== canonicalJson(after.identity[key] ?? null)),
    evidence_changed: canonicalJson(before.evidence_bindings) !== canonicalJson(after.evidence_bindings),
    before_snapshot_id: before.snapshot_id, after_snapshot_id: after.snapshot_id
  };
}
