const configurationFields = new Set([
  "active",
  "catalog_keys",
  "groups",
  "requires_web_interaction_evidence"
]);
const groupFields = new Set(["id", "label", "requirement_id_prefixes"]);
const groupIdPattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const unsafeGroupIds = new Set(["__proto__", "prototype", "constructor"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateStringArray(value, location, errors, { minItems = 0, unique = false } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${location} must be an array.`);
    return false;
  }
  if (value.length < minItems) errors.push(`${location} must contain at least ${minItems} item(s).`);
  value.forEach((item, index) => {
    if (typeof item !== "string" || item.length === 0) errors.push(`${location}[${index}] must be a non-empty string.`);
  });
  if (unique && new Set(value).size !== value.length) errors.push(`${location} must contain unique values.`);
  return true;
}

function validateProfile(profile, location, errors) {
  if (!isPlainObject(profile)) {
    errors.push(`${location} must be an object.`);
    return;
  }
  if (typeof profile.id !== "string" || profile.id.length === 0) errors.push(`${location}.id must be a non-empty string.`);

  const configurationLocation = `${location}.assessment_configuration`;
  const configuration = profile.assessment_configuration;
  if (!isPlainObject(configuration)) {
    errors.push(`${configurationLocation} must be an object.`);
    return;
  }
  for (const key of Object.keys(configuration)) {
    if (!configurationFields.has(key)) errors.push(`${configurationLocation}.${key} is not allowed.`);
  }
  if (typeof configuration.active !== "boolean") errors.push(`${configurationLocation}.active must be boolean.`);

  const active = configuration.active === true;
  for (const field of ["catalog_keys", "groups", "requires_web_interaction_evidence"]) {
    if (active && !Object.hasOwn(configuration, field)) errors.push(`${configurationLocation}.${field} is required when active.`);
  }
  if (Object.hasOwn(configuration, "requires_web_interaction_evidence")
      && typeof configuration.requires_web_interaction_evidence !== "boolean") {
    errors.push(`${configurationLocation}.requires_web_interaction_evidence must be boolean.`);
  }
  if (Object.hasOwn(configuration, "catalog_keys")) {
    validateStringArray(configuration.catalog_keys, `${configurationLocation}.catalog_keys`, errors, { minItems: 1, unique: true });
  }

  const groupsAreArray = Object.hasOwn(configuration, "groups")
    ? Array.isArray(configuration.groups)
    : false;
  if (Object.hasOwn(configuration, "groups") && !groupsAreArray) {
    errors.push(`${configurationLocation}.groups must be an array.`);
  }
  if (groupsAreArray && configuration.groups.length === 0) {
    errors.push(`${configurationLocation}.groups must contain at least 1 item(s).`);
  }

  const seenGroupIds = new Set();
  for (const [index, group] of (groupsAreArray ? configuration.groups : []).entries()) {
    const groupLocation = `${configurationLocation}.groups[${index}]`;
    if (!isPlainObject(group)) {
      errors.push(`${groupLocation} must be an object.`);
      continue;
    }
    for (const key of Object.keys(group)) {
      if (!groupFields.has(key)) errors.push(`${groupLocation}.${key} is not allowed.`);
    }
    for (const field of groupFields) {
      if (!Object.hasOwn(group, field)) errors.push(`${groupLocation}.${field} is required.`);
    }
    if (typeof group.id !== "string" || !groupIdPattern.test(group.id) || unsafeGroupIds.has(group.id)) {
      errors.push(`${groupLocation}.id must be a safe group id using lowercase letters, digits, and single underscores.`);
    } else if (seenGroupIds.has(group.id)) {
      errors.push(`${groupLocation}.id has duplicate group id: ${group.id}.`);
    } else {
      seenGroupIds.add(group.id);
    }
    if (typeof group.label !== "string" || group.label.length === 0) errors.push(`${groupLocation}.label must be a non-empty string.`);
    if (Object.hasOwn(group, "requirement_id_prefixes")) {
      validateStringArray(group.requirement_id_prefixes, `${groupLocation}.requirement_id_prefixes`, errors, { minItems: 1, unique: true });
    }
  }

  if (!active) return;
  const requirementIdsValid = validateStringArray(profile.requirement_ids, `${location}.requirement_ids`, errors, { minItems: 1, unique: true });
  if (!requirementIdsValid || !groupsAreArray) return;
  for (const requirementId of profile.requirement_ids) {
    if (typeof requirementId !== "string") continue;
    const matchingPrefixes = configuration.groups.flatMap((group) => Array.isArray(group?.requirement_id_prefixes)
      ? group.requirement_id_prefixes.filter((prefix) => typeof prefix === "string" && requirementId.startsWith(prefix))
      : []);
    if (matchingPrefixes.length !== 1) {
      errors.push(`${location}.requirement_ids entry must match exactly one report-group prefix: ${requirementId}; matched ${matchingPrefixes.length}.`);
    }
  }
}

export function validateStandardsRegistry(registry) {
  const errors = [];
  if (!isPlainObject(registry)) return { valid: false, errors: ["Standards registry must be an object."] };

  if (registry.schema_version !== "1.0.0") errors.push("schema_version must equal \"1.0.0\".");
  if (typeof registry.last_verified_at !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(registry.last_verified_at)) {
    errors.push("last_verified_at must be YYYY-MM-DD.");
  }
  validateStringArray(registry.outcomes, "outcomes", errors, { minItems: 1, unique: true });
  validateStringArray(registry.claim_tiers, "claim_tiers", errors, { minItems: 1, unique: true });
  if (!isPlainObject(registry.claim_templates)) errors.push("claim_templates must be an object.");
  if (!isPlainObject(registry.evidence_levels)) errors.push("evidence_levels must be an object.");
  validateStringArray(registry.global_prohibited_claims, "global_prohibited_claims", errors);
  validateStringArray(registry.planned_profiles, "planned_profiles", errors, { unique: true });

  if (!Array.isArray(registry.profiles)) {
    errors.push("profiles must be an array.");
  } else {
    if (registry.profiles.length === 0) errors.push("profiles must contain at least 1 item(s).");
    const profileIds = new Set();
    registry.profiles.forEach((profile, index) => {
      const location = `profiles[${index}]${typeof profile?.id === "string" ? `(${profile.id})` : ""}`;
      validateProfile(profile, location, errors);
      if (typeof profile?.id === "string") {
        if (profileIds.has(profile.id)) errors.push(`${location}.id is duplicated: ${profile.id}.`);
        profileIds.add(profile.id);
      }
    });
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidStandardsRegistry(registry) {
  const result = validateStandardsRegistry(registry);
  if (!result.valid) throw new Error(`Invalid standards registry:\n- ${result.errors.join("\n- ")}`);
  return registry;
}

function assessmentConfiguration(profile) {
  const errors = [];
  validateProfile(profile, `profile(${profile?.id ?? "unknown"})`, errors);
  if (errors.length > 0) throw new Error(`Invalid profile configuration:\n- ${errors.join("\n- ")}`);
  return profile.assessment_configuration;
}

export function profileConfiguration(registry, profileId) {
  assertValidStandardsRegistry(registry);
  const profile = registry.profiles.find((item) => item.id === profileId);
  if (!profile) throw new Error(`Unknown profile: ${profileId}`);
  return profile.assessment_configuration;
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
  const configuration = assessmentConfiguration(profile);
  if (!profile.requirement_ids.includes(requirementId)) {
    throw new Error(`Requirement is not registered for profile ${profile.id}: ${requirementId}`);
  }
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
  return configuration.groups;
}
