import crypto from "node:crypto";
import { canonicalJson } from "./canonical-json.mjs";
import { compareInstants } from "./date-time.mjs";
import { createEvidenceReference, validateEvidenceReference, verifyEvidenceReference } from "./evidence-reference.mjs";
import { validateNetworkEvidence } from "./network-evidence.mjs";
import { validateInteractionEvidence } from "./interaction-evidence.mjs";

const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

export function evidenceContext(run, targetRef) {
  if (!run?.target?.urls_or_files?.includes(targetRef)) throw new Error("Evidence target_ref must be an exact declared run target.");
  return {
    run_id: run.run_id,
    target_version: run.target.version_or_commit,
    target_ref: targetRef,
    target_context_sha256: hash(canonicalJson(run.target)),
    environment_ref: `ENV-${hash(canonicalJson(run.environment))}`
  };
}

// This binds captured bytes to the declared run context. It does not prove
// that a live target still has the captured content or authenticate a producer.
export function createRunEvidenceReference({ run, targetRef, ...options }) {
  const context = evidenceContext(run, targetRef);
  const measuredRun = ["8.0.0", "9.0.0", "10.0.0", "11.0.0", "12.0.0", "13.0.0", "14.0.0"].includes(run.schema_version);
  const measured = measuredRun ? run.target_inventory?.snapshots?.find((snapshot) => snapshot.target_ref === targetRef) : null;
  if (measuredRun && !measured) throw new Error("Bind a measured target inventory before adding saved observation evidence.");
  if (measured && options.targetSnapshotId !== undefined && options.targetSnapshotId !== measured.snapshot_id) throw new Error("Evidence snapshot ID must match the run target inventory.");
  const reference = createEvidenceReference({
    ...options,
    environmentRef: context.environment_ref,
    targetSnapshotId: measured?.snapshot_id ?? options.targetSnapshotId ?? `RAW-${hash(options.bytes)}`
  });
  return Object.freeze({ ...reference, ...context });
}

export function evidenceBindingErrors(reference, run) {
  const errors = validateEvidenceReference(reference);
  if (errors.length) return errors;
  try {
    for (const [key, expected] of Object.entries(evidenceContext(run, reference.target_ref))) {
      if (reference[key] !== expected) errors.push(`Evidence ${key} does not match the audit run.`);
    }
    if (["8.0.0", "9.0.0", "10.0.0", "11.0.0", "12.0.0", "13.0.0", "14.0.0"].includes(run.schema_version)) {
      const measured = run.target_inventory?.snapshots?.find((snapshot) => snapshot.target_ref === reference.target_ref);
      if (!measured || reference.target_snapshot_id !== measured.snapshot_id) errors.push("Evidence target_snapshot_id does not match the measured run target.");
      else if (["dom_snapshot", "accessibility_tree"].includes(reference.evidence_type)) {
        const exact = measured.evidence_bindings.some((binding) => binding.sha256 === reference.sha256 && binding.evidence_type === reference.evidence_type);
        const localSource = ["file", "git"].includes(measured.kind) && reference.evidence_type === "dom_snapshot"
          && measured.evidence_bindings.some((binding) => binding.sha256 === reference.sha256 && binding.evidence_type === "other");
        if (!exact && !localSource) errors.push("DOM or AX evidence bytes do not belong to the measured target snapshot.");
      }
    }
  } catch (error) { errors.push(error.message); }
  return errors;
}

// The caller supplies either safely opened filesystem snapshots or registered
// immutable byte snapshots. No path or URL is opened by this pure function.
export function collectScreeningEvidence(run, artifacts, readEvidence) {
  const errors = [];
  const snapshots = new Map();
  for (const artifact of artifacts) {
    if (artifact?.artifact_type !== "screening-observations" || !["3.0.0", "4.0.0"].includes(artifact.payload?.schema_version)) continue;
    for (const observation of artifact.payload.observations ?? []) {
      const refs = Array.isArray(observation?.evidence_refs) ? observation.evidence_refs : [];
      const label = `${artifact.artifact_id}/${observation?.requirement_id}`;
      if (observation?.evidence_level === "E1" && refs.length === 0) errors.push(`${label}: E1 requires saved evidence; use E0 when capture is unavailable.`);
      const seen = new Set();
      for (const reference of refs) {
        const bindingErrors = evidenceBindingErrors(reference, run);
        if (bindingErrors.length) {
          errors.push(...bindingErrors.map((error) => `${label}: ${error}`));
          continue;
        }
        const key = `${reference.evidence_type}:${reference.path}`;
        if (seen.has(key)) errors.push(`${label}: duplicate evidence reference ${key}.`);
        seen.add(key);
        if (compareInstants(reference.captured_at, observation.captured_at) > 0
            || compareInstants(observation.captured_at, artifact.created_at) > 0) {
          errors.push(`${label}: evidence capture must not follow its observation or artifact creation.`);
        }
        try {
          const snapshot = snapshots.get(reference.path) ?? readEvidence?.(reference.path);
          if (!snapshot || !Buffer.isBuffer(snapshot.bytes)) throw new Error("Registered raw evidence bytes are required.");
          verifyEvidenceReference(reference, snapshot.bytes);
          if (reference.evidence_type === "network_log") validateNetworkEvidence(snapshot.bytes, run, reference);
          if (reference.evidence_type === "interaction_log") validateInteractionEvidence(snapshot.bytes, run, reference);
          if (snapshot.sha256 !== reference.sha256) throw new Error("Raw evidence snapshot hash mismatch.");
          snapshots.set(reference.path, snapshot);
        } catch (error) {
          errors.push(`${label}: ${error.message}`);
        }
      }
    }
  }
  return { errors, snapshots };
}

export function compareEvidenceReferences(before, after) {
  const index = (rows) => {
    const result = new Map();
    for (const { requirement_id, evidence_refs } of rows) {
      for (const ref of evidence_refs ?? []) {
        const key = JSON.stringify([requirement_id, ref.target_ref, ref.evidence_type]);
        const values = result.get(key) ?? [];
        values.push({ sha256: ref.sha256, captured_at: ref.captured_at, target_version: ref.target_version, target_snapshot_id: ref.target_snapshot_id,
          environment_ref: ref.environment_ref, target_context_sha256: ref.target_context_sha256 });
        result.set(key, values);
      }
    }
    for (const values of result.values()) values.sort((a, b) => a.sha256.localeCompare(b.sha256, "en") || compareInstants(a.captured_at, b.captured_at));
    return result;
  };
  const old = index(before);
  const next = index(after);
  return [...new Set([...old.keys(), ...next.keys()])].sort().map((key) => {
    const [requirement_id, target_ref, evidence_type] = JSON.parse(key);
    const a = old.get(key) ?? [];
    const b = next.get(key) ?? [];
    const unchanged = canonicalJson(a.map((item) => item.sha256)) === canonicalJson(b.map((item) => item.sha256));
    const contexts = (values) => [...new Set(values.map(({ target_version, environment_ref, target_context_sha256 }) => canonicalJson({ target_version, environment_ref, target_context_sha256 })))].sort();
    const contextChanged = canonicalJson(contexts(a)) !== canonicalJson(contexts(b));
    return { requirement_id, target_ref, evidence_type, status: !a.length ? "added" : !b.length ? "removed" : unchanged ? "bytes_unchanged" : "bytes_changed",
      context_changed: contextChanged, before: a, after: b };
  });
}
