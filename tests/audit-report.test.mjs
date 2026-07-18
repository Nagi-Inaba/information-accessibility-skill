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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
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
    schema_version: "2.0.0",
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
    schema_version: "5.0.0",
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
    assert.match(report, /Human-reviewed requirements recorded as met/i);
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
    assert.match(report, /Audit date: 2026-07-17/i);
    assert.match(report, /Standards registry version: 1\.0\.0/i);
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
    fixture.assessment.assessment.claim.proposed_wording = commaPrivateSentence;

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
      const versionLine = report.split(/\r?\n/u).find((line) => line.startsWith("- Version or commit:"));
      assert.equal(versionLine, "- Version or commit: Withheld from public report", `branch-like version was published: ${branch}`);
    }
    for (const immutableVersion of ["1.2.3", "v2.4.0", "2026-07-18", "release-2026.07", "a1b2c3d4e5f6"]) {
      const report = renderVersion(immutableVersion);
      const versionLine = report.split(/\r?\n/u).find((line) => line.startsWith("- Version or commit:"));
      assert.equal(versionLine, `- Version or commit: ${immutableVersion}`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("run-backed category wording does not imply positive conformance", () => {
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

    assert.match(report, /Human-reviewed requirements recorded as met/);
    assert.doesNotMatch(report, /Confirmed conformance points/i);
    assert.doesNotMatch(report, /No confirmed conformance points/i);
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
