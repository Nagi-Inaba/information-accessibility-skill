import path from "node:path";

const actorKinds = new Set(["external_human", "manual_operator"]);
const utcInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

function safeRelativeFile(value) {
  if (typeof value !== "string" || !value || path.isAbsolute(value) || value.includes("\\")) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== ".." && !normalized.startsWith("../");
}

function validateEvidenceReferences(references) {
  if (!Array.isArray(references)) throw new Error("evidenceReferences must be an array");
  for (const reference of references) {
    if (typeof reference?.path !== "string" || !safeRelativeFile(reference.path)) throw new Error("Change evidence paths must be normalized relative paths");
    if (typeof reference.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(reference.sha256)) throw new Error("Change evidence requires lowercase SHA-256 digests");
  }
}

export function createDeclaredChangeRecord({
  runId,
  changeId,
  actor,
  sourceTargetSnapshotId,
  changedTargetSnapshotId,
  oldVersion,
  newVersion,
  changedFiles = [],
  actions = [],
  evidenceReferences = [],
  declaredAt
}) {
  if (typeof runId !== "string" || !runId) throw new Error("runId is required");
  if (typeof changeId !== "string" || !changeId) throw new Error("changeId is required");
  if (!actorKinds.has(actor?.producer_kind)) throw new Error("Declared changes must be recorded by an external human or manual operator");
  if (typeof actor.actor_id !== "string" || !actor.actor_id) throw new Error("actor.actor_id is required");
  if (typeof oldVersion !== "string" || typeof newVersion !== "string" || !oldVersion || !newVersion || oldVersion === newVersion) {
    throw new Error("oldVersion and newVersion must be distinct non-empty values");
  }
  if (typeof sourceTargetSnapshotId !== "string" || !sourceTargetSnapshotId) throw new Error("sourceTargetSnapshotId is required");
  if (typeof changedTargetSnapshotId !== "string" || !changedTargetSnapshotId || changedTargetSnapshotId === sourceTargetSnapshotId) {
    throw new Error("changedTargetSnapshotId must identify a distinct target snapshot");
  }
  if (!utcInstant.test(declaredAt ?? "") || Number.isNaN(Date.parse(declaredAt))) throw new Error("declaredAt must be a real UTC RFC 3339 instant");
  if (!Array.isArray(changedFiles) || changedFiles.some((file) => !safeRelativeFile(file))) throw new Error("changedFiles must contain normalized relative paths");
  if (!Array.isArray(actions) || actions.some((action) => typeof action !== "string" || !action.trim())) throw new Error("actions must contain non-empty descriptions");
  if (changedFiles.length === 0 && actions.length === 0) throw new Error("At least one changed file or declared action is required");
  validateEvidenceReferences(evidenceReferences);

  return {
    schema_version: "2.0.0",
    artifact_type: "change-record",
    artifact_id: changeId,
    run_id: runId,
    producer: structuredClone(actor),
    created_at: declaredAt,
    payload: {
      basis: "declared_external_change",
      source_target_snapshot_id: sourceTargetSnapshotId,
      changed_target_snapshot_id: changedTargetSnapshotId,
      old_version: oldVersion,
      new_version: newVersion,
      changed_files: [...new Set(changedFiles)].sort(),
      actions: [...new Set(actions.map((action) => action.trim()))],
      evidence_references: structuredClone(evidenceReferences),
      outcome_carryover: "forbidden",
      retest_requirement: "fresh_current_run"
    }
  };
}

export function declaredChangeSupportsRetest(record) {
  return record?.artifact_type === "change-record"
    && record?.payload?.basis === "declared_external_change"
    && record?.payload?.outcome_carryover === "forbidden"
    && record?.payload?.retest_requirement === "fresh_current_run"
    && record?.payload?.source_target_snapshot_id !== record?.payload?.changed_target_snapshot_id;
}
