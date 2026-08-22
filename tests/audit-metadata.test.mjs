import assert from "node:assert/strict";
import test from "node:test";
import { mergeAuditMetadata } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-metadata.mjs";

const artifact = (overrides = {}) => ({
  artifact_id: "ART-META-1",
  created_at: "2026-08-22T00:00:00Z",
  producer: { role_id: "metadata_reviewer" },
  payload: {},
  ...overrides
});

test("metadata overlays preserve provenance and merge the five participation gates", () => {
  const source = artifact({
    payload: {
      participation_coverage: {
        find: { outcome: "pass", rationale: "The entry point is labelled." },
        understand: { outcome: "cant_tell", rationale: "Plain-language review is pending." }
      },
      limitations: ["Authentication state was not reviewed."],
      next_review_at: "2026-09-30",
      review_conditions: ["Retest after the next release."]
    }
  });
  const result = mergeAuditMetadata({
    base: { limitations: ["Third-party payment content was excluded."] },
    artifacts: [source]
  });
  assert.equal(result.participation_coverage.find.outcome, "pass");
  assert.equal(result.participation_coverage.understand.outcome, "cant_tell");
  assert.deepEqual(result.limitations, ["Third-party payment content was excluded.", "Authentication state was not reviewed."]);
  assert.equal(result.next_review_at, "2026-09-30");
  assert.deepEqual(result.metadata_sources[0], {
    artifact_id: "ART-META-1",
    producer_role: "metadata_reviewer",
    created_at: "2026-08-22T00:00:00Z",
    fields: ["limitations", "next_review_at", "participation_coverage", "review_conditions"]
  });
});

test("later authorized metadata deterministically supersedes the same field without mutating inputs", () => {
  const first = artifact({ payload: { next_review_at: "2026-09-30" } });
  const second = artifact({
    artifact_id: "ART-META-2",
    created_at: "2026-08-23T00:00:00Z",
    producer: { role_id: "declared_external_human" },
    payload: { next_review_at: "2026-10-15" }
  });
  const before = structuredClone([second, first]);
  const result = mergeAuditMetadata({ artifacts: [second, first] });
  assert.equal(result.next_review_at, "2026-10-15");
  assert.deepEqual([second, first], before);
});

test("AI screening roles and impossible review dates cannot set audit metadata", () => {
  assert.throws(() => mergeAuditMetadata({ artifacts: [artifact({ producer: { role_id: "e1_inspector" } })] }), /not authorized/u);
  assert.throws(() => mergeAuditMetadata({ artifacts: [artifact({ payload: { next_review_at: "2026-02-30" } })] }), /real YYYY-MM-DD/u);
});
