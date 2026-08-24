import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "codex/skills/information-accessibility-practice");
const cli = path.join(skillRoot, "scripts/accessibility-audit.mjs");
const canonicalChecklist = JSON.parse(fs.readFileSync(path.join(skillRoot, "references/screen-reader-ui-checks.json"), "utf8"));

function runCli(args, env = process.env) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024
  });
}

function parseJson(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-runtime-locale-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("global CLI help and dispatch errors can be selected explicitly in Japanese or English", () => {
  const japanese = runCli(["--locale", "ja", "--help"]);
  assert.equal(japanese.status, 0, japanese.stderr || japanese.stdout);
  assert.match(japanese.stdout, /^情報アクセシビリティ監査CLI$/mu);
  assert.match(japanese.stdout, /^使用方法:$/mu);
  assert.match(japanese.stdout, /^コマンド:$/mu);
  assert.match(japanese.stdout, /利用可能な規格プロファイル/u);
  assert.doesNotMatch(japanese.stdout, /^Usage:|^Commands:|Unknown command/mu);

  const english = runCli(["--locale", "en", "--help"]);
  assert.equal(english.status, 0, english.stderr || english.stdout);
  assert.match(english.stdout, /^Information Accessibility Audit CLI$/mu);
  assert.match(english.stdout, /^Usage:$/mu);
  assert.doesNotMatch(english.stdout, /使用方法|不明なコマンド/u);

  const unknown = runCli(["--locale", "ja", "does-not-exist"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /不明なコマンド/u);
  assert.match(unknown.stderr, /--help/u);

  const invalid = runCli(["--locale", "fr", "--help"]);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /--locale must be ja or en/u);
});

test("command-specific help uses one selected locale and report help follows the same global option", () => {
  const requirements = runCli(["--locale", "ja", "requirements", "--help"]);
  assert.equal(requirements.status, 0, requirements.stderr || requirements.stdout);
  assert.match(requirements.stdout, /WCAG・JIS条項を一覧・検索・表示/u);
  assert.match(requirements.stdout, /^使用方法:$/mu);
  assert.match(requirements.stdout, /^オプション:$/mu);
  assert.match(requirements.stdout, /表示言語/u);
  assert.doesNotMatch(requirements.stdout, /^Usage:|^Options:/mu);

  const report = runCli(["--locale", "ja", "report", "--help"]);
  assert.equal(report.status, 0, report.stderr || report.stdout);
  assert.match(report.stdout, /^使用方法:$/mu);
  assert.match(report.stdout, /人向けレポートの言語/u);
  assert.match(report.stdout, /公開前の人による確認/u);
  assert.doesNotMatch(report.stdout, /^Usage:|Report options:/mu);
});

test("profile text and Markdown are localized while IDs, counts, and claim enum remain stable", () => {
  const ja = parseJson(runCli(["profiles", "list", "--locale", "ja", "--format", "json"]));
  const en = parseJson(runCli(["profiles", "list", "--locale", "en", "--format", "json"]));
  assert.equal(ja.locale, "ja");
  assert.equal(en.locale, "en");
  assert.deepEqual(
    ja.profiles.map(({ id, requirement_count, claim_ceiling }) => ({ id, requirement_count, claim_ceiling })),
    en.profiles.map(({ id, requirement_count, claim_ceiling }) => ({ id, requirement_count, claim_ceiling }))
  );
  const jaWeb = ja.profiles.find((profile) => profile.id === "web-modern");
  const enWeb = en.profiles.find((profile) => profile.id === "web-modern");
  assert.equal(jaWeb.display_name, "現代Webアクセシビリティレビュー");
  assert.equal(enWeb.display_name, "Modern Web accessibility review");
  assert.notEqual(jaWeb.target_scope, enWeb.target_scope);

  const markdown = runCli(["profiles", "list", "--locale", "ja", "--format", "markdown"]);
  assert.equal(markdown.status, 0, markdown.stderr || markdown.stdout);
  assert.match(markdown.stdout, /^# 利用可能なアクセシビリティプロファイル$/mu);
  assert.match(markdown.stdout, /条項数/u);
  assert.match(markdown.stdout, /主張上限/u);
  assert.doesNotMatch(markdown.stdout, /Active accessibility profiles|Requirements|Claim ceiling/u);
});

test("requirements provide Japanese WCAG titles and explicit English fallback provenance for JIS 4.1.1", () => {
  const ja = parseJson(runCli([
    "requirements", "show", "1.1.1",
    "--profile", "web-modern",
    "--locale", "ja",
    "--format", "json"
  ]));
  assert.equal(ja.requirement.title, "非テキストコンテンツ");
  assert.match(ja.requirement.title_locale_status.ja, /equivalent_(?:jis|japanese_profile)/u);

  const en = parseJson(runCli([
    "requirements", "show", "4.1.1",
    "--profile", "jp-public-web",
    "--locale", "en",
    "--format", "json"
  ]));
  assert.equal(en.requirement.id, "JIS-X-8341-3-2016-SC-4.1.1");
  assert.equal(en.requirement.title, "Parsing");
  assert.equal(en.requirement.title_locale_status.en, "maintained_fallback");

  const jaMarkdown = runCli([
    "requirements", "show", "1.1.1",
    "--profile", "web-modern",
    "--locale", "ja",
    "--format", "markdown"
  ]);
  assert.equal(jaMarkdown.status, 0, jaMarkdown.stderr || jaMarkdown.stdout);
  assert.match(jaMarkdown.stdout, /^# 1\.1\.1 非テキストコンテンツ$/mu);
  assert.match(jaMarkdown.stdout, /内部ID/u);
  assert.match(jaMarkdown.stdout, /一次資料と解説資料/u);
  assert.match(jaMarkdown.stdout, /適合性の判定ではありません/u);
  assert.doesNotMatch(jaMarkdown.stdout, /Internal ID|Primary and guidance sources|conformance determination/u);
});

test("requirements search remains bilingual but renders headings in the requested locale", () => {
  const japaneseQuery = parseJson(runCli([
    "requirements", "search", "フォーカス",
    "--profile", "web-modern",
    "--locale", "ja",
    "--format", "json"
  ]));
  assert.ok(japaneseQuery.count > 0);
  assert.ok(japaneseQuery.requirements.every((item) => item.title === item.title_ja));

  const englishQuery = parseJson(runCli([
    "requirements", "search", "focus",
    "--profile", "web-modern",
    "--locale", "en",
    "--format", "json"
  ]));
  assert.ok(englishQuery.count > 0);
  assert.ok(englishQuery.requirements.every((item) => item.title === item.title_en));

  const markdown = runCli([
    "requirements", "search", "フォーカス",
    "--profile", "web-modern",
    "--locale", "ja",
    "--format", "markdown"
  ]);
  assert.equal(markdown.status, 0, markdown.stderr || markdown.stdout);
  assert.match(markdown.stdout, /^# 条項検索: フォーカス$/mu);
  assert.match(markdown.stdout, /結果:/u);
  assert.match(markdown.stdout, /条項固有手順/u);
  assert.doesNotMatch(markdown.stdout, /Requirement search|Results:|Procedure/u);
});

test("legacy exact requirement lookup accepts locale without changing machine identifiers", () => {
  const ja = parseJson(runCli([
    "requirement", "--profile", "web-modern", "--id", "WCAG-2.2-SC-1.1.1", "--locale", "ja"
  ]));
  const en = parseJson(runCli([
    "requirement", "--profile", "web-modern", "--id", "WCAG-2.2-SC-1.1.1", "--locale", "en"
  ]));
  assert.equal(ja.criterion.id, en.criterion.id);
  assert.equal(ja.audit_method.id, en.audit_method.id);
  assert.equal(ja.locale, "ja");
  assert.equal(en.locale, "en");
  assert.equal(ja.criterion.display_title, "非テキストコンテンツ");
  assert.equal(en.criterion.display_title, "Non-text Content");

  const markdown = runCli([
    "requirement", "--profile", "web-modern", "--id", "WCAG-2.2-SC-1.1.1",
    "--locale", "ja", "--format", "markdown"
  ]);
  assert.equal(markdown.status, 0, markdown.stderr || markdown.stdout);
  assert.match(markdown.stdout, /適用条件/u);
  assert.match(markdown.stdout, /確認手順/u);
  assert.match(markdown.stdout, /AIの境界/u);
  assert.doesNotMatch(markdown.stdout, /^## Applicability$|^## Procedure$|^## AI boundary$/mu);
});

test("screen-reader checklist has a complete Japanese overlay and stable machine-readable IDs and enums", () => {
  const ja = parseJson(runCli([
    "screen-reader-checklist", "--pattern", "all", "--locale", "ja", "--format", "json"
  ]));
  const en = parseJson(runCli([
    "screen-reader-checklist", "--pattern", "all", "--locale", "en", "--format", "json"
  ]));
  assert.equal(ja.locale, "ja");
  assert.equal(en.locale, "en");
  assert.equal(ja.claim_effect, "supporting_only");
  assert.equal(en.claim_effect, "supporting_only");
  assert.deepEqual(ja.patterns.map((pattern) => pattern.id), en.patterns.map((pattern) => pattern.id));
  assert.deepEqual(
    ja.patterns.flatMap((pattern) => pattern.checks.map((check) => check.id)),
    en.patterns.flatMap((pattern) => pattern.checks.map((check) => check.id))
  );
  assert.equal(ja.patterns[0].title, "モーダルダイアログ、ドロワー、または全画面ポップアップ");
  assert.equal(en.patterns[0].title, canonicalChecklist.patterns[0].title);

  for (const [patternIndex, pattern] of canonicalChecklist.patterns.entries()) {
    const localized = ja.patterns[patternIndex];
    assert.equal(localized.id, pattern.id);
    assert.notEqual(localized.title, pattern.title);
    assert.notEqual(localized.applicability, pattern.applicability);
    for (const [checkIndex, check] of pattern.checks.entries()) {
      const translated = localized.checks[checkIndex];
      assert.equal(translated.id, check.id);
      for (const field of ["title", "expectation"]) assert.notEqual(translated[field], check[field], `${check.id}.${field}`);
      for (const field of ["code_inspection", "runtime_verification", "cant_tell_when"]) {
        assert.equal(translated[field].length, check[field].length, `${check.id}.${field}`);
        translated[field].forEach((value, index) => assert.notEqual(value, check[field][index], `${check.id}.${field}[${index}]`));
      }
      assert.deepEqual(translated.evidence_types, check.evidence_types);
      assert.equal(translated.human_review_required, check.human_review_required);
    }
  }

  const markdown = runCli([
    "screen-reader-checklist", "--pattern", "modal-dialog", "--locale", "ja", "--format", "markdown"
  ]);
  assert.equal(markdown.status, 0, markdown.stderr || markdown.stdout);
  assert.match(markdown.stdout, /^# スクリーンリーダーUIチェックリスト$/mu);
  assert.match(markdown.stdout, /コード・構造の確認/u);
  assert.match(markdown.stdout, /実行時の確認/u);
  assert.match(markdown.stdout, /証拠の境界/u);
  assert.doesNotMatch(markdown.stdout, /Screen-reader UI checklist|Code or structure inspection|Runtime verification|Evidence boundary/u);
});

test("report locale and runtime locale preserve stable machine-readable records", (t) => {
  const directory = tempDirectory(t);
  const record = generateAssessment("web-modern", {
    targetName: "Runtime locale fixture",
    targetVersion: "2026-08-24",
    targetRefs: ["https://example.com/"],
    evaluator: "Locale test",
    evaluatedAt: "2026-08-24"
  });
  const assessment = path.join(directory, "assessment.json");
  writeJson(assessment, record);
  const jaReport = path.join(directory, "ja.md");
  const enReport = path.join(directory, "en.md");
  const ja = runCli(["report", "--input", assessment, "--locale", "ja", "--output", jaReport]);
  const en = runCli(["report", "--input", assessment, "--locale", "en", "--output", enReport]);
  assert.equal(ja.status, 0, ja.stderr || ja.stdout);
  assert.equal(en.status, 0, en.stderr || en.stdout);
  const jaText = fs.readFileSync(jaReport, "utf8");
  const enText = fs.readFileSync(enReport, "utf8");
  assert.match(jaText, /^# WCAG 2\.2 A\/AA 検査レポート$/mu);
  assert.match(enText, /^# WCAG 2\.2 A\/AA Audit Report$/mu);
  assert.doesNotMatch(enText, /検査対象|判定の出所|主張可能な範囲/u);
  assert.deepEqual(JSON.parse(fs.readFileSync(assessment, "utf8")), record);
});

test("Japanese and English READMEs demonstrate the matching explicit locale", () => {
  const japanese = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const english = fs.readFileSync(path.join(root, "README.en.md"), "utf8");
  assert.match(japanese, /accessibility-audit[^\n]*--locale ja/u);
  assert.match(english, /accessibility-audit[^\n]*--locale en/u);
  assert.match(japanese, /requirements[^\n]*--locale ja/u);
  assert.match(english, /requirements[^\n]*--locale en/u);
  assert.match(japanese, /screen-reader-checklist[^\n]*--locale ja/u);
  assert.match(english, /screen-reader-checklist[^\n]*--locale en/u);
});
