const evaluatedOutcomes = new Set(["pass", "fail", "not_applicable"]);

function resultsFrom(record) {
  const results = record?.assessment?.results ?? record?.results;
  if (!Array.isArray(results)) throw new Error("Each comparison input must contain an assessment results array");
  return results.filter((result) => result?.requirement_kind !== "screening_check");
}

function rowMap(record) {
  const map = new Map();
  for (const result of resultsFrom(record)) {
    if (typeof result?.requirement_id !== "string" || !result.requirement_id) throw new Error("Every result requires requirement_id");
    if (map.has(result.requirement_id)) throw new Error(`Duplicate requirement_id: ${result.requirement_id}`);
    map.set(result.requirement_id, result);
  }
  return map;
}

function classify(beforeOutcome, afterOutcome) {
  if (beforeOutcome === "fail" && ["pass", "not_applicable"].includes(afterOutcome)) return "resolved";
  if (beforeOutcome === "fail" && afterOutcome === "fail") return "still_failing";
  if (["pass", "not_applicable"].includes(beforeOutcome) && afterOutcome === "fail") return "regressed";
  if (!evaluatedOutcomes.has(beforeOutcome) && afterOutcome === "fail") return "newly_evaluated_failure";
  if (evaluatedOutcomes.has(beforeOutcome) && !evaluatedOutcomes.has(afterOutcome)) return "not_retested";
  if (beforeOutcome === afterOutcome) return "unchanged";
  return "changed";
}

export function compareAssessmentResults(beforeRecord, afterRecord, options = {}) {
  const before = rowMap(beforeRecord);
  const after = rowMap(afterRecord);
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort((left, right) => left.localeCompare(right, "en"));
  const rows = ids.map((requirementId) => {
    const prior = before.get(requirementId);
    const current = after.get(requirementId);
    const beforeOutcome = prior?.outcome ?? "not_recorded";
    const afterOutcome = current?.outcome ?? "not_recorded";
    return {
      requirement_id: requirementId,
      classification: classify(beforeOutcome, afterOutcome),
      before_outcome: beforeOutcome,
      after_outcome: afterOutcome,
      current_evidence_count: current?.evidence?.length ?? 0,
      previous_evidence_count: prior?.evidence?.length ?? 0,
      evidence_used_for_current_result: "after_run_only",
      after_mapping_status: current?.mapping_status ?? null
    };
  });
  const counts = {};
  for (const row of rows) counts[row.classification] = (counts[row.classification] ?? 0) + 1;
  return {
    schema_version: "1.0.0",
    before_target_snapshot_id: options.beforeTargetSnapshotId ?? null,
    after_target_snapshot_id: options.afterTargetSnapshotId ?? null,
    target_changed: options.beforeTargetSnapshotId && options.afterTargetSnapshotId
      ? options.beforeTargetSnapshotId !== options.afterTargetSnapshotId
      : null,
    evidence_policy: "current_run_only",
    rows,
    counts
  };
}
