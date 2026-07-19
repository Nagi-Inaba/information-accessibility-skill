import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "codex", "skills", "information-accessibility-practice");
const cli = path.join(skillRoot, "scripts", "accessibility-audit.mjs");

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: options.cwd ?? root,
    encoding: "utf8"
  });
}

function withTemp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-unified-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("unified CLI exposes the safe audit control plane without a mutation command", () => {
  const result = runCli(["--help"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const command of [
    "init",
    "assessment",
    "requirement",
    "validate-run",
    "validate-assessment",
    "screen-reader-checklist",
    "register",
    "merge",
    "report",
    "retest"
  ]) {
    assert.match(result.stdout, new RegExp(`\\b${command}\\b`), `missing ${command}`);
  }
  assert.doesNotMatch(result.stdout, /apply-authorized-fix|\n\s+fix\b/iu);
});

test("unified CLI remains executable through an installed package link", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "accessibility-cli-link-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const linkedSkill = path.join(temp, "information-accessibility-practice-cli");
  try {
    fs.symlinkSync(skillRoot, linkedSkill, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`link creation unavailable (${error?.code ?? "unknown"})`);
    return;
  }

  const linkedCli = path.join(linkedSkill, "scripts", "accessibility-audit.mjs");
  const result = spawnSync(process.execPath, [linkedCli, "--help"], {
    cwd: root,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Information Accessibility Audit CLI/u);
});

test("unified CLI rejects mutation and unknown commands before dispatch", () => {
  const blocked = runCli(["fix"]);
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /authorization|mutation|修正/iu);

  const unknown = runCli(["does-not-exist"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown command/iu);
});

test("requirement delegates to the installed requirement lookup", () => {
  const result = runCli([
    "requirement",
    "--profile", "web-modern",
    "--id", "WCAG-2.2-SC-1.1.1"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.profile.id, "web-modern");
  assert.equal(output.criterion.id, "WCAG-2.2-SC-1.1.1");
});

test("screen-reader checklist delegates to the installed supporting-check lookup", () => {
  const result = runCli([
    "screen-reader-checklist",
    "--pattern", "menu-button",
    "--format", "json"
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.pattern, "menu-button");
  assert.equal(output.claim_effect, "supporting_only");
  assert.deepEqual(output.patterns.map((pattern) => pattern.id), ["menu-button"]);
});

test("control-plane commands route to their intended existing CLI contracts", () => {
  const cases = [
    { args: ["init"], expected: /--run-id is required/iu },
    { args: ["validate-run"], expected: /--input is required/iu },
    { args: ["register", "--run", "unused.json"], expected: /--artifact is required/iu },
    { args: ["merge", "--run", "unused.json", "--assessment", "unused.json", "--output", "unused-output.json"], expected: /--artifact is required/iu }
  ];

  for (const { args, expected } of cases) {
    const result = runCli(args);
    assert.notEqual(result.status, 0, `${args[0]} unexpectedly succeeded`);
    assert.match(result.stderr, expected, `${args[0]} reached the wrong runtime contract`);
  }
});

test("assessment, validation, and report commands preserve existing runtime behavior", (t) => {
  const directory = withTemp(t);
  const assessment = path.join(directory, "assessment.json");
  const report = path.join(directory, "report.md");

  const generated = runCli([
    "assessment",
    "--profile", "web-modern",
    "--target-name", "Unified CLI fixture",
    "--target-version", "fixture-v1",
    "--target-ref", "https://example.test/",
    "--evaluator", "external-human-review-required",
    "--evaluated-at", "2026-07-18",
    "--output", assessment
  ]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  assert.equal(fs.existsSync(assessment), true);

  const validated = runCli(["validate-assessment", assessment]);
  assert.equal(validated.status, 0, validated.stderr || validated.stdout);
  assert.equal(JSON.parse(validated.stdout).valid, true);

  const rendered = runCli(["report", "--input", assessment, "--output", report]);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  assert.match(fs.readFileSync(report, "utf8"), /^# WCAG検査レポート/mu);

  const overwrite = runCli([
    "assessment",
    "--profile", "web-modern",
    "--output", assessment
  ]);
  assert.notEqual(overwrite.status, 0);
  assert.match(overwrite.stderr, /exist|overwrite|already/iu);
});

test("retest requires an explicit predecessor run", () => {
  const result = runCli(["retest"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--supersedes-run/iu);
});

test("skill package exposes accessibility-audit as its installable bin", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(skillRoot, "package.json"), "utf8"));
  assert.equal(manifest.type, "module");
  assert.equal(manifest.bin?.["accessibility-audit"], "./scripts/accessibility-audit.mjs");
});
