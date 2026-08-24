import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs");
const runBackedExample = path.join(root, "examples/run-backed-web-audit/run.mjs");

function runNode(script, args, cwd = root) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
}

function runCli(args, cwd = root) {
  return runNode(cli, args, cwd);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function hash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-report-policy-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function criterionRows(markdown) {
  return markdown.split(/\r?\n/u).filter((line) => /^\| \d+(?:\.\d+){2} \|/u.test(line));
}

function standaloneFixture(directory, { sensitive = false } = {}) {
  const record = generateAssessment("web-modern", {
    targetName: sensitive ? "Private dashboard for alice@example.com" : "Public report fixture",
    targetVersion: "2026-08-24",
    targetRefs: sensitive
      ? [
        "https://example.com/report?token=PUBLIC-QUERY-SECRET#private-state",
        "https://admin:password@intranet.local/dashboard?session=RUN-SECRET",
        "C:\\Users\\Alice\\audit\\report.html"
      ]
      : ["https://example.com/"],
    evaluator: sensitive ? "Alice Reviewer <alice@example.com>" : "Report fixture",
    evaluatedAt: "2026-08-24"
  });
  if (sensitive) {
    record.assessment.scope.included = [
      "https://10.0.0.5/admin?token=PRIVATE-TOKEN",
      "Open C:\\Users\\Alice\\audit\\evidence.json"
    ];
    record.assessment.environment.os = ["Windows 11 on DESKTOP-ALICE"];
    record.assessment.limitations = [
      "Contact alice@example.com or +81 90-1234-5678. Authorization: Bearer TOP-SECRET-BEARER-1234567890.",
      "Raw evidence is stored at C:\\Users\\Alice\\audit\\raw.json."
    ];
  }
  const file = path.join(directory, sensitive ? "sensitive-assessment.json" : "assessment.json");
  writeJson(file, record);
  return file;
}

test("summary and full modes separate decision-ready reading from complete profile coverage", (t) => {
  const directory = tempDirectory(t);
  const assessment = standaloneFixture(directory);
  const before = hash(assessment);
  const summaryFile = path.join(directory, "summary.md");
  const fullFile = path.join(directory, "full.md");

  const summary = runCli([
    "report", "--input", assessment,
    "--locale", "en",
    "--detail", "summary",
    "--visibility", "internal",
    "--output", summaryFile
  ]);
  assert.equal(summary.status, 0, summary.stderr || summary.stdout);
  const summaryText = fs.readFileSync(summaryFile, "utf8");
  assert.match(summaryText, /^## Key findings and next actions$/mu);
  assert.match(summaryText, /^## Profile group counts$/mu);
  assert.match(summaryText, /^## Human-reviewed requirements$/mu);
  assert.match(summaryText, /Internal report[^\n]*not publication-ready/iu);
  assert.ok(criterionRows(summaryText).length < 55);

  const full = runCli([
    "report", "--input", assessment,
    "--locale", "en",
    "--detail", "full",
    "--visibility", "internal",
    "--output", fullFile
  ]);
  assert.equal(full.status, 0, full.stderr || full.stdout);
  const fullText = fs.readFileSync(fullFile, "utf8");
  assert.equal(criterionRows(fullText).length, 55);
  assert.equal(hash(assessment), before, "reporting must not mutate its assessment input");
});

test("summary plus appendix preflights every path and emits a complete appendix", (t) => {
  const directory = tempDirectory(t);
  const assessment = standaloneFixture(directory);
  const summaryFile = path.join(directory, "summary.md");
  const appendixFile = path.join(directory, "appendix.md");

  const rendered = runCli([
    "report", "--input", assessment,
    "--locale", "ja",
    "--detail", "summary",
    "--visibility", "internal",
    "--output", summaryFile,
    "--appendix", appendixFile
  ]);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  assert.ok(criterionRows(fs.readFileSync(summaryFile, "utf8")).length < 55);
  assert.equal(criterionRows(fs.readFileSync(appendixFile, "utf8")).length, 55);

  const conflictDirectory = path.join(directory, "conflict");
  fs.mkdirSync(conflictDirectory);
  const blockedSummary = path.join(conflictDirectory, "summary.md");
  const blockedAppendix = path.join(conflictDirectory, "appendix.md");
  fs.writeFileSync(blockedAppendix, "existing appendix\n", "utf8");
  const blocked = runCli([
    "report", "--input", assessment,
    "--detail", "summary",
    "--visibility", "internal",
    "--output", blockedSummary,
    "--appendix", blockedAppendix
  ]);
  assert.notEqual(blocked.status, 0);
  assert.equal(fs.existsSync(blockedSummary), false, "output preflight must fail before writing the summary");
  assert.equal(fs.readFileSync(blockedAppendix, "utf8"), "existing appendix\n");
});

test("summary keeps human-reviewed and actionable screening rows while omitting bulk not-run rows", (t) => {
  const directory = tempDirectory(t);
  const generated = runNode(runBackedExample, ["--output", directory]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);

  const humanScenario = path.join(directory, "human-reviewed");
  const humanSummary = path.join(directory, "human-summary.md");
  const human = runCli([
    "report",
    "--run", path.join(humanScenario, "audit-run.json"),
    "--assessment", path.join(humanScenario, "merged-assessment.json"),
    "--locale", "en",
    "--detail", "summary",
    "--visibility", "internal",
    "--output", humanSummary
  ]);
  assert.equal(human.status, 0, human.stderr || human.stdout);
  const humanText = fs.readFileSync(humanSummary, "utf8");
  assert.match(humanText, /\| 1\.1\.1 \|[^\n]*External human review/u);
  assert.doesNotMatch(humanText, /^\| 1\.2\.1 \|/mu);

  const screeningScenario = path.join(directory, "screening-only");
  const screeningSummary = path.join(directory, "screening-summary.md");
  const screening = runCli([
    "report",
    "--run", path.join(screeningScenario, "audit-run.json"),
    "--assessment", path.join(screeningScenario, "merged-assessment.json"),
    "--locale", "en",
    "--detail", "summary",
    "--visibility", "internal",
    "--output", screeningSummary
  ]);
  assert.equal(screening.status, 0, screening.stderr || screening.stdout);
  const screeningText = fs.readFileSync(screeningSummary, "utf8");
  assert.match(screeningText, /\| 1\.1\.1 \|[^\n]*AI\/automated screening/u);
  assert.match(screeningText, /Remaining not-run requirements:/u);
});

test("public standalone reports redact nested private data and emit a secret-free manifest", (t) => {
  const directory = tempDirectory(t);
  const assessment = standaloneFixture(directory, { sensitive: true });
  const reportFile = path.join(directory, "public.md");
  const manifestFile = path.join(directory, "redactions.json");
  const rendered = runCli([
    "report", "--input", assessment,
    "--locale", "en",
    "--detail", "full",
    "--visibility", "public",
    "--reviewer-disclosure", "redact",
    "--redaction-manifest", manifestFile,
    "--output", reportFile
  ]);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);

  const report = fs.readFileSync(reportFile, "utf8");
  for (const secret of [
    "alice@example.com",
    "90-1234-5678",
    "TOP-SECRET-BEARER-1234567890",
    "PUBLIC-QUERY-SECRET",
    "PRIVATE-TOKEN",
    "admin:password",
    "intranet.local",
    "DESKTOP-ALICE",
    "C:\\Users\\Alice"
  ]) assert.equal(report.includes(secret), false, `public report leaked ${secret}`);
  assert.match(report, /https:\/\/example\.com\/report/u);
  assert.doesNotMatch(report, /\?token=|#private-state/u);
  assert.match(report, /publication review is required/iu);

  const manifest = readJson(manifestFile);
  assert.equal(manifest.schema_version, "1.0.0");
  assert.equal(manifest.visibility, "public");
  assert.equal(manifest.publication_review_required, true);
  assert.ok(manifest.redactions.length >= 6);
  for (const entry of manifest.redactions) {
    assert.deepEqual(Object.keys(entry).sort(), ["action", "path", "reason"]);
  }
  const serialized = JSON.stringify(manifest);
  for (const secret of ["alice@example.com", "TOP-SECRET-BEARER-1234567890", "PUBLIC-QUERY-SECRET", "C:\\Users\\Alice"]) {
    assert.equal(serialized.includes(secret), false, `manifest leaked ${secret}`);
  }
});

test("internal reports preserve private audit data and identify themselves as non-public", (t) => {
  const directory = tempDirectory(t);
  const assessment = standaloneFixture(directory, { sensitive: true });
  const reportFile = path.join(directory, "internal.md");
  const rendered = runCli([
    "report", "--input", assessment,
    "--locale", "en",
    "--detail", "summary",
    "--visibility", "internal",
    "--output", reportFile
  ]);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  const report = fs.readFileSync(reportFile, "utf8");
  assert.match(report, /alice@example\.com/u);
  assert.match(report, /TOP-SECRET-BEARER-1234567890/u);
  assert.match(report, /Internal report[^\n]*not publication-ready/iu);
});

test("run-backed reports use the same public policy as standalone reports", (t) => {
  const directory = tempDirectory(t);
  const generated = runNode(runBackedExample, ["--output", directory]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  const scenario = path.join(directory, "screening-only");
  const runFile = path.join(scenario, "audit-run.json");
  const assessmentFile = path.join(scenario, "merged-assessment.json");
  const run = readJson(runFile);
  const assessment = readJson(assessmentFile);
  run.target.name = "Internal dashboard for alice@example.com";
  run.target.urls_or_files = [
    "https://10.0.0.8/admin?token=RUN-PRIVATE-TOKEN",
    "https://example.com/app?session=RUN-SESSION-SECRET#state"
  ];
  run.scope.included = [...run.target.urls_or_files];
  assessment.assessment.target = structuredClone(run.target);
  assessment.assessment.scope = structuredClone(run.scope);
  writeJson(runFile, run);
  writeJson(assessmentFile, assessment);

  const reportFile = path.join(directory, "run-public.md");
  const manifestFile = path.join(directory, "run-redactions.json");
  const rendered = runCli([
    "report",
    "--run", runFile,
    "--assessment", assessmentFile,
    "--locale", "en",
    "--detail", "summary",
    "--visibility", "public",
    "--reviewer-disclosure", "redact",
    "--redaction-manifest", manifestFile,
    "--output", reportFile
  ]);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  const report = fs.readFileSync(reportFile, "utf8");
  assert.equal(report.includes("alice@example.com"), false);
  assert.equal(report.includes("RUN-PRIVATE-TOKEN"), false);
  assert.equal(report.includes("RUN-SESSION-SECRET"), false);
  assert.match(report, /https:\/\/example\.com\/app/u);
  assert.ok(readJson(manifestFile).redactions.length > 0);
});

test("public output requires explicit reviewer disclosure and an internal manifest", (t) => {
  const directory = tempDirectory(t);
  const assessment = standaloneFixture(directory);
  const missingManifest = path.join(directory, "missing-manifest.md");
  const noManifest = runCli([
    "report", "--input", assessment,
    "--visibility", "public",
    "--reviewer-disclosure", "redact",
    "--output", missingManifest
  ]);
  assert.notEqual(noManifest.status, 0);
  assert.match(noManifest.stderr, /--redaction-manifest/u);
  assert.equal(fs.existsSync(missingManifest), false);

  const missingDisclosure = runCli([
    "report", "--input", assessment,
    "--visibility", "public",
    "--redaction-manifest", path.join(directory, "manifest.json"),
    "--output", path.join(directory, "missing-disclosure.md")
  ]);
  assert.notEqual(missingDisclosure.status, 0);
  assert.match(missingDisclosure.stderr, /--reviewer-disclosure/u);

  const invalidAppendix = runCli([
    "report", "--input", assessment,
    "--detail", "full",
    "--visibility", "internal",
    "--appendix", path.join(directory, "invalid-appendix.md"),
    "--output", path.join(directory, "invalid-full.md")
  ]);
  assert.notEqual(invalidAppendix.status, 0);
  assert.match(invalidAppendix.stderr, /--appendix[^\n]*summary/iu);
});
