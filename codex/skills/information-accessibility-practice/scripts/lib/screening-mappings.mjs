const outcomes = new Set(["pass", "fail", "not_applicable", "not_tested", "cant_tell"]);
const applicabilityValues = new Set(["applicable", "not_applicable", "undetermined"]);

function normalizeMapping(mapping, observationId) {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) throw new Error(`${observationId} contains an invalid profile mapping`);
  const requirementId = mapping.requirement_id ?? mapping.profile_requirement_id;
  if (typeof requirementId !== "string" || !requirementId) throw new Error(`${observationId} profile mapping requires requirement_id`);
  if (!outcomes.has(mapping.report_outcome)) throw new Error(`${observationId} mapping ${requirementId} requires a registered report_outcome`);
  if (!applicabilityValues.has(mapping.applicability)) throw new Error(`${observationId} mapping ${requirementId} requires a registered applicability`);
  if (typeof mapping.rationale !== "string" || !mapping.rationale.trim()) throw new Error(`${observationId} mapping ${requirementId} requires rationale`);
  return {
    requirement_id: requirementId,
    applicability: mapping.applicability,
    report_outcome: mapping.report_outcome,
    rationale: mapping.rationale.trim()
  };
}

export function normalizeScreeningMappings(observation) {
  const observationId = observation?.requirement_id ?? observation?.observation_id;
  if (typeof observationId !== "string" || !observationId) throw new Error("Screening observation requires requirement_id or observation_id");
  let mappings = observation.profile_mappings;
  if (!Array.isArray(mappings)) {
    if (typeof observation.profile_requirement_id !== "string") throw new Error(`${observationId} requires profile_mappings or legacy profile_requirement_id`);
    mappings = [{
      requirement_id: observation.profile_requirement_id,
      applicability: observation.applicability,
      report_outcome: observation.report_outcome,
      rationale: observation.report_rationale ?? observation.observation
    }];
  }
  if (mappings.length === 0) throw new Error(`${observationId} profile_mappings must not be empty`);
  const normalized = mappings.map((mapping) => normalizeMapping(mapping, observationId));
  const requirementIds = normalized.map((mapping) => mapping.requirement_id);
  if (new Set(requirementIds).size !== requirementIds.length) throw new Error(`${observationId} contains duplicate profile requirement mappings`);
  return {
    observation_id: observationId,
    location: observation.location ?? null,
    observation: observation.observation ?? null,
    evidence_level: observation.evidence_level ?? "E0",
    profile_mappings: normalized
  };
}

function hasOutcomeConflict(outcomesForRequirement) {
  const set = new Set(outcomesForRequirement);
  return (set.has("pass") && set.has("fail"))
    || (set.has("not_applicable") && [...set].some((value) => value !== "not_applicable" && value !== "not_tested"));
}

export function analyzeScreeningMappings(observations) {
  if (!Array.isArray(observations)) throw new Error("observations must be an array");
  const normalized = observations.map(normalizeScreeningMappings);
  const observationIds = normalized.map((observation) => observation.observation_id);
  if (new Set(observationIds).size !== observationIds.length) throw new Error("Screening observation IDs must be unique");

  const byRequirement = new Map();
  for (const observation of normalized) {
    for (const mapping of observation.profile_mappings) {
      const rows = byRequirement.get(mapping.requirement_id) ?? [];
      rows.push({ observation_id: observation.observation_id, location: observation.location, ...mapping });
      byRequirement.set(mapping.requirement_id, rows);
    }
  }

  const conflicts = [];
  const requirements = [];
  for (const [requirementId, rows] of [...byRequirement].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    const outcomeValues = rows.map((row) => row.report_outcome);
    const applicabilitySet = new Set(rows.map((row) => row.applicability).filter((value) => value !== "undetermined"));
    const conflictTypes = [];
    if (hasOutcomeConflict(outcomeValues)) conflictTypes.push("report_outcome");
    if (applicabilitySet.has("applicable") && applicabilitySet.has("not_applicable")) conflictTypes.push("applicability");
    if (conflictTypes.length) {
      conflicts.push({ requirement_id: requirementId, conflict_types: conflictTypes, observation_ids: rows.map((row) => row.observation_id).sort() });
    }
    requirements.push({
      requirement_id: requirementId,
      observation_ids: rows.map((row) => row.observation_id).sort(),
      locations: [...new Set(rows.map((row) => row.location).filter(Boolean))].sort(),
      report_outcomes: [...new Set(outcomeValues)].sort(),
      applicability: [...new Set(rows.map((row) => row.applicability))].sort()
    });
  }

  return {
    barrier_count: normalized.length,
    mapping_count: normalized.reduce((total, observation) => total + observation.profile_mappings.length, 0),
    requirement_count: requirements.length,
    requirements,
    conflicts,
    needs_human_adjudication: conflicts.length > 0
  };
}
