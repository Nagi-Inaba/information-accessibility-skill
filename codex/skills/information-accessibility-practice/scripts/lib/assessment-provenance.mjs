import crypto from "node:crypto";
import { attestationDigest, canonicalAttestationJson, parseAttestationJson } from "./attestation-canonical.mjs";
import { humanReviewContext, humanReviewRunContext, humanReviewSigningSubject, verifyHumanReviewRecord } from "./human-review-provenance.mjs";

const assurances = ["legacy_self_declared", "self_declared", "self_signed", "signed", "organization_attested", "independent"];
const authenticated = new Set(["signed", "organization_attested", "independent"]);
const same = (left, right) => canonicalAttestationJson(left) === canonicalAttestationJson(right);
export const declaredReviewMethod = (review) => `Declared external human review: ${review.rationale}`;
export const reviewRecordSha256 = (record) => attestationDigest(humanReviewSigningSubject(record));
export const isHumanReviewMapping = (row) => ["human_verified", "human_declared"].includes(row?.mapping_status);

export function reviewerVerificationOptions({ run, envelopesById, trust }) {
  for (const value of envelopesById.values()) {
    if (value.snapshot?.bytes) {
      const source = parseAttestationJson(value.snapshot.bytes);
      if (!same(value.envelope, source)) throw new Error("Report artifact envelope differs from its verified source bytes.");
    }
  }
  return { run, trust, artifactSnapshotsById: new Map([...envelopesById].map(([id, value]) => [id, value.snapshot])) };
}

// Standalone records have no queue envelope, so their procedure/source binding
// must be checked against the same installed catalogs used by run validation.
export function validateReviewBindings(record, catalogRecords, auditMethods, procedures, options = {}) {
  const errors = [];
  if (record?.schema_version !== "2.0.0") return errors;
  const exactSet = (left, right) => Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && new Set(left).size === left.length && right.every((item) => left.includes(item));
  for (const item of record.assessment?.human_review_records ?? []) {
    for (const review of item?.review?.reviews ?? []) {
      const id = review?.requirement_id;
      const catalog = catalogRecords.find((entry) => entry.id === id);
      if (!catalog) { errors.push(`Human review requirement is not in the assessment profile: ${id}`); continue; }
      const procedure = procedures.procedures.find((entry) => entry.requirement_id === id);
      const method = auditMethods?.methods?.find((entry) => entry.id === catalog.method_key);
      if (procedure) {
        const ref = `criterion-procedures:${procedures.schema_version}#${procedure.id}`;
        if (review.procedure_availability !== "available" || review.criterion_procedure_ref !== ref || review.generic_method_ref !== null) errors.push(`Human review must use registered criterion procedure ${ref}: ${id}`);
      } else {
        const ref = method ? `web-audit-methods:${auditMethods.schema_version}#${method.id}` : null;
        if (!ref || review.procedure_availability !== "unavailable" || review.criterion_procedure_ref !== null || review.generic_method_ref !== ref) errors.push(`Human review must preserve the unavailable criterion procedure and registered generic method: ${id}`);
      }
      if (!exactSet(review.official_sources, procedure?.primary_sources ?? catalog.official_method_sources)) errors.push(`Human review official_sources must exactly match the registered procedure or catalog: ${id}`);
      const types = new Set((review.target_specific_evidence ?? []).map((entry) => entry?.type));
      const nonPerformance = ["11.0.0", "12.0.0"].includes(options.run?.schema_version) && review.profile_outcome === "not_tested";
      const requiredTypes = nonPerformance ? ["manual_observation"] : procedure?.required_evidence_types ?? method?.required_evidence_types ?? [];
      if (nonPerformance && [...types].some((type) => type !== "manual_observation")) errors.push(`Human review not_tested accepts only manual_observation non-performance notes: ${id}`);
      for (const type of requiredTypes) {
        if (!types.has(type)) errors.push(`Human review is missing required evidence type ${type}: ${id}`);
      }
      if (review.finding && review.profile_outcome !== "fail") errors.push(`Human review finding requires profile_outcome fail: ${id}`);
    }
  }
  return errors;
}

