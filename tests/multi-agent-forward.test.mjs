import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { lookupRequirement } from "../codex/skills/information-accessibility-practice/scripts/show-requirement.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "codex/skills/information-accessibility-practice");
const scripts = path.join(skillRoot, "scripts");
const siteFixture = path.join(root, "tests/fixtures/multi-agent-site");
const payloadFixture = path.join(root, "tests/fixtures/multi-agent-run");
const targetUrl = "http://127.0.0.1:4173/community-open-day/";

const cli = {
  create: path.join(scripts, "create-audit-run.mjs"),
  register: path.join(scripts, "register-audit-artifact.mjs"),
  generate: path.join(scripts, "generate-assessment.mjs"),
  merge: path.join(scripts, "merge-audit-artifacts.mjs"),
  render: path.join(scripts, "render-audit-report.mjs"),
  fix: path.join(scripts, "apply-authorized-fix.mjs")
};

function runNode(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function dynamicRunId() {
  const timestamp = new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
  return `RUN-${timestamp}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function envelope({ artifactId, artifactType, runId, roleId, createdAt, inputs, payload }) {
  return {
    schema_version: "2.0.0",
    artifact_id: artifactId,
    artifact_type: artifactType,
    run_id: runId,
    producer: { role_id: roleId, producer_kind: "ai_agent", origin: "local fixture inspection" },
    created_at: createdAt,
    inputs,
    payload
  };
}

function assertSucceeded(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function section(report, heading, nextHeading) {
  const start = report.indexOf(heading);
  assert.notEqual(start, -1, `missing report heading: ${heading}`);
  const end = nextHeading ? report.indexOf(nextHeading, start + heading.length) : report.length;
  assert.notEqual(end, -1, `missing following report heading: ${nextHeading}`);
  return report.slice(start, end);
}

test("installed CLIs carry a local public-like fixture through the read-only agent boundary", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-multi-agent-forward-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const repoFixtureFiles = [
    path.join(siteFixture, "index.html"),
    path.join(siteFixture, "app.js"),
    path.join(payloadFixture, "screening-observations.json"),
    path.join(payloadFixture, "human-review-queue.json"),
    path.join(payloadFixture, "remediation-plan.json")
  ];
  const repoHashes = new Map(repoFixtureFiles.map((file) => [file, sha256File(file)]));
  assert.equal(repoHashes.size, 5);

  const targetRoot = path.join(temp, "public-site");
  fs.mkdirSync(targetRoot);
  for (const name of ["index.html", "app.js"]) fs.copyFileSync(path.join(siteFixture, name), path.join(targetRoot, name));
  const targetFiles = [path.join(targetRoot, "index.html"), path.join(targetRoot, "app.js")];
  const targetHashes = new Map(targetFiles.map((file) => [file, sha256File(file)]));

  const page = fs.readFileSync(path.join(targetRoot, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(targetRoot, "app.js"), "utf8");
  assert.match(page, /data-audit-token="WAYFINDING-MAP"/u);
  assert.match(page, /data-audit-token="SESSION-DETAILS-CONTROL"/u);
  assert.match(page, /data-audit-token="SUPPORT-PREFERENCES-GROUP"/u);
  assert.doesNotMatch(page, /<img[^>]+\balt=/u);
  assert.match(app, /addEventListener\("click"/u);
  assert.doesNotMatch(app, /addEventListener\("key/u);
  assert.doesNotMatch(`${page}\n${app}`, /nonconform|conformant|WCAG failure/iu);

  const artifactRoot = path.join(temp, "artifacts");
  fs.mkdirSync(artifactRoot);
  const runId = dynamicRunId();
  const runFiles = [0, 1, 2, 3].map((version) => path.join(temp, `audit-run.${version}.json`));
  const create = runNode(cli.create, [
    "--run-id", runId,
    "--profile", "web-modern",
    "--target-name", "Community open day fixture",
    "--target-version", "internal/example-branch",
    "--target-ref", targetUrl,
    "--artifact-root", artifactRoot,
    "--network", "local_read_only",
    "--interaction", "safe_read_only",
    "--source-write", "none",
    "--output", runFiles[0]
  ]);
  assertSucceeded(create);
  const run0 = readJson(runFiles[0]);
  assert.equal(run0.schema_version, "7.0.0");
  assert.equal(run0.permissions.network, "allowlisted");
  assert.equal(run0.permissions.interaction, "read_only");
  assert.equal(run0.permissions.source_write, "denied");
  assert.equal(run0.permissions.command_execution, "denied");
  const priorRunBytes = new Map([[runFiles[0], fs.readFileSync(runFiles[0])]]);

  const screeningPayload = readJson(path.join(payloadFixture, "screening-observations.json"));
  const queueTemplate = readJson(path.join(payloadFixture, "human-review-queue.json"));
  const remediationPayload = readJson(path.join(payloadFixture, "remediation-plan.json"));
  assert.equal(screeningPayload.observations.some((item) => item.signal_class === "no_automated_signal"), true);
  assert.ok(remediationPayload.items.every((item) => item.basis === "unverified_screening_candidate"));

  const screening = envelope({
    artifactId: "ART-SCREEN-PUBLIC-FIXTURE",
    artifactType: "screening-observations",
    runId,
    roleId: "e1_inspector",
    createdAt: "2026-07-18T01:00:04Z",
    inputs: [],
    payload: screeningPayload
  });
  const screeningFile = path.join(artifactRoot, "screening-observations.json");
  writeJson(screeningFile, screening);

  const queueItems = queueTemplate.requirement_ids.map((requirementId) => {
    const requirement = lookupRequirement("web-modern", requirementId, skillRoot);
    assert.ok(requirement.procedure_binding, `missing procedure binding for ${requirementId}`);
    return { requirement_id: requirementId, ...requirement.procedure_binding };
  });
  assert.deepEqual(
    new Set(queueItems.map((item) => item.requirement_id)),
    new Set(screeningPayload.observations.map((item) => item.profile_requirement_id)),
    "candidate, inconclusive, and no-signal observations must all be routed to human review"
  );
  const queue = envelope({
    artifactId: "ART-QUEUE-PUBLIC-FIXTURE",
    artifactType: "human-review-queue",
    runId,
    roleId: "human_queue_planner",
    createdAt: "2026-07-18T01:00:05Z",
    inputs: [{ artifact_id: screening.artifact_id, run_id: runId, sha256: sha256File(screeningFile) }],
    payload: {
      schema_version: queueTemplate.schema_version,
      items: queueItems,
      procedure_coverage: {
        total_requirements: queueItems.length,
        available_procedures: queueItems.filter((item) => item.procedure_availability === "available").length,
        unavailable_procedures: queueItems.filter((item) => item.procedure_availability === "unavailable").length
      }
    }
  });
  const queueFile = path.join(artifactRoot, "human-review-queue.json");
  writeJson(queueFile, queue);

  const remediation = envelope({
    artifactId: "ART-REMEDIATION-PUBLIC-FIXTURE",
    artifactType: "remediation-plan",
    runId,
    roleId: "remediation_planner",
    createdAt: "2026-07-18T01:00:06Z",
    inputs: [{ artifact_id: screening.artifact_id, run_id: runId, sha256: sha256File(screeningFile) }],
    payload: remediationPayload
  });
  const remediationFile = path.join(artifactRoot, "remediation-plan.json");
  writeJson(remediationFile, remediation);

  for (const [index, artifactFile] of [screeningFile, queueFile, remediationFile].entries()) {
    const registered = runNode(cli.register, [
      "--run", runFiles[index],
      "--artifact", artifactFile,
      "--output", runFiles[index + 1]
    ]);
    assertSucceeded(registered);
    priorRunBytes.set(runFiles[index + 1], fs.readFileSync(runFiles[index + 1]));
  }
  for (const [file, bytes] of priorRunBytes) assert.deepEqual(fs.readFileSync(file), bytes, `prior run changed: ${file}`);

  const finalRun = readJson(runFiles[3]);
  assert.equal(finalRun.status, "remediation_ready");
  assert.deepEqual(finalRun.artifacts.map((item) => item.producer_role).sort(), ["e1_inspector", "human_queue_planner", "remediation_planner"]);
  for (const [artifactFile, artifact] of [[screeningFile, screening], [queueFile, queue], [remediationFile, remediation]]) {
    const entry = finalRun.artifacts.find((item) => item.artifact_id === artifact.artifact_id);
    assert.equal(entry.sha256, sha256File(artifactFile));
  }
  assert.deepEqual(finalRun.history.map((item) => item.actor_role), ["e1_inspector", "human_queue_planner", "remediation_planner"]);

  const assessmentFile = path.join(temp, "assessment-e0.json");
  const generated = runNode(cli.generate, [
    "--profile", "web-modern",
    "--target-name", finalRun.target.name,
    "--target-version", finalRun.target.version_or_commit,
    "--target-ref", targetUrl,
    "--evaluator", "Local screening workflow",
    "--evaluated-at", "2026-07-18",
    "--output", assessmentFile
  ]);
  assertSucceeded(generated);
  const assessment = readJson(assessmentFile);
  assert.equal(assessment.assessment.evidence_level, "E0");
  assessment.assessment.scope = structuredClone(finalRun.scope);
  assessment.assessment.environment = structuredClone(finalRun.environment);
  writeJson(assessmentFile, assessment);

  const mergedFile = path.join(temp, "assessment-merged.json");
  const mergedResult = runNode(cli.merge, [
    "--run", runFiles[3],
    "--assessment", assessmentFile,
    "--artifact", screeningFile,
    "--artifact", queueFile,
    "--artifact", remediationFile,
    "--output", mergedFile
  ]);
  assertSucceeded(mergedResult);
  const merged = readJson(mergedFile);
  const profileRows = merged.assessment.results.filter((item) => item.requirement_kind === "profile_requirement");
  const screeningRows = merged.assessment.results.filter((item) => item.requirement_kind === "screening_check");
  assert.equal(profileRows.length, 55);
  assert.equal(screeningRows.length, 3);
  assert.ok(profileRows.every((item) => item.mapping_status === "unverified" && item.outcome === "not_tested"));
  assert.ok(screeningRows.every((item) => item.mapping_status === "unverified" && item.outcome === "cant_tell"));
  assert.equal(merged.assessment.evidence_level, "E1");
  assert.equal(JSON.stringify(merged).includes("E2"), false);
  assert.equal(JSON.stringify(merged).includes("human_verified"), false);
  assert.equal(merged.assessment.results.some((item) => ["pass", "fail", "not_applicable"].includes(item.outcome)), false);

  const reportFile = path.join(temp, "public-report.md");
  const rendered = runNode(cli.render, ["--run", runFiles[3], "--assessment", mergedFile, "--output", reportFile]);
  assertSucceeded(rendered);
  const report = fs.readFileSync(reportFile, "utf8");
  const judgements = section(report, "## 3. 達成基準別の判定", "## 4. 改善事項");
  const improvement = section(report, "## 4. 改善事項", "## 5. 今後の確認事項");
  const pending = section(report, "## 5. 今後の確認事項", "## 6. 対象範囲と検査環境");
  for (const token of ["WAYFINDING-MAP", "SESSION-DETAILS-CONTROL", "SUPPORT-PREFERENCES-GROUP"]) {
    assert.doesNotMatch(judgements, new RegExp(token, "u"));
    assert.match(improvement, new RegExp(token, "u"));
    assert.match(pending, new RegExp(token, "u"));
  }
  assert.match(report, /- 総合判定: 要確認/u);
  assert.match(report, /- 適合: 0/u);
  assert.match(report, /- 不適合: 0/u);
  assert.match(report, /- 要確認: 3/u);
  assert.match(report, /- 未確認: 52/u);
  assert.match(report, /登録済み達成基準: 55\/55/u);
  assert.match(report, /人による確認済み達成基準: 0\/55/u);
  for (const internal of [
    runId,
    ...finalRun.artifacts.flatMap((item) => [item.artifact_id, item.producer_role]),
    ...finalRun.history.map((item) => item.actor_role),
    "codex/",
    "claude/",
    "internal/example-branch",
    "git branch",
    targetUrl,
    "127.0.0.1",
    "localhost"
  ]) {
    assert.equal(report.includes(internal), false, `public report leaked internal value: ${internal}`);
  }

  const registeredArtifactBytes = new Map([screeningFile, queueFile, remediationFile]
    .map((file) => [file, fs.readFileSync(file)]));
  const replacementFile = path.join(temp, "replacement-index.html");
  fs.copyFileSync(path.join(targetRoot, "index.html"), replacementFile);
  const missingAuthorization = path.join(artifactRoot, "missing-fix-authorization.json");
  const changeOutput = path.join(artifactRoot, "unauthorized-change.json");
  const unauthorized = runNode(cli.fix, [
    "--authorization", missingAuthorization,
    "--run", runFiles[3],
    "--source-root", targetRoot,
    "--operation", "modify",
    "--target", "index.html",
    "--description", "Unauthorized fixture change must be refused",
    "--command-id", "VERIFY-UNAUTHORIZED",
    "--lock-dir", path.join(temp, "fix-locks"),
    "--output", changeOutput,
    "--content-file", replacementFile,
    "--expected-before-sha256", targetHashes.get(path.join(targetRoot, "index.html"))
  ]);
  assert.notEqual(unauthorized.status, 0);
  assert.match(unauthorized.stderr || unauthorized.stdout, /missing-fix-authorization\.json/iu);
  assert.match(unauthorized.stderr || unauthorized.stdout, /missing fix authorization|does not exist|not found|ENOENT|cannot find/iu);
  assert.equal(fs.existsSync(changeOutput), false);
  assert.equal(fs.existsSync(path.join(artifactRoot, "unauthorized-change.diff.json")), false);
  assert.equal(fs.existsSync(path.join(artifactRoot, ".fix-consumption")), false);

  for (const [file, bytes] of priorRunBytes) assert.deepEqual(fs.readFileSync(file), bytes, `run changed after refusal: ${file}`);
  for (const [file, bytes] of registeredArtifactBytes) assert.deepEqual(fs.readFileSync(file), bytes, `artifact changed after refusal: ${file}`);
  for (const [file, hash] of repoHashes) assert.equal(sha256File(file), hash, `repo fixture changed: ${file}`);
  for (const [file, hash] of targetHashes) assert.equal(sha256File(file), hash, `copied target changed: ${file}`);
});
