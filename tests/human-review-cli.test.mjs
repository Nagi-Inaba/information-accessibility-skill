import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { attestationDigest } from "../codex/skills/information-accessibility-practice/scripts/lib/attestation-canonical.mjs";
import { attestationSigningBytes } from "../codex/skills/information-accessibility-practice/scripts/lib/attestation-verifier.mjs";
import { humanReviewSigningSubject, humanReviewTargetContextSha256 } from "../codex/skills/information-accessibility-practice/scripts/lib/human-review-provenance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "codex/skills/information-accessibility-practice/scripts/human-review.mjs");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value), "utf8");
const date = (delta) => new Date(Date.now() + delta).toISOString();
const cli = (args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const success = (result) => { assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout); };

test("offline CLI prepares and verifies real run-backed and standalone records without changing existing evidence", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-review-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const example = spawnSync(process.execPath, [path.join(root, "examples/run-backed-web-audit/run.mjs"), "--output", path.join(directory, "example")],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.equal(example.status, 0, example.stderr || example.stdout);
  const scenario = path.join(directory, "example/human-reviewed");
  const runFile = path.join(scenario, "audit-run.json"), assessmentFile = path.join(scenario, "baseline-assessment.json");
  const run = read(runFile), entry = run.artifacts.find((artifact) => artifact.artifact_type === "declared-human-review");
  const sourceFile = path.resolve(scenario, run.artifact_root, entry.path);
  const sourceBytes = fs.readFileSync(sourceFile), runBytes = fs.readFileSync(runFile), assessmentBytes = fs.readFileSync(assessmentFile);
  const rawReview = path.join(directory, "declared.json"); write(rawReview, read(sourceFile).payload);
  const cases = [
    { name: "run", context: ["--run", runFile, "--artifact-id", entry.artifact_id], prepare: [] },
    { name: "standalone", context: ["--assessment", assessmentFile], prepare: ["--review", rawReview] }
  ];
  for (const scenario of cases) {
    const recordFile = path.join(directory, `${scenario.name}-record.json`);
    const prepared = success(cli(["prepare", ...scenario.context, ...scenario.prepare, "--reviewer-id", "PRIVATE-REVIEWER", "--output", recordFile]));
    assert.equal(prepared.assurance, "self_declared"); assert.equal(prepared.reviewer_identity_authenticated, false);
    const before = fs.readFileSync(recordFile);
    assert.notEqual(cli(["prepare", ...scenario.context, ...scenario.prepare, "--reviewer-id", "PRIVATE-REVIEWER", "--output", recordFile]).status, 0);
    assert.deepEqual(fs.readFileSync(recordFile), before);
    const unsigned = success(cli(["verify", ...scenario.context, "--record", recordFile]));
    assert.equal(unsigned.assurance, "self_declared"); assert.equal(unsigned.assessment_result_binding_verified, false);
    assert.notEqual(cli(["verify", ...scenario.context, "--record", recordFile, "--minimum-assurance", "signed"]).status, 0);

    // Test-only signer: private key never leaves memory or becomes a CLI input.
    const keys = crypto.generateKeyPairSync("ed25519"), record = read(recordFile);
    const publicKey = keys.publicKey.export({ format: "jwk" });
    const statement = { schema_version: "1.0.0", kind: "human_review", canonicalization: "RFC8785", algorithm: "Ed25519",
      subject_sha256: attestationDigest(humanReviewSigningSubject(record)), target_context_sha256: humanReviewTargetContextSha256(record.context),
      signer_id: record.reviewer_id, key_id: "PRIVATE-KEY", role: "PRIVATE-ROLE", assurance_requested: "independent",
      signed_at: date(-1000), expires_at: date(60_000), predecessor_attestation_sha256: null };
    record.attestation = { statement, public_key: publicKey, signature: crypto.sign(null, attestationSigningBytes(statement), keys.privateKey).toString("base64url") };
    const signedFile = path.join(directory, `${scenario.name}-signed.json`); write(signedFile, record);
    const selfSigned = success(cli(["verify", ...scenario.context, "--record", signedFile]));
    assert.equal(selfSigned.assurance, "self_signed"); assert.equal(selfSigned.reviewer_identity_authenticated, false);
    const policy = { schema_version: "1.0.0", policy_id: "synthetic-cli-policy", valid_from: date(-600_000), valid_until: date(600_000),
      signers: [{ signer_id: record.reviewer_id, key_id: statement.key_id, subject_type: "human", organization: "PRIVATE-ORGANIZATION", roles: [statement.role],
        kinds: ["human_review"], assurance_ceiling: "independent", target_context_sha256: [statement.target_context_sha256], public_key: publicKey,
        valid_from: date(-600_000), valid_until: date(600_000), revoked_at: null }] };
    const policyFile = path.join(directory, `${scenario.name}-policy.json`); write(policyFile, policy);
    const trust = ["--trust-policy", policyFile, "--trust-policy-sha256", attestationDigest(policy)];
    const verified = success(cli(["verify", ...scenario.context, "--record", signedFile, ...trust, "--minimum-assurance", "independent"]));
    assert.equal(verified.assurance, "independent"); assert.equal(verified.reviewer_identity_authenticated, true);
    assert.equal(verified.final_bundle_verified, false); assert.equal(verified.review_correctness_verified, false);
    assert.doesNotMatch(JSON.stringify(verified), /PRIVATE|reviewer_name|public_key|sha256|file:/u);
    if (scenario.name === "run") {
      const mergedFile = path.join(directory, "signed-merged.json");
      const execute = (name, args) => spawnSync(process.execPath, [path.join(path.dirname(script), name), ...args], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      const artifactArgs = run.artifacts.flatMap((item) => ["--artifact", path.resolve(path.dirname(runFile), run.artifact_root, item.path)]);
      const merged = execute("merge-audit-artifacts.mjs", ["--run", runFile, "--assessment", assessmentFile, ...artifactArgs,
        "--review-record", signedFile, ...trust, "--claim-tier", "evaluated_subset", "--output", mergedFile]);
      assert.equal(merged.status, 0, merged.stderr || merged.stdout);
      const validation = success(execute("validate-assessment.mjs", [mergedFile, "--run", runFile, ...trust]));
      assert.equal(validation.guard.reviewer_assurance.authenticated_requirement_count, record.review.reviews.length);
      const withoutTrust = success(execute("validate-assessment.mjs", [mergedFile, "--run", runFile]));
      assert.equal(withoutTrust.guard.reviewer_assurance.requirement_counts.self_signed, record.review.reviews.length);
      assert.notEqual(execute("validate-assessment.mjs", [mergedFile, ...trust]).status, 0);
      for (const format of ["markdown", "html"]) {
        const output = path.join(directory, `run-signed.${format}`);
        const report = execute("render-report.mjs", ["--run", runFile, "--assessment", mergedFile, "--format", format, "--output", output,
          "--visibility", "public", "--reviewer-disclosure", "redact", "--redaction-manifest", `${output}.manifest.json`, ...trust]);
        assert.equal(report.status, 0, report.stderr || report.stdout);
        assert.match(fs.readFileSync(output, "utf8"), new RegExp(`本人性を確認できたものは${record.review.reviews.length}条項`));
        assert.doesNotMatch(fs.readFileSync(output, "utf8"), /PRIVATE-REVIEWER|PRIVATE-KEY|PRIVATE-ROLE|PRIVATE-ORGANIZATION/);
      }
    }
    assert.notEqual(cli(["verify", ...scenario.context, "--record", signedFile, "--trust-policy", policyFile, "--trust-policy-sha256", "0".repeat(64)]).status, 0);
    fs.writeFileSync(policyFile, JSON.stringify(policy).replace('"policy_id":', '"policy_id":"ambiguous","policy_id":'), "utf8");
    const ambiguous = cli(["verify", ...scenario.context, "--record", signedFile, ...trust]);
    assert.notEqual(ambiguous.status, 0); assert.match(ambiguous.stderr, /Duplicate JSON property/);
    policy.signers[0].revoked_at = date(-500); write(policyFile, policy);
    const revoked = cli(["verify", ...scenario.context, "--record", signedFile, "--trust-policy", policyFile, "--trust-policy-sha256", attestationDigest(policy)]);
    assert.notEqual(revoked.status, 0); assert.match(revoked.stderr, /revoked/);
  }
  assert.deepEqual(fs.readFileSync(runFile), runBytes);
  assert.deepEqual(fs.readFileSync(assessmentFile), assessmentBytes);
  assert.deepEqual(fs.readFileSync(sourceFile), sourceBytes);
  fs.appendFileSync(sourceFile, " ", "utf8");
  const changed = cli(["verify", ...cases[0].context, "--record", path.join(directory, "run-record.json")]);
  assert.notEqual(changed.status, 0); assert.match(changed.stderr, /hash mismatch/);
});

test("CLI argument validation cannot silently discard authority or mode options", () => {
  assert.equal(cli(["--help"]).status, 0);
  for (const args of [
    ["verify", "--record", "none", "--run", "run", "--artifact-id", "A", "--trust-policy", "policy"],
    ["verify", "--record", "none", "--run", "run", "--artifact-id", "A", "--reviewer-id", "person"],
    ["prepare", "--run", "run", "--artifact-id", "A", "--reviewer-id", "person", "--output", "new", "--minimum-assurance", "signed"],
    ["verify", "--record", "first", "--record", "second"],
    ["verify", "--run", "run", "--assessment", "assessment"],
    ["verify", "--record", "none", "--assessment", "assessment"],
    ["verify", "--unknown", "value"]
  ]) assert.notEqual(cli(args).status, 0, args.join(" "));
});
