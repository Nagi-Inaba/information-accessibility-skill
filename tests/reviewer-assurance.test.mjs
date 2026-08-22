import assert from "node:assert/strict";
import test from "node:test";
import { compareReviewerAssurance, normalizeReviewerAssurance, reviewerAssuranceLevels } from "../codex/skills/information-accessibility-practice/scripts/lib/reviewer-assurance.mjs";

test("legacy reviewer identity fields map conservatively to assurance levels", () => {
  const declared = normalizeReviewerAssurance({ reviewer_name: "Reviewer", identity_authenticated: false });
  assert.equal(declared.level, "self_declared");
  assert.match(declared.limitations[0], /not independently authenticated/u);
  assert.equal(declared.human_verification_effect, "none");

  const account = normalizeReviewerAssurance({ reviewer_id: "account-123", identity_authenticated: true });
  assert.equal(account.level, "account_bound");
  assert.equal(account.subject, "account-123");
  assert.equal(account.claim_effect, "does_not_raise_claim_tier");
});

test("signed, organization-attested, and independent levels require their own evidence", () => {
  const signed = normalizeReviewerAssurance({ reviewer_assurance: {
    level: "signed",
    subject: "reviewer@example.invalid",
    issuer: "Example signing service",
    signature_ref: "signatures/review-1.sig",
    evidence_refs: ["EVIDENCE-2", "EVIDENCE-1"]
  } });
  assert.equal(signed.level_index, 2);
  assert.deepEqual(signed.evidence_refs, ["EVIDENCE-1", "EVIDENCE-2"]);

  assert.throws(() => normalizeReviewerAssurance({ reviewer_assurance: {
    level: "organization_attested",
    subject: "reviewer@example.invalid",
    issuer: "Example Corp"
  } }), /organization|attestation_ref/u);

  const independent = normalizeReviewerAssurance({ reviewer_assurance: {
    level: "independent",
    subject: "reviewer@example.invalid",
    issuer: "Independent auditor",
    signature_ref: "signatures/audit.sig",
    organization: "Independent Audit Ltd.",
    attestation_ref: "attestations/org.json",
    independence_statement: "No financial or implementation responsibility for the reviewed target."
  } });
  assert.equal(independent.claim_effect, "may_support_formal_claim_with_other_required_evidence");
});

test("AI producers cannot assert elevated reviewer assurance", () => {
  assert.throws(() => normalizeReviewerAssurance({
    producer: { producer_kind: "ai_agent" },
    reviewer_assurance: { level: "account_bound", subject: "model", issuer: "model" }
  }), /AI producers/u);
});

test("assurance levels have a stable order without changing human outcomes", () => {
  assert.deepEqual(reviewerAssuranceLevels, ["self_declared", "account_bound", "signed", "organization_attested", "independent"]);
  assert.ok(compareReviewerAssurance("independent", "signed") > 0);
  assert.ok(compareReviewerAssurance({ level: "self_declared" }, { level: "account_bound" }) < 0);
});
