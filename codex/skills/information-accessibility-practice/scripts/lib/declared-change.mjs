import { isDeepStrictEqual } from "node:util";
import { compareInstants } from "./date-time.mjs";
import { evidenceBindingErrors } from "./run-evidence.mjs";
import { verifyEvidenceReference } from "./evidence-reference.mjs";
import { compareRunTargets, targetInventoryErrors, targetSpecification } from "./run-targets.mjs";

export function afterChangeRun(run, version) {
  const after = structuredClone(run);
  after.target.version_or_commit = version;
  return after;
}

export function validateDeclaredChangeBindings(run, envelopesById, errors) {
  for (const record of envelopesById.values()) {
    const artifact = record?.envelope ?? record;
    if (artifact?.artifact_type !== "declared-change-record") continue;
    const payload = artifact.payload;
    if (!payload || !run?.target || !Array.isArray(run.target_inventory?.snapshots)
        || !Array.isArray(artifact.inputs) || !Array.isArray(payload.source_artifact_ids)
        || !Array.isArray(payload.remediation_ids) || typeof payload.after_version !== "string") {
      errors.push(`declared-change-record ${artifact.artifact_id}: a measured run and complete change declaration are required.`);
      continue;
    }
    if (payload.before_version !== run.target.version_or_commit || payload.after_version === payload.before_version) {
      errors.push(`declared-change-record ${artifact.artifact_id}: before and after versions must identify distinct states.`);
    }
    if (compareInstants(payload.declared_at, artifact.created_at) > 0) {
      errors.push(`declared-change-record ${artifact.artifact_id}: declaration follows artifact creation.`);
    }
    const inputs = artifact.inputs.map((input) => input?.artifact_id).sort();
    if (!isDeepStrictEqual(inputs, [...payload.source_artifact_ids].sort()) || !inputs.length) {
      errors.push(`declared-change-record ${artifact.artifact_id}: source_artifact_ids must exactly match remediation-plan inputs.`);
    }
    const remediationIds = new Set();
    for (const id of inputs) {
      const source = envelopesById.get(id);
      const plan = source?.envelope ?? source;
      if (plan?.artifact_type !== "remediation-plan") {
        errors.push(`declared-change-record ${artifact.artifact_id}: input ${id} must be a remediation-plan.`);
        continue;
      }
      for (const item of (Array.isArray(plan.payload?.items) ? plan.payload.items : [])) remediationIds.add(item.remediation_id);
    }
    for (const id of payload.remediation_ids) {
      if (!remediationIds.has(id)) errors.push(`declared-change-record ${artifact.artifact_id}: unknown remediation ID ${id}.`);
    }
    const afterRun = afterChangeRun(run, payload.after_version);
    const inventoryErrors = targetInventoryErrors(payload.after_target_inventory, afterRun);
    errors.push(...inventoryErrors.map((error) => `declared-change-record ${artifact.artifact_id}: ${error}`));
    if (!inventoryErrors.length) {
      let meaningfulChange = false;
      for (const snapshot of payload.after_target_inventory.snapshots) {
        const before = run.target_inventory.snapshots.find((item) => item.target_ref === snapshot.target_ref);
        const oldSpec = before && targetSpecification(before);
        const newSpec = targetSpecification(snapshot);
        if (oldSpec?.kind === "web_state" && newSpec.kind === "web_state") {
          delete oldSpec.bundle_path;
          delete newSpec.bundle_path;
          if (snapshot.identity.bundle_path === before.identity.bundle_path
              || compareInstants(snapshot.captured_at, before.captured_at) <= 0) {
            errors.push(`declared-change-record ${artifact.artifact_id}: a new saved web-state capture is required.`);
          }
          meaningfulChange ||= ["dom_sha256", "ax_tree_sha256", "status", "final_url"]
            .some((key) => snapshot.identity[key] !== before.identity[key]);
        } else if (before && snapshot.snapshot_id !== before.snapshot_id) meaningfulChange = true;
        if (!before || !isDeepStrictEqual(oldSpec, newSpec)) {
          errors.push(`declared-change-record ${artifact.artifact_id}: after measurement must use the same target specification.`);
        }
        if (compareInstants(snapshot.observed_at, payload.declared_at) > 0) {
          errors.push(`declared-change-record ${artifact.artifact_id}: target measurement follows declaration.`);
        }
      }
      const comparison = compareRunTargets(run, run.target_inventory, afterRun, payload.after_target_inventory);
      if (!comparison.some((item) => item.status === "identity_changed") || !meaningfulChange) {
        errors.push(`declared-change-record ${artifact.artifact_id}: the measured target identity did not change.`);
      }
    }
  }
}

export function collectDeclaredChangeEvidence(run, artifacts, readEvidence) {
  const errors = [], snapshots = new Map();
  for (const artifact of artifacts.filter((item) => item?.artifact_type === "declared-change-record")) {
    const seen = new Set();
    for (const reference of artifact.payload?.evidence_refs ?? []) {
      const label = `declared-change-record ${artifact.artifact_id}`;
      if (!["other", "screenshot"].includes(reference.evidence_type)) {
        errors.push(`${label}: change evidence must be a saved document or screenshot.`);
        continue;
      }
      errors.push(...evidenceBindingErrors(reference, run).map((error) => `${label}: ${error}`));
      if (seen.has(reference.path)) errors.push(`${label}: duplicate evidence path ${reference.path}.`);
      seen.add(reference.path);
      if (compareInstants(reference.captured_at, artifact.payload.declared_at) > 0) errors.push(`${label}: evidence capture follows declaration.`);
      try {
        const snapshot = snapshots.get(reference.path) ?? readEvidence(reference.path);
        if (!snapshot || !Buffer.isBuffer(snapshot.bytes)) throw new Error("Saved evidence bytes are required.");
        verifyEvidenceReference(reference, snapshot.bytes);
        if (snapshot.sha256 !== reference.sha256) throw new Error("Evidence snapshot hash mismatch.");
        snapshots.set(reference.path, snapshot);
      } catch (error) { errors.push(`${label}: ${error.message}`); }
    }
  }
  return { errors, snapshots };
}
