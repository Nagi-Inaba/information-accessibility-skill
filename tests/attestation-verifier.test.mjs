import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { canonicalAttestationJson, parseAttestationJson, attestationDigest } from "../codex/skills/information-accessibility-practice/scripts/lib/attestation-canonical.mjs";
import { validateAttestationTrustPolicy, createAttestationTrust, attestationSigningBytes, verifyDetachedAttestation, attestationVerificationResult } from "../codex/skills/information-accessibility-practice/scripts/lib/attestation-verifier.mjs";

const date = (delta) => new Date(Date.now() + delta).toISOString();
const context = attestationDigest({ target: "synthetic-review-fixture", version: "1" });
function fixture(overrides = {}) {
  // Ephemeral test keys only. No production key or real human attestation is
  // created, persisted, installed as trusted, or sent to any external service.
  const keys = crypto.generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ format: "jwk" });
  const subject = { reviewer_id: "reviewer-test", outcome: "fail", evidence: [{ observation: "Synthetic fixture", captured_at: date(-5000) }] };
  const policy = { schema_version: "1.0.0", policy_id: "recipient-selected-policy", valid_from: date(-600_000), valid_until: date(600_000),
    signers: [{ signer_id: "reviewer-test", key_id: "review-key-1", subject_type: "human", organization: "Fixture Review Organization",
      roles: ["reviewer"], kinds: ["human_review", "audit_bundle"], assurance_ceiling: "independent", target_context_sha256: [context], public_key: publicKey,
      valid_from: date(-600_000), valid_until: date(600_000), revoked_at: null }] };
  const statement = { schema_version: "1.0.0", kind: "human_review", canonicalization: "RFC8785", algorithm: "Ed25519",
    subject_sha256: attestationDigest(subject), target_context_sha256: context, signer_id: "reviewer-test", key_id: "review-key-1", role: "reviewer",
    assurance_requested: "signed", signed_at: date(-1000), expires_at: date(60_000), predecessor_attestation_sha256: null, ...overrides };
  const sign = (value = statement, signingKey = keys.privateKey) => ({ statement: structuredClone(value), public_key: publicKey,
    signature: crypto.sign(null, attestationSigningBytes(value), signingKey).toString("base64url") });
  return { keys, subject, policy, statement, sign };
}
function verify(f, { policy = f.policy, envelope = f.sign(), subject = f.subject, kind = "human_review", targetContextSha256 = context, ...rest } = {}) {
  const trust = policy === null ? undefined : createAttestationTrust(policy, attestationDigest(policy));
  return attestationVerificationResult(verifyDetachedAttestation({ attestation: envelope, subject, kind, targetContextSha256, trust, ...rest }));
}

test("signature canonicalization follows UTF-16 ordering and ECMAScript number serialization", () => {
  // Sorting vector from RFC 8785 section 3.2.3; numeric property names must not
  // be reordered by constructing a JavaScript object and JSON.stringify-ing it.
  const value = { "€": "Euro", "\r": "Return", "דּ": "Hebrew", "1": "One", "😀": "Emoji", "\u0080": "Control", "ö": "Latin" };
  assert.equal(canonicalAttestationJson(value), '{"\\r":"Return","1":"One","\u0080":"Control","ö":"Latin","€":"Euro","😀":"Emoji","דּ":"Hebrew"}');
  assert.equal(canonicalAttestationJson({ "2": 2, "10": 10 }), '{"10":10,"2":2}');
  assert.equal(canonicalAttestationJson([333333333.33333329, 1e30, 4.50, 2e-3, 1e-27, -0]), "[333333333.3333333,1e+30,4.5,0.002,1e-27,0]");
  assert.equal(attestationDigest({ b: 2, a: 1 }), attestationDigest({ a: 1, b: 2 }));
  assert.notEqual(attestationDigest([1, 2]), attestationDigest([2, 1]));
});

