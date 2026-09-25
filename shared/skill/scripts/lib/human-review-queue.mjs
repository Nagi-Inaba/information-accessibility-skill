import { lookupRequirement } from "../show-requirement.mjs";
import { groupScreeningProjections, screeningMappings, screeningConflictReason } from "./review-details.mjs";

const unwrap = (record) => record?.envelope ?? record;
const locationKey = (location) => JSON.stringify([location.target_snapshot_id, location.location.trim().normalize("NFC"), location.required_state.trim().normalize("NFC")]);

// Builds a candidate only. Registration verifies inputs, hashes, same-run scope,
// measured targets and exact procedure bindings. No priority or human outcome is inferred.
export function createHumanReviewQueue({ run, screenings = [], manualRequirements = [], profileRequirements = [], skillRoot }) {
  if (!run?.target_inventory?.snapshots?.length) throw new Error("Queue generation requires measured target snapshots.");
  const grouped = groupScreeningProjections(screenings.flatMap((source) => source.payload.observations));
  const ids = [...new Set([...manualRequirements, ...profileRequirements,
    ...screenings.flatMap((source) => source.payload.observations.flatMap((row) => screeningMappings(row).map((mapping) => mapping.requirement_id)))])];
  if (!ids.length) throw new Error("Queue generation requires at least one profile requirement.");
  const items = ids.map((requirementId) => {
    const matches = screenings.flatMap((source) => source.payload.observations
      .filter((row) => screeningMappings(row).some((mapping) => mapping.requirement_id === requirementId)).map((observation) => ({ source, observation })));
    const origins = [matches.length && "screening", profileRequirements.includes(requirementId) && "profile_all",
      manualRequirements.includes(requirementId) && "manual"].filter(Boolean);
    const locations = matches.length ? matches.flatMap(({ observation }) => {
      const evidenceIds = new Set((observation.evidence_refs ?? []).map((ref) => ref.target_snapshot_id));
      return run.target_inventory.snapshots.filter((snapshot) => !evidenceIds.size || evidenceIds.has(snapshot.snapshot_id))
        .map((snapshot) => ({ target_snapshot_id: snapshot.snapshot_id, target_ref: snapshot.target_ref,
          location: observation.location, required_state: "保存済みの対象状態を再現して確認する。" }));
    }) : run.target_inventory.snapshots.map((snapshot) => ({ target_snapshot_id: snapshot.snapshot_id, target_ref: snapshot.target_ref,
      location: "対象ページ全体（基準に該当する要素を確認する）", required_state: "保存済みの対象状態を再現して確認する。" }));
    if (matches.length && profileRequirements.includes(requirementId)) {
      for (const snapshot of run.target_inventory.snapshots) {
        locations.push({ target_snapshot_id: snapshot.snapshot_id, target_ref: snapshot.target_ref,
          location: "対象ページ全体（基準に該当する要素を確認する）", required_state: "保存済みの対象状態を再現して確認する。" });
      }
    }
    return { requirement_id: requirementId, ...lookupRequirement(run.profile.id, requirementId, skillRoot).procedure_binding,
      origins, reason: matches.length ? (screeningConflictReason(grouped.get(requirementId)?.conflicts) || "登録済み観測を人が確認する。自動結果だけでは基準の適否を判断しない。")
        : profileRequirements.includes(requirementId) ? "プロファイルの全基準を確認するための項目。" : "確認者が指定した基準を確認するための項目。",
      priority: "unprioritized", priority_reason: "影響と利用状況を確認して優先度を決める。", affected_users: [],
      target_locations: [...new Map(locations.map((location) => [locationKey(location), location])).values()],
      related_screening_observations: matches.map(({ source, observation }) => ({ artifact_id: source.artifact_id, requirement_id: observation.requirement_id })),
      status: "pending" };
  });
  return { schema_version: "3.0.0", items, procedure_coverage: { total_requirements: items.length,
    available_procedures: items.filter((item) => item.procedure_availability === "available").length,
    unavailable_procedures: items.filter((item) => item.procedure_availability === "unavailable").length } };
}

