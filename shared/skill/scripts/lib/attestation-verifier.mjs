import crypto from "node:crypto";
import { canonicalAttestationJson, attestationDigest } from "./attestation-canonical.mjs";
import { isRfc3339DateTime } from "./date-time.mjs";

const trustContexts = new WeakMap();
const verificationResults = new WeakMap();
const kinds = ["human_review", "audit_bundle"];
const assuranceOrder = ["signed", "organization_attested", "independent"];
const digestPattern = /^[a-f0-9]{64}$/u;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const isId = (value) => typeof value === "string" && idPattern.test(value);
const domain = Buffer.from("information-accessibility-attestation-v1\0", "utf8");

function requireValue(condition, message) { if (!condition) throw new Error(message); }
function exact(value, keys, label) {
  requireValue(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"), `Invalid ${label} fields.`);
}
function texts(values, label, maximum = 32) {
  requireValue(Array.isArray(values) && values.length > 0 && values.length <= maximum
    && new Set(values).size === values.length && values.every((value) => typeof value === "string" && value.trim().length && value.length <= 256), `Invalid ${label}.`);
}
function instant(value, label) {
  requireValue(isRfc3339DateTime(value), `Invalid ${label}; use a real RFC 3339 instant.`);
  return Date.parse(value);
}
function base64url(value, bytes, label) {
  requireValue(typeof value === "string" && /^[A-Za-z0-9_-]+$/u.test(value), `Invalid ${label}.`);
  const decoded = Buffer.from(value, "base64url");
  requireValue(decoded.length === bytes && decoded.toString("base64url") === value, `Invalid ${label} encoding or length.`);
  return decoded;
}
function publicKey(jwk) {
  exact(jwk, ["kty", "crv", "x"], "public key");
  requireValue(jwk.kty === "OKP" && jwk.crv === "Ed25519", "Only an Ed25519 public JWK is supported.");
  base64url(jwk.x, 32, "public key");
  const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  requireValue(key.asymmetricKeyType === "ed25519", "Wrong public-key algorithm.");
  return key;
}

export function validateAttestationTrustPolicy(policy) {
  canonicalAttestationJson(policy);
  exact(policy, ["schema_version", "policy_id", "valid_from", "valid_until", "signers"], "trust policy");
  requireValue(policy.schema_version === "1.0.0" && isId(policy.policy_id), "Invalid trust policy identity/version.");
  requireValue(instant(policy.valid_from, "policy valid_from") < instant(policy.valid_until, "policy valid_until"), "Invalid trust policy interval.");
  requireValue(Array.isArray(policy.signers) && policy.signers.length > 0 && policy.signers.length <= 128, "A trust policy needs 1–128 explicit signer keys.");
  const keyIds = new Set(), keys = new Set();
  for (const signer of policy.signers) {
    exact(signer, ["signer_id", "key_id", "subject_type", "organization", "roles", "kinds", "assurance_ceiling", "target_context_sha256", "public_key", "valid_from", "valid_until", "revoked_at"], "trusted signer");
    requireValue(isId(signer.signer_id) && isId(signer.key_id) && !keyIds.has(signer.key_id), "Invalid or duplicate signer key ID.");
    requireValue(["human", "organization"].includes(signer.subject_type), "Signer subject_type must be explicit.");
    requireValue(signer.organization === null || typeof signer.organization === "string" && signer.organization.trim() && signer.organization.length <= 256, "Invalid signer organization.");
    texts(signer.roles, "signer roles"); texts(signer.kinds, "signer kinds", kinds.length);
    requireValue(signer.kinds.every((kind) => kinds.includes(kind)), "Unsupported signer subject kind.");
    requireValue(assuranceOrder.includes(signer.assurance_ceiling), "Unsupported signer assurance ceiling.");
    if (signer.assurance_ceiling !== "signed") requireValue(signer.organization !== null, "Organization and independent attestations require an explicit trusted organization.");
    texts(signer.target_context_sha256, "signer target scope", 128);
    requireValue(signer.target_context_sha256.every((hash) => digestPattern.test(hash)), "Signer scope must list exact target context hashes.");
    const key = publicKey(signer.public_key);
    const fingerprint = key.export({ format: "der", type: "spki" }).toString("hex");
    requireValue(!keys.has(fingerprint), "The same public key cannot represent multiple signer identities or roles in one policy.");
    keys.add(fingerprint); keyIds.add(signer.key_id);
    requireValue(instant(signer.valid_from, "signer valid_from") < instant(signer.valid_until, "signer valid_until"), "Invalid signer validity interval.");
    if (signer.revoked_at !== null) instant(signer.revoked_at, "signer revoked_at");
  }
  return true;
}

// The verifier's operator must select the trust policy and its pin outside the
// supplied audit/review bundle. A matching pin detects policy substitution; it
// does not make an attacker-provided policy trustworthy by itself.
export function createAttestationTrust(policy, expectedPolicySha256) {
  validateAttestationTrustPolicy(policy);
  requireValue(digestPattern.test(expectedPolicySha256) && attestationDigest(policy) === expectedPolicySha256, "An explicit matching external trust-policy SHA-256 pin is required.");
  const handle = Object.freeze({});
  trustContexts.set(handle, { policy: structuredClone(policy), hash: expectedPolicySha256 });
  return handle;
}

export function validateAttestationStatement(statement) {
  canonicalAttestationJson(statement);
  exact(statement, ["schema_version", "kind", "canonicalization", "algorithm", "subject_sha256", "target_context_sha256", "signer_id", "key_id", "role", "assurance_requested", "signed_at", "expires_at", "predecessor_attestation_sha256"], "attestation statement");
  requireValue(statement.schema_version === "1.0.0" && kinds.includes(statement.kind)
    && statement.canonicalization === "RFC8785" && statement.algorithm === "Ed25519", "Unsupported attestation protocol.");
  requireValue(digestPattern.test(statement.subject_sha256) && digestPattern.test(statement.target_context_sha256), "Attestation must bind exact subject and target hashes.");
  requireValue(isId(statement.signer_id) && isId(statement.key_id)
    && typeof statement.role === "string" && statement.role.trim() && statement.role.length <= 256, "Invalid attestation signer/role.");
  requireValue(assuranceOrder.includes(statement.assurance_requested), "Unsupported requested attestation assurance.");
  requireValue(instant(statement.signed_at, "signed_at") < instant(statement.expires_at, "expires_at"), "Invalid attestation validity interval.");
  requireValue(statement.predecessor_attestation_sha256 === null || digestPattern.test(statement.predecessor_attestation_sha256), "Invalid predecessor attestation hash.");
  return true;
}

export function attestationSigningBytes(statement) {
  validateAttestationStatement(statement);
  return Buffer.concat([domain, Buffer.from(canonicalAttestationJson(statement), "utf8")]);
}

function resultHandle(result) {
  const handle = Object.freeze({}); verificationResults.set(handle, result); return handle;
}

export function verifyDetachedAttestation({ attestation, subject, kind, targetContextSha256, trust, expectedPredecessor = null }) {
  requireValue(kinds.includes(kind) && digestPattern.test(targetContextSha256), "An independently reconstructed subject kind and target context hash are required.");
  const subjectHash = attestationDigest(subject);
  const trusted = trust === undefined ? null : trustContexts.get(trust);
  requireValue(trust === undefined || trusted, "Trust must be a live verified policy handle, not saved JSON.");
  const verifiedAt = new Date().toISOString();
  if (attestation === null) return resultHandle({ assurance: "unsigned", signature_valid: false, signer_identity_authenticated: false,
    verified_at: verifiedAt, subject_sha256: subjectHash, trust_policy_sha256: trusted?.hash ?? null, signer: null,
    time_assurance: "not_established", predecessor_bound: false });
  canonicalAttestationJson(attestation);
  exact(attestation, ["statement", "public_key", "signature"], "detached attestation");
  const statement = attestation.statement;
  validateAttestationStatement(statement);
  requireValue(statement.kind === kind && statement.subject_sha256 === subjectHash
    && statement.target_context_sha256 === targetContextSha256, "Attestation subject, target or kind mismatch.");
  requireValue(statement.predecessor_attestation_sha256 === expectedPredecessor, "Attestation predecessor binding mismatch.");
  const now = Date.now();
  requireValue(Date.parse(statement.signed_at) <= now && now < Date.parse(statement.expires_at), "Attestation is expired or not yet valid; a signer timestamp is not a trusted timestamp.");
  const key = publicKey(attestation.public_key), signature = base64url(attestation.signature, 64, "signature");
  requireValue(crypto.verify(null, attestationSigningBytes(statement), key, signature), "Attestation signature verification failed.");
  const signer = trusted?.policy.signers.find((item) => item.key_id === statement.key_id);
  if (!signer) return resultHandle({ assurance: "self_signed", signature_valid: true, signer_identity_authenticated: false,
    verified_at: verifiedAt, subject_sha256: subjectHash, trust_policy_sha256: trusted?.hash ?? null,
    signer: { signer_id: statement.signer_id, role: statement.role, trusted: false },
    time_assurance: "signer_claimed_not_trusted", predecessor_bound: expectedPredecessor !== null });
  const policy = trusted.policy;
  requireValue(Date.parse(policy.valid_from) <= now && now < Date.parse(policy.valid_until), "External trust policy is expired or not yet valid.");
  requireValue(signer.signer_id === statement.signer_id && attestationDigest(signer.public_key) === attestationDigest(attestation.public_key), "Attestation signer identity or key does not match the external policy.");
  requireValue(signer.revoked_at === null, "Signer key is revoked; backdating signed_at cannot restore trust without an independently trusted timestamp.");
  requireValue(Date.parse(signer.valid_from) <= Date.parse(statement.signed_at) && Date.parse(statement.expires_at) <= Date.parse(signer.valid_until)
    && Date.parse(signer.valid_from) <= now && now < Date.parse(signer.valid_until), "Signer key is expired or outside its authorized signing interval.");
  requireValue(signer.roles.includes(statement.role) && signer.kinds.includes(kind) && signer.target_context_sha256.includes(targetContextSha256), "Signer role, subject kind or target is outside external trust scope.");
  requireValue(kind !== "human_review" || signer.subject_type === "human", "An organization or agent key cannot authenticate a human reviewer.");
  requireValue(assuranceOrder.indexOf(statement.assurance_requested) <= assuranceOrder.indexOf(signer.assurance_ceiling), "Requested assurance exceeds the external signer policy.");
  return resultHandle({ assurance: statement.assurance_requested, signature_valid: true,
    signer_identity_authenticated: signer.subject_type === "human", verified_at: verifiedAt,
    subject_sha256: subjectHash, trust_policy_sha256: trusted.hash,
    signer: { signer_id: signer.signer_id, role: statement.role, organization: signer.organization, trusted: true },
    time_assurance: "signer_claimed_not_trusted", predecessor_bound: expectedPredecessor !== null });
}

export function attestationVerificationResult(handle) {
  const result = verificationResults.get(handle);
  requireValue(result, "Expected an in-process verification result; serialized claims are not verification.");
  return structuredClone(result);
}
