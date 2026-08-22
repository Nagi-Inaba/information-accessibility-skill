const priorities = new Set(["P0", "P1", "P2"]);

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

export function findingFromHumanFailure(review, { findingId } = {}) {
  if (review?.mapping_status !== "human_verified" || review?.outcome !== "fail") {
    throw new Error("Only a human-verified fail can create a verified finding");
  }
  if (!Array.isArray(review.evidence) || review.evidence.length === 0) throw new Error("A verified finding requires target-specific evidence");
  const requirementId = requiredText(review.requirement_id, "requirement_id");
  const id = findingId ?? review.finding_id ?? `FINDING-${requirementId}`;
  return {
    id,
    verification_status: "verified_failure",
    requirement_ids: [requirementId],
    priority: priorities.has(review.priority) ? review.priority : "P2",
    location: requiredText(review.location ?? review.evidence[0]?.location, "location"),
    affected_users: [...new Set(review.affected_users ?? [])].sort(),
    observation: requiredText(review.observation ?? review.rationale ?? review.notes, "observation"),
    evidence: structuredClone(review.evidence),
    review_provenance: {
      reviewer_id: review.reviewer_id ?? null,
      review_id: review.review_id ?? null,
      reviewed_at: review.reviewed_at ?? review.review_date ?? null
    },
    remediation_status: "not_planned",
    remediation: null
  };
}

export function attachRemediation(finding, plan) {
  if (finding?.verification_status !== "verified_failure") throw new Error("Remediation can only attach to a verified failure");
  if (plan?.finding_id !== finding.id) throw new Error("Remediation plan must reference the exact finding ID");
  const proposedChange = requiredText(plan.proposed_change, "proposed_change");
  const verification = requiredText(plan.verification, "verification");
  return {
    ...structuredClone(finding),
    priority: priorities.has(plan.priority) ? plan.priority : finding.priority,
    remediation_status: "planned",
    remediation: {
      proposed_change: proposedChange,
      verification,
      owner: plan.owner ?? null,
      residual_limitation: plan.residual_limitation ?? null,
      plan_artifact_id: plan.plan_artifact_id ?? null
    }
  };
}
