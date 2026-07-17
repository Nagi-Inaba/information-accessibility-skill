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
const manifest = readJson("shared/agents/agent-manifest.json");
const defaultAgents = manifest.agents.filter((agent) => agent.install_by_default);

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8").replace(/^\uFEFF/u, ""));
}

function run(command, args, cwd = root, env = process.env) {
  return spawnSync(command, args, { cwd, encoding: "utf8", env });
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

function agentPath(codexHome, agent) {
  return path.join(codexHome, "agents", `${agent.id}.toml`);
}

function sourceAgentPath(agent) {
  return path.join(root, "codex", "agents", `${agent.id}.toml`);
}

function assertDefaultAgentsInstalled(codexHome) {
  for (const agent of defaultAgents) {
    assert.equal(sha256(agentPath(codexHome, agent)), sha256(sourceAgentPath(agent)), agent.id);
  }
}

function snapshotTree(base) {
  return new Map(relativeFiles(base).map((relative) => [relative, sha256(path.join(base, relative))]));
}

function stageResidues() {
  return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("information-accessibility-install-")).sort();
}

function createJunctionOrSkip(t, target, link) {
  try {
    fs.symlinkSync(target, link, "junction");
    return true;
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
      t.skip(`junction creation unavailable (${error.code}): ${error.message}`);
      return false;
    }
    throw error;
  }
}

function writeFaultWrapper(file) {
  const script = `
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$CodexHomePath,
    [Parameter(Mandatory = $true)][string]$BackupRootPath,
    [Parameter(Mandatory = $true)][string]$FailDestination
)
$ErrorActionPreference = 'Stop'
$script:InjectedMoveFailure = $false
function global:Move-Item {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string[]]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$Destination,
        [switch]$Force
    )
    $fullDestination = [IO.Path]::GetFullPath($Destination)
    if (-not $script:InjectedMoveFailure -and $fullDestination.Equals([IO.Path]::GetFullPath($FailDestination), [StringComparison]::OrdinalIgnoreCase)) {
        $script:InjectedMoveFailure = $true
        throw 'Injected test-only Move-Item failure after multiple replacements.'
    }
    Microsoft.PowerShell.Management\\Move-Item @PSBoundParameters
}
try {
    & $Installer -CodexHome $CodexHomePath -BackupRoot $BackupRootPath
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 23
}
`;
  fs.writeFileSync(file, script, "utf8");
}

