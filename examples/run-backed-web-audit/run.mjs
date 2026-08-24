#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { lookupRequirement } from "../../codex/skills/information-accessibility-practice/scripts/show-requirement.mjs";

const exampleRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(exampleRoot, "../..");
const skillRoot = path.join(repositoryRoot, "codex/skills/information-accessibility-practice");
const cli = path.join(skillRoot, "scripts/accessibility-audit.mjs");
const profileRequirement = "WCAG-2.2-SC-1.1.1";
const screeningRequirement = "SCREEN-IMAGE-ALT";

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--output" || !argv[1] || argv[1].startsWith("--")) {
    throw new Error("Usage: node examples/run-backed-web-audit/run.mjs --output <empty-directory>");
  }
  return { output: path.resolve(argv[1]) };
}

function runCli(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `CLI failed: ${args[0]}`);
  return result.stdout;
}

function ensureEmptyDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.readdirSync(directory).length > 0) throw new Error(`Output directory must be empty: ${directory}`);
}

function writeJsonNew(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function rewriteJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "w", mode: 0o600 });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function inputRef(artifact, file) {
  return { artifact_id: artifact.artifact_id, run_id: artifact.run_id, sha256: sha256File(file) };
}

function envelope({ artifactId, artifactType, runId, roleId, producerKind, createdAt, inputs, payload }) {
  return {
    schema_version: "2.0.0",
    artifact_id: artifactId,
    artifact_type: artifactType,
    run_id: runId,
    producer: {
      role_id: roleId,
      producer_kind: producerKind,
      origin: "documented public example fixture"
    },
    created_at: createdAt,
    inputs,
    payload
  };
}

function screeningArtifact(runId, suffix) {
  const capturedAt = `2026-08-23T12:00:0${suffix}Z`;
  return envelope({
    artifactId: `ART-SCREEN-EXAMPLE${suffix}`,
    artifactType: "screening-observations",
    runId,
    roleId: "e1_inspector",
    producerKind: "ai_agent",
    createdAt: capturedAt,
    inputs: [],
    payload: {
      schema_version: "2.0.0",
      observations: [{
        requirement_id: screeningRequirement,
        evidence_level: "E1",
        method: "Read-only rendered fixture inspection",
        location: "Example page, informative image",
        observation: "The fixture image has no programmatically determinable text alternative.",
        captured_at: capturedAt,
        profile_requirement_id: profileRequirement,
        report_outcome: "fail",
        applicability: "applicable",
        report_rationale: "This is a report-only screening judgement. External human review is required before recording a profile outcome."
      }]
    }
  });
}

function queueArtifact(runId, suffix, screening, screeningFile) {
  const binding = lookupRequirement("web-modern", profileRequirement, skillRoot).procedure_binding;
  return envelope({
    artifactId: `ART-QUEUE-EXAMPLE${suffix}`,
    artifactType: "human-review-queue",
    runId,
    roleId: "human_queue_planner",
    producerKind: "ai_agent",
    createdAt: `2026-08-23T12:00:1${suffix}Z`,
    inputs: [inputRef(screening, screeningFile)],
    payload: {
      schema_version: "2.0.0",
      items: [{ requirement_id: profileRequirement, ...binding }],
      procedure_coverage: {
        total_requirements: 1,
        available_procedures: binding.procedure_availability === "available" ? 1 : 0,
        unavailable_procedures: binding.procedure_availability === "unavailable" ? 1 : 0
      }
    }
  });
}

function humanArtifact(runId, suffix, queue, queueFile) {
  const binding = lookupRequirement("web-modern", profileRequirement, skillRoot).procedure_binding;
  return envelope({
    artifactId: `ART-HUMAN-EXAMPLE${suffix}`,
    artifactType: "declared-human-review",
    runId,
    roleId: "declared_external_human",
    producerKind: "external_human",
    createdAt: `2026-08-23T12:00:2${suffix}Z`,
    inputs: [inputRef(queue, queueFile)],
    payload: {
      schema_version: "1.0.0",
      declaration: "I declare that I performed the recorded review as an external human reviewer.",
      reviewer_name: "Example External Reviewer",
      review_date: "2026-08-23",
      identity_authenticated: false,
      reviews: [{
        requirement_id: profileRequirement,
        procedure_availability: binding.procedure_availability,
        criterion_procedure_ref: binding.procedure_ref,
        generic_method_ref: binding.generic_method_ref,
        official_sources: binding.official_sources,
        target_specific_evidence: [{
          type: "browser_inspection",
          location: "Example page, informative image",
          observation: "The rendered element and computed accessible name were inspected in the declared fixture.",
          captured_at: `2026-08-23T12:00:2${suffix}Z`
        }, {
          type: "manual_observation",
          location: "Example page, informative image",
          observation: "The visible purpose was compared with the available text alternative and no equivalent alternative was present.",
          captured_at: `2026-08-23T12:00:2${suffix}Z`
        }],
        profile_outcome: "fail",
        rationale: "The target-specific manual and browser evidence supports a failed outcome for this fixture."
      }]
    }
  });
}

