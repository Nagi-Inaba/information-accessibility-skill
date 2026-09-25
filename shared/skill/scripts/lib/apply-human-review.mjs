import { validateAssessment } from "../validate-assessment.mjs";
import { humanReviewContext, verifyHumanReviewRecord } from "./human-review-provenance.mjs";
import { declaredReviewMethod, reviewRecordSha256 } from "./assessment-provenance.mjs";
import { buildRunFindings } from "./run-findings.mjs";
import { reviewEntries, resolveHumanReviews } from "./human-review-consensus.mjs";

export function applyStandaloneHumanReview({ assessment, reviewRecord, resources, trust, claimTier = "reference_only" }) {
  if (assessment.schema_version !== "2.0.0") throw new Error("Legacy assessments remain read-only; generate a current assessment before applying a portable review.");
  if (reviewRecord.context.origin.kind !== "standalone") throw new Error("Use the run-backed merge command for a registered run review.");
  const validate = (candidate) => {
    const validation = validateAssessment(candidate, resources.standardsRegistry, resources.assessmentSchema, resources.criteriaCatalog, resources.auditMethods, { trust });
    if (!validation.valid) throw new Error(`Assessment verification failed: ${validation.errors.join("; ")}`);
    return validation;
  };
  validate(assessment);
  if (!["E0", "E1", "E2"].includes(assessment.assessment.evidence_level)) throw new Error("Applying partial reviews supports E0/E1 baselines and existing E2 assessments only.");
  if (!["reference_only", "screened", "evaluated_subset"].includes(claimTier)) throw new Error("Unsupported review claim tier.");
  verifyHumanReviewRecord({ record: reviewRecord,
    expectedContext: humanReviewContext({ assessmentId: assessment.assessment.assessment_id, assessment: assessment.assessment }), trust });
  const merged = structuredClone(assessment);
  const modern = reviewRecord.review.schema_version === "3.0.0" || merged.assessment.human_review_records.some((item) => item.review.schema_version === "3.0.0");
  const resolve = (records) => resolveHumanReviews(reviewEntries(records.map((item) => ({ payload: item.review, reviewer_id: item.reviewer_id, record_sha256: reviewRecordSha256(item) }))));
  const priorReviews = resolve(assessment.assessment.human_review_records);
  const hash = reviewRecordSha256(reviewRecord);
  for (const review of reviewRecord.review.reviews) {
    const row = merged.assessment.results.find((item) => item.requirement_kind === "profile_requirement" && item.requirement_id === review.requirement_id);
    if (!row || (!(modern && row.mapping_status === "human_declared") && (row.mapping_status !== "unverified" || row.outcome !== "not_tested" || row.evidence.length))) throw new Error(`Cannot replace an existing result or invent a profile row: ${review.requirement_id}`);
    Object.assign(row, { mapping_status: "human_declared", review_record_sha256: hash, outcome: review.profile_outcome,
      method_kind: "manual", method: declaredReviewMethod(review), evidence: structuredClone(review.target_specific_evidence), notes: review.rationale });
  }
  merged.assessment.human_review_records.push(structuredClone(reviewRecord));
  const resolved = resolve(merged.assessment.human_review_records);
  if (modern) for (const group of resolved.groups.values()) {
    const row = merged.assessment.results.find((item) => item.requirement_id === group.requirement_id), review = group.review;
    delete row.review_record_sha256;
    Object.assign(row, { review_resolution: group.resolution, outcome: review.profile_outcome, method_kind: "manual",
      method: declaredReviewMethod(review), evidence: structuredClone(review.target_specific_evidence), notes: review.rationale });
  }
  const priorReviewFindingIds = new Set(buildRunFindings(priorReviews.findingReviews, []).map((finding) => finding.id));
  const otherFindings = (merged.assessment.findings ?? []).filter((finding) => !priorReviewFindingIds.has(finding.id));
  const reviewFindings = buildRunFindings(resolved.findingReviews, []);
  if (otherFindings.some((finding) => reviewFindings.some((reviewFinding) => reviewFinding.id === finding.id))) throw new Error("Human finding ID conflicts with an existing assessment finding.");
  merged.assessment.findings = [...otherFindings, ...reviewFindings];
  merged.assessment.evidence_level = "E2";
  merged.assessment.evaluator = [...new Set(merged.assessment.human_review_records.map((item) => item.review.reviewer_name))].sort().join(", ");
  merged.assessment.evaluated_at = merged.assessment.human_review_records.map((item) => item.review.review_date).sort().at(-1);
  merged.assessment.claim = { requested_tier: claimTier, proposed_wording: resources.standardsRegistry.claim_templates[claimTier][0] };
  validate(merged);
  return merged;
}
