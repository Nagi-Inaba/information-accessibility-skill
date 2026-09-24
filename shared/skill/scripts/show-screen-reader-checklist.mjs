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
const englishUsageBoundary = "Source or accessibility-tree inspection does not prove spoken output. Record the screen reader, browser, version, voice, and locale for runtime evidence; otherwise retain not_tested or cant_tell.";
const scopeNotes = {
  en: "Only bundled patterns and patterns in the selected extension are covered; other UI patterns require separate review.",
  ja: "対象は同梱パターンと指定した拡張パターンだけです。その他のUIパターンは別途確認してください。"
};

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/u, ""));
}

function loadRegistry(root, extensionPath) {
  const canonical = readJson(root, "references/screen-reader-ui-checks.json");
  const schema = readJson(root, "references/screen-reader-ui-checks.schema.json");
  const errors = validateScreenReaderRegistry(canonical, schema);
  if (errors.length) throw new Error(`Screen-reader checklist registry is invalid:\n${errors.join("\n")}`);
  if (!extensionPath) return { canonical, extension: [] };
  const extension = JSON.parse(fs.readFileSync(path.resolve(extensionPath), "utf8").replace(/^\uFEFF/u, ""));
  const extensionSchema = {
    type: "object",
    additionalProperties: false,
    required: ["schema_version", "patterns"],
    properties: {
      schema_version: { const: "1.0.0" },
      patterns: { type: "array", minItems: 1, items: { $ref: "#/$defs/pattern" } }
    },
    $defs: schema.$defs
  };
  const extensionErrors = validateJsonSchema(extension, extensionSchema);
  if (extensionErrors.length) throw new Error(`Invalid screen-reader extension:\n${extensionErrors.join("\n")}`);
  const combined = [...canonical.patterns, ...extension.patterns];
  const ids = combined.map((item) => item.id);
  const checkIds = combined.flatMap((item) => item.checks.map((check) => check.id));
  if (new Set(ids).size !== ids.length) throw new Error("Screen-reader extension has a duplicate pattern ID.");
  if (new Set(checkIds).size !== checkIds.length) throw new Error("Screen-reader extension has a duplicate check ID.");
  return { canonical, extension: extension.patterns };
}

export function buildScreenReaderChecklist(pattern = "all", root = skillRoot, locale = "en", extensionPath) {
  const selectedLocale = normalizeRuntimeLocale(locale, "en");
  const { canonical, extension } = loadRegistry(root, extensionPath);
  const registry = localizeScreenReaderRegistry(canonical, selectedLocale, root);
  const available = [...registry.patterns, ...extension];
  if (pattern !== "all" && !available.some((item) => item.id === pattern)) {
    throw new Error(`--pattern must be one of ${[...available.map((item) => item.id), "all"].join(", ")}`);
  }
  const selectedPatterns = pattern === "all" ? available : available.filter((item) => item.id === pattern);
  const labels = checklistLabels(selectedLocale);

  return {
    checklist_version: registry.schema_version,
    locale: selectedLocale,
    pattern,
    claim_effect: registry.claim_effect,
    invariant: registry.invariant,
    patterns: selectedPatterns,
    sources: [...new Set(selectedPatterns.flatMap((item) => item.source_urls))],
    scope_note: scopeNotes[selectedLocale],
    untranslated_extension_patterns: selectedLocale === "ja"
      ? selectedPatterns.filter((item) => extension.some((extra) => extra.id === item.id)).map((item) => item.id)
      : [],
    usage_boundary: selectedLocale === "en" ? englishUsageBoundary : labels.usageBoundary
  };
}

export function validateScreenReaderRegistry(registry, schema) {
  const errors = validateJsonSchema(registry, schema);
  if (errors.length) return errors;
  const actualIds = registry.patterns.map((item) => item.id);
  if (new Set(actualIds).size !== actualIds.length) errors.push("$.patterns contains duplicate pattern IDs");
  const checkIds = registry.patterns.flatMap((item) => item.checks.map((check) => check.id));
  if (new Set(checkIds).size !== checkIds.length) errors.push("$.patterns contains duplicate check IDs");
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
    "",
    result.scope_note,
    ""
  ];
  if (result.untranslated_extension_patterns.length) {
    lines.push(`Extension text is English: ${result.untranslated_extension_patterns.join(", ")}`, "");
  }
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
    if (arg === "--list-patterns") {
      if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
      seen.add(arg);
      options.listPatterns = true;
      continue;
    }
    if (!["--pattern", "--format", "--locale", "--extension"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
    seen.add(arg);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (arg === "--pattern") options.pattern = value;
    if (arg === "--format") options.format = value;
    if (arg === "--locale") options.locale = value;
    if (arg === "--extension") options.extension = value;
    index += 1;
  }
  options.locale = normalizeRuntimeLocale(options.locale, "en");
  if (!["json", "markdown"].includes(options.format)) throw new Error("--format must be json or markdown");
  if (options.listPatterns && seen.has("--pattern")) throw new Error("--list-patterns cannot be combined with --pattern");
  return options;
}

function usage(locale = "en") {
  return locale === "ja" ? [
    "使用方法:",
    "  node scripts/show-screen-reader-checklist.mjs [--list-patterns] [--pattern id|all] [--extension file.json] [--locale ja|en] [--format json|markdown]",
    "",
    "これは補助チェックリストです。適合性を判定せず、対象も変更しません。"
  ].join("\n") : [
    "Usage:",
    "  node scripts/show-screen-reader-checklist.mjs [--list-patterns] [--pattern id|all] [--extension file.json] [--locale ja|en] [--format json|markdown]",
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
  const result = buildScreenReaderChecklist(options.pattern, skillRoot, options.locale, options.extension);
  if (options.listPatterns) {
    const listing = {
      locale: result.locale,
      patterns: result.patterns.map(({ id, title, source_urls }) => ({ id, title, source_urls })),
      scope_note: result.scope_note,
      untranslated_extension_patterns: result.untranslated_extension_patterns
    };
    if (options.format === "markdown") process.stdout.write([
      options.locale === "ja" ? "# 利用可能なパターン" : "# Available patterns",
      "",
      ...listing.patterns.map((item) => `- ${item.id}: ${item.title}`),
      "",
      listing.scope_note,
      ""
    ].join("\n"));
    else process.stdout.write(`${JSON.stringify(listing, null, 2)}\n`);
    return 0;
  }
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