function expectedReviewContext(record, assessment, options) {
  if (record.context.origin.kind === "standalone") {
    if (options.run) throw new Error("A standalone review cannot replace a registered run-backed review.");
    return { expectedContext: humanReviewContext({ assessmentId: assessment.assessment_id, assessment }) };
  }
  const { run, artifactSnapshotsById } = options;
  if (!run || !(artifactSnapshotsById instanceof Map)) throw new Error("Run-backed review verification requires its audit run and registered source artifact bytes; supply --run.");
  if (run.run_id !== assessment.assessment_id) throw new Error("Assessment identity does not match the review's audit run.");
  for (const key of ["target", "profile", "scope", "environment"]) {
    if (!same(run[key], assessment[key])) throw new Error(`Assessment ${key} differs from its review's audit run.`);
  }
  const id = record.context.origin.artifact_id;
  const entry = run.artifacts.find((item) => item.artifact_id === id);
  const snapshot = artifactSnapshotsById.get(id);
  if (!entry || !snapshot || !Buffer.isBuffer(snapshot.bytes)) throw new Error("Missing registered source artifact for an assessment review record.");
  const sha256 = crypto.createHash("sha256").update(snapshot.bytes).digest("hex");
  if (sha256 !== entry.sha256 || sha256 !== snapshot.sha256) throw new Error("Assessment review source artifact snapshot hash mismatch.");
  const artifact = structuredClone(parseAttestationJson(snapshot.bytes));
  return { expectedContext: humanReviewRunContext({ run, artifact, artifactSha256: sha256 }), sourceArtifactBytes: snapshot.bytes };
}

// No saved assurance or authenticated flag is consulted. Every new-format row
// is matched to the signed review subject and independently checked context.
export function assessReviewerProvenance(record, options = {}) {
  const errors = [], byRequirement = new Map();
  const counts = Object.fromEntries(assurances.map((value) => [value, 0]));
  const assessment = record?.assessment ?? {}, rows = Array.isArray(assessment.results) ? assessment.results : [];
  let recordCount = 0;
  if (record?.schema_version === "1.0.0") {
    for (const row of rows.filter((item) => item.requirement_kind === "profile_requirement" && item.mapping_status === "human_verified")) {
      counts.legacy_self_declared++;
      byRequirement.set(row.requirement_id, { assurance: "legacy_self_declared", reviewer_identity_authenticated: false });
    }
  } else if (record?.schema_version === "2.0.0") {
    const records = Array.isArray(assessment.human_review_records) ? assessment.human_review_records : [];
    const seen = new Set(), used = new Set();
    recordCount = records.length;
    for (const reviewRecord of records) {
      try {
        const hash = reviewRecordSha256(reviewRecord);
        if (seen.has(hash)) throw new Error("Duplicate human review record subject.");
        seen.add(hash);
        const verification = verifyHumanReviewRecord({ record: reviewRecord, ...expectedReviewContext(reviewRecord, assessment, options), trust: options.trust });
        for (const review of reviewRecord.review.reviews) {
          const row = rows.find((item) => item.requirement_id === review.requirement_id && item.requirement_kind === "profile_requirement");
          if (!row || row.mapping_status !== "human_declared" || row.review_record_sha256 !== hash) throw new Error(`Review record has no exactly referenced declared profile row: ${review.requirement_id}`);
          if (Object.hasOwn(row, "review_details")) throw new Error(`Declared profile row cannot add unsigned review_details: ${review.requirement_id}`);
          if (review.profile_outcome === "fail" && reviewRecord.context.origin.kind === "standalone" && !review.finding) throw new Error(`Standalone human failure requires signed-subject finding details: ${review.requirement_id}`);
          if (review.finding) {
            const findings = (assessment.findings ?? []).filter((finding) => finding.requirement_ids?.includes(review.requirement_id));
            if (findings.length !== 1 || !same(findings[0].requirement_ids, [review.requirement_id])
                || Object.entries(review.finding).some(([key, value]) => !same(findings[0][key], value))) {
              throw new Error(`Assessment finding differs from the referenced human review: ${review.requirement_id}`);
            }
          }
          if (byRequirement.has(review.requirement_id)) throw new Error(`Multiple review records claim the same profile row: ${review.requirement_id}`);
          if (row.outcome !== review.profile_outcome || row.method_kind !== "manual"
            || row.method !== declaredReviewMethod(review) || row.notes !== review.rationale || !same(row.evidence, review.target_specific_evidence)) {
            throw new Error(`Assessment row differs from the referenced human review: ${review.requirement_id}`);
          }
          byRequirement.set(review.requirement_id, verification);
          counts[verification.assurance]++;
          used.add(hash);
        }
      } catch (error) { errors.push(error.message); }
    }
    for (const row of rows) {
      if (row.mapping_status === "human_declared" && !byRequirement.has(row.requirement_id)) errors.push(`No valid reviewer provenance for declared row: ${row.requirement_id}`);
      if (row.mapping_status !== "human_declared" && Object.hasOwn(row, "review_record_sha256")) errors.push(`Only human_declared rows may reference a review record: ${row.requirement_id}`);
    }
    if (used.size !== records.length) errors.push("Every human review record must bind at least one assessment result.");
  }
  const reviewRows = rows.filter((row) => row.requirement_kind === "profile_requirement" && isHumanReviewMapping(row) && row.outcome !== "not_tested");
  const authenticatedRows = reviewRows.filter((row) => authenticated.has(byRequirement.get(row.requirement_id)?.assurance));
  const independentRows = reviewRows.filter((row) => byRequirement.get(row.requirement_id)?.assurance === "independent");
  return { errors, byRequirement, summary: {
    schema_version: "1.0.0", scope: "review_records_and_context", record_count: recordCount,
    requirement_counts: counts, reviewed_requirement_count: reviewRows.length,
    requirement_assurances: Object.fromEntries([...byRequirement].map(([id, result]) => [id, result.assurance])),
    authenticated_requirement_count: authenticatedRows.length,
    legacy_requirement_count: counts.legacy_self_declared,
    all_reviewed_requirements_authenticated: reviewRows.length > 0 && authenticatedRows.length === reviewRows.length,
    all_reviewed_requirements_independent: reviewRows.length > 0 && independentRows.length === reviewRows.length,
    review_correctness_verified: false
  } };
}

