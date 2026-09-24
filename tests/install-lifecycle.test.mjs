import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function invoke(target, args) {
  const result = spawnSync(process.execPath, [path.join(root, `scripts/install-${target}.mjs`), ...args], {
    cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

for (const target of ["codex", "claude"]) {
  test(`${target} supports dry-run, clean install, upgrade, uninstall and restore`, () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-lifecycle-"));
    try {
      const home = path.join(temp, `${target}-home`);
      const homeArgs = [`--${target}-home`, home];
      const skill = path.join(home, "skills/information-accessibility-practice");
      const agentExt = target === "codex" ? ".toml" : ".md";
      const fixer = path.join(home, "agents", `information-accessibility-authorized-fixer${agentExt}`);
      const unrelated = path.join(home, "agents", "unrelated-agent.txt");

      const planned = invoke(target, [...homeArgs, "--dry-run"]);
      assert.equal(planned.status, "DRY_RUN");
      assert.equal(fs.existsSync(home), false);

      const installed = invoke(target, homeArgs);
      assert.equal(installed.status, "INSTALLED");
      assert.equal(installed.package_version, "0.1.0");
      assert.equal(fs.existsSync(fixer), false);
      fs.writeFileSync(unrelated, "keep me\n");

      const cli = spawnSync(process.execPath, [path.join(skill, "scripts/accessibility-audit.mjs"), "--version"], {
        cwd: temp, encoding: "utf8"
      });
      assert.equal(cli.status, 0, cli.stderr || cli.stdout);
      const doctor = spawnSync(process.execPath, [path.join(skill, "scripts/accessibility-audit.mjs"), "doctor", "--format", "json"], {
        cwd: temp, encoding: "utf8"
      });
      assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
      assert.equal(JSON.parse(doctor.stdout).package.root, skill);
      const nestedBackup = spawnSync(process.execPath, [
        path.join(root, `scripts/install-${target}.mjs`), ...homeArgs,
        "--upgrade", "--backup-root", path.join(home, "backups", "invalid"), "--dry-run"
      ], { cwd: root, encoding: "utf8" });
      assert.notEqual(nestedBackup.status, 0);
      assert.equal(fs.existsSync(path.join(skill, "SKILL.md")), true);

      const upgradeBackup = path.join(temp, "upgrade-backup");
      const upgradePlan = invoke(target, [...homeArgs, "--upgrade", "--include-authorized-fixer", "--backup-root", upgradeBackup, "--dry-run"]);
      assert.equal(upgradePlan.status, "DRY_RUN");
      assert.equal(fs.existsSync(upgradeBackup), false);
      const upgraded = invoke(target, [...homeArgs, "--upgrade", "--include-authorized-fixer", "--backup-root", upgradeBackup]);
      assert.equal(upgraded.status, "UPGRADED");
      assert.equal(fs.existsSync(fixer), true);
      assert.equal(fs.existsSync(path.join(upgradeBackup, "skill", "SKILL.md")), true);
      assert.equal(fs.readFileSync(unrelated, "utf8"), "keep me\n");

      const rollbackBackup = path.join(temp, "rollback-backup");
      const rolledBack = invoke(target, [...homeArgs, "--restore", upgradeBackup, "--backup-root", rollbackBackup]);
      assert.equal(rolledBack.status, "RESTORED");
      assert.equal(fs.existsSync(fixer), false);
      assert.equal(fs.existsSync(path.join(rollbackBackup, "agents", path.basename(fixer))), true);

      const uninstallBackup = path.join(temp, "uninstall-backup");
      const removed = invoke(target, [...homeArgs, "--uninstall", "--backup-root", uninstallBackup]);
      assert.equal(removed.status, "UNINSTALLED");
      assert.equal(fs.existsSync(skill), false);
      assert.equal(fs.existsSync(fixer), false);
      assert.equal(fs.existsSync(path.join(uninstallBackup, "skill", "SKILL.md")), true);
      assert.equal(fs.existsSync(path.join(uninstallBackup, "agents", `information-accessibility-reviewer${agentExt}`)), true);
      assert.equal(fs.readFileSync(unrelated, "utf8"), "keep me\n");

      const restored = invoke(target, [...homeArgs, "--restore", rollbackBackup, "--backup-root", path.join(temp, "restore-backup")]);
      assert.equal(restored.status, "RESTORED");
      assert.equal(fs.existsSync(path.join(skill, "SKILL.md")), true);
      assert.equal(fs.existsSync(fixer), true);
      assert.equal(fs.readFileSync(unrelated, "utf8"), "keep me\n");
    } finally {
      const resolved = fs.realpathSync(temp);
      assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
      assert.match(path.basename(resolved), /^a11y-lifecycle-/u);
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });
}
