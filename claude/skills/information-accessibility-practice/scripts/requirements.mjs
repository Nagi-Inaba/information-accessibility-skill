import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { profileConfiguration, recordsForProfile } from "./lib/profile-registry.mjs";
import { lookupRequirement } from "./show-requirement.mjs";

const skillRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (name) => JSON.parse(fs.readFileSync(path.join(skillRoot, "references", name), "utf8").replace(/^\uFEFF/u, ""));
const methodSearchTerms = {
  "non-text-content": ["代替テキスト", "画像", "非テキスト"],
  "time-based-media": ["字幕", "音声解説", "メディア"],
  "adaptable-structure": ["見出し", "構造", "読み上げ順"],
  "distinguishable-presentation": ["コントラスト", "リフロー", "拡大", "色"],
  "keyboard-operation": ["キーボード", "操作"],
  "timing-and-motion": ["時間制限", "動き"],
  "seizure-and-physical-reaction": ["点滅", "発作"],
  "navigation-and-focus": ["フォーカス", "ナビゲーション", "ページタイトル"],
  "input-modalities": ["タッチ", "ポインター", "ドラッグ"],
  "readable-language": ["言語", "読みやすさ"],
  "predictable-behavior": ["予測可能", "一貫性"],
  "input-assistance": ["エラー", "ラベル", "入力支援"],
  "compatible-semantics": ["ARIA", "名前", "役割", "状態"],
  "parsing-legacy": ["構文解析", "重複ID"]
};

function activeProfiles(registry) {
  return registry.profiles.filter((profile) => profileConfiguration(registry, profile.id).active && profile.requirement_ids?.length);
}

export function requirementIndex() {
  const registry = read("standards-registry.json");
  const catalog = read("criteria-catalog.json");
  const procedures = read("criterion-procedures.json");
  const procedureIds = new Set(procedures.procedures.map((item) => item.requirement_id));
  const rows = [];
  for (const profile of activeProfiles(registry)) {
    for (const record of recordsForProfile({ profile, catalog })) {
      rows.push({
        profile_id: profile.id,
        profile_name: profile.display_name,
        requirement_id: record.id,
        success_criterion: record.success_criterion,
        title_ja: record.title_ja ?? null,
        title_en: record.title_en ?? null,
        level: record.level,
        method_key: record.method_key,
        procedure_available: procedureIds.has(record.id),
        normative_url: record.normative_url ?? null,
        understanding_url: record.understanding_url ?? null,
        checklist_source_url: record.checklist_source_url ?? null,
        profile_source_url: record.profile_source_url ?? null
      });
    }
  }
  const byCriterion = new Map();
  for (const row of rows) {
    if (!byCriterion.has(row.success_criterion)) byCriterion.set(row.success_criterion, []);
    byCriterion.get(row.success_criterion).push(row.requirement_id);
  }
  return rows.map((row) => ({
    ...row,
    related_requirement_ids: [...new Set(byCriterion.get(row.success_criterion))].filter((id) => id !== row.requirement_id).sort()
  }));
}

function searchableText(row) {
  return [
    row.profile_id,
    row.requirement_id,
    row.success_criterion,
    row.title_ja,
    row.title_en,
    row.method_key,
    ...(methodSearchTerms[row.method_key] ?? [])
  ].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase();
}

export function searchRequirements(query, options = {}) {
  const normalized = query.normalize("NFKC").toLocaleLowerCase().trim();
  if (!normalized) throw new Error("Search query must not be empty.");
  return requirementIndex().filter((row) => (!options.profile || row.profile_id === options.profile)
    && (!options.level || row.level === options.level)
    && searchableText(row).includes(normalized));
}

function filteredRows(options) {
  return requirementIndex().filter((row) => (!options.profile || row.profile_id === options.profile)
    && (!options.level || row.level === options.level)
    && (!options.procedure || (options.procedure === "available") === row.procedure_available));
}

function resolveRequirement(profile, id) {
  const rows = requirementIndex().filter((row) => row.profile_id === profile);
  const exact = rows.find((row) => row.requirement_id === id);
  if (exact) return exact;
  const short = id.replace(/^SC[- ]?/iu, "");
  const matches = rows.filter((row) => row.success_criterion === short);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`No requirement found for ${id} in ${profile}.`);
  throw new Error(`Requirement identifier is ambiguous in ${profile}: ${id}`);
}

function parse(argv) {
  const [action, ...rest] = argv;
  const options = { action, format: "json" };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--help") { options.help = true; continue; }
    if (["--profile", "--level", "--procedure", "--format"].includes(arg)) {
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = value;
      index += 1;
    } else if (!options.value) options.value = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!["json", "markdown"].includes(options.format)) throw new Error("--format must be json or markdown");
  if (options.level && !["A", "AA"].includes(options.level)) throw new Error("--level must be A or AA");
  if (options.procedure && !["available", "unavailable"].includes(options.procedure)) throw new Error("--procedure must be available or unavailable");
  return options;
}

function markdownRows(rows) {
  if (!rows.length) return "No matching requirements.\n";
  return [
    "| Profile | SC | Requirement ID | Title | Level | Procedure | Primary source | Related IDs |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.profile_id} | ${row.success_criterion} | ${row.requirement_id} | ${row.title_ja ?? row.title_en ?? ""} | ${row.level} | ${row.procedure_available ? "available" : "unavailable"} | ${row.normative_url ?? row.checklist_source_url ?? row.profile_source_url ?? ""} | ${row.related_requirement_ids.join(", ")} |`)
  ].join("\n") + "\n";
}

export function main(argv = process.argv.slice(2)) {
  const options = parse(argv);
  if (options.help || !options.action) {
    process.stdout.write("Usage: accessibility-audit requirements <list|search|show> [query|SC] [--profile <id>] [--level A|AA] [--procedure available|unavailable] [--format json|markdown]\n");
    return 0;
  }
  let result;
  if (options.action === "list") result = filteredRows(options);
  else if (options.action === "search") {
    if (!options.value) throw new Error("requirements search requires a query");
    result = searchRequirements(options.value, options);
  } else if (options.action === "show") {
    if (!options.profile || !options.value) throw new Error("requirements show requires a profile and requirement ID or success-criterion number");
    const row = resolveRequirement(options.profile, options.value);
    result = { index: row, detail: lookupRequirement(options.profile, row.requirement_id) };
  } else throw new Error(`Unknown requirements action: ${options.action}`);
  if (options.format === "markdown") {
    process.stdout.write(options.action === "show" ? markdownRows([result.index]) : markdownRows(result));
  } else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; }
}
