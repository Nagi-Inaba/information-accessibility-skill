import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildRequirementsIndex } from "./browse-requirements.mjs";
import { profileConfiguration, recordsForProfile } from "./lib/profile-registry.mjs";
import {
  localizeAuditMethod,
  localizeCriterionProcedure,
  localizedProfile,
  normalizeRuntimeLocale,
  requirementsUi,
  runtimeLocaleFromEnvironment
} from "./lib/runtime-locale.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptDir);

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/u, ""));
}

export function lookupRequirement(profileId, requirementId, root = skillRoot, locale = "en") {
  const selectedLocale = normalizeRuntimeLocale(locale, "en");
  const registry = readJson(root, "references/standards-registry.json");
  const catalog = readJson(root, "references/criteria-catalog.json");
  const methods = readJson(root, "references/web-audit-methods.json");
  const criterionProcedures = readJson(root, "references/criterion-procedures.json");
  const profile = registry.profiles.find((item) => item.id === profileId);

  if (!profile) throw new Error(`Unknown profile: ${profileId}`);
  if (!profileConfiguration(registry, profileId).active || !profile.requirement_ids?.length) {
    throw new Error(`Profile does not have an active requirement catalog: ${profileId}`);
  }
  if (!profile.requirement_ids.includes(requirementId)) {
    throw new Error(`Requirement is not registered for profile ${profileId}: ${requirementId}`);
  }

  const criterion = recordsForProfile({ profile, catalog }).find((item) => item.id === requirementId);
  if (!criterion) throw new Error(`Requirement is missing from criteria-catalog.json: ${requirementId}`);
  const method = methods.methods.find((item) => item.id === criterion.method_key);
  if (!method) throw new Error(`Audit method is missing for ${requirementId}: ${criterion.method_key}`);

  const directCriterionProcedure = criterionProcedures.procedures.find(
    (item) => item.requirement_id === requirementId
  );
  const equivalentCriterionProcedure = !directCriterionProcedure && criterion.web_modern_record_id
    ? criterionProcedures.procedures.find(
      (item) => item.requirement_id === criterion.web_modern_record_id
    )
    : null;
  const criterionProcedure = directCriterionProcedure ?? equivalentCriterionProcedure;
  const localizedMethod = localizeAuditMethod(method, selectedLocale, root);
  const localizedCriterionProcedure = criterionProcedure
    ? localizeCriterionProcedure(criterionProcedure, selectedLocale, root)
    : null;
  const procedureOfficialSources = criterionProcedure
    ? [...new Set([
      ...(equivalentCriterionProcedure ? (criterion.official_method_sources ?? []) : []),
      ...criterionProcedure.primary_sources
    ])]
    : null;
  const procedureBinding = localizedCriterionProcedure ? {
    procedure_availability: "available",
    procedure_ref: `criterion-procedures:${criterionProcedures.schema_version}#${criterionProcedure.id}`,
    generic_method_ref: null,
    official_sources: procedureOfficialSources,
    human_actions: localizedCriterionProcedure.procedure_steps,
    required_evidence_types: localizedCriterionProcedure.required_evidence_types,
    cant_tell_conditions: localizedCriterionProcedure.cant_tell_when
  } : {
    procedure_availability: "unavailable",
    procedure_ref: null,
    generic_method_ref: `web-audit-methods:${methods.schema_version}#${method.id}`,
    official_sources: criterion.official_method_sources,
    human_actions: localizedMethod.procedure_steps,
    required_evidence_types: localizedMethod.required_evidence_types,
    cant_tell_conditions: [localizedMethod.cant_tell_when]
  };

  const indexed = buildRequirementsIndex(root).requirements.find(
    (item) => item.id === requirementId && item.profile_ids.includes(profileId)
  );
  if (!indexed) throw new Error(`Requirement metadata is missing from the browser index: ${requirementId}`);
  const displayTitle = selectedLocale === "ja" ? indexed.title_ja : indexed.title_en;
  const localized = localizedProfile(profile, selectedLocale);
  const ui = requirementsUi(selectedLocale);

  return {
    lookup_version: "2.0.0",
    locale: selectedLocale,
    profile: {
      id: localized.id,
      display_name: localized.display_name,
      target_scope: localized.target_scope,
      claim_ceiling: localized.claim_rules.claim_ceiling
    },
    criterion: {
      ...criterion,
      display_title: displayTitle,
      title_locale_status: indexed.title_locale_status
    },
    audit_method: localizedMethod,
    criterion_procedure_catalog_status: criterionProcedures.catalog_status,
    criterion_procedure_status: localizedCriterionProcedure ? "available" : "not_available",
    ...(localizedCriterionProcedure ? { criterion_procedure: localizedCriterionProcedure } : {}),
    procedure_binding: procedureBinding,
    catalog_verified_at: catalog.verified_at,
    method_catalog_verified_at: methods.verified_at,
    usage_boundary: ui.headings.usage_boundary
  };
}

