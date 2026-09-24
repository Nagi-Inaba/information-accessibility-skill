#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertValidStandardsRegistry, groupForRequirement, recordsForProfile } from "./lib/profile-registry.mjs";
import {
  normalizeRuntimeLocale,
  requirementsUi,
  runtimeLocaleFromEnvironment
} from "./lib/runtime-locale.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptRoot);

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8").replace(/^\uFEFF/u, ""));
}

function normalizeSearch(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("en").replace(/[\s_-]+/gu, " ").trim();
}

function criterionParts(value) {
  return String(value).split(".").map((part) => Number.parseInt(part, 10));
}

function compareCriterion(left, right) {
  const a = criterionParts(left.success_criterion);
  const b = criterionParts(right.success_criterion);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return left.id.localeCompare(right.id, "en");
}

function urlsFrom(value, output = new Set()) {
  if (typeof value === "string" && /^https?:\/\//iu.test(value)) output.add(value);
  else if (Array.isArray(value)) value.forEach((item) => urlsFrom(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => urlsFrom(item, output));
  return output;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || !["list", "search", "show"].includes(command)) {
    throw new Error("requirements requires list, search, or show.");
  }
  const options = {
    command,
    format: "text",
    locale: runtimeLocaleFromEnvironment("en")
  };
  let index = 0;
  if (["search", "show"].includes(command)) {
    const value = rest[0];
    if (!value || value.startsWith("--")) throw new Error(`${command} requires a query or requirement identifier.`);
    if (command === "search") options.query = value;
    else options.identifier = value;
    index = 1;
  }
  const supported = new Map([
    ["--profile", "profile"],
    ["--level", "level"],
    ["--procedure", "procedure"],
    ["--locale", "locale"],
    ["--format", "format"]
  ]);
  const seen = new Set();
  for (; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!supported.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    if (seen.has(arg)) throw new Error(`Duplicate argument: ${arg}`);
    seen.add(arg);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    options[supported.get(arg)] = value;
    index += 1;
  }
  if (options.level && !["A", "AA"].includes(options.level)) throw new Error("--level must be A or AA");
  if (options.procedure && !["available", "unavailable"].includes(options.procedure)) {
    throw new Error("--procedure must be available or unavailable");
  }
  options.locale = normalizeRuntimeLocale(options.locale, "en");
  if (!["text", "json", "markdown"].includes(options.format)) throw new Error("--format must be text, json, or markdown");
  return options;
}

function directOrEquivalentProcedure(record, procedures) {
  const direct = procedures.procedures.find((item) => item.requirement_id === record.id);
  if (direct) return { status: "available", ref: `criterion-procedures:${procedures.schema_version}#${direct.id}` };
  if (record.web_modern_record_id) {
    const equivalent = procedures.procedures.find((item) => item.requirement_id === record.web_modern_record_id);
    if (equivalent) return { status: "available", ref: `criterion-procedures:${procedures.schema_version}#${equivalent.id}` };
  }
  return { status: "unavailable", ref: null };
}

function titleMetadata(record, recordsById, recordsByCriterion) {
  const relatedRecords = recordsByCriterion.get(record.success_criterion) ?? [];
  const webRecord = record.web_modern_record_id
    ? recordsById.get(record.web_modern_record_id)
    : relatedRecords.find((item) => item.id.startsWith("WCAG-2.2-SC-"));
  const japaneseRecord = relatedRecords.find((item) => item.id !== record.id && typeof item.title_ja === "string" && item.title_ja.length > 0);
  const englishPeer = relatedRecords.find((item) => item.id !== record.id && typeof item.title_en === "string" && item.title_en.length > 0);

  let titleEn;
  let enStatus;
  if (typeof record.title_en === "string" && record.title_en.length > 0) {
    titleEn = record.title_en;
    enStatus = "direct";
  } else if (webRecord?.title_en) {
    titleEn = webRecord.title_en;
    enStatus = "equivalent_wcag";
  } else if (record.id.startsWith("JIS-X-8341-3-2016-SC-") && record.success_criterion === "4.1.1") {
    titleEn = "Parsing";
    enStatus = "maintained_fallback";
  } else if (englishPeer?.title_en) {
    titleEn = englishPeer.title_en;
    enStatus = "equivalent_profile";
  } else {
    titleEn = record.title_ja ?? record.success_criterion;
    enStatus = "fallback";
  }

  let titleJa;
  let jaStatus;
  if (typeof record.title_ja === "string" && record.title_ja.length > 0) {
    titleJa = record.title_ja;
    jaStatus = "direct";
  } else if (japaneseRecord?.title_ja) {
    titleJa = japaneseRecord.title_ja;
    jaStatus = japaneseRecord.id.startsWith("JIS-") ? "equivalent_jis" : "equivalent_japanese_profile";
  } else {
    titleJa = titleEn;
    jaStatus = "fallback_en";
  }

  return {
    title_en: titleEn,
    title_ja: titleJa,
    title_locale_status: { en: enStatus, ja: jaStatus },
    web_record: webRecord
  };
}

export function buildRequirementsIndex(root = skillRoot) {
  const registry = assertValidStandardsRegistry(readJson(root, "references/standards-registry.json"));
  const catalog = readJson(root, "references/criteria-catalog.json");
  const procedures = readJson(root, "references/criterion-procedures.json");
  const activeProfiles = registry.profiles.filter((profile) => profile.assessment_configuration?.active === true);
  const allCatalogRecords = Object.values(catalog.catalogs).flat();
  const recordsById = new Map(allCatalogRecords.map((record) => [record.id, record]));
  const recordsByCriterion = new Map();
  for (const record of allCatalogRecords) {
    const bucket = recordsByCriterion.get(record.success_criterion) ?? [];
    bucket.push(record);
    recordsByCriterion.set(record.success_criterion, bucket);
  }

  const requirements = activeProfiles.flatMap((profile) => recordsForProfile({ profile, catalog }).map((record) => {
    const title = titleMetadata(record, recordsById, recordsByCriterion);
    const procedure = directOrEquivalentProcedure(record, procedures);
    const sourceUrls = urlsFrom(record);
    for (const standard of profile.standards ?? []) if (standard.primary_url) sourceUrls.add(standard.primary_url);
    if (title.web_record) urlsFrom(title.web_record, sourceUrls);
    const relatedRecords = recordsByCriterion.get(record.success_criterion) ?? [];
    const relatedRequirementIds = [...new Set([
      ...relatedRecords.map((item) => item.id),
      record.web_modern_record_id
    ].filter((id) => id && id !== record.id))].sort((left, right) => left.localeCompare(right, "en"));
    return {
      id: record.id,
      success_criterion: record.success_criterion,
      title_en: title.title_en,
      title_ja: title.title_ja,
      title_locale_status: title.title_locale_status,
      level: record.level,
      introduced_in: record.introduced_in ?? title.web_record?.introduced_in ?? null,
      profile_ids: [profile.id],
      profile_group: groupForRequirement(profile, record.id),
      method_key: record.method_key,
      procedure_status: procedure.status,
      procedure_ref: procedure.ref,
      normative_url: record.normative_url ?? title.web_record?.normative_url ?? null,
      understanding_url: record.understanding_url ?? title.web_record?.understanding_url ?? null,
      source_urls: [...sourceUrls].sort((left, right) => left.localeCompare(right, "en")),
      related_requirement_ids: relatedRequirementIds,
      automation_role: record.automation_role,
      method_requirement: record.method_requirement
    };
  }));

  requirements.sort((left, right) => left.profile_ids[0].localeCompare(right.profile_ids[0], "en") || compareCriterion(left, right));
  return {
    schema_version: "1.0.0",
    registry_version: registry.schema_version,
    catalog_version: catalog.schema_version,
    procedure_catalog_version: procedures.schema_version,
    profiles: activeProfiles.map((profile) => profile.id).sort((left, right) => left.localeCompare(right, "en")),
    requirements
  };
}

function filterRequirements(index, options) {
  let results = index.requirements;
  if (options.profile) {
    if (!index.profiles.includes(options.profile)) throw new Error(`Unknown or inactive profile: ${options.profile}`);
    results = results.filter((item) => item.profile_ids.includes(options.profile));
  }
  if (options.level) results = results.filter((item) => item.level === options.level);
  if (options.procedure) results = results.filter((item) => item.procedure_status === options.procedure);
  if (options.command === "search") {
    const query = normalizeSearch(options.query);
    results = results.filter((item) => normalizeSearch([
      item.id,
      item.success_criterion,
      item.title_en,
      item.title_ja,
      item.level,
      item.method_key,
      ...item.profile_ids,
      ...item.related_requirement_ids
    ].join(" ")).includes(query));
  }
  return [...results].sort(compareCriterion);
}

function selectedTitle(item, locale) {
  return locale === "ja" ? item.title_ja : item.title_en;
}

function responseFor(index, options) {
  const results = filterRequirements(index, options);
  if (options.command === "show") {
    const normalizedIdentifier = normalizeSearch(options.identifier);
    const matches = results.filter((item) => normalizeSearch(item.id) === normalizedIdentifier
      || normalizeSearch(item.success_criterion) === normalizedIdentifier);
    if (matches.length === 0) throw new Error(`No registered requirement matched: ${options.identifier}`);
    if (matches.length > 1) {
      throw new Error(`Requirement identifier is ambiguous; add --profile. Matches: ${matches.map((item) => `${item.profile_ids[0]}:${item.id}`).join(", ")}`);
    }
    return {
      schema_version: index.schema_version,
      registry_version: index.registry_version,
      catalog_version: index.catalog_version,
      command: "show",
      locale: options.locale,
      requirement: { ...matches[0], title: selectedTitle(matches[0], options.locale) }
    };
  }
  return {
    schema_version: index.schema_version,
    registry_version: index.registry_version,
    catalog_version: index.catalog_version,
    command: options.command,
    locale: options.locale,
    query: options.query ?? null,
    filters: {
      profile: options.profile ?? null,
      level: options.level ?? null,
      procedure: options.procedure ?? null
    },
    count: results.length,
    requirements: results.map((item) => ({ ...item, title: selectedTitle(item, options.locale) }))
  };
}

function formatTemplate(value, replacements = {}) {
  return String(value).replace(/\{([a-z_]+)\}/gu, (_match, key) => String(replacements[key] ?? `{${key}}`));
}

function renderRequirement(item, locale) {
  const ui = requirementsUi(locale);
  const h = ui.headings;
  return [
    `${item.success_criterion} ${item.title}`,
    `  ${h.id}: ${item.id}`,
    `  ${h.profile}: ${item.profile_ids.join(", ")}`,
    `  ${h.level}: ${item.level}`,
    `  ${h.procedure}: ${ui.procedure_status[item.procedure_status]}`,
    `  ${h.source_list}: ${item.source_urls.join(", ")}`,
    `  ${h.related}: ${item.related_requirement_ids.join(", ") || h.none}`
  ].join("\n");
}

function renderText(response) {
  const ui = requirementsUi(response.locale);
  const heading = response.command === "search"
    ? formatTemplate(ui.headings.search, { query: response.query })
    : ui.headings.requirements;
  if (response.command === "show") return renderRequirement(response.requirement, response.locale);
  return [
    `${heading} (${response.count})`,
    "",
    ...response.requirements.flatMap((item) => [renderRequirement(item, response.locale), ""])
  ].join("\n").trimEnd();
}

function renderMarkdown(response) {
  const ui = requirementsUi(response.locale);
  const h = ui.headings;
  if (response.command === "show") {
    const item = response.requirement;
    return [
      `# ${item.success_criterion} ${item.title}`,
      "",
      `- ${h.internal_id}: \`${item.id}\``,
      `- ${h.profile}: ${item.profile_ids.map((id) => `\`${id}\``).join(", ")}`,
      `- ${h.level}: ${item.level}`,
      `- ${h.procedure}: ${ui.procedure_status[item.procedure_status]}`,
      `- ${h.related}: ${item.related_requirement_ids.map((id) => `\`${id}\``).join(", ") || h.none}`,
      "",
      `## ${h.sources}`,
      "",
      ...item.source_urls.map((url) => `- ${url}`),
      "",
      `> ${h.boundary}`
    ].join("\n");
  }
  const title = response.command === "search"
    ? formatTemplate(h.search, { query: response.query })
    : h.requirements;
  return [
    `# ${title}`,
    "",
    `${h.results}: ${response.count}`,
    "",
    `| SC | ${h.title} | ${h.level} | ${h.profile} | ${h.procedure} | ${h.internal_id} |`,
    "| --- | --- | --- | --- | --- | --- |",
    ...response.requirements.map((item) => `| ${item.success_criterion} | ${item.title} | ${item.level} | ${item.profile_ids.join(", ")} | ${ui.procedure_status[item.procedure_status]} | \`${item.id}\` |`)
  ].join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const response = responseFor(buildRequirementsIndex(), options);
  if (options.format === "json") process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  else if (options.format === "markdown") process.stdout.write(`${renderMarkdown(response)}\n`);
  else process.stdout.write(`${renderText(response)}\n`);
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
