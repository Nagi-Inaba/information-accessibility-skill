import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { profileConfiguration, recordsForProfile } from "./lib/profile-registry.mjs";

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

function parseArgs(argv) {
  const options = { targetRefs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--profile") options.profileId = next;
    else if (arg === "--output") options.output = next;
    else if (arg === "--target-name") options.targetName = next;
    else if (arg === "--target-version") options.targetVersion = next;
    else if (arg === "--target-ref") options.targetRefs.push(next);
    else if (arg === "--evaluator") options.evaluator = next;
    else if (arg === "--evaluated-at") options.evaluatedAt = next;
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
    if (arg.startsWith("--") && arg !== "--help") {
      if (!next || next.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      index += 1;
    }
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/generate-assessment.mjs --profile <web-modern|jp-public-web> [options]",
    "Options:",
    "  --output <file>          Write a new file; refuses to overwrite",
    "  --target-name <name>",
    "  --target-version <value>",
    "  --target-ref <url|file>  Repeatable",
    "  --evaluator <name>",
    "  --evaluated-at <date>"
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.profileId) throw new Error("--profile is required");
  const record = generateAssessment(options.profileId, options);
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  if (!options.output) {
    process.stdout.write(serialized);
    return;
  }
  const output = path.resolve(options.output);
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing file: ${output}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, serialized, "utf8");
  console.log(JSON.stringify({ status: "PASS", profile: options.profileId, output, requirements: record.assessment.results.length }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