test("external JSON rejects duplicate names, invalid UTF-8, non-JSON data and hostile object shapes", () => {
  for (const input of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"a":[1,]}', 'true false', '1e999', '"\\ud800"', '{"a":1,}']) {
    assert.throws(() => parseAttestationJson(Buffer.from(input)));
  }
  assert.throws(() => parseAttestationJson(Buffer.from([0xff])));
  for (const value of [NaN, Infinity, undefined, 1n, new Date(), new Map(), { a: undefined }, [, 1]]) assert.throws(() => canonicalAttestationJson(value));
  let getterCalled = false;
  assert.throws(() => canonicalAttestationJson({ get x() { getterCalled = true; return 1; } }), /accessors/);
  assert.equal(getterCalled, false);
  const hidden = []; Object.defineProperty(hidden, "hidden", { value: true });
  assert.throws(() => canonicalAttestationJson(hidden), /dense arrays/);
  const nested = parseAttestationJson(Buffer.from('{"__proto__":{"isAdmin":true},"x":1}'));
  assert.equal(Object.getPrototypeOf(nested), null);
  assert.equal({}.isAdmin, undefined);
  assert.equal(canonicalAttestationJson(nested), '{"__proto__":{"isAdmin":true},"x":1}');
});

test("unsigned and self-signed data cannot authenticate a person", () => {
  const f = fixture();
  const unsigned = verify(f, { envelope: null });
  assert.equal(unsigned.assurance, "unsigned"); assert.equal(unsigned.signer_identity_authenticated, false);
  const selfSigned = verify(f, { policy: null });
  assert.equal(selfSigned.assurance, "self_signed"); assert.equal(selfSigned.signature_valid, true); assert.equal(selfSigned.signer_identity_authenticated, false);
  const unknown = structuredClone(f.policy); unknown.signers[0].key_id = "unrelated-key";
  assert.equal(verify(f, { policy: unknown }).signer_identity_authenticated, false);
});

test("externally pinned key policy distinguishes signed, organization and independent assurances", () => {
  for (const requested of ["signed", "organization_attested", "independent"]) {
    const f = fixture({ assurance_requested: requested });
    const result = verify(f);
    assert.equal(result.assurance, requested); assert.equal(result.signer_identity_authenticated, true);
    assert.equal(result.signer.trusted, true); assert.equal(result.time_assurance, "signer_claimed_not_trusted");
    assert.equal(result.trust_policy_sha256, attestationDigest(f.policy));
  }
});

test("one-byte changes, wrong key, wrong signer and cross-target reuse fail", () => {
  const f = fixture(), signed = f.sign();
  const changed = structuredClone(f.subject); changed.outcome = "pass";
  assert.throws(() => verify(f, { envelope: signed, subject: changed }), /subject/);
  const signature = structuredClone(signed), bytes = Buffer.from(signature.signature, "base64url"); bytes[0] ^= 1;
  signature.signature = bytes.toString("base64url");
  assert.throws(() => verify(f, { envelope: signature }), /signature verification/);
  const other = crypto.generateKeyPairSync("ed25519");
  assert.throws(() => verify(f, { envelope: f.sign(f.statement, other.privateKey) }), /signature verification/);
  const signer = structuredClone(f.policy); signer.signers[0].signer_id = "different-human";
  assert.throws(() => verify(f, { policy: signer }), /signer identity/);
  const key = structuredClone(f.policy); key.signers[0].public_key = other.publicKey.export({ format: "jwk" });
  assert.throws(() => verify(f, { policy: key }), /signer identity or key/);
  assert.throws(() => verify(f, { targetContextSha256: "0".repeat(64) }), /target/);
  assert.throws(() => verify(f, { kind: "audit_bundle" }), /kind/);
});

test("expired or revoked keys and policies cannot be rescued by a backdated signer timestamp", () => {
  const f = fixture();
  for (const change of [
    (policy) => { policy.signers[0].revoked_at = date(-500); },
    (policy) => { policy.signers[0].valid_until = date(-500); },
    (policy) => { policy.valid_until = date(-500); }
  ]) {
    const policy = structuredClone(f.policy); change(policy);
    assert.throws(() => verify(f, { policy }), /expired|revoked/);
  }
  assert.throws(() => verify(f, { envelope: f.sign({ ...f.statement, signed_at: date(-10_000), expires_at: date(-1000) }) }), /expired/);
  assert.throws(() => verify(f, { envelope: f.sign({ ...f.statement, signed_at: date(10_000) }) }), /not yet valid/);
});

