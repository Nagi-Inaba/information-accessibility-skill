import { publicQueueItem } from "./human-review-queue.mjs";
import { networkScopeSummary } from "./network-policy.mjs";
import { interactionScopeSummary } from "./interaction-policy.mjs";
import { guardScreeningProjection, groupScreeningProjections, screeningProjections, screeningReviewRecord } from "./review-details.mjs";
import { isDeepStrictEqual } from "node:util";
import { loadAuditResources } from "./audit-resources.mjs";
import { validateAssessment } from "../validate-assessment.mjs";
import { buildRunFindings, declaredFindings, findingPlanMetadata, remediationPlanItems } from "./run-findings.mjs";
import { reviewEntries, resolveHumanReviews, consensusReviewRows, consensusRemediationItems, reviewHistoryForReport } from "./human-review-consensus.mjs";
import { isHumanReviewMapping, publicReviewerAssurance, reviewerVerificationOptions, displayedEvidenceLevel } from "./assessment-provenance.mjs";
import { contextArtifacts, projectAuditContext } from "./audit-context.mjs";
import { summarizeParticipantObservations } from "./participant-observation.mjs";
import { outcomes, outcomeLabels, resultRationale } from "./report-judgement.mjs";
import { publicUrlOrFile, sanitizePublicModelStrings, publicLocation, publicText } from "./public-report-sanitizer.mjs";

function envelopeFromRecord(record) {
  return record?.envelope ?? record;
}

function sortedByRequirement(values) {
  return [...values].sort((left, right) => String(left.requirement_id).localeCompare(String(right.requirement_id), "en"));
}

function collectRunEvidence(envelopesById) {
  const queues = [];
  const humanReviews = [];
  const humanSources = [];
  const screeningObservations = [];
  const remediationItems = [];
  for (const record of envelopesById.values()) {
    const envelope = envelopeFromRecord(record);
    if (envelope?.artifact_type === "human-review-queue") queues.push(...(envelope.payload?.items ?? []));
    if (envelope?.artifact_type === "declared-human-review") {
      humanSources.push({ payload: envelope.payload, artifact_id: envelope.artifact_id });
      humanReviews.push(...(envelope.payload?.reviews ?? []).map((review) => ({
        ...review,
        reviewer_name: envelope.payload.reviewer_name,
        review_date: envelope.payload.review_date
      })));
    }
    if (envelope?.artifact_type === "screening-observations") screeningObservations.push(...(envelope.payload?.observations ?? []));
    if (envelope?.artifact_type === "remediation-plan") remediationItems.push(...remediationPlanItems(envelope.payload));
  }
  const resolved = resolveHumanReviews(reviewEntries(humanSources));
  return { queues, humanReviews: consensusReviewRows(resolved), humanReviewHistory: humanReviews, resolved,
    context: projectAuditContext(envelopesById),
    screeningObservations, remediationItems: consensusRemediationItems(resolved, remediationItems) };
}

function uniqueMap(values, key, label) {
  const result = new Map();
  for (const value of values) {
    const id = value?.[key];
    if (result.has(id)) throw new Error(`Run-backed report has duplicate ${label}: ${String(id)}.`);
    result.set(id, value);
  }
  return result;
}

function expectedRunBackedLimitations(evidence, assessmentVersion = "1.0.0") {
  const limitations = [
    "All profile requirements are initialized as not_tested; no accessibility conclusion has been made.",
    "Automated checks, if added, are supporting screening evidence and do not determine requirement outcomes."
  ];
  if (evidence.humanReviews.length > 0) {
    limitations.push(assessmentVersion === "1.0.0" ? "External human reviewer identity was declared but not authenticated (identity_authenticated: false)."
      : "Reviewer identity assurance must be reverified from the portable review records under the recipient's external trust policy; declarations and role labels do not authenticate a person.");
  }
  for (const item of [...evidence.remediationItems]
    .sort((left, right) => left.remediation_id.localeCompare(right.remediation_id, "en"))) {
    if (!limitations.includes(item.residual_limitation)) limitations.push(item.residual_limitation);
  }
  limitations.push(...(evidence.context?.limitations ?? []));
  return limitations;
}

function addString(values, value) {
  if (typeof value === "string" && value.length > 0) values.add(value);
}

