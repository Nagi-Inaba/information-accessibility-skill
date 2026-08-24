import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const japanese = fs.readFileSync(path.join(root, "README.md"), "utf8");
const english = fs.readFileSync(path.join(root, "README.en.md"), "utf8");
const formats = fs.readFileSync(path.join(root, "docs/report-formats.md"), "utf8");

test("Japanese and English READMEs expose the same supported report-format boundary", () => {
  for (const readme of [japanese, english]) {
    assert.match(readme, /docs\/report-formats\.md/u);
    assert.match(readme, /--format (?:markdown|html)|--format`[^\n]*(?:markdown|html)/iu);
    assert.match(readme, /HTML/u);
    assert.match(readme, /PDF/iu);
    assert.match(readme, /summary[^\n]*full/iu);
    assert.match(readme, /public[^\n]*internal|internal[^\n]*public/iu);
  }
  assert.match(japanese, /PDF[^\n]*(?:正式サポート|サポート対象外|未対応)/u);
  assert.match(english, /PDF[^\n]*(?:unsupported|not supported)/iu);
});

test("report-format guide documents commands, accessibility semantics, verification, and honest limitations", () => {
  for (const token of [
    "--format markdown",
    "--format html",
    "--detail summary",
    "--detail full",
    "--appendix",
    "--visibility public",
    "--visibility internal",
    "lang",
    "skip link",
    "caption",
    "scope",
    "axe-core",
    "Chromium",
    "NVDA 2026.1.1",
    "report-accessibility-e2e.yml",
    "report-nvda-smoke.yml"
  ]) assert.ok(formats.includes(token), `missing ${token}`);
  assert.match(formats, /PDF[^\n]*(?:unsupported|サポート対象外)/iu);
  assert.match(formats, /bounded smoke test|限定的なsmoke test/iu);
  assert.match(formats, /not[^\n]*(?:complete|conformance)|正式な適合[^\n]*では/u);
  assert.doesNotMatch(formats, /NVDA certified|WCAG certified|完全にアクセシブル/iu);
});
