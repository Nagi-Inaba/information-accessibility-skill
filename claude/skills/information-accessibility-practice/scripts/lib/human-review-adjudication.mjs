const humanOutcomes = new Set(["pass", "fail", "not_applicable", "cant_tell"]);

function compareText(left, right) {
  return String(left).localeCompare(String(right), "en");
}

function validateReviews(reviews) {
  if (!Array.isArray(reviews)) throw new Error("reviews must be an array");
  const reviewIds = new Set();
  const reviewerRequirement = new Set();
  for (const review of reviews) {
    if (typeof review?.review_id !== "string" || !review.review_id) throw new Error("Each review requires review_id");
    if (reviewIds.has(review.review_id)) throw new Error(`Duplicate review_id: ${review.review_id}`);
    reviewIds.add(review.review_id);
    if (typeof review.requirement_id !== "string" || !review.requirement_id) throw new Error(`${review.review_id} requires requirement_id`);
    if (typeof review.reviewer_id !== "string" || !review.reviewer_id) throw new Error(`${review.review_id} requires reviewer_id`);
    if (!humanOutcomes.has(review.outcome)) throw new Error(`${review.review_id} has an invalid human outcome`);
    if (typeof review.rationale !== "string" || !review.rationale.trim()) throw new Error(`${review.review_id} requires rationale`);
    const reviewerKey = `${review.requirement_id}\u0000${review.reviewer_id}`;
    if (reviewerRequirement.has(reviewerKey)) throw new Error(`Reviewer ${review.reviewer_id} submitted multiple active reviews for ${review.requirement_id}`);
    reviewerRequirement.add(reviewerKey);
  }
}

function activeAdjudication(requirementId, reviewIds, adjudications) {
  const relevant = adjudications.filter((item) => item?.requirement_id === requirementId);
  if (!relevant.length) return null;
  const ids = new Set();
  for (const item of relevant) {
    if (typeof item.adjudication_id !== "string" || !item.adjudication_id) throw new Error(`Adjudication for ${requirementId} requires adjudication_id`);
    if (ids.has(item.adjudication_id)) throw new Error(`Duplicate adjudication_id: ${item.adjudication_id}`);
    ids.add(item.adjudication_id);
    if (item.producer?.producer_kind !== "external_human") throw new Error(`${item.adjudication_id} must be produced by an external human`);
    if (!humanOutcomes.has(item.decision)) throw new Error(`${item.adjudication_id} has an invalid decision`);
    if (typeof item.rationale !== "string" || !item.rationale.trim()) throw new Error(`${item.adjudication_id} requires rationale`);
    const declaredReviewIds = [...new Set(item.review_ids ?? [])].sort(compareText);
    if (declaredReviewIds.length !== reviewIds.length || declaredReviewIds.some((id, index) => id !== reviewIds[index])) {
      throw new Error(`${item.adjudication_id} must reference the complete active review set for ${requirementId}`);
    }
  }
  const superseded = new Set(relevant.map((item) => item.supersedes_adjudication_id).filter(Boolean));
  const active = relevant.filter((item) => !superseded.has(item.adjudication_id));
  if (active.length !== 1) throw new Error(`${requirementId} must have exactly one active adjudication`);
  return active[0];
}

export function adjudicateHumanReviews(reviews, adjudications = []) {
  validateReviews(reviews);
  if (!Array.isArray(adjudications)) throw new Error("adjudications must be an array");
  const byRequirement = new Map();
  for (const review of reviews) {
    const current = byRequirement.get(review.requirement_id) ?? [];
    current.push(structuredClone(review));
    byRequirement.set(review.requirement_id, current);
  }

  return [...byRequirement.entries()].sort(([left], [right]) => compareText(left, right)).map(([requirementId, rows]) => {
    rows.sort((left, right) => compareText(left.review_id, right.review_id));
    const reviewIds = rows.map((row) => row.review_id);
    const outcomes = [...new Set(rows.map((row) => row.outcome))].sort(compareText);
    if (outcomes.length === 1) {
      return {
        requirement_id: requirementId,
        status: "consensus",
        outcome: outcomes[0],
        review_ids: reviewIds,
        reviewer_ids: rows.map((row) => row.reviewer_id).sort(compareText),
        adjudication_id: null,
        rationale: "All active external human reviews record the same outcome."
      };
    }
    const adjudication = activeAdjudication(requirementId, reviewIds, adjudications);
    if (!adjudication) {
      return {
        requirement_id: requirementId,
        status: "disputed",
        outcome: "cant_tell",
        review_ids: reviewIds,
        reviewer_ids: rows.map((row) => row.reviewer_id).sort(compareText),
        adjudication_id: null,
        rationale: `External human reviews disagree: ${outcomes.join(", ")}.`
      };
    }
    return {
      requirement_id: requirementId,
      status: "adjudicated",
      outcome: adjudication.decision,
      review_ids: reviewIds,
      reviewer_ids: rows.map((row) => row.reviewer_id).sort(compareText),
      adjudication_id: adjudication.adjudication_id,
      rationale: adjudication.rationale
    };
  });
}