function collectSchemaIdPatterns(schema, patterns) {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema)) {
    for (const item of schema) collectSchemaIdPatterns(item, patterns);
    return;
  }
  if (typeof schema.pattern === "string" && /(?:RUN|ART)-/u.test(schema.pattern)) {
    patterns.add(schema.pattern.replace(/^\^/u, "").replace(/\$$/u, ""));
  }
  for (const value of Object.values(schema)) collectSchemaIdPatterns(value, patterns);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function containsIdentifierToken(value, token) {
  return new RegExp(`(?:^|[^A-Za-z0-9_-])${escapeRegExp(token)}(?=$|[^A-Za-z0-9_-])`, "u").test(value);
}

function visitStrings(value, location, visit) {
  if (typeof value === "string") {
    visit(value, location);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitStrings(item, `${location}[${index}]`, visit));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) visitStrings(item, `${location}.${key}`, visit);
  }
}

function internalControlTerms({ run, envelopesById, resources }) {
  const terms = new Set();
  addString(terms, run.run_id);
  addString(terms, run.supersedes_run_id);
  addString(terms, run.artifact_root);
  for (const key of ["sha256", "target_context_sha256", "environment_sha256"]) addString(terms, run.target_inventory?.[key]);
  for (const snapshot of run.target_inventory?.snapshots ?? []) {
    addString(terms, snapshot.snapshot_id);
    visitStrings(snapshot.identity, "identity", (value, location) => {
      if (/(?:sha256|_oid|head_commit|authentication_state_id|feature_flags)(?:\[\d+\])?$/u.test(location)) addString(terms, value);
    });
    for (const binding of snapshot.evidence_bindings ?? []) addString(terms, binding.sha256);
  }
  for (const artifact of run.artifacts ?? []) {
    addString(terms, artifact.artifact_id);
    addString(terms, artifact.producer_role);
    addString(terms, artifact.path);
  }
  for (const entry of run.history ?? []) {
    addString(terms, entry.actor_role);
    for (const artifactId of entry.artifact_ids ?? []) addString(terms, artifactId);
  }
  for (const record of envelopesById.values()) {
    const envelope = envelopeFromRecord(record);
    addString(terms, envelope?.artifact_id);
    addString(terms, envelope?.run_id);
    addString(terms, envelope?.producer?.role_id);
    for (const id of envelope?.target_snapshot_ids ?? []) addString(terms, id);
    for (const source of [...(envelope?.payload?.observations ?? []), ...(envelope?.artifact_type === "audit-context" ? [envelope.payload] : [])]) {
      for (const reference of source.evidence_refs ?? []) {
        for (const key of ["path", "sha256", "environment_ref", "target_snapshot_id", "target_context_sha256"]) addString(terms, reference[key]);
      }
    }
    for (const input of envelope?.inputs ?? []) {
      addString(terms, input?.artifact_id);
      addString(terms, input?.run_id);
    }
  }
  for (const role of resources?.orchestrationRegistry?.roles ?? []) {
    addString(terms, role.id);
    addString(terms, role.agent_id);
  }
  return terms;
}

function internalIdPatterns(resources) {
  const patterns = new Set();
  collectSchemaIdPatterns(resources?.auditRunSchema, patterns);
  collectSchemaIdPatterns(resources?.envelopeSchema, patterns);
  return [...patterns].map((source) => new RegExp(source, "u"));
}

function assertPublicReportModelHasNoInternalControlMetadata(model, context) {
  const terms = internalControlTerms(context);
  const idPatterns = internalIdPatterns(context.resources);
  visitStrings(model, "public_model", (value, location) => {
    for (const term of terms) {
      if (containsIdentifierToken(value, term)) {
        throw new Error(`Run-backed public report contains internal control metadata at ${location}.`);
      }
    }
    for (const pattern of idPatterns) {
      if (pattern.test(value)) {
        throw new Error(`Run-backed public report contains internal control metadata at ${location}.`);
      }
    }
  });
}

function publicEvidence(evidence) {
  return evidence.map((entry) => ({
    ...structuredClone(entry),
    location: publicLocation(entry.location)
  }));
}

function publicFinding(finding) {
  if (!finding) return null;
  return {
    priority: finding.priority,
    location: publicLocation(finding.location),
    affected_users: structuredClone(finding.affected_users),
    observation: finding.observation,
    remediation: finding.remediation,
    verification: finding.verification
  };
}

