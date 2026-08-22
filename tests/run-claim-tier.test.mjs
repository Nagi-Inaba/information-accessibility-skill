import assert from "node:assert/strict";
import test from "node:test";
import { deriveRunClaim } from "../codex/skills/information-accessibility-practice/scripts/lib/run-claim-tier.mjs";

const assessment = (results) => ({ assessment: { results } });

test("external human review can reach evaluated_subset within the profile ceiling", () => {
  const claim = deriveRunClaim({
    assessment: assessment([
      { requirement_kind: "profile_requirement", requirement_id: "A", mapping_status: "human_verified", outcome: "pass", evidence: [{}] },
      { requirement_kind: "profile_requirement", requirement_id: "B", mapping_status: "unverified", outcome: "not_tested", evidence: [] }
    ]),
    profileClaimCeiling: "evaluated_subset"
  });
  assert.equal(claim.tier, "evaluated_subset");
  assert.equal(claim.coverage.human_reviewed, 1);
  assert.match(claim.wording, /Selected requirements/u);
});

test("screening-only evidence remains screened and no evidence remains reference_only", () => {
  const screened = deriveRunClaim({
    assessment: assessment([{ requirement_kind: "screening_check", outcome: "cant_tell", evidence: [{}] }]),
    profileClaimCeiling: "evaluated_subset"
  });
  assert.equal(screened.tier, "screened");
  const reference = deriveRunClaim({ assessment: assessment([]), profileClaimCeiling: "evaluated_subset" });
  assert.equal(reference.tier, "reference_only");
});

test("a profile ceiling always caps stronger candidate tiers", () => {
  const claim = deriveRunClaim({
    assessment: assessment([
      { requirement_kind: "profile_requirement", mapping_status: "human_verified", outcome: "pass", evidence: [{}] },
      { requirement_kind: "profile_requirement", mapping_status: "human_verified", outcome: "not_applicable", evidence: [{}] }
    ]),
    profileClaimCeiling: "evaluated_subset"
  });
  assert.equal(claim.candidate_tier, "evaluated_complete");
  assert.equal(claim.tier, "evaluated_subset");
});
