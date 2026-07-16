import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const sourceUrls = {
  wcag: "https://www.w3.org/TR/WCAG22/",
  jisChecklist: "https://waic.jp/docs/jis2016/test-guidelines/202012/gcl_example.html",
  japanProfile: "https://www.digital.go.jp/accessibility-statement"
};

const wcag21AA = new Set([
  "1.3.4", "1.3.5", "1.4.10", "1.4.11", "1.4.12", "1.4.13",
  "2.1.4", "2.5.1", "2.5.2", "2.5.3", "2.5.4", "4.1.3"
]);

const wcag22AA = new Set([
  "2.4.11", "2.5.7", "2.5.8", "3.2.6", "3.3.7", "3.3.8"
]);

function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function cleanText(value) {
  return decodeEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

async function fetchText(url) {
  if (process.env.A11Y_TEST_FAIL_ON_FETCH === "1") {
    throw new Error("Network access attempted during offline verification");
  }
  const response = await fetch(url, { headers: { "user-agent": "information-accessibility-skill-catalog-builder/1.0" } });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}

function evidenceHints(sc) {
  if (sc.startsWith("1.2.")) return ["media_inventory", "caption_or_transcript_review", "manual_observation"];
  if (["2.1.1", "2.1.2", "2.4.3", "2.4.7", "2.4.11"].includes(sc)) return ["keyboard_test", "focus_inspection", "manual_observation"];
  if (sc.startsWith("2.5.")) return ["pointer_or_touch_test", "manual_observation"];
  if (sc.startsWith("1.4.")) return ["visual_inspection", "computed_style_or_rendering", "zoom_or_reflow_test"];
  if (sc.startsWith("3.3.") || ["1.3.5", "3.2.6"].includes(sc)) return ["form_or_process_review", "error_recovery_test", "manual_observation"];
  if (sc.startsWith("4.1.")) return ["dom_semantics", "accessibility_tree", "assistive_technology_test"];
  return ["structure_inspection", "manual_observation"];
}

function reviewScaffold() {
  return {
    applicability_instruction: "Determine applicability from the normative source and the scoped target; record the rationale.",
    expectation_instruction: "Evaluate the applicable requirement against the normative source; do not infer a result from the title or an automated check alone.",
    method_status: "profile_review_scaffold"
  };
}

const methodKeys = {
  "1.1": "non-text-content", "1.2": "time-based-media", "1.3": "adaptable-structure",
  "1.4": "distinguishable-presentation", "2.1": "keyboard-operation", "2.2": "timing-and-motion",
  "2.3": "seizure-and-physical-reaction", "2.4": "navigation-and-focus", "2.5": "input-modalities",
  "3.1": "readable-language", "3.2": "predictable-behavior", "3.3": "input-assistance",
  "4.1": "compatible-semantics"
};

function methodKey(sc) {
  if (sc === "4.1.1") return "parsing-legacy";
  const key = sc.split(".").slice(0, 2).join(".");
  if (!methodKeys[key]) throw new Error(`No audit method route for success criterion ${sc}`);
  return methodKeys[key];
}

function parseWcag(html) {
  const starts = [...html.matchAll(/<section id="([^"]+)" class="guideline">/g)];
  const records = [];
  for (let index = 0; index < starts.length; index += 1) {
    const block = html.slice(starts[index].index, starts[index + 1]?.index ?? html.length);
    const heading = block.match(/<h4[^>]*><bdi[^>]*>Success Criterion\s+([0-9.]+)\s*<\/bdi>([\s\S]*?)<\/h4>/);
    const level = block.match(/<p class="conformance-level">\(Level\s+(A{1,3})\)<\/p>/);
    if (!heading || !level || level[1] === "AAA") continue;
    const sc = heading[1];
    const anchor = starts[index][1];
    records.push({
      id: `WCAG-2.2-SC-${sc}`,
      success_criterion: sc,
      title_en: cleanText(heading[2]),
      level: level[1],
      introduced_in: wcag22AA.has(sc) ? "2.2" : wcag21AA.has(sc) ? "2.1" : "2.0",
      normative_url: `${sourceUrls.wcag}#${anchor}`,
      understanding_url: `https://www.w3.org/WAI/WCAG22/Understanding/${anchor}.html`,
      evidence_hints: evidenceHints(sc),
      method_key: methodKey(sc),
      official_method_sources: [`https://www.w3.org/WAI/WCAG22/Understanding/${anchor}.html`, "https://www.w3.org/WAI/standards-guidelines/act/rules/"],
      ...reviewScaffold(),
      method_requirement: "manual_or_hybrid",
      automation_role: "supporting_only",
      normative_text_included: false
    });
  }
  return records;
}

function parseJisChecklist(html, wcagIds) {
  return [...html.matchAll(/<tr>\s*<th>([0-9.]+)\u3000([\s\S]*?)<\/th>\s*<td>(A{1,3})<\/td>/g)]
    .filter((match) => match[3] !== "AAA")
    .map((match) => {
      const sc = match[1];
      return {
        id: `JIS-X-8341-3-2016-SC-${sc}`,
        success_criterion: sc,
        title_ja: cleanText(match[2]).replace(/の達成基準$/u, ""),
        level: match[3],
        wcag_2_0_equivalent: `WCAG-2.0-SC-${sc}`,
        web_modern_record_id: wcagIds.has(`WCAG-2.2-SC-${sc}`) ? `WCAG-2.2-SC-${sc}` : null,
        checklist_source_url: sourceUrls.jisChecklist,
        evidence_hints: evidenceHints(sc),
        method_key: methodKey(sc),
        official_method_sources: [sourceUrls.jisChecklist, "https://waic.jp/docs/jis2016/understanding/"],
        ...reviewScaffold(),
        method_requirement: "manual_or_hybrid",
        automation_role: "supporting_only",
        normative_text_included: false
      };
    });
}

function parseJapanAdditional(html, wcagBySc) {
  return [...html.matchAll(/<li>\u9054\u6210\u57fa\u6e96\s+([0-9.]+)\s+([\s\S]*?)\uff08\u9069\u5408\u30ec\u30d9\u30eb\uff1a\s*(A{1,3})\uff09<\/li>/g)]
    .map((match) => {
      const sc = match[1];
      const wcag = wcagBySc.get(sc);
      if (!wcag) throw new Error(`Digital Agency additional criterion is not in WCAG 2.2 A/AA: ${sc}`);
      return {
        id: `WCAG-2.2-ADDITIONAL-SC-${sc}`,
        success_criterion: sc,
        title_ja: cleanText(match[2]),
        title_en: wcag.title_en,
        level: match[3],
        wcag_record_id: wcag.id,
        profile_source_url: sourceUrls.japanProfile,
        normative_url: wcag.normative_url,
        evidence_hints: wcag.evidence_hints,
        method_key: wcag.method_key,
        official_method_sources: wcag.official_method_sources,
        ...reviewScaffold(),
        method_requirement: "manual_or_hybrid",
        automation_role: "supporting_only",
        normative_text_included: false
      };
    });
}

function assertCount(label, records, expected) {
  if (records.length !== expected) throw new Error(`${label}: expected ${expected}, got ${records.length}`);
  if (new Set(records.map((record) => record.id)).size !== expected) throw new Error(`${label}: duplicate IDs detected`);
}

function assertSameIds(label, catalogRecords, registryIds) {
  const left = [...catalogRecords.map((record) => record.id)].sort();
  const right = [...registryIds].sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(`${label}: registry IDs and catalog IDs differ`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function assertCatalogIntegrity({ wcag, jis, japanAdditional, registry }) {
  assertCount("WCAG 2.2 A/AA", wcag, 55);
  assertCount("JIS X 8341-3:2016 A/AA", jis, 38);
  assertCount("Japan additional WCAG 2.2 A/AA", japanAdditional, 18);
  assertSameIds("web-modern", wcag, registry.profiles.find((profile) => profile.id === "web-modern").requirement_ids);
  assertSameIds(
    "jp-public-web",
    [...jis, ...japanAdditional],
    registry.profiles.find((profile) => profile.id === "jp-public-web").requirement_ids
  );
}

function createCatalog({ wcag, jis, japanAdditional, verifiedAt, wcagHtml, jisHtml, japanHtml }) {
  return {
    schema_version: "1.0.0",
    catalog_status: "metadata_complete",
    verified_at: verifiedAt,
    copyright_boundary: "Contains identifiers, titles, levels, source links, and original evidence classifications. Normative criterion text is not included.",
    sources: [
      { id: "WCAG-2.2", url: sourceUrls.wcag, role: "normative success-criterion metadata", source_sha256: sha256(wcagHtml) },
      { id: "WAIC-JIS-CHECKLIST-2020-12", url: sourceUrls.jisChecklist, role: "Japanese checklist metadata", source_sha256: sha256(jisHtml) },
      { id: "DIGITAL-AGENCY-JP-PROFILE", url: sourceUrls.japanProfile, role: "18 additional WCAG criteria profile", source_sha256: sha256(japanHtml) }
    ],
    catalogs: {
      web_modern: wcag,
      jis_x_8341_3_2016: jis,
      jp_wcag_2_2_additional: japanAdditional
    }
  };
}

export function buildCatalogFromSources({ wcagHtml, jisHtml, japanHtml, verifiedAt, registry }) {
  const wcag = parseWcag(wcagHtml);
  const wcagIds = new Set(wcag.map((record) => record.id));
  const wcagBySc = new Map(wcag.map((record) => [record.success_criterion, record]));
  const jis = parseJisChecklist(jisHtml, wcagIds);
  const japanAdditional = parseJapanAdditional(japanHtml, wcagBySc);
  assertCatalogIntegrity({ wcag, jis, japanAdditional, registry });
  return createCatalog({ wcag, jis, japanAdditional, verifiedAt, wcagHtml, jisHtml, japanHtml });
}

function catalogPaths(root) {
  return {
    codex: path.join(root, "codex", "skills", "information-accessibility-practice", "references", "criteria-catalog.json"),
    claude: path.join(root, "claude", "skills", "information-accessibility-practice", "references", "criteria-catalog.json"),
    registry: path.join(root, "codex", "skills", "information-accessibility-practice", "references", "standards-registry.json")
  };
}

function catalogRecords(catalog) {
  return {
    wcag: catalog.catalogs.web_modern,
    jis: catalog.catalogs.jis_x_8341_3_2016,
    japanAdditional: catalog.catalogs.jp_wcag_2_2_additional
  };
}

export function verifyStoredCatalog(root) {
  const paths = catalogPaths(root);
  const codexBytes = fs.readFileSync(paths.codex);
  const claudeBytes = fs.readFileSync(paths.claude);
  if (!codexBytes.equals(claudeBytes)) throw new Error("Stored Codex and Claude catalogs differ");

  const registry = JSON.parse(fs.readFileSync(paths.registry, "utf8"));
  for (const [label, bytes] of [["Codex", codexBytes], ["Claude", claudeBytes]]) {
    const catalog = JSON.parse(bytes.toString("utf8"));
    try {
      assertCatalogIntegrity({ ...catalogRecords(catalog), registry });
    } catch (error) {
      throw new Error(`${label} stored catalog is invalid: ${error.message}`);
    }
  }

  return {
    status: "PASS",
    counts: { wcag: 55, jis: 38, japan_additional: 18 },
    mirrors_equal: true
  };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function refreshCatalog(root) {
  const outputArgument = argumentValue("--output");
  if (!outputArgument) throw new Error("--output is required with --refresh");
  const output = path.resolve(process.cwd(), outputArgument);
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing output: ${output}`);

  const verifiedAt = argumentValue("--verified-at");
  if (!verifiedAt) throw new Error("--verified-at is required with --refresh");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedAt)) throw new Error("--verified-at must be YYYY-MM-DD");

  const paths = catalogPaths(root);
  const registry = JSON.parse(fs.readFileSync(paths.registry, "utf8"));
  const [wcagHtml, jisHtml, japanHtml] = await Promise.all([
    fetchText(sourceUrls.wcag),
    fetchText(sourceUrls.jisChecklist),
    fetchText(sourceUrls.japanProfile)
  ]);
  const catalog = buildCatalogFromSources({ wcagHtml, jisHtml, japanHtml, verifiedAt, registry });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(catalog, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return { status: "PASS", mode: "refresh", output, counts: { wcag: 55, jis: 38, japan_additional: 18 } };
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.dirname(scriptDir);
  const checkOnly = process.argv.includes("--check");
  const refresh = process.argv.includes("--refresh");
  if (checkOnly === refresh) throw new Error("Specify exactly one of --check or --refresh");

  if (checkOnly) {
    console.log(JSON.stringify({ ...verifyStoredCatalog(root), mode: "check" }));
    return;
  }
  console.log(JSON.stringify(await refreshCatalog(root), null, 2));
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  await main();
}