function toMarkdown(result) {
  const criterion = result.criterion;
  const method = result.audit_method;
  const procedure = result.criterion_procedure;
  const ui = requirementsUi(result.locale);
  const h = ui.headings;
  const sources = [
    criterion.normative_url,
    criterion.checklist_source_url,
    criterion.profile_source_url,
    ...(criterion.official_method_sources ?? [])
  ].filter(Boolean);
  return [
    `# ${criterion.id}: ${criterion.display_title}`,
    "",
    `- ${h.profile}: ${result.profile.id}`,
    `- ${h.level}: ${criterion.level}`,
    `- SC: ${criterion.success_criterion}`,
    `- Method: ${method.id}`,
    `- Claim ceiling: ${result.profile.claim_ceiling}`,
    "",
    `## ${h.applicability}`,
    "",
    method.applicability_gate,
    "",
    `## ${h.procedure_heading}`,
    "",
    ...method.procedure_steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    `## ${h.evidence}`,
    "",
    ...method.required_evidence_types.map((type) => `- ${type}`),
    "",
    `${h.cant_tell}: ${method.cant_tell_when}`,
    ...(procedure ? [
      "",
      `## ${h.criterion_procedure}`,
      "",
      ...procedure.procedure_steps.map((step, index) => `${index + 1}. ${step}`),
      "",
      `## ${h.expected_results}`,
      "",
      ...procedure.expected_results.map((item) => `- ${item}`),
      "",
      `## ${h.criterion_cant_tell}`,
      "",
      ...procedure.cant_tell_when.map((item) => `- ${item}`),
      "",
      `## ${h.ai_boundary}`,
      "",
      procedure.ai_boundary
    ] : [
      "",
      `> ${h.procedure_unavailable}`
    ]),
    "",
    `## ${h.primary_sources}`,
    "",
    ...[...new Set(sources)].map((source) => `- ${source}`),
    "",
    `> ${result.usage_boundary}`,
    ""
  ].join("\n");
}

function parseArgs(argv) {
  const options = { format: "json", locale: runtimeLocaleFromEnvironment("en") };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (!["--profile", "--id", "--format", "--locale"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
    seen.add(arg);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (arg === "--profile") options.profile = value;
    if (arg === "--id") options.id = value;
    if (arg === "--format") options.format = value;
    if (arg === "--locale") options.locale = value;
    index += 1;
  }
  options.locale = normalizeRuntimeLocale(options.locale, "en");
  if (!["json", "markdown"].includes(options.format)) throw new Error("--format must be json or markdown");
  return options;
}

function usage(locale = "en") {
  if (locale === "ja") {
    return [
      "使用方法:",
      "  node scripts/show-requirement.mjs --profile <profile-id> --id <requirement-id> [--locale ja|en] [--format json|markdown]"
    ].join("\n");
  }
  return [
    "Usage:",
    "  node scripts/show-requirement.mjs --profile <profile-id> --id <requirement-id> [--locale ja|en] [--format json|markdown]"
  ].join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage(options.locale)}\n`);
    return 0;
  }
  if (!options.profile || !options.id) throw new Error("--profile and --id are required");
  const result = lookupRequirement(options.profile, options.id, skillRoot, options.locale);
  if (options.format === "markdown") process.stdout.write(toMarkdown(result));
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
