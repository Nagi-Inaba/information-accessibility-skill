function assessmentConfiguration(profile) {
  if (!profile || typeof profile !== "object") throw new Error("Profile is required.");
  const configuration = profile.assessment_configuration;
  if (!configuration || typeof configuration !== "object") {
    throw new Error(`Profile is missing assessment_configuration: ${profile.id ?? "unknown"}`);
  }
  return configuration;
}

export function profileConfiguration(registry, profileId) {
  const profile = registry?.profiles?.find((item) => item.id === profileId);
  if (!profile) throw new Error(`Unknown profile: ${profileId}`);
  return assessmentConfiguration(profile);
}

export function recordsForProfile({ profile, catalog }) {
  const configuration = assessmentConfiguration(profile);
  if (!configuration.active) {
    throw new Error(`Profile does not have a generated audit catalog: ${profile.id}`);
  }
  if (!catalog?.catalogs || typeof catalog.catalogs !== "object") {
    throw new Error("Criteria catalog is missing catalogs.");
  }

  return configuration.catalog_keys.flatMap((catalogKey) => {
    const records = catalog.catalogs[catalogKey];
    if (!Array.isArray(records)) {
      throw new Error(`Configured catalog key is missing or is not an array: ${catalogKey}`);
    }
    return records;
  });
}

export function groupForRequirement(profile, requirementId) {
  if (!profile?.requirement_ids?.includes(requirementId)) {
    throw new Error(`Requirement is not registered for profile ${profile?.id ?? "unknown"}: ${requirementId}`);
  }
  const configuration = assessmentConfiguration(profile);
  if (!configuration.active) {
    throw new Error(`Profile does not have active report groups: ${profile.id}`);
  }

  const matches = configuration.groups.flatMap((group) => group.requirement_id_prefixes
    .filter((prefix) => requirementId.startsWith(prefix))
    .map(() => group));
  if (matches.length !== 1) {
    throw new Error(`Registered requirement must match exactly one report-group prefix: ${requirementId}; matched ${matches.length}`);
  }
  return matches[0].id;
}

export function reportGroups(profile) {
  const configuration = assessmentConfiguration(profile);
  if (!configuration.active) return [];
  for (const requirementId of profile.requirement_ids ?? []) groupForRequirement(profile, requirementId);
  return configuration.groups;
}