function remediationArtifact(runId, suffix, source, sourceFile, humanReviewed) {
  return envelope({
    artifactId: `ART-REMEDIATION-EXAMPLE${suffix}`,
    artifactType: "remediation-plan",
    runId,
    roleId: "remediation_planner",
    producerKind: "ai_agent",
    createdAt: `2026-08-23T12:00:3${suffix}Z`,
    inputs: [inputRef(source, sourceFile)],
    payload: {
      schema_version: "2.0.0",
      items: [{
        remediation_id: `REM-EXAMP00${suffix}`,
        basis: humanReviewed ? "verified_failure" : "unverified_screening_candidate",
        requirement_id: humanReviewed ? profileRequirement : screeningRequirement,
        source_artifact_ids: [source.artifact_id],
        priority: humanReviewed ? "P0" : "P1",
        location: "Example page, informative image",
        affected_users: ["Screen reader users"],
        issue: humanReviewed
          ? "External review verified that the informative image lacks an equivalent text alternative."
          : "Read-only screening found a likely missing text alternative that remains unverified.",
        proposed_change: "Provide a concise text alternative that communicates the image purpose in context.",
        verification: "Repeat the registered browser inspection and manual comparison against the same fixture state.",
        owner: "Example frontend team",
        residual_limitation: humanReviewed
          ? "Reviewer identity is declared but not authenticated."
          : "The candidate remains unverified until an external human performs the queued procedure."
      }]
    }
  });
}

function copyExclusive(source, destination) {
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}

function bindAssessmentToRun(assessmentFile, runFile) {
  const run = readJson(runFile);
  const assessment = readJson(assessmentFile);
  assessment.assessment.scope = structuredClone(run.scope);
  assessment.assessment.environment = structuredClone(run.environment);
  rewriteJson(assessmentFile, assessment);
}

function buildScenario(base, { name, runId, suffix, humanReviewed }) {
  const scenario = path.join(base, name);
  const artifactRoot = path.join(scenario, "artifacts");
  fs.mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });

  const initialRun = path.join(scenario, "audit-run.v0.json");
  const baseline = path.join(scenario, "baseline-assessment.json");
  runCli([
    "init",
    "--run-id", runId,
    "--profile", "web-modern",
    "--target-name", "Public run-backed accessibility example",
    "--target-version", "fixture-v1",
    "--target-ref", "https://example.com/",
    "--artifact-root", artifactRoot,
    "--network", "none",
    "--interaction", "safe_read_only",
    "--source-write", "none",
    "--output", initialRun
  ]);
  runCli([
    "assessment",
    "--profile", "web-modern",
    "--target-name", "Public run-backed accessibility example",
    "--target-version", "fixture-v1",
    "--target-ref", "https://example.com/",
    "--evaluator", "Audit orchestrator",
    "--evaluated-at", "2026-08-23",
    "--output", baseline
  ]);
  bindAssessmentToRun(baseline, initialRun);

  const artifacts = [];
  const screening = screeningArtifact(runId, suffix);
  const screeningFile = path.join(artifactRoot, "screening-observations.json");
  writeJsonNew(screeningFile, screening);
  artifacts.push({ value: screening, file: screeningFile });

  const queue = queueArtifact(runId, suffix, screening, screeningFile);
  const queueFile = path.join(artifactRoot, "human-review-queue.json");
  writeJsonNew(queueFile, queue);
  artifacts.push({ value: queue, file: queueFile });

  let human;
  let humanFile;
  if (humanReviewed) {
    human = humanArtifact(runId, suffix, queue, queueFile);
    humanFile = path.join(artifactRoot, "declared-human-review.json");
    writeJsonNew(humanFile, human);
    artifacts.push({ value: human, file: humanFile });
  }

  const remediationSource = humanReviewed ? human : screening;
  const remediationSourceFile = humanReviewed ? humanFile : screeningFile;
  const remediation = remediationArtifact(runId, suffix, remediationSource, remediationSourceFile, humanReviewed);
  const remediationFile = path.join(artifactRoot, "remediation-plan.json");
  writeJsonNew(remediationFile, remediation);
  artifacts.push({ value: remediation, file: remediationFile });

  let currentRun = initialRun;
  artifacts.forEach((artifact, index) => {
    const nextRun = path.join(scenario, `audit-run.v${index + 1}.json`);
    runCli([
      "register",
      "--run", currentRun,
      "--artifact", artifact.file,
      "--output", nextRun
    ]);
    currentRun = nextRun;
  });

  const finalRun = path.join(scenario, "audit-run.json");
  copyExclusive(currentRun, finalRun);
  const merged = path.join(scenario, "merged-assessment.json");
  const mergeArgs = ["merge", "--run", finalRun, "--assessment", baseline];
  for (const artifact of artifacts) mergeArgs.push("--artifact", artifact.file);
  mergeArgs.push("--output", merged);
  runCli(mergeArgs);

  const report = path.join(scenario, "audit-report.md");
  runCli(["report", "--run", finalRun, "--assessment", merged, "--output", report]);

  for (const artifact of artifacts) copyExclusive(artifact.file, path.join(scenario, path.basename(artifact.file)));
  return { scenario, finalRun, baseline, merged, report, artifact_count: artifacts.length };
}

export function main(argv = process.argv.slice(2)) {
  const { output } = parseArgs(argv);
  ensureEmptyDirectory(output);
  const screeningOnly = buildScenario(output, {
    name: "screening-only",
    runId: "RUN-20260823T120000Z-EXAM0001",
    suffix: "1",
    humanReviewed: false
  });
  const humanReviewed = buildScenario(output, {
    name: "human-reviewed",
    runId: "RUN-20260823T120000Z-EXAM0002",
    suffix: "2",
    humanReviewed: true
  });
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    output,
    scenarios: [screeningOnly, humanReviewed]
  })}\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
