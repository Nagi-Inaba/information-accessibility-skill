import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildInstallPlan, resolveRuntimeTargets } from "../scripts/install-skill.mjs";

test("Codex and Claude targets are platform independent and explicit", () => {
  const home = path.join(os.tmpdir(), "a11y-home");
  const codex = resolveRuntimeTargets({ runtime: "codex", home });
  const claude = resolveRuntimeTargets({ runtime: "claude", home });
  assert.match(codex.skill, /\.codex[/\\]skills[/\\]information-accessibility-practice$/u);
  assert.match(claude.skill, /\.claude[/\\]skills[/\\]information-accessibility-practice$/u);
  assert.equal(codex.agents.length, 4);
  assert.equal(claude.agents.length, 4);
});

test("upgrade plans include backup, pinned version, and no implicit mutation", () => {
  const plan = buildInstallPlan({
    runtime: "codex",
    home: "/tmp/example-home",
    operation: "upgrade",
    version: "v0.2.0",
    existing: { skill: true, agents: ["information-accessibility-reviewer"] }
  });
  assert.equal(plan.operation, "upgrade");
  assert.equal(plan.version, "v0.2.0");
  assert.equal(plan.execution, "dry_run_only");
  assert.ok(plan.actions.some((action) => action.action === "backup"));
  assert.ok(plan.actions.some((action) => action.action === "copy_skill"));
});

test("uninstall plans remove only managed skill and default agent targets", () => {
  const plan = buildInstallPlan({
    runtime: "claude",
    home: "/tmp/example-home",
    operation: "uninstall",
    version: "v0.1.0"
  });
  assert.ok(plan.actions.every((action) => action.action.startsWith("remove_")));
  assert.equal(plan.actions.filter((action) => action.action === "remove_agent").length, 4);
});
