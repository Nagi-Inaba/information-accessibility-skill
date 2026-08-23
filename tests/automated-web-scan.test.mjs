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
import { validateJsonSchema } from "../codex/skills/information-accessibility-practice/scripts/lib/json-schema.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const refs = path.join(root, "codex", "skills", "information-accessibility-practice", "references");
const registry = JSON.parse(fs.readFileSync(path.join(refs, "standards-registry.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(refs, "criteria-catalog.json"), "utf8"));
const scanSchema = JSON.parse(fs.readFileSync(path.join(refs, "automated-web-scan.schema.json"), "utf8"));
const contextSchema = JSON.parse(fs.readFileSync(path.join(refs, "automated-web-scan-context.schema.json"), "utf8"));

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

function item({ index = 0, kind = "machine_violation", source = "axe-core", nodes = 1 } = {}) {
  return {
    dedup_key: index.toString(16).padStart(64, "0"),
    kind,
    source,
    rule_id: source === "internal-reflow-probe" ? "reflow-overflow" : source === "axe-frame-error" ? "frame-scan" : `rule-${index}`,
    impact: kind === "machine_violation" ? "critical" : null,
    help: "Review item",
    help_url: null,
    tags: [],
    criterion_relation: "reference_only",
    profile_requirement_ids: [],
    occurrence_count: Math.max(1, nodes),
    frame: { path: "0", url: "https://example.com/" },
    nodes: Array.from({ length: nodes }, (_, nodeIndex) => ({
      targets: [`#item-${index}-${nodeIndex}`],
      html: `<div id="item-${index}-${nodeIndex}"></div>`,
      html_truncated: false,
      failure_summary: "Review",
      failure_summary_truncated: false
    }))
  };
}

function scanFixture() {
  const frameError = item({ index: 500, kind: "review_candidate", source: "axe-frame-error" });
  const reflowItem = item({ index: 501, kind: "review_candidate", source: "internal-reflow-probe" });
  const reflow = {
    captured_at: "2026-08-23T00:00:01Z",
    viewport: { width: 320, height: 800 },
    document_scroll_width: 800,
    document_client_width: 320,
    candidates: [{ selector: "#wide", left: 0, right: 800, width: 800 }],
    profile_requirement_ids: ["WCAG-2.2-SC-1.4.10"]
  };
  return {
    schema_version: "1.0.0",
    kind: "automated-web-scan",
    scan_status: "complete",
    captured_at: "2026-08-23T00:00:00Z",
    profile: { id: "web-modern", registry_version: registry.schema_version },
    target: {
      requested_url: "https://example.com/?secret=x",
      final_url: "https://example.com/app#state",
      http_status: 200,
      dom_sha256: "a".repeat(64),
      ax_tree_sha256: "b".repeat(64)
    },
    environment: {
      adapter: "playwright-chromium",
      browser_version: "151.0",
      viewport: { width: 1280, height: 800 },
      rendering: { locale: "ja-JP", timezoneId: "Asia/Tokyo", deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" },
      scanner: { name: "axe-core", version: "4.13.0" },
      playwright_version: "1.62.1"
    },
    frame_coverage: {
      coverage_status: "partial",
      attempted: 2,
      succeeded: 1,
      failed: 1,
      skipped: 0,
      entries: [
        { frame_path: "0", url: "https://example.com/", status: "succeeded", reason: null },
        { frame_path: "0.1", url: "https://example.com/frame", status: "failed", reason: "CSP" }
      ]
    },
    policy: {
      allowed_origins: ["https://example.com"],
      blocked_request_count: 1,
      blocked_requests_truncated: false,
      blocked_channels: [{ kind: "websocket", url: "wss://example.com/socket", reason: "blocked_by_scan_policy" }],
      blocked_channel_count: 1,
      blocked_channels_truncated: false,
      dns_binding: "pinned_host_resolver",
      pinned_endpoints: [{ hostname: "example.com", address: "93.184.216.34" }],
      reflow_width: 320
    },
    summary: { machine_violations: 0, review_candidates: 2, unmapped_findings: 0, machine_pass_rules: 0, inapplicable_rules: 0 },
    machine_violations: [],
    review_candidates: [frameError, reflowItem],
    unmapped_findings: [],
    machine_passes: [],
    inapplicable: [],
    evidence: {
      dom: "SECRET DOM",
      accessibility_tree: [{ name: "secret" }],
      active_element: null,
      focus_path: [],
      reflow,
      blocked_requests: [{ url: "https://example.com/api", resource_type: "fetch", reason: "method_not_allowed" }]
    },
    raw_result_sha256: "d".repeat(64),
    interpretation: "Automated scan results are machine observations and do not by themselves determine formal WCAG conformance."
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

test("full scan schema rejects profile outcome fields and accepts the bounded contract", () => {
  const scan = scanFixture();
  const errors = [];
  validateJsonSchema(scan, scanSchema, "$", errors);
  assert.deepEqual(errors, []);
  scan.review_candidates[0].profile_outcome = "fail";
  const invalidErrors = [];
  validateJsonSchema(scan, scanSchema, "$", invalidErrors);
  assert.ok(invalidErrors.some((error) => error.includes("unexpected property profile_outcome")), invalidErrors.join("\n"));
});

test("compact context preserves coverage and reflow signals before bulk violations", () => {
  const scan = scanFixture();
  scan.machine_violations = Array.from({ length: 120 }, (_, index) => item({ index, nodes: index === 0 ? 25 : 1 }));
  scan.summary.machine_violations = scan.machine_violations.length;
  const context = buildAutomatedScanContext(scan, "e".repeat(64));
  assert.equal(context.items[0].source, "axe-frame-error");
  assert.equal(context.items[1].source, "internal-reflow-probe");
  assert.equal(context.frame_coverage.coverage_status, "partial");
  assert.equal(context.policy_summary.dns_binding, "pinned_host_resolver");
  assert.equal(context.truncation.truncated, true);
  assert.ok(context.truncation.omitted_items >= 22);
  assert.ok(context.truncation.omitted_nodes >= 5);
  assert.equal(JSON.stringify(context).includes("SECRET DOM"), false);
  assert.equal(context.target.requested_url, "https://example.com/");
  assert.equal(context.target.final_url, "https://example.com/app");
  assert.ok(Buffer.byteLength(JSON.stringify(context), "utf8") <= 512 * 1024);
  const errors = [];
  validateJsonSchema(context, contextSchema, "$", errors);
  assert.deepEqual(errors, []);
});
