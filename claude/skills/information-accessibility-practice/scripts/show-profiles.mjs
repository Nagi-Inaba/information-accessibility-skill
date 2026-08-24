#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertValidStandardsRegistry } from "./lib/profile-registry.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptRoot);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
}

function parseArgs(argv) {
  const options = { format: "text" };
  if (argv[0] !== "list") throw new Error("profiles requires the `list` subcommand.");
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== "--format") throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing value for --format");
    if (options.format !== "text") throw new Error("Duplicate argument: --format");
    options.format = value;
    index += 1;
  }
  if (!["text", "json", "markdown"].includes(options.format)) {
    throw new Error("--format must be text, json, or markdown");
  }
  return options;
}

export function buildProfilesIndex(root = skillRoot) {
  const registry = assertValidStandardsRegistry(readJson(path.join(root, "references/standards-registry.json")));
  const profiles = registry.profiles
    .filter((profile) => profile.assessment_configuration?.active === true)
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
    profiles
  };
}

function renderText(index) {
  return [
    `Active profiles (${index.profiles.length})`,
    ...index.profiles.flatMap((profile) => [
      "",
      `${profile.id} — ${profile.display_name}`,
      `  Requirements: ${profile.requirement_count}`,
      `  Claim ceiling: ${profile.claim_ceiling}`,
      `  Target: ${profile.target_scope}`,
      `  Groups: ${profile.groups.map((group) => `${group.id} (${group.requirement_count})`).join(", ")}`,
      `  Sources: ${profile.source_urls.join(", ") || "none"}`
    ])
  ].join("\n");
}

function renderMarkdown(index) {
  return [
    "# Active accessibility profiles",
    "",
    `Registry version: \`${index.registry_version}\`  `,
    `Verified: ${index.verified_at}`,
    "",
    "| Profile | Requirements | Groups | Claim ceiling | Target scope |",
    "| --- | ---: | --- | --- | --- |",
    ...index.profiles.map((profile) => `| \`${profile.id}\` | ${profile.requirement_count} | ${profile.groups.map((group) => `${group.label}: ${group.requirement_count}`).join("; ")} | \`${profile.claim_ceiling}\` | ${profile.target_scope} |`),
    "",
    ...index.profiles.flatMap((profile) => [
      `## ${profile.id}`,
      "",
      ...profile.source_urls.map((url) => `- ${url}`),
      ""
    ])
  ].join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const index = buildProfilesIndex();
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
