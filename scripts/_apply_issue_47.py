from pathlib import Path

for path in [
    Path("codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs"),
    Path("claude/skills/information-accessibility-practice/scripts/validate-assessment.mjs"),
]:
    text = path.read_text(encoding="utf-8")

    helper_anchor = '''function urlEqualsCatalogSource(source, expected) {
  try {
    return new URL(source).href === new URL(expected).href;
  } catch {
    return false;
  }
}

export function validateAssessment'''
    helper = '''function urlEqualsCatalogSource(source, expected) {
  try {
    return new URL(source).href === new URL(expected).href;
  } catch {
    return false;
  }
}

export function classifyClaimBlockers({
  profileOutcomeCounts = {},
  missingRequirementIds = [],
  screeningResults = []
} = {}) {
  const profileCounts = {
    pass: profileOutcomeCounts.pass ?? 0,
    fail: profileOutcomeCounts.fail ?? 0,
    not_applicable: profileOutcomeCounts.not_applicable ?? 0,
    not_tested: (profileOutcomeCounts.not_tested ?? 0) + missingRequirementIds.length,
    cant_tell: profileOutcomeCounts.cant_tell ?? 0
  };
  const profileBlockingOutcomes = ["fail", "not_tested", "cant_tell"]
    .filter((outcome) => profileCounts[outcome] > 0);
  const screeningOpenCandidates = [...new Set(screeningResults
    .filter((result) => result?.requirement_kind === "screening_check"
      && ["fail", "not_tested", "cant_tell"].includes(result.outcome))
    .map((result) => result.requirement_id))]
    .sort((left, right) => String(left).localeCompare(String(right), "en"));
  return {
    profile_outcome_counts_for_claim: profileCounts,
    profile_blocking_outcomes: profileBlockingOutcomes,
    screening_open_candidates: screeningOpenCandidates
  };
}

export function validateAssessment'''
    if helper_anchor not in text:
        raise SystemExit(f"claim blocker helper anchor missing: {path}")
    text = text.replace(helper_anchor, helper, 1)

    old_block = '''  const blockingOutcomes = ["fail", "not_tested", "cant_tell"].filter((outcome) => outcomeCounts[outcome] > 0);
  if (blockingOutcomes.length > 0 && tierOrder.indexOf(maxTier) > tierOrder.indexOf("evaluated_subset")) {
    maxTier = "evaluated_subset";
  }'''
    new_block = '''  const expectedRequirementIdsForClaim = profile?.requirement_ids ?? [];
  const recordedRequirementIdsForClaim = results
    .filter((result) => result.requirement_kind === "profile_requirement"
      && expectedRequirementIdsForClaim.includes(result.requirement_id))
    .map((result) => result.requirement_id);
  const missingRequirementIdsForClaim = expectedRequirementIdsForClaim
    .filter((id) => !recordedRequirementIdsForClaim.includes(id));
  const claimBlockerSummary = classifyClaimBlockers({
    profileOutcomeCounts,
    missingRequirementIds: missingRequirementIdsForClaim,
    screeningResults: results
  });
  const blockingOutcomes = claimBlockerSummary.profile_blocking_outcomes;
  if (blockingOutcomes.length > 0 && tierOrder.indexOf(maxTier) > tierOrder.indexOf("evaluated_subset")) {
    maxTier = "evaluated_subset";
  }'''
    if old_block not in text:
        raise SystemExit(f"legacy blocking outcome anchor missing: {path}")
    text = text.replace(old_block, new_block, 1)

    old_coverage = '''  const expectedRequirementIds = profile?.requirement_ids ?? [];
  const recordedRequirementIds = results
    .filter((result) => result.requirement_kind === "profile_requirement" && expectedRequirementIds.includes(result.requirement_id))
    .map((result) => result.requirement_id);
  const missingRequirementIds = expectedRequirementIds.filter((id) => !recordedRequirementIds.includes(id));'''
    new_coverage = '''  const expectedRequirementIds = expectedRequirementIdsForClaim;
  const recordedRequirementIds = recordedRequirementIdsForClaim;
  const missingRequirementIds = missingRequirementIdsForClaim;'''
    if old_coverage not in text:
        raise SystemExit(f"catalog coverage anchor missing: {path}")
    text = text.replace(old_coverage, new_coverage, 1)

    guard_anchor = '''      blocking_outcomes: blockingOutcomes,
      outcome_counts: outcomeCounts,'''
    guard_replacement = '''      blocking_outcomes: blockingOutcomes,
      profile_blocking_outcomes: claimBlockerSummary.profile_blocking_outcomes,
      screening_open_candidates: claimBlockerSummary.screening_open_candidates,
      outcome_counts: outcomeCounts,'''
    if guard_anchor not in text:
        raise SystemExit(f"guard output anchor missing: {path}")
    path.write_text(text.replace(guard_anchor, guard_replacement, 1), encoding="utf-8")
