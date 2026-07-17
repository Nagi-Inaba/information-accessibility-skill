import assert from "node:assert/strict";
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
  validateAuditRun
} from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { lookupRequirement } from "../codex/skills/information-accessibility-practice/scripts/show-requirement.mjs";
import { validateAssessment } from "../codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs";
import {
  buildPublicReportModel,
  renderRunBackedReport
} from "../codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "codex/skills/information-accessibility-practice");
const registry = JSON.parse(fs.readFileSync(path.join(skill, "references/standards-registry.json"), "utf8"));
const schema = JSON.parse(fs.readFileSync(path.join(skill, "references/assessment-record.schema.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(skill, "references/criteria-catalog.json"), "utf8"));
const methods = JSON.parse(fs.readFileSync(path.join(skill, "references/web-audit-methods.json"), "utf8"));

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
  return record;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function reportRunFixture(temp) {
  const artifactRoot = path.join(temp, "artifacts");
  fs.mkdirSync(artifactRoot);
  const resources = loadAuditResources(skill);
  const runId = "RUN-20260717T120000Z-REPORT01";
  const target = { name: "Public fixture", version_or_commit: "fixture-v1", urls_or_files: ["https://example.invalid/checkout"] };
  const scope = { included: ["Checkout"], excluded: [], complete_processes: [], third_party_content: [], full_pages_reviewed: false };
  const environment = { os: ["not_declared"], browsers: [], assistive_technologies: [], input_modes: [] };
  const created = [
    "2026-07-17T12:00:01Z",
    "2026-07-17T12:00:02Z",
    "2026-07-17T12:00:03Z",
    "2026-07-17T12:00:04Z"
  ];
  const envelope = (artifactId, artifactType, roleId, inputs, payload, createdAt, producerKind = "ai_agent") => ({
    schema_version: "1.0.0",
    artifact_id: artifactId,
    artifact_type: artifactType,
    run_id: runId,
    producer: { role_id: roleId, producer_kind: producerKind, origin: "report fixture" },
    created_at: createdAt,
    inputs,
    payload
  });
  const screen = envelope("ART-SCREEN-REPORT", "screening-observations", "e1_inspector", [], {
    schema_version: "1.0.0",
    observations: [{
      requirement_id: "SCREEN-FIRST",
      evidence_level: "E1",
      method: "Static DOM inspection",
      location: "Checkout heading",
      observation: "The heading structure may skip a level.",
      captured_at: created[0]
    }]
  }, created[0]);
  const screenFile = path.join(artifactRoot, "screen.json");
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
    schema_version: "1.0.0",
    declaration: "I declare that I performed the recorded review as an external human reviewer.",
    reviewer_name: "External Reviewer",
    review_date: "2026-07-17",
    identity_authenticated: false,
    reviews: [review("WCAG-2.2-SC-1.1.1", "fail"), review("WCAG-2.2-SC-1.3.1", "pass")]
  }, created[2], "external_human");
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
    schema_version: "2.0.0",
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
  const artifacts = [screen, queue, human, remediation];
  const run = {
    schema_version: "4.0.0",
    run_id: runId,
    supersedes_run_id: null,
    status: "remediation_ready",
    target,
    profile: { id: "web-modern", registry_version: "1.0.0" },
    scope,
    environment,
    permissions: {
      network: "allowlisted",
      interaction: "read_only",
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
  const assessment = mergeArtifacts({ run, assessment: baseline, artifacts, registries: resources });
  const assessmentFile = path.join(temp, "assessment.json");
  writeJson(assessmentFile, assessment);
  return { run, runFile, assessment, assessmentFile, artifactFiles };
}

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
    assert.match(run.stdout, /^# Accessibility Audit Report/m);
    assert.match(run.stdout, /Example service/);
    assert.match(run.stdout, /P1 findings: 1/);
    assert.match(run.stdout, /F-001/);
    assert.match(run.stdout, /WCAG-2\.2-SC-2\.1\.1/);
    assert.match(run.stdout, /The selector cannot receive keyboard focus\./);
    assert.match(run.stdout, /Selected requirements were manually reviewed; the full requirement set was not reviewed\./);
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
    assert.match(report, /Confirmed conformance points/i);
    assert.match(report, /WCAG-2\.2-SC-1\.3\.1/);
    assert.match(report, /Verified failures/i);
    assert.match(report, /WCAG-2\.2-SC-1\.1\.1/);
    assert.match(report, /Frontend team/);
    assert.match(report, /Not assigned/);
    assert.match(report, /Pending human checks/i);
    assert.match(report, /WCAG-2\.2-SC-2\.1\.1/);
    assert.match(report, /Unverified screening candidates/i);
    assert.match(report, /SCREEN-FIRST/);
    assert.match(report, /A human reviewer has not yet confirmed this observation\./);
    assert.match(report, /Evidence and claim limits/i);
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
    assert.match(mismatch.stderr || mismatch.stdout, /target does not match the audit run/);
    assert.equal(fs.existsSync(mismatchOutput), false);

    const foreignAssessment = structuredClone(fixture.assessment);
    const foreignRow = foreignAssessment.assessment.results.find((result) => result.requirement_id === "WCAG-2.2-SC-1.3.1");
    foreignRow.method = "A different but otherwise valid manual review.";
    foreignRow.notes = "A different but otherwise valid manual review.";
    const foreignValidation = validate(foreignAssessment);
    assert.equal(foreignValidation.valid, true, foreignValidation.errors.join("\n"));
    const foreignFile = path.join(temp, "foreign.json");
    writeJson(foreignFile, foreignAssessment);
    const foreignOutput = path.join(temp, "foreign.md");
    const foreign = invoke(foreignFile, foreignOutput);
    assert.notEqual(foreign.status, 0);
    assert.match(foreign.stderr || foreign.stdout, /does not match the current run evidence/);
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

test("run-backed renderer rejects bare registry and mapping identifiers embedded in registered remediation text", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-run-backed-bare-internal-metadata-"));
  try {
    const fixture = reportRunFixture(temp);
    const renderer = path.join(skill, "scripts/render-audit-report.mjs");
    const remediationFile = fixture.artifactFiles.get("ART-REMEDIATION-REPORT");
    const remediation = JSON.parse(fs.readFileSync(remediationFile, "utf8"));
    remediation.payload.items[0].residual_limitation = "The item was screened by orchestrator after initialized input remained unverified.";
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
    const assessment = mergeArtifacts({ run: fixture.run, assessment: baseline, artifacts, registries: resources });
    writeJson(fixture.assessmentFile, assessment);

    const output = path.join(temp, "bare-internal-metadata.md");
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

test("run-backed renderer turns every newline sequence in target text into a safe line break", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-run-backed-carriage-return-"));
  try {
    const fixture = reportRunFixture(temp);
    const renderer = path.join(skill, "scripts/render-audit-report.mjs");
    const forgedTarget = "Safe\r---\rForged";
    fixture.run.target.name = forgedTarget;
    fixture.assessment.assessment.target.name = forgedTarget;
    writeJson(fixture.runFile, fixture.run);
    writeJson(fixture.assessmentFile, fixture.assessment);
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
    assert.match(legacyRejected.stderr || legacyRejected.stdout, /failed results without structured findings/);
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
