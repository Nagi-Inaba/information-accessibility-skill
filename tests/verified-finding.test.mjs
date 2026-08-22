import assert from "node:assert/strict";
import test from "node:test";
import { attachRemediation, findingFromHumanFailure } from "../codex/skills/information-accessibility-practice/scripts/lib/verified-finding.mjs";

const review = {
  review_id: "REVIEW-1",
  reviewer_id: "reviewer@example.invalid",
  requirement_id: "WCAG-2.2-SC-2.4.7",
  mapping_status: "human_verified",
  outcome: "fail",
  rationale: "The focused Continue button has no visible focus indicator.",
  location: "Checkout > Continue",
  affected_users: ["keyboard users", "low-vision users"],
  evidence: [{ type: "keyboard_test", location: "Checkout > Continue", observation: "No visible focus indicator.", captured_at: "2026-08-22T00:00:00Z" }],
  reviewed_at: "2026-08-22T00:00:00Z"
};

test("a human-verified failure remains a finding even when no remediation plan exists", () => {
  const finding = findingFromHumanFailure(review, { findingId: "FINDING-1" });
  assert.equal(finding.verification_status, "verified_failure");
  assert.equal(finding.remediation_status, "not_planned");
  assert.equal(finding.remediation, null);
  assert.deepEqual(finding.requirement_ids, ["WCAG-2.2-SC-2.4.7"]);
  assert.equal(finding.review_provenance.review_id, "REVIEW-1");
});

test("a later remediation plan attaches without changing the verified evidence", () => {
  const finding = findingFromHumanFailure(review, { findingId: "FINDING-1" });
  const planned = attachRemediation(finding, {
    finding_id: "FINDING-1",
    proposed_change: "Add a visible outline that meets non-text contrast requirements.",
    verification: "Repeat the keyboard path and inspect the indicator in each focused state.",
    priority: "P1",
    owner: "Checkout team",
    plan_artifact_id: "ART-REMEDIATION-1"
  });
  assert.equal(planned.remediation_status, "planned");
  assert.equal(planned.remediation.owner, "Checkout team");
  assert.deepEqual(planned.evidence, finding.evidence);
  assert.equal(finding.remediation, null);
});

test("screening candidates and pass rows cannot become verified findings", () => {
  assert.throws(() => findingFromHumanFailure({ ...review, mapping_status: "unverified" }), /human-verified fail/u);
  assert.throws(() => findingFromHumanFailure({ ...review, outcome: "pass" }), /human-verified fail/u);
  assert.throws(() => findingFromHumanFailure({ ...review, evidence: [] }), /target-specific evidence/u);
});
