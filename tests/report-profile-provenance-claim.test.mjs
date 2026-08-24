import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";
import { lookupRequirement } from "../codex/skills/information-accessibility-practice/scripts/show-requirement.mjs";

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

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-report-profile-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function renderStandalone(t, profile, locale) {
  const directory = tempDirectory(t);
  const assessment = path.join(directory, `${profile}.json`);
  const report = path.join(directory, `${profile}.${locale}.md`);
  writeJson(assessment, generateAssessment(profile, {
    targetName: `${profile} report fixture`,
    targetVersion: "2026-08-24",
    targetRefs: ["https://example.com/"],
    evaluator: "Report fixture",
    evaluatedAt: "2026-08-24"
  }));
  const rendered = runCli([
    "report",
    "--input", assessment,
    "--locale", locale,
    "--output", report
  ]);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  return fs.readFileSync(report, "utf8");
}

function criterionRow(report, successCriterion) {
  return report.split(/\r?\n/u).find((line) => line.startsWith(`| ${successCriterion} |`));
}

function criterionRows(report) {
  return report.split(/\r?\n/u).filter((line) => /^\| \d+(?:\.\d+){2} \|/u.test(line));
}

test("standalone reports use profile-aware Japanese and English titles, groups, metadata, and JIS parsing note", (t) => {
  const webJa = renderStandalone(t, "web-modern", "ja");
  const webEn = renderStandalone(t, "web-modern", "en");
  const jisJa = renderStandalone(t, "jp-public-web", "ja");
  const jisEn = renderStandalone(t, "jp-public-web", "en");

  assert.match(webJa, /^# WCAG 2\.2 A\/AA 監査レポート$/mu);
  assert.match(webEn, /^# WCAG 2\.2 A\/AA Audit Report$/mu);
  assert.match(jisJa, /^# JIS X 8341-3:2016＋追加WCAG A\/AA 監査レポート$/mu);
  assert.match(jisEn, /^# JIS X 8341-3:2016 \+ Additional WCAG A\/AA Audit Report$/mu);

  assert.match(jisJa, /^## JIS X 8341-3:2016 A\/AA（38）$/mu);
  assert.match(jisJa, /^## 追加WCAG 2\.1\/2\.2 A\/AA（18）$/mu);
  assert.match(jisEn, /^## JIS X 8341-3:2016 A\/AA \(38\)$/mu);
  assert.match(jisEn, /^## Additional WCAG 2\.1\/2\.2 A\/AA \(18\)$/mu);

  for (const report of [webJa, webEn, jisJa, jisEn]) {
    assert.match(report, /\| (?:達成基準|Criterion) \| (?:名称|Title) \| (?:レベル|Level) \| (?:区分|Group) \|/u);
    assert.match(report, /https:\/\//u);
  }
  assert.match(jisJa, /4\.1\.1「構文解析」[^\n]*JIS X 8341-3:2016[^\n]*WCAG 2\.2では削除/u);
  assert.match(jisEn, /4\.1\.1 Parsing[^\n]*retained by JIS X 8341-3:2016[^\n]*removed from WCAG 2\.2/iu);

  const webRow = criterionRow(webEn, "1.1.1");
  assert.ok(webRow, "missing WCAG row 1.1.1");
  assert.match(webRow, /Non-text Content/u);
  assert.match(webRow, /\| A \|/u);
  assert.match(webRow, /WCAG 2\.2 A\/AA/u);
});

test("run-backed rows distinguish human review, screening projection, and not-run evidence", (t) => {
  const directory = tempDirectory(t);
  const generated = runNode(runBackedExample, ["--output", directory]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);

  const screeningDirectory = path.join(directory, "screening-only");
  const humanDirectory = path.join(directory, "human-reviewed");
  const screeningReport = path.join(directory, "screening.ja.md");
  const humanReport = path.join(directory, "human.ja.md");

  const screeningRendered = runCli([
    "report",
    "--run", path.join(screeningDirectory, "audit-run.json"),
    "--assessment", path.join(screeningDirectory, "merged-assessment.json"),
    "--locale", "ja",
    "--output", screeningReport
  ]);
  assert.equal(screeningRendered.status, 0, screeningRendered.stderr || screeningRendered.stdout);

  const humanRendered = runCli([
    "report",
    "--run", path.join(humanDirectory, "audit-run.json"),
    "--assessment", path.join(humanDirectory, "merged-assessment.json"),
    "--locale", "ja",
    "--output", humanReport
  ]);
  assert.equal(humanRendered.status, 0, humanRendered.stderr || humanRendered.stdout);

  const screening = fs.readFileSync(screeningReport, "utf8");
  const human = fs.readFileSync(humanReport, "utf8");
  const screeningRow = criterionRow(screening, "1.1.1");
  const humanRow = criterionRow(human, "1.1.1");
  const notRunRow = criterionRow(screening, "1.2.1");

  assert.match(screeningRow, /AI／自動スクリーニング/u);
  assert.match(screeningRow, /\| E1 \|/u);
  assert.match(humanRow, /外部人手レビュー/u);
  assert.match(humanRow, /\| E2 \|/u);
  assert.match(notRunRow, /未実施/u);
  assert.match(notRunRow, /\| E0 \|/u);
  assert.match(screening, /スクリーニングによる表示はreport-only judgementであり、profile outcomeではありません/u);
  assert.doesNotMatch(screeningRow, /human_verified/u);
});

test("claim section shows requested and validator maximum tiers with registry-fixed wording and limiting reasons", (t) => {
  const standaloneJa = renderStandalone(t, "web-modern", "ja");
  assert.match(standaloneJa, /^## 主張可能な範囲$/mu);
  assert.match(standaloneJa, /要求されたtier: `reference_only`/u);
  assert.match(standaloneJa, /検証上限tier: `reference_only`/u);
  assert.match(standaloneJa, /規格プロファイルを参照した助言のみです/u);
  assert.match(standaloneJa, /人による確認済み: 0\/55/u);
  assert.match(standaloneJa, /正式な適合表明ではありません/u);

  const directory = tempDirectory(t);
  const generated = runNode(runBackedExample, ["--output", directory]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  const scenario = path.join(directory, "human-reviewed");
  const report = path.join(directory, "human.en.md");
  const rendered = runCli([
    "report",
    "--run", path.join(scenario, "audit-run.json"),
    "--assessment", path.join(scenario, "merged-assessment.json"),
    "--locale", "en",
    "--output", report
  ]);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  const english = fs.readFileSync(report, "utf8");
  assert.match(english, /^## Claim boundary$/mu);
  assert.match(english, /Requested tier: `reference_only`/u);
  assert.match(english, /Validator maximum tier: `evaluated_subset`/u);
  assert.match(english, /Profile-informed guidance only; the target was not reviewed against the full requirement set\./u);
  assert.match(english, /Human-reviewed requirements: 1\/55/u);
  assert.match(english, /not a formal conformance declaration/iu);
});

test("a complete synthetic human-review fixture preserves human provenance for all 55 rows without claiming certification", (t) => {
  const directory = tempDirectory(t);
  const assessmentFile = path.join(directory, "complete-human.json");
  const reportFile = path.join(directory, "complete-human.en.md");
  const record = generateAssessment("web-modern", {
    targetName: "Complete human provenance fixture",
    targetVersion: "2026-08-24",
    targetRefs: ["https://example.com/"],
    evaluator: "Synthetic external reviewer fixture",
    evaluatedAt: "2026-08-24"
  });
  record.assessment.scope.included = ["https://example.com/"];
  for (const row of record.assessment.results) {
    const requiredEvidenceTypes = lookupRequirement("web-modern", row.requirement_id)
      .procedure_binding.required_evidence_types;
    row.mapping_status = "human_verified";
    row.outcome = "pass";
    row.method_kind = "manual";
    row.evidence = requiredEvidenceTypes.map((type, index) => ({
      type,
      location: row.requirement_id,
      observation: `The synthetic external reviewer fixture records target-specific ${type} evidence for this requirement.`,
      captured_at: `2026-08-24T00:00:${String(index).padStart(2, "0")}Z`
    }));
    row.notes = "Synthetic target-specific human-review evidence was recorded for report provenance testing.";
  }
  record.assessment.evidence_level = "E2";
  record.assessment.limitations = [
    "This is a synthetic external-review fixture and does not establish reviewer identity or formal conformance."
  ];
  writeJson(assessmentFile, record);

  const rendered = runCli([
    "report",
    "--input", assessmentFile,
    "--locale", "en",
    "--output", reportFile
  ]);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  const report = fs.readFileSync(reportFile, "utf8");
  const rows = criterionRows(report);
  assert.equal(rows.length, 55);
  assert.ok(rows.every((row) => /External human review/u.test(row)), "every profile row must retain human provenance");
  assert.ok(rows.every((row) => /\| E2 \|/u.test(row)), "every profile row must retain E2 evidence level");
  assert.doesNotMatch(rows.join("\n"), /AI\/automated screening|Not run/u);
  assert.match(report, /Human-reviewed requirements: 55\/55/u);
  assert.match(report, /Validator maximum tier: `evaluated_subset`/u);
  assert.match(report, /not a formal conformance declaration/iu);
  assert.doesNotMatch(report, /certified|certification candidate/iu);
});

test("localized report output escapes HTML and Markdown heading injection from assessment prose", (t) => {
  const directory = tempDirectory(t);
  const assessmentFile = path.join(directory, "injection.json");
  const reportFile = path.join(directory, "injection.md");
  const record = generateAssessment("web-modern", {
    targetName: "Example <script>alert(1)</script>\n## Forged claim",
    targetVersion: "2026-08-24",
    targetRefs: ["https://example.com/"],
    evaluator: "Report fixture",
    evaluatedAt: "2026-08-24"
  });
  writeJson(assessmentFile, record);
  const rendered = runCli([
    "report",
    "--input", assessmentFile,
    "--locale", "en",
    "--output", reportFile
  ]);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  const report = fs.readFileSync(reportFile, "utf8");
  assert.match(report, /Example &lt;script&gt;alert\(1\)&lt;\/script&gt;<br>\\#\\# Forged claim/u);
  assert.doesNotMatch(report, /<script>|^## Forged claim$/mu);
});
