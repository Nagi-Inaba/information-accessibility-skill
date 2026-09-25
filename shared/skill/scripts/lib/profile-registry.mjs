const configurationFields = new Set([
  "active",
  "catalog_keys",
  "groups",
  "requires_web_interaction_evidence"
]);
const groupFields = new Set(["id", "label", "requirement_id_prefixes"]);
const basisFields = new Set(["kind", "adoption", "source_ids", "label_en", "label_ja", "scope_en", "scope_ja"]);
const groupIdPattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const unsafeGroupIds = new Set(["__proto__", "prototype", "constructor"]);
const profileKinds = new Set(["standard_profile", "organizational_policy_pattern"]);
const basisKinds = new Set(["standard", "organizational_policy"]);
const adoptionKinds = new Set(["profile_default", "explicit_only"]);

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

function validateLocalizedProfile(profile, groupIds, location, errors) {
  const localized = profile.localized;
  if (!isPlainObject(localized) || !isPlainObject(localized.ja)) {
    errors.push(`${location}.localized.ja must be an object for an active profile.`);
    return;
  }
  for (const field of ["display_name", "target_scope"]) {
    if (typeof localized.ja[field] !== "string" || localized.ja[field].length === 0) {
      errors.push(`${location}.localized.ja.${field} must be a non-empty string.`);
    }
  }
  if (!isPlainObject(localized.ja.groups)) {
    errors.push(`${location}.localized.ja.groups must be an object.`);
    return;
  }
  const localizedGroupIds = Object.keys(localized.ja.groups).sort();
  if (JSON.stringify(localizedGroupIds) !== JSON.stringify([...groupIds].sort())) {
    errors.push(`${location}.localized.ja.groups keys must exactly match active report group IDs.`);
  }
  for (const [groupId, label] of Object.entries(localized.ja.groups)) {
    if (typeof label !== "string" || label.length === 0) errors.push(`${location}.localized.ja.groups.${groupId} must be a non-empty string.`);
  }
}

function validateGroupBases(profile, groupIds, location, errors) {
  if (!isPlainObject(profile.group_bases)) {
    errors.push(`${location}.group_bases must be an object for an active profile.`);
    return;
  }
  const basisGroupIds = Object.keys(profile.group_bases).sort();
  if (JSON.stringify(basisGroupIds) !== JSON.stringify([...groupIds].sort())) {
    errors.push(`${location}.group_bases keys must exactly match active report group IDs.`);
  }
  const standardIds = new Set((profile.standards ?? []).map((item) => item?.id).filter(Boolean));
  for (const [groupId, basis] of Object.entries(profile.group_bases)) {
    const basisLocation = `${location}.group_bases.${groupId}`;
    if (!isPlainObject(basis)) {
      errors.push(`${basisLocation} must be an object.`);
      continue;
    }
    for (const key of Object.keys(basis)) if (!basisFields.has(key)) errors.push(`${basisLocation}.${key} is not allowed.`);
    for (const field of basisFields) if (!Object.hasOwn(basis, field)) errors.push(`${basisLocation}.${field} is required.`);
    if (!basisKinds.has(basis.kind)) errors.push(`${basisLocation}.kind must be standard or organizational_policy.`);
    if (!adoptionKinds.has(basis.adoption)) errors.push(`${basisLocation}.adoption must be profile_default or explicit_only.`);
    if (validateStringArray(basis.source_ids, `${basisLocation}.source_ids`, errors, { minItems: 1, unique: true })) {
      for (const sourceId of basis.source_ids) {
        if (!standardIds.has(sourceId)) errors.push(`${basisLocation}.source_ids references an unknown profile source: ${sourceId}.`);
      }
    }
    for (const field of ["label_en", "label_ja", "scope_en", "scope_ja"]) {
      if (typeof basis[field] !== "string" || basis[field].length === 0) errors.push(`${basisLocation}.${field} must be a non-empty string.`);
    }
    if (basis.kind === "organizational_policy" && basis.adoption !== "explicit_only") {
      errors.push(`${basisLocation} organizational_policy basis must use explicit_only adoption.`);
    }
  }
}

