import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertStableFile,
  readStableFile,
  validateAuditRun,
  writeNewText
} from "./lib/audit-run.mjs";
import { validateAssessment } from "./validate-assessment.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptDir);
const outcomes = ["pass", "fail", "not_applicable", "not_tested", "cant_tell"];
const priorityOrder = ["P0", "P1", "P2"];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function readReference(relativePath) {
  return readJson(path.join(skillRoot, "references", relativePath));
}

function cell(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/([`*_{}\[\]()#+!])/g, "\\$1")
    .replace(/\r\n|[\r\n]/g, "<br>")
    .replace(/\|/g, "\\|")
    .trim();
}

function list(values) {
  return values?.length ? values.map((value) => `- ${cell(value)}`).join("\n") : "- None recorded.";
}

function count(counts, outcome) {
  return counts?.[outcome] ?? 0;
}

function outcomeRows(profileCounts, screeningCounts) {
  return outcomes.map((outcome) => `| ${cell(outcome)} | ${count(profileCounts, outcome)} | ${count(screeningCounts, outcome)} |`).join("\n");
}

function groupRows(groups, groupCounts) {
  return outcomes.map((outcome) => `| ${cell(outcome)} | ${groups.map((group) => count(groupCounts?.[group.id], outcome)).join(" | ")} |`).join("\n");
}

function findingTable(findings) {
  if (findings.length === 0) return "No structured findings were recorded.";
  return [
    "| ID | Requirement IDs | Location | Affected users | Observation | Remediation | Verification |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...findings.map((finding) => [
      finding.id,
      finding.requirement_ids.join(", "),
      finding.location,
      finding.affected_users.join(", "),
      finding.observation,
      finding.remediation,
      finding.verification
    ].map(cell).join(" | ").replace(/^/, "| ").replace(/$/, " |"))
  ].join("\n");
}

export function renderAuditReport(record, validation) {
  if (!validation?.valid) throw new Error("Assessment record must pass validation before a report can be rendered.");
  const assessment = record.assessment;
  const guard = validation.guard;
  const profileCounts = guard.profile_outcome_counts;
  const findings = Array.isArray(assessment.findings) ? assessment.findings : [];
  const orderedFindings = priorityOrder.map((priority) => [priority, findings.filter((finding) => finding.priority === priority)]);
  const unlinkedFailures = assessment.results
    .filter((result) => result.outcome === "fail" && !findings.some((finding) => finding.requirement_ids.includes(result.requirement_id)))
    .map((result) => result.requirement_id);
  if (unlinkedFailures.length > 0) {
    throw new Error(`Assessment record has failed results without structured findings: ${unlinkedFailures.join(", ")}`);
  }

  const lines = [
    "# Accessibility Audit Report",
    "",
    "> Status: generated from a validated assessment record.",
    "> This report applies only to the recorded target, version, scope, environment, and date. It is not a certification or conformance determination.",
    "",
    "## 1. Audit Identity",
    "",
    `- Target: ${cell(assessment.target.name)}`,
    `- Version / commit: ${cell(assessment.target.version_or_commit)}`,
    `- URLs / files: ${cell(assessment.target.urls_or_files.length ? assessment.target.urls_or_files.join(", ") : "Not recorded")}`,
    `- Audit profile: ${assessment.profile.id}`,
    `- Audit date: ${assessment.evaluated_at}`,
    `- Evaluator: ${cell(assessment.evaluator)}`,
    `- Evidence level: ${assessment.evidence_level}`,
    "",
    "## 2. Executive Summary",
    "",
    `- P0 findings: ${findings.filter((finding) => finding.priority === "P0").length}`,
    `- P1 findings: ${findings.filter((finding) => finding.priority === "P1").length}`,
    `- P2 findings: ${findings.filter((finding) => finding.priority === "P2").length}`,
    `- Failed profile requirements: ${count(profileCounts, "fail")}`,
    `- Untested profile requirements: ${count(profileCounts, "not_tested")}`,
    `- Indeterminate profile requirements: ${count(profileCounts, "cant_tell")}`,
    `- Highest claim tier allowed by the validator: ${guard.max_tier}`,
    "",
    "## 3. Scope",
    "",
    "### Included",
    "",
    list(assessment.scope.included),
    "",
    "### Excluded",
    "",
    list(assessment.scope.excluded),
    "",
    "### Complete User Processes",
    "",
    list(assessment.scope.complete_processes),
    "",
    "### Third-Party Content",
    "",
    list(assessment.scope.third_party_content),
    "",
    `- Full pages reviewed: ${assessment.scope.full_pages_reviewed ? "Yes" : "No"}`,
    "",
    "## 4. Test Environment",
    "",
    "| Layer | Recorded environment |",
    "| --- | --- |",
    `| OS | ${cell(assessment.environment.os.join(", ") || "Not recorded")} |`,
    `| Browser / renderer | ${cell(assessment.environment.browsers.join(", ") || "Not recorded")} |`,
    `| Assistive technology | ${cell(assessment.environment.assistive_technologies.join(", ") || "Not recorded")} |`,
    `| Input mode | ${cell(assessment.environment.input_modes.join(", ") || "Not recorded")} |`,
    "",
    "## 5. Method And Evidence Boundary",
    "",
    `- Human-verified profile requirements: ${guard.evaluation_coverage.human_verified} of ${guard.catalog_coverage.expected}`,
    "- Automated and screening checks are supporting evidence only; they do not determine profile requirement outcomes.",
    "- Catalog coverage and evaluation coverage are reported separately below.",
    "",
    "## 6. Findings",
    ""
  ];

  for (const [priority, priorityFindings] of orderedFindings) {
    lines.push(`### ${priority}`, "", findingTable(priorityFindings), "");
  }
  lines.push(
    "## 7. Profile Coverage",
    "",
    "| Result | Registered profile requirements | Supporting screening checks |",
    "| --- | ---: | ---: |",
    outcomeRows(profileCounts, guard.screening_outcome_counts),
    "",
    `- Catalog coverage: ${guard.catalog_coverage.recorded} of ${guard.catalog_coverage.expected}; complete: ${guard.catalog_coverage.complete ? "yes" : "no"}.`,
    `- Evaluation coverage: ${guard.evaluation_coverage.human_verified} human-verified; complete: ${guard.evaluation_coverage.complete ? "yes" : "no"}.`,
    ""
  );

  const reportGroups = guard.report_groups ?? [];
  if (reportGroups.length > 1) {
    lines.push(
      "### Profile Requirement Groups",
      "",
      `| Result | ${reportGroups.map((group) => cell(group.label)).join(" | ")} |`,
      `| --- | ${reportGroups.map(() => "---:").join(" | ")} |`,
      groupRows(reportGroups, guard.profile_group_outcome_counts),
      ""
    );
  }

  lines.push(
    "## 8. Participation Coverage",
    "",
    "| Gate | Result |",
    "| --- | --- |",
    ...["find", "receive", "understand", "participate", "continue"].map((gate) => `| ${gate} | ${assessment.participation_coverage[gate]} |`),
    "",
    "## 9. Limitations And Residual Risk",
    "",
    list(assessment.limitations),
    "- Results do not extend beyond the recorded target version and scope.",
    "",
    "## 10. Remediation And Retest",
    "",
    findings.length ? "Use each finding's remediation and verification field as the retest plan." : "- No structured remediation items were recorded.",
    assessment.next_review_at ? `- Next review date: ${assessment.next_review_at}` : "- Next review date: Not recorded.",
    "",
    "## 11. Claim Statement",
    "",
    `> ${assessment.claim.proposed_wording}`,
    "",
    `- Requested tier: ${assessment.claim.requested_tier}`,
    `- Validator maximum tier: ${guard.max_tier}`,
    "- The claim statement is limited to the recorded evidence and does not declare conformance."
  );

  return `${lines.join("\n").trimEnd()}\n`;
}

function parseSnapshotJson(snapshot, label) {
  try {
    return JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${error.message}`);
  }
}

function envelopeFromRecord(record) {
  return record?.envelope ?? record;
}

function sortedByRequirement(values) {
  return [...values].sort((left, right) => String(left.requirement_id).localeCompare(String(right.requirement_id), "en"));
}

function collectRunEvidence(envelopesById) {
  const queues = [];
  const humanReviews = [];
  const screeningObservations = [];
  const remediationItems = [];
  for (const record of envelopesById.values()) {
    const envelope = envelopeFromRecord(record);
    if (envelope?.artifact_type === "human-review-queue") queues.push(...(envelope.payload?.items ?? []));
    if (envelope?.artifact_type === "declared-human-review") {
      humanReviews.push(...(envelope.payload?.reviews ?? []).map((review) => ({
        ...review,
        reviewer_name: envelope.payload.reviewer_name,
        review_date: envelope.payload.review_date
      })));
    }
    if (envelope?.artifact_type === "screening-observations") screeningObservations.push(...(envelope.payload?.observations ?? []));
    if (envelope?.artifact_type === "remediation-plan") remediationItems.push(...(envelope.payload?.items ?? []));
  }
  return { queues, humanReviews, screeningObservations, remediationItems };
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

function expectedRunBackedLimitations(evidence) {
  const limitations = [
    "All profile requirements are initialized as not_tested; no accessibility conclusion has been made.",
    "Automated checks, if added, are supporting screening evidence and do not determine requirement outcomes."
  ];
  if (evidence.humanReviews.length > 0) {
    limitations.push("External human reviewer identity was declared but not authenticated (identity_authenticated: false).");
  }
  for (const item of [...evidence.remediationItems]
    .sort((left, right) => left.remediation_id.localeCompare(right.remediation_id, "en"))) {
    if (!limitations.includes(item.residual_limitation)) limitations.push(item.residual_limitation);
  }
  return limitations;
}

function addString(values, value) {
  if (typeof value === "string" && value.length > 0) values.add(value);
}

function collectSchemaEnumValues(schema, propertyNames, values) {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema)) {
    for (const item of schema) collectSchemaEnumValues(item, propertyNames, values);
    return;
  }
  for (const [name, value] of Object.entries(schema)) {
    if (propertyNames.has(name) && value && typeof value === "object") {
      for (const item of value.enum ?? []) addString(values, item);
      addString(values, value.const);
    }
    collectSchemaEnumValues(value, propertyNames, values);
  }
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
  addString(terms, run.status);
  for (const artifact of run.artifacts ?? []) {
    addString(terms, artifact.artifact_id);
    addString(terms, artifact.artifact_type);
    addString(terms, artifact.producer_role);
  }
  for (const entry of run.history ?? []) {
    addString(terms, entry.from);
    addString(terms, entry.to);
    addString(terms, entry.actor_role);
    for (const artifactId of entry.artifact_ids ?? []) addString(terms, artifactId);
  }
  for (const record of envelopesById.values()) {
    const envelope = envelopeFromRecord(record);
    addString(terms, envelope?.artifact_id);
    addString(terms, envelope?.artifact_type);
    addString(terms, envelope?.run_id);
    addString(terms, envelope?.producer?.role_id);
    addString(terms, envelope?.producer?.producer_kind);
    for (const input of envelope?.inputs ?? []) {
      addString(terms, input?.artifact_id);
      addString(terms, input?.run_id);
    }
  }
  for (const role of resources?.orchestrationRegistry?.roles ?? []) {
    addString(terms, role.id);
    addString(terms, role.agent_id);
  }
  for (const transition of resources?.orchestrationRegistry?.transitions ?? []) {
    addString(terms, transition.from);
    addString(terms, transition.to);
    for (const type of transition.required_artifact_types ?? []) addString(terms, type);
  }
  const schemaPropertyNames = new Set(["basis", "mapping_status", "requested_tier"]);
  collectSchemaEnumValues(resources?.assessmentSchema, schemaPropertyNames, terms);
  for (const schemas of resources?.payloadSchemas?.values?.() ?? []) {
    for (const schema of schemas.values()) collectSchemaEnumValues(schema, schemaPropertyNames, terms);
  }
  return new Set([...terms].filter((term) => /[_-]/u.test(term)));
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

function publicFinding(finding) {
  if (!finding) return null;
  return {
    priority: finding.priority,
    location: finding.location,
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

function publicClaimTier(requestedTier) {
  return ({
    reference_only: "Reference only",
    evaluated_subset: "Evaluated subset",
    organization_ready: "Organization-ready evidence"
  })[requestedTier] ?? "Not recorded";
}

export function validateRunBackedAssessment({ run, assessment, envelopesById, resources }) {
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
        || result.mapping_status !== "human_verified"
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

  const verifiedItems = evidence.remediationItems
    .filter((item) => item.basis === "verified_failure")
    .sort((left, right) => left.remediation_id.localeCompare(right.remediation_id, "en"));
  const expectedFindings = verifiedItems.map((item) => ({
    id: item.remediation_id,
    priority: item.priority,
    requirement_ids: [item.requirement_id],
    location: item.location,
    affected_users: structuredClone(item.affected_users),
    observation: item.issue,
    remediation: item.proposed_change,
    verification: item.verification
  }));
  const actualFindings = [...(record.findings ?? [])].sort((left, right) => left.id.localeCompare(right.id, "en"));
  if (!isDeepStrictEqual(actualFindings, expectedFindings)) {
    throw new Error("Assessment findings do not exactly match the current run verified remediation evidence.");
  }
  const candidateIds = new Set(evidence.remediationItems
    .filter((item) => item.basis === "unverified_screening_candidate")
    .map((item) => item.requirement_id));
  if ((record.findings ?? []).some((finding) => finding.requirement_ids.some((id) => candidateIds.has(id)))) {
    throw new Error("An unverified screening candidate must not be promoted to an assessment finding.");
  }

  if (humanByRequirement.size > 0) {
    const expectedReviewers = [...new Set(evidence.humanReviews.map((review) => review.reviewer_name))].sort().join(", ");
    const expectedDate = evidence.humanReviews.map((review) => review.review_date).sort().at(-1);
    if (record.evidence_level !== "E2" || record.evaluator !== expectedReviewers || record.evaluated_at !== expectedDate) {
      throw new Error("Assessment evaluation identity does not match the current run human review declarations.");
    }
  } else if (screeningByRequirement.size > 0 && record.evidence_level !== "E1") {
    throw new Error("Assessment evidence level does not match the current run screening evidence.");
  }
  if (Object.values(record.participation_coverage ?? {}).some((outcome) => outcome !== "not_tested")) {
    throw new Error("Run-backed assessment must not add participation outcomes that are absent from the registered artifacts.");
  }
  const expectedAssurance = {
    independent_audit: { performed: false, evaluator_independent: false, scope_method: "", report_location: "" },
    legal_or_procurement_dossier: { prepared: false, responsible_owner: "", artifacts: [] }
  };
  if (!isDeepStrictEqual(record.assurance, expectedAssurance)) {
    throw new Error("Run-backed assessment must not add assurance claims that are absent from the registered artifacts.");
  }
  const expectedLimitations = expectedRunBackedLimitations(evidence);
  if (!isDeepStrictEqual(record.limitations, expectedLimitations)) {
    throw new Error("Assessment limitations do not exactly match the current run evidence.");
  }
  const expectedClaim = resources?.standardsRegistry?.claim_templates?.reference_only?.[0];
  if (record.claim?.requested_tier !== "reference_only" || record.claim?.proposed_wording !== expectedClaim) {
    throw new Error("Run-backed assessment claim must remain the current reference-only claim.");
  }
  if (record.next_review_at !== null) throw new Error("Run-backed assessment next review date is not derived from the registered artifacts.");
  return evidence;
}

export function buildPublicReportModel({ run, assessment, envelopesById, resources }) {
  const evidence = collectRunEvidence(envelopesById);
  const reviewedIds = new Set(evidence.humanReviews.map((review) => review.requirement_id));
  const resultByRequirement = new Map(assessment.assessment.results.map((result) => [result.requirement_id, result]));
  const findingById = uniqueMap(assessment.assessment.findings ?? [], "id", "assessment finding ID");
  const remediationById = uniqueMap(evidence.remediationItems, "remediation_id", "remediation ID");
  const pendingByRequirement = new Map();
  for (const item of evidence.queues) {
    if (!reviewedIds.has(item.requirement_id)) pendingByRequirement.set(item.requirement_id, item);
  }
  const confirmedPoints = sortedByRequirement(evidence.humanReviews
    .filter((review) => review.profile_outcome === "pass")
    .map((review) => ({
      requirement_id: review.requirement_id,
      rationale: review.rationale,
      evidence: review.target_specific_evidence
    })));
  const recordedHumanChecks = sortedByRequirement(evidence.humanReviews.map((review) => ({
    requirement_id: review.requirement_id,
    outcome: review.profile_outcome,
    rationale: review.rationale
  })));
  const verifiedFailures = evidence.humanReviews
    .filter((review) => review.profile_outcome === "fail")
    .flatMap((review) => evidence.remediationItems
      .filter((item) => item.basis === "verified_failure" && item.requirement_id === review.requirement_id)
      .map((remediation) => ({
        requirement_id: review.requirement_id,
        rationale: review.rationale,
        finding: publicFinding(findingById.get(remediation.remediation_id)),
        remediation: publicRemediationReference(remediationById.get(remediation.remediation_id))
      })))
    .sort((left, right) => String(left.requirement_id).localeCompare(String(right.requirement_id), "en")
      || String(left.remediation?.proposed_change ?? "").localeCompare(String(right.remediation?.proposed_change ?? ""), "en"));
  const screeningCandidates = evidence.screeningObservations
    .flatMap((observation) => {
      const remediations = evidence.remediationItems
        .filter((item) => item.basis === "unverified_screening_candidate" && item.requirement_id === observation.requirement_id)
        .sort((left, right) => left.remediation_id.localeCompare(right.remediation_id, "en"));
      return (remediations.length ? remediations : [null]).map((remediation) => ({
        ...observation,
        remediation: publicRemediationReference(remediation),
        assessment_outcome: resultByRequirement.get(observation.requirement_id)?.outcome
      }));
    })
    .sort((left, right) => String(left.requirement_id).localeCompare(String(right.requirement_id), "en")
      || String(left.remediation?.proposed_change ?? "").localeCompare(String(right.remediation?.proposed_change ?? ""), "en"));
  const remediation = [...evidence.remediationItems]
    .sort((left, right) => left.remediation_id.localeCompare(right.remediation_id, "en"))
    .map((item) => ({
      requirement_id: item.requirement_id,
      evidence_status: item.basis === "verified_failure" ? "Verified failure" : "Unverified screening candidate",
      priority: item.priority,
      location: item.location,
      affected_users: item.affected_users,
      issue: item.issue,
      proposed_change: item.proposed_change,
      owner: item.owner ?? null,
      verification: item.verification,
      residual_limitation: item.residual_limitation
    }));
  const model = {
    target: structuredClone(run.target),
    profile: structuredClone(run.profile),
    scope: structuredClone(run.scope),
    environment: structuredClone(run.environment),
    recordedHumanChecks,
    confirmedPoints,
    verifiedFailures,
    pendingHumanChecks: sortedByRequirement([...pendingByRequirement.values()]),
    screeningCandidates,
    remediation,
    limitations: structuredClone(assessment.assessment.limitations),
    claim: {
      tier: publicClaimTier(assessment.assessment.claim.requested_tier),
      wording: assessment.assessment.claim.proposed_wording
    },
    evidenceLevel: assessment.assessment.evidence_level,
    reviewedCount: evidence.humanReviews.length,
    screeningCount: evidence.screeningObservations.length
  };
  assertPublicReportModelHasNoInternalControlMetadata(model, { run, envelopesById, resources });
  return model;
}

function publicTable(headers, rows, emptyMessage) {
  if (rows.length === 0) return emptyMessage;
  return [
    `| ${headers.map(cell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)
  ].join("\n");
}

export function renderRunBackedReport(model) {
  const outcomeLabel = (outcome) => ({
    pass: "Met in the recorded review",
    fail: "Verified failure",
    not_applicable: "Not applicable",
    not_tested: "Not tested",
    cant_tell: "Could not determine"
  }[outcome] ?? "Not recorded");
  const lines = [
    "# Accessibility Audit Report",
    "",
    "> This report is limited to the recorded target, version, scope, environment, and evidence. It is not a certification or conformance determination.",
    "",
    "## Audit scope",
    "",
    `- Target: ${cell(model.target.name)}`,
    `- Version or commit: ${cell(model.target.version_or_commit)}`,
    `- URLs or files: ${cell(model.target.urls_or_files.join(", ") || "Not recorded")}`,
    `- Profile: ${cell(model.profile.id)}`,
    `- Included: ${cell(model.scope.included.join(", ") || "Not recorded")}`,
    `- Excluded: ${cell(model.scope.excluded.join(", ") || "None recorded")}`,
    `- Complete user processes: ${cell(model.scope.complete_processes.join(", ") || "None recorded")}`,
    `- Third-party content: ${cell(model.scope.third_party_content.join(", ") || "None recorded")}`,
    `- Full pages reviewed: ${model.scope.full_pages_reviewed ? "Yes" : "No"}`,
    `- Operating systems: ${cell(model.environment.os.join(", ") || "Not recorded")}`,
    `- Browsers or renderers: ${cell(model.environment.browsers.join(", ") || "Not recorded")}`,
    `- Assistive technologies: ${cell(model.environment.assistive_technologies.join(", ") || "Not recorded")}`,
    `- Input modes: ${cell(model.environment.input_modes.join(", ") || "Not recorded")}`,
    "",
    "## Recorded human checks",
    "",
    publicTable(
      ["Requirement", "Recorded result", "Rationale"],
      model.recordedHumanChecks.map((item) => [item.requirement_id, outcomeLabel(item.outcome), item.rationale]),
      "No completed human checks were recorded."
    ),
    "",
    "## Confirmed conformance points",
    "",
    publicTable(
      ["Requirement", "Human-review rationale", "Recorded evidence"],
      model.confirmedPoints.map((item) => [item.requirement_id, item.rationale, item.evidence.map((entry) => `${entry.location}: ${entry.observation}`).join("; ")]),
      "No confirmed conformance points were recorded."
    ),
    "",
    "## Verified failures",
    "",
    publicTable(
      ["Requirement", "Priority", "Location", "Affected users", "Issue", "Proposed change"],
      model.verifiedFailures.map((item) => [
        item.requirement_id,
        item.finding?.priority ?? "Not recorded",
        item.finding?.location ?? "Not recorded",
        item.finding?.affected_users?.join(", ") ?? "Not recorded",
        item.finding?.observation ?? item.rationale,
        item.remediation?.proposed_change ?? "Not recorded"
      ]),
      "No verified failures were recorded."
    ),
    "",
    "## Pending human checks",
    "",
    publicTable(
      ["Requirement", "Procedure availability", "Human actions", "Cannot-determine conditions"],
      model.pendingHumanChecks.map((item) => [
        item.requirement_id,
        item.procedure_availability,
        item.human_actions.join("; "),
        item.cant_tell_conditions.join("; ")
      ]),
      "No pending human checks were recorded."
    ),
    "",
    "## Unverified screening candidates",
    "",
    "> The entries in this section are leads for human review. They are not failures and do not support a conformance claim.",
    "",
    publicTable(
      ["Check", "Location", "Observation", "Proposed next step", "Residual limitation"],
      model.screeningCandidates.map((item) => [
        item.requirement_id,
        item.location,
        item.observation,
        item.remediation?.proposed_change ?? "Review the observation before deciding whether a change is needed.",
        item.remediation?.residual_limitation ?? "The observation has not been verified by a human reviewer."
      ]),
      "No unverified screening candidates were recorded."
    ),
    "",
    "## Remediation",
    "",
    publicTable(
      ["Evidence status", "Requirement", "Priority", "Location", "Affected users", "Issue", "Proposed change", "Owner", "Residual limitation"],
      model.remediation.map((item) => [
        item.evidence_status,
        item.requirement_id,
        item.priority,
        item.location,
        item.affected_users.join(", "),
        item.issue,
        item.proposed_change,
        item.owner ?? "Not assigned",
        item.residual_limitation
      ]),
      "No remediation items were recorded."
    ),
    "",
    "## Retest",
    "",
    publicTable(
      ["Requirement", "Retest method", "Owner"],
      model.remediation.map((item) => [item.requirement_id, item.verification, item.owner ?? "Not assigned"]),
      "No retest methods were recorded."
    ),
    "",
    "## Evidence and claim limits",
    "",
    `- Recorded human checks: ${model.reviewedCount}`,
    `- Recorded screening observations: ${model.screeningCount}`,
    `- Evidence level: ${cell(model.evidenceLevel)}`,
    `- Claim tier: ${cell(model.claim.tier)}`,
    `- Claim wording: ${cell(model.claim.wording)}`,
    "- Screening observations and candidates do not determine requirement outcomes.",
    "- Results do not extend beyond the recorded target version, scope, environment, and evidence.",
    ...model.limitations.map((limitation) => `- ${cell(limitation)}`)
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (!["--input", "--run", "--assessment", "--output"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2)] = value;
    index += 1;
  }
  return options;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/render-audit-report.mjs --input <assessment.json> [--output <report.md>]",
    "  node scripts/render-audit-report.mjs --run <audit-run.json> --assessment <assessment.json> --output <new-report.md>"
  ].join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const runBacked = Boolean(options.run || options.assessment);
  if (options.input && runBacked) throw new Error("Use either --input or the --run/--assessment interface, not both.");
  if (runBacked) {
    if (!options.run || !options.assessment || !options.output) {
      throw new Error("--run, --assessment, and --output are required for a run-backed report.");
    }
    const runSnapshot = readStableFile(path.resolve(options.run), { label: "audit run" });
    const assessmentSnapshot = readStableFile(path.resolve(options.assessment), { label: "merged assessment" });
    const run = parseSnapshotJson(runSnapshot, "audit run");
    const assessment = parseSnapshotJson(assessmentSnapshot, "merged assessment");
    const runValidation = validateAuditRun(run, { skillRoot, runFile: runSnapshot.path });
    if (!runValidation.valid) throw new Error(`Audit run validation failed:\n- ${runValidation.errors.join("\n- ")}`);
    const currentRunVersion = runValidation.resources.auditRunSchema.properties.schema_version.const;
    if (run.schema_version !== currentRunVersion) {
      throw new Error(`Run-backed reporting requires the current audit-run schema_version ${currentRunVersion}.`);
    }
    const validation = validateAssessment(
      assessment,
      runValidation.resources.standardsRegistry,
      runValidation.resources.assessmentSchema,
      runValidation.resources.criteriaCatalog,
      runValidation.resources.auditMethods
    );
    if (!validation.valid) throw new Error(`Assessment validation failed:\n- ${validation.errors.join("\n- ")}`);
    validateRunBackedAssessment({
      run,
      assessment,
      envelopesById: runValidation.envelopesById,
      resources: runValidation.resources
    });
    const report = renderRunBackedReport(buildPublicReportModel({
      run,
      assessment,
      envelopesById: runValidation.envelopesById,
      resources: runValidation.resources
    }));
    const artifactSnapshots = [...runValidation.envelopesById.values()].map((record) => record.snapshot).filter(Boolean);
    const output = writeNewText(path.resolve(options.output), report, {
      beforeWrite() {
        assertStableFile(runSnapshot, "audit run");
        assertStableFile(assessmentSnapshot, "merged assessment");
        for (const snapshot of artifactSnapshots) assertStableFile(snapshot, "registered artifact");
      }
    });
    console.log(JSON.stringify({ status: "PASS", report: output }));
    return;
  }
  if (!options.input) throw new Error("--input is required");
  const record = readJson(path.resolve(options.input));
  const validation = validateAssessment(
    record,
    readReference("standards-registry.json"),
    readReference("assessment-record.schema.json"),
    readReference("criteria-catalog.json"),
    readReference("web-audit-methods.json")
  );
  if (!validation.valid) throw new Error(`Assessment validation failed:\n- ${validation.errors.join("\n- ")}`);
  const report = renderAuditReport(record, validation);
  if (!options.output) {
    process.stdout.write(report);
    return;
  }
  const legacyOutput = path.resolve(options.output);
  fs.mkdirSync(path.dirname(legacyOutput), { recursive: true });
  const output = writeNewText(legacyOutput, report);
  console.log(JSON.stringify({ status: "PASS", input: path.resolve(options.input), output }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
