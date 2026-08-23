import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateJsonSchema } from "../codex/skills/information-accessibility-practice/scripts/lib/json-schema.mjs";
import {
  buildAutomatedScanContext,
  normalizeAxeResults,
  normalizeOrigin,
  profileRequirementMap,
  successCriterionFromAxeTag,
  truncateCodePoints
} from "../codex/skills/information-accessibility-practice/scripts/lib/automated-web-scan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = path.join(root, "codex/skills/information-accessibility-practice/references");
const registry = JSON.parse(fs.readFileSync(path.join(referenceRoot, "standards-registry.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(referenceRoot, "criteria-catalog.json"), "utf8"));
const scanSchema = JSON.parse(fs.readFileSync(path.join(referenceRoot, "automated-web-scan.schema.json"), "utf8"));

function node(overrides = {}) {
  return {
    targets: ["#missing-alt"],
    html: "<img id=\"missing-alt\" src=\"product.png\">",
    failure_summary: "Fix any of the following: Element does not have an alt attribute",
    ...overrides
  };
}

function axeRule(overrides = {}) {
  return {
    id: "image-alt",
    impact: "critical",
    help: "Images must have alternate text",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
    tags: ["cat.text-alternatives", "wcag2a", "wcag111"],
    nodes: [node()],
    ...overrides
  };
}

function item({ index = 0, source = "axe-core", kind = "machine_violation", nodes = 1 } = {}) {
  return {
    dedup_key: index.toString(16).padStart(64, "0"),
    kind,
    source,
    rule_id: source === "axe-core" ? `rule-${index}` : source,
    impact: "serious",
    help: "Review this item",
    help_url: null,
    tags: ["wcag111"],
    criterion_relation: "reference_only",
    profile_requirement_ids: ["WCAG-2.2-SC-1.1.1"],
    occurrence_count: nodes,
    frame: { path: "0", url: "https://example.com/" },
    nodes: Array.from({ length: nodes }, (_, nodeIndex) => ({
      targets: [`#node-${index}-${nodeIndex}`],
      html: `<div id=\"node-${index}-${nodeIndex}\"></div>`,
      html_truncated: false,
      failure_summary: "Review required",
      failure_summary_truncated: false
    }))
  };
}

function scanFixture() {
  const coverageFailure = item({ index: 1, source: "axe-frame-error", kind: "review_candidate" });
  const reflowCandidate = item({ index: 2, source: "internal-reflow-probe", kind: "review_candidate" });
  return {
    schema_version: "1.0.0",
    kind: "automated-web-scan",
    scan_status: "complete",
    captured_at: "2026-08-23T00:00:00.000Z",
    profile: { id: "web-modern", registry_version: "1.0.0" },
    target: {
      requested_url: "https://example.com/?secret=withheld",
      final_url: "https://example.com/#content",
      http_status: 200,
      dom_sha256: "a".repeat(64),
      ax_tree_sha256: "b".repeat(64)
    },
    environment: {
      adapter: "playwright-chromium",
      browser_version: "151.0.0",
      viewport: { width: 1280, height: 800 },
      scanner: { name: "axe-core", version: "4.13.0" }
    },
    frame_coverage: {
      coverage_status: "partial",
      attempted: 2,
      succeeded: 1,
      failed: 1,
      skipped: 0,
      entries: [
        { frame_path: "0", url: "https://example.com/", status: "succeeded", reason: null },
        { frame_path: "0.1", url: "https://example.com/frame", status: "failed", reason: "sandboxed" }
      ]
    },
    policy: {
      allowed_origins: ["https://example.com"],
      blocked_request_count: 0,
      blocked_channel_count: 0,
      blocked_channels: [],
      reflow_width: 320,
      allowed_methods: ["GET", "HEAD"],
      dns_binding: "pinned_host_resolver"
    },
    summary: {
      machine_violations: 1,
      review_candidates: 2,
      unmapped_findings: 0,
      machine_pass_rules: 0,
      inapplicable_rules: 0
    },
    machine_violations: [item({ index: 3 })],
    review_candidates: [coverageFailure, reflowCandidate],
    unmapped_findings: [],
    machine_passes: [],
    inapplicable: [],
    evidence: {
      dom: "<!doctype html><title>Example</title>",
      accessibility_tree: [],
      active_element: null,
      focus_path: [],
      reflow: {
        captured_at: "2026-08-23T00:00:01.000Z",
        viewport: { width: 320, height: 800 },
        document_scroll_width: 600,
        document_client_width: 320,
        candidates: [{ selector: "main", right: 600, width: 600 }],
        profile_requirement_ids: ["WCAG-2.2-SC-1.4.10"],
        interpretation: "320 CSS-pixel proxy; review required."
      },
      blocked_requests: []
    },
    raw_result_sha256: "c".repeat(64),
    interpretation: "Automated scan results are machine observations and do not by themselves determine formal WCAG conformance."
  };
}

test("axe WCAG tags map to dotted success criteria", () => {
  assert.equal(successCriterionFromAxeTag("wcag111"), "1.1.1");
  assert.equal(successCriterionFromAxeTag("wcag412"), "4.1.2");
  assert.equal(successCriterionFromAxeTag("wcag1410"), "1.4.10");
  assert.equal(successCriterionFromAxeTag("wcag2a"), null);
  assert.equal(successCriterionFromAxeTag("best-practice"), null);
});

test("active profile mapping resolves exact registered requirement ids", () => {
  const web = profileRequirementMap("web-modern", registry, catalog);
  assert.deepEqual(web.get("1.1.1"), ["WCAG-2.2-SC-1.1.1"]);
  const jp = profileRequirementMap("jp-public-web", registry, catalog);
  assert.ok(jp.get("1.1.1").includes("JIS-X-8341-3-2016-SC-1.1.1"));
  assert.throws(() => profileRequirementMap("participation-practice", registry, catalog), /unknown or inactive/u);
});

test("normalization keeps rule results separate from profile outcomes", () => {
  const profileMap = new Map([["1.1.1", ["WCAG-2.2-SC-1.1.1"]]]);
  const normalized = normalizeAxeResults({
    axeResults: { violations: [axeRule()], incomplete: [], passes: [axeRule({ id: "document-title", tags: ["wcag242"], nodes: [] })], inapplicable: [] },
    profileMap,
    frame: { url: "https://example.com/", path: "0" },
    engine: { name: "axe-core", version: "4.13.0" }
  });
  assert.equal(normalized.machine_violations[0].criterion_relation, "reference_only");
  assert.deepEqual(normalized.machine_violations[0].profile_requirement_ids, ["WCAG-2.2-SC-1.1.1"]);
  assert.equal(Object.hasOwn(normalized.machine_violations[0], "profile_outcome"), false);
  assert.equal(Object.hasOwn(normalized.machine_passes[0], "profile_outcome"), false);
});

test("best-practice rules remain unmapped and cannot carry profile ids", () => {
  const profileMap = new Map([["1.1.1", ["WCAG-2.2-SC-1.1.1"]]]);
  const normalized = normalizeAxeResults({
    axeResults: { violations: [axeRule({ id: "region", tags: ["best-practice"] })], incomplete: [], passes: [], inapplicable: [] },
    profileMap,
    frame: { url: "https://example.com/", path: "0" },
    engine: { name: "axe-core", version: "4.13.0" }
  });
  assert.equal(normalized.machine_violations.length, 0);
  assert.equal(normalized.unmapped_findings[0].kind, "unmapped_finding");
  assert.deepEqual(normalized.unmapped_findings[0].profile_requirement_ids, []);
});

test("dedup identity tolerates numeric nth-child drift and counts occurrences", () => {
  const profileMap = new Map([["1.1.1", ["WCAG-2.2-SC-1.1.1"]]]);
  const fixture = {
    violations: [axeRule({ nodes: [node({ target: ["main > img:nth-child(2)"] }), node({ target: ["main > img:nth-child(7)"] })] })],
    incomplete: [],
    passes: [],
    inapplicable: []
  };
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
  assert.ok(invalidErrors.some((error) => error.includes("profile_outcome")), invalidErrors.join("\n"));
});

test("compact context preserves coverage and reflow signals before bulk violations", () => {
  const scan = scanFixture();
  scan.machine_violations = Array.from({ length: 120 }, (_, index) => item({ index, nodes: index === 0 ? 25 : 1 }));
  scan.summary.machine_violations = scan.machine_violations.length;
  const context = buildAutomatedScanContext(scan, "e".repeat(64));
  assert.equal(context.items[0].source, "axe-frame-error");
  assert.equal(context.items[1].source, "internal-reflow-probe");
  assert.equal(context.frame_coverage.failed, 1);
  assert.equal(context.reflow_summary.viewport.width, 320);
  assert.equal(context.items.length, 100);
  assert.equal(context.items.some((entry) => entry.nodes_truncated === true), true);
  assert.equal(context.truncation.truncated, true);
  assert.ok(context.truncation.omitted_items > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(context), "utf8") <= 512 * 1024);
  assert.equal(JSON.stringify(context).includes("accessibility_tree"), false);
  assert.equal(JSON.stringify(context).includes("<!doctype"), false);
});
