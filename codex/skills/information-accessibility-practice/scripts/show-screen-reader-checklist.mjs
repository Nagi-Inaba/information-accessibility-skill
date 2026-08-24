import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateJsonSchema } from "./lib/json-schema.mjs";
import {
  checklistLabels,
  localizeScreenReaderRegistry,
  normalizeRuntimeLocale,
  runtimeLocaleFromEnvironment
} from "./lib/runtime-locale.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptDir);
const patternIds = ["modal-dialog", "disclosure", "menu-button", "fragmented-text"];

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/u, ""));
}

export function buildScreenReaderChecklist(pattern = "all", root = skillRoot, locale = "en") {
  if (![...patternIds, "all"].includes(pattern)) {
    throw new Error(`--pattern must be one of ${[...patternIds, "all"].join(", ")}`);
  }
  const selectedLocale = normalizeRuntimeLocale(locale, "en");
  const canonicalRegistry = readJson(root, "references/screen-reader-ui-checks.json");
  const schema = readJson(root, "references/screen-reader-ui-checks.schema.json");
  const errors = validateScreenReaderRegistry(canonicalRegistry, schema);
  if (errors.length) throw new Error(`Screen-reader checklist registry is invalid:\n${errors.join("\n")}`);
  const registry = localizeScreenReaderRegistry(canonicalRegistry, selectedLocale, root);
  const selectedPatterns = pattern === "all" ? registry.patterns : registry.patterns.filter((item) => item.id === pattern);
  const labels = checklistLabels(selectedLocale);

  return {
    checklist_version: registry.schema_version,
    locale: selectedLocale,
    pattern,
    claim_effect: registry.claim_effect,
    invariant: registry.invariant,
    patterns: selectedPatterns,
    sources: [...new Set(selectedPatterns.flatMap((item) => item.source_urls))],
    usage_boundary: labels.usageBoundary
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
  const text = checklistLabels(result.locale);
  const lines = [
    `# ${text.title}`,
    "",
    `- Pattern: ${result.pattern}`,
    `- ${text.claimEffect}: ${result.claim_effect}`,
    "",
    `## ${text.invariant}`,
    "",
    result.invariant,
    ""
  ];
  for (const pattern of result.patterns) {
    lines.push(`## ${pattern.id}: ${pattern.title}`, "", `${text.applicability}: ${pattern.applicability}`, "");
    for (const check of pattern.checks) {
      lines.push(
        `### ${check.id}: ${check.title}`,
        "",
        check.expectation,
        "",
        `${text.codeInspection}:`,
        ...check.code_inspection.map((item, index) => `${index + 1}. ${item}`),
        "",
        `${text.runtimeVerification}:`,
        ...check.runtime_verification.map((item, index) => `${index + 1}. ${item}`),
        "",
        `${text.evidenceTypes}: ${check.evidence_types.join(", ")}`,
        "",
        `${text.cantTell}:`,
        ...check.cant_tell_when.map((item) => `- ${item}`),
        "",
        `${text.humanRequired}: ${check.human_review_required ? text.yes : text.no}`,
        ""
      );
    }
  }
  lines.push(
    `## ${text.evidenceBoundary}`,
    "",
    `> ${result.usage_boundary}`,
    "",
    result.locale === "ja" ? "## 選択したパターンの公開資料" : "## Public sources for the selected pattern",
    "",
    ...result.sources.map((source) => `- ${source}`),
    ""
  );
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = {
    pattern: "all",
    format: "json",
    locale: runtimeLocaleFromEnvironment("en")
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (!["--pattern", "--format", "--locale"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
    seen.add(arg);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (arg === "--pattern") options.pattern = value;
    if (arg === "--format") options.format = value;
    if (arg === "--locale") options.locale = value;
    index += 1;
  }
  options.locale = normalizeRuntimeLocale(options.locale, "en");
  if (!["json", "markdown"].includes(options.format)) throw new Error("--format must be json or markdown");
  return options;
}

function usage(locale = "en") {
  return locale === "ja" ? [
    "使用方法:",
    "  node scripts/show-screen-reader-checklist.mjs [--pattern modal-dialog|disclosure|menu-button|fragmented-text|all] [--locale ja|en] [--format json|markdown]",
    "",
    "これは補助チェックリストです。適合性を判定せず、対象も変更しません。"
  ].join("\n") : [
    "Usage:",
    "  node scripts/show-screen-reader-checklist.mjs [--pattern modal-dialog|disclosure|menu-button|fragmented-text|all] [--locale ja|en] [--format json|markdown]",
    "",
    "This is a supporting checklist. It does not evaluate conformance or modify the target."
  ].join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage(options.locale)}\n`);
    return 0;
  }
  const result = buildScreenReaderChecklist(options.pattern, skillRoot, options.locale);
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
