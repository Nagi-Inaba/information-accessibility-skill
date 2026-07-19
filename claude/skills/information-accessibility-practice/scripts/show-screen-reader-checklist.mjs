import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateJsonSchema } from "./lib/json-schema.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptDir);
const patternIds = ["modal-dialog", "disclosure", "menu-button", "fragmented-text"];

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/u, ""));
}

export function buildScreenReaderChecklist(pattern = "all", root = skillRoot) {
  if (![...patternIds, "all"].includes(pattern)) {
    throw new Error(`--pattern must be one of ${[...patternIds, "all"].join(", ")}`);
  }
  const registry = readJson(root, "references/screen-reader-ui-checks.json");
  const schema = readJson(root, "references/screen-reader-ui-checks.schema.json");
  const errors = validateScreenReaderRegistry(registry, schema);
  if (errors.length) throw new Error(`Screen-reader checklist registry is invalid:\n${errors.join("\n")}`);
  const selectedPatterns = pattern === "all" ? registry.patterns : registry.patterns.filter((item) => item.id === pattern);

  return {
    checklist_version: registry.schema_version,
    pattern,
    claim_effect: registry.claim_effect,
    invariant: registry.invariant,
    patterns: selectedPatterns,
    sources: [...new Set(selectedPatterns.flatMap((item) => item.source_urls))],
    usage_boundary: "Source or accessibility-tree inspection does not prove spoken output. Record the screen reader, browser, version, voice, and locale for runtime evidence; otherwise retain not_tested or cant_tell."
  };
}

export function validateScreenReaderRegistry(registry, schema) {
  const errors = validateJsonSchema(registry, schema);
  if (errors.length) return errors;
  const actualIds = registry.patterns.map((item) => item.id);
  if (actualIds.length !== patternIds.length || actualIds.some((id, index) => id !== patternIds[index])) {
    errors.push(`$.patterns must contain exactly these IDs in order: ${patternIds.join(", ")}`);
  }
  const patternSources = [...new Set(registry.patterns.flatMap((item) => item.source_urls))];
  if (registry.sources.length !== patternSources.length || registry.sources.some((source, index) => source !== patternSources[index])) {
    errors.push("$.sources must equal the ordered unique union of pattern source_urls");
  }
  return errors;
}

function toMarkdown(result) {
  const lines = [
    "# Screen-reader UI checklist",
    "",
    `- Pattern: ${result.pattern}`,
    `- Claim effect: ${result.claim_effect}`,
    "",
    "## State invariant",
    "",
    result.invariant,
    ""
  ];
  for (const pattern of result.patterns) {
    lines.push(`## ${pattern.id}: ${pattern.title}`, "", pattern.applicability, "");
    for (const check of pattern.checks) {
      lines.push(
        `### ${check.id}: ${check.title}`,
        "",
        check.expectation,
        "",
        "Code or structure inspection:",
        ...check.code_inspection.map((item, index) => `${index + 1}. ${item}`),
        "",
        "Runtime verification:",
        ...check.runtime_verification.map((item, index) => `${index + 1}. ${item}`),
        "",
        `Evidence: ${check.evidence_types.join(", ")}`,
        "",
        "Cannot tell when:",
        ...check.cant_tell_when.map((item) => `- ${item}`),
        ""
      );
    }
  }
  lines.push("## Evidence boundary", "", `> ${result.usage_boundary}`, "", "## Public sources for the selected pattern", "", ...result.sources.map((source) => `- ${source}`), "");
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = { pattern: "all", format: "json" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (!["--pattern", "--format"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (arg === "--pattern") options.pattern = value;
    if (arg === "--format") options.format = value;
    index += 1;
  }
  if (!["json", "markdown"].includes(options.format)) throw new Error("--format must be json or markdown");
  return options;
}

function usage() {
  return [
    "Usage: node scripts/show-screen-reader-checklist.mjs [--pattern modal-dialog|disclosure|menu-button|fragmented-text|all] [--format json|markdown]",
    "",
    "This is a supporting checklist. It does not evaluate conformance or modify the target."
  ].join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = buildScreenReaderChecklist(options.pattern);
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
