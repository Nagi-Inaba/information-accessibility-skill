import { isDeepStrictEqual } from "node:util";
import { validateAssessment } from "../validate-assessment.mjs";
import { buildRunFindings } from "./run-findings.mjs";
import { reviewEntries, resolveHumanReviews, consensusRemediationItems } from "./human-review-consensus.mjs";
import { createHumanReviewRecord, humanReviewRunContext } from "./human-review-provenance.mjs";
import { declaredReviewMethod, isHumanReviewMapping, reviewRecordSha256 } from "./assessment-provenance.mjs";
import { collectScreeningEvidence } from "./run-evidence.mjs";
import { validateContextBindings, collectContextEvidence, projectAuditContext } from "./audit-context.mjs";
import { validateParticipantBindings, collectParticipantEvidence } from "./participant-observation.mjs";
import { targetBindingErrors } from "./run-targets.mjs";
import { sha256Bytes, parseJsonBytes } from "./safe-file-io.mjs";
import { compareText } from "./text-order.mjs";
import { loadAuditResources } from "./audit-resources.mjs";
import { validateArtifact, remediationPermissionError, validateRegisteredArtifactEntries, validateArtifactEnvelopeSemantics, assertCurrentOperationalRun, validateHumanQueueBindings, validateScreeningProfileBindings, validateScreeningQueueCoverage, validateDeclaredHumanBindings, remediationItems, validateRemediationBindings, expectedMethodRef } from "./audit-artifact-validation.mjs";
import { validateHistory } from "./audit-run-validation.mjs";

function validateAssessmentOrThrow(assessment, resources, label, run) {
  const result = validateAssessment(assessment, resources.standardsRegistry, resources.assessmentSchema, resources.criteriaCatalog, resources.auditMethods,
    { run, artifactSnapshotsById: resources.artifact_snapshots_by_id, trust: resources.reviewTrust });
  if (!result.valid) throw new Error(`${label}:\n- ${result.errors.join("\n- ")}`);
  return result;
}

function assertAssessmentMergeBaseline(assessment, resources) {
  const record = assessment?.assessment;
  if (record?.human_review_records?.length) throw new Error("Merge baseline must not contain prior human review records.");
  if (record?.evidence_level !== "E0") {
    throw new Error("Merge input must be an E0 assessment baseline reconstructed only from current-run artifacts.");
  }
  if (!Array.isArray(record.findings) || record.findings.length !== 0) {
    throw new Error("Merge input E0 assessment baseline must not contain prior findings.");
  }
  for (const result of Array.isArray(record.results) ? record.results : []) {
    if (result?.requirement_kind !== "profile_requirement") {
      throw new Error("Merge input E0 assessment baseline must not contain prior screening rows.");
    }
    if (result.mapping_status !== "unverified" || result.outcome !== "not_tested") {
      throw new Error("Merge input profile rows must be unverified and not_tested before current-run artifact reconstruction.");
    }
    if (!Array.isArray(result.evidence) || result.evidence.length !== 0) {
      throw new Error("Merge input E0 assessment baseline must not contain prior evidence.");
    }
  }
  const expectedParticipationCoverage = {
    find: "not_tested",
    receive: "not_tested",
    understand: "not_tested",
    participate: "not_tested",
    continue: "not_tested"
  };
  if (!isDeepStrictEqual(record.participation_coverage, expectedParticipationCoverage)) {
    throw new Error("Merge input E0 assessment baseline participation_coverage must be entirely not_tested.");
  }
  const expectedAssurance = {
    independent_audit: {
      performed: false,
      evaluator_independent: false,
      scope_method: "",
      report_location: ""
    },
    legal_or_procurement_dossier: {
      prepared: false,
      responsible_owner: "",
      artifacts: []
    }
  };
  if (!isDeepStrictEqual(record.assurance, expectedAssurance)) {
    throw new Error("Merge input E0 assessment baseline must not claim an independent audit or legal/procurement dossier.");
  }
  const expectedClaim = {
    requested_tier: "reference_only",
    proposed_wording: resources.standardsRegistry.claim_templates.reference_only?.[0]
  };
  if (!isDeepStrictEqual(record.claim, expectedClaim)) {
    throw new Error("Merge input E0 assessment baseline claim must be the canonical reference_only registry template.");
  }
  if (record.next_review_at !== null) {
    throw new Error("Merge input E0 assessment baseline next_review_at must be null.");
  }
}

