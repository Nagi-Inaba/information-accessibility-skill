import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { writeCatalogCandidate } from "../scripts/build-criteria-catalog.mjs";
import { writeNewText } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generator = path.join(root, "codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs");
const validator = path.join(root, "codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs");
const renderer = path.join(root, "codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs");

function validArgs(output) {
  return [
    generator,
    "--profile", "web-modern",
    "--target-name", "Example service",
    "--target-version", "v1.0.0",
    "--target-ref", "https://example.invalid/",
    "--evaluator", "External reviewer",
    "--evaluated-at", "2026-08-22",
    "--output", output
  ];
}

function runNode(args) {
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function runNodeAsync(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

function withTemp(t, prefix = "assessment-output-") {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  return temp;
}

test("record mode requires complete identity and leaves no partial output", (t) => {
  const temp = withTemp(t);
  const output = path.join(temp, "missing", "assessment.json");
  const result = runNode([generator, "--profile", "web-modern", "--output", output]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--target-name is required in record mode/iu);
  assert.equal(fs.existsSync(output), false);
  assert.equal(fs.existsSync(path.dirname(output)), false);
});

test("explicit template mode creates a clearly labelled placeholder template", (t) => {
  const temp = withTemp(t);
  const output = path.join(temp, "nested", "assessment.template.json");
  const result = runNode([generator, "--template", "--profile", "web-modern", "--output", output]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const status = JSON.parse(result.stdout);
  assert.equal(status.status, "TEMPLATE_CREATED");
  const record = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(record.assessment.target.name, "REPLACE_ME");
  assert.equal(record.assessment.evaluated_at, "YYYY-MM-DD");
});

test("record mode writes only a validator-valid assessment", (t) => {
  const temp = withTemp(t);
  const output = path.join(temp, "nested", "assessment.json");
  const generated = runNode(validArgs(output));
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  assert.equal(JSON.parse(generated.stdout).status, "PASS");
  const validated = runNode([validator, output]);
  assert.equal(validated.status, 0, validated.stderr || validated.stdout);
  assert.equal(JSON.parse(validated.stdout).valid, true);
});

test("single-value arguments cannot be repeated", (t) => {
  const temp = withTemp(t);
  const output = path.join(temp, "assessment.json");
  const args = validArgs(output);
  args.splice(3, 0, "--profile", "web-modern");
  const result = runNode(args);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Duplicate argument: --profile/iu);
  assert.equal(fs.existsSync(output), false);
});

test("existing assessment output remains byte- and metadata-identical", (t) => {
  const temp = withTemp(t);
  const output = path.join(temp, "assessment.json");
  fs.writeFileSync(output, "sentinel\n", "utf8");
  const before = fs.statSync(output, { bigint: true });
  const result = runNode(validArgs(output));
  const after = fs.statSync(output, { bigint: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to overwrite existing file/iu);
  assert.equal(fs.readFileSync(output, "utf8"), "sentinel\n");
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.equal(after.size, before.size);
});

test("concurrent assessment writers allow exactly one creator", async (t) => {
  const temp = withTemp(t, "assessment-race-");
  const output = path.join(temp, "nested", "assessment.json");
  const [first, second] = await Promise.all([
    runNodeAsync(validArgs(output)),
    runNodeAsync(validArgs(output))
  ]);
  const successes = [first, second].filter((result) => result.status === 0);
  const failures = [first, second].filter((result) => result.status !== 0);
  assert.equal(successes.length, 1, JSON.stringify({ first, second }, null, 2));
  assert.equal(failures.length, 1, JSON.stringify({ first, second }, null, 2));
  assert.match(failures[0].stderr, /Refusing to overwrite existing file|EEXIST/iu);
  const validated = runNode([validator, output]);
  assert.equal(validated.status, 0, validated.stderr || validated.stdout);
});

test("safe output rejects a symbolic-link parent", { skip: process.platform === "win32" }, (t) => {
  const temp = withTemp(t, "assessment-link-");
  const real = path.join(temp, "real");
  const link = path.join(temp, "link");
  fs.mkdirSync(real);
  fs.symlinkSync(real, link, "dir");
  const output = path.join(link, "assessment.json");
  const result = runNode(validArgs(output));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symbolic link|reparse traversal|Unsafe output/iu);
  assert.equal(fs.existsSync(path.join(real, "assessment.json")), false);
});

test("safe output rejects a Windows junction parent", { skip: process.platform !== "win32" }, (t) => {
  const temp = withTemp(t, "assessment-junction-");
  const real = path.join(temp, "real");
  const junction = path.join(temp, "junction");
  fs.mkdirSync(real);
  fs.symlinkSync(real, junction, "junction");
  const output = path.join(junction, "assessment.json");
  const result = runNode(validArgs(output));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symbolic link|junction|reparse traversal|Unsafe output/iu);
  assert.equal(fs.existsSync(path.join(real, "assessment.json")), false);
});

test("standalone reports and catalog candidates share nested safe output creation", (t) => {
  const temp = withTemp(t, "shared-safe-output-");
  const assessment = path.join(temp, "assessment.json");
  assert.equal(runNode(validArgs(assessment)).status, 0);

  const report = path.join(temp, "reports", "public", "report.md");
  const rendered = runNode([renderer, "--input", assessment, "--output", report]);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  assert.match(fs.readFileSync(report, "utf8"), /^# WCAG参照ガイダンス/mu);

  const candidate = path.join(temp, "catalog", "candidate.json");
  writeCatalogCandidate(candidate, { status: "candidate" });
  assert.deepEqual(JSON.parse(fs.readFileSync(candidate, "utf8")), { status: "candidate" });

  const direct = path.join(temp, "direct", "nested", "output.txt");
  writeNewText(direct, "safe\n");
  assert.equal(fs.readFileSync(direct, "utf8"), "safe\n");
});

test("README examples distinguish valid record creation from template creation", () => {
  for (const file of ["README.md", "README.en.md"]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(text, /accessibility-audit\.mjs assessment[^\n]*--target-name[^\n]*--target-version[^\n]*--target-ref[^\n]*--evaluator[^\n]*--evaluated-at[^\n]*--output/u);
    assert.match(text, /generate-assessment\.mjs[^\n]*--template[^\n]*--profile/u);
  }
});
