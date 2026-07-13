import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const tierOrder = [
  "reference_only",
  "screened",
  "evaluated_subset",
  "evaluated_complete",
  "conformance_candidate",
  "human_signoff_required"
];

const evidenceOrder = ["E0", "E1", "E2", "E3", "E4", "E5"];

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function tierAtMost(left, right) {
  return tierOrder.indexOf(left) <= tierOrder.indexOf(right);
}

function urlMatchesRegisteredPrefix(source, registeredPrefix) {
  try {
    const sourceUrl = new URL(source);
    const prefixUrl = new URL(registeredPrefix);
    if (sourceUrl.origin !== prefixUrl.origin) return false;
    const prefixPath = prefixUrl.pathname;
    return prefixPath.endsWith("/")
      ? sourceUrl.pathname.startsWith(prefixPath)
      : sourceUrl.pathname === prefixPath || sourceUrl.pathname.startsWith(`${prefixPath}/`);
  } catch {
    return false;
  }
}

function urlEqualsCatalogSource(source, expected) {
  try {
    return new URL(source).href === new URL(expected).href;
  } catch {
    return false;
  }
}

function requirementGroup(profileId, requirementId) {
  if (profileId === "jp-public-web") {
    if (requirementId?.startsWith("JIS-X-8341-3-2016-SC-")) return "jis_x_8341_3_2016";
    if (requirementId?.startsWith("WCAG-2.2-ADDITIONAL-SC-")) return "jp_wcag_2_2_additional";
  }
  return profileId ?? "unknown";
}

function matchesSchemaType(value, expected) {
  if (expected === "null") return value === null;
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === expected;
}

function validateJsonSchema(value, schema, location = "$", errors = []) {
  const expectedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (expectedTypes.length && !expectedTypes.some((type) => matchesSchemaType(value, type))) {
    errors.push(`${location} must have type ${expectedTypes.join(" or ")}`);
    return errors;
  }
  if (Object.hasOwn(schema, "const") && value !== schema.const) errors.push(`${location} must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${location} must be one of ${schema.enum.join(", ")}`);
  if (typeof value === "string" && schema.minLength && value.length < schema.minLength) errors.push(`${location} must not be empty`);
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => validateJsonSchema(item, schema.items, `${location}[${index}]`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value) && schema.properties) {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push(`${location}.${required} is required by schema`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties, key)) errors.push(`${location}.${key} is not allowed by schema`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (Object.hasOwn(value, key)) validateJsonSchema(value[key], childSchema, `${location}.${key}`, errors);
    }
  }
  return errors;
}