export function publicReviewerAssurance(summary) {
  const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return {
    requirement_counts: Object.fromEntries(assurances.map((assurance) => [assurance, count(summary?.requirement_counts?.[assurance])])),
    reviewed_requirement_count: count(summary?.reviewed_requirement_count),
    authenticated_requirement_count: count(summary?.authenticated_requirement_count),
    legacy_requirement_count: count(summary?.legacy_requirement_count)
  };
}

export function reviewerAssuranceLabel(assurance, locale = "ja") {
  const labels = locale === "en" ? {
    legacy_self_declared: "Legacy self-declared review", self_declared: "Self-declared review", self_signed: "Self-signed review; identity unverified",
    signed: "Review signer authenticated", organization_attested: "Organization-attested review signer", independent: "Independently trusted review signer"
  } : {
    legacy_self_declared: "旧形式の自己申告", self_declared: "自己申告", self_signed: "自己署名・本人未確認",
    signed: "署名者確認済み", organization_attested: "組織の信頼方針で署名者確認", independent: "独立した担当者として署名者確認"
  };
  return labels[assurance] ?? (locale === "en" ? "No reviewer authentication" : "担当者の本人確認なし");
}

export function reviewerAssuranceText(summary, locale = "ja") {
  if (!summary || summary.reviewed_requirement_count === 0) return locale === "en" ? "No evaluated human-review records are present." : "評価済みの人手レビュー記録はありません。";
  const reviewed = summary.reviewed_requirement_count, verified = summary.authenticated_requirement_count;
  if (locale === "en") return `Of ${reviewed} requirements with declared human review, ${verified} have reviewer identity authenticated under the recipient's external trust policy. Other records are self-declared; legacy records do not authenticate a reviewer. A signature does not establish review correctness.`;
  return `人手レビューが申告された${reviewed}条項のうち、受領者の外部信頼方針で担当者の本人性を確認できたものは${verified}条項です。残りは自己申告で、旧形式の記録も本人認証を伴いません。署名はレビュー内容の正しさを証明しません。`;
}

export function displayedEvidenceLevel(level, summary, locale = "ja") {
  if (["E4", "E5"].includes(level) && !summary?.all_reviewed_requirements_independent) {
    return locale === "en" ? `${level} (self-declared; independent reviewer identity unverified)` : `${level}（自己申告・独立した担当者の本人性は未確認）`;
  }
  return level;
}