function publicRemediationReference(item) {
  if (!item) return null;
  return {
    proposed_change: item.proposed_change,
    verification: item.verification,
    owner: item.owner ?? null,
    residual_limitation: item.residual_limitation
  };
}

function publicLimitations(limitations) {
  return limitations.map((limitation) => limitation === "All profile requirements are initialized as not_tested; no accessibility conclusion has been made."
    ? "All profile requirements begin without a recorded result; no accessibility conclusion has been made."
    : limitation);
}

function publicClaimTier(requestedTier) {
  return ({
    reference_only: "Reference only",
    screened: "Screened",
    evaluated_subset: "Evaluated subset",
    organization_ready: "Organization-ready evidence"
  })[requestedTier] ?? "Not recorded";
}

function outcomeCountsFor(results) {
  return Object.fromEntries(outcomes.map((outcome) => [
    outcome,
    results.filter((result) => result.outcome === outcome).length
  ]));
}

function buildReportProjection(profileResults, screeningObservations) {
  const profileIds = new Set(profileResults.map((result) => result.requirement_id));
  const aiByProfile = groupScreeningProjections(screeningObservations);
  for (const suppliedObservation of screeningObservations.flatMap(screeningProjections)) {
    const observation = guardScreeningProjection(suppliedObservation);
    const hasProjection = observation.profile_requirement_id !== null
      && observation.profile_requirement_id !== undefined;
    if (hasProjection) {
      if (!observation.profile_requirement_id || !profileIds.has(observation.profile_requirement_id)) {
        throw new Error(`Screening report projection references an unregistered profile requirement: ${String(observation.profile_requirement_id)}.`);
      }
      if (!observation.applicability || !observation.report_rationale) {
        throw new Error(`Screening report projection is incomplete for ${observation.requirement_id}.`);
      }
      if (observation.applicability === "not_applicable") {
        if (observation.report_outcome !== null) throw new Error(`Not-applicable report projection must use report_outcome null: ${observation.requirement_id}.`);
      } else if (!Object.hasOwn(outcomeLabels, observation.report_outcome)) {
        throw new Error(`Screening report projection has an invalid report_outcome: ${observation.requirement_id}.`);
      }
      continue;
    }
  }

  const checks = [];
  const notApplicable = [];
  for (const result of profileResults) {
    if (isHumanReviewMapping(result)) {
      const row = {
        requirement_id: result.requirement_id,
        outcome: result.outcome,
        rationale: resultRationale(result),
        applicability: result.outcome === "not_applicable" ? "not_applicable" : "applicable"
      };
      (row.applicability === "not_applicable" ? notApplicable : checks).push(row);
      continue;
    }
    const observation = aiByProfile.get(result.requirement_id);
    if (!observation) {
      checks.push({ requirement_id: result.requirement_id, outcome: "not_tested", rationale: "この検査では確認していません。", applicability: "undetermined" });
      continue;
    }
    const row = {
      requirement_id: result.requirement_id,
      outcome: observation.applicability === "not_applicable" ? "not_applicable" : observation.report_outcome,
      rationale: observation.report_rationale,
      applicability: observation.applicability,
      review_details: observation.observations.length === 1 ? observation.observations[0].review_details : undefined,
      screening_conflicts: observation.conflicts,
      screening_observations: observation.observations.map(screeningReviewRecord)
    };
    (row.applicability === "not_applicable" ? notApplicable : checks).push(row);
  }
  const counts = { pass: 0, fail: 0, not_applicable: notApplicable.length, not_tested: 0, cant_tell: 0 };
  for (const item of checks) counts[item.outcome] += 1;
  return { checks: sortedByRequirement(checks), notApplicable: sortedByRequirement(notApplicable), counts };
}

