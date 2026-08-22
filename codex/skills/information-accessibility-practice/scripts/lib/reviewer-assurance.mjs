export const reviewerAssuranceLevels = Object.freeze(["self_declared", "account_bound", "signed", "organization_attested", "independent"]);

const labels = Object.freeze({
  self_declared: "Self-declared reviewer identity",
  account_bound: "Identity bound to an authenticated account",
  signed: "Cryptographically signed review",
  organization_attested: "Organization-attested reviewer identity",
  independent: "Independently assured reviewer and review process"
});

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function levelIndex(level) {
  const index = reviewerAssuranceLevels.indexOf(level);
  if (index < 0) throw new Error(`Unknown reviewer assurance level: ${String(level)}`);
  return index;
}

export function normalizeReviewerAssurance(review) {
  const supplied = review?.reviewer_assurance;
  let assurance;
  if (supplied === undefined) {
    assurance = {
      level: review?.identity_authenticated === true ? "account_bound" : "self_declared",
      subject: review?.reviewer_id ?? review?.reviewer_name ?? null,
      issuer: review?.identity_authenticated === true ? "legacy_authenticated_identity" : "reviewer_declaration",
      evidence_refs: [],
      limitations: review?.identity_authenticated === true ? [] : ["Reviewer identity was declared but not independently authenticated."]
    };
  } else {
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new Error("reviewer_assurance must be an object");
    assurance = {
      level: supplied.level,
      subject: supplied.subject ?? review?.reviewer_id ?? review?.reviewer_name ?? null,
      issuer: supplied.issuer ?? null,
      evidence_refs: [...new Set(supplied.evidence_refs ?? [])].sort(),
      signature_ref: supplied.signature_ref ?? null,
      organization: supplied.organization ?? null,
      attestation_ref: supplied.attestation_ref ?? null,
      independence_statement: supplied.independence_statement ?? null,
      limitations: [...new Set(supplied.limitations ?? [])]
    };
  }

  const index = levelIndex(assurance.level);
  if (review?.producer?.producer_kind === "ai_agent" && index > 0) {
    throw new Error("AI producers cannot assert reviewer assurance above self_declared");
  }
  if (index > 0) requireText(assurance.subject, "reviewer assurance subject");
  if (index >= 1) requireText(assurance.issuer, "reviewer assurance issuer");
  if (index >= 2) requireText(assurance.signature_ref, "signature_ref");
  if (index >= 3) {
    requireText(assurance.organization, "organization");
    requireText(assurance.attestation_ref, "attestation_ref");
  }
  if (index >= 4) requireText(assurance.independence_statement, "independence_statement");

  return {
    ...assurance,
    level_index: index,
    label: labels[assurance.level],
    human_verification_effect: "none",
    claim_effect: assurance.level === "independent" ? "may_support_formal_claim_with_other_required_evidence" : "does_not_raise_claim_tier"
  };
}

export function compareReviewerAssurance(left, right) {
  return levelIndex(normalizeReviewerAssurance({ reviewer_assurance: left }).level)
    - levelIndex(normalizeReviewerAssurance({ reviewer_assurance: right }).level);
}
