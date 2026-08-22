const priorityOrder = new Map([["P0", 0], ["P1", 1], ["P2", 2]]);

function uniqueText(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function observationPriority(observations) {
  return observations
    .map((item) => priorityOrder.has(item.priority) ? item.priority : "P2")
    .sort((left, right) => priorityOrder.get(left) - priorityOrder.get(right))[0] ?? "P2";
}

export function enrichHumanReviewQueue({ items, observations = [] }) {
  if (!Array.isArray(items)) throw new Error("items must be an array");
  if (!Array.isArray(observations)) throw new Error("observations must be an array");

  const byRequirement = new Map();
  for (const observation of observations) {
    const requirementId = observation?.profile_requirement_id;
    if (typeof requirementId !== "string" || !requirementId) continue;
    const current = byRequirement.get(requirementId) ?? [];
    current.push(observation);
    byRequirement.set(requirementId, current);
  }

  const seen = new Set();
  return items.map((item) => {
    if (!item || typeof item.requirement_id !== "string" || !item.requirement_id) {
      throw new Error("Each human review queue item requires requirement_id");
    }
    const related = byRequirement.get(item.requirement_id) ?? [];
    const targetLocations = uniqueText([
      ...(item.target_locations ?? []),
      ...related.map((observation) => observation.location)
    ]).sort((left, right) => left.localeCompare(right, "en"));
    const key = `${item.requirement_id}\u0000${targetLocations.join("\u0000")}`;
    if (seen.has(key)) throw new Error(`Duplicate human review queue item: ${item.requirement_id}`);
    seen.add(key);

    const reasons = uniqueText(related.map((observation) => observation.observation));
    return {
      ...item,
      reason: item.reason ?? (reasons.length ? reasons.join(" ") : "Review required by the selected profile requirement."),
      priority: item.priority ?? observationPriority(related),
      target_locations: targetLocations,
      related_screening_observation_ids: uniqueText(related.map((observation) => observation.requirement_id)).sort(),
      affected_users: uniqueText([
        ...(item.affected_users ?? []),
        ...related.flatMap((observation) => observation.affected_users ?? [])
      ]).sort((left, right) => left.localeCompare(right, "en")),
      source: item.source ?? (related.length ? "screening_observation" : "profile_coverage"),
      required_state: item.required_state ?? null,
      dependencies: uniqueText(item.dependencies ?? []).sort(),
      status: item.status ?? "open"
    };
  });
}
