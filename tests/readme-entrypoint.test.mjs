import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const japaneseReadmePath = path.join(root, "README.md");
const englishReadmePath = path.join(root, "README.en.md");
const architecturePath = path.join(root, "docs/architecture-and-glossary.md");

const japaneseReadme = fs.readFileSync(japaneseReadmePath, "utf8");
const englishReadme = fs.readFileSync(englishReadmePath, "utf8");
const architecture = fs.readFileSync(architecturePath, "utf8");

function assertContainsAll(text, values, context) {
  for (const value of values) {
    assert.ok(text.includes(value), `${context}: missing ${value}`);
  }
}

function localMarkdownLinks(text) {
  return [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
    .map((match) => match[1].trim())
    .filter((target) => !/^(?:https?:|mailto:|#)/iu.test(target))
    .map((target) => target.split("#", 1)[0])
    .filter(Boolean);
}

function assertLocalLinksResolve(filePath, text) {
  for (const target of localMarkdownLinks(text)) {
    const resolved = path.resolve(path.dirname(filePath), decodeURIComponent(target));
    assert.equal(fs.existsSync(resolved), true, `${path.basename(filePath)}: broken local link ${target}`);
  }
}

test("Japanese and English READMEs present a short user-first entry point", () => {
  assertContainsAll(japaneseReadme, [
    "## 30秒で分かる概要",
    "## 目次",
    "## まず選ぶ：3つの利用経路",
    "## 5分で試す",
    "## 生成されるもの",
    "## 詳細ドキュメント",
    "自然言語レビュー",
    "standalone評価",
    "run-backed監査",
    "現行版だけで正式な適合宣言はできません"
  ], "README.md");

  assertContainsAll(englishReadme, [
    "## In 30 seconds",
    "## Table of contents",
    "## Choose one of three paths",
    "## Try it in five minutes",
    "## Outputs",
    "## Detailed documentation",
    "Natural-language review",
    "Standalone assessment",
    "Run-backed audit",
    "The current release alone cannot support a formal conformance declaration"
  ], "README.en.md");

  assert.ok(japaneseReadme.indexOf("## 5分で試す") < japaneseReadme.indexOf("## 詳細ドキュメント"));
  assert.ok(englishReadme.indexOf("## Try it in five minutes") < englishReadme.indexOf("## Detailed documentation"));
  assert.equal(japaneseReadme.includes("## パッケージ構成"), false, "README.md must not keep a stale hand-maintained package tree");
  assert.equal(englishReadme.includes("## Package layout"), false, "README.en.md must not keep a stale hand-maintained package tree");
  assert.ok(japaneseReadme.split(/\r?\n/u).length <= 260, "README.md should remain a concise entry point");
  assert.ok(englishReadme.split(/\r?\n/u).length <= 260, "README.en.md should remain a concise entry point");
});

test("README navigation points to the maintained guides and every local link resolves", () => {
  for (const [filePath, text] of [
    [japaneseReadmePath, japaneseReadme],
    [englishReadmePath, englishReadme]
  ]) {
    assertContainsAll(text, [
      "docs/getting-started.md",
      "docs/architecture-and-glossary.md",
      "docs/web-inspection.md",
      "SECURITY.md",
      "CONTRIBUTING.md",
      "CHANGELOG.md",
      "THIRD_PARTY_NOTICES.md"
    ], path.basename(filePath));
    assertLocalLinksResolve(filePath, text);
  }
});

test("README command examples refer to scripts that exist in the repository", () => {
  const requiredScripts = [
    "scripts/install-codex.ps1",
    "scripts/install-claude.mjs",
    "codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs",
    "codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs",
    "codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs"
  ];

  for (const relative of requiredScripts) {
    assert.equal(fs.existsSync(path.join(root, relative)), true, `missing command target ${relative}`);
    const windowsForm = relative.replaceAll("/", "\\");
    assert.ok(
      japaneseReadme.includes(relative) || japaneseReadme.includes(windowsForm),
      `README.md does not demonstrate ${relative}`
    );
    assert.ok(
      englishReadme.includes(relative) || englishReadme.includes(windowsForm),
      `README.en.md does not demonstrate ${relative}`
    );
  }
});

test("architecture guide maintains an explicit bilingual glossary and target support boundary", () => {
  assertContainsAll(architecture, [
    "## Bilingual glossary / 日英用語対応表",
    "| English | 日本語 | Meaning / 意味 |",
    "standalone assessment",
    "単独評価台帳",
    "run-backed audit",
    "監査実行記録を使う監査",
    "screening observation",
    "スクリーニング観測",
    "profile requirement",
    "プロファイル条項",
    "claim tier",
    "主張可能範囲",
    "## Target support matrix / 対象別の対応状況"
  ], "docs/architecture-and-glossary.md");
});