test("Codex installer installs manifest defaults, preserves unrelated agents, and records per-agent backups", { skip: process.platform !== "win32" }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-codex-install-"));
  try {
    const whatIfHome = path.join(temp, "what-if-home");
    const whatIfBackup = path.join(temp, "what-if-backup");
    const whatIf = run("powershell", [
      "-ExecutionPolicy", "Bypass", "-File", installer,
      "-CodexHome", whatIfHome,
      "-BackupRoot", whatIfBackup,
      "-WhatIf"
    ]);
    assert.equal(whatIf.status, 0, whatIf.stderr || whatIf.stdout);
    assert.equal(fs.existsSync(whatIfHome), false);
    assert.equal(fs.existsSync(whatIfBackup), false);
    for (const agent of defaultAgents) {
      assert.match(whatIf.stdout, new RegExp(agent.id, "u"));
      assert.match(whatIf.stdout, new RegExp(`${agent.id}\\.toml`, "u"));
    }
    const fixerHome = path.join(temp, "fixer-home");
    const fixer = run("powershell", [
      "-ExecutionPolicy", "Bypass", "-File", installer,
      "-CodexHome", fixerHome,
      "-IncludeAuthorizedFixer",
      "-WhatIf"
    ]);
    assert.notEqual(fixer.status, 0);
    assert.match(fixer.stderr || fixer.stdout, /IncludeAuthorizedFixer[\s\S]*include it yet/i);
    assert.equal(fs.existsSync(fixerHome), false);

    const codexHome = path.join(temp, "partial-old-version");
    const installedSkill = path.join(codexHome, "skills/information-accessibility-practice");
    const unrelatedAgent = path.join(codexHome, "agents/user-owned.toml");
    fs.mkdirSync(installedSkill, { recursive: true });
    fs.writeFileSync(path.join(installedSkill, "SKILL.md"), "old skill\n", "utf8");
    fs.mkdirSync(path.dirname(unrelatedAgent), { recursive: true });
    fs.writeFileSync(unrelatedAgent, "user-owned\n", "utf8");
    const oldAgentIds = new Set([
      "information-accessibility-reviewer",
      "information-accessibility-remediation-planner"
    ]);
    for (const agent of defaultAgents.filter((entry) => oldAgentIds.has(entry.id))) {
      fs.writeFileSync(agentPath(codexHome, agent), `old ${agent.id}\n`, "utf8");
    }

    const backupRoot = path.join(temp, "partial-old-backup");
    const installed = run("powershell", [
      "-ExecutionPolicy", "Bypass", "-File", installer,
      "-CodexHome", codexHome,
      "-BackupRoot", backupRoot
    ]);
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    assertMirror(sourceSkill, installedSkill);
    assertDefaultAgentsInstalled(codexHome);
    assert.equal(fs.readFileSync(unrelatedAgent, "utf8"), "user-owned\n");
    assert.equal(fs.readFileSync(path.join(backupRoot, "skill", "SKILL.md"), "utf8"), "old skill\n");
    for (const agent of defaultAgents) {
      const backup = path.join(backupRoot, "agents", `${agent.id}.toml`);
      assert.equal(fs.existsSync(backup), oldAgentIds.has(agent.id), agent.id);
    }

    const neutralCwd = path.join(temp, "neutral");
    fs.mkdirSync(neutralCwd);
    const auditFile = path.join(neutralCwd, "audit.json");
    const generator = path.join(installedSkill, "scripts/generate-assessment.mjs");
    const validator = path.join(installedSkill, "scripts/validate-assessment.mjs");
    const generated = run(process.execPath, [
      generator, "--profile", "web-modern", "--output", auditFile,
      "--target-name", "Installed audit smoke test",
      "--target-version", "1",
      "--target-ref", "https://example.invalid/",
      "--evaluator", "Smoke test",
      "--evaluated-at", "2026-07-13"
    ], neutralCwd);
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);
    const validated = run(process.execPath, [validator, auditFile], neutralCwd);
    assert.equal(validated.status, 0, validated.stderr || validated.stdout);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("WhatIf rejects exact managed junction destinations without mutation", { skip: process.platform !== "win32" }, async (t) => {
  for (const kind of ["agent", "skill"]) {
    await t.test(kind, (subtest) => {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), `a11y-codex-install-${kind}-junction-`));
      const outside = path.join(temp, "outside");
      const codexHome = path.join(temp, "codex-home");
      const backupRoot = path.join(temp, "backup");
      const beforeStages = stageResidues();
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, "sentinel.txt"), `${kind} outside\n`, "utf8");
      const exactDestination = kind === "agent"
        ? path.join(codexHome, "agents", `${defaultAgents[0].id}.toml`)
        : path.join(codexHome, "skills", "information-accessibility-practice");
      fs.mkdirSync(path.dirname(exactDestination), { recursive: true });
      if (!createJunctionOrSkip(subtest, outside, exactDestination)) {
        fs.rmSync(temp, { recursive: true, force: true });
        return;
      }
      try {
        const result = run("powershell", [
          "-ExecutionPolicy", "Bypass", "-File", installer,
          "-CodexHome", codexHome,
          "-BackupRoot", backupRoot,
          "-WhatIf"
        ]);
        assert.notEqual(result.status, 0, result.stderr || result.stdout);
        assert.match(result.stderr || result.stdout, /unsafe|reparse|junction|symbolic/i);
        assert.equal(fs.existsSync(backupRoot), false);
        assert.equal(fs.readFileSync(path.join(outside, "sentinel.txt"), "utf8"), `${kind} outside\n`);
        assert.deepEqual(stageResidues(), beforeStages);
      } finally {
        if (fs.existsSync(exactDestination)) fs.unlinkSync(exactDestination);
        fs.rmSync(temp, { recursive: true, force: true });
      }
    });
  }
});

