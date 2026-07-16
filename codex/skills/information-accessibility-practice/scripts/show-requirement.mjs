import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { profileConfiguration, recordsForProfile } from "./lib/profile-registry.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptDir);

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/, ""));
}

export function lookupRequirement(profileId, requirementId, root = skillRoot) {
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
  const criterionProcedure = criterionProcedures.procedures.find((item) => item.requirement_id === requirementId);

  return {
    lookup_version: "1.0.0",
    profile: {
      id: profile.id,
      display_name: profile.display_name,
      target_scope: profile.target_scope,
      claim_ceiling: profile.claim_rules.claim_ceiling
    },
    criterion,
    audit_method: method,
    criterion_procedure_catalog_status: criterionProcedures.catalog_status,
    criterion_procedure_status: criterionProcedure ? "available" : "not_available",
    ...(criterionProcedure ? { criterion_procedure: criterionProcedure } : {}),
    catalog_verified_at: catalog.verified_at,
    method_catalog_verified_at: methods.verified_at,
    usage_boundary: "Open the criterion's primary sources before evaluating it. This lookup is a reproducibility aid, not a conformance determination."
  };
}

function toMarkdown(result) {
  const criterion = result.criterion;
  const method = result.audit_method;
  const procedure = result.criterion_procedure;
  const sources = [
    criterion.normative_url,
    criterion.checklist_source_url,
    criterion.profile_source_url,
    ...(criterion.official_method_sources ?? [])
  ].filter(Boolean);
  return [
    `# ${criterion.id}: ${criterion.title_en ?? criterion.title_ja ?? criterion.success_criterion}`,
    "",
    `- Profile: ${result.profile.id}`,
    `- Level: ${criterion.level}`,
    `- Success criterion: ${criterion.success_criterion}`,
    `- Method: ${method.id}`,
    `- Claim ceiling: ${result.profile.claim_ceiling}`,
    "",
    "## Applicability",
    "",
    method.applicability_gate,
    "",
    "## Procedure",
    "",
    ...method.procedure_steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Evidence",
    "",
    ...method.required_evidence_types.map((type) => `- ${type}`),
    "",
    `Record \`cant_tell\` when: ${method.cant_tell_when}`,
    ...(procedure ? [
      "",
      "## Criterion-specific human procedure",
      "",
      ...procedure.procedure_steps.map((step, index) => `${index + 1}. ${step}`),
      "",
      "## Expected results",
      "",
      ...procedure.expected_results.map((item) => `- ${item}`),
      "",
      "## Criterion-specific cannot tell",
      "",
      ...procedure.cant_tell_when.map((item) => `- ${item}`),
      "",
      "## AI boundary",
      "",
      procedure.ai_boundary
    ] : [
      "",
      "> No criterion-specific procedure is bundled for this requirement. Use the routed generic playbook and primary sources; do not infer that this partial procedure catalog covers the requirement."
    ]),
    "",
    "## Primary Sources",
    "",
    ...[...new Set(sources)].map((source) => `- ${source}`),
    "",
    `> ${result.usage_boundary}`,
    ""
  ].join("\n");
}

function parseArgs(argv) {
  const options = { format: "json" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (!["--profile", "--id", "--format"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (arg === "--profile") options.profile = value;
    if (arg === "--id") options.id = value;
    if (arg === "--format") options.format = value;
    index += 1;
  }
  if (!["json", "markdown"].includes(options.format)) throw new Error("--format must be json or markdown");
  return options;
}

function usage() {
  return [
    "Usage: node scripts/show-requirement.mjs --profile <profile-id> --id <requirement-id> [--format json|markdown]",
    "",
    "Examples:",
    "  node scripts/show-requirement.mjs --profile web-modern --id WCAG-2.2-SC-2.1.1",
    "  node scripts/show-requirement.mjs --profile jp-public-web --id JIS-X-8341-3-2016-SC-4.1.1 --format markdown"
  ].join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.profile || !options.id) throw new Error("--profile and --id are required");
  const result = lookupRequirement(options.profile, options.id);
  if (options.format === "markdown") process.stdout.write(toMarkdown(result));
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
