import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function codeBlocks(markdown) {
  return [...markdown.matchAll(/^```(?<language>[^\n]*)\n(?<body>[\s\S]*?)^```\s*$/gmu)]
    .map((match) => ({ language: match.groups.language.trim(), body: match.groups.body }));
}

function headingLevels(markdown) {
  return [...markdown.matchAll(/^(?<marks>#{1,6})\s+/gmu)]
    .map((match) => match.groups.marks.length);
}

function localLinks(markdown) {
  return [...markdown.matchAll(/\[[^\]]+\]\((?<target>[^)]+)\)/gu)]
    .map((match) => match.groups.target)
    .filter((target) => !/^(?:https?:|mailto:|#)/iu.test(target));
}

function sections(markdown) {
  const result = [];
  let current;
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) inFence = !inFence;
    const heading = !inFence ? line.match(/^## (?!#)(?<title>.+)$/u)?.groups?.title : undefined;
    if (heading) {
      current = { title: heading, lines: [] };
      result.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return result;
}

function sectionShape(section) {
  const body = section.lines.join("\n");
  return {
    bullets: section.lines.filter((line) => /^- /u.test(line)).length,
    numbered: section.lines.filter((line) => /^\d+\. /u.test(line)).length,
    fences: [...body.matchAll(/^```(?<language>[^\n]*)$/gmu)].map((match) => match.groups.language.trim()),
    subheadings: section.lines.filter((line) => /^### /u.test(line)).length,
    links: localLinks(body).length
  };
}

test("README defaults to Japanese and provides a reciprocal English switch", () => {
  const japanese = read("README.md");
  const english = read("README.en.md");

  assert.match(japanese, /^日本語 \| \[English\]\(README\.en\.md\)\n\n# 情報アクセシビリティ監査スキル／エージェント/u);
  assert.match(english, /^\[日本語\]\(README\.md\) \| English\n\n# Information Accessibility Audit Skill and Agent/u);
});

test("READMEs explain the user journey and evidence boundary before internal details", () => {
  const japanese = read("README.md");
  const english = read("README.en.md");

  assert.match(japanese, /## 30秒で分かる概要[^]*見つけ[^\n]*受け取[^\n]*理解[^\n]*目的の行動[^\n]*後から/u);
  assert.match(japanese, /問題候補[^]*外部の人による確認[^]*現行版だけで正式な適合宣言はできません/u);
  assert.match(english, /## In 30 seconds[^]*find information[^]*receive it[^]*understand it[^]*intended action[^]*check the result later/iu);
  assert.match(english, /barrier candidates[^]*external human review[^]*current release alone cannot support a formal conformance declaration/iu);
  assert.ok(japanese.indexOf("## 30秒で分かる概要") < japanese.indexOf("`web-modern`"));
  assert.ok(english.indexOf("## In 30 seconds") < english.indexOf("`web-modern`"));
});

test("READMEs explain WCAG and JIS profile counts with primary guidance links", () => {
  const japanese = read("README.md");
  const english = read("README.en.md");
  const wcagUrl = "https://www.w3.org/TR/WCAG22/";
  const jisGuidanceUrl = "https://waic.jp/docs/jis2016/understanding/201604/";
  const wcagChangesUrl = "https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/";

  for (const readme of [japanese, english]) {
    assert.equal(readme.includes(wcagUrl), true);
    assert.equal(readme.includes(jisGuidanceUrl), true);
    assert.equal(readme.includes(wcagChangesUrl), true);
  }
  assert.match(japanese, /`web-modern`[^\n]*55件/u);
  assert.match(japanese, /`jp-public-web`[^\n]*38件[^\n]*18件[^\n]*合計56件/u);
  assert.match(japanese, /4\.1\.1「構文解析」[^\n]*WCAG 2\.2では削除/u);
  assert.match(english, /`web-modern`[^\n]*55 WCAG 2\.2/iu);
  assert.match(english, /`jp-public-web`[^\n]*38[^\n]*18[^\n]*56 checks in total/iu);
  assert.match(english, /4\.1\.1, Parsing[^\n]*WCAG 2\.2 removed/iu);
});

test("Japanese and English READMEs preserve structural and executable parity", () => {
  const japanese = read("README.md");
  const english = read("README.en.md");

  const japaneseBlocks = codeBlocks(japanese);
  const englishBlocks = codeBlocks(english);
  assert.deepEqual(headingLevels(english), headingLevels(japanese));
  assert.deepEqual(englishBlocks.map(({ language }) => language), japaneseBlocks.map(({ language }) => language));
  assert.deepEqual(
    englishBlocks.filter(({ language }) => ["powershell", "sh"].includes(language)),
    japaneseBlocks.filter(({ language }) => ["powershell", "sh"].includes(language))
  );

  const headingPairs = [
    ["30秒で分かる概要", "In 30 seconds"],
    ["目次", "Table of contents"],
    ["まず選ぶ：3つの利用経路", "Choose one of three paths"],
    ["対応対象と現在の制限", "Supported targets and current limits"],
    ["前提条件と導入", "Requirements and installation"],
    ["5分で試す", "Try it in five minutes"],
    ["生成されるもの", "Outputs"],
    ["実Web検査", "Live Web inspection"],
    ["詳細ドキュメント", "Detailed documentation"],
    ["証拠と主張の境界", "Evidence and claim boundary"],
    ["開発と保守", "Development and maintenance"],
    ["ライセンス", "License"]
  ];
  const japaneseSections = new Map(sections(japanese).map((section) => [section.title, section]));
  const englishSections = new Map(sections(english).map((section) => [section.title, section]));
  assert.equal(japaneseSections.size, headingPairs.length);
  assert.equal(englishSections.size, headingPairs.length);
  for (const [japaneseHeading, englishHeading] of headingPairs) {
    assert.ok(japaneseSections.has(japaneseHeading), `missing Japanese section: ${japaneseHeading}`);
    assert.ok(englishSections.has(englishHeading), `missing English section: ${englishHeading}`);
    assert.deepEqual(
      sectionShape(englishSections.get(englishHeading)),
      sectionShape(japaneseSections.get(japaneseHeading)),
      `section structure differs: ${japaneseHeading} / ${englishHeading}`
    );
  }

  for (const anchor of [
    "`web-modern`",
    "`jp-public-web`",
    "`reference_only`",
    "`evaluated_subset`",
    "`mapping_status: \"unverified\"`",
    "`outcome: \"not_tested\"`",
    "`SCREEN-*`",
    "`screening_check`",
    "`profile_requirement`",
    "`-IncludeAuthorizedFixer`"
  ]) {
    assert.equal(japanese.includes(anchor), true, `Japanese README missing ${anchor}`);
    assert.equal(english.includes(anchor), true, `English README missing ${anchor}`);
  }

  assert.deepEqual(
    localLinks(english).filter((target) => target !== "README.md").sort(),
    localLinks(japanese).filter((target) => target !== "README.en.md").sort()
  );

  const englishWithoutSwitch = english.replace(/^\[日本語\][^\n]*\n/u, "");
  assert.doesNotMatch(englishWithoutSwitch, /[\u3040-\u30ff\u3400-\u9fff]/u);
});

test("every relative README link resolves inside the package", () => {
  for (const readme of ["README.md", "README.en.md"]) {
    for (const target of localLinks(read(readme))) {
      const decoded = decodeURIComponent(target.split("#", 1)[0]);
      assert.equal(fs.existsSync(path.resolve(root, decoded)), true, `${readme}: missing ${target}`);
    }
  }
});

test("public READMEs contain no implementation-history markers", () => {
  for (const readme of ["README.md", "README.en.md"]) {
    const text = read(readme);
    assert.doesNotMatch(text, /Task\s+\d+|codex\/m4-agent-human-boundary|\b[0-9a-f]{7,40}\b|情報アクセシビリティ勉強会|Leafyflow|(?:[A-Za-z]:\\|\/Users\/)|implementation history|development milestone/iu);
  }
});