function validateMigration(profile, location, errors) {
  if (!Object.hasOwn(profile, "migration")) return;
  const migration = profile.migration;
  if (!isPlainObject(migration)) {
    errors.push(`${location}.migration must be an object.`);
    return;
  }
  for (const field of ["status", "guidance"]) {
    if (typeof migration[field] !== "string" || migration[field].length === 0) errors.push(`${location}.migration.${field} must be a non-empty string.`);
  }
  validateStringArray(migration.recommended_profile_ids, `${location}.migration.recommended_profile_ids`, errors, { minItems: 1, unique: true });
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

  const groupsAreArray = Object.hasOwn(configuration, "groups") ? Array.isArray(configuration.groups) : false;
  if (Object.hasOwn(configuration, "groups") && !groupsAreArray) errors.push(`${configurationLocation}.groups must be an array.`);
  if (groupsAreArray && configuration.groups.length === 0) errors.push(`${configurationLocation}.groups must contain at least 1 item(s).`);

  const seenGroupIds = new Set();
  for (const [index, group] of (groupsAreArray ? configuration.groups : []).entries()) {
    const groupLocation = `${configurationLocation}.groups[${index}]`;
    if (!isPlainObject(group)) {
      errors.push(`${groupLocation} must be an object.`);
      continue;
    }
    for (const key of Object.keys(group)) if (!groupFields.has(key)) errors.push(`${groupLocation}.${key} is not allowed.`);
    for (const field of groupFields) if (!Object.hasOwn(group, field)) errors.push(`${groupLocation}.${field} is required.`);
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

  validateMigration(profile, location, errors);
  if (!active) return;

  if (!profileKinds.has(profile.profile_kind)) errors.push(`${location}.profile_kind must be standard_profile or organizational_policy_pattern.`);
  if (typeof profile.explicit_adoption_required !== "boolean") errors.push(`${location}.explicit_adoption_required must be boolean.`);
  if (profile.profile_kind === "organizational_policy_pattern" && profile.explicit_adoption_required !== true) {
    errors.push(`${location} organizational_policy_pattern must require explicit adoption.`);
  }
  validateLocalizedProfile(profile, seenGroupIds, location, errors);
  validateGroupBases(profile, seenGroupIds, location, errors);

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
    registry.profiles.forEach((profile, index) => {
      for (const recommended of profile?.migration?.recommended_profile_ids ?? []) {
        if (!profileIds.has(recommended)) errors.push(`profiles[${index}](${profile.id}).migration references unknown profile: ${recommended}.`);
        if (recommended === profile.id) errors.push(`profiles[${index}](${profile.id}).migration cannot recommend itself.`);
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
  if (!configuration.active) throw new Error(`Profile does not have a generated audit catalog: ${profile.id}`);
  if (!catalog?.catalogs || typeof catalog.catalogs !== "object") throw new Error("Criteria catalog is missing catalogs.");
  return configuration.catalog_keys.flatMap((catalogKey) => {
    const records = catalog.catalogs[catalogKey];
    if (!Array.isArray(records)) throw new Error(`Configured catalog key is missing or is not an array: ${catalogKey}`);
    return records;
  });
}

export function groupForRequirement(profile, requirementId) {
  const configuration = assessmentConfiguration(profile);
  if (!profile.requirement_ids.includes(requirementId)) throw new Error(`Requirement is not registered for profile ${profile.id}: ${requirementId}`);
  if (!configuration.active) throw new Error(`Profile does not have active report groups: ${profile.id}`);
  const matches = configuration.groups.flatMap((group) => group.requirement_id_prefixes
    .filter((prefix) => requirementId.startsWith(prefix))
    .map(() => group));
  if (matches.length !== 1) throw new Error(`Registered requirement must match exactly one report-group prefix: ${requirementId}; matched ${matches.length}`);
  return matches[0].id;
}

export function localizedGroupBasis(profile, groupId, locale = "en") {
  assessmentConfiguration(profile);
  const basis = profile.group_bases?.[groupId];
  if (!basis) throw new Error(`Profile group basis is missing: ${profile.id}:${groupId}`);
  const selectedLocale = locale === "ja" ? "ja" : "en";
  return {
    kind: basis.kind,
    adoption: basis.adoption,
    source_ids: structuredClone(basis.source_ids),
    label: basis[`label_${selectedLocale}`],
    scope: basis[`scope_${selectedLocale}`]
  };
}

export function reportGroups(profile, locale = "en") {
  const configuration = assessmentConfiguration(profile);
  if (!configuration.active) return [];
  return configuration.groups.map((group) => ({
    ...group,
    basis: localizedGroupBasis(profile, group.id, locale)
  }));
}
