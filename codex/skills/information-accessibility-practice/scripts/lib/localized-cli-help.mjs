import { commandDefinitions, versionText } from "./cli-command-registry.mjs";
import {
  localizedCommandDefinition,
  normalizeRuntimeLocale,
  runtimeCliMessages
} from "./runtime-locale.mjs";

const localeAwareCommands = new Set([
  "profiles",
  "requirements",
  "requirement",
  "doctor",
  "screen-reader-checklist",
  "report"
]);

const reportOptions = [
  { flag: "--format", value: "<markdown|html>", description: "Output format. Default: markdown." },
  { flag: "--detail", value: "<summary|full>", description: "Summary or complete 55/56-row report. Default: full." },
  { flag: "--appendix", value: "<file>", description: "With summary, write the complete report in the selected format." },
  { flag: "--visibility", value: "<internal|public>", description: "Publication boundary. Default: internal." },
  { flag: "--reviewer-disclosure", value: "<include|redact>", description: "Required for public output." },
  { flag: "--redaction-manifest", value: "<manifest.json>", description: "Required internal record for public output." }
];

function withLocaleOption(definition) {
  const localized = structuredClone(definition);
  if (localeAwareCommands.has(localized.name) && !(localized.options ?? []).some((item) => item.flag === "--locale")) {
    localized.options ??= [];
    localized.options.push({ flag: "--locale", value: "<ja|en>", description: "Human-readable locale." });
  }
  if (localized.name === "report") {
    const existing = new Set((localized.options ?? []).map((item) => item.flag));
    for (const option of reportOptions) if (!existing.has(option.flag)) localized.options.push(option);
    localized.usage = [
      "accessibility-audit report --input <assessment.json> [report options]",
      "accessibility-audit report --run <audit-run.json> --assessment <assessment.json> --output <new-report.md|html> [report options]"
    ];
  } else if (localized.name === "profiles") {
    localized.usage = ["accessibility-audit profiles list [--locale ja|en] [--format text|json|markdown]"];
  } else if (localized.name === "requirement") {
    localized.usage = ["accessibility-audit requirement --profile <id> --id <requirement-id> [--locale ja|en] [--format json|markdown]"];
  } else if (localized.name === "doctor") {
    localized.usage = ["accessibility-audit doctor [--locale ja|en] [--format text|json]"];
  } else if (localized.name === "screen-reader-checklist") {
    localized.usage = ["accessibility-audit screen-reader-checklist [--pattern modal-dialog|disclosure|menu-button|fragmented-text|all] [--locale ja|en] [--format json|markdown]"];
  }
  return localized;
}

function renderOption(item) {
  const left = `${item.flag}${item.value ? ` ${item.value}` : ""}`;
  return `  ${left.padEnd(40)} ${item.description}`;
}

export function localizedRootHelpText(locale = "en") {
  const normalized = normalizeRuntimeLocale(locale, "en");
  const messages = runtimeCliMessages(normalized);
  const commandLines = [...commandDefinitions].map(([name, definition]) => {
    const localized = localizedCommandDefinition(definition, normalized);
    return `  ${name.padEnd(24)} ${localized.summary}`;
  });
  return [
    messages.root_title,
    "",
    messages.usage_heading,
    "  accessibility-audit <command> [options]",
    "  accessibility-audit --version",
    "",
    messages.global_options_heading,
    `  ${"--help, -h".padEnd(28)} ${messages.help_description}`,
    `  ${"--version, -V".padEnd(28)} ${messages.version_description}`,
    `  ${"--locale <ja|en>".padEnd(28)} ${messages.locale_description}`,
    "",
    messages.commands_heading,
    ...commandLines,
    "",
    ...messages.root_notes
  ].join("\n");
}

export function localizedCommandHelpText(name, locale = "en") {
  const normalized = normalizeRuntimeLocale(locale, "en");
  const messages = runtimeCliMessages(normalized);
  const canonical = commandDefinitions.get(name);
  if (!canonical) throw new Error(normalized === "ja" ? `不明なコマンド: ${name}` : `Unknown command: ${name}`);
  let definition = withLocaleOption(canonical);
  definition = localizedCommandDefinition(definition, normalized);
  if (normalized === "ja" && definition.name === "report") {
    const overrides = runtimeCliMessages("ja").commands.report.options;
    definition.options = definition.options.map((item) => ({
      ...item,
      description: overrides[item.flag] ?? item.description
    }));
  }
  const lines = [definition.summary, "", messages.usage_heading, ...definition.usage.map((usage) => `  ${usage}`)];
  if (definition.options?.length) lines.push("", messages.options_heading, ...definition.options.map(renderOption));
  if (definition.defaults?.length) lines.push("", messages.defaults_heading, ...definition.defaults.map((value) => `  ${value}`));
  if (definition.notes?.length) lines.push("", messages.notes_heading, ...definition.notes.map((value) => `  - ${value}`));
  return lines.join("\n");
}

export { localeAwareCommands, versionText };
