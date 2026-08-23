import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildAutomatedScanContext,
  normalizeAxeResults,
  normalizeOrigin,
  profileRequirementMap,
  successCriterionFromAxeTag,
  truncateCodePoints
} from "../codex/skills/information-accessibility-practice/scripts/lib/automated-web-scan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const refs = path.join(root, "codex", "skills", "information-accessibility-practice", "references");
const registry = JSON.parse(fs.readFileSync(path.join(refs, "standards-registry.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(refs, "criteria-catalog.json"), "utf8"));

function axeFixture() {
  return {
    violations: [{
      id: "image-alt",
      impact: "critical",
      help: "Images must have alternative text",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
      tags: ["cat.text-alternatives", "wcag2a", "wcag111"],
      nodes: [{ target: ["img:nth-child(3)"], html: "<img src='x.png'>", failureSummary: "Fix any of the following: Element does not have an alt attribute" }]
    }],
    incomplete: [{
      id: "color-contrast",
      impact: "serious",
      help: "Elements must meet minimum color contrast ratio thresholds",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.13/color-contrast",
      tags: ["wcag2aa", "wcag143"],
      nodes: [{ target: ["p:nth-child(9)"], html: "<p>text</p>", failureSummary: "Unable to determine contrast" }]
    }],
    passes: [{ id: "document-title", impact: null, help: "Documents must have title", helpUrl: "https://example.test/title", tags: ["wcag242"], nodes: [{ target: ["html"] }] }],
    inapplicable: [{ id: "audio-caption", impact: null, help: "Audio elements must have captions", helpUrl: "https://example.test/audio", tags: ["wcag121"], nodes: [] }]
  };
}

test("axe WCAG tags map to dotted success criteria", () => {
  assert.equal(successCriterionFromAxeTag("wcag111"), "1.1.1");
  assert.equal(successCriterionFromAxeTag("wcag412"), "4.1.2");
  assert.equal(successCriterionFromAxeTag("best-practice"), null);
});

test("active profile mapping resolves exact registered requirement ids", () => {
  const web = profileRequirementMap("web-modern", registry, catalog);
  assert.deepEqual(web.get("1.1.1"), ["WCAG-2.2-SC-1.1.1"]);
  const jp = profileRequirementMap("jp-public-web", registry, catalog);
  assert.ok(jp.get("1.1.1")?.some((id) => id.includes("JIS-X-8341-3-2016-SC-1.1.1")));
  assert.throws(() => profileRequirementMap("authoring-agent", registry, catalog), /inactive|active/iu);
});

test("normalization keeps rule results separate from profile outcomes", () => {
  const profileMap = profileRequirementMap("web-modern", registry, catalog);
  const normalized = normalizeAxeResults({
    axeResults: axeFixture(),
    profileMap,
    frame: { url: "https://example.com/app", path: "0" },
    engine: { name: "axe-core", version: "4.13.0" }
  });
  assert.equal(normalized.machine_violations.length, 1);
  assert.equal(normalized.review_candidates.length, 1);
  assert.equal(normalized.machine_passes.length, 1);
  assert.deepEqual(normalized.machine_violations[0].profile_requirement_ids, ["WCAG-2.2-SC-1.1.1"]);
  assert.equal(normalized.machine_violations[0].criterion_relation, "reference_only");
  assert.equal("profile_outcome" in normalized.machine_violations[0], false);
  assert.equal("nodes" in normalized.machine_passes[0], false);
});

test("best-practice rules remain unmapped and cannot carry profile ids", () => {
  const profileMap = profileRequirementMap("web-modern", registry, catalog);
  const fixture = axeFixture();
  fixture.violations = [{ id: "landmark-one-main", impact: "moderate", help: "Document should have one main landmark", helpUrl: "https://example.test/bp", tags: ["best-practice"], nodes: [{ target: ["body"], html: "<body>", failureSummary: "No main landmark" }] }];
  fixture.incomplete = [];
  const normalized = normalizeAxeResults({ axeResults: fixture, profileMap, frame: { url: "https://example.com/", path: "0" }, engine: { name: "axe-core", version: "4.13.0" } });
  assert.equal(normalized.machine_violations.length, 0);
  assert.equal(normalized.unmapped_findings.length, 1);
  assert.deepEqual(normalized.unmapped_findings[0].profile_requirement_ids, []);
});

test("dedup identity tolerates numeric nth-child drift and counts occurrences", () => {
  const profileMap = profileRequirementMap("web-modern", registry, catalog);
  const fixture = axeFixture();
  fixture.violations[0].nodes.push({ target: ["img:nth-child(7)"], html: "<img src='y.png'>", failureSummary: fixture.violations[0].nodes[0].failureSummary });
  fixture.incomplete = [];
  const normalized = normalizeAxeResults({ axeResults: fixture, profileMap, frame: { url: "https://example.com/", path: "0" }, engine: { name: "axe-core", version: "4.13.0" } });
  assert.equal(normalized.machine_violations[0].occurrence_count, 2);
});

test("Unicode truncation does not split surrogate pairs", () => {
  const result = truncateCodePoints("a😀b😀c", 4);
  assert.equal(result.value, "a😀b😀");
  assert.equal(result.truncated, true);
});

test("origin normalization rejects credentials, query, fragments, wildcard, and trailing-dot hosts", () => {
  assert.equal(normalizeOrigin("https://例え.テスト:443"), "https://xn--r8jz45g.xn--zckzah");
  for (const value of ["https://user:pass@example.com", "https://example.com/?x=1", "https://example.com/#x", "https://*.example.com", "https://example.com./"]) {
    assert.throws(() => normalizeOrigin(value));
  }
});

test("compact context excludes raw evidence and preserves coverage and truncation signals", () => {
  const scan = {
    schema_version: "1.0.0",
    kind: "automated-web-scan",
    scan_status: "complete",
    captured_at: "2026-08-23T00:00:00Z",
    profile: { id: "web-modern", registry_version: registry.schema_version },
    target: { requested_url: "https://example.com/?secret=x", final_url: "https://example.com/app#state", http_status: 200, dom_sha256: "a".repeat(64), ax_tree_sha256: "b".repeat(64) },
    environment: { adapter: "playwright-chromium", browser_version: "test", viewport: { width: 1280, height: 800 }, scanner: { name: "axe-core", version: "4.13.0" } },
    frame_coverage: { attempted: 1, succeeded: 0, failed: 1, skipped: 0, entries: [{ frame_path: "0", url: "https://example.com/", status: "failed", reason: "CSP" }] },
    summary: { machine_violations: 0, review_candidates: 1, unmapped_findings: 0, machine_pass_rules: 0, inapplicable_rules: 0 },
    machine_violations: [],
    review_candidates: [{ dedup_key: "c".repeat(64), kind: "review_candidate", source: "axe-frame-error", rule_id: "frame-scan", impact: null, help: "Frame could not be scanned", help_url: null, tags: [], criterion_relation: "reference_only", profile_requirement_ids: [], occurrence_count: 1, nodes: [] }],
    unmapped_findings: [], machine_passes: [], inapplicable: [],
    evidence: { dom: "SECRET DOM", accessibility_tree: [{ name: "secret" }], active_element: null, focus_path: [], reflow: { captured_at: "2026-08-23T00:00:01Z", viewport: { width: 320, height: 800 }, document_scroll_width: 320, document_client_width: 320, candidates: [] }, blocked_requests: [] },
    raw_result_sha256: "d".repeat(64),
    interpretation: "Automated scan results are machine observations and do not by themselves determine formal WCAG conformance."
  };
  const context = buildAutomatedScanContext(scan, "e".repeat(64));
  assert.equal(context.stability, "experimental");
  assert.equal(context.frame_coverage.failed, 1);
  assert.equal(JSON.stringify(context).includes("SECRET DOM"), false);
  assert.equal(context.target.requested_url, "https://example.com/");
  assert.equal(context.target.final_url, "https://example.com/app");
  assert.ok(Buffer.byteLength(JSON.stringify(context), "utf8") <= 512 * 1024);
  assert.equal(typeof context.truncation.truncated, "boolean");
});
