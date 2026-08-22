import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeNewJson } from "./lib/audit-run.mjs";
import { profileConfiguration, recordsForProfile } from "./lib/profile-registry.mjs";
import { validateAssessment } from "./validate-assessment.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptDir);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, relativePath), "utf8"));
}

function requirementSource(record) {
  return record.normative_url ?? record.checklist_source_url ?? record.profile_source_url;
}

export function generateAssessment(profileId, options = {}) {
  const registry = readJson("references/standards-registry.json");
  const catalog = readJson("references/criteria-catalog.json");
  const profile = registry.profiles.find((item) => item.id === profileId);
  const supportedProfiles = registry.profiles
    .filter((item) => item.assessment_configuration?.active)
    .map((item) => item.id);
  if (!profile || !profileConfiguration(registry, profileId).active) {
    throw new Error(`Supported profiles: ${supportedProfiles.join(", ")}. Received: ${profileId}`);
  }

  const records = recordsForProfile({ profile, catalog });
  const results = records.map((record) => ({
    requirement_id: record.id,
    requirement_kind: "profile_requirement",
    requirement_source: requirementSource(record),
    mapping_status: "unverified",
    outcome: "not_tested",
    method_kind: "manual",
    method_ref: `web-audit-methods:1.0.0#${record.method_key}`,
    method: `Pending manual or hybrid review against ${record.id}; apply playbook ${record.method_key}, open the criterion's official sources, and record target-specific evidence.`,
    evidence: [],
    notes: "Not yet evaluated. Determine applicability from the normative source and record the rationale or observed result."
  }));

  if (results.length !== profile.requirement_ids.length) {
    throw new Error(`Catalog/profile count mismatch for ${profileId}: ${results.length} vs ${profile.requirement_ids.length}`);
  }

  return {
    schema_version: "1.0.0",
    assessment: {
      target: {
        name: options.targetName ?? "REPLACE_ME",
        version_or_commit: options.targetVersion ?? "REPLACE_ME",
        urls_or_files: options.targetRefs ?? []
      },
      profile: {
        id: profileId,
        registry_version: registry.schema_version
      },
      scope: {
        included: [],
        excluded: [],
        complete_processes: [],
        third_party_content: [],
        full_pages_reviewed: false
      },
      environment: {
        os: [],
        browsers: [],
        assistive_technologies: [],
        input_modes: []
      },
      results,
      findings: [],
      participation_coverage: {
        find: "not_tested",
        receive: "not_tested",
        understand: "not_tested",
        participate: "not_tested",
        continue: "not_tested"
      },
      evidence_level: "E0",
      assurance: {
        independent_audit: {
          performed: false,
          evaluator_independent: false,
          scope_method: "",
          report_location: ""
        },
        legal_or_procurement_dossier: {
          prepared: false,
          responsible_owner: "",
          artifacts: []
        }
      },
      claim: {
        requested_tier: "reference_only",
        proposed_wording: registry.claim_templates.reference_only[0]
      },
      evaluator: options.evaluator ?? "REPLACE_ME",
      evaluated_at: options.evaluatedAt ?? "YYYY-MM-DD",
      limitations: [
        "All profile requirements are initialized as not_tested; no accessibility conclusion has been made.",
        "Automated checks, if added, are supporting screening evidence and do not determine requirement outcomes."
      ],
      next_review_at: null
    }
  };
}

const valueFlags = new Map([
  ["--profile", "profileId"],
  ["--output", "output"],
  ["--target-name", "targetName"],
  ["--target-version", "targetVersion"],
  ["--evaluator", "evaluator"],
  ["--evaluated-at", "evaluatedAt"]
]);

function parseArgs(argv) {
  const options = { targetRefs: [], template: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
      seen.add(arg);
      options.help = true;
      continue;
    }
    if (arg === "--template") {
      if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
      seen.add(arg);
      options.template = true;
      continue;
    }
    if (arg === "--target-ref") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      options.targetRefs.push(next);
      index += 1;
      continue;
    }
    const key = valueFlags.get(arg);
    if (!key) throw new Error(`Unknown argument: ${arg}`);
    if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    seen.add(arg);
    options[key] = next;
    index += 1;
  }
  return options;
}

function requireRecordIdentity(options) {
  for (const [key, flag] of [
    ["targetName", "--target-name"],
    ["targetVersion", "--target-version"],
    ["evaluator", "--evaluator"],
    ["evaluatedAt", "--evaluated-at"]
  ]) {
    if (typeof options[key] !== "string" || options[key].trim().length === 0) {
      throw new Error(`${flag} is required in record mode`);
    }
  }
  if (options.targetRefs.length === 0) throw new Error("--target-ref is required in record mode");
}

function validateGeneratedRecord(record) {
  return validateAssessment(
    record,
    readJson("references/standards-registry.json"),
    readJson("references/assessment-record.schema.json"),
    readJson("references/criteria-catalog.json"),
    readJson("references/web-audit-methods.json")
  );
}

function usage() {
  return [
    "Usage:",
    "  node scripts/generate-assessment.mjs --profile <web-modern|jp-public-web> --target-name <name> --target-version <value> --target-ref <url|file> --evaluator <name> --evaluated-at <date> [--output <file>]",
    "  node scripts/generate-assessment.mjs --template --profile <web-modern|jp-public-web> [--output <file>]",
    "Options:",
    "  --template               Create an editable placeholder template; not a validated assessment",
    "  --output <file>          Write a new file through the safe exclusive writer",
    "  --target-name <name>     Required in record mode",
    "  --target-version <value> Required in record mode",
    "  --target-ref <url|file>  Required and repeatable in record mode",
    "  --evaluator <name>       Required in record mode",
    "  --evaluated-at <date>    Required in record mode"
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.profileId) throw new Error("--profile is required");
  if (!options.template) requireRecordIdentity(options);

  const record = generateAssessment(options.profileId, options);
  if (!options.template) {
    const validation = validateGeneratedRecord(record);
    if (!validation.valid) {
      throw new Error(`Generated assessment failed validation:\n- ${validation.errors.join("\n- ")}`);
    }
  }

  if (!options.output) {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }

  const output = writeNewJson(path.resolve(options.output), record);
  console.log(JSON.stringify({
    status: options.template ? "TEMPLATE_CREATED" : "PASS",
    mode: options.template ? "template" : "record",
    profile: options.profileId,
    output,
    requirements: record.assessment.results.length
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
