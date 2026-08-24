import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
}

test("doctor accepts ja/en locale and localizes text without changing diagnostic enums", () => {
  const japaneseText = run(["doctor", "--locale", "ja"]);
  assert.equal(japaneseText.status, 0, japaneseText.stderr || japaneseText.stdout);
  assert.match(japaneseText.stdout, /^情報アクセシビリティ監査Doctor: (?:PASS|WARN)$/mu);
  assert.match(japaneseText.stdout, /^利用可能なプロファイル:/mu);
  assert.match(japaneseText.stdout, /^スクリーンリーダーruntime: 外部機能$/mu);
  assert.doesNotMatch(japaneseText.stdout, /^Information Accessibility Audit Doctor:|^Active profiles:/mu);

  const englishText = run(["doctor", "--locale", "en"]);
  assert.equal(englishText.status, 0, englishText.stderr || englishText.stdout);
  assert.match(englishText.stdout, /^Information Accessibility Audit Doctor: (?:PASS|WARN)$/mu);
  assert.match(englishText.stdout, /^Active profiles:/mu);

  const japaneseJson = run(["doctor", "--locale", "ja", "--format", "json"]);
  const englishJson = run(["doctor", "--locale", "en", "--format", "json"]);
  assert.equal(japaneseJson.status, 0, japaneseJson.stderr || japaneseJson.stdout);
  assert.equal(englishJson.status, 0, englishJson.stderr || englishJson.stdout);
  const ja = JSON.parse(japaneseJson.stdout);
  const en = JSON.parse(englishJson.stdout);
  assert.equal(ja.locale, "ja");
  assert.equal(en.locale, "en");
  assert.equal(ja.status, en.status);
  assert.deepEqual(ja.registry.active_profiles, en.registry.active_profiles);
  assert.equal(ja.mutation_available, en.mutation_available);
});
