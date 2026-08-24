#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertValidStandardsRegistry } from "./lib/profile-registry.mjs";
import {
  localizedProfile,
  normalizeRuntimeLocale,
  runtimeLocaleFromEnvironment,
  validateRuntimeLocaleCatalog
} from "./lib/runtime-locale.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptRoot);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
}

function parseArgs(argv) {
  const options = { format: "text", locale: runtimeLocaleFromEnvironment("en") };
  if (argv[0] !== "list") throw new Error("profiles requires the `list` subcommand.");
  const seen = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!["--format", "--locale"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
    seen.add(arg);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (arg === "--format") options.format = value;
    if (arg === "--locale") options.locale = value;
    index += 1;
  }
  if (!["text", "json", "markdown"].includes(options.format)) {
    throw new Error("--format must be text, json, or markdown");
  }
  options.locale = normalizeRuntimeLocale(options.locale, "en");
  return options;
}

export function buildProfilesIndex(root = skillRoot, locale = "en") {
  const selectedLocale = normalizeRuntimeLocale(locale, "en");
  const registry = assertValidStandardsRegistry(readJson(path.join(root, "references/standards-registry.json")));
  const checklist = readJson(path.join(root, "references/screen-reader-ui-checks.json"));
  const localeValidation = validateRuntimeLocaleCatalog({ registry, checklist, root });
  if (!localeValidation.valid) {
    throw new Error(`Runtime locale catalog is invalid:\n- ${localeValidation.errors.join("\n- ")}`);
  }
  const profiles = registry.profiles
    .filter((profile) => profile.assessment_configuration?.active === true)
    .map((profile) => localizedProfile(profile, selectedLocale))
    .map((profile) => ({
      id: profile.id,
      display_name: profile.display_name,
      target_scope: profile.target_scope,
      active: true,
      implementation_status: profile.implementation_status,
      registry_version: registry.schema_version,
      requirement_count: profile.requirement_ids.length,
      groups: profile.assessment_configuration.groups.map((group) => ({
        id: group.id,
        label: group.label,
        requirement_count: profile.requirement_ids.filter((id) => group.requirement_id_prefixes.some((prefix) => id.startsWith(prefix))).length
      })),
      requires_web_interaction_evidence: profile.assessment_configuration.requires_web_interaction_evidence,
      formal_conformance_target: profile.formal_conformance_target,
      claim_ceiling: profile.claim_rules.claim_ceiling,
      source_urls: [...new Set((profile.standards ?? []).map((standard) => standard.primary_url).filter(Boolean))]
    }))
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
  return {
    schema_version: "1.0.0",
    registry_version: registry.schema_version,
    verified_at: registry.last_verified_at,
    locale: selectedLocale,
    profiles
  };
}

function labels(locale) {
  return locale === "ja" ? {
    title: "利用可能なアクセシビリティプロファイル",
    active: "利用可能なプロファイル",
    requirements: "条項数",
    claimCeiling: "主張上限",
    target: "対象範囲",
    groups: "区分",
    sources: "一次資料",
    registryVersion: "レジストリ版",
    verified: "確認日",
    profile: "プロファイル",
    none: "なし"
  } : {
    title: "Active accessibility profiles",
    active: "Active profiles",
    requirements: "Requirements",
    claimCeiling: "Claim ceiling",
    target: "Target scope",
    groups: "Groups",
    sources: "Sources",
    registryVersion: "Registry version",
    verified: "Verified",
    profile: "Profile",
    none: "none"
  };
}

function renderText(index) {
  const text = labels(index.locale);
  return [
    `${text.active} (${index.profiles.length})`,
    ...index.profiles.flatMap((profile) => [
      "",
      `${profile.id} — ${profile.display_name}`,
      `  ${text.requirements}: ${profile.requirement_count}`,
      `  ${text.claimCeiling}: ${profile.claim_ceiling}`,
      `  ${text.target}: ${profile.target_scope}`,
      `  ${text.groups}: ${profile.groups.map((group) => `${group.label} (${group.requirement_count})`).join(", ")}`,
      `  ${text.sources}: ${profile.source_urls.join(", ") || text.none}`
    ])
  ].join("\n");
}

function renderMarkdown(index) {
  const text = labels(index.locale);
  return [
    `# ${text.title}`,
    "",
    `${text.registryVersion}: \`${index.registry_version}\`  `,
    `${text.verified}: ${index.verified_at}`,
    "",
    `| ${text.profile} | ${text.requirements} | ${text.groups} | ${text.claimCeiling} | ${text.target} |`,
    "| --- | ---: | --- | --- | --- |",
    ...index.profiles.map((profile) => `| \`${profile.id}\` | ${profile.requirement_count} | ${profile.groups.map((group) => `${group.label}: ${group.requirement_count}`).join("; ")} | \`${profile.claim_ceiling}\` | ${profile.target_scope} |`),
    "",
    ...index.profiles.flatMap((profile) => [
      `## ${profile.id} — ${profile.display_name}`,
      "",
      ...profile.source_urls.map((url) => `- ${url}`),
      ""
    ])
  ].join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const index = buildProfilesIndex(skillRoot, options.locale);
  if (options.format === "json") process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
  else if (options.format === "markdown") process.stdout.write(`${renderMarkdown(index)}\n`);
  else process.stdout.write(`${renderText(index)}\n`);
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