export function validateAssessment(record, registry, schema, criteriaCatalog, auditMethods) {
  const errors = [];
  const warnings = [];
  const assessment = record?.assessment;

  if (!schema) {
    errors.push("assessment schema is required");
  } else {
    validateJsonSchema(record, schema, "$", errors);
  }

  if (record?.schema_version !== "1.0.0") {
    errors.push("schema_version must be 1.0.0");
  }
  if (!assessment || typeof assessment !== "object") {
    return { valid: false, errors: ["assessment object is required"], warnings, guard: null };
  }

  const profileId = assessment.profile?.id;
  const profile = registry.profiles.find((item) => item.id === profileId);
  if (!profile) {
    errors.push(`unknown profile: ${String(profileId)}`);
  }
  if (assessment.profile?.registry_version !== registry.schema_version) {
    errors.push(`profile.registry_version must be ${registry.schema_version}`);
  }
  const catalogRecords = Object.values(criteriaCatalog?.catalogs ?? {}).flat();
  const methodRecords = auditMethods?.methods ?? [];
  if (profile?.requirement_ids?.length && catalogRecords.length === 0) errors.push("criteria catalog is required for a standards profile");
  if (profile?.requirement_ids?.length && methodRecords.length === 0) errors.push("audit methods catalog is required for a standards profile");

  if (!hasText(assessment.target?.name)) errors.push("target.name is required");
  if (!hasText(assessment.target?.version_or_commit)) errors.push("target.version_or_commit is required");
  if (!Array.isArray(assessment.target?.urls_or_files)) errors.push("target.urls_or_files must be an array");

  const scope = assessment.scope;
  for (const key of ["included", "excluded", "complete_processes", "third_party_content"]) {
    if (!Array.isArray(scope?.[key])) errors.push(`scope.${key} must be an array`);
  }
  if (typeof scope?.full_pages_reviewed !== "boolean") errors.push("scope.full_pages_reviewed must be boolean");

  const environment = assessment.environment;
  for (const key of ["os", "browsers", "assistive_technologies", "input_modes"]) {
    if (!Array.isArray(environment?.[key])) errors.push(`environment.${key} must be an array`);
  }

  const results = Array.isArray(assessment.results) ? assessment.results : [];
  if (!Array.isArray(assessment.results)) errors.push("results must be an array");
  const seen = new Set();
  const outcomeCounts = Object.fromEntries(registry.outcomes.map((outcome) => [outcome, 0]));
  const profileOutcomeCounts = Object.fromEntries(registry.outcomes.map((outcome) => [outcome, 0]));
  const screeningOutcomeCounts = Object.fromEntries(registry.outcomes.map((outcome) => [outcome, 0]));
  const profileGroupOutcomeCounts = {};
  let manuallyMappedRequirementCount = 0;
  const humanVerifiedRequirementIds = new Set();

  results.forEach((result, index) => {
    const prefix = `results[${index}]`;
    if (!hasText(result.requirement_id)) {
      errors.push(`${prefix}.requirement_id is required`);
    } else if (seen.has(result.requirement_id)) {
      errors.push(`${prefix}.requirement_id is duplicated: ${result.requirement_id}`);
    } else {
      seen.add(result.requirement_id);
    }
    if (result.requirement_kind === "screening_check") {
      if (!result.requirement_id?.startsWith("SCREEN-")) errors.push(`${prefix}.requirement_id must start with SCREEN- for screening_check`);
      if (result.mapping_status !== "unverified") errors.push(`${prefix}.mapping_status must be unverified for screening_check`);
    } else if (result.requirement_kind === "profile_requirement") {
      if (!profile?.requirement_ids?.includes(result.requirement_id)) errors.push(`${prefix}.requirement_id is not registered for profile ${String(profileId)}`);
      if (!/^https:\/\//i.test(result.requirement_source ?? "")) errors.push(`${prefix}.requirement_source must be an HTTPS source URL`);
      const sourceRule = profile?.requirement_sources?.find((item) => result.requirement_id?.startsWith(item.id_prefix));
      if (!sourceRule?.url_prefixes?.some((urlPrefix) => urlMatchesRegisteredPrefix(result.requirement_source, urlPrefix))) {
        errors.push(`${prefix}.requirement_source does not match the registered source document for ${result.requirement_id}`);
      }
      const catalogRecord = catalogRecords.find((item) => item.id === result.requirement_id);
      const catalogSources = [catalogRecord?.normative_url, catalogRecord?.checklist_source_url, catalogRecord?.profile_source_url].filter(Boolean);
      if (!catalogRecord || !catalogSources.some((source) => urlEqualsCatalogSource(result.requirement_source, source))) {
        errors.push(`${prefix}.requirement_source does not match the catalog source for ${result.requirement_id}`);
      }
      const manualEvidenceTypes = new Set(["manual_observation", "browser_inspection", "keyboard_test", "assistive_technology_test", "document_structure_inspection"]);
      const hasManualEvidence = result.evidence?.some((item) => manualEvidenceTypes.has(item.type));
      const auditMethod = methodRecords.find((item) => item.id === catalogRecord?.method_key);
      if (!auditMethod) errors.push(`${prefix} has no registered audit playbook for ${catalogRecord?.method_key ?? result.requirement_id}`);
      const expectedMethodRef = auditMethod ? `web-audit-methods:${auditMethods.schema_version}#${auditMethod.id}` : null;
      if (result.outcome !== "not_tested" && result.method_ref !== expectedMethodRef) {
        errors.push(`${prefix}.method_ref must be ${expectedMethodRef}`);
      }
      if (["pass", "fail"].includes(result.outcome) && auditMethod && !result.evidence?.some((item) => auditMethod.required_evidence_types.includes(item.type))) {
        errors.push(`${prefix}.evidence must include a type required by playbook ${auditMethod.id}: ${auditMethod.required_evidence_types.join(", ")}`);
      }
      const reviewedByPerson = ["manual", "hybrid"].includes(result.method_kind) && hasManualEvidence;
      if (result.outcome !== "not_tested" && result.mapping_status !== "human_verified") {
        errors.push(`${prefix}.mapping_status must be human_verified for an evaluated profile requirement`);
      }
      if (result.mapping_status === "human_verified" && !["manual", "hybrid"].includes(result.method_kind)) {
        errors.push(`${prefix}.method_kind must be manual or hybrid for a human-verified profile requirement`);
      }
      if (["pass", "fail"].includes(result.outcome) && !hasManualEvidence) {
        errors.push(`${prefix}.evidence must include a manual evidence type for a profile-requirement ${result.outcome}`);
      }
      if (result.mapping_status === "human_verified" && reviewedByPerson && result.outcome !== "not_tested") {
        manuallyMappedRequirementCount += 1;
        humanVerifiedRequirementIds.add(result.requirement_id);
      }
    }
    if (!registry.outcomes.includes(result.outcome)) {
      errors.push(`${prefix}.outcome is invalid: ${String(result.outcome)}`);
    } else {
      outcomeCounts[result.outcome] += 1;
      if (result.requirement_kind === "profile_requirement") {
        profileOutcomeCounts[result.outcome] += 1;
        const group = requirementGroup(profileId, result.requirement_id);
        profileGroupOutcomeCounts[group] ??= Object.fromEntries(registry.outcomes.map((outcome) => [outcome, 0]));
        profileGroupOutcomeCounts[group][result.outcome] += 1;
      }
      if (result.requirement_kind === "screening_check") screeningOutcomeCounts[result.outcome] += 1;
    }
    if (!hasText(result.method)) errors.push(`${prefix}.method is required`);
    if (!Array.isArray(result.evidence)) {
      errors.push(`${prefix}.evidence must be an array`);
    } else {
      if (["pass", "fail"].includes(result.outcome) && result.evidence.length === 0) {
        errors.push(`${prefix}.evidence is required for ${result.outcome}`);
      }
      result.evidence.forEach((evidence, evidenceIndex) => {
        for (const key of ["type", "location", "observation", "captured_at"]) {
          if (!hasText(evidence?.[key])) errors.push(`${prefix}.evidence[${evidenceIndex}].${key} is required`);
        }
        if (hasText(evidence?.captured_at) && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(evidence.captured_at) || Number.isNaN(Date.parse(evidence.captured_at)))) {
          errors.push(`${prefix}.evidence[${evidenceIndex}].captured_at must be a parseable ISO 8601 date-time`);
        }
      });
    }
    if (["not_applicable", "not_tested", "cant_tell"].includes(result.outcome) && !hasText(result.notes)) {
      errors.push(`${prefix}.notes must explain ${result.outcome}`);
    }
  });

  const findingsProvided = Object.hasOwn(assessment, "findings");
  const findings = Array.isArray(assessment.findings) ? assessment.findings : [];
  if (findingsProvided && !Array.isArray(assessment.findings)) errors.push("findings must be an array");
  const findingIds = new Set();
  const resultsByRequirementId = new Map(results.filter((result) => hasText(result.requirement_id)).map((result) => [result.requirement_id, result]));
  const findingRequirementIds = new Set();
  findings.forEach((finding, index) => {
    const prefix = `findings[${index}]`;
    for (const key of ["id", "location", "observation", "remediation", "verification"]) {
      if (!hasText(finding?.[key])) errors.push(`${prefix}.${key} is required`);
    }
    if (hasText(finding?.id)) {
      if (findingIds.has(finding.id)) errors.push(`${prefix}.id is duplicated: ${finding.id}`);
      else findingIds.add(finding.id);
    }
    if (!["P0", "P1", "P2"].includes(finding?.priority)) errors.push(`${prefix}.priority must be P0, P1, or P2`);
    if (!Array.isArray(finding?.affected_users) || finding.affected_users.length === 0 || !finding.affected_users.every(hasText)) {
      errors.push(`${prefix}.affected_users must name at least one affected user group`);
    }
    if (!Array.isArray(finding?.requirement_ids) || !finding.requirement_ids.every(hasText)) {
      errors.push(`${prefix}.requirement_ids must be an array of non-empty identifiers`);
    } else {
      for (const requirementId of finding.requirement_ids) {
        const result = resultsByRequirementId.get(requirementId);
        if (!result) errors.push(`${prefix}.requirement_ids contains no recorded result: ${requirementId}`);
        else if (result.outcome !== "fail") errors.push(`${prefix}.requirement_ids must reference a failed result: ${requirementId}`);
        else findingRequirementIds.add(requirementId);
      }
    }
  });
  if (findingsProvided) {
    for (const result of results.filter((item) => item.outcome === "fail")) {
      if (!findingRequirementIds.has(result.requirement_id)) {
        errors.push(`A finding must reference failed requirement: ${result.requirement_id}`);
      }
    }
  } else if (results.some((result) => result.outcome === "fail")) {
    warnings.push("Legacy assessment record has failed results but no structured findings; use findings to make remediation and retest traceable.");
  }

  const coverage = assessment.participation_coverage;
  for (const key of ["find", "receive", "understand", "participate", "continue"]) {
    if (!registry.outcomes.includes(coverage?.[key])) {
      errors.push(`participation_coverage.${key} is invalid`);
    }
  }

  const evidenceLevel = assessment.evidence_level;
  if (!evidenceOrder.includes(evidenceLevel)) errors.push(`invalid evidence_level: ${String(evidenceLevel)}`);
  const independentAudit = assessment.assurance?.independent_audit;
  const dossier = assessment.assurance?.legal_or_procurement_dossier;
  if (typeof independentAudit?.performed !== "boolean") errors.push("assurance.independent_audit.performed must be boolean");
  if (typeof independentAudit?.evaluator_independent !== "boolean") errors.push("assurance.independent_audit.evaluator_independent must be boolean");
  if (!Array.isArray(dossier?.artifacts)) errors.push("assurance.legal_or_procurement_dossier.artifacts must be an array");
  if (typeof dossier?.prepared !== "boolean") errors.push("assurance.legal_or_procurement_dossier.prepared must be boolean");

  if (evidenceOrder.indexOf(evidenceLevel) >= evidenceOrder.indexOf("E4")) {
    if (!independentAudit?.performed || !independentAudit?.evaluator_independent) {
      errors.push("E4+ requires a performed audit by an independent evaluator");
    }
    if (!hasText(independentAudit?.scope_method) || !hasText(independentAudit?.report_location)) {
      errors.push("E4+ requires an audit scope method and report location");
    }
  }
  if (evidenceLevel === "E5") {
    if (!dossier?.prepared || !hasText(dossier?.responsible_owner) || !dossier?.artifacts?.length || !dossier.artifacts.every(hasText)) {
      errors.push("E5 requires a prepared dossier, responsible owner, and at least one dossier artifact");
    }
  }

  const requestedTier = assessment.claim?.requested_tier;
  if (!tierOrder.includes(requestedTier)) errors.push(`invalid claim.requested_tier: ${String(requestedTier)}`);
  const wording = assessment.claim?.proposed_wording ?? "";
  for (const prohibited of registry.global_prohibited_claims) {
    if (wording.toLocaleLowerCase().includes(prohibited.toLocaleLowerCase())) {
      errors.push(`proposed wording contains prohibited claim: ${prohibited}`);
    }
  }
  const allowedClaimTemplates = registry.claim_templates?.[requestedTier];
  if (!Array.isArray(allowedClaimTemplates) || allowedClaimTemplates.length === 0) {
    errors.push(`no registered claim template is available for ${requestedTier}`);
  } else if (!allowedClaimTemplates.includes(wording)) {
    errors.push(`proposed wording must exactly match a registered template for ${requestedTier}`);
  }

  let evidenceCeiling = "reference_only";
  if (evidenceLevel === "E1" && results.length > 0) evidenceCeiling = "screened";
  if (evidenceOrder.indexOf(evidenceLevel) >= evidenceOrder.indexOf("E2") && manuallyMappedRequirementCount > 0) {
    evidenceCeiling = "evaluated_subset";
  }
  if (evidenceOrder.indexOf(evidenceLevel) >= evidenceOrder.indexOf("E2") && manuallyMappedRequirementCount === 0) {
    errors.push("E2+ requires at least one human-verified profile requirement reviewed by a non-automated method");
  }
  if (evidenceOrder.indexOf(evidenceLevel) >= evidenceOrder.indexOf("E2")) {
    if (!assessment.target?.urls_or_files?.length) errors.push("E2+ requires at least one target URL or file");
    if (!scope?.included?.length) errors.push("E2+ requires a non-empty included scope");
  }
  const isWebProfile = ["web-modern", "jp-public-web"].includes(profileId);
  if (isWebProfile && evidenceOrder.indexOf(evidenceLevel) >= evidenceOrder.indexOf("E3")) {
    if (!scope?.full_pages_reviewed) errors.push("E3+ requires scope.full_pages_reviewed=true for Web profiles");
    if (!Array.isArray(scope?.complete_processes) || scope.complete_processes.length === 0) {
      errors.push("E3+ requires at least one complete process");
    }
    if (!environment?.input_modes?.includes("keyboard")) errors.push("E3+ requires keyboard interaction evidence");
    if (!environment?.os?.length || !environment?.browsers?.length) errors.push("E3+ requires real OS and browser environments");
    if (!environment?.assistive_technologies?.length) errors.push("E3+ requires relevant assistive-technology evidence");
    const profileEvidenceTypes = new Set(results
      .filter((result) => result.requirement_kind === "profile_requirement" && result.mapping_status === "human_verified")
      .flatMap((result) => result.evidence?.map((item) => item.type) ?? []));
    if (!profileEvidenceTypes.has("keyboard_test")) errors.push("E3+ requires at least one keyboard_test evidence item on a human-verified profile requirement");
    if (!profileEvidenceTypes.has("assistive_technology_test")) errors.push("E3+ requires at least one assistive_technology_test evidence item on a human-verified profile requirement");
  }

  let maxTier = evidenceCeiling;
  if (profile) {
    const profileCeiling = profile.claim_rules.claim_ceiling;
    if (!tierAtMost(maxTier, profileCeiling)) maxTier = profileCeiling;
    if (profile.implementation_status !== "active") maxTier = "reference_only";
    if (profile.criteria_catalog_status !== "complete" && tierOrder.indexOf(maxTier) > tierOrder.indexOf("evaluated_subset")) {
      maxTier = "evaluated_subset";
    }
  }

  const blockingOutcomes = ["fail", "not_tested", "cant_tell"].filter((outcome) => outcomeCounts[outcome] > 0);
  if (blockingOutcomes.length > 0 && tierOrder.indexOf(maxTier) > tierOrder.indexOf("evaluated_subset")) {
    maxTier = "evaluated_subset";
  }
  if (tierOrder.includes(requestedTier) && !tierAtMost(requestedTier, maxTier)) {
    errors.push(`requested tier ${requestedTier} exceeds guard ceiling ${maxTier}`);
  }
  if (tierOrder.indexOf(maxTier) < tierOrder.indexOf("conformance_candidate")) {
    const normalizedWording = wording.normalize("NFKC").toLocaleLowerCase().replace(/[\p{Pd}_]+/gu, " ");
    const formalDeterminationTerms = /\b(?:conform(?:s|ed|ance|ant)?|compli(?:es|ed|ant|ance)?|certif(?:y|ies|ied|ication)|meets?|satisf(?:y|ies|ied))\b|準拠|適合|認証|対応済み|問題なし|満た(?:す|した|して|している|しています)/iu;
    if (formalDeterminationTerms.test(normalizedWording)) {
      errors.push(`proposed wording uses a formal conformance determination term above guard ceiling ${maxTier}`);
    }
  }

  if (["metadata_only", "metadata_complete"].includes(profile?.criteria_catalog_status)) {
    warnings.push("The profile contains criterion metadata, not complete evaluation methods; complete coverage cannot be proven in this release.");
  }
  if ([assessment.target?.name, assessment.target?.version_or_commit, assessment.evaluator].some((value) => value === "REPLACE_ME")) {
    errors.push("Template placeholders must be replaced before validation.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(assessment.evaluated_at ?? "")) errors.push("evaluated_at must be YYYY-MM-DD");
  if (assessment.next_review_at !== null && !/^\d{4}-\d{2}-\d{2}$/.test(assessment.next_review_at ?? "")) {
    errors.push("next_review_at must be YYYY-MM-DD or null");
  }

  const expectedRequirementIds = profile?.requirement_ids ?? [];
  const recordedRequirementIds = results
    .filter((result) => result.requirement_kind === "profile_requirement" && expectedRequirementIds.includes(result.requirement_id))
    .map((result) => result.requirement_id);
  const missingRequirementIds = expectedRequirementIds.filter((id) => !recordedRequirementIds.includes(id));
  const extraRequirementIds = results
    .filter((result) => result.requirement_kind === "profile_requirement" && !expectedRequirementIds.includes(result.requirement_id))
    .map((result) => result.requirement_id);
  const evaluatedRequirementCount = humanVerifiedRequirementIds.size;

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    guard: {
      profile_id: profileId ?? null,
      requested_tier: requestedTier ?? null,
      max_tier: maxTier,
      blocking_outcomes: blockingOutcomes,
      outcome_counts: outcomeCounts,
      outcome_counts_scope: "all_results_legacy_aggregate",
      profile_outcome_counts: profileOutcomeCounts,
      profile_group_outcome_counts: profileGroupOutcomeCounts,
      screening_outcome_counts: screeningOutcomeCounts,
      catalog_coverage: {
        expected: expectedRequirementIds.length,
        recorded: recordedRequirementIds.length,
        missing_ids: missingRequirementIds,
        extra_ids: extraRequirementIds,
        complete: expectedRequirementIds.length > 0 && missingRequirementIds.length === 0 && extraRequirementIds.length === 0
      },
      evaluation_coverage: {
        human_verified: evaluatedRequirementCount,
        not_tested: profileOutcomeCounts.not_tested,
        cant_tell: profileOutcomeCounts.cant_tell,
        complete: expectedRequirementIds.length > 0 && evaluatedRequirementCount === expectedRequirementIds.length && profileOutcomeCounts.not_tested === 0 && profileOutcomeCounts.cant_tell === 0
      },
      formal_claim_requires_human_signoff: true
    }
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const assessmentPath = process.argv[2];
  if (!assessmentPath) {
    console.error("Usage: node validate-assessment.mjs <assessment.json> [standards-registry.json] [assessment-record.schema.json] [criteria-catalog.json] [web-audit-methods.json]");
    process.exit(2);
  }
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const registryPath = process.argv[3] ?? path.join(scriptDir, "..", "references", "standards-registry.json");
  const schemaPath = process.argv[4] ?? path.join(scriptDir, "..", "references", "assessment-record.schema.json");
  const catalogPath = process.argv[5] ?? path.join(scriptDir, "..", "references", "criteria-catalog.json");
  const methodsPath = process.argv[6] ?? path.join(scriptDir, "..", "references", "web-audit-methods.json");
  try {
    const result = validateAssessment(readJson(assessmentPath), readJson(registryPath), readJson(schemaPath), readJson(catalogPath), readJson(methodsPath));
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.valid ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
