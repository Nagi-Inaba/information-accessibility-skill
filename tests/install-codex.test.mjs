import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "scripts/install-codex.ps1");
const sourceSkill = path.join(root, "codex/skills/information-accessibility-practice");
const sourceAgent = path.join(root, "codex/agents/information-accessibility-reviewer.toml");

function run(command, args, cwd = root) {
  return spawnSync(command, args, { cwd, encoding: "utf8" });
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function relativeFiles(base, current = base) {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(current, entry.name);
    return entry.isDirectory() ? relativeFiles(base, full) : [path.relative(base, full)];
  }).sort();
}

function assertMirror(expected, actual) {
  const expectedFiles = relativeFiles(expected);
  const actualFiles = relativeFiles(actual);
  assert.deepEqual(actualFiles, expectedFiles);
  for (const relative of expectedFiles) {
    assert.equal(sha256(path.join(actual, relative)), sha256(path.join(expected, relative)), relative);
  }
}

test("Codex installer supports WhatIf, backup, replacement, and neutral-cwd use", { skip: process.platform !== "win32" }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-codex-install-"));
  try {
    const whatIfHome = path.join(temp, "what-if-home");
    const whatIf = run("powershell", ["-ExecutionPolicy", "Bypass", "-File", installer, "-CodexHome", whatIfHome, "-WhatIf"]);
    assert.equal(whatIf.status, 0, whatIf.stderr || whatIf.stdout);
    assert.equal(fs.existsSync(whatIfHome), false);

    for (const [name, backupFromHome] of [
      ["same", "skills/information-accessibility-practice"],
      ["descendant", "skills/information-accessibility-practice/backup"],
      ["ancestor", "."]
    ]) {
      const overlapHome = path.join(temp, `overlap-${name}-home`);
      const overlapBackup = path.resolve(overlapHome, backupFromHome);
      const overlap = run("powershell", [
        "-ExecutionPolicy", "Bypass", "-File", installer,
        "-CodexHome", overlapHome,
        "-BackupRoot", overlapBackup,
        "-WhatIf"
      ]);
      assert.notEqual(overlap.status, 0, name);
      assert.match(overlap.stderr || overlap.stdout, /must not overlap the installation destination/, name);
      assert.equal(fs.existsSync(overlapHome), false, name);
    }

    const occupiedHome = path.join(temp, "occupied-home");
    const occupiedBackup = path.join(temp, "occupied-backup");
    fs.mkdirSync(occupiedBackup);
    fs.writeFileSync(path.join(occupiedBackup, "sentinel.txt"), "preserve", "utf8");
    const occupied = run("powershell", [
      "-ExecutionPolicy", "Bypass", "-File", installer,
      "-CodexHome", occupiedHome,
      "-BackupRoot", occupiedBackup,
      "-WhatIf"
    ]);
    assert.notEqual(occupied.status, 0);
    assert.match(occupied.stderr || occupied.stdout, /Backup root already exists/);
    assert.equal(fs.readFileSync(path.join(occupiedBackup, "sentinel.txt"), "utf8"), "preserve");
    assert.equal(fs.existsSync(occupiedHome), false);

    const codexHome = path.join(temp, "codex-home");
    const first = run("powershell", ["-ExecutionPolicy", "Bypass", "-File", installer, "-CodexHome", codexHome]);
    assert.equal(first.status, 0, first.stderr || first.stdout);

    const installedSkill = path.join(codexHome, "skills/information-accessibility-practice");
    const installedAgent = path.join(codexHome, "agents/information-accessibility-reviewer.toml");
    assertMirror(sourceSkill, installedSkill);
    assert.equal(sha256(installedAgent), sha256(sourceAgent));

    fs.appendFileSync(path.join(installedSkill, "SKILL.md"), "\nOLD INSTALL\n", "utf8");
    fs.writeFileSync(path.join(installedSkill, "stale.txt"), "old", "utf8");
    fs.appendFileSync(installedAgent, "\n# OLD INSTALL\n", "utf8");
    const backupRoot = path.join(temp, "explicit-backup");
    const second = run("powershell", [
      "-ExecutionPolicy", "Bypass", "-File", installer,
      "-CodexHome", codexHome,
      "-BackupRoot", backupRoot
    ]);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assertMirror(sourceSkill, installedSkill);
    assert.equal(sha256(installedAgent), sha256(sourceAgent));
    assert.equal(fs.existsSync(path.join(installedSkill, "stale.txt")), false);
    assert.equal(fs.readFileSync(path.join(backupRoot, "skill/stale.txt"), "utf8"), "old");
    assert.match(fs.readFileSync(path.join(backupRoot, "information-accessibility-reviewer.toml"), "utf8"), /OLD INSTALL/);

    const neutralCwd = path.join(temp, "neutral");
    fs.mkdirSync(neutralCwd);
    const auditFile = path.join(neutralCwd, "audit.json");
    const generator = path.join(installedSkill, "scripts/generate-assessment.mjs");
    const validator = path.join(installedSkill, "scripts/validate-assessment.mjs");
    const lookup = path.join(installedSkill, "scripts/show-requirement.mjs");

    const generated = run(process.execPath, [
      generator, "--profile", "web-modern", "--output", auditFile,
      "--target-name", "Installed audit smoke test",
      "--target-version", "1",
      "--target-ref", "https://example.invalid/",
      "--evaluator", "Smoke test",
      "--evaluated-at", "2026-07-13"
    ], neutralCwd);
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);
    const record = JSON.parse(fs.readFileSync(auditFile, "utf8"));
    assert.equal(record.assessment.results.length, 55);

    const validated = run(process.execPath, [validator, auditFile], neutralCwd);
    assert.equal(validated.status, 0, validated.stderr || validated.stdout);
    const validation = JSON.parse(validated.stdout);
    assert.equal(validation.guard.catalog_coverage.complete, true);
    assert.equal(validation.guard.evaluation_coverage.complete, false);

    const lookedUp = run(process.execPath, [
      lookup, "--profile", "web-modern", "--id", "WCAG-2.2-SC-2.1.1"
    ], neutralCwd);
    assert.equal(lookedUp.status, 0, lookedUp.stderr || lookedUp.stdout);
    const lookupResult = JSON.parse(lookedUp.stdout);
    assert.equal(lookupResult.audit_method.id, "keyboard-operation");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
