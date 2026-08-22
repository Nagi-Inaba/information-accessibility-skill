const plannerRoles = new Set(["remediation_planner", "declared_external_human"]);
const executorKinds = new Set(["authorized_fixer", "external_human", "manual_operator"]);
const utcInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

function realUtcInstant(value) {
  return typeof value === "string" && utcInstant.test(value) && !Number.isNaN(Date.parse(value));
}

function nonEmptyText(values, label) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error(`${label} must contain at least one non-empty string`);
  }
  return [...new Set(values.map((value) => value.trim()))];
}

export function createFixHandoff({ handoffId, runId, planner, findingIds, proposedChanges, createdAt }) {
  if (typeof handoffId !== "string" || !handoffId) throw new Error("handoffId is required");
  if (typeof runId !== "string" || !runId) throw new Error("runId is required");
  if (!plannerRoles.has(planner?.role_id)) throw new Error("Fix handoff planner role is not authorized");
  if (!realUtcInstant(createdAt)) throw new Error("createdAt must be a real UTC RFC 3339 instant");
  return {
    artifact_type: "fix-handoff",
    artifact_id: handoffId,
    run_id: runId,
    producer: structuredClone(planner),
    created_at: createdAt,
    payload: {
      finding_ids: nonEmptyText(findingIds, "findingIds").sort(),
      proposed_changes: nonEmptyText(proposedChanges, "proposedChanges"),
      execution_status: "not_executed"
    }
  };
}

export function recordExecutedChange({
  changeId,
  runId,
  handoff,
  executor,
  targetBeforeSnapshotId,
  targetAfterSnapshotId,
  changedFiles = [],
  executedActions = [],
  verificationEvidenceRefs = [],
  executedAt
}) {
  if (typeof changeId !== "string" || !changeId) throw new Error("changeId is required");
  if (typeof runId !== "string" || !runId || handoff?.run_id !== runId) throw new Error("Change and handoff must belong to the same run");
  if (handoff?.artifact_type !== "fix-handoff") throw new Error("A validated fix handoff is required");
  if (!executorKinds.has(executor?.producer_kind)) throw new Error("Change producer must be the authorized executor, external human, or manual operator");
  if (executor.role_id === "remediation_planner" || executor.producer_kind === "ai_agent") throw new Error("A remediation planner cannot be recorded as the change executor");
  if (typeof executor.actor_id !== "string" || !executor.actor_id) throw new Error("executor.actor_id is required");
  if (!realUtcInstant(executedAt)) throw new Error("executedAt must be a real UTC RFC 3339 instant");
  if (typeof targetBeforeSnapshotId !== "string" || !targetBeforeSnapshotId) throw new Error("targetBeforeSnapshotId is required");
  if (typeof targetAfterSnapshotId !== "string" || !targetAfterSnapshotId || targetAfterSnapshotId === targetBeforeSnapshotId) {
    throw new Error("targetAfterSnapshotId must identify a changed target");
  }
  if ((!Array.isArray(changedFiles) || changedFiles.length === 0) && (!Array.isArray(executedActions) || executedActions.length === 0)) {
    throw new Error("At least one changed file or executed action is required");
  }
  return {
    artifact_type: "change-record",
    artifact_id: changeId,
    run_id: runId,
    producer: structuredClone(executor),
    created_at: executedAt,
    payload: {
      handoff_artifact_id: handoff.artifact_id,
      planning_source: {
        producer: structuredClone(handoff.producer),
        finding_ids: structuredClone(handoff.payload.finding_ids)
      },
      executor: structuredClone(executor),
      target_before_snapshot_id: targetBeforeSnapshotId,
      target_after_snapshot_id: targetAfterSnapshotId,
      changed_files: [...new Set(changedFiles)].sort(),
      executed_actions: [...new Set(executedActions)],
      verification_evidence_refs: structuredClone(verificationEvidenceRefs),
      retest_status: "required"
    }
  };
}
