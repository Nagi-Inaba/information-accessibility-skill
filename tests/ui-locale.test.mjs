import assert from "node:assert/strict";
import test from "node:test";
import { localizeOutcome, normalizeLocale, translate } from "../codex/skills/information-accessibility-practice/scripts/lib/ui-locale.mjs";

test("regional locales normalize to supported language tags", () => {
  assert.equal(normalizeLocale("ja-JP"), "ja");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.throws(() => normalizeLocale("fr"), /Supported locales/u);
});

test("outcomes and evidence sources are localized without changing IDs", () => {
  assert.equal(localizeOutcome("not_tested", "ja"), "未確認");
  assert.equal(localizeOutcome("not_tested", "en"), "Not tested");
  assert.equal(translate("evidence.ai_screening", "ja"), "AIスクリーニング");
  assert.equal(translate("evidence.ai_screening", "en"), "AI screening");
  assert.equal(localizeOutcome("custom_enum", "ja"), "custom_enum");
});

test("translation interpolation is deterministic and missing keys fail closed", () => {
  assert.equal(translate("coverage", "en", { recorded: 4, expected: 55 }), "Coverage: 4/55");
  assert.equal(translate("coverage", "ja", { recorded: 4, expected: 55 }), "記録範囲: 4/55");
  assert.throws(() => translate("missing.key", "en"), /Unknown locale key/u);
});