export function queueContextErrors(run, envelopesById, profileRequirementIds) {
  const errors = [];
  const allRequirements = new Set();
  const duplicateLocations = new Set();
  const snapshots = new Map((run.target_inventory?.snapshots ?? []).map((snapshot) => [snapshot.snapshot_id, snapshot]));
  for (const record of envelopesById.values()) {
    const queue = unwrap(record);
    if (queue?.artifact_type !== "human-review-queue" || queue.payload?.schema_version !== "3.0.0") continue;
    const items = queue.payload.items ?? [];
    if (items.some((item) => item.origins?.includes("profile_all"))) {
      const profileIds = new Set(items.filter((item) => item.origins?.includes("profile_all")).map((item) => item.requirement_id));
      if (profileIds.size !== profileRequirementIds.length || profileRequirementIds.some((id) => !profileIds.has(id))) {
        errors.push(`Queue ${queue.artifact_id} profile_all must cover every registered profile requirement.`);
      }
    }
    for (const item of items) {
      const label = `Queue ${queue.artifact_id} ${item.requirement_id}`;
      if (allRequirements.has(item.requirement_id)) errors.push(`${label} duplicates a queued requirement; aggregate its locations and observations into one item.`);
      allRequirements.add(item.requirement_id);
      const locations = item.target_locations ?? [];
      if (item.origins?.includes("profile_all") && [...snapshots.keys()].some((id) => !locations.some((location) => location.target_snapshot_id === id))) {
        errors.push(`${label} profile_all must include every declared target snapshot.`);
      }
      for (const location of locations) {
        const snapshot = snapshots.get(location.target_snapshot_id);
        if (!snapshot || snapshot.target_ref !== location.target_ref || !queue.target_snapshot_ids?.includes(location.target_snapshot_id)) {
          errors.push(`${label} target location must match a measured snapshot in this run and queue envelope.`);
        }
        const key = JSON.stringify([item.requirement_id, locationKey(location)]);
        if (duplicateLocations.has(key)) errors.push(`${label} contains a duplicate target/criterion/state location.`);
        duplicateLocations.add(key);
      }
      const refs = item.related_screening_observations ?? [];
      if (Boolean(refs.length) !== Boolean(item.origins?.includes("screening"))) errors.push(`${label} screening origin must exactly correspond to registered observation references.`);
      for (const ref of refs) {
        const source = unwrap(envelopesById.get(ref.artifact_id));
        if (source?.artifact_type !== "screening-observations" || source.run_id !== run.run_id
            || !queue.inputs?.some((input) => input.artifact_id === ref.artifact_id)) {
          errors.push(`${label} observation source must be a registered same-run screening input.`);
          continue;
        }
        const matches = source.payload.observations.filter((row) => row.requirement_id === ref.requirement_id);
        if (matches.length !== 1 || !screeningMappings(matches[0]).some((mapping) => mapping.requirement_id === item.requirement_id)) {
          errors.push(`${label} observation reference must match exactly one screening requirement and its profile requirement.`);
          continue;
        }
        const observation = matches[0];
        const relevantLocations = locations.filter((location) => location.location === observation.location);
        const evidenceIds = new Set((observation.evidence_refs ?? []).map((evidence) => evidence.target_snapshot_id));
        if (!relevantLocations.length || [...evidenceIds].some((id) => !relevantLocations.some((location) => location.target_snapshot_id === id))) {
          errors.push(`${label} must preserve the referenced observation location and every saved-evidence target snapshot.`);
        }
      }
    }
    // Every mapped input observation is explicitly routed, including inconclusive
    // and no-signal observations. Merely naming the criterion is insufficient.
    for (const input of queue.inputs ?? []) {
      const source = unwrap(envelopesById.get(input.artifact_id));
      if (source?.artifact_type !== "screening-observations") continue;
      for (const row of source.payload.observations ?? []) {
        if (screeningMappings(row).some((mapping) => !items.some((item) => item.requirement_id === mapping.requirement_id && item.related_screening_observations?.some((ref) => ref.artifact_id === source.artifact_id && ref.requirement_id === row.requirement_id)))) {
          errors.push(`Queue ${queue.artifact_id} must explicitly route mapped observation ${source.artifact_id}/${row.requirement_id}.`);
        }
      }
    }
  }
  return errors;
}

// Deliberately excludes input IDs, snapshot IDs, private file references and raw evidence.
export function publicQueueItem(item, publicLocation) {
  const { target_locations, related_screening_observations, ...binding } = item;
  if (!target_locations) return binding;
  return { ...binding, target_locations: target_locations.map(({ target_ref, location, required_state }) => ({
    target: publicLocation(target_ref), location: publicLocation(location), required_state
  })), observation_count: related_screening_observations.length };
}

export function queueReviewLines(item, locale = "ja") {
  if (!item?.target_locations) return [];
  const ja = locale === "ja";
  const originLabels = ja ? { screening: "観測からの確認", profile_all: "全基準の確認", manual: "手動追加" }
    : { screening: "Screening follow-up", profile_all: "All profile requirements", manual: "Manually added" };
  return [
    `${ja ? "確認の由来" : "Review origin"}: ${item.origins.map((origin) => originLabels[origin]).join(", ")}`,
    `${ja ? "確認理由" : "Review reason"}: ${item.reason}`,
    `${ja ? "確認の優先度" : "Review priority"}: ${item.priority === "unprioritized" ? (ja ? "未設定" : "Unprioritized") : item.priority} — ${item.priority_reason}`,
    `${ja ? "確認待ちの状態" : "Queue status"}: ${item.status === "blocked" ? (ja ? "前提条件待ち" : "Blocked") : (ja ? "未確認" : "Pending")}`,
    ...item.target_locations.map((location) => `${ja ? "確認箇所" : "Review location"}: ${location.target} — ${location.location}; ${ja ? "必要な状態" : "Required state"}: ${location.required_state}`),
    `${ja ? "影響を確認する利用者" : "Users to consider"}: ${item.affected_users.length ? item.affected_users.join(", ") : (ja ? "未確認" : "Not yet identified")}`,
    `${ja ? "関連する観測" : "Related observations"}: ${item.observation_count ?? 0}`
  ];
}
