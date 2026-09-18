import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prepareAuditBundle, verifyAuditBundle, verifyAuditBundleChain, auditBundleSigningSubject, auditBundleTargetContextSha256, auditBundlePredecessor } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-bundle.mjs";
import { validateAuditRun } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { attestationDigest } from "../codex/skills/information-accessibility-practice/scripts/lib/attestation-canonical.mjs";
import { createAttestationTrust, attestationSigningBytes } from "../codex/skills/information-accessibility-practice/scripts/lib/attestation-verifier.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliFile = path.join(root, "codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value), "utf8");
const date = (delta) => new Date(Date.now() + delta).toISOString();
const cli = (args) => spawnSync(process.execPath, [cliFile, "audit-bundle", ...args], { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const success = (result) => { assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout); };
let templateDirectory;
test.before(() => {
  templateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-bundle-template-"));
  const result = spawnSync(process.execPath, [path.join(root, "examples/run-backed-web-audit/run.mjs"), "--output", path.join(templateDirectory, "example")], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
test.after(() => fs.rmSync(templateDirectory, { recursive: true, force: true }));
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-bundle-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bundleRoot = path.join(directory, "bundle");
  fs.cpSync(path.join(templateDirectory, "example/human-reviewed"), bundleRoot, { recursive: true });
  const runFile = path.join(bundleRoot, "audit-run.json"), assessmentFile = path.join(bundleRoot, "merged-assessment.json"), report = path.join(bundleRoot, "audit-report.md");
  const attachment = path.join(bundleRoot, "saved-target.txt"); fs.writeFileSync(attachment, "Synthetic retained target bytes", "utf8");
  const inputs = { root: bundleRoot, runFile, assessmentFile, reports: [report], attachments: [attachment], bundleId: "BUNDLE-CURRENT" };
  return { directory, bundleRoot, runFile, assessmentFile, report, attachment, inputs, record: prepareAuditBundle(inputs).record };
}
function signer(records, { signerId = "TEST-ORGANIZATION", keyId = "TEST-KEY-1", ceiling = "independent" } = {}) {
  // Synthetic, in-memory keys only; no production identity or installed trust.
  const keys = crypto.generateKeyPairSync("ed25519"), publicKey = keys.publicKey.export({ format: "jwk" });
  const policy = { schema_version: "1.0.0", policy_id: "TEST-RECIPIENT-POLICY", valid_from: date(-600_000), valid_until: date(600_000), signers: [{
    signer_id: signerId, key_id: keyId, subject_type: "organization", organization: "Synthetic Fixture Organization", roles: ["archive-custodian"], kinds: ["audit_bundle"],
    assurance_ceiling: ceiling, target_context_sha256: [...new Set(records.map((record) => auditBundleTargetContextSha256(record.manifest.context)))],
    public_key: publicKey, valid_from: date(-600_000), valid_until: date(600_000), revoked_at: null }] };
  function sign(record, overrides = {}) {
    const statement = { schema_version: "1.0.0", kind: "audit_bundle", canonicalization: "RFC8785", algorithm: "Ed25519",
      subject_sha256: attestationDigest(auditBundleSigningSubject(record)), target_context_sha256: auditBundleTargetContextSha256(record.manifest.context),
      signer_id: signerId, key_id: keyId, role: "archive-custodian", assurance_requested: "organization_attested", signed_at: date(-1000), expires_at: date(300_000),
      predecessor_attestation_sha256: record.manifest.predecessor?.attestation_sha256 ?? null, ...overrides };
    record.attestation = { statement, public_key: publicKey, signature: crypto.sign(null, attestationSigningBytes(statement), keys.privateKey).toString("base64url") };
    return record;
  }
  return { policy, sign, trust: () => createAttestationTrust(policy, attestationDigest(policy)) };
}

test("offline CLI binds registered evidence, assessment, reports and explicit attachments; relocation preserves verification", (t) => {
  const f = fixture(t), recordFile = path.join(f.directory, "record.json");
  const original = new Map(f.record.manifest.files.map((item) => [item.path, fs.readFileSync(path.join(f.bundleRoot, item.path))]));
  const args = ["prepare", "--root", f.bundleRoot, "--run", f.runFile, "--assessment", f.assessmentFile, "--report", f.report,
    "--attachment", f.attachment, "--bundle-id", "BUNDLE-CLI", "--output", recordFile];
  const prepared = success(cli(args));
  assert.equal(prepared.assurance, "unsigned"); assert.equal(prepared.signature_valid, false);
  assert.equal(prepared.entire_target_archive_verified, false); assert.equal(prepared.report_semantics_verified, false);
  assert.notEqual(cli(args).status, 0, "Existing records must not be overwritten");
  const record = read(recordFile);
  assert.equal(record.manifest.artifacts.length, read(f.runFile).artifacts.length);
  assert.ok(record.manifest.evidence.length > 0); assert.deepEqual(record.manifest.attachments, ["saved-target.txt"]);
  const unsigned = success(cli(["verify", "--root", f.bundleRoot, "--record", recordFile]));
  assert.equal(unsigned.current_file_bytes_verified, true); assert.equal(unsigned.signer_policy_matched, false);
  assert.notEqual(cli(["verify", "--root", f.bundleRoot, "--record", recordFile, "--minimum-assurance", "signed"]).status, 0);
  const auth = signer([record]); auth.sign(record); write(recordFile, record);
  const policyFile = path.join(f.directory, "recipient-policy.json"); write(policyFile, auth.policy);
  const copiedRoot = path.join(f.directory, "recipient-copy"); fs.cpSync(f.bundleRoot, copiedRoot, { recursive: true });
  const verified = success(cli(["verify", "--root", copiedRoot, "--record", recordFile, "--trust-policy", policyFile, "--trust-policy-sha256", attestationDigest(auth.policy),
    "--minimum-assurance", "organization_attested", "--require-complete-chain", "--expected-subject-sha256", prepared.subject_sha256]));
  assert.equal(verified.assurance, "organization_attested"); assert.equal(verified.signer_policy_matched, true);
  assert.equal(verified.chain_complete, true); assert.equal(verified.expected_subject_matched, true); assert.equal(verified.latest_version_verified, false);
  assert.equal(verified.historical_file_bytes_verified, false); assert.equal(verified.correctness_verified, false); assert.equal(verified.conformance_elevated, false);
  assert.equal(verified.time_assurance, "signer_claimed_not_trusted");
  assert.doesNotMatch(JSON.stringify(verified), /TEST-ORGANIZATION|archive-custodian|saved-target/);
  for (const [name, bytes] of original) assert.deepEqual(fs.readFileSync(path.join(f.bundleRoot, name)), bytes);
});

test("one-byte changes in every committed file and wholesale rehashing cannot preserve an external signature", (t) => {
  const f = fixture(t), auth = signer([f.record]); auth.sign(f.record);
  for (const item of f.record.manifest.files) {
    const file = path.join(f.bundleRoot, item.path), bytes = fs.readFileSync(file), changed = Buffer.from(bytes);
    if (changed.length) changed[0] ^= 1;
    fs.writeFileSync(file, changed.length ? changed : Buffer.from("x"));
    assert.throws(() => verifyAuditBundle({ root: f.bundleRoot, record: f.record, trust: auth.trust() }), /committed hash and size/, item.path);
    fs.writeFileSync(file, bytes);
  }
  const forged = structuredClone(f.record);
  forged.manifest.files.find((item) => item.path === "audit-report.md").sha256 = "f".repeat(64);
  assert.throws(() => verifyAuditBundle({ root: f.bundleRoot, record: forged, trust: auth.trust() }), /subject, target or kind mismatch/);
  const omitted = structuredClone(f.record), omittedPath = omitted.manifest.evidence[0];
  omitted.manifest.evidence = omitted.manifest.evidence.filter((item) => item !== omittedPath);
  omitted.manifest.files = omitted.manifest.files.filter((item) => item.path !== omittedPath);
  omitted.attestation = null;
  assert.throws(() => verifyAuditBundle({ root: f.bundleRoot, record: omitted }), /exactly cover/);
  fs.unlinkSync(f.report);
  assert.throws(() => verifyAuditBundle({ root: f.bundleRoot, record: f.record, trust: auth.trust() }), /Missing/);
});

test("recipient trust controls assurance, signer identity, role, kind, scope, expiry and revocation", (t) => {
  const f = fixture(t), auth = signer([f.record]);
  for (const assurance of ["signed", "organization_attested", "independent"]) {
    auth.sign(f.record, { assurance_requested: assurance });
    assert.equal(verifyAuditBundleChain(f.record).assurance, "self_signed");
    assert.equal(verifyAuditBundleChain(f.record, [], { trust: auth.trust(), minimumAssurance: assurance }).assurance, assurance);
  }
  for (const [patch, pattern] of [
    [{ signer_id: "IMPOSTOR" }, /identity|Signer|signer/], [{ role: "not-allowed" }, /role|Role/], [{ kind: "human_review" }, /kind mismatch/],
    [{ target_context_sha256: "0".repeat(64) }, /target/], [{ signed_at: date(-60_000), expires_at: date(-1000) }, /expired/]
  ]) {
    auth.sign(f.record, patch);
    assert.throws(() => verifyAuditBundleChain(f.record, [], { trust: auth.trust() }), pattern);
  }
  auth.sign(f.record);
  for (const patch of [{ revoked_at: date(-5000) }, { valid_until: date(-1000) }, { kinds: ["human_review"] }, { target_context_sha256: ["0".repeat(64)] }]) {
    const policy = structuredClone(auth.policy); Object.assign(policy.signers[0], patch);
    assert.throws(() => verifyAuditBundleChain(f.record, [], { trust: createAttestationTrust(policy, attestationDigest(policy)) }), /revoked|expired|valid|kind|scope|authoriz/i);
  }
  assert.throws(() => verifyAuditBundleChain(f.record, [], { expectedSubjectSha256: "0".repeat(64) }), /independently expected/);
  assert.throws(() => verifyAuditBundleChain(f.record, [], { trust: { policy: auth.policy } }), /live verified/);
});

test("every predecessor signature and supersedes binding is checked across key rotation without asserting historical bytes", (t) => {
  const f = fixture(t), previous = structuredClone(f.record);
  previous.manifest.bundle_id = "BUNDLE-PREVIOUS"; previous.manifest.context.run_id = "RUN-PREVIOUS";
  f.record.manifest.context.supersedes_run_id = previous.manifest.context.run_id;
  const oldSigner = signer([previous], { keyId: "OLD-KEY" }), newSigner = signer([f.record], { keyId: "NEW-KEY" });
  oldSigner.sign(previous, { assurance_requested: "signed" });
  f.record.manifest.predecessor = auditBundlePredecessor(previous); newSigner.sign(f.record);
  const policy = structuredClone(newSigner.policy); policy.signers.push(oldSigner.policy.signers[0]);
  const trust = createAttestationTrust(policy, attestationDigest(policy));
  const result = verifyAuditBundleChain(f.record, [previous], { trust, requireCompleteChain: true, minimumAssurance: "signed" });
  assert.equal(result.chain_record_count, 2); assert.equal(result.chain_complete, true);
  assert.equal(result.chain_assurance, "signed"); assert.equal(result.assurance, "organization_attested");
  assert.equal(result.historical_file_bytes_verified, false);
  assert.throws(() => verifyAuditBundleChain(f.record, [previous], { trust, minimumAssurance: "organization_attested" }), /minimum/);
  assert.throws(() => verifyAuditBundleChain(f.record, [], { trust }), /Missing/);
  assert.throws(() => verifyAuditBundleChain(f.record, [previous, previous], { trust }), /Duplicate/);
  const wrong = structuredClone(previous); wrong.manifest.bundle_id = "WRONG"; oldSigner.sign(wrong);
  assert.throws(() => verifyAuditBundleChain(f.record, [wrong], { trust }), /Missing/);
  const altered = structuredClone(previous); altered.manifest.files[0].sha256 = "f".repeat(64);
  assert.throws(() => verifyAuditBundleChain(f.record, [altered], { trust }), /metadata/);
  const revokedPolicy = structuredClone(policy); revokedPolicy.signers[1].revoked_at = date(-10);
  assert.throws(() => verifyAuditBundleChain(f.record, [previous], { trust: createAttestationTrust(revokedPolicy, attestationDigest(revokedPolicy)) }), /revoked/);
  const expired = structuredClone(previous); oldSigner.sign(expired, { signed_at: date(-5000), expires_at: date(-1000) });
  const expiredHead = structuredClone(f.record); expiredHead.manifest.predecessor = auditBundlePredecessor(expired); newSigner.sign(expiredHead);
  assert.throws(() => verifyAuditBundleChain(expiredHead, [expired], { trust }), /expired/);
  const bootstrap = structuredClone(f.record); bootstrap.manifest.predecessor = null; newSigner.sign(bootstrap);
  assert.equal(verifyAuditBundleChain(bootstrap, [], { trust }).chain_complete, false);
  assert.throws(() => verifyAuditBundleChain(bootstrap, [], { trust, requireCompleteChain: true }), /incomplete/);
  assert.throws(() => verifyAuditBundleChain(bootstrap, [previous], { trust }), /Unrelated/);
});

test("bundle paths cannot escape the root, alias Windows names or accept duplicate JSON fields", (t) => {
  const f = fixture(t);
  for (const name of ["../escape", "C:escape", "C:/escape", "/escape", "artifacts\\escape", "x:stream", "CON.txt", "folder/x.", "folder/x ", "folder//x"]) {
    const record = structuredClone(f.record); record.manifest.run = name;
    assert.throws(() => verifyAuditBundle({ root: f.bundleRoot, record }), /portable bundle path/, name);
  }
  const outside = path.join(f.directory, "outside.txt"); fs.writeFileSync(outside, "outside", "utf8");
  assert.throws(() => prepareAuditBundle({ ...f.inputs, attachments: [outside] }), /portable bundle path/);
  const recordFile = path.join(f.directory, "duplicate.json");
  fs.writeFileSync(recordFile, JSON.stringify(f.record).replace('"schema_version":"1.0.0"', '"schema_version":"1.0.0","schema_version":"1.0.0"'), "utf8");
  assert.notEqual(cli(["verify", "--root", f.bundleRoot, "--record", recordFile]).status, 0);
  const invalidRun = read(f.runFile); invalidRun.artifact_root = "D:outside";
  let reads = 0;
  const validation = validateAuditRun(invalidRun, { runFile: f.runFile, readArtifactFile() { reads++; throw new Error("must not read"); } });
  assert.equal(validation.valid, false); assert.equal(reads, 0, "Malformed schema paths must be rejected before file I/O");
  const prepared = prepareAuditBundle(f.inputs); fs.appendFileSync(f.attachment, "changed", "utf8");
  assert.throws(() => prepared.assertStable(), /changed before commit/);
});

test("CLI requires every linked predecessor and rejects read-write or malformed verification options", (t) => {
  const f = fixture(t), predecessor = structuredClone(f.record);
  predecessor.manifest.bundle_id = "BUNDLE-OLD"; predecessor.manifest.context.run_id = "RUN-20260823T120000Z-OLD00001";
  const run = read(f.runFile); run.supersedes_run_id = predecessor.manifest.context.run_id; write(f.runFile, run);
  const oldAuth = signer([predecessor]); oldAuth.sign(predecessor);
  const predecessorFile = path.join(f.directory, "previous.json"); write(predecessorFile, predecessor);
  const recordFile = path.join(f.directory, "linked.json");
  const prepared = success(cli(["prepare", "--root", f.bundleRoot, "--run", f.runFile, "--assessment", f.assessmentFile, "--report", f.report,
    "--predecessor", predecessorFile, "--require-complete-chain", "--output", recordFile]));
  assert.equal(prepared.chain_record_count, 2); assert.equal(prepared.chain_signatures_valid, false);
  const record = read(recordFile), auth = signer([record], { keyId: "ROTATED" }); auth.sign(record); write(recordFile, record);
  assert.notEqual(cli(["verify", "--root", f.bundleRoot, "--record", recordFile]).status, 0);
  const result = success(cli(["verify", "--root", f.bundleRoot, "--record", recordFile, "--predecessor", predecessorFile, "--require-complete-chain"]));
  assert.equal(result.chain_signatures_valid, true); assert.equal(result.chain_assurance, "self_signed");
  assert.notEqual(cli(["verify", "--root", f.bundleRoot, "--record", recordFile, "--output", path.join(f.directory, "bad.json")]).status, 0);
  assert.notEqual(cli(["verify", "--root", f.bundleRoot, "--record", recordFile, "--trust-policy", predecessorFile]).status, 0);
});

test("bounded readers reject oversized files and ambiguous registered JSON even when all hashes are re-signed", (t) => {
  const f = fixture(t), oversized = path.join(f.bundleRoot, "oversized.bin");
  fs.closeSync(fs.openSync(oversized, "w")); fs.truncateSync(oversized, 64 * 1024 * 1024 + 1);
  assert.throws(() => prepareAuditBundle({ ...f.inputs, attachments: [oversized] }), /byte limit/);
  const runBytes = fs.readFileSync(f.runFile);
  fs.writeFileSync(f.runFile, Buffer.concat([runBytes, Buffer.alloc(8 * 1024 * 1024, 32)]));
  assert.throws(() => prepareAuditBundle(f.inputs), /byte limit/);
  fs.writeFileSync(f.runFile, runBytes);
  const run = read(f.runFile), entry = run.artifacts.at(-1), artifactFile = path.join(f.bundleRoot, run.artifact_root, entry.path);
  const artifact = read(artifactFile);
  fs.writeFileSync(artifactFile, JSON.stringify(artifact).replace(/"schema_version":"[^"]+"/u, (value) => `${value},${value}`), "utf8");
  entry.sha256 = crypto.createHash("sha256").update(fs.readFileSync(artifactFile)).digest("hex"); write(f.runFile, run);
  const record = structuredClone(f.record);
  for (const file of record.manifest.files) {
    const bytes = fs.readFileSync(path.join(f.bundleRoot, file.path));
    file.sha256 = crypto.createHash("sha256").update(bytes).digest("hex"); file.size_bytes = bytes.length;
  }
  const auth = signer([record]); auth.sign(record);
  assert.throws(() => verifyAuditBundle({ root: f.bundleRoot, record, trust: auth.trust() }), /duplicate/i);
});
