import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { validateStandardsRegistry } from "../codex/skills/information-accessibility-practice/scripts/lib/profile-registry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "codex/skills/information-accessibility-practice");
const cli = path.join(skillRoot, "scripts/accessibility-audit.mjs");
const registryFile = path.join(skillRoot, "references/standards-registry.json");
const jisProfileId = "jis-x-8341-3-2016-aa";
const legacyCompositeId = "jp-public-web";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/gu, "\n");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
}

function parseJson(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-profile-basis-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function renderReport(t, profile, locale, format = "markdown") {
  const directory = tempDirectory(t);
  const assessment = path.join(directory, `${profile}.json`);
  const extension = format === "html" ? "html" : "md";
  const output = path.join(directory, `${profile}.${locale}.${extension}`);
  writeJson(assessment, generateAssessment(profile, {
    targetName: `${profile} profile basis fixture`,
    targetVersion: "2026-08-24",
    targetRefs: ["https://example.com/"],
    evaluator: "Profile basis test",
    evaluatedAt: "2026-08-24"
  }));
  const result = runCli([
    "report",
    "--input", assessment,
    "--locale", locale,
    "--format", format,
    "--output", output
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return fs.readFileSync(output, "utf8");
}

test("registry provides separate WCAG, JIS, and explicitly adopted legacy composite profiles", () => {
  const registry = readJson(registryFile);
  const validation = validateStandardsRegistry(registry);
  assert.equal(validation.valid, true, validation.errors.join("\n"));

  const profiles = new Map(registry.profiles.map((profile) => [profile.id, profile]));
  const wcag = profiles.get("web-modern");
  const jis = profiles.get(jisProfileId);
  const legacy = profiles.get(legacyCompositeId);

  assert.equal(wcag.requirement_ids.length, 55);
  assert.equal(wcag.profile_kind, "standard_profile");
  assert.equal(wcag.explicit_adoption_required, false);

  assert.ok(jis, "JIS-only profile must be active");
  assert.equal(jis.assessment_configuration.active, true);
  assert.deepEqual(jis.assessment_configuration.catalog_keys, ["jis_x_8341_3_2016"]);
  assert.equal(jis.requirement_ids.length, 38);
  assert.equal(jis.profile_kind, "standard_profile");
  assert.equal(jis.formal_conformance_target, true);
  assert.equal(jis.explicit_adoption_required, false);
  assert.equal(jis.group_bases.jis_x_8341_3_2016.kind, "standard");
  assert.equal(jis.group_bases.jis_x_8341_3_2016.adoption, "profile_default");

  assert.equal(legacy.requirement_ids.length, 56);
  assert.equal(legacy.profile_kind, "organizational_policy_pattern");
  assert.equal(legacy.formal_conformance_target, false);
  assert.equal(legacy.explicit_adoption_required, true);
  assert.match(legacy.display_name, /Digital Agency.*legacy/iu);
  assert.match(legacy.target_scope, /explicitly adopt.*not a general Japanese/iu);
  assert.deepEqual(legacy.migration.recommended_profile_ids, [jisProfileId, "web-modern"]);
  assert.equal(legacy.group_bases.jis_x_8341_3_2016.kind, "standard");
  assert.equal(legacy.group_bases.jp_wcag_2_2_additional.kind, "organizational_policy");
  assert.equal(legacy.group_bases.jp_wcag_2_2_additional.adoption, "explicit_only");
  assert.match(legacy.group_bases.jp_wcag_2_2_additional.scope_en, /not a general Japanese public-sector requirement/iu);
  assert.match(legacy.source_context.current_digital_agency_policy, /does not define this exact 18-item set/iu);
});

test("profile discovery exposes kind, adoption, migration, and localized group basis", () => {
  const ja = parseJson(runCli(["profiles", "list", "--locale", "ja", "--format", "json"]));
  const en = parseJson(runCli(["profiles", "list", "--locale", "en", "--format", "json"]));
  const jaJis = ja.profiles.find((profile) => profile.id === jisProfileId);
  const jaLegacy = ja.profiles.find((profile) => profile.id === legacyCompositeId);
  const enLegacy = en.profiles.find((profile) => profile.id === legacyCompositeId);

  assert.equal(jaJis.display_name, "JIS X 8341-3:2016 A/AAレビュー");
  assert.equal(jaJis.requirement_count, 38);
  assert.equal(jaJis.groups[0].basis.kind, "standard");
  assert.match(jaJis.groups[0].basis.label, /規格上の根拠/u);

  assert.equal(jaLegacy.profile_kind, "organizational_policy_pattern");
  assert.equal(jaLegacy.explicit_adoption_required, true);
  assert.match(jaLegacy.display_name, /デジタル庁.*legacy/u);
  assert.equal(jaLegacy.groups[1].basis.kind, "organizational_policy");
  assert.equal(jaLegacy.groups[1].basis.adoption, "explicit_only");
  assert.match(jaLegacy.groups[1].basis.scope, /一般的な日本の公的Web要件ではありません/u);
  assert.equal(enLegacy.migration.guidance, "docs/profile-selection-and-migration.md");

  const markdown = runCli(["profiles", "list", "--locale", "ja", "--format", "markdown"]);
  assert.equal(markdown.status, 0, markdown.stderr || markdown.stdout);
  assert.match(markdown.stdout, /jis-x-8341-3-2016-aa/u);
  assert.match(markdown.stdout, /明示採用: 必須/u);
  assert.match(markdown.stdout, /組織方針上の根拠/u);
  assert.match(markdown.stdout, /移行ガイド/u);
});

test("JIS-only profile creates a 38-row assessment and localized standards report", (t) => {
  const record = generateAssessment(jisProfileId, {
    targetName: "JIS-only fixture",
    targetVersion: "2026-08-24",
    targetRefs: ["https://example.com/"],
    evaluator: "JIS reviewer",
    evaluatedAt: "2026-08-24"
  });
  assert.equal(record.assessment.results.length, 38);
  assert.ok(record.assessment.results.every((row) => row.requirement_id.startsWith("JIS-X-8341-3-2016-SC-")));

  const ja = renderReport(t, jisProfileId, "ja");
  const en = renderReport(t, jisProfileId, "en");
  assert.match(ja, /^# JIS X 8341-3:2016 A\/AA 監査レポート$/mu);
  assert.match(en, /^# JIS X 8341-3:2016 A\/AA Audit Report$/mu);
  assert.match(ja, /規格上の根拠[^\n]*JIS X 8341-3:2016/u);
  assert.match(en, /Standards basis[^\n]*JIS X 8341-3:2016/iu);
  assert.match(ja, /人による確認済み: 0\/38/u);
});

test("legacy composite report labels both group bases and explicit adoption in Markdown and HTML", (t) => {
  const ja = renderReport(t, legacyCompositeId, "ja");
  const en = renderReport(t, legacyCompositeId, "en");
  const html = renderReport(t, legacyCompositeId, "en", "html");

  assert.match(ja, /^# デジタル庁ウェブ方針由来composite監査レポート$/mu);
  assert.match(en, /^# Digital Agency Web Policy Composite Audit Report$/mu);
  assert.match(ja, /規格上の根拠[^\n]*JIS X 8341-3:2016/u);
  assert.match(ja, /組織方針上の根拠[^\n]*18件[^\n]*明示的な採用/u);
  assert.match(ja, /明示採用: 必須/u);
  assert.match(ja, /一般的な日本の公的Web要件ではありません/u);
  assert.match(en, /Organizational policy basis[^\n]*18[^\n]*explicit adoption/iu);
  assert.match(en, /Explicit adoption: required/iu);
  assert.match(en, /not a general Japanese public-sector requirement/iu);

  assert.match(html, /Digital Agency Web Policy Composite Audit Report/u);
  assert.match(html, /Organizational policy basis/u);
  assert.match(html, /Explicit adoption/u);
  assert.match(html, /not a general Japanese public-sector requirement/iu);
});

test("README and migration guide choose profiles without treating every Japanese site as a 56-item target", () => {
  const japanese = read("README.md");
  const english = read("README.en.md");
  const migration = read("docs/profile-selection-and-migration.md");

  for (const text of [japanese, english, migration]) {
    assert.match(text, /jis-x-8341-3-2016-aa/u);
    assert.match(text, /web-modern/u);
    assert.match(text, /jp-public-web/u);
  }
  assert.match(japanese, /JIS単独[^\n]*38件/u);
  assert.match(japanese, /WCAG 2\.2単独[^\n]*55件/u);
  assert.match(japanese, /legacy[^\n]*56件[^\n]*明示/u);
  assert.doesNotMatch(japanese, /日本向けWeb(?:は|を)[^\n]*常に56件/u);
  assert.match(english, /JIS-only[^\n]*38/iu);
  assert.match(english, /WCAG 2\.2-only[^\n]*55/iu);
  assert.match(english, /legacy[^\n]*56[^\n]*explicit/iu);
  assert.match(migration, /Existing `jp-public-web` records remain unchanged/u);
  assert.match(migration, /new assessment or audit run/u);
  assert.match(migration, /current Digital Agency policy[^\n]*does not define the repository's exact 18-item set/iu);
});
