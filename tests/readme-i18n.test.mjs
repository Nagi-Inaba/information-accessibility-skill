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

test("Japanese README explains the user journey before using participation terminology", () => {
  const japanese = read("README.md");
  const introduction = japanese.slice(0, japanese.indexOf("## できること"));

  assert.doesNotMatch(introduction, /参加アクセシビリティ/u);
  assert.match(introduction, /見つけ[^\n]*受け取[^\n]*理解[^\n]*目的の行動[^\n]*後から/u);
  assert.match(japanese, /\*\*行動する（Participate）\*\*[^\n]*質問[^\n]*申込[^\n]*サービスの利用[^\n]*支援依頼[^\n]*イベントへの参加/u);
});

test("READMEs lead with inspection and improvement before claim boundaries", () => {
  const japanese = read("README.md");
  const english = read("README.en.md");

  assert.match(japanese, /## 自分のプロダクトを確認し、改善する[^]*達成基準と照らし合わせ[^]*検査[^]*専門家でなくても[^]*改善できる箇所/u);
  assert.match(japanese, /正式な適合宣言ではありません[^]*適合宣言を目指す場合[^]*人による評価へ引き継ぐ準備[^]*結果だけで適合宣言を行うことはできません/u);
  assert.match(english, /## Check and improve your own product[^]*inspections[^]*success criteria[^]*without being accessibility specialists[^]*actionable improvements/iu);
  assert.match(english, /not third-party certification[^]*formal declaration[^]*When formal conformance is the goal[^]*before human evaluation[^]*results alone cannot support a conformance declaration/iu);
  assert.ok(japanese.indexOf("## 自分のプロダクトを確認し、改善する") < japanese.indexOf("`web-modern`"));
  assert.ok(english.indexOf("## Check and improve your own product") < english.indexOf("`web-modern`"));
});

test("READMEs explain the WCAG and JIS profile counts with primary guidance links", () => {
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
  assert.match(japanese, /`web-modern`[^\n]*55の達成基準/u);
  assert.match(japanese, /`jp-public-web`[^\n]*38の達成基準/u);
  assert.match(japanese, /WCAG 2\.1と、?2\.2[^\n]*レベルAとAAの18件/u);
  assert.match(japanese, /合計56件/u);
  assert.match(japanese, /4\.1\.1「構文解析」[^]*WCAG 2\.2では[^]*削除/u);
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
  assert.match(english, /AI agents[^]*`mapping_status: "unverified"`[^]*`outcome: "not_tested"`/iu);
  assert.match(english, /external human review[^]*target-specific manual or hybrid evidence[^]*`pass`[^]*`fail`/iu);
  assert.match(english, /does not provide[^]*(?:certification|conformance)/iu);
  const englishWithoutSwitchOrJudgements = english
    .replace(/^\[日本語\][^\n]*\n/u, "")
    .replace(/適合|不適合|要確認|未確認/gu, "");
  assert.doesNotMatch(englishWithoutSwitchOrJudgements, /[\u3040-\u30ff\u3400-\u9fff]/u);

  const headingPairs = [
    ["自分のプロダクトを確認し、改善する", "Check and improve your own product"],
    ["できること", "Capabilities"],
    ["使い方を選ぶ", "Choose a usage path"],
    ["パッケージ構成", "Package layout"],
    ["参照ファイル", "Reference files"],
    ["詳しい使い方", "Detailed usage"],
    ["対象別の確認範囲", "Detailed review coverage"],
    ["確認する観点", "Review perspectives"],
    ["依頼例", "Example requests"],
    ["出力例", "Example output"],
    ["検証", "Verification"],
    ["主張と制限", "Claims and limitations"],
    ["ライセンス", "License"]
  ];
  const japaneseSections = new Map(sections(japanese).map((section) => [section.title, section]));
  const englishSections = new Map(sections(english).map((section) => [section.title, section]));
  assert.ok(japanese.indexOf("## できること") < japanese.indexOf("## パッケージ構成"));
  assert.ok(japanese.indexOf("## 使い方を選ぶ") < japanese.indexOf("## パッケージ構成"));
  assert.ok(english.indexOf("## Capabilities") < english.indexOf("## Package layout"));
  assert.ok(english.indexOf("## Choose a usage path") < english.indexOf("## Package layout"));
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
    "`evaluated_subset`",
    "`mapping_status: \"unverified\"`",
    "`outcome: \"not_tested\"`",
    "`SCREEN-*`",
    "`screening_check`",
    "`profile_requirement`",
    "`-IncludeAuthorizedFixer`",
    "`profile_outcome_counts`",
    "`screening_outcome_counts`"
  ]) {
    assert.equal(japanese.includes(anchor), true, `Japanese README missing ${anchor}`);
    assert.equal(english.includes(anchor), true, `English README missing ${anchor}`);
  }

  assert.deepEqual(
    localLinks(english).filter((target) => target !== "README.md").sort(),
    localLinks(japanese).filter((target) => target !== "README.en.md").sort()
  );
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
