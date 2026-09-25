import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { attestationDigest } from "../codex/skills/information-accessibility-practice/scripts/lib/attestation-canonical.mjs";
import { createAttestationTrust, attestationSigningBytes } from "../codex/skills/information-accessibility-practice/scripts/lib/attestation-verifier.mjs";
import { createHumanReviewRecord, humanReviewContext, humanReviewSigningSubject, humanReviewTargetContextSha256, verifyHumanReviewRecord, validateHumanReviewRecord } from "../codex/skills/information-accessibility-practice/scripts/lib/human-review-provenance.mjs";

const date = (delta) => new Date(Date.now() + delta).toISOString();
function fixture(runBacked = false) {
  const assessment = {
    target: { name: "Synthetic target", version_or_commit: "fixture-v1", urls_or_files: ["fixture.html"] },
    profile: { id: "web-modern", registry_version: "1.0.0" },
    scope: { included: ["fixture.html"], excluded: [], complete_processes: [], third_party_content: [], full_pages_reviewed: false },
    environment: { os: ["Fixture OS"], browsers: ["Fixture Browser"], assistive_technologies: [], input_modes: ["keyboard"] }
  };
  const review = {
    schema_version: "1.0.0", declaration: "Synthetic declared review; not a real audit.", reviewer_name: "PRIVATE Fixture Name",
    review_date: date(-1000).slice(0, 10), identity_authenticated: false,
    reviews: [{ requirement_id: "WCAG-2.2-SC-1.1.1", procedure_availability: "unavailable", criterion_procedure_ref: null,
      generic_method_ref: "web-audit-methods:1.0.0#non-text-content", official_sources: ["https://www.w3.org/TR/WCAG22/#non-text-content"],
      target_specific_evidence: [{ type: "manual_observation", location: "fixture.html#image", observation: "Synthetic observation", captured_at: date(-5000) }],
      profile_outcome: "fail", rationale: "Synthetic rationale" }]
  };
  const artifact = { run_id: "RUN-REVIEW-001", artifact_id: "ART-HUMAN-001", artifact_type: "declared-human-review",
    producer: { role_id: "declared_external_human", producer_kind: "external_human" }, payload: review };
  const sourceArtifactBytes = Buffer.from(JSON.stringify(artifact));
  const origin = runBacked ? { kind: "audit_run", run_id: artifact.run_id, artifact_id: artifact.artifact_id,
    artifact_sha256: crypto.createHash("sha256").update(sourceArtifactBytes).digest("hex"), target_binding_sha256: "a".repeat(64),
    input_artifacts: [{ artifact_id: "ART-QUEUE-001", sha256: "b".repeat(64) }] } : { kind: "standalone" };
  const context = humanReviewContext({ assessmentId: runBacked ? artifact.run_id : "ASSESSMENT-REVIEW-001", assessment, origin });
  const record = createHumanReviewRecord({ reviewerId: "private-reviewer-id", review, context });
  const keys = crypto.generateKeyPairSync("ed25519");
  const policy = { schema_version: "1.0.0", policy_id: "external-recipient-policy", valid_from: date(-600_000), valid_until: date(600_000),
    signers: [{ signer_id: record.reviewer_id, key_id: "private-key-id", subject_type: "human", organization: "Private Synthetic Organization",
      roles: ["private-reviewer-role"], kinds: ["human_review"], assurance_ceiling: "independent", target_context_sha256: [humanReviewTargetContextSha256(context)],
      public_key: keys.publicKey.export({ format: "jwk" }), valid_from: date(-600_000), valid_until: date(600_000), revoked_at: null }] };
  const sign = (candidate = record, requested = "signed", signerId = record.reviewer_id) => {
    const signed = structuredClone(candidate);
    const statement = { schema_version: "1.0.0", kind: "human_review", canonicalization: "RFC8785", algorithm: "Ed25519",
      subject_sha256: attestationDigest(humanReviewSigningSubject(signed)), target_context_sha256: humanReviewTargetContextSha256(signed.context),
      signer_id: signerId, key_id: "private-key-id", role: "private-reviewer-role", assurance_requested: requested,
      signed_at: date(-500), expires_at: date(60_000), predecessor_attestation_sha256: null };
    signed.attestation = { statement, public_key: policy.signers[0].public_key, signature: crypto.sign(null, attestationSigningBytes(statement), keys.privateKey).toString("base64url") };
    return signed;
  };
  const verify = (candidate = record, extra = {}) => verifyHumanReviewRecord({ record: candidate, expectedContext: context,
    ...(runBacked ? { sourceArtifactBytes } : {}), ...extra });
  return { record, assessment, context, review, sourceArtifactBytes, policy, sign, verify,
    trust: createAttestationTrust(policy, attestationDigest(policy)) };
}

