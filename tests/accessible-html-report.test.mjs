import assert from "node:assert/strict";
import test from "node:test";
import { renderAccessibleHtmlReport } from "../codex/skills/information-accessibility-practice/scripts/lib/accessible-html-report.mjs";

const model = {
  title: "Checkout accessibility report",
  target: {
    name: "<img src=x onerror=alert(1)>",
    version_or_commit: "v2",
    urls_or_files: ["https://example.invalid/checkout", "javascript:alert(1)"]
  },
  profile: { id: "web-modern", display_name: "WCAG 2.2 A/AA" },
  overall_outcome: "fail",
  evidence_level: "E2",
  checks: [
    { requirement_id: "WCAG-2.2-SC-2.4.7", outcome: "fail", rationale: "The focus indicator is not visible." },
    { requirement_id: "WCAG-2.2-SC-1.1.1", outcome: "cant_tell", rationale: "Chart equivalence requires review." }
  ],
  findings: [{ id: "FINDING-1", priority: "P1", location: "Continue button", issue: "No visible focus", remediation: "Add an outline" }],
  limitations: ["Screen reader output was not reviewed."]
};

test("Japanese HTML uses semantic regions, headings, accessible tables, and visible outcome text", () => {
  const html = renderAccessibleHtmlReport(model, { locale: "ja" });
  assert.match(html, /^<!doctype html>/u);
  assert.match(html, /<html lang="ja">/u);
  assert.match(html, /class="skip-link" href="#main">本文へ移動/u);
  assert.match(html, /<nav aria-label="レポート内目次">/u);
  assert.match(html, /<main id="main" tabindex="-1">/u);
  assert.match(html, /<section id="checks" aria-labelledby="checks-heading">/u);
  assert.match(html, /<caption>達成基準別の判定<\/caption>/u);
  assert.match(html, /<th scope="col">判定<\/th>/u);
  assert.match(html, /<th scope="row">WCAG-2\.2-SC-2\.4\.7<\/th>/u);
  assert.match(html, />不適合<\/span>/u);
  assert.match(html, />要確認<\/span>/u);
});

test("user-controlled strings are escaped and unsafe URLs are not emitted as links", () => {
  const html = renderAccessibleHtmlReport(model, { locale: "ja" });
  assert.doesNotMatch(html, /<img src=x/u);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.doesNotMatch(html, /href="javascript:/u);
  assert.match(html, /<li>javascript:alert\(1\)<\/li>/u);
  assert.doesNotMatch(html, /<script/u);
});

test("English output has an explicit document language and text labels", () => {
  const html = renderAccessibleHtmlReport({ ...model, overall_outcome: "cant_tell" }, { locale: "en" });
  assert.match(html, /<html lang="en">/u);
  assert.match(html, /Skip to main content/u);
  assert.match(html, />Cannot tell<\/span>/u);
  assert.match(html, /This is not a conformance claim/u);
});

test("unsupported locales fail closed", () => {
  assert.throws(() => renderAccessibleHtmlReport(model, { locale: "fr" }), /locale must be ja or en/u);
});