export function validateRunBackedAssessment({ run, assessment, envelopesById, resources, trust }) {
  const record = assessment?.assessment;
  if (!record) throw new Error("Run-backed report requires an assessment record.");
  if (record.profile?.id !== run.profile?.id || record.profile?.registry_version !== run.profile?.registry_version) {
    throw new Error("Assessment profile does not match the audit run.");
  }
  for (const [name, actual, expected] of [
    ["target", record.target, run.target],
    ["scope", record.scope, run.scope],
    ["environment", record.environment, run.environment]
  ]) {
    if (!isDeepStrictEqual(actual, expected)) throw new Error(`Assessment ${name} does not match the audit run.`);
  }

  const evidence = collectRunEvidence(envelopesById);
  const humanByRequirement = uniqueMap(evidence.humanReviews, "requirement_id", "declared human review requirement");
  const screeningByRequirement = uniqueMap(evidence.screeningObservations, "requirement_id", "screening observation requirement");
  const results = Array.isArray(record.results) ? record.results : [];
  const resultByRequirement = uniqueMap(results, "requirement_id", "assessment result requirement");
  const reflectedProfileIds = results
    .filter((result) => result.requirement_kind === "profile_requirement"
      && (result.mapping_status !== "unverified" || result.outcome !== "not_tested" || (result.evidence?.length ?? 0) > 0))
    .map((result) => result.requirement_id)
    .sort((left, right) => left.localeCompare(right, "en"));
  const declaredProfileIds = [...humanByRequirement.keys()].sort((left, right) => left.localeCompare(right, "en"));
  if (!isDeepStrictEqual(reflectedProfileIds, declaredProfileIds)) {
    throw new Error("Assessment profile results do not exactly match the current run human reviews.");
  }
  for (const [requirementId, review] of humanByRequirement) {
    const result = resultByRequirement.get(requirementId);
    if (!result
        || result.requirement_kind !== "profile_requirement"
        || !isHumanReviewMapping(result)
        || result.outcome !== review.profile_outcome
        || result.method_kind !== "manual"
        || result.method !== `Declared external human review: ${review.rationale}`
        || result.notes !== review.rationale
        || !isDeepStrictEqual(result.evidence, review.target_specific_evidence)) {
      throw new Error(`Assessment human-reviewed result does not match the current run evidence for ${requirementId}.`);
    }
  }

  const assessmentScreening = results.filter((result) => result.requirement_kind === "screening_check");
  const assessmentScreeningIds = assessmentScreening.map((result) => result.requirement_id).sort((left, right) => left.localeCompare(right, "en"));
  const runScreeningIds = [...screeningByRequirement.keys()].sort((left, right) => left.localeCompare(right, "en"));
  if (!isDeepStrictEqual(assessmentScreeningIds, runScreeningIds)) {
    throw new Error("Assessment screening rows do not exactly match the current run screening observations.");
  }
  for (const [requirementId, observation] of screeningByRequirement) {
    const result = resultByRequirement.get(requirementId);
    const expectedEvidence = [{
      type: "other",
      location: observation.location,
      observation: observation.observation,
      captured_at: observation.captured_at
    }];
    if (!result
        || result.mapping_status !== "unverified"
        || result.outcome !== "cant_tell"
        || result.method_kind !== "automated"
        || result.method !== observation.method
        || !isDeepStrictEqual(result.evidence, expectedEvidence)) {
      throw new Error(`Assessment screening row does not match the current run observation for ${requirementId}.`);
    }
  }

  const expectedFindings = buildRunFindings(evidence.resolved.findingReviews, evidence.remediationItems);
  const actualFindings = [...(record.findings ?? [])].sort((left, right) => left.id.localeCompare(right.id, "en"));
  if (!isDeepStrictEqual(actualFindings, expectedFindings)) {
    throw new Error("Assessment findings do not exactly match the current run human finding / verified remediation evidence.");
  }
  const candidateIds = new Set(evidence.remediationItems
    .filter((item) => item.basis === "unverified_screening_candidate")
    .map((item) => item.requirement_id));
  if ((record.findings ?? []).some((finding) => finding.requirement_ids.some((id) => candidateIds.has(id)))) {
    throw new Error("An unverified screening candidate must not be promoted to an assessment finding.");
  }

  if (humanByRequirement.size > 0) {
    const expectedReviewers = [...new Set(evidence.humanReviewHistory.map((review) => review.reviewer_name))].sort().join(", ");
    const expectedDate = evidence.humanReviewHistory.map((review) => review.review_date).sort().at(-1);
    const hasPerformedReview = !["11.0.0", "12.0.0", "13.0.0", "14.0.0", "15.0.0", "16.0.0", "17.0.0"].includes(run.schema_version) || evidence.humanReviews.some((review) => review.profile_outcome !== "not_tested");
    const expectedLevel = hasPerformedReview ? "E2" : screeningByRequirement.size > 0 ? "E1" : "E0";
    if (record.evidence_level !== expectedLevel || record.evaluator !== expectedReviewers || record.evaluated_at !== expectedDate) {
      throw new Error("Assessment evaluation identity does not match the current run human review declarations.");
    }
  } else if (screeningByRequirement.size > 0 && record.evidence_level !== "E1") {
    throw new Error("Assessment evidence level does not match the current run screening evidence.");
  }
  if (!isDeepStrictEqual(record.participation_coverage, evidence.context.coverage)) {
    throw new Error("Run-backed participation outcomes do not exactly match registered audit-context evidence.");
  }
  if (!isDeepStrictEqual(record.assurance, evidence.context.assurance)) {
    throw new Error("Run-backed assessment must not add assurance claims that are absent from the registered artifacts.");
  }
  const expectedLimitations = expectedRunBackedLimitations(evidence, assessment.schema_version);
  if (!isDeepStrictEqual(record.limitations, expectedLimitations)) {
    throw new Error("Assessment limitations do not exactly match the current run evidence.");
  }
  const tier = record.claim?.requested_tier;
  const expectedClaim = resources?.standardsRegistry?.claim_templates?.[tier]?.[0];
  if (!["reference_only", "screened", "evaluated_subset"].includes(tier) || record.claim?.proposed_wording !== expectedClaim) {
    throw new Error("Run-backed assessment claim must use a supported tier and its fixed registry wording.");
  }
  const claimValidation = validateAssessment(assessment, resources.standardsRegistry, resources.assessmentSchema, resources.criteriaCatalog, resources.auditMethods,
    reviewerVerificationOptions({ run, envelopesById, trust }));
  if (!claimValidation.valid) {
    throw new Error(`Run-backed assessment claim/evidence validation failed: ${claimValidation.errors.join("; ")}`);
  }
  if (record.next_review_at !== evidence.context.next_review_at
      || (record.next_review_owner ?? null) !== evidence.context.next_review_owner
      || (record.next_review_condition ?? null) !== evidence.context.next_review_condition) {
    throw new Error("Run-backed next review schedule does not exactly match registered audit-context evidence.");
  }
  return evidence;
}