test("human status and assurance require the external policy's kind, role and exact target scope", () => {
  const f = fixture({ assurance_requested: "independent" });
  for (const change of [
    (signer) => { signer.subject_type = "organization"; },
    (signer) => { signer.assurance_ceiling = "signed"; },
    (signer) => { signer.roles = ["executor"]; },
    (signer) => { signer.kinds = ["audit_bundle"]; },
    (signer) => { signer.target_context_sha256 = ["0".repeat(64)]; }
  ]) {
    const policy = structuredClone(f.policy); change(policy.signers[0]);
    assert.throws(() => verify(f, { policy }), /human reviewer|assurance|trust scope/);
  }
});

test("the external policy pin and live verification handles cannot be supplied by saved result JSON", () => {
  const f = fixture();
  assert.throws(() => createAttestationTrust(f.policy), /pin/);
  assert.throws(() => createAttestationTrust(f.policy, "0".repeat(64)), /pin/);
  const trust = createAttestationTrust(f.policy, attestationDigest(f.policy));
  const input = { attestation: f.sign(), subject: f.subject, kind: "human_review", targetContextSha256: context };
  assert.throws(() => verifyDetachedAttestation({ ...input, trust: JSON.parse(JSON.stringify(trust)) }), /live verified/);
  const result = verifyDetachedAttestation({ ...input, trust });
  assert.throws(() => attestationVerificationResult(verify(f)), /in-process/);
  assert.throws(() => attestationVerificationResult(JSON.parse(JSON.stringify(result))), /in-process/);
  f.policy.signers[0].subject_type = "organization";
  assert.equal(attestationVerificationResult(verifyDetachedAttestation({ ...input, trust })).signer_identity_authenticated, true);
});

test("key rotation permits a new key but never revives the revoked old key", () => {
  const f = fixture(), next = fixture(), policy = structuredClone(f.policy);
  policy.signers[0].revoked_at = date(-500);
  policy.signers.push({ ...policy.signers[0], key_id: "review-key-2", public_key: next.keys.publicKey.export({ format: "jwk" }), revoked_at: null });
  const statement = { ...f.statement, key_id: "review-key-2" };
  const envelope = { statement, public_key: policy.signers[1].public_key, signature: crypto.sign(null, attestationSigningBytes(statement), next.keys.privateKey).toString("base64url") };
  assert.equal(verify(f, { policy, envelope }).signer_identity_authenticated, true);
  assert.throws(() => verify(f, { policy }), /revoked/);
});

test("predecessor hash is signed and binding is distinguished from verifying the prior attestation", () => {
  const parent = fixture(), predecessor = attestationDigest(parent.sign());
  const f = fixture({ predecessor_attestation_sha256: predecessor });
  assert.throws(() => verify(f), /predecessor/);
  const result = verify(f, { expectedPredecessor: predecessor });
  assert.equal(result.predecessor_bound, true);
  assert.equal(Object.hasOwn(result, "predecessor_verified"), false);
});

test("invalid algorithms, private key fields, duplicate key identities and empty IDs are rejected", () => {
  const f = fixture();
  assert.throws(() => attestationSigningBytes({ ...f.statement, algorithm: "none" }), /protocol/);
  for (const id of [null, true, 1, "", "bad identity"]) assert.throws(() => attestationSigningBytes({ ...f.statement, signer_id: id }), /signer/);
  const secret = structuredClone(f.policy); secret.signers[0].public_key.d = f.keys.privateKey.export({ format: "jwk" }).d;
  assert.throws(() => validateAttestationTrustPolicy(secret), /public key fields/);
  const duplicate = structuredClone(f.policy); duplicate.signers.push({ ...duplicate.signers[0], signer_id: "different", key_id: "second" });
  assert.throws(() => validateAttestationTrustPolicy(duplicate), /same public key/);
});
