import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function runNode(relativePath, args = []) {
  return spawnSync(process.execPath, [path.join(root, relativePath), ...args], {
    cwd: root,
    encoding: "utf8"
  });
}

test("distribution sync renders every manifest agent for Codex and Claude", () => {
  const manifest = readJson("shared/agents/agent-manifest.json");
  const check = runNode("scripts/sync-distributions.mjs", ["--check"]);
  assert.equal(check.status, 0, check.stderr || check.stdout);
  for (const agent of manifest.agents) {
    assert.equal(fs.existsSync(path.join(root, "codex/agents", `${agent.id}.toml`)), true);
    assert.equal(fs.existsSync(path.join(root, "claude/agents", `${agent.id}.md`)), true);
  }
});

test("package verification reports manifest-derived agent counts", () => {
  const manifest = readJson("shared/agents/agent-manifest.json");
  const verification = runNode("scripts/verify-package.mjs");
  assert.equal(verification.status, 0, verification.stderr || verification.stdout);
  const result = JSON.parse(verification.stdout);
  assert.equal(result.agent_count, manifest.agents.length);
  assert.equal(result.default_agent_count, manifest.agents.filter((agent) => agent.install_by_default).length);
  assert.equal(result.agents.length, manifest.agents.length);
});
