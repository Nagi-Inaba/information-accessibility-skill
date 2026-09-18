import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { lookupRequirement } from "../codex/skills/information-accessibility-practice/scripts/show-requirement.mjs";
import { loadAuditResources } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";
import { applyStandaloneHumanReview } from "../codex/skills/information-accessibility-practice/scripts/lib/apply-human-review.mjs";
import { createHumanReviewRecord, humanReviewContext, humanReviewSigningSubject, humanReviewTargetContextSha256 } from "../codex/skills/information-accessibility-practice/scripts/lib/human-review-provenance.mjs";
import { attestationDigest } from "../codex/skills/information-accessibility-practice/scripts/lib/attestation-canonical.mjs";
import { createAttestationTrust, attestationSigningBytes } from "../codex/skills/information-accessibility-practice/scripts/lib/attestation-verifier.mjs";
import { buildStandalonePresentation, renderReportMarkdown } from "../codex/skills/information-accessibility-practice/scripts/lib/report-presentation.mjs";
import { renderReportHtml } from "../codex/skills/information-accessibility-practice/scripts/lib/report-html.mjs";
import { renderReportSummaryMarkdown } from "../codex/skills/information-accessibility-practice/scripts/lib/report-summary.mjs";
import { applyReportVisibility } from "../codex/skills/information-accessibility-practice/scripts/lib/report-privacy.mjs";
import { legacyAssessment } from "./helpers/legacy-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = path.join(root, "codex/skills/information-accessibility-practice/scripts");
const resources = loadAuditResources();
const date = (delta) => new Date(Date.now() + delta).toISOString();
const validate = (record, options = {}) => validateAssessment(record, resources.standardsRegistry, resources.assessmentSchema, resources.criteriaCatalog, resources.auditMethods, options);
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value), "utf8");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const cli = (script, args) => spawnSync(process.execPath, [path.join(scripts, script), ...args], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const success = (result) => { assert.equal(result.status, 0, result.stderr || result.stdout); return result; };

function fixture({ failure = false, requirementIndex = 0 } = {}) {
  const baseline = generateAssessment("web-modern", { assessmentId: "ASSESSMENT-TRUST-TEST", targetName: "Synthetic provenance fixture",
    targetVersion: "fixture-v1", targetRefs: ["https://example.com/"], evaluator: "Synthetic coordinator", evaluatedAt: date(-2000).slice(0, 10) });
  baseline.assessment.scope.included = ["https://example.com/"];
  baseline.assessment.scope.full_pages_reviewed = true;
  baseline.assessment.scope.complete_processes = ["Synthetic viewing process"];
  baseline.assessment.environment = { os: ["Fixture OS"], browsers: ["Fixture browser"], assistive_technologies: ["Fixture AT"], input_modes: ["keyboard"] };
  const id = baseline.assessment.results[requirementIndex].requirement_id;
  const binding = lookupRequirement("web-modern", id).procedure_binding;
  const review = { requirement_id: id, procedure_availability: binding.procedure_availability,
    criterion_procedure_ref: binding.procedure_ref, generic_method_ref: binding.generic_method_ref, official_sources: binding.official_sources,
    target_specific_evidence: [...new Set([...binding.required_evidence_types, "keyboard_test", "assistive_technology_test"])].map((type) => ({
      type, location: "Synthetic fixture image", observation: "Synthetic target-specific observation", captured_at: date(-3000) })),
    profile_outcome: failure ? "fail" : "pass", rationale: "Synthetic human review for provenance regression testing." };
  if (failure) review.finding = { id: "FIND-TRUST-TEST", priority: "P1", location: "Synthetic fixture image", affected_users: ["Screen reader users"], observation: "Synthetic missing alternative." };
  const payload = { schema_version: "1.0.0", declaration: "Synthetic test only", reviewer_name: "PRIVATE-HUMAN-NAME",
    review_date: date(-2000).slice(0, 10), identity_authenticated: false, reviews: [review] };
  const record = createHumanReviewRecord({ reviewerId: "PRIVATE-HUMAN-ID", review: payload,
    context: humanReviewContext({ assessmentId: baseline.assessment.assessment_id, assessment: baseline.assessment }) });
  return { baseline, record };
}

function signer(record, assurance = "independent") {
  const keys = crypto.generateKeyPairSync("ed25519"); // Private key stays in this test's memory.
  const publicKey = keys.publicKey.export({ format: "jwk" });
  const statement = { schema_version: "1.0.0", kind: "human_review", canonicalization: "RFC8785", algorithm: "Ed25519",
    subject_sha256: attestationDigest(humanReviewSigningSubject(record)), target_context_sha256: humanReviewTargetContextSha256(record.context),
    signer_id: record.reviewer_id, key_id: "PRIVATE-KEY-ID", role: "PRIVATE-ROLE", assurance_requested: assurance,
    signed_at: date(-1000), expires_at: date(300_000), predecessor_attestation_sha256: null };
  const signed = structuredClone(record);
  signed.attestation = { statement, public_key: publicKey, signature: crypto.sign(null, attestationSigningBytes(statement), keys.privateKey).toString("base64url") };
  const policy = { schema_version: "1.0.0", policy_id: "synthetic-recipient-policy", valid_from: date(-600_000), valid_until: date(600_000),
    signers: [{ signer_id: record.reviewer_id, key_id: statement.key_id, subject_type: "human", organization: "PRIVATE-ORG", roles: [statement.role], kinds: ["human_review"],
      assurance_ceiling: "independent", target_context_sha256: [statement.target_context_sha256], public_key: publicKey, valid_from: date(-600_000), valid_until: date(600_000), revoked_at: null }] };
  return { signed, policy, trust: createAttestationTrust(policy, attestationDigest(policy)) };
}

test("assessment assurance is rederived from records and external trust for every report format", () => {
  const { baseline, record } = fixture();
  for (const requested of ["signed", "organization_attested", "independent"]) {
    const { signed, trust } = signer(record, requested);
    for (const [reviewRecord, external, expected] of [[record, undefined, "self_declared"], [signed, undefined, "self_signed"], [signed, trust, requested]]) {
      const merged = applyStandaloneHumanReview({ assessment: baseline, reviewRecord, resources, trust: external, claimTier: "evaluated_subset" });
      const validation = validate(merged, { trust: external });
      assert.equal(validation.valid, true, validation.errors.join("; "));
      const guard = validation.guard;
      assert.equal(guard.reviewer_assurance.requirement_counts[expected], 1);
      assert.equal(guard.reviewer_assurance.authenticated_requirement_count, external ? 1 : 0);
      assert.equal(guard.reviewer_assurance.review_correctness_verified, false);
      assert.equal(merged.assessment.results[0].mapping_status, "human_declared");
      assert.equal(Object.hasOwn(merged.assessment.results[0], "reviewer_identity_authenticated"), false);
      for (const locale of ["ja", "en"]) {
        const presentation = buildStandalonePresentation({ record: merged, validation, registry: resources.standardsRegistry, catalog: resources.criteriaCatalog, locale });
        const publicPresentation = applyReportVisibility(presentation, { visibility: "public", reviewerDisclosure: "redact" }).presentation;
        for (const output of [JSON.stringify(publicPresentation), renderReportMarkdown(publicPresentation), renderReportSummaryMarkdown(publicPresentation),
          renderReportHtml(publicPresentation), renderReportHtml(publicPresentation, { detail: "summary" })]) {
          assert.doesNotMatch(output, /PRIVATE-HUMAN|PRIVATE-KEY|PRIVATE-ROLE|PRIVATE-ORG|public_key|review_record_sha256/);
          assert.match(output, locale === "ja" ? /本人性|署名者/ : /identity|signer/);
          assert.match(output, locale === "ja" ? /署名はレビュー内容の正しさを証明しません/ : /signature does not establish review correctness/);
        }
      }
    }
  }
});

test("new assessments reject forged flags, unsigned row details, context changes and rewritten findings", () => {
  const { baseline, record } = fixture({ failure: true }), { signed, trust } = signer(record);
  const merged = applyStandaloneHumanReview({ assessment: baseline, reviewRecord: signed, resources, trust });
  for (const mutate of [
    (r) => { r.assessment.results[0].mapping_status = "human_verified"; },
    (r) => { r.assessment.results[0].reviewer_identity_authenticated = true; },
    (r) => { r.assessment.human_review_records[0].assurance = "independent"; },
    (r) => { r.assessment.results[0].outcome = "pass"; },
    (r) => { r.assessment.results[0].notes = "Rewritten rationale"; },
    (r) => { r.assessment.results[0].evidence[0].observation = "Rewritten evidence"; },
    (r) => { r.assessment.results[0].review_record_sha256 = "0".repeat(64); },
    (r) => { r.assessment.results[0].review_details = { reason: "scope_incomplete", performed_checks: [], next_checks: ["Unsigned prose"] }; },
    (r) => { r.assessment.target.version_or_commit = "fixture-v2"; },
    (r) => { r.assessment.assessment_id = "ASSESSMENT-OTHER"; },
    (r) => { r.assessment.findings[0].observation = "Rewritten human finding"; },
    (r) => { r.assessment.human_review_records = []; }
  ]) {
    const tampered = structuredClone(merged); mutate(tampered);
    assert.equal(validate(tampered, { trust }).valid, false, mutate.toString());
  }
  assert.throws(() => applyStandaloneHumanReview({ assessment: merged, reviewRecord: signed, resources, trust }), /replace an existing/);
});

test("unsigned records still require registered procedure, source and evidence bindings", () => {
  const { baseline, record } = fixture();
  for (const mutate of [
    (r) => { r.review.reviews[0].official_sources = ["https://example.com/unregistered"]; },
    (r) => { r.review.reviews[0].criterion_procedure_ref = "criterion-procedures:1.0.0#unregistered"; },
    (r) => { r.review.reviews[0].target_specific_evidence = r.review.reviews[0].target_specific_evidence.filter((e) => e.type !== "browser_inspection"); }
  ]) {
    const changed = structuredClone(record); mutate(changed);
    assert.throws(() => applyStandaloneHumanReview({ assessment: baseline, reviewRecord: changed, resources }), /registered|missing required/);
  }
});

test("mixed reviewer assurance limits claims and only independent trust permits new-format E4", () => {
  const { baseline, record } = fixture();
  for (const assurance of ["signed", "independent"]) {
    const { signed, trust } = signer(record, assurance);
    const merged = applyStandaloneHumanReview({ assessment: baseline, reviewRecord: signed, resources, trust, claimTier: "evaluated_subset" });
    const e4 = structuredClone(merged);
    e4.assessment.evidence_level = "E4";
    e4.assessment.assurance.independent_audit = { performed: true, evaluator_independent: true, scope_method: "Synthetic scope", report_location: "Synthetic independent report" };
    assert.equal(validate(e4, { trust }).valid, assurance === "independent");
    const second = fixture({ requirementIndex: 1 }).record;
    second.reviewer_id = "PRIVATE-SECOND-REVIEWER";
    const mixed = applyStandaloneHumanReview({ assessment: merged, reviewRecord: second, resources, trust, claimTier: "evaluated_subset" });
    const checked = validate(mixed, { trust });
    assert.equal(checked.valid, true, checked.errors.join("; "));
    assert.equal(checked.guard.reviewer_assurance.reviewed_requirement_count, 2);
    assert.equal(checked.guard.reviewer_assurance.authenticated_requirement_count, 1);
    assert.equal(checked.guard.reviewer_assurance.all_reviewed_requirements_authenticated, false);
    assert.equal(checked.guard.reviewer_assurance_ceiling, "evaluated_subset");
    assert.match(checked.guard.assured_claim_wording.ja, /すべての担当者の本人性を確認したものではなく/);
  }
});

test("legacy self-declarations stay readable and E4 display cannot imply authenticated independent review", () => {
  const { baseline, record } = fixture();
  const legacy = legacyAssessment(applyStandaloneHumanReview({ assessment: baseline, reviewRecord: record, resources }));
  legacy.assessment.evidence_level = "E4";
  legacy.assessment.assurance.independent_audit = { performed: true, evaluator_independent: true, scope_method: "Self-declared scope", report_location: "Synthetic report" };
  const validation = validate(legacy);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.equal(validation.guard.reviewer_assurance.authenticated_requirement_count, 0);
  assert.equal(validation.guard.reviewer_assurance.requirement_counts.legacy_self_declared, 1);
  const model = buildStandalonePresentation({ record: legacy, validation, registry: resources.standardsRegistry, catalog: resources.criteriaCatalog });
  assert.match(model.evidence_level, /E4.*自己申告.*未確認/);
  assert.match(model.rows[0].source_label, /旧形式の自己申告/);
  assert.throws(() => applyStandaloneHumanReview({ assessment: legacy, reviewRecord: record, resources }), /Legacy assessments remain read-only/);
});

test("standalone CLI prepares, applies, validates and renders signed reviews without modifying source records", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assessment-review-cli-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { baseline, record } = fixture({ failure: true });
  const assessmentFile = path.join(dir, "baseline.json"), payloadFile = path.join(dir, "review.json"), recordFile = path.join(dir, "record.json");
  write(assessmentFile, baseline); write(payloadFile, record.review);
  const original = fs.readFileSync(assessmentFile);
  success(cli("human-review.mjs", ["prepare", "--assessment", assessmentFile, "--review", payloadFile, "--reviewer-id", record.reviewer_id, "--output", recordFile]));
  assert.notEqual(cli("human-review.mjs", ["verify", "--assessment", assessmentFile, "--assessment-id", "WRONG-ID", "--record", recordFile]).status, 0);
  const { signed, policy } = signer(read(recordFile));
  const signedFile = path.join(dir, "signed.json"), policyFile = path.join(dir, "policy.json"), mergedFile = path.join(dir, "merged.json");
  write(signedFile, signed); write(policyFile, policy);
  const trustArgs = ["--trust-policy", policyFile, "--trust-policy-sha256", attestationDigest(policy)];
  const result = JSON.parse(success(cli("human-review.mjs", ["apply", "--assessment", assessmentFile, "--record", signedFile, "--output", mergedFile, "--claim-tier", "evaluated_subset", ...trustArgs])).stdout);
  assert.equal(result.assessment_result_binding_verified, true); assert.equal(result.assurance, "independent");
  const checked = JSON.parse(success(cli("validate-assessment.mjs", [mergedFile, ...trustArgs])).stdout);
  assert.equal(checked.guard.reviewer_assurance.authenticated_requirement_count, 1);
  const untrusted = JSON.parse(success(cli("validate-assessment.mjs", [mergedFile])).stdout);
  assert.equal(untrusted.guard.reviewer_assurance.requirement_counts.self_signed, 1);
  for (const format of ["markdown", "html"]) {
    const output = path.join(dir, `report.${format}`);
    success(cli("render-report.mjs", ["--input", mergedFile, "--output", output, "--format", format, "--visibility", "public", "--reviewer-disclosure", "redact", "--redaction-manifest", `${output}.manifest.json`, ...trustArgs]));
    const text = fs.readFileSync(output, "utf8");
    assert.doesNotMatch(text, /PRIVATE-HUMAN|PRIVATE-KEY|PRIVATE-ROLE|PRIVATE-ORG/);
    assert.match(text, /本人性を確認できたものは1条項/);
  }
  policy.signers[0].revoked_at = date(-1000); write(policyFile, policy);
  const refused = path.join(dir, "revoked.md");
  const rejected = cli("render-report.mjs", ["--input", mergedFile, "--output", refused, "--trust-policy", policyFile, "--trust-policy-sha256", attestationDigest(policy)]);
  assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /revoked/); assert.equal(fs.existsSync(refused), false);
  assert.deepEqual(fs.readFileSync(assessmentFile), original);
});
