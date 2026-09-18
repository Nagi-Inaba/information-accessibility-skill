import crypto from "node:crypto";
import fs from "node:fs";
import { validateJsonSchema } from "./json-schema.mjs";
import { canonicalAttestationJson, attestationDigest, parseAttestationJson } from "./attestation-canonical.mjs";
import { verifyDetachedAttestation, attestationVerificationResult } from "./attestation-verifier.mjs";

const recordSchema = JSON.parse(fs.readFileSync(new URL("../../references/human-review-record.schema.json", import.meta.url), "utf8"));
const hasSameJson = (left, right) => canonicalAttestationJson(left) === canonicalAttestationJson(right);
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

export function validateHumanReviewRecord(record) {
  // This also rejects accessors, hidden fields, non-finite numbers and other
  // non-JSON values before any application code reads attacker-owned fields.
  canonicalAttestationJson(record);
  const errors = validateJsonSchema(record, recordSchema);
  requireValue(errors.length === 0, `Invalid human review record:\n- ${errors.join("\n- ")}`);
  const context = record.context;
  const reviewedIds = record.review.reviews.map((review) => review.requirement_id);
  requireValue(new Set(reviewedIds).size === reviewedIds.length, "Duplicate reviewed requirement IDs are not permitted.");
  if (context.origin.kind === "audit_run") {
    requireValue(context.assessment.assessment_id === context.origin.run_id, "Run-backed review assessment_id must equal run_id.");
    const ids = context.origin.input_artifacts.map((input) => input.artifact_id);
    requireValue(new Set(ids).size === ids.length, "Duplicate review input artifact IDs are not permitted.");
    requireValue(!ids.includes(context.origin.artifact_id), "A review artifact cannot be its own input.");
    requireValue(ids.every((id, index) => index === 0 || ids[index - 1] < id), "Review input artifacts must be sorted by artifact_id using UTF-16 order.");
  }
  return true;
}

export function humanReviewContext({ assessmentId, assessment, origin = { kind: "standalone" } }) {
  return {
    assessment: {
      assessment_id: assessmentId,
      ...Object.fromEntries(["target", "profile", "scope", "environment"].map((key) => [key, structuredClone(assessment[key])]))
    },
    origin: structuredClone(origin)
  };
}

export function humanReviewRunContext({ run, artifact, artifactSha256 }) {
  requireValue(run.target_inventory && artifact.run_id === run.run_id, "Run-backed review needs the bound target inventory and a same-run artifact.");
  return humanReviewContext({ assessmentId: run.run_id, assessment: run, origin: {
    kind: "audit_run", run_id: run.run_id, artifact_id: artifact.artifact_id,
    artifact_sha256: artifactSha256, target_binding_sha256: attestationDigest(run.target_inventory),
    input_artifacts: artifact.inputs.map(({ artifact_id, sha256 }) => ({ artifact_id, sha256 }))
      .sort((left, right) => left.artifact_id < right.artifact_id ? -1 : left.artifact_id > right.artifact_id ? 1 : 0)
  } });
}

export function createHumanReviewRecord({ reviewerId, review, context }) {
  const record = { schema_version: "1.0.0", reviewer_id: reviewerId, context: structuredClone(context), review: structuredClone(review), attestation: null };
  validateHumanReviewRecord(record);
  return record;
}

export function humanReviewSigningSubject(record) {
  validateHumanReviewRecord(record);
  return {
    subject_type: "information-accessibility-human-review-v1",
    schema_version: record.schema_version,
    reviewer_id: record.reviewer_id,
    context: structuredClone(record.context),
    review: structuredClone(record.review)
  };
}

export function humanReviewTargetContextSha256(context) {
  return attestationDigest(context.assessment);
}

// The context must be reconstructed from the recipient's actual assessment/run,
// not copied from the record being checked. Run-backed records additionally
// require the exact registered source artifact bytes. This API verifies review
// provenance, not the correctness or completeness of an accessibility outcome.
export function verifyHumanReviewRecord({ record, expectedContext, sourceArtifactBytes, trust }) {
  const subject = humanReviewSigningSubject(record);
  requireValue(expectedContext && hasSameJson(record.context, expectedContext), "Human review context does not match the independently reconstructed assessment/run context.");
  if (record.context.origin.kind === "audit_run") {
    requireValue(Buffer.isBuffer(sourceArtifactBytes), "Run-backed human review requires the registered source artifact bytes.");
    const actualHash = crypto.createHash("sha256").update(sourceArtifactBytes).digest("hex");
    const origin = record.context.origin;
    requireValue(actualHash === origin.artifact_sha256, "Human review source artifact byte hash mismatch.");
    const artifact = parseAttestationJson(sourceArtifactBytes);
    requireValue(artifact.run_id === origin.run_id && artifact.artifact_id === origin.artifact_id
      && artifact.artifact_type === "declared-human-review"
      && artifact.producer?.role_id === "declared_external_human" && artifact.producer?.producer_kind === "external_human"
      && hasSameJson(artifact.payload, record.review), "Human review source artifact identity, role or payload mismatch.");
  } else {
    requireValue(sourceArtifactBytes === undefined, "Standalone reviews must not accept a run source artifact.");
  }
  if (record.attestation !== null) {
    requireValue(record.attestation.statement?.signer_id === record.reviewer_id, "Attestation signer must match the declared reviewer_id; a different person's signature cannot authenticate this reviewer.");
  }
  const verification = attestationVerificationResult(verifyDetachedAttestation({
    attestation: record.attestation, subject, kind: "human_review",
    targetContextSha256: humanReviewTargetContextSha256(expectedContext), trust
  }));
  return {
    assurance: verification.assurance === "unsigned" ? "self_declared" : verification.assurance,
    reviewer_identity_authenticated: verification.signer_identity_authenticated,
    signature_valid: verification.signature_valid,
    verified_at: verification.verified_at,
    time_assurance: verification.time_assurance,
    context_matched: true,
    source_artifact_bytes_matched: record.context.origin.kind === "audit_run",
    review_correctness_verified: false,
    // Private identifiers and key material are deliberately absent. Consumers
    // needing signed provenance retain the input record in private storage.
    verification_only: true
  };
}
