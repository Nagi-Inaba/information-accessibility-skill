import { createHumanReviewQueue } from "../codex/skills/information-accessibility-practice/scripts/lib/human-review-queue.mjs";
import { legacyAssessment } from "./helpers/legacy-assessment.mjs";
import { createNetworkPolicy } from "../codex/skills/information-accessibility-practice/scripts/lib/network-policy.mjs";
import assert from "node:assert/strict";
import { bindFixtureEvidence, fixtureEvidenceSnapshots } from "./helpers/saved-evidence.mjs";
import { fixtureInventory } from "./helpers/measured-targets.mjs";
import { createInspectionRequest } from "../codex/skills/information-accessibility-practice/scripts/lib/inspection-request.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import {
  loadAuditResources,
  mergeArtifacts,
  registerArtifact,
  sha256Bytes,
  validateAuditRun
} from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { createRunEvidenceReference } from "../codex/skills/information-accessibility-practice/scripts/lib/run-evidence.mjs";
import { lookupRequirement } from "../codex/skills/information-accessibility-practice/scripts/show-requirement.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";
import { auditStatus, statusText } from "../codex/skills/information-accessibility-practice/scripts/show-audit-status.mjs";
import { validateJsonSchema } from "../codex/skills/information-accessibility-practice/scripts/lib/json-schema.mjs";
import {
  buildPublicReportModel as buildCurrentPublicReportModel,
  overallReportJudgement,
  reportJudgementForOutcome,
  renderRunBackedReport
} from "../codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "codex/skills/information-accessibility-practice");
const registry = JSON.parse(fs.readFileSync(path.join(skill, "references/standards-registry.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(skill, "references/assessment-record.schema.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(skill, "references/criteria-catalog.json"), "utf8"));
const methods = JSON.parse(fs.readFileSync(path.join(skill, "references/web-audit-methods.json"), "utf8"));

// These projection unit tests retain their legacy, unsigned inputs. Current
// provenance is exercised end-to-end in assessment-review-provenance.test.mjs.
function buildPublicReportModel(options) {
  return buildCurrentPublicReportModel({ ...options, assessment: legacyAssessment(options.assessment) });
}
function validate(record) {
  return validateAssessment(record, registry, schema, catalog, methods);
}

function reviewedRecord() {
  const record = generateAssessment("web-modern", {
    targetName: "Example service",
    targetVersion: "release-1",
    targetRefs: ["https://example.invalid/checkout"],
    evaluator: "Accessibility reviewer",
    evaluatedAt: "2026-07-13"
  });
  record.assessment.scope.included = ["Checkout form"];
  record.assessment.evidence_level = "E2";
  record.assessment.claim.requested_tier = "evaluated_subset";
  record.assessment.claim.proposed_wording = registry.claim_templates.evaluated_subset[0];
  const result = record.assessment.results.find((item) => item.requirement_id === "WCAG-2.2-SC-2.1.1");
  result.mapping_status = "human_verified";
  result.outcome = "fail";
  result.method_kind = "manual";
  result.evidence = [{
    type: "keyboard_test",
    location: "Checkout: payment-method selector",
    observation: "The selector cannot receive keyboard focus.",
    captured_at: "2026-07-13T10:00:00+09:00"
  }];
  result.notes = "Keyboard operation was blocked during the checkout flow.";
  record.assessment.findings = [{
    id: "F-001",
    priority: "P1",
    requirement_ids: ["WCAG-2.2-SC-2.1.1"],
    location: "Checkout: payment-method selector",
    affected_users: ["Keyboard-only users", "Screen-reader users"],
    observation: "The selector cannot receive keyboard focus.",
    remediation: "Use a native control or implement complete keyboard focus and operation.",
    verification: "Retest the full checkout process with keyboard-only operation."
  }];
  return legacyAssessment(record);
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const reportJudgements = new Set(["適合", "不適合", "要確認", "未確認"]);
const formalNotice = "このレポートでは、改善判断のために「適合」「不適合」などの判定語を使用します。";

function assertUnifiedJudgementReport(report, expectedOverall) {
  assert.match(report, /^# WCAG検査レポート/m);
  assert.match(report, new RegExp(`^- 総合判定: ${expectedOverall}$`, "mu"));
  assert.equal((report.match(new RegExp(formalNotice, "gu")) ?? []).length, 1, "正式な適合表明ではない旨の注意書きは冒頭に1回だけ表示する");
  assert.doesNotMatch(report, /WCAG適合は判定していません/u);
  assert.doesNotMatch(report, /セルフチェック用|公開向け/u);
  for (const line of report.split(/\r?\n/u)) {
    if (!/^\|\s*(?:WCAG-|SCREEN-)/u.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((value) => value.trim());
    const judgement = cells.find((value) => reportJudgements.has(value));
    assert.ok(judgement, `判定行には4種類の判定語のいずれかが必要です: ${line}`);
  }
}

test("report judgement vocabulary and overall priority are fixed", () => {
  assert.equal(reportJudgementForOutcome("pass"), "適合");
  assert.equal(reportJudgementForOutcome("fail"), "不適合");
  assert.equal(reportJudgementForOutcome("cant_tell"), "要確認");
  assert.equal(reportJudgementForOutcome("not_tested"), "未確認");
  assert.equal(reportJudgementForOutcome("not_applicable"), null);

  const cases = [
    [{ pass: 3, fail: 1, not_applicable: 0, not_tested: 2, cant_tell: 2 }, "不適合"],
    [{ pass: 3, fail: 0, not_applicable: 0, not_tested: 2, cant_tell: 1 }, "要確認"],
    [{ pass: 3, fail: 0, not_applicable: 1, not_tested: 2, cant_tell: 0 }, "未確認"],
    [{ pass: 3, fail: 0, not_applicable: 4, not_tested: 0, cant_tell: 0 }, "適合"]
  ];
  for (const [counts, expected] of cases) assert.equal(overallReportJudgement(counts), expected);
});

function reportRunFixture(temp, { declaredFinding = false, withoutPlan = false, targetName = "Public fixture" } = {}) {
  const artifactRoot = path.join(temp, "artifacts");
  fs.mkdirSync(artifactRoot);
  const resources = loadAuditResources(skill);
  const runId = "RUN-20260717T120000Z-REPORT01";
  const target = { name: targetName, version_or_commit: "fixture-v1", urls_or_files: ["https://example.invalid/checkout"] };
  const scope = { included: ["Checkout"], excluded: [], complete_processes: [], third_party_content: [], full_pages_reviewed: false };
  const environment = { os: ["not_declared"], browsers: [], assistive_technologies: [], input_modes: [] };
  const targetContext = { schema_version: "16.0.0", run_id: runId, target, environment };
  targetContext.target_inventory = fixtureInventory(targetContext, artifactRoot);
  const created = [
    "2026-07-17T12:00:01Z",
    "2026-07-17T12:00:02Z",
    "2026-07-17T12:00:03Z",
    "2026-07-17T12:00:04Z"
  ];
  const envelope = (artifactId, artifactType, roleId, inputs, payload, createdAt, producerKind = "ai_agent") => ({
    schema_version: "3.0.0",
    target_snapshot_ids: targetContext.target_inventory.snapshots.map((snapshot) => snapshot.snapshot_id),
    artifact_id: artifactId,
    artifact_type: artifactType,
    run_id: runId,
    producer: { role_id: roleId, producer_kind: producerKind, origin: "report fixture" },
    created_at: createdAt,
    inputs,
    payload
  });
  const screen = envelope("ART-SCREEN-REPORT", "screening-observations", "e1_inspector", [], {
    schema_version: "2.0.0",
    observations: [{
      requirement_id: "SCREEN-FIRST",
      evidence_level: "E1",
      method: "Static DOM inspection",
      location: "Checkout heading",
      observation: "The heading structure may skip a level.",
      captured_at: created[0],
      profile_requirement_id: "WCAG-2.2-SC-2.4.2",
      report_outcome: "fail",
      applicability: "applicable",
      report_rationale: "The inspected page title does not identify the page topic."
    }]
  }, created[0]);
  const screenFile = path.join(artifactRoot, "screen.json");
  bindFixtureEvidence(screen, targetContext, artifactRoot);
  writeJson(screenFile, screen);
  const queueIds = ["WCAG-2.2-SC-1.1.1", "WCAG-2.2-SC-1.3.1", "WCAG-2.2-SC-2.1.1"];
  const queueItems = queueIds.map((requirementId) => ({
    requirement_id: requirementId,
    ...lookupRequirement("web-modern", requirementId, skill).procedure_binding
  }));
  const queue = envelope("ART-QUEUE-REPORT", "human-review-queue", "human_queue_planner", [{
    artifact_id: screen.artifact_id,
    run_id: runId,
    sha256: resourcesSha256(screenFile)
  }], {
    schema_version: "2.0.0",
    items: queueItems,
    procedure_coverage: {
      total_requirements: queueItems.length,
      available_procedures: queueItems.filter((item) => item.procedure_availability === "available").length,
      unavailable_procedures: queueItems.filter((item) => item.procedure_availability === "unavailable").length
    }
  }, created[1]);
  queue.payload = createHumanReviewQueue({ run: { ...targetContext, profile: { id: "web-modern" } }, screenings: [screen], manualRequirements: queueIds, skillRoot: skill });
  const queueFile = path.join(artifactRoot, "queue.json");
  writeJson(queueFile, queue);
  const review = (requirementId, profileOutcome) => {
    const binding = lookupRequirement("web-modern", requirementId, skill).procedure_binding;
    return {
      requirement_id: requirementId,
      procedure_availability: binding.procedure_availability,
      criterion_procedure_ref: binding.procedure_ref,
      generic_method_ref: binding.generic_method_ref,
      official_sources: binding.official_sources,
      target_specific_evidence: binding.required_evidence_types.map((type) => ({
        type,
        location: requirementId === "WCAG-2.2-SC-1.1.1" ? "Checkout product image" : "Checkout form groups",
        observation: profileOutcome === "fail"
          ? "The text alternative did not communicate the product image purpose."
          : "The visible relationships were exposed in the inspected structure.",
        captured_at: created[2]
      })),
      profile_outcome: profileOutcome,
      rationale: profileOutcome === "fail" ? "The target-specific evidence confirms the failure." : "The target-specific evidence confirms the requirement was met."
    };
  };
  const human = envelope("ART-HUMAN-REPORT", "declared-human-review", "declared_external_human", [{
    artifact_id: queue.artifact_id,
    run_id: runId,
    sha256: resourcesSha256(queueFile)
  }], {
    schema_version: "3.0.0", reviewer_id: "fixture-reviewer",
    declaration: "I declare that I performed the recorded review as an external human reviewer.",
    reviewer_name: "External Reviewer",
    review_date: "2026-07-17",
    identity_authenticated: false,
    reviews: [review("WCAG-2.2-SC-1.1.1", "fail"), review("WCAG-2.2-SC-1.3.1", "pass")].map((item) => ({ ...item, review_id: "HR-FIXTURE-" + item.requirement_id }))
  }, created[2], "external_human");
  if (declaredFinding) human.payload.reviews[0].finding = {
    id: "FIND-HUMAN-REPORT", priority: "P1", location: "Checkout product image",
    affected_users: ["Screen reader users"], observation: "The image purpose is missing from the text alternative."
  };
  const humanFile = path.join(artifactRoot, "human.json");
  writeJson(humanFile, human);
  const remediation = envelope("ART-REMEDIATION-REPORT", "remediation-plan", "remediation_planner", [{
    artifact_id: screen.artifact_id,
    run_id: runId,
    sha256: resourcesSha256(screenFile)
  }, {
    artifact_id: human.artifact_id,
    run_id: runId,
    sha256: resourcesSha256(humanFile)
  }], {
    schema_version: "3.0.0",
    items: [{
      remediation_id: "REM-REPORT01",
      basis: "verified_failure",
      requirement_id: "WCAG-2.2-SC-1.1.1",
      source_artifact_ids: [human.artifact_id],
      priority: "P0",
      location: "Checkout product image",
      affected_users: ["Screen reader users"],
      issue: "The text alternative does not communicate the product image purpose.",
      proposed_change: "Provide a text alternative that communicates the same purpose.",
      verification: "Repeat the registered human review after the authorized change.",
      owner: "Frontend team",
      residual_limitation: "The reviewer identity was declared but not authenticated."
    }, {
      remediation_id: "REM-REPORT02",
      basis: "unverified_screening_candidate",
      requirement_id: "SCREEN-FIRST",
      source_artifact_ids: [screen.artifact_id],
      priority: "P2",
      location: "Checkout heading",
      affected_users: ["Screen reader users"],
      issue: "The heading structure may skip a level.",
      proposed_change: "Confirm the heading hierarchy before changing the markup.",
      verification: "Inspect the final heading outline and repeat the screening check.",
      residual_limitation: "A human reviewer has not yet confirmed this observation."
    }]
  }, created[3]);
  const remediationFile = path.join(artifactRoot, "remediation.json");
  writeJson(remediationFile, remediation);
  const artifactFiles = new Map([[screen.artifact_id, screenFile], [queue.artifact_id, queueFile], [human.artifact_id, humanFile], [remediation.artifact_id, remediationFile]]);
  const artifacts = withoutPlan ? [screen, queue, human] : [screen, queue, human, remediation];
  if (withoutPlan) artifactFiles.delete(remediation.artifact_id);
  const run = {
    schema_version: "16.0.0",
    target_inventory: targetContext.target_inventory,
    inspection_request: createInspectionRequest("quick", "Identify the next investigation"),
    run_id: runId,
    supersedes_run_id: null,
    status: "remediation_ready",
    target,
    profile: { id: "web-modern", registry_version: "1.0.0" },
    scope,
    environment,
    permissions: {
      network: "allowlisted", network_policy: createNetworkPolicy({ targetOrigins: ["http://127.0.0.1:4173", "https://example.com"], allowLocalhost: true }),
      interaction: "read_only", interaction_policy: null,
      source_write: "denied",
      command_execution: "denied",
      allowed_actions: ["inspect_without_mutation", "read_allowlisted_resources"],
      forbidden_actions: ["execute_commands", "network_outside_allowlist", "write_target"]
    },
    resource_versions: resources.resourceVersions,
    artifact_root: "artifacts",
    artifacts: artifacts.map((artifact) => ({
      artifact_id: artifact.artifact_id,
      artifact_type: artifact.artifact_type,
      path: path.basename(artifactFiles.get(artifact.artifact_id)),
      sha256: resourcesSha256(artifactFiles.get(artifact.artifact_id)),
      producer_role: artifact.producer.role_id,
      created_at: artifact.created_at,
      validation_status: "valid"
    })).sort((left, right) => left.artifact_id.localeCompare(right.artifact_id)),
    history: [
      { from: "initialized", to: "screened", at: created[0], actor_role: "e1_inspector", artifact_ids: [screen.artifact_id] },
      { from: "screened", to: "human_queue_ready", at: created[1], actor_role: "human_queue_planner", artifact_ids: [queue.artifact_id] },
      { from: "human_queue_ready", to: "human_review_recorded", at: created[2], actor_role: "declared_external_human", artifact_ids: [human.artifact_id] },
      { from: "human_review_recorded", to: "remediation_ready", at: created[3], actor_role: "remediation_planner", artifact_ids: [remediation.artifact_id] }
    ],
    limitations: ["The environment was not declared."]
  };
  if (withoutPlan) {
    run.status = "human_review_recorded";
    run.history.pop();
  }
  const runFile = path.join(temp, "run.json");
  writeJson(runFile, run);
  const runValidation = validateAuditRun(run, { skillRoot: skill, runFile });
  assert.equal(runValidation.valid, true, runValidation.errors.join("\n"));
  const baseline = generateAssessment("web-modern", {
    targetName: target.name,
    targetVersion: target.version_or_commit,
    targetRefs: target.urls_or_files,
    evaluator: "Audit orchestrator",
    evaluatedAt: "2026-07-17"
  });
  baseline.assessment.scope = structuredClone(scope);
  baseline.assessment.environment = structuredClone(environment);
  resources.artifact_snapshots_by_id = new Map([...artifactFiles].map(([artifactId, file]) => {
    const bytes = fs.readFileSync(file);
    return [artifactId, { bytes, sha256: resourcesSha256(file) }];
  }));
  resources.evidence_snapshots_by_path = fixtureEvidenceSnapshots(artifactRoot);
  const assessment = mergeArtifacts({ run, assessment: baseline, artifacts, registries: resources });
  const assessmentFile = path.join(temp, "assessment.json");
  writeJson(assessmentFile, assessment);
  return { run, runFile, assessment, assessmentFile, artifactFiles, baseline, artifacts, resources };
}

test("registered audit context supplies participation, limitations and a review date without leaking internal context", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-audit-context-"));
  try {
    const fixture = reportRunFixture(temp);
    let { run } = fixture;
    const context = (id, kind, value, publication, role, seconds) => {
      const sourcePath = `context-${id}.txt`;
      const bytes = Buffer.from(`Target-specific source for ${kind}: ${JSON.stringify(value)}\n`);
      fs.writeFileSync(path.join(temp, "artifacts", sourcePath), bytes);
      const capturedAt = `2026-07-17T12:00:${seconds}Z`;
      const reference = createRunEvidenceReference({ run, targetRef: run.target.urls_or_files[0], evidenceType: "other",
        relativePath: sourcePath, bytes, capturedAt });
      const artifact = {
        schema_version: "3.0.0",
        target_snapshot_ids: run.target_inventory.snapshots.map((snapshot) => snapshot.snapshot_id),
        artifact_id: `ART-CONTEXT-${id}`,
        artifact_type: "audit-context",
        run_id: run.run_id,
        producer: { role_id: role, producer_kind: role === "declared_context_reviewer" ? "external_human" : "external_requester",
          origin: "test declaration" },
        created_at: `2026-07-17T12:00:${String(Number(seconds) + 1).padStart(2, "0")}Z`,
        inputs: [],
        payload: { schema_version: "1.0.0", kind, publication, declarant_name: "Declared reviewer",
          declared_at: capturedAt, rationale: "Observed against the declared target and saved source.",
          source_artifact_ids: [], evidence_refs: [reference], value }
      };
      const file = path.join(temp, "artifacts", `context-${id}.json`);
      writeJson(file, artifact);
      return { artifact, file, sourcePath, bytes };
    };
    const declarations = [
      context("FIND", "participation", { perspective: "find", outcome: "cant_tell" }, "public", "declared_context_reviewer", "05"),
      context("LIMIT", "limitation", { text: "Private constraint: assisted journey unavailable." }, "internal", "declared_context_reviewer", "07"),
      context("DATE", "next_review", { at: "2026-10-01", owner: "Private Owner", condition: "Retest after navigation changes." },
        "public", "declared_context_owner", "09"),
      context("AUDIT", "independent_audit", { performed: true, evaluator_independent: true,
        scope_method: "Independent review of the declared scope.", report_location: "independent-report.pdf" },
      "internal", "declared_context_owner", "11"),
      context("DOSSIER", "dossier", { prepared: true, responsible_owner: "Private Owner",
        artifacts: ["procurement-dossier.pdf"] }, "internal", "declared_context_owner", "13")
    ];
    const authoredPayload = structuredClone(declarations[0].artifact.payload);
    authoredPayload.evidence_refs = [];
    const payloadFile = path.join(temp, "context-payload.json");
    const candidateFile = path.join(temp, "artifacts", "authored-context.json");
    writeJson(payloadFile, authoredPayload);
    const authored = spawnSync(process.execPath, [path.join(skill, "scripts/create-audit-artifact.mjs"), "init",
      "--run", fixture.runFile, "--type", "audit-context", "--role", "declared_context_reviewer",
      "--payload", payloadFile, "--evidence-file", path.join(temp, "artifacts", declarations[0].sourcePath),
      "--target-ref", run.target.urls_or_files[0], "--captured-at", "2026-07-17T12:00:05Z",
      "--output", candidateFile], { encoding: "utf8" });
    assert.equal(authored.status, 0, authored.stderr);
    assert.equal(readJson(candidateFile).payload.evidence_refs.length, 1);
    for (const item of declarations) {
      run = registerArtifact(run, item.artifact, { skillRoot: skill, runFile: fixture.runFile, artifactFile: item.file });
      writeJson(fixture.runFile, run);
      fixture.resources.artifact_snapshots_by_id.set(item.artifact.artifact_id, {
        bytes: fs.readFileSync(item.file), sha256: resourcesSha256(item.file)
      });
      fixture.resources.evidence_snapshots_by_path.set(item.sourcePath, { bytes: item.bytes, sha256: sha256Bytes(item.bytes) });
    }
    const merged = mergeArtifacts({ run, assessment: fixture.baseline, artifacts: [...fixture.artifacts, ...declarations.map((item) => item.artifact)],
      registries: fixture.resources });
    assert.equal(merged.assessment.participation_coverage.find, "cant_tell");
    assert.equal(merged.assessment.next_review_at, "2026-10-01");
    assert.equal(merged.assessment.next_review_owner, "Private Owner");
    assert.equal(merged.assessment.assurance.independent_audit.performed, true);
    assert.equal(merged.assessment.assurance.legal_or_procurement_dossier.prepared, true);
    assert.equal(merged.assessment.evidence_level, "E2");
    const inflated = structuredClone(merged);
    inflated.assessment.evidence_level = "E4";
    assert.equal(validate(inflated).valid, false);
    const runValidation = validateAuditRun(run, { skillRoot: skill, runFile: fixture.runFile });
    assert.equal(runValidation.valid, true, runValidation.errors.join("\n"));
    const publicModel = buildCurrentPublicReportModel({ run, assessment: merged,
      envelopesById: runValidation.envelopesById,
      resources: fixture.resources });
    assert.equal(publicModel.auditContext.participation_coverage.find, "cant_tell");
    assert.equal(publicModel.auditContext.next_review_at, "2026-10-01");
    assert.ok(!JSON.stringify(publicModel).includes("Private constraint"));
    assert.ok(!JSON.stringify(publicModel).includes("Private Owner"));
    const assessmentFile = path.join(temp, "context-assessment.json");
    writeJson(assessmentFile, merged);
    const output = path.join(temp, "public-context.md");
    const manifest = path.join(temp, "public-context-manifest.json");
    const rendered = spawnSync(process.execPath, [path.join(skill, "scripts/render-report.mjs"),
      "--run", fixture.runFile, "--assessment", assessmentFile, "--output", output,
      "--visibility", "public", "--reviewer-disclosure", "redact", "--redaction-manifest", manifest], { encoding: "utf8" });
    assert.equal(rendered.status, 0, rendered.stderr);
    const publicReport = fs.readFileSync(output, "utf8");
    assert.match(publicReport, /2026-10-01/u);
    assert.ok(publicReport.includes("cant\\_tell"));
    assert.ok(!publicReport.includes("Private constraint"));
    assert.ok(!publicReport.includes("Private Owner"));
    assert.ok(!publicReport.includes("independent-report.pdf"));
    assert.ok(!publicReport.includes("procurement-dossier.pdf"));
    const summaryFile = path.join(temp, "public-context-summary.html");
    const summaryManifest = path.join(temp, "public-context-summary-manifest.json");
    const summary = spawnSync(process.execPath, [path.join(skill, "scripts/render-report.mjs"),
      "--run", fixture.runFile, "--assessment", assessmentFile, "--output", summaryFile,
      "--format", "html", "--detail", "summary", "--visibility", "public",
      "--reviewer-disclosure", "redact", "--redaction-manifest", summaryManifest], { encoding: "utf8" });
    assert.equal(summary.status, 0, summary.stderr);
    const publicHtml = fs.readFileSync(summaryFile, "utf8");
    assert.match(publicHtml, /audit-context/u);
    assert.match(publicHtml, /2026-10-01/u);
    for (const privateText of ["Private constraint", "Private Owner", "independent-report.pdf", "procurement-dossier.pdf"]) {
      assert.ok(!publicHtml.includes(privateText), privateText);
    }
    const internalFile = path.join(temp, "internal-context.html");
    const internal = spawnSync(process.execPath, [path.join(skill, "scripts/render-report.mjs"),
      "--run", fixture.runFile, "--assessment", assessmentFile, "--output", internalFile,
      "--format", "html", "--visibility", "internal"], { encoding: "utf8" });
    assert.equal(internal.status, 0, internal.stderr);
    const internalHtml = fs.readFileSync(internalFile, "utf8");
    for (const internalText of ["Private constraint", "Private Owner", "independent-report.pdf", "procurement-dossier.pdf"]) {
      assert.ok(internalHtml.includes(internalText), internalText);
    }
    const falsified = structuredClone(merged);
    falsified.assessment.next_review_at = "2026-10-02";
    const falsifiedFile = path.join(temp, "falsified-assessment.json");
    writeJson(falsifiedFile, falsified);
    const rejected = spawnSync(process.execPath, [path.join(skill, "scripts/render-report.mjs"),
      "--run", fixture.runFile, "--assessment", falsifiedFile, "--output", path.join(temp, "falsified-report.md")],
    { encoding: "utf8" });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /next review schedule does not exactly match/u);
    const wrongRole = context("WRONG", "participation", { perspective: "receive", outcome: "fail" }, "public",
      "declared_context_owner", "15");
    assert.throws(() => registerArtifact(run, wrongRole.artifact,
      { skillRoot: skill, runFile: fixture.runFile, artifactFile: wrongRole.file }), /cannot declare participation/);
    const duplicate = context("DUP", "participation", { perspective: "find", outcome: "pass" }, "public",
      "declared_context_reviewer", "17");
    assert.throws(() => registerArtifact(run, duplicate.artifact,
      { skillRoot: skill, runFile: fixture.runFile, artifactFile: duplicate.file }), /Conflicting audit-context declaration/);
    const altered = Buffer.from("Tampered source\n");
    fs.writeFileSync(path.join(temp, "artifacts", declarations[0].sourcePath), altered);
    assert.equal(validateAuditRun(run, { skillRoot: skill, runFile: fixture.runFile }).valid, false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("participant observations stay separate from conformance and publish only consented repeated themes", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-participant-"));
  try {
    const fixture = reportRunFixture(temp);
    let { run } = fixture;
    const source = fixture.artifacts.find((item) => item.artifact_type === "remediation-plan");
    const entry = run.artifacts.find((item) => item.artifact_id === source.artifact_id);
    const participant = (id, seconds, publicAggregate, themeId = "THM-NAVIGATION", label = "Checkout navigation barrier") => {
      const sourcePath = `participant-${id}.txt`;
      const bytes = Buffer.from(`Private task notes for ${id}\n`);
      fs.writeFileSync(path.join(temp, "artifacts", sourcePath), bytes);
      const capturedAt = `2026-07-17T13:00:${seconds}Z`;
      const artifact = {
        schema_version: "3.0.0",
        artifact_id: `ART-PARTICIPANT-${id}`,
        artifact_type: "participant-usability-observation",
        run_id: run.run_id,
        target_snapshot_ids: run.target_inventory.snapshots.map((item) => item.snapshot_id),
        producer: { role_id: "declared_participant_facilitator", producer_kind: "external_human", origin: "test declaration" },
        created_at: `2026-07-17T13:01:${seconds}Z`,
        inputs: [{ artifact_id: source.artifact_id, run_id: run.run_id, sha256: entry.sha256 }],
        payload: {
          schema_version: "1.0.0", participant_id: `P-${id}`, facilitator_id: "F-FACILITATOR1",
          session_at: capturedAt, access_needs: ["vision"], assistive_technology: ["screen_reader"],
          task_id: "checkout", journey: "Complete checkout", perspectives: ["find", "continue"],
          environment: "Desktop browser and screen reader", outcome: "partial", duration_seconds: 300,
          assistance_required: true,
          observations: [{ kind: "barrier", text: "The next step needed a workaround.", severity: "medium" }],
          themes: [{ id: themeId, label }], related_finding_ids: [], related_remediation_ids: ["REM-REPORT01"],
          consent: { participation: true, public_aggregate: publicAggregate, quote_capture: false,
            quote_publication: false, recording_capture: false, recording_publication: false,
            recording_collected: false, retention_until: "2027-07-17", redaction_status: "verified" },
          source_artifact_ids: [source.artifact_id],
          evidence_refs: [createRunEvidenceReference({ run, targetRef: run.target.urls_or_files[0],
            evidenceType: "other", relativePath: sourcePath, bytes, capturedAt })]
        }
      };
      const file = path.join(temp, "artifacts", `participant-${id}.json`);
      writeJson(file, artifact);
      return { artifact, file, sourcePath, bytes };
    };
    const add = (item) => {
      run = registerArtifact(run, item.artifact, { skillRoot: skill, runFile: fixture.runFile, artifactFile: item.file });
      writeJson(fixture.runFile, run);
      fixture.resources.artifact_snapshots_by_id.set(item.artifact.artifact_id,
        { bytes: fs.readFileSync(item.file), sha256: resourcesSha256(item.file) });
      fixture.resources.evidence_snapshots_by_path.set(item.sourcePath,
        { bytes: item.bytes, sha256: sha256Bytes(item.bytes) });
    };
    const first = participant("ABCDEFGH", "05", true);
    const second = participant("IJKLMNO9", "07", true);
    const payloadFile = path.join(temp, "participant-payload.json");
    writeJson(payloadFile, { ...first.artifact.payload, evidence_refs: [] });
    const authoredFile = path.join(temp, "artifacts", "authored-participant.json");
    const authored = spawnSync(process.execPath, [path.join(skill, "scripts/create-audit-artifact.mjs"), "init",
      "--run", fixture.runFile, "--type", "participant-usability-observation",
      "--role", "declared_participant_facilitator", "--payload", payloadFile,
      "--input", source.artifact_id, "--evidence-file", path.join(temp, "artifacts", first.sourcePath),
      "--target-ref", run.target.urls_or_files[0], "--captured-at", first.artifact.payload.session_at,
      "--output", authoredFile], { encoding: "utf8" });
    assert.equal(authored.status, 0, authored.stderr);
    assert.equal(readJson(authoredFile).payload.evidence_refs.length, 1);
    add(first);
    add(second);
    add(participant("PQRSTUVW", "09", false, "THM-PRIVATE", "Private personal theme"));
    const expired = participant("QQQQQQQQ", "10", true, "THM-EXPIRED", "Expired personal theme");
    expired.artifact.payload.consent.retention_until = "2026-08-01";
    writeJson(expired.file, expired.artifact);
    add(expired);
    const merged = mergeArtifacts({ run, assessment: fixture.baseline,
      artifacts: [...fixture.artifacts, ...run.artifacts.filter((item) => item.artifact_type === "participant-usability-observation")
        .map((item) => readJson(path.join(temp, "artifacts", item.path)))], registries: fixture.resources });
    assert.deepEqual(merged.assessment.results, fixture.assessment.assessment.results);
    assert.equal(merged.assessment.evidence_level, fixture.assessment.assessment.evidence_level);
    const assessmentFile = path.join(temp, "participant-assessment.json");
    writeJson(assessmentFile, merged);
    const output = path.join(temp, "participant-public.html");
    const manifest = path.join(temp, "participant-redactions.json");
    const rendered = spawnSync(process.execPath, [path.join(skill, "scripts/render-report.mjs"),
      "--run", fixture.runFile, "--assessment", assessmentFile, "--output", output, "--format", "html",
      "--detail", "summary", "--visibility", "public", "--reviewer-disclosure", "redact",
      "--redaction-manifest", manifest], { encoding: "utf8" });
    assert.equal(rendered.status, 0, rendered.stderr);
    const html = fs.readFileSync(output, "utf8");
    assert.match(html, /Checkout navigation barrier/u);
    assert.match(html, /participant-usability/u);
    const markdownFile = path.join(temp, "participant-public.md");
    const markdownManifest = path.join(temp, "participant-markdown-redactions.json");
    const markdown = spawnSync(process.execPath, [path.join(skill, "scripts/render-report.mjs"),
      "--run", fixture.runFile, "--assessment", assessmentFile, "--output", markdownFile,
      "--visibility", "public", "--reviewer-disclosure", "redact",
      "--redaction-manifest", markdownManifest], { encoding: "utf8" });
    assert.equal(markdown.status, 0, markdown.stderr);
    const markdownText = fs.readFileSync(markdownFile, "utf8");
    assert.match(markdownText, /Checkout navigation barrier/u);
    for (const privateText of ["P-ABCDEFGH", "P-IJKLMNO9", "P-PQRSTUVW", "Private personal theme", "Expired personal theme",
      "The next step needed a workaround", "participant-ABCDEFGH.txt"]) {
      assert.ok(!html.includes(privateText), privateText);
      assert.ok(!markdownText.includes(privateText), privateText);
    }
    const invalidConsent = participant("ZZZZZZZZ", "11", true);
    invalidConsent.artifact.payload.consent.participation = false;
    writeJson(invalidConsent.file, invalidConsent.artifact);
    assert.throws(() => registerArtifact(run, invalidConsent.artifact,
      { skillRoot: skill, runFile: fixture.runFile, artifactFile: invalidConsent.file }), /consent.participation|participation consent/);
    const directIdentifier = participant("YYYYYYYY", "13", true);
    directIdentifier.artifact.payload.observations[0].text = "Contact someone@example.com for help.";
    writeJson(directIdentifier.file, directIdentifier.artifact);
    assert.throws(() => registerArtifact(run, directIdentifier.artifact,
      { skillRoot: skill, runFile: fixture.runFile, artifactFile: directIdentifier.file }), /direct contact identifier/);
    const wrongRun = participant("XXXXXXXX", "15", true);
    wrongRun.artifact.run_id = "RUN-OTHER";
    writeJson(wrongRun.file, wrongRun.artifact);
    assert.throws(() => registerArtifact(run, wrongRun.artifact,
      { skillRoot: skill, runFile: fixture.runFile, artifactFile: wrongRun.file }), /same run|run_id/u);
    fs.writeFileSync(path.join(temp, "artifacts", first.sourcePath), "Changed source bytes\n");
    assert.equal(validateAuditRun(run, { skillRoot: skill, runFile: fixture.runFile }).valid, false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("human findings survive without a remediation plan and can acquire a plan later", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-finding-only-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const fixture = reportRunFixture(temp, { declaredFinding: true, withoutPlan: true });
  const finding = fixture.assessment.assessment.findings[0];
  assert.equal(finding.id, "FIND-HUMAN-REPORT");
  assert.equal(finding.priority, "P1");
  assert.equal(finding.remediation_status, "unplanned");
  assert.equal(finding.remediation, null);
  assert.equal(validateAssessment(fixture.assessment, registry, schema, catalog, methods, { run: fixture.run, artifactSnapshotsById: fixture.resources.artifact_snapshots_by_id }).valid, true);
  for (const format of ["markdown", "html"]) {
    const result = spawnSync(process.execPath, [path.join(skill, "scripts/render-report.mjs"),
      "--run", fixture.runFile, "--assessment", fixture.assessmentFile,
      "--visibility", "public", "--reviewer-disclosure", "redact", "--redaction-manifest", path.join(temp, `redaction-${format}.json`),
      "--format", format, "--output", path.join(temp, `report.${format}`)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const report = fs.readFileSync(path.join(temp, `report.${format}`), "utf8");
    assert.match(report, /改善計画は未策定/u);
    assert.match(report, /The image purpose is missing/u);
    assert.doesNotMatch(report, /FIND-HUMAN-REPORT|ART-HUMAN-REPORT|External Reviewer/u);
  }
  const cli = path.join(skill, "scripts/accessibility-audit.mjs");
  const runAfterPlan = path.join(temp, "run-with-plan.json");
  const planFile = path.join(temp, "artifacts", "remediation.json");
  const registration = spawnSync(process.execPath, [cli, "register", "--run", fixture.runFile,
    "--artifact", planFile, "--output", runAfterPlan], { encoding: "utf8" });
  assert.equal(registration.status, 0, registration.stderr);
  const baselineFile = path.join(temp, "baseline.json");
  writeJson(baselineFile, fixture.baseline);
  const plannedAssessmentFile = path.join(temp, "assessment-with-plan.json");
  const merge = spawnSync(process.execPath, [cli, "merge", "--run", runAfterPlan, "--assessment", baselineFile,
    ...[...fixture.artifactFiles.values(), planFile].flatMap((file) => ["--artifact", file]),
    "--output", plannedAssessmentFile], { encoding: "utf8" });
  assert.equal(merge.status, 0, merge.stderr);
  const planned = readJson(plannedAssessmentFile);
  assert.deepEqual(planned.assessment.findings.map(({ remediation_status, remediation, verification, ...item }) => item),
    fixture.assessment.assessment.findings.map(({ remediation_status, remediation, verification, ...item }) => item));
  assert.equal(planned.assessment.findings[0].remediation_status, "planned");
  assert.match(planned.assessment.findings[0].remediation, /Provide a text alternative/u);
  const plannedReport = path.join(temp, "planned.md");
  const rendered = spawnSync(process.execPath, [cli, "report", "--run", runAfterPlan,
    "--assessment", plannedAssessmentFile, "--output", plannedReport], { encoding: "utf8" });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(fs.readFileSync(plannedReport, "utf8"), /Frontend team/u);
  const tampered = structuredClone(fixture.assessment);
  tampered.assessment.findings[0].observation = "Unregistered substituted finding.";
  writeJson(fixture.assessmentFile, tampered);
  const rejected = spawnSync(process.execPath, [path.join(skill, "scripts/render-report.mjs"),
    "--run", fixture.runFile, "--assessment", fixture.assessmentFile, "--output", path.join(temp, "forged.md")], { encoding: "utf8" });
  assert.notEqual(rejected.status, 0);
  assert.equal(fs.existsSync(path.join(temp, "forged.md")), false);
});

test("finding-only records require failure, impact, location and evidence in both workflows", (t) => {
  const record = reviewedRecord();
  Object.assign(record.assessment.findings[0], { remediation_status: "unplanned", remediation: null, verification: null });
  assert.equal(validate(record).valid, true);
  for (const mutate of [
    (r) => { r.assessment.findings[0].affected_users = []; },
    (r) => { r.assessment.findings[0].location = ""; },
    (r) => { r.assessment.results.find((item) => item.outcome === "fail").evidence = []; },
    (r) => { r.assessment.findings[0].remediation_status = "planned"; }
  ]) {
    const invalid = structuredClone(record);
    mutate(invalid);
    assert.equal(validate(invalid).valid, false);
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-finding-binding-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const fixture = reportRunFixture(temp, { declaredFinding: true, withoutPlan: true });
  const file = fixture.artifactFiles.get("ART-HUMAN-REPORT");
  const original = readJson(file);
  for (const mutate of [
    (r) => { r.finding.affected_users = []; }, (r) => { r.finding.location = ""; },
    (r) => { r.target_specific_evidence = []; }, (r) => { r.profile_outcome = "pass"; }
  ]) {
    const artifact = structuredClone(original);
    mutate(artifact.payload.reviews[0]);
    writeJson(file, artifact);
    fixture.run.artifacts.find((item) => item.artifact_id === artifact.artifact_id).sha256 = resourcesSha256(file);
    assert.equal(validateAuditRun(fixture.run, { skillRoot: skill, runFile: fixture.runFile }).valid, false);
  }
});

test("merge CLI selects only evidence-backed fixed claims and leaves prior records unchanged", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-run-claims-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const fixture = reportRunFixture(temp, { declaredFinding: true, withoutPlan: true });
  const baselineFile = path.join(temp, "baseline.json");
  writeJson(baselineFile, fixture.baseline);
  const sourceFiles = [fixture.runFile, baselineFile, ...fixture.artifactFiles.values()];
  const before = sourceFiles.map(resourcesSha256);
  const cli = path.join(skill, "scripts/accessibility-audit.mjs");
  for (const tier of ["reference_only", "screened", "evaluated_subset"]) {
    const output = path.join(temp, `${tier}.json`);
    const result = spawnSync(process.execPath, [cli, "merge", "--run", fixture.runFile,
      "--assessment", baselineFile, ...[...fixture.artifactFiles.values()].flatMap((file) => ["--artifact", file]),
      "--claim-tier", tier, "--output", output], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const record = readJson(output);
    assert.deepEqual(record.assessment.claim, { requested_tier: tier, proposed_wording: registry.claim_templates[tier][0] });
    assert.equal(validate(record).guard.max_tier, "evaluated_subset");
    const model = buildPublicReportModel({ run: fixture.run, assessment: record,
      envelopesById: new Map(fixture.artifacts.map((artifact) => [artifact.artifact_id, artifact])), resources: fixture.resources });
    assert.equal(model.claim.tier, { reference_only: "Reference only", screened: "Screened", evaluated_subset: "Evaluated subset" }[tier]);
    assert.match(renderRunBackedReport(model), new RegExp({ reference_only: "規格参照のみ", screened: "スクリーニング", evaluated_subset: "一部の条項について人手レビュー" }[tier], "u"));
    const report = spawnSync(process.execPath, [cli, "report", "--run", fixture.runFile,
      "--assessment", output, "--output", path.join(temp, `${tier}.md`)], { encoding: "utf8" });
    assert.equal(report.status, 0, report.stderr);
    assert.match(fs.readFileSync(path.join(temp, `${tier}.md`), "utf8"), /申告|external trust policy/u);
  }
  assert.deepEqual(sourceFiles.map(resourcesSha256), before);
  const screenRun = structuredClone(fixture.run);
  screenRun.status = "screened";
  screenRun.artifacts = screenRun.artifacts.filter((item) => item.artifact_type === "screening-observations");
  screenRun.history = screenRun.history.slice(0, 1);
  const screenArgs = { run: screenRun, assessment: fixture.baseline, artifacts: [fixture.artifacts[0]], registries: fixture.resources };
  assert.equal(mergeArtifacts({ ...screenArgs, claimTier: "screened" }).assessment.claim.requested_tier, "screened");
  assert.throws(() => mergeArtifacts({ ...screenArgs, claimTier: "evaluated_subset" }), /tier|evidence|E2/i);
  assert.throws(() => mergeArtifacts({ ...screenArgs, claimTier: "conformance_candidate" }), /claim-tier/u);
  const emptyRun = { ...screenRun, status: "initialized", artifacts: [], history: [] };
  assert.equal(validate(mergeArtifacts({ ...screenArgs, run: emptyRun, artifacts: [] })).guard.max_tier, "reference_only");
  assert.throws(() => mergeArtifacts({ ...screenArgs, run: emptyRun, artifacts: [], claimTier: "screened" }), /tier|evidence/i);

  const tampered = readJson(path.join(temp, "evaluated_subset.json"));
  tampered.assessment.claim.proposed_wording = "Unregistered wording";
  writeJson(path.join(temp, "tampered.json"), tampered);
  const rejected = spawnSync(process.execPath, [cli, "report", "--run", fixture.runFile,
    "--assessment", path.join(temp, "tampered.json"), "--output", path.join(temp, "invalid-claim.md")], { encoding: "utf8" });
  assert.notEqual(rejected.status, 0);
  assert.equal(fs.existsSync(path.join(temp, "invalid-claim.md")), false);
});

test("status verifies major states, coverage, allowed transitions, successors and read-only CLI output", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-status-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const fixture = reportRunFixture(temp, { declaredFinding: true });
  const states = ["initialized", ...fixture.run.history.map((item) => item.to)];
  const manifests = states.map((state, index) => {
    const run = structuredClone(fixture.run);
    run.status = state;
    run.history = run.history.slice(0, index);
    const registered = new Set(run.history.flatMap((item) => item.artifact_ids));
    run.artifacts = run.artifacts.filter((item) => registered.has(item.artifact_id));
    const file = path.join(temp, `state-${index}.json`);
    writeJson(file, run);
    return file;
  });
  const files = [...manifests, fixture.runFile, ...fixture.artifactFiles.values()];
  const before = files.map(resourcesSha256);
  for (const [index, file] of manifests.entries()) {
    const result = auditStatus(file);
    const schemaErrors = [];
    validateJsonSchema(result, readJson(path.join(skill, "references/audit-status.schema.json")), "$", schemaErrors);
    assert.deepEqual(schemaErrors, []);
    assert.equal(result.schema_version, "1.0.0");
    assert.equal(result.valid, true, result.errors.join("\n"));
    assert.equal(result.run.state, states[index]);
    assert.equal(result.artifacts.length, index);
    assert.equal(result.coverage.human_reviewed, index >= 3 ? 2 : 0);
    assert.equal(result.coverage.profile_requirements, 55);
    assert.equal(result.claim.max_tier, index >= 3 ? "evaluated_subset" : index ? "screened" : "reference_only");
    assert.equal(result.claim.profile_ceiling, "evaluated_subset");
    assert.equal(result.operations.merge.available, index > 0);
    assert.equal(result.operations.report.available, true);
    assert.equal(result.operations.retest.available, false);
    if (index < 4) assert.ok(result.warnings.some((warning) => warning.code === "superseded_run"));
    const expected = fixture.resources.orchestrationRegistry.transitions.filter((item) => item.from === states[index]);
    assert.deepEqual(result.next_transitions.map((item) => item.to), expected.map((item) => item.to));
    for (const transition of result.next_transitions) {
      if (transition.required_artifact_types.includes("fix-authorization")) assert.equal(transition.permitted, false);
    }
    assert.match(statusText(result, "ja"), /監査の状態/u);
  }
  const cli = path.join(skill, "scripts/accessibility-audit.mjs");
  const json = spawnSync(process.execPath, [cli, "status", "--run", fixture.runFile, "--format", "json"], { encoding: "utf8" });
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).run.state, "remediation_ready");
  const text = spawnSync(process.execPath, [cli, "--locale", "ja", "status", "--run", fixture.runFile], { encoding: "utf8" });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /人手確認: 2\/55/u);
  assert.deepEqual(files.map(resourcesSha256), before);
});

test("status refuses corrupt evidence and detects ambiguous related manifests", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-status-invalid-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const fixture = reportRunFixture(temp, { declaredFinding: true, withoutPlan: true });
  const divergent = structuredClone(fixture.run);
  divergent.scope.included.push("Another scope with a reused ID");
  writeJson(path.join(temp, "divergent.json"), divergent);
  assert.ok(auditStatus(fixture.runFile).warnings.some((warning) => warning.code === "divergent_run"));
  const humanFile = fixture.artifactFiles.get("ART-HUMAN-REPORT");
  fs.appendFileSync(humanFile, " ");
  const invalid = auditStatus(fixture.runFile);
  const schemaErrors = [];
  validateJsonSchema(invalid, readJson(path.join(skill, "references/audit-status.schema.json")), "$", schemaErrors);
  assert.deepEqual(schemaErrors, []);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => /hash/i.test(error)));
  assert.ok(Object.values(invalid.operations).every((operation) => !operation.available));
  assert.equal(invalid.claim.max_tier, null);
  assert.equal(invalid.coverage.human_reviewed, null);
  assert.ok(invalid.recovery.length);
  const cli = spawnSync(process.execPath, [path.join(skill, "scripts/accessibility-audit.mjs"), "status",
    "--run", fixture.runFile, "--format", "json"], { encoding: "utf8" });
  assert.equal(cli.status, 1);
  assert.equal(JSON.parse(cli.stdout).valid, false);
  const nullFile = path.join(temp, "null.json");
  writeJson(nullFile, null);
  assert.equal(auditStatus(nullFile).valid, false);
  const malformedFile = path.join(temp, "malformed-types.json");
  writeJson(malformedFile, { run_id: 42, schema_version: 7, status: false, profile: { id: 42 }, permissions: [],
    artifacts: [{ artifact_id: 42, artifact_type: [], producer_role: false, sha256: {} }] });
  const malformed = auditStatus(malformedFile);
  const malformedSchemaErrors = [];
  validateJsonSchema(malformed, readJson(path.join(skill, "references/audit-status.schema.json")), "$", malformedSchemaErrors);
  assert.deepEqual(malformedSchemaErrors, []);
  assert.equal(malformed.valid, false);
  assert.ok(Object.values(malformed.operations).every((operation) => !operation.available));
  assert.equal(malformed.run.id, null);
  assert.equal(malformed.run.permissions, null);
  assert.equal(malformed.artifacts[0].sha256, null);
});

test("public follow-up projection keeps counts and source records coherent and withholds private prose", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-follow-up-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const fixture = reportRunFixture(temp);
  const envelopesById = new Map([...fixture.artifactFiles].map(([id, file]) => [id, readJson(file)]));
  const observation = envelopesById.get("ART-SCREEN-REPORT").payload.observations[0];
  observation.profile_requirement_id = "WCAG-2.2-SC-1.4.4";
  observation.report_outcome = "pass";
  observation.report_rationale = "Viewport setting only.";
  const resources = loadAuditResources(skill);
  const render = () => buildPublicReportModel({ run: fixture.run, assessment: fixture.assessment, envelopesById, resources });
  const before = structuredClone(fixture.assessment);
  fixture.assessment.assessment.results.find((item) => item.mapping_status === "human_declared").review_details = {
    reason: "scope_incomplete", performed_checks: [], next_checks: ["Unregistered extra assessment detail"]
  };
  let model = render();
  assert.equal(JSON.stringify(model).includes("Unregistered extra assessment detail"), false);
  const row = () => model.reportChecks.find((item) => item.requirement_id === observation.profile_requirement_id);
  assert.equal(row().outcome, "cant_tell");
  assert.equal(model.screeningCandidates[0].report_outcome, "cant_tell");
  assert.equal(model.reportChecks.filter((item) => item.outcome === "cant_tell").length, model.reportOutcomeCounts.cant_tell);
  assert.match(renderRunBackedReport(model), /必要な検査記録が不足/u);
  assert.equal(observation.report_outcome, "pass");
  observation.review_details = {
    reason: null, performed_checks: [{ id: "text_resize_200", outcome: "pass",
      environment: "Fixture browser 1 / OS 1", evidence: "Up to 200%: content and functions retained." }], next_checks: []
  };
  model = render();
  assert.equal(row().outcome, "pass");
  const privateText = "C:\\Users\\Example\\PrivateClient\\evidence.txt";
  observation.review_details.performed_checks[0].environment = privateText;
  observation.review_details.performed_checks[0].evidence = privateText;
  observation.review_details.next_checks = [privateText];
  model = render();
  assert.equal(row().outcome, "cant_tell");
  assert.equal(JSON.stringify(model).includes("PrivateClient"), false);
  assert.equal(renderRunBackedReport(model).includes("PrivateClient"), false);
  const withoutExtra = structuredClone(fixture.assessment);
  delete withoutExtra.assessment.results.find((item) => item.mapping_status === "human_declared").review_details;
  assert.deepEqual(withoutExtra, before);
});

function resourcesSha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

test("renderer creates a self-contained report from a validated record with an actionable finding", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-audit-report-"));
  try {
    const input = path.join(temp, "assessment.json");
    fs.writeFileSync(input, JSON.stringify(reviewedRecord(), null, 2), "utf8");
    const renderer = path.join(skill, "scripts/render-audit-report.mjs");
    const run = spawnSync(process.execPath, [renderer, "--input", input], { encoding: "utf8" });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assertUnifiedJudgementReport(run.stdout, "不適合");
    assert.match(run.stdout, /Example service/);
    assert.match(run.stdout, /\| F-001 \| WCAG-2\.2-SC-2\.1\.1 \|/);
    assert.match(run.stdout, /F-001/);
    assert.match(run.stdout, /WCAG-2\.2-SC-2\.1\.1/);
    assert.match(run.stdout, /The selector cannot receive keyboard focus\./);
    assert.doesNotMatch(run.stdout, /Claim Statement|does not declare conformance/i);
    assert.equal(run.stdout.includes("REPLACE_ME"), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("run-backed renderer reports verified, pending, and unverified work without internal orchestration terms", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-run-backed-report-"));
  try {
    const fixture = reportRunFixture(temp);
    const output = path.join(temp, "report.md");
    const renderer = path.join(skill, "scripts/render-audit-report.mjs");
    const result = spawnSync(process.execPath, [
      renderer,
      "--run", fixture.runFile,
      "--assessment", fixture.assessmentFile,
      "--output", output
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = fs.readFileSync(output, "utf8");
    assertUnifiedJudgementReport(report, "不適合");
    assert.match(report, /\| WCAG-2\.2-SC-1\.3\.1 \| 適合 \|/);
    assert.match(report, /WCAG-2\.2-SC-1\.3\.1/);
    assert.match(report, /確認済みの不適合/);
    assert.match(report, /WCAG-2\.2-SC-1\.1\.1/);
    assert.match(report, /Frontend team/);
    assert.match(report, /未設定/);
    assert.match(report, /確認手順が残っている達成基準/);
    assert.match(report, /WCAG-2\.2-SC-2\.1\.1/);
    assert.match(report, /今後の確認事項/);
    assert.match(report, /SCREEN-FIRST/);
    assert.match(report, /\| WCAG-2\.2-SC-2\.4\.2 \| 不適合 \|[^\n]*The inspected page title does not identify the page topic\./);
    const formalProfileRow = fixture.assessment.assessment.results.find((item) => item.requirement_id === "WCAG-2.2-SC-2.4.2");
    assert.equal(formalProfileRow.mapping_status, "unverified");
    assert.equal(formalProfileRow.outcome, "not_tested");
    assert.match(report, /A human reviewer has not yet confirmed this observation\./);
    assert.match(report, /記録の範囲/);
    assert.match(report, /確認日: 2026-07-17/);
    assert.match(report, /規格台帳の版: 1\.0\.0/);
    assert.doesNotMatch(report, /Confirmed conformance points/i);
    for (const internal of [fixture.run.run_id, "ART-HUMAN-REPORT", "producer_role", "e1_inspector", "External Reviewer", "remediation_ready", "verified_failure", "unverified_screening_candidate", "human_verified", "reference_only"]) {
      assert.equal(report.includes(internal), false, `public report leaked internal term: ${internal}`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("run-backed renderer rejects tampering, mismatched or foreign assessment evidence, and an existing output", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-run-backed-refusal-"));
  try {
    const fixture = reportRunFixture(temp);
    const renderer = path.join(skill, "scripts/render-audit-report.mjs");
    const invoke = (assessmentFile, output) => spawnSync(process.execPath, [
      renderer,
      "--run", fixture.runFile,
      "--assessment", assessmentFile,
      "--output", output
    ], { encoding: "utf8" });

    const screenFile = fixture.artifactFiles.get("ART-SCREEN-REPORT");
    const originalScreen = fs.readFileSync(screenFile);
    fs.appendFileSync(screenFile, " ", "utf8");
    const tamperedOutput = path.join(temp, "tampered.md");
    const tampered = invoke(fixture.assessmentFile, tamperedOutput);
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.stderr || tampered.stdout, /current hash mismatch/);
    assert.equal(fs.existsSync(tamperedOutput), false);
    fs.writeFileSync(screenFile, originalScreen);

    const mismatchedAssessment = structuredClone(fixture.assessment);
    mismatchedAssessment.assessment.target.name = "Different target";
    const mismatchFile = path.join(temp, "mismatch.json");
    writeJson(mismatchFile, mismatchedAssessment);
    const mismatchOutput = path.join(temp, "mismatch.md");
    const mismatch = invoke(mismatchFile, mismatchOutput);
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr || mismatch.stdout, /target (?:does not match|differs from)/);
    assert.equal(fs.existsSync(mismatchOutput), false);

    const foreignAssessment = structuredClone(fixture.assessment);
    const foreignRow = foreignAssessment.assessment.results.find((result) => result.requirement_id === "WCAG-2.2-SC-1.3.1");
    foreignRow.method = "A different but otherwise valid manual review.";
    foreignRow.notes = "A different but otherwise valid manual review.";
    const foreignValidation = validate(foreignAssessment);
    assert.equal(foreignValidation.valid, false, "A current assessment also requires the original run and exactly bound review.");
    const foreignFile = path.join(temp, "foreign.json");
    writeJson(foreignFile, foreignAssessment);
    const foreignOutput = path.join(temp, "foreign.md");
    const foreign = invoke(foreignFile, foreignOutput);
    assert.notEqual(foreign.status, 0);
    assert.match(foreign.stderr || foreign.stdout, /differs from the complete human review consensus/);
    assert.equal(fs.existsSync(foreignOutput), false);

    const existingOutput = path.join(temp, "existing.md");
    fs.writeFileSync(existingOutput, "preserve", "utf8");
    const existing = invoke(fixture.assessmentFile, existingOutput);
    assert.notEqual(existing.status, 0);
    assert.match(existing.stderr || existing.stdout, /Refusing to overwrite existing file/);
    assert.equal(fs.readFileSync(existingOutput, "utf8"), "preserve");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("run-backed renderer rejects extra limitations before they can leak internal artifact metadata", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-run-backed-limitations-"));
  try {
    const fixture = reportRunFixture(temp);
    const renderer = path.join(skill, "scripts/render-audit-report.mjs");
    const tampered = structuredClone(fixture.assessment);
    tampered.assessment.limitations.push("ART-HUMAN-REPORT verified_failure: forged internal metadata");
    const assessmentFile = path.join(temp, "extra-limitation.json");
    const output = path.join(temp, "extra-limitation.md");
    writeJson(assessmentFile, tampered);

    const result = spawnSync(process.execPath, [
      renderer,
      "--run", fixture.runFile,
      "--assessment", assessmentFile,
      "--output", output
    ], { encoding: "utf8" });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /limitations do not exactly match/i);
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("run-backed renderer rejects internal control metadata embedded in registered remediation text", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-run-backed-internal-metadata-"));
  try {
    const fixture = reportRunFixture(temp);
    const renderer = path.join(skill, "scripts/render-audit-report.mjs");
    const remediationFile = fixture.artifactFiles.get("ART-REMEDIATION-REPORT");
    const remediation = JSON.parse(fs.readFileSync(remediationFile, "utf8"));
    const item = remediation.payload.items[0];
    item.issue = `Leak ${fixture.run.run_id} from ART-HUMAN-REPORT and ART-FOREIGN-LEAK.`;
    item.proposed_change = "Do not expose e1_inspector or information-accessibility-e1-inspector.";
    item.verification = "Do not publish remediation_ready, verified_failure, or human_verified.";
    item.owner = "Avoid unverified_screening_candidate and reference_only.";
    item.residual_limitation = "Internal mapping token retained for guard coverage.";
    writeJson(remediationFile, remediation);
    const remediationEntry = fixture.run.artifacts.find((entry) => entry.artifact_id === remediation.artifact_id);
    remediationEntry.sha256 = resourcesSha256(remediationFile);
    writeJson(fixture.runFile, fixture.run);

    const resources = loadAuditResources(skill);
    resources.artifact_snapshots_by_id = new Map([...fixture.artifactFiles].map(([artifactId, file]) => {
      const bytes = fs.readFileSync(file);
      return [artifactId, { bytes, sha256: resourcesSha256(file) }];
    }));
    const artifacts = [...fixture.artifactFiles.values()].map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
    const baseline = generateAssessment("web-modern", {
      targetName: fixture.run.target.name,
      targetVersion: fixture.run.target.version_or_commit,
      targetRefs: fixture.run.target.urls_or_files,
      evaluator: "Audit orchestrator",
      evaluatedAt: "2026-07-17"
    });
    baseline.assessment.scope = structuredClone(fixture.run.scope);
    baseline.assessment.environment = structuredClone(fixture.run.environment);
    resources.evidence_snapshots_by_path = fixtureEvidenceSnapshots(path.dirname([...fixture.artifactFiles.values()][0]));
    const assessment = mergeArtifacts({ run: fixture.run, assessment: baseline, artifacts, registries: resources });
    writeJson(fixture.assessmentFile, assessment);

    const output = path.join(temp, "internal-metadata.md");
    const result = spawnSync(process.execPath, [
      renderer,
      "--run", fixture.runFile,
      "--assessment", fixture.assessmentFile,
      "--output", output
    ], { encoding: "utf8" });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr || result.stdout, /internal control metadata/i);
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("run-backed public model permits ordinary workflow words such as screened", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-run-backed-ordinary-state-word-"));
  try {
    const fixture = reportRunFixture(temp);
    fixture.run.target.name = "Screened community service";
    fixture.assessment.assessment.target.name = fixture.run.target.name;
    const envelopesById = new Map([...fixture.artifactFiles].map(([artifactId, file]) => [artifactId, readJson(file)]));
    const screen = envelopesById.get("ART-SCREEN-REPORT");
    screen.payload.observations[0].observation = "The screened page still needs a person to inspect its heading structure.";
    const resources = loadAuditResources(skill);

    const report = renderRunBackedReport(buildPublicReportModel({
      run: fixture.run,
      assessment: fixture.assessment,
      envelopesById,
      resources
    }));

    assert.match(report, /Screened community service/);
    assert.match(report, /The screened page still needs a person to inspect its heading structure\./);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("run-backed public model still rejects IDs, role names, and registered artifact paths", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-run-backed-internal-identifiers-"));
  try {
    const fixture = reportRunFixture(temp);
    const resources = loadAuditResources(skill);
    const internalValues = [
      fixture.run.run_id,
      fixture.run.artifacts[0].artifact_id,
      fixture.run.artifacts[0].producer_role,
      fixture.run.artifact_root,
      fixture.run.artifacts[0].path,
      fixture.run.target_inventory.sha256,
      fixture.run.target_inventory.environment_sha256,
      fixture.run.target_inventory.snapshots[0].snapshot_id,
      fixture.run.target_inventory.snapshots[0].identity.bundle_sha256,
      fixture.run.target_inventory.snapshots[0].identity.authentication_state_id,
      resources.orchestrationRegistry.roles.find((role) => role.agent_id)?.agent_id,
      "ART-FOREIGN-LEAK"
    ];

    for (const internalValue of internalValues) {
      const envelopesById = new Map([...fixture.artifactFiles].map(([artifactId, file]) => [artifactId, readJson(file)]));
      envelopesById.get("ART-SCREEN-REPORT").payload.observations[0].observation = `Internal value ${internalValue} must not be public.`;
      assert.throws(() => buildPublicReportModel({
        run: fixture.run,
        assessment: fixture.assessment,
        envelopesById,
        resources
      }), /internal control metadata/i, `internal value was permitted: ${internalValue}`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("run-backed public model withholds local paths, branch-like values, and machine names while retaining safe public context", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-run-backed-public-redaction-"));
  try {
    const fixture = reportRunFixture(temp);
    const sensitive = {
      branch: "internal/example-branch",
      windows: "C:\\Users\\Example\\private\\page.html",
      posix: "/home/example/private/page.html",
      unc: "\\\\fileserver\\team\\private.html",
      fileUrl: "file:///Users/example/private/page.html",
      machine: "Example-PC",
      unsafeUrl: "https://user:secret@example.invalid/checkout?token=private#internal",
      embeddedWindows: "DOM snapshot: C:\\Users\\Example\\private\\page.html",
      leadingUnsafeUrl: " https://user:secret@example.invalid/private",
      malformedUrl: "https://user:secret@",
      multiUrlLocation: "Primary: https://example.com/a; mirror: https://user:secret@example.invalid/private"
    };
    fixture.run.target.version_or_commit = sensitive.branch;
    fixture.run.target.urls_or_files = [
      "https://example.com/accessibility",
      sensitive.windows,
      sensitive.posix,
      sensitive.unc,
      sensitive.fileUrl,
      sensitive.unsafeUrl,
      sensitive.leadingUnsafeUrl,
      sensitive.malformedUrl
    ];
    fixture.run.scope = {
      included: ["Public checkout", sensitive.windows, sensitive.embeddedWindows],
      excluded: [sensitive.posix],
      complete_processes: ["Checkout"],
      third_party_content: ["Hosted payment widget", sensitive.unc],
      full_pages_reviewed: false
    };
    fixture.run.environment = {
      os: ["Windows 11", sensitive.machine],
      browsers: ["Chrome 126"],
      assistive_technologies: ["NVDA 2025"],
      input_modes: ["Keyboard"]
    };
    fixture.assessment.assessment.target = structuredClone(fixture.run.target);
    fixture.assessment.assessment.scope = structuredClone(fixture.run.scope);
    fixture.assessment.assessment.environment = structuredClone(fixture.run.environment);
    const envelopesById = new Map([...fixture.artifactFiles].map(([artifactId, file]) => [artifactId, readJson(file)]));
    envelopesById.get("ART-SCREEN-REPORT").payload.observations[0].location = sensitive.multiUrlLocation;
    const passEvidence = envelopesById.get("ART-HUMAN-REPORT").payload.reviews[1].target_specific_evidence;
    passEvidence[0].location = sensitive.posix;
    passEvidence[1].location = sensitive.leadingUnsafeUrl;
    passEvidence.push({ ...structuredClone(passEvidence[0]), location: sensitive.malformedUrl });
    passEvidence.push({ ...structuredClone(passEvidence[0]), location: sensitive.embeddedWindows });
    envelopesById.get("ART-REMEDIATION-REPORT").payload.items[0].location = sensitive.fileUrl;
    fixture.assessment.assessment.findings[0].location = sensitive.unc;
    const resources = loadAuditResources(skill);

    const report = renderRunBackedReport(buildPublicReportModel({
      run: fixture.run,
      assessment: fixture.assessment,
      envelopesById,
      resources
    }));

    for (const value of Object.values(sensitive)) {
      assert.equal(report.includes(value), false, `public report leaked: ${value}`);
      assert.equal(report.includes(value.trim()), false, `public report leaked normalized value: ${value.trim()}`);
    }
    assert.match(report, /https:\/\/example\.com\/accessibility/);
    for (const value of ["Public checkout", "Checkout", "Hosted payment widget", "Windows 11", "Chrome 126", "NVDA 2025", "Keyboard"]) {
      assert.match(report, new RegExp(value, "u"));
    }
    assert.match(report, /Withheld from public report/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("run-backed public model recursively withholds sensitive values from every public string", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-run-backed-recursive-public-redaction-"));
  try {
    const fixture = reportRunFixture(temp);
    const privatePath = "C:\\Users\\Example\\PrivateClient\\observation.txt";
    const privateSentence = `Evidence saved at ${privatePath}`;
    const commaPrivateSentence = `Evidence path,${privatePath}`;
    const relativeTargetRef = "src/private-client/page.html";
    const relativeSecretFile = "client/secrets.env";
    const relativePrivateDirectory = "client/private";
    const safePublicUrl = "https://www.w3.org/WAI/WCAG22/Understanding/non-text-content/";
    const productName = "Screened Community Portal";

    fixture.run.target.name = productName;
    fixture.run.target.urls_or_files = [safePublicUrl, relativeTargetRef];
    fixture.run.environment.os = ["Windows 11", "Windows 11 on CLIENT-WS042"];
    fixture.run.environment.browsers = ["Chrome 126", "Node.js 22", "PDF.js 4.2"];
    fixture.run.environment.input_modes = ["Keyboard", "WCAG/JIS/EN comparison"];
    fixture.assessment.assessment.target = structuredClone(fixture.run.target);
    fixture.assessment.assessment.environment = structuredClone(fixture.run.environment);
    fixture.assessment.assessment.findings[0].observation = privateSentence;
    fixture.assessment.assessment.limitations.push(privateSentence, relativeSecretFile, relativePrivateDirectory);
    // Claim wording is now fixed and validated even in the projection API.
    fixture.assessment.assessment.limitations.push(commaPrivateSentence);

    const envelopesById = new Map([...fixture.artifactFiles].map(([artifactId, file]) => [artifactId, readJson(file)]));
    envelopesById.get("ART-SCREEN-REPORT").payload.observations[0].observation = privateSentence;
    envelopesById.get("ART-HUMAN-REPORT").payload.reviews[1].rationale = privateSentence;
    const remediation = envelopesById.get("ART-REMEDIATION-REPORT").payload.items[0];
    remediation.issue = privateSentence;
    remediation.proposed_change = privateSentence;
    remediation.verification = privateSentence;
    remediation.owner = privateSentence;
    remediation.residual_limitation = privateSentence;

    const report = renderRunBackedReport(buildPublicReportModel({
      run: fixture.run,
      assessment: fixture.assessment,
      envelopesById,
      resources: loadAuditResources(skill)
    }));

    for (const sensitive of [privatePath, privateSentence, commaPrivateSentence, "PrivateClient", relativeTargetRef, relativeSecretFile, relativePrivateDirectory, "CLIENT-WS042"]) {
      assert.equal(report.includes(sensitive), false, `public report leaked recursive sensitive value: ${sensitive}`);
    }
    assert.match(report, /Withheld from public report/);
    assert.match(report, /https:\/\/www\.w3\.org\/WAI\/WCAG22\/Understanding\/non-text-content\//);
    assert.match(report, /Screened Community Portal/);
    assert.match(report, /Windows 11/);
    assert.match(report, /Node\.js 22/);
    assert.match(report, /PDF\.js 4\.2/);
    assert.match(report, /WCAG\/JIS\/EN comparison/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("run-backed public model withholds non-public network hosts in target refs and free text", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-run-backed-public-host-boundary-"));
  try {
    const fixture = reportRunFixture(temp);
    const resources = loadAuditResources(skill);
    const safeW3cUrl = "https://www.w3.org/WAI/WCAG22/Understanding/non-text-content/";
    const safeExampleUrl = "https://example.com/accessibility/";
    const safeHttpExampleUrl = "http://example.com/accessibility/";
    const unsafeUrls = [
      "http://127.0.0.1:4173/private/",
      "http://localhost:3000/",
      "https://portal.corp.local/audit/",
      "http://intranet/private/",
      "http://192.168.1.12/audit/",
      "http://10.20.30.40/audit/",
      "http://172.16.5.4/audit/",
      "http://169.254.169.254/latest/",
      "https://portal.corp.lan/audit/",
      "https://audit-worker-01.internal/audit/",
      "https://service.localhost/audit/",
      "https://audit.company.corp/private/",
      "https://router.home.arpa/admin/",
      "https://example.invalid/private/",
      "https://service.test/private/",
      "https://internal.example/private/",
      "http://auditbox.localdomain/",
      "http://[::1]/private/",
      "http://[fc00::1]/private/",
      "http://[fd12:3456::1]/private/",
      "http://[fe80::1]/private/",
      "http://[::ffff:127.0.0.1]/private/"
    ];
    const renderCase = ({ targetRefs = [safeW3cUrl], observation = "The screened page needs review.", os = ["Windows 11"], browsers = ["Chrome 126"] } = {}) => {
      fixture.run.target.urls_or_files = targetRefs;
      fixture.run.environment = {
        os,
        browsers,
        assistive_technologies: ["NVDA 2025"],
        input_modes: ["Keyboard"]
      };
      fixture.assessment.assessment.target = structuredClone(fixture.run.target);
      fixture.assessment.assessment.environment = structuredClone(fixture.run.environment);
      const envelopesById = new Map([...fixture.artifactFiles].map(([artifactId, file]) => [artifactId, readJson(file)]));
      envelopesById.get("ART-SCREEN-REPORT").payload.observations[0].observation = observation;
      return renderRunBackedReport(buildPublicReportModel({
        run: fixture.run,
        assessment: fixture.assessment,
        envelopesById,
        resources
      }));
    };

    for (const relativeFile of [
      "reports/acme-audit.md",
      "evidence/screenshots/checkout.png",
      "notes/findings.md",
      "ClientApp/Report.md",
      "feature/acme-private",
      "bin/audit",
      "config/app.properties",
      "config/.dockerignore",
      "Node.js/PDF.js/",
      "Node.js/PDF.js\\"
    ]) {
      const report = renderCase({ observation: `The internal file was ${relativeFile}` });
      assert.equal(report.includes(relativeFile), false, `relative file was published: ${relativeFile}`);
    }

    for (const branchText of [
      "Tested feature/acme-private branch.",
      "Checked release/client-alpha branch.",
      "Tested the main branch.",
      "Validated develop branch.",
      "Checked branch feature/acme-private.",
      "Validated branch: main.",
      "Validated branch acme-private.",
      "Validated acme-private branch.",
      "Checked git branch clientalpha.",
      "The branch is open. Validated branch acme-private.",
      "The bank branch is open. Checked acme-private branch."
    ]) {
      const report = renderCase({ observation: branchText });
      assert.equal(report.includes(branchText), false, `branch token was published: ${branchText}`);
    }

    const safeReport = renderCase({
      targetRefs: [safeW3cUrl, safeExampleUrl, safeHttpExampleUrl],
      observation: `Compared (Node.js/PDF.js) behavior. Compared 'WCAG/JIS/EN' mappings. The outcomes were pass/fail/unknown and input/output/error. CSS button::before. Keep button::after. At 10:30:00 the ratio was 1:2. The branch is open. Several branch offices are open. The bank branch is open. The main branch office is open. The device is available. This device is compatible. The machine is learning. The host is a reviewer. The screened comparison uses ISO14289, SECTION508, and ${safeW3cUrl}`,
      browsers: ["Chrome 126", "Node.js 22", "PDF.js 4.2"]
    });
    for (const safeValue of [safeW3cUrl, safeExampleUrl, safeHttpExampleUrl, "Compared \\(Node.js/PDF.js\\) behavior.", "Compared 'WCAG/JIS/EN' mappings.", "pass/fail/unknown", "input/output/error", "CSS button::before.", "button::after", "10:30:00", "1:2", "The branch is open.", "Several branch offices are open.", "The bank branch is open.", "The main branch office is open.", "The device is available.", "This device is compatible.", "The machine is learning.", "The host is a reviewer.", "ISO14289", "SECTION508", "Node.js 22", "PDF.js 4.2", "screened"]) {
      assert.match(safeReport, new RegExp(safeValue.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"));
    }

    for (const unsafeUrl of unsafeUrls) {
      const host = new URL(unsafeUrl).hostname.replace(/^\[|\]$/gu, "");
      const targetReport = renderCase({ targetRefs: [safeW3cUrl, unsafeUrl] });
      assert.equal(targetReport.includes(host), false, `non-public target host was published: ${host}`);
      const freeTextReport = renderCase({ observation: `The screened endpoint was ${unsafeUrl}` });
      assert.equal(freeTextReport.includes(host), false, `non-public free-text host was published: ${host}`);
    }

    const nestedUnsafeUrl = "https://example.com/http://localhost:3000/private/";
    const nestedTargetReport = renderCase({ targetRefs: [safeW3cUrl, nestedUnsafeUrl] });
    assert.equal(nestedTargetReport.includes("localhost"), false, "nested non-public target host was published");
    const nestedFreeTextReport = renderCase({ observation: `The screened endpoint was ${nestedUnsafeUrl}` });
    assert.equal(nestedFreeTextReport.includes("localhost"), false, "nested non-public free-text host was published");

    for (const privateHostText of [
      "audit-worker-01.corp.internal",
      "audit-worker-01.internal",
      "localhost",
      "127.0.0.1",
      "fd12:3456::1",
      "fe80::1",
      "::1"
    ]) {
      const report = renderCase({ observation: `The screened worker was ${privateHostText}` });
      assert.equal(report.includes(privateHostText), false, `non-public host text was published: ${privateHostText}`);
    }

    for (const [context, hostname] of [
      ["Windows 11 on acme123", "acme123"],
      ["macOS on buildhost", "buildhost"],
      ["hostname is audit-worker-01", "audit-worker-01"],
      ["host: audit-worker-02", "audit-worker-02"],
      ["The host is audit-worker-01.", "audit-worker-01"],
      ["device is printer01", "printer01"],
      ["machine is acme123", "acme123"]
    ]) {
      const machineReport = renderCase({ os: [context] });
      assert.equal(machineReport.includes(hostname), false, `context hostname was published: ${hostname}`);
      assert.match(machineReport, /Withheld from public report/);
    }

  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("run-backed target versions allow immutable release tokens and withhold branch names", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-run-backed-public-version-redaction-"));
  try {
    const fixture = reportRunFixture(temp);
    const resources = loadAuditResources(skill);
    const renderVersion = (version) => {
      fixture.run.target.version_or_commit = version;
      fixture.assessment.assessment.target.version_or_commit = version;
      return renderRunBackedReport(buildPublicReportModel({
        run: fixture.run,
        assessment: fixture.assessment,
        envelopesById: new Map([...fixture.artifactFiles].map(([artifactId, file]) => [artifactId, readJson(file)])),
        resources
      }));
    };

    for (const branch of ["main", "master", "develop", "dev", "trunk", "HEAD", "feature/private-client"]) {
      const report = renderVersion(branch);
      const versionLine = report.split(/\r?\n/u).find((line) => line.startsWith("- 版・コミット:"));
      assert.equal(versionLine, "- 版・コミット: Withheld from public report", `branch-like version was published: ${branch}`);
    }
    for (const immutableVersion of ["1.2.3", "v2.4.0", "2026-07-18", "release-2026.07", "a1b2c3d4e5f6"]) {
      const report = renderVersion(immutableVersion);
      const versionLine = report.split(/\r?\n/u).find((line) => line.startsWith("- 版・コミット:"));
      assert.equal(versionLine, `- 版・コミット: ${immutableVersion}`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("run-backed report uses inspection judgements without a second formal-claim disclaimer", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-run-backed-claim-wording-"));
  try {
    const fixture = reportRunFixture(temp);
    const envelopesById = new Map([...fixture.artifactFiles].map(([artifactId, file]) => [artifactId, readJson(file)]));
    const report = renderRunBackedReport(buildPublicReportModel({
      run: fixture.run,
      assessment: fixture.assessment,
      envelopesById,
      resources: loadAuditResources(skill)
    }));

    assert.match(report, /\| WCAG-2\.2-SC-1\.3\.1 \| 適合 \|/);
    assert.doesNotMatch(report, /Claim Statement|does not declare conformance|Confirmed conformance points/i);
    assert.equal((report.match(new RegExp(formalNotice, "gu")) ?? []).length, 1);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("run-backed renderer turns every newline sequence in target text into a safe line break", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-run-backed-carriage-return-"));
  try {
    const forgedTarget = "Safe\r---\rForged";
    const fixture = reportRunFixture(temp, { targetName: forgedTarget });
    const renderer = path.join(skill, "scripts/render-audit-report.mjs");
    const output = path.join(temp, "carriage-return.md");

    const result = spawnSync(process.execPath, [
      renderer,
      "--run", fixture.runFile,
      "--assessment", fixture.assessmentFile,
      "--output", output
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = fs.readFileSync(output, "utf8");
    assert.match(report, /Safe<br>---<br>Forged/);
    assert.equal(report.includes("\r"), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("public report keeps each remediation paired with its matching finding when one requirement has several remediations", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-run-backed-multiple-remediations-"));
  try {
    const fixture = reportRunFixture(temp);
    const remediationFile = fixture.artifactFiles.get("ART-REMEDIATION-REPORT");
    const remediationEnvelope = JSON.parse(fs.readFileSync(remediationFile, "utf8"));
    const second = structuredClone(remediationEnvelope.payload.items[0]);
    second.remediation_id = "REM-REPORT03";
    second.proposed_change = "Use an equivalent text alternative in the adjacent label.";
    second.residual_limitation = "The alternative solution requires a separate human retest.";
    remediationEnvelope.payload.items.push(second);
    const assessment = structuredClone(fixture.assessment);
    assessment.assessment.findings.push({
      id: second.remediation_id,
      priority: second.priority,
      requirement_ids: [second.requirement_id],
      location: second.location,
      affected_users: second.affected_users,
      observation: second.issue,
      remediation: second.proposed_change,
      verification: second.verification
    });
    const envelopesById = new Map([...fixture.artifactFiles].map(([artifactId, file]) => [
      artifactId,
      artifactId === remediationEnvelope.artifact_id ? remediationEnvelope : JSON.parse(fs.readFileSync(file, "utf8"))
    ]));

    const model = buildPublicReportModel({ run: fixture.run, assessment, envelopesById });
    const paired = model.verifiedFailures.filter((item) => item.requirement_id === second.requirement_id);

    assert.equal(paired.length, 2);
    assert.deepEqual(paired.map((item) => [item.finding.remediation, item.remediation.proposed_change]), [
      ["Provide a text alternative that communicates the same purpose.", "Provide a text alternative that communicates the same purpose."],
      ["Use an equivalent text alternative in the adjacent label.", "Use an equivalent text alternative in the adjacent label."]
    ]);
    const report = renderRunBackedReport(model);
    assert.match(report, /Provide a text alternative that communicates the same purpose\./);
    assert.match(report, /Use an equivalent text alternative in the adjacent label\./);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("validator requires structured findings for failed results and meaningful affected users", () => {
  const missingFinding = reviewedRecord();
  missingFinding.assessment.findings = [];
  const missingFindingResult = validate(missingFinding);
  assert.equal(missingFindingResult.valid, false);
  assert.ok(missingFindingResult.errors.some((error) => error.includes("A finding must reference failed requirement")));

  const missingUsers = reviewedRecord();
  missingUsers.assessment.findings[0].affected_users = [];
  const missingUsersResult = validate(missingUsers);
  assert.equal(missingUsersResult.valid, false);
  assert.ok(missingUsersResult.errors.some((error) => error.includes("affected_users must name at least one")));

  const nonFailureLink = reviewedRecord();
  nonFailureLink.assessment.results.find((result) => result.requirement_id === "WCAG-2.2-SC-2.1.1").outcome = "pass";
  const nonFailureLinkResult = validate(nonFailureLink);
  assert.equal(nonFailureLinkResult.valid, false);
  assert.ok(nonFailureLinkResult.errors.some((error) => error.includes("must reference a failed result")));
});

test("renderer refuses invalid records and existing report files", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-audit-report-refusal-"));
  try {
    const renderer = path.join(skill, "scripts/render-audit-report.mjs");
    const output = path.join(temp, "report.md");
    fs.writeFileSync(output, "preserve", "utf8");
    const validInput = path.join(temp, "valid.json");
    fs.writeFileSync(validInput, JSON.stringify(reviewedRecord(), null, 2), "utf8");
    const existing = spawnSync(process.execPath, [renderer, "--input", validInput, "--output", output], { encoding: "utf8" });
    assert.notEqual(existing.status, 0);
    assert.match(existing.stderr || existing.stdout, /Refusing to overwrite existing file/);
    assert.equal(fs.readFileSync(output, "utf8"), "preserve");

    fs.rmSync(output);
    const invalid = reviewedRecord();
    invalid.assessment.findings = [];
    const invalidInput = path.join(temp, "invalid.json");
    fs.writeFileSync(invalidInput, JSON.stringify(invalid, null, 2), "utf8");
    const rejected = spawnSync(process.execPath, [renderer, "--input", invalidInput, "--output", output], { encoding: "utf8" });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr || rejected.stdout, /Assessment validation failed/);
    assert.equal(fs.existsSync(output), false);

    const legacy = reviewedRecord();
    delete legacy.assessment.findings;
    const legacyInput = path.join(temp, "legacy.json");
    fs.writeFileSync(legacyInput, JSON.stringify(legacy, null, 2), "utf8");
    const legacyRejected = spawnSync(process.execPath, [renderer, "--input", legacyInput], { encoding: "utf8" });
    assert.notEqual(legacyRejected.status, 0);
    assert.match(legacyRejected.stderr || legacyRejected.stdout, /findings is required when assessment contains failed results/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("renderer escapes record text so it cannot inject report structure or HTML", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-audit-report-escape-"));
  try {
    const input = path.join(temp, "assessment.json");
    const record = reviewedRecord();
    record.assessment.target.name = "Example <script>alert(1)</script>\n## Forged claim";
    record.assessment.scope.included = ["Checkout\n## Forged section"];
    record.assessment.findings[0].observation = "Observed <img src=x onerror=alert(1)>\n## Forged finding";
    fs.writeFileSync(input, JSON.stringify(record, null, 2), "utf8");
    const renderer = path.join(skill, "scripts/render-audit-report.mjs");
    const run = spawnSync(process.execPath, [renderer, "--input", input], { encoding: "utf8" });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /Example &lt;script&gt;alert\\\(1\\\)&lt;\/script&gt;<br>\\#\\# Forged claim/);
    assert.match(run.stdout, /Observed &lt;img src=x onerror=alert\\\(1\\\)&gt;<br>\\#\\# Forged finding/);
    assert.equal(run.stdout.includes("<script>"), false);
    assert.equal(run.stdout.includes("<img src=x"), false);
    assert.equal(run.stdout.includes("\n## Forged claim"), false);
    assert.equal(run.stdout.includes("\n## Forged finding"), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
