import assert from "node:assert/strict";
import test from "node:test";
import { adjudicateHumanReviews } from "../codex/skills/information-accessibility-practice/scripts/lib/human-review-adjudication.mjs";

const review = (id, reviewer, outcome) => ({
  review_id: id,
  requirement_id: "WCAG-2.2-SC-2.1.1",
  reviewer_id: reviewer,
  outcome,
  rationale: `${reviewer} recorded ${outcome}.`
});

test("matching external human outcomes produce explicit consensus", () => {
  const [result] = adjudicateHumanReviews([review("R1", "alice", "pass"), review("R2", "bob", "pass")]);
  assert.equal(result.status, "consensus");
  assert.equal(result.outcome, "pass");
  assert.deepEqual(result.review_ids, ["R1", "R2"]);
});

test("disagreement stays cant_tell until an external human adjudicates it", () => {
  const reviews = [review("R1", "alice", "pass"), review("R2", "bob", "fail")];
  const [disputed] = adjudicateHumanReviews(reviews);
  assert.equal(disputed.status, "disputed");
  assert.equal(disputed.outcome, "cant_tell");

  const [resolved] = adjudicateHumanReviews(reviews, [{
    adjudication_id: "ADJ-1",
    requirement_id: "WCAG-2.2-SC-2.1.1",
    producer: { producer_kind: "external_human" },
    decision: "fail",
    rationale: "The keyboard path was reproduced in the declared environment.",
    review_ids: ["R2", "R1"]
  }]);
  assert.equal(resolved.status, "adjudicated");
  assert.equal(resolved.outcome, "fail");
  assert.equal(resolved.adjudication_id, "ADJ-1");
});

test("AI adjudication and incomplete review sets fail closed", () => {
  const reviews = [review("R1", "alice", "pass"), review("R2", "bob", "fail")];
  assert.throws(() => adjudicateHumanReviews(reviews, [{
    adjudication_id: "ADJ-AI",
    requirement_id: "WCAG-2.2-SC-2.1.1",
    producer: { producer_kind: "ai_agent" },
    decision: "fail",
    rationale: "Model decision",
    review_ids: ["R1", "R2"]
  }]), /external human/u);
  assert.throws(() => adjudicateHumanReviews(reviews, [{
    adjudication_id: "ADJ-PARTIAL",
    requirement_id: "WCAG-2.2-SC-2.1.1",
    producer: { producer_kind: "external_human" },
    decision: "fail",
    rationale: "Only one record was considered.",
    review_ids: ["R1"]
  }]), /complete active review set/u);
});

test("one reviewer cannot submit multiple active rows for the same requirement", () => {
  assert.throws(() => adjudicateHumanReviews([review("R1", "alice", "pass"), review("R2", "alice", "fail")]), /multiple active reviews/u);
});
