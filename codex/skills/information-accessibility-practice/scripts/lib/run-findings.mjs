// Both merge and report validation use this projection of registered evidence.
// Reviewers own the finding; planners may add a remedy without rewriting it.
export function findingPlanMetadata(finding, remediationItems) {
  const plans = remediationItems.filter((item) => item.basis === "verified_failure" && finding.requirement_ids.includes(item.requirement_id))
    .sort((a, b) => a.remediation_id.localeCompare(b.remediation_id, "en"));
  const values = (key) => [...new Set(plans.map((item) => item[key]).filter(Boolean))].join("\n") || null;
  return { owner: values("owner"), residual_limitation: values("residual_limitation") };
}

export function buildRunFindings(humanReviews, remediationItems) {
  const verified = remediationItems.filter((item) => item.basis === "verified_failure")
    .sort((a, b) => a.remediation_id.localeCompare(b.remediation_id, "en"));
  const findings = [];
  for (const review of humanReviews) {
    if (review.profile_outcome !== "fail") continue;
    const plans = verified.filter((item) => item.requirement_id === review.requirement_id);
    if (review.finding) {
      findings.push({
        ...structuredClone(review.finding),
        requirement_ids: [review.requirement_id],
        remediation_status: plans.length ? "planned" : "unplanned",
        remediation: plans.length ? plans.map((item) => item.proposed_change).join("\n") : null,
        verification: plans.length ? plans.map((item) => item.verification).join("\n") : null
      });
    } else {
      if (!plans.length) throw new Error(`Human fail requires finding details or a matching verified_failure remediation item: ${review.requirement_id}.`);
      // Preserve the older finding+remediation representation exactly.
      findings.push(...plans.map((item) => ({
        id: item.remediation_id,
        priority: item.priority,
        requirement_ids: [item.requirement_id],
        location: item.location,
        affected_users: structuredClone(item.affected_users),
        observation: item.issue,
        remediation: item.proposed_change,
        verification: item.verification
      })));
    }
  }
  if (new Set(findings.map((item) => item.id)).size !== findings.length) {
    throw new Error("Duplicate finding ID in declared human findings or verified remediation evidence.");
  }
  return findings.sort((a, b) => a.id.localeCompare(b.id, "en"));
}