export function mergeArtifacts({ run, assessment, artifacts, registries, claimTier = "reference_only", reviewRecords = [] }) {
  const resources = registries ?? loadAuditResources();
  assertCurrentOperationalRun(run, resources, "Artifact merge");
  const permissionError = remediationPermissionError(run, artifacts);
  if (permissionError) throw new Error(permissionError);
  validateAssessmentOrThrow(assessment, resources, "Invalid input assessment");
  if (assessment.assessment.profile.id !== run.profile.id || assessment.assessment.profile.registry_version !== run.profile.registry_version) {
    throw new Error("Assessment profile does not match the audit run.");
  }
  if (!isDeepStrictEqual(assessment.assessment.target, run.target)) throw new Error("Assessment target does not match the audit run.");
  if (!isDeepStrictEqual(assessment.assessment.scope, run.scope)) throw new Error("Assessment scope does not match the audit run.");
  if (!isDeepStrictEqual(assessment.assessment.environment, run.environment)) throw new Error("Assessment environment does not match the audit run.");
  assertAssessmentMergeBaseline(assessment, resources);
  const runSemanticErrors = [];
  runSemanticErrors.push(...targetBindingErrors(run, artifacts));
  const registered = validateRegisteredArtifactEntries(run, runSemanticErrors);
  validateHistory(run, resources, registered, runSemanticErrors);
  if (runSemanticErrors.length) throw new Error(`Invalid pure merge audit-run semantics:\n- ${runSemanticErrors.join("\n- ")}`);
  const suppliedIds = new Set();
  const suppliedEnvelopesById = new Map();
  if (!(resources.artifact_snapshots_by_id instanceof Map)) {
    throw new Error("Pure merge requires registered artifact byte snapshots and fails closed without them.");
  }
  const sorted = [...artifacts].sort((left, right) => compareText(left.artifact_type, right.artifact_type) || compareText(left.artifact_id, right.artifact_id));
  for (const artifact of sorted) {
    if (suppliedIds.has(artifact.artifact_id)) throw new Error(`Duplicate supplied artifact ID: ${artifact.artifact_id}`);
    suppliedIds.add(artifact.artifact_id);
    const artifactValidation = validateArtifact(artifact, resources, {
      allowedPayloadVersions: resources.currentPayloadVersions
    });
    if (!artifactValidation.valid) throw new Error(`Invalid merge artifact ${artifact.artifact_id}:\n- ${artifactValidation.errors.join("\n- ")}`);
    const entry = registered.get(artifact.artifact_id);
    if (!entry) throw new Error(`Merge artifact is not registered in the run: ${artifact.artifact_id}`);
    if (entry.artifact_type !== artifact.artifact_type || entry.producer_role !== artifact.producer.role_id || artifact.run_id !== run.run_id) {
      throw new Error(`Merge artifact metadata does not match its registered run entry: ${artifact.artifact_id}`);
    }
    const snapshot = resources.artifact_snapshots_by_id.get(artifact.artifact_id);
    if (!snapshot || !Buffer.isBuffer(snapshot.bytes) || typeof snapshot.sha256 !== "string") {
      throw new Error(`Pure merge requires a registered byte snapshot for artifact: ${artifact.artifact_id}`);
    }
    const snapshotBytes = Buffer.from(snapshot.bytes);
    const snapshotHash = sha256Bytes(snapshotBytes);
    if (snapshotHash !== snapshot.sha256 || snapshotHash !== entry.sha256) {
      throw new Error(`Merge artifact registered byte snapshot hash mismatch: ${artifact.artifact_id}`);
    }
    const registeredEnvelope = parseJsonBytes(snapshotBytes, `registered byte snapshot ${artifact.artifact_id}`);
    if (!isDeepStrictEqual(registeredEnvelope, artifact)) {
      throw new Error(`Merge artifact does not match its registered bytes: ${artifact.artifact_id}`);
    }
    suppliedEnvelopesById.set(artifact.artifact_id, artifact);
  }
  const registeredIds = [...registered.keys()].sort(compareText);
  const suppliedRegisteredIds = [...suppliedIds].sort(compareText);
  if (!isDeepStrictEqual(suppliedRegisteredIds, registeredIds)) {
    const omitted = registeredIds.filter((id) => !suppliedIds.has(id));
    throw new Error(`Merge requires the complete registered artifact set; missing registered artifacts: ${omitted.join(", ")}`);
  }
  const bindingErrors = [];
  validateArtifactEnvelopeSemantics(run, resources, registered, suppliedEnvelopesById, bindingErrors);
  validateScreeningProfileBindings(run, suppliedEnvelopesById, resources, bindingErrors);
  validateScreeningQueueCoverage(suppliedEnvelopesById, bindingErrors);
  validateHumanQueueBindings(suppliedEnvelopesById, run.profile.id, resources, bindingErrors, run);
  validateDeclaredHumanBindings(suppliedEnvelopesById, run.profile.id, resources, bindingErrors);
  validateRemediationBindings(suppliedEnvelopesById, bindingErrors);
  validateContextBindings(suppliedEnvelopesById, bindingErrors);
  validateParticipantBindings(suppliedEnvelopesById, bindingErrors);
  if (!bindingErrors.length) {
    const reader = (relativePath) => resources.evidence_snapshots_by_path?.get(relativePath);
    bindingErrors.push(...collectScreeningEvidence(run, artifacts, reader).errors);
    bindingErrors.push(...collectContextEvidence(run, artifacts, reader).errors);
    bindingErrors.push(...collectParticipantEvidence(run, artifacts, reader).errors);
  }
  if (bindingErrors.length) throw new Error(`Invalid merge artifact binding:\n- ${bindingErrors.join("\n- ")}`);
  const merged = structuredClone(assessment);
  merged.schema_version = "2.0.0";
  merged.assessment.assessment_id = run.run_id;
  merged.assessment.human_review_records = [];
  const suppliedReviewRecords = new Map();
  for (const record of reviewRecords) {
    reviewRecordSha256(record);
    const origin = record.context.origin;
    if (origin.kind !== "audit_run" || origin.run_id !== run.run_id || suppliedReviewRecords.has(origin.artifact_id)) {
      throw new Error("Review records must uniquely identify same-run human review artifacts.");
    }
    suppliedReviewRecords.set(origin.artifact_id, record);
  }
  const existingIds = new Set(merged.assessment.results.map((item) => item.requirement_id));
  const screeningResults = [];
  const humanReviews = new Map();
  const humanSubjects = [];
  const reviewerNames = new Set();
  const reviewDates = [];
  for (const artifact of sorted) {
    if (artifact.artifact_type === "screening-observations") {
      for (const observation of [...artifact.payload.observations].sort((left, right) => compareText(left.requirement_id, right.requirement_id))) {
        if (existingIds.has(observation.requirement_id)) throw new Error(`Duplicate screening requirement ID conflict: ${observation.requirement_id}`);
        existingIds.add(observation.requirement_id);
        screeningResults.push({
          requirement_id: observation.requirement_id,
          requirement_kind: "screening_check",
          requirement_source: "",
          mapping_status: "unverified",
          outcome: "cant_tell",
          method_kind: "automated",
          method: observation.method,
          evidence: [{ type: "other", location: observation.location, observation: observation.observation, captured_at: observation.captured_at }],
          notes: `Unverified ${observation.evidence_level} screening observation; no profile outcome was recorded.`
        });
      }
    } else if (artifact.artifact_type === "declared-human-review") {
      if (artifact.producer.role_id !== "declared_external_human" || artifact.producer.producer_kind !== "external_human") {
        throw new Error("Only declared_external_human may merge a declared profile outcome.");
      }
      reviewerNames.add(artifact.payload.reviewer_name);
      reviewDates.push(artifact.payload.review_date);
      const sourceHash = resources.artifact_snapshots_by_id.get(artifact.artifact_id).sha256;
      const reviewRecord = suppliedReviewRecords.get(artifact.artifact_id) ?? createHumanReviewRecord({
        reviewerId: artifact.payload.reviewer_id ?? `declared-${sourceHash.slice(0, 32)}`,
        review: artifact.payload,
        context: humanReviewRunContext({ run, artifact, artifactSha256: sourceHash })
      });
      suppliedReviewRecords.delete(artifact.artifact_id);
      merged.assessment.human_review_records.push(structuredClone(reviewRecord));
      const reviewHash = reviewRecordSha256(reviewRecord);
      humanSubjects.push({ payload: reviewRecord.review, reviewer_id: reviewRecord.reviewer_id, record_sha256: reviewHash,
        artifact_id: artifact.artifact_id, recorded_at: artifact.created_at });
      for (const review of artifact.payload.reviews) {
        if (artifact.payload.schema_version !== "3.0.0" && humanReviews.has(review.requirement_id)) throw new Error(`Duplicate declared-human profile row conflict: ${review.requirement_id}`);
        const index = merged.assessment.results.findIndex((item) => item.requirement_kind === "profile_requirement" && item.requirement_id === review.requirement_id);
        if (index < 0) throw new Error(`Exact profile row is not registered for declared human review: ${review.requirement_id}`);
        humanReviews.set(review.requirement_id, review);
        const current = merged.assessment.results[index];
        merged.assessment.results[index] = {
          ...current,
          mapping_status: "human_declared",
          review_record_sha256: reviewHash,
          outcome: review.profile_outcome,
          method_kind: "manual",
          method_ref: expectedMethodRef(review.requirement_id, resources, run.profile.id),
          method: declaredReviewMethod(review),
          evidence: structuredClone(review.target_specific_evidence),
          notes: review.rationale
        };
      }
    }
  }
  if (suppliedReviewRecords.size) throw new Error("A supplied review record does not match a registered human review artifact.");
  const resolvedReviews = resolveHumanReviews(reviewEntries(humanSubjects));
  if (resolvedReviews.modern) {
    humanReviews.clear();
    for (const [requirementId, group] of resolvedReviews.groups) {
      const row = merged.assessment.results.find((item) => item.requirement_id === requirementId), review = group.review;
      delete row.review_record_sha256;
      Object.assign(row, { review_resolution: group.resolution, outcome: review.profile_outcome,
        method: declaredReviewMethod(review), evidence: structuredClone(review.target_specific_evidence), notes: review.rationale });
      humanReviews.set(requirementId, review);
    }
  }
  screeningResults.sort((left, right) => compareText(left.requirement_id, right.requirement_id));
  merged.assessment.results.push(...screeningResults);
  const reflectedProfileIds = merged.assessment.results
    .filter((item) => item.requirement_kind === "profile_requirement" && (isHumanReviewMapping(item) || item.outcome !== "not_tested"))
    .map((item) => item.requirement_id)
    .sort(compareText);
  const declaredReviewIds = [...humanReviews.keys()].sort(compareText);
  if (!isDeepStrictEqual(reflectedProfileIds, declaredReviewIds)) {
    throw new Error("Merged assessment profile outcomes must exactly match the current run declared review set.");
  }
  if (humanReviews.size) {
    merged.assessment.evidence_level = [...humanReviews.values()].some((review) => review.profile_outcome !== "not_tested") ? "E2" : screeningResults.length ? "E1" : "E0";
    merged.assessment.evaluator = [...reviewerNames].sort(compareText).join(", ");
    merged.assessment.evaluated_at = reviewDates.sort(compareText).at(-1);
    const identityLimitation = "Reviewer identity assurance must be reverified from the portable review records under the recipient's external trust policy; declarations and role labels do not authenticate a person.";
    if (!merged.assessment.limitations.includes(identityLimitation)) merged.assessment.limitations.push(identityLimitation);
  } else if (screeningResults.length && merged.assessment.evidence_level === "E0") {
    merged.assessment.evidence_level = "E1";
  }
  const sortedRemediationItems = remediationItems(suppliedEnvelopesById);
  merged.assessment.findings = buildRunFindings(resolvedReviews.findingReviews,
    consensusRemediationItems(resolvedReviews, sortedRemediationItems.map(({ item }) => item)));
  for (const { item } of sortedRemediationItems) {
    if (!merged.assessment.limitations.includes(item.residual_limitation)) {
      merged.assessment.limitations.push(item.residual_limitation);
    }
  }
  const context = projectAuditContext(suppliedEnvelopesById);
  merged.assessment.participation_coverage = context.coverage;
  merged.assessment.assurance = context.assurance;
  merged.assessment.limitations.push(...context.limitations);
  merged.assessment.next_review_at = context.next_review_at;
  merged.assessment.next_review_owner = context.next_review_owner;
  merged.assessment.next_review_condition = context.next_review_condition;
  if (!["reference_only", "screened", "evaluated_subset"].includes(claimTier)) {
    throw new Error("--claim-tier must be reference_only, screened, or evaluated_subset; the evidence guard may impose a lower ceiling.");
  }
  merged.assessment.claim = {
    requested_tier: claimTier,
    proposed_wording: resources.standardsRegistry.claim_templates[claimTier][0]
  };
  validateAssessmentOrThrow(merged, resources, "Merged assessment failed existing assessment validation", run);
  return merged;
}
