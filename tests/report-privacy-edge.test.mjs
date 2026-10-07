import assert from "node:assert/strict";
import test from "node:test";

import { applyReportVisibility } from "../codex/skills/information-accessibility-practice/scripts/lib/report-privacy.mjs";

function presentation() {
  return {
    locale: "en",
    target: {
      name: "Public fixture",
      version_or_commit: "2026 edition",
      urls_or_files: ["http://["]
    },
    evaluator: "Alice <alice@example.com>",
    scope: {
      included: ["Audio/subtitles on Windows/macOS; raw file C:\\Users\\Alice\\evidence.json"],
      excluded: [],
      complete_processes: [],
      third_party_content: [],
      full_pages_reviewed: false
    },
    environment: {
      os: ["Windows/macOS"],
      browsers: [],
      assistive_technologies: [],
      input_modes: []
    },
    rows: [{
      requirement_id: "WCAG-2.2-SC-1.1.1",
      success_criterion: "1.1.1",
      title: "Non-text Content",
      level: "A",
      group_id: "wcag_2_2",
      group_label: "WCAG 2.2 A/AA",
      primary_url: "https://www.w3.org/TR/WCAG22/#non-text-content",
      outcome: "not_tested",
      source_kind: "not_run",
      evidence_level: "E0",
      rationale: "Call +81 90-1234-5678. JIS/WCAG review remains pending."
    }],
    findings: [],
    limitations: ["Authorization: Bearer EDGE-SECRET-1234567890."],
    claim: {
      requested_tier: "reference_only",
      maximum_tier: "reference_only",
      wording: "Profile-informed guidance only.",
      reasons: []
    }
  };
}

test("public visibility rejects malformed URLs without recursion and preserves ordinary slash prose", () => {
  const { presentation: sanitized, manifest } = applyReportVisibility(presentation(), {
    visibility: "public",
    reviewerDisclosure: "redact"
  });

  assert.equal(sanitized.target.urls_or_files[0], "[redacted]");
  assert.equal(sanitized.rows[0].primary_url, "https://www.w3.org/TR/WCAG22/");
  assert.match(sanitized.scope.included[0], /Audio\/subtitles on Windows\/macOS/u);
  assert.doesNotMatch(sanitized.scope.included[0], /C:\\Users\\Alice/u);
  assert.match(sanitized.environment.os[0], /Windows\/macOS/u);
  assert.match(sanitized.rows[0].rationale, /JIS\/WCAG/u);
  assert.doesNotMatch(sanitized.rows[0].rationale, /90-1234-5678/u);
  assert.doesNotMatch(sanitized.limitations[0], /EDGE-SECRET/u);

  assert.ok(manifest.redactions.some((entry) => entry.reason === "invalid_url_removed"));
  assert.ok(manifest.redactions.some((entry) => entry.reason === "local_path_removed"));
  assert.ok(manifest.redactions.some((entry) => entry.reason === "phone_removed"));
  assert.ok(manifest.redactions.some((entry) => entry.reason === "authorization_token_removed"));
  assert.equal(JSON.stringify(manifest).includes("EDGE-SECRET-1234567890"), false);
});

function sanitizedTargetUrl(url) {
  const candidate = presentation();
  candidate.target.urls_or_files = [url];
  return applyReportVisibility(candidate, { visibility: "public", reviewerDisclosure: "redact" });
}

test("public visibility withholds every non-public target host, including IPv6 and reserved-name forms", () => {
  // Same address space the Web network guard refuses; the URL parser rewrites mapped-IPv4 to hex groups.
  for (const url of [
    "http://10.0.0.5/", "http://192.88.99.1/", "http://[::ffff:10.0.0.5]/", "http://[::ffff:172.17.0.1]/",
    "http://[::ffff:192.168.1.1]/", "http://[::ffff:7f00:1]/", "http://[64:ff9b::a00:1]/", "http://[2002:7f00:1::]/",
    "http://[fec0::1]/", "http://[100::1]/", "http://[2001::1]/", "http://app.localhost/",
    "http://printer.localdomain/", "http://intranet.corp/"
  ]) {
    const { presentation: sanitized, manifest } = sanitizedTargetUrl(url);
    assert.equal(sanitized.target.urls_or_files[0], "[redacted]", url);
    assert.ok(manifest.redactions.some((entry) => entry.reason === "private_or_reserved_host"), url);
  }
});

test("public visibility keeps ordinary public hosts", () => {
  for (const url of ["https://example.com/", "http://8.8.8.8/", "http://[2001:4860:4860::8888]/"]) {
    const { presentation: sanitized } = sanitizedTargetUrl(url);
    assert.equal(sanitized.target.urls_or_files[0], url, url);
  }
});
