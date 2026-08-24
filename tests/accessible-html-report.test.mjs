import assert from "node:assert/strict";
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

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-html-report-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assessmentFixture(directory, profile = "web-modern", { sensitive = false, injection = false } = {}) {
  const targetName = injection
    ? `Report <img src=x onerror="alert('x')"> </title><script>alert(1)</script>`
    : sensitive
      ? "Private dashboard for alice@example.com"
      : `${profile} accessible report fixture`;
  const record = generateAssessment(profile, {
    targetName,
    targetVersion: "2026-08-24",
    targetRefs: sensitive
      ? ["https://example.com/report?token=HTML-SECRET#private", "C:\\Users\\Alice\\report.html"]
      : ["https://example.com/"],
    evaluator: sensitive ? "Alice Reviewer <alice@example.com>" : "Accessible report fixture",
    evaluatedAt: "2026-08-24"
  });
  if (sensitive) {
    record.assessment.scope.included = ["https://10.0.0.8/admin?secret=PRIVATE-HTML-TOKEN"];
    record.assessment.limitations = [
      "Contact alice@example.com. Authorization: Bearer HTML-BEARER-SECRET-1234567890."
    ];
  }
  const file = path.join(directory, `${profile}.json`);
  writeJson(file, record);
  return file;
}

function ids(html) {
  return [...html.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1]);
}

function criterionRows(html) {
  return [...html.matchAll(/<tr\s+data-requirement-id="[^"]+"/gu)];
}

function assertUniqueIds(html) {
  const all = ids(html);
  assert.equal(new Set(all).size, all.length, "HTML IDs must be unique");
}

function assertDocumentShell(html, locale) {
  assert.match(html, /^<!doctype html>\n<html lang="(?:ja|en)">/u);
  assert.match(html, new RegExp(`<html lang="${locale}">`, "u"));
  assert.match(html, /<meta charset="utf-8">/u);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/u);
  assert.match(html, /<title>[^<]+<\/title>/u);
  assert.match(html, /<a class="skip-link" href="#main-content">[^<]+<\/a>/u);
  assert.match(html, /<header\b[^>]*>/u);
  assert.match(html, /<nav\b[^>]*aria-label="[^"]+"/u);
  assert.match(html, /<main id="main-content" tabindex="-1">/u);
  assert.match(html, /<footer\b[^>]*>/u);
  assert.equal((html.match(/<h1\b/gu) ?? []).length, 1);
  assert.match(html, /:focus-visible\s*\{/u);
  assert.match(html, /@media \(forced-colors: active\)/u);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(html, /@media print/u);
  assert.match(html, /\.table-region\s*\{[^}]*overflow-x:\s*auto/isu);
  assert.match(html, /\.visually-hidden\s*\{/u);
  assertUniqueIds(html);
}

test("report help exposes HTML as a supported format while keeping Markdown as the default", () => {
  const help = runCli(["report", "--help"]);
  assert.equal(help.status, 0, help.stderr || help.stdout);
  assert.match(help.stdout, /--format <markdown\|html>/u);
  assert.match(help.stdout, /Default: markdown/u);

  const invalid = runCli(["report", "--format", "pdf"]);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /--format must be markdown or html/u);
});

test("Japanese full HTML has semantic landmarks, accessible tables, visible provenance, and all 55 rows", (t) => {
  const directory = tempDirectory(t);
  const assessment = assessmentFixture(directory, "web-modern");
  const output = path.join(directory, "ja-full.html");
  const rendered = runCli([
    "report", "--input", assessment,
    "--format", "html",
    "--locale", "ja",
    "--detail", "full",
    "--visibility", "internal",
    "--output", output
  ]);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  const html = fs.readFileSync(output, "utf8");

  assertDocumentShell(html, "ja");
  assert.equal(criterionRows(html).length, 55);
  assert.match(html, /<section id="criteria-wcag-2-2"/u);
  assert.match(html, /<div class="table-region" role="region" aria-labelledby="[^"]+" tabindex="0">/u);
  assert.match(html, /<table>/u);
  assert.match(html, /<caption id="[^"]+">[^<]+<span class="visually-hidden">/u);
  assert.match(html, /<th scope="col">達成基準<\/th>/u);
  assert.match(html, /<th scope="row">1\.1\.1<\/th>/u);
  assert.match(html, />判定の出所</u);
  assert.match(html, />証拠レベル</u);
  assert.match(html, />未実施</u);
  assert.match(html, /aria-label="1\.1\.1[^"]*一次資料/u);
  assert.match(html, /data-outcome="not-tested"/u);
  assert.match(html, /data-source="not-run"/u);
});

test("English JIS full HTML separates 38 JIS and 18 additional WCAG rows with captions", (t) => {
  const directory = tempDirectory(t);
  const assessment = assessmentFixture(directory, "jp-public-web");
  const output = path.join(directory, "en-jis-full.html");
  const rendered = runCli([
    "report", "--input", assessment,
    "--format", "html",
    "--locale", "en",
    "--detail", "full",
    "--visibility", "internal",
    "--output", output
  ]);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  const html = fs.readFileSync(output, "utf8");

  assertDocumentShell(html, "en");
  assert.equal(criterionRows(html).length, 56);
  assert.equal((html.match(/<table>/gu) ?? []).length >= 3, true);
  assert.match(html, /JIS X 8341-3:2016 A\/AA \(38\)/u);
  assert.match(html, /Additional WCAG 2\.1\/2\.2 A\/AA \(18\)/u);
  assert.match(html, /4\.1\.1 Parsing/u);
  assert.match(html, /removed from WCAG 2\.2/iu);
  assert.match(html, /<th scope="col">Judgement source<\/th>/u);
  assert.match(html, /<th scope="col">Evidence level<\/th>/u);
});