test("installer rejects a directory at an exact agent file destination before mutation", { skip: process.platform !== "win32" }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-codex-install-agent-directory-"));
  try {
    const codexHome = path.join(temp, "codex-home");
    const backupRoot = path.join(temp, "backup");
    const invalidAgent = agentPath(codexHome, defaultAgents[0]);
    fs.mkdirSync(invalidAgent, { recursive: true });
    fs.writeFileSync(path.join(invalidAgent, "sentinel.txt"), "must remain\n", "utf8");
    const beforeStages = stageResidues();
    const result = run("powershell", [
      "-ExecutionPolicy", "Bypass", "-File", installer,
      "-CodexHome", codexHome,
      "-BackupRoot", backupRoot
    ]);
    assert.notEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr || result.stdout, /agent destination.*file|not a file|leaf/i);
    assert.equal(fs.readFileSync(path.join(invalidAgent, "sentinel.txt"), "utf8"), "must remain\n");
    assert.equal(fs.existsSync(backupRoot), false);
    assert.deepEqual(stageResidues(), beforeStages);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("installer rejects package overlap case-insensitively without changing package bytes", { skip: process.platform !== "win32" }, async (t) => {
  const before = snapshotTree(root);
  const caseVariantRoot = root.replace(/^([A-Z]):/u, (_, drive) => `${drive.toLowerCase()}:`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-codex-install-overlap-"));
  try {
    const cases = [
      {
        name: "CodexHome inside package",
        codexHome: path.join(caseVariantRoot, "codex", "unsafe-install-home"),
        backupRoot: path.join(temp, "backup-one")
      },
      {
        name: "BackupRoot inside package",
        codexHome: path.join(temp, "codex-home-two"),
        backupRoot: path.join(caseVariantRoot, "unsafe-install-backup")
      },
      {
        name: "BackupRoot inside an agent source",
        codexHome: path.join(temp, "codex-home-three"),
        backupRoot: path.join(caseVariantRoot, "codex", "agents", "unsafe-install-backup")
      }
    ];
    for (const entry of cases) {
      await t.test(entry.name, () => {
        const result = run("powershell", [
          "-ExecutionPolicy", "Bypass", "-File", installer,
          "-CodexHome", entry.codexHome,
          "-BackupRoot", entry.backupRoot,
          "-WhatIf"
        ]);
        assert.notEqual(result.status, 0, result.stderr || result.stdout);
        assert.match(result.stderr || result.stdout, /overlap|disjoint|package/i);
        assert.equal(fs.existsSync(entry.codexHome), false);
        assert.equal(fs.existsSync(entry.backupRoot), false);
      });
    }
    assert.deepEqual(snapshotTree(root), before);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("Codex installer restores selected agents and the skill after a late replacement failure", { skip: process.platform !== "win32" }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-codex-install-rollback-"));
  try {
    const codexHome = path.join(temp, "codex-home");
    const installedSkill = path.join(codexHome, "skills/information-accessibility-practice");
    const unrelatedAgent = path.join(codexHome, "agents/user-owned.toml");
    fs.mkdirSync(installedSkill, { recursive: true });
    fs.writeFileSync(path.join(installedSkill, "SKILL.md"), "old skill\n", "utf8");
    fs.writeFileSync(path.join(installedSkill, "preserve.txt"), "old skill evidence\n", "utf8");
    fs.mkdirSync(path.dirname(unrelatedAgent), { recursive: true });
    fs.writeFileSync(unrelatedAgent, "user-owned\n", "utf8");

    const previousAgents = new Map();
    for (const agent of defaultAgents) {
      const bytes = Buffer.from(`old ${agent.id}\n`, "utf8");
      previousAgents.set(agent.id, bytes);
      fs.writeFileSync(agentPath(codexHome, agent), bytes);
    }
    const previousSkill = new Map(relativeFiles(installedSkill).map((relative) => [
      relative,
      fs.readFileSync(path.join(installedSkill, relative))
    ]));
    const backupRoot = path.join(temp, "rollback-backup");
    const wrapper = path.join(temp, "copy-fault-wrapper.ps1");
    writeFaultWrapper(wrapper);
    const failed = run("powershell", [
      "-ExecutionPolicy", "Bypass", "-File", wrapper,
      "-Installer", installer,
      "-CodexHomePath", codexHome,
      "-BackupRootPath", backupRoot,
      "-FailDestination", agentPath(codexHome, defaultAgents[2])
    ]);
    assert.notEqual(failed.status, 0, failed.stderr || failed.stdout);
    assert.match(failed.stderr || failed.stdout, /injected|rollback|failure/i);
    assert.deepEqual(relativeFiles(installedSkill), [...previousSkill.keys()].sort());
    for (const [relative, bytes] of previousSkill) {
      assert.deepEqual(fs.readFileSync(path.join(installedSkill, relative)), bytes, relative);
    }
    for (const agent of defaultAgents) {
      const destination = agentPath(codexHome, agent);
      assert.deepEqual(fs.readFileSync(destination), previousAgents.get(agent.id), agent.id);
    }
    assert.equal(fs.readFileSync(unrelatedAgent, "utf8"), "user-owned\n");
    assert.equal(fs.existsSync(path.join(backupRoot, "skill", "SKILL.md")), true);
    for (const agent of previousAgents.keys()) {
      const backup = path.join(backupRoot, "agents", `${agent}.toml`);
      assert.equal(fs.existsSync(backup), true, agent);
      assert.deepEqual(fs.readFileSync(backup), previousAgents.get(agent), agent);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
