const tiers = Object.freeze(["reference_only", "screened", "evaluated_subset", "evaluated_complete", "conformance_candidate", "human_signoff_required"]);

function capTier(candidate, ceiling) {
  const candidateIndex = tiers.indexOf(candidate);
  const ceilingIndex = tiers.indexOf(ceiling);
  if (candidateIndex < 0) throw new Error(`Unknown candidate tier: ${candidate}`);
  if (ceilingIndex < 0) throw new Error(`Unknown claim ceiling: ${ceiling}`);
  return tiers[Math.min(candidateIndex, ceilingIndex)];
}

export function deriveRunClaim({ assessment, profileClaimCeiling = "evaluated_subset", claimTemplates = {} }) {
  const results = assessment?.assessment?.results;
  if (!Array.isArray(results)) throw new Error("assessment.assessment.results must be an array");
  const profileRows = results.filter((result) => result.requirement_kind === "profile_requirement");
  const humanReviewed = profileRows.filter((result) => result.mapping_status === "human_verified" && result.outcome !== "not_tested");
  const screeningRows = results.filter((result) => result.requirement_kind === "screening_check" && (result.evidence?.length ?? 0) > 0);
  const complete = profileRows.length > 0 && profileRows.every((result) => ["pass", "fail", "not_applicable"].includes(result.outcome));

  let candidate = "reference_only";
  if (screeningRows.length) candidate = "screened";
  if (humanReviewed.length) candidate = complete ? "evaluated_complete" : "evaluated_subset";
  const tier = capTier(candidate, profileClaimCeiling);
  return {
    tier,
    candidate_tier: candidate,
    profile_claim_ceiling: profileClaimCeiling,
    wording: claimTemplates[tier] ?? {
      reference_only: "Profile-informed guidance only; the full requirement set was not reviewed.",
      screened: "Limited accessibility screening was performed; the full requirement set was not reviewed.",
      evaluated_subset: "Selected requirements were manually reviewed; the full requirement set was not reviewed."
    }[tier] ?? "Human sign-off and current profile rules are required before any stronger claim.",
    coverage: {
      profile_rows: profileRows.length,
      human_reviewed: humanReviewed.length,
      screening_rows_with_evidence: screeningRows.length,
      complete
    }
  };
}