test("standalone and run-backed records share the same derived reviewer assurance contract", () => {
  for (const runBacked of [false, true]) {
    const f = fixture(runBacked);
    assert.equal(f.verify().assurance, "self_declared");
    assert.equal(f.verify().reviewer_identity_authenticated, false);
    assert.equal(f.verify(f.sign()).assurance, "self_signed");
    assert.equal(f.verify(f.sign()).reviewer_identity_authenticated, false);
    for (const assurance of ["signed", "organization_attested", "independent"]) {
      const verified = f.verify(f.sign(f.record, assurance), { trust: f.trust });
      assert.equal(verified.assurance, assurance);
      assert.equal(verified.reviewer_identity_authenticated, true);
      assert.equal(verified.source_artifact_bytes_matched, runBacked);
      assert.equal(verified.review_correctness_verified, false);
      for (const secret of ["PRIVATE Fixture Name", "private-reviewer-id", "private-key-id", "private-reviewer-role", "Private Synthetic Organization"]) {
        assert.equal(JSON.stringify(verified).includes(secret), false);
      }
    }
  }
});

test("a trusted human cannot authenticate a different reviewer by signing that person's record", () => {
  const f = fixture();
  const forged = structuredClone(f.record); forged.reviewer_id = "a-different-reviewer";
  assert.throws(() => f.verify(f.sign(forged, "signed", f.record.reviewer_id), { trust: f.trust }), /signer must match/);
});

test("another run, artifact, target snapshot or queue cannot reuse an existing signed record", () => {
  const f = fixture(true), signed = f.sign();
  for (const change of [
    (context) => { context.origin.run_id = "RUN-REVIEW-002"; context.assessment.assessment_id = "RUN-REVIEW-002"; },
    (context) => { context.origin.artifact_id = "ART-HUMAN-002"; },
    (context) => { context.origin.target_binding_sha256 = "c".repeat(64); },
    (context) => { context.origin.input_artifacts[0].sha256 = "c".repeat(64); },
    (context) => { context.assessment.target.version_or_commit = "fixture-v2"; },
    (context) => { context.assessment.scope.included.push("second.html"); },
    (context) => { context.assessment.environment.input_modes = ["touch"]; }
  ]) {
    const expectedContext = structuredClone(f.context); change(expectedContext);
    assert.throws(() => f.verify(signed, { expectedContext, trust: f.trust }), /context does not match/);
    const rewrapped = structuredClone(signed); rewrapped.context = expectedContext;
    assert.throws(() => f.verify(rewrapped, { expectedContext, trust: f.trust }), /subject|source artifact identity/);
  }
});

test("run provenance requires exact source bytes and an independently supplied context", () => {
  const f = fixture(true);
  assert.throws(() => f.verify(f.record, { expectedContext: undefined }), /independently reconstructed/);
  assert.throws(() => f.verify(f.record, { sourceArtifactBytes: undefined }), /registered source artifact bytes/);
  assert.throws(() => f.verify(f.record, { sourceArtifactBytes: Buffer.concat([f.sourceArtifactBytes, Buffer.from(" ")]) }), /byte hash/);
  const artifact = JSON.parse(f.sourceArtifactBytes); artifact.payload.reviews[0].profile_outcome = "pass";
  const sourceArtifactBytes = Buffer.from(JSON.stringify(artifact)), expectedContext = structuredClone(f.context);
  expectedContext.origin.artifact_sha256 = crypto.createHash("sha256").update(sourceArtifactBytes).digest("hex");
  const record = structuredClone(f.record); record.context = expectedContext;
  assert.throws(() => f.verify(record, { sourceArtifactBytes, expectedContext }), /payload mismatch/);
  const standalone = fixture();
  assert.throws(() => standalone.verify(standalone.record, { sourceArtifactBytes }), /must not accept a run/);
});

test("serialized assurance, actor claims, duplicate rows and ambiguous input identifiers fail closed", () => {
  const f = fixture(true);
  for (const change of [
    (record) => { record.identity_authenticated = true; },
    (record) => { record.assurance = "independent"; },
    (record) => { record.review.identity_authenticated = true; },
    (record) => { record.review.reviews.push(record.review.reviews[0]); },
    (record) => { record.context.origin.input_artifacts.push({ artifact_id: "ART-QUEUE-001", sha256: "d".repeat(64) }); },
    (record) => { record.context.origin.input_artifacts.push({ artifact_id: "ART-ALPHA-001", sha256: "d".repeat(64) }); },
    (record) => { record.context.assessment.assessment_id = "different-assessment"; }
  ]) {
    const record = structuredClone(f.record); change(record);
    assert.throws(() => validateHumanReviewRecord(record));
  }
});

test("one changed review observation invalidates the detached signature", () => {
  const f = fixture(), record = f.sign();
  record.review.reviews[0].target_specific_evidence[0].observation += "!";
  assert.throws(() => f.verify(record, { trust: f.trust }), /subject/);
});