test("HTML summary links to a complete HTML appendix and both outputs are preflighted", (t) => {
  const directory = tempDirectory(t);
  const assessment = assessmentFixture(directory);
  const summary = path.join(directory, "summary.html");
  const appendix = path.join(directory, "full appendix.html");
  const rendered = runCli([
    "report", "--input", assessment,
    "--format", "html",
    "--locale", "en",
    "--detail", "summary",
    "--visibility", "internal",
    "--output", summary,
    "--appendix", appendix
  ]);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  const summaryHtml = fs.readFileSync(summary, "utf8");
  const appendixHtml = fs.readFileSync(appendix, "utf8");
  assertDocumentShell(summaryHtml, "en");
  assert.ok(criterionRows(summaryHtml).length < 55);
  assert.equal(criterionRows(appendixHtml).length, 55);
  assert.match(summaryHtml, /href="full%20appendix\.html"/u);
  assert.match(summaryHtml, />Open the complete report appendix<\/a>/u);

  const blockedSummary = path.join(directory, "blocked-summary.html");
  const blockedAppendix = path.join(directory, "existing.html");
  fs.writeFileSync(blockedAppendix, "existing\n", "utf8");
  const blocked = runCli([
    "report", "--input", assessment,
    "--format", "html",
    "--detail", "summary",
    "--visibility", "internal",
    "--output", blockedSummary,
    "--appendix", blockedAppendix
  ]);
  assert.notEqual(blocked.status, 0);
  assert.equal(fs.existsSync(blockedSummary), false);
  assert.equal(fs.readFileSync(blockedAppendix, "utf8"), "existing\n");
});

test("public HTML uses the shared sanitizer and escapes hostile assessment prose", (t) => {
  const directory = tempDirectory(t);
  const assessment = assessmentFixture(directory, "web-modern", { sensitive: true, injection: true });
  const output = path.join(directory, "public.html");
  const manifest = path.join(directory, "redactions.json");
  const record = readJson(assessment);
  record.assessment.target.name = `Report <img src=x onerror="alert('x')"> </title><script>alert(1)</script> alice@example.com`;
  writeJson(assessment, record);

  const rendered = runCli([
    "report", "--input", assessment,
    "--format", "html",
    "--locale", "en",
    "--detail", "full",
    "--visibility", "public",
    "--reviewer-disclosure", "redact",
    "--redaction-manifest", manifest,
    "--output", output
  ]);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  const html = fs.readFileSync(output, "utf8");

  assertDocumentShell(html, "en");
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>|onerror=/u);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(&#39;x&#39;\)&quot;&gt;/u);
  for (const secret of ["alice@example.com", "HTML-SECRET", "PRIVATE-HTML-TOKEN", "HTML-BEARER-SECRET", "C:\\Users\\Alice"]) {
    assert.equal(html.includes(secret), false, `public HTML leaked ${secret}`);
  }
  assert.match(html, /publication review is required/iu);
  const redactions = readJson(manifest);
  assert.equal(redactions.visibility, "public");
  assert.ok(redactions.redactions.length > 0);
});

test("run-backed public HTML preserves provenance without leaking private target metadata", (t) => {
  const directory = tempDirectory(t);
  const generated = runNode(runBackedExample, ["--output", directory]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  const scenario = path.join(directory, "screening-only");
  const runFile = path.join(scenario, "audit-run.json");
  const assessmentFile = path.join(scenario, "merged-assessment.json");
  const run = readJson(runFile);
  const assessment = readJson(assessmentFile);
  run.target.name = "Private report alice@example.com";
  run.target.urls_or_files = ["https://10.0.0.5/admin?token=RUN-HTML-SECRET"];
  run.scope.included = [...run.target.urls_or_files];
  assessment.assessment.target = structuredClone(run.target);
  assessment.assessment.scope = structuredClone(run.scope);
  writeJson(runFile, run);
  writeJson(assessmentFile, assessment);

  const output = path.join(directory, "run-public.html");
  const manifest = path.join(directory, "run-redactions.json");
  const rendered = runCli([
    "report", "--run", runFile,
    "--assessment", assessmentFile,
    "--format", "html",
    "--locale", "en",
    "--detail", "summary",
    "--visibility", "public",
    "--reviewer-disclosure", "redact",
    "--redaction-manifest", manifest,
    "--output", output
  ]);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  const html = fs.readFileSync(output, "utf8");
  assert.match(html, /AI\/automated screening/u);
  assert.match(html, /Evidence level/u);
  assert.equal(html.includes("alice@example.com"), false);
  assert.equal(html.includes("RUN-HTML-SECRET"), false);
  assert.ok(readJson(manifest).redactions.length > 0);
});

test("Markdown remains the default and explicit markdown output stays compatible", (t) => {
  const directory = tempDirectory(t);
  const assessment = assessmentFixture(directory);
  const implicitOutput = path.join(directory, "implicit.md");
  const explicitOutput = path.join(directory, "explicit.md");
  const implicit = runCli([
    "report", "--input", assessment,
    "--detail", "full",
    "--visibility", "internal",
    "--output", implicitOutput
  ]);
  assert.equal(implicit.status, 0, implicit.stderr || implicit.stdout);
  const explicit = runCli([
    "report", "--input", assessment,
    "--format", "markdown",
    "--detail", "full",
    "--visibility", "internal",
    "--output", explicitOutput
  ]);
  assert.equal(explicit.status, 0, explicit.stderr || explicit.stdout);
  assert.equal(fs.readFileSync(explicitOutput, "utf8"), fs.readFileSync(implicitOutput, "utf8"));
  assert.doesNotMatch(fs.readFileSync(explicitOutput, "utf8"), /^<!doctype html>/u);
});
