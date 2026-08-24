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