export function buildPublicReportModel({ run, assessment, envelopesById, resources = loadAuditResources(), trust }) {
  const validation = validateAssessment(assessment, resources.standardsRegistry, resources.assessmentSchema, resources.criteriaCatalog, resources.auditMethods,
    reviewerVerificationOptions({ run, envelopesById, trust }));
  if (!validation.valid) throw new Error(`Assessment reviewer/evidence validation failed: ${validation.errors.join("; ")}`);
  const evidence = collectRunEvidence(envelopesById);
  const publicContext = projectAuditContext(new Map(contextArtifacts(envelopesById)
    .filter((artifact) => artifact.payload.publication === "public")
    .map((artifact) => [artifact.artifact_id, artifact])));
  const privateLimitations = new Set(evidence.context.declarations
    .filter((item) => item.publication === "internal" && item.kind === "limitation")
    .map((item) => item.value.text));
  const recordedProfileResults = assessment.assessment.results.filter((result) => result.requirement_kind === "profile_requirement");
  const screeningResults = assessment.assessment.results.filter((result) => result.requirement_kind === "screening_check");
  const registeredRequirementIds = resources?.standardsRegistry?.profiles
    ?.find((profile) => profile.id === run.profile.id)?.requirement_ids ?? recordedProfileResults.map((result) => result.requirement_id);
  const recordedProfileById = new Map(recordedProfileResults.map((result) => [result.requirement_id, result]));
  const profileResults = registeredRequirementIds.map((requirementId) => recordedProfileById.get(requirementId) ?? ({
    requirement_id: requirementId,
    requirement_kind: "profile_requirement",
    mapping_status: "unverified",
    outcome: "not_tested",
    method_kind: "manual",
    method: "Not yet evaluated.",
    evidence: [],
    notes: "Not yet evaluated."
  }));
  const reportProjection = buildReportProjection(profileResults, evidence.screeningObservations);
  const expectedProfileCount = registeredRequirementIds.length;
  const performedReviews = evidence.humanReviews.filter((review) => !["11.0.0", "12.0.0", "13.0.0", "14.0.0", "15.0.0", "16.0.0", "17.0.0"].includes(run.schema_version) || review.profile_outcome !== "not_tested");
  const reviewedIds = new Set(performedReviews.map((review) => review.requirement_id));
  const resultByRequirement = new Map(assessment.assessment.results.map((result) => [result.requirement_id, result]));
  const findingById = uniqueMap(assessment.assessment.findings ?? [], "id", "assessment finding ID");
  const remediationById = uniqueMap(evidence.remediationItems, "remediation_id", "remediation ID");
  const pendingByRequirement = new Map();
  for (const item of evidence.queues) {
    if (!reviewedIds.has(item.requirement_id) || evidence.resolved.groups.get(item.requirement_id)?.status === "unresolved_disagreement") {
      pendingByRequirement.set(item.requirement_id, item);
    }
  }
  const confirmedPoints = sortedByRequirement(evidence.humanReviews
    .filter((review) => review.profile_outcome === "pass")
    .map((review) => ({
      requirement_id: review.requirement_id,
      rationale: review.rationale,
      evidence: publicEvidence(review.target_specific_evidence)
    })));
  const recordedHumanChecks = sortedByRequirement(evidence.humanReviews.map((review) => ({
    requirement_id: review.requirement_id,
    outcome: review.profile_outcome,
    rationale: review.rationale,
    evidence: publicEvidence(review.target_specific_evidence),
    ...(evidence.resolved.modern ? { review_consensus: evidence.resolved.groups.get(review.requirement_id).status,
      human_reviews: reviewHistoryForReport(evidence.resolved.groups.get(review.requirement_id)) } : {})
  })));
  const verifiedFailures = evidence.humanReviews
    .filter((review) => review.profile_outcome === "fail")
    .flatMap((review) => [...findingById.values()]
      .filter((finding) => finding.requirement_ids.includes(review.requirement_id))
      .map((finding) => ({
        requirement_id: review.requirement_id,
        rationale: review.rationale,
        finding: publicFinding(finding),
        remediation: publicRemediationReference(remediationById.get(finding.id))
      })))
    .sort((left, right) => String(left.requirement_id).localeCompare(String(right.requirement_id), "en")
      || String(left.remediation?.proposed_change ?? "").localeCompare(String(right.remediation?.proposed_change ?? ""), "en"));
  const screeningCandidates = evidence.screeningObservations
    .map(({ evidence_refs: _privateReferences, ...observation }) => guardScreeningProjection(observation))
    .flatMap((observation) => {
      const remediations = evidence.remediationItems
        .filter((item) => item.basis === "unverified_screening_candidate" && (item.observation_refs
          ? item.observation_refs.some((ref) => ref.requirement_id === observation.requirement_id) : item.requirement_id === observation.requirement_id))
        .sort((left, right) => left.remediation_id.localeCompare(right.remediation_id, "en"));
      return (remediations.length ? remediations : [null]).map((remediation) => ({
        ...observation,
        location: publicLocation(observation.location),
        remediation: publicRemediationReference(remediation),
        assessment_outcome: resultByRequirement.get(observation.requirement_id)?.outcome
      }));
    })
    .sort((left, right) => String(left.requirement_id).localeCompare(String(right.requirement_id), "en")
      || String(left.remediation?.proposed_change ?? "").localeCompare(String(right.remediation?.proposed_change ?? ""), "en"));
  const declaredFindingRequirements = new Set(evidence.resolved.findingReviews.filter((review) => declaredFindings(review).length).map((review) => review.requirement_id));
  const remediation = [...evidence.remediationItems]
    .filter((item) => item.basis !== "verified_failure" || !declaredFindingRequirements.has(item.requirement_id))
    .sort((left, right) => left.remediation_id.localeCompare(right.remediation_id, "en"))
    .map((item) => ({
      requirement_id: item.requirement_id,
      ...(item.finding_id ? { requirement_ids: item.requirement_ids, observation_ids: item.observation_refs.map((ref) => ref.requirement_id) } : {}),
      evidence_status: item.basis === "verified_failure" ? "Verified failure" : "Unverified screening candidate",
      priority: item.priority,
      location: publicLocation(item.location),
      affected_users: item.affected_users,
      issue: item.issue,
      proposed_change: item.proposed_change,
      owner: item.owner ?? null,
      verification: item.verification,
      residual_limitation: item.residual_limitation
    }));
  for (const finding of findingById.values()) {
    if (!finding.requirement_ids.some((id) => declaredFindingRequirements.has(id))) continue;
    remediation.push({
      requirement_id: finding.requirement_ids[0],
      requirement_ids: finding.requirement_ids,
      observation_ids: evidence.remediationItems.find((item) => item.finding_id === finding.id)?.observation_refs.map((ref) => ref.requirement_id) ?? [],
      evidence_status: "Verified failure",
      priority: finding.priority,
      location: publicLocation(finding.location),
      affected_users: structuredClone(finding.affected_users),
      issue: finding.observation,
      remediation_status: finding.remediation_status,
      proposed_change: finding.remediation,
      verification: finding.verification,
      ...findingPlanMetadata(finding, evidence.remediationItems)
    });
  }
  const model = {
    reviewerAssurance: publicReviewerAssurance(validation.guard.reviewer_assurance),
    networkScope: networkScopeSummary(run.permissions, { publicOutput: true }),
    interactionScope: interactionScopeSummary(run.permissions),
    target: {
      name: publicText(run.target.name),
      version_or_commit: publicText(run.target.version_or_commit, { branchLike: true }),
      urls_or_files: run.target.urls_or_files.map(publicUrlOrFile)
    },
    profile: structuredClone(run.profile),
    scope: {
      included: run.scope.included.map((value) => publicText(value)),
      excluded: run.scope.excluded.map((value) => publicText(value)),
      complete_processes: run.scope.complete_processes.map((value) => publicText(value)),
      third_party_content: run.scope.third_party_content.map((value) => publicText(value)),
      full_pages_reviewed: run.scope.full_pages_reviewed
    },
    environment: {
      os: run.environment.os.map((value) => publicText(value, { environment: true })),
      browsers: run.environment.browsers.map((value) => publicText(value, { environment: true })),
      assistive_technologies: run.environment.assistive_technologies.map((value) => publicText(value, { environment: true })),
      input_modes: run.environment.input_modes.map((value) => publicText(value, { environment: true }))
    },
    evaluatedAt: assessment.assessment.evaluated_at,
    standardsRegistryVersion: resources?.standardsRegistry?.schema_version ?? "Not recorded",
    recordedHumanChecks,
    confirmedPoints,
    verifiedFailures,
    pendingHumanChecks: sortedByRequirement([...pendingByRequirement.values()].map((item) => publicQueueItem(item, publicLocation))),
    screeningCandidates,
    remediation,
    limitations: publicLimitations(assessment.assessment.limitations.filter((item) => !privateLimitations.has(item))),
    auditContext: {
      participation_coverage: publicContext.coverage,
      independent_audit_performed: publicContext.assurance.independent_audit.performed,
      dossier_prepared: publicContext.assurance.legal_or_procurement_dossier.prepared,
      next_review_at: publicContext.next_review_at,
      next_review_condition: publicContext.next_review_condition
    },
    participantSummary: summarizeParticipantObservations(envelopesById, { visibility: "public" }),
    claim: {
      tier: publicClaimTier(assessment.assessment.claim.requested_tier),
      wording: validation.guard.assured_claim_wording.ja
    },
    evidenceLevel: displayedEvidenceLevel(assessment.assessment.evidence_level, validation.guard.reviewer_assurance),
    reviewedCount: performedReviews.length,
    screeningCount: evidence.screeningObservations.length,
    profileOutcomeCounts: outcomeCountsFor(profileResults),
    screeningOutcomeCounts: outcomeCountsFor(screeningResults),
    reportChecks: reportProjection.checks,
    notApplicableChecks: reportProjection.notApplicable,
    reportOutcomeCounts: reportProjection.counts,
    catalogCoverage: { recorded: recordedProfileResults.length, expected: expectedProfileCount },
    evaluationCoverage: {
      humanReviewed: profileResults.filter((result) => isHumanReviewMapping(result) && (!["11.0.0", "12.0.0", "13.0.0", "14.0.0", "15.0.0", "16.0.0", "17.0.0"].includes(run.schema_version) || result.outcome !== "not_tested")).length,
      expected: expectedProfileCount
    }
  };
  const sanitizedModel = sanitizePublicModelStrings(model);
  assertPublicReportModelHasNoInternalControlMetadata(sanitizedModel, { run, envelopesById, resources });
  return sanitizedModel;
}
