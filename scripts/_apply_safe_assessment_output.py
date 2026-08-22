from pathlib import Path

# 1. Extend the existing fail-closed writer so all callers share safe parent creation.
for path in [
    Path("codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs"),
    Path("claude/skills/information-accessibility-practice/scripts/lib/audit-run.mjs"),
]:
    text = path.read_text(encoding="utf-8")
    anchor = '''function inspectSafeOutput(output) {
  const absolute = path.resolve(output);'''
    helper = '''export function prepareSafeOutputDirectory(directory) {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    const next = path.join(current, part);
    try {
      const stats = fs.lstatSync(next);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`Unsafe output directory component: ${next}`);
      }
      const real = fs.realpathSync.native(next);
      if (pathKey(real) !== pathKey(next)) {
        throw new Error(`Unsafe output directory reparse traversal from ${next} to ${real}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      try {
        fs.mkdirSync(next, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError.code !== "EEXIST") throw mkdirError;
      }
      inspectRealComponents(next, { type: "directory", label: "output directory" });
    }
    current = next;
  }
  return absolute;
}

function inspectSafeOutput(output) {
  const absolute = path.resolve(output);'''
    if anchor not in text:
        raise SystemExit(f"safe output insertion anchor missing: {path}")
    text = text.replace(anchor, helper, 1)
    old_parent = '''  const parent = inspectRealComponents(path.dirname(absolute), { type: "directory", label: "output parent" });'''
    new_parent = '''  const parentPath = prepareSafeOutputDirectory(path.dirname(absolute));
  const parent = inspectRealComponents(parentPath, { type: "directory", label: "output parent" });'''
    if old_parent not in text:
        raise SystemExit(f"safe output parent anchor missing: {path}")
    path.write_text(text.replace(old_parent, new_parent, 1), encoding="utf-8")

# 2. Replace the generator CLI contract while preserving generateAssessment() for library callers.
generator_source = r'''import fs from "node:fs";
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
'''

for path in [
    Path("codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs"),
    Path("claude/skills/information-accessibility-practice/scripts/generate-assessment.mjs"),
]:
    path.write_text(generator_source, encoding="utf-8")

# 3. Standalone reports use the same writer; it creates and validates parent components.
for path in [
    Path("codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs"),
    Path("claude/skills/information-accessibility-practice/scripts/render-audit-report.mjs"),
]:
    text = path.read_text(encoding="utf-8")
    old = '''  fs.mkdirSync(path.dirname(legacyOutput), { recursive: true });
  const output = writeNewText(legacyOutput, report);'''
    new = '''  const output = writeNewText(legacyOutput, report);'''
    if old not in text:
        raise SystemExit(f"standalone report mkdir anchor missing: {path}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")

# 4. Catalog candidates use the same safe writer without network-dependent tests.
catalog_path = Path("scripts/build-criteria-catalog.mjs")
text = catalog_path.read_text(encoding="utf-8")
import_anchor = '''import { fileURLToPath } from "node:url";'''
import_line = '''import { fileURLToPath } from "node:url";
import { writeNewText } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";'''
if import_anchor not in text:
    raise SystemExit("catalog import anchor missing")
text = text.replace(import_anchor, import_line, 1)
helper_anchor = '''async function refreshCatalog(root) {'''
helper = '''export function writeCatalogCandidate(output, catalog) {
  return writeNewText(path.resolve(output), `${JSON.stringify(catalog, null, 2)}\n`);
}

async function refreshCatalog(root) {'''
if helper_anchor not in text:
    raise SystemExit("catalog helper anchor missing")
text = text.replace(helper_anchor, helper, 1)
text = text.replace('''  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing output: ${output}`);\n\n''', '', 1)
old_write = '''  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(catalog, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return { status: "PASS", mode: "refresh", output, counts: { wcag: 55, jis: 38, japan_additional: 18 } };'''
new_write = '''  const writtenOutput = writeCatalogCandidate(output, catalog);
  return { status: "PASS", mode: "refresh", output: writtenOutput, counts: { wcag: 55, jis: 38, japan_additional: 18 } };'''
if old_write not in text:
    raise SystemExit("catalog write anchor missing")
catalog_path.write_text(text.replace(old_write, new_write, 1), encoding="utf-8")

# 5. The wrapper help exposes the explicit modes.
for path in [
    Path("codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs"),
    Path("claude/skills/information-accessibility-practice/scripts/accessibility-audit.mjs"),
]:
    text = path.read_text(encoding="utf-8")
    old = '''    summary: "Create a complete not-tested assessment for an active profile.",
    usage: "accessibility-audit assessment --profile <id> [assessment options]"'''
    new = '''    summary: "Create a validator-valid assessment record or an explicit placeholder template.",
    usage: "accessibility-audit assessment --profile <id> --target-name <name> --target-version <version> --target-ref <url|file> --evaluator <name> --evaluated-at <date> [--output <file>] | accessibility-audit assessment --template --profile <id> [--output <file>]"'''
    if old not in text:
        raise SystemExit(f"assessment help anchor missing: {path}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")

# 6. Make every README generator example executable, and document template mode and directory policy.
for filename, template_line, note in [
    (
        "README.md",
        'node .\\codex\\skills\\information-accessibility-practice\\scripts\\generate-assessment.mjs --template --profile web-modern --output .\\assessment.template.json',
        'プレースホルダーを含む編集用ひな形が必要な場合だけ `--template` を使います。template modeは `TEMPLATE_CREATED` を返し、検証済みassessmentとは扱いません。安全なwriterが不足する出力ディレクトリをcomponent単位で作成します。後続処理が失敗しても、競合時の誤削除を避けるため、この処理が作成した空ディレクトリは自動削除しません。'
    ),
    (
        "README.en.md",
        'node .\\codex\\skills\\information-accessibility-practice\\scripts\\generate-assessment.mjs --template --profile web-modern --output .\\assessment.template.json',
        'Use `--template` only when an editable placeholder template is required. Template mode returns `TEMPLATE_CREATED` and is not a validated assessment. The safe writer creates missing output directories one component at a time. Empty directories created before a later failure are retained to avoid unsafe cleanup during concurrent operations.'
    ),
]:
    path = Path(filename)
    lines = path.read_text(encoding="utf-8").splitlines()
    updated = []
    first_generator_index = None
    for line in lines:
        if "generate-assessment.mjs" in line and "--profile web-modern" in line and "--output" in line and "--target-name" not in line and "--template" not in line:
            line = line.replace(
                " --output ",
                ' --target-name "Example" --target-version "2026-08-22" --target-ref "https://example.com/" --evaluator "External reviewer" --evaluated-at "2026-08-22" --output '
            )
        if first_generator_index is None and "generate-assessment.mjs" in line:
            first_generator_index = len(updated)
        updated.append(line)
    if first_generator_index is None:
        raise SystemExit(f"README generator command missing: {filename}")
    if "--template --profile web-modern" not in "\n".join(updated):
        updated[first_generator_index:first_generator_index] = [note, "", "```powershell", template_line, "```", ""]
    path.write_text("\n".join(updated) + "\n", encoding="utf-8")
