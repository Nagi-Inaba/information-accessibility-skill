import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "scripts/install-claude.mjs");
const sourceSkill = path.join(root, "claude/skills/information-accessibility-practice");
const manifest = readJson(path.join(root, "shared/agents/agent-manifest.json"));
const defaultAgents = manifest.agents.filter((agent) => agent.install_by_default);
const reviewerAgent = defaultAgents.find((agent) => agent.id === "information-accessibility-reviewer");
const nonDefaultAgents = manifest.agents.filter((agent) => !agent.install_by_default);

assert.ok(reviewerAgent, "the reviewer must remain a manifest default");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
}

function run(command, args, cwd = root, env = process.env) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    maxBuffer: 64 * 1024 * 1024
  });
}

function runInstaller(args, env = process.env) {
  return run(process.execPath, [installer, ...args], root, env);
}

function parseOutput(result) {
  assert.notEqual(result.stdout.trim(), "", result.stderr);
  return JSON.parse(result.stdout);
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

function sourceAgentPath(agent) {
  return path.join(root, "claude/agents", agent.body_file);
}

function installedAgentPath(claudeHome, agent) {
  return path.join(claudeHome, "agents", agent.body_file);
}

function extractSection(document, startMarker, endMarker) {
  const start = document.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section start: ${startMarker}`);
  const end = document.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing section end: ${endMarker}`);
  return document.slice(start, end);
}

test("Claude installer dry-run selects manifest defaults without writing to CLAUDE_HOME", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-claude-dry-run-"));
  try {
    const claudeHome = path.join(temp, "not-created", "claude-home");
    const result = runInstaller(["--claude-home", claudeHome, "--dry-run"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(claudeHome), false);

    const output = parseOutput(result);
    assert.equal(output.status, "DRY_RUN");
    assert.equal(output.mode, "multi-agent");
    assert.equal(output.specialist_dispatch, "available");
    assert.equal(output.claude_home, path.resolve(claudeHome));
    assert.deepEqual(
      output.agents.map((agent) => agent.id),
      defaultAgents.map((agent) => agent.id)
    );
    for (const agent of defaultAgents) {
      const planned = output.agents.find((entry) => entry.id === agent.id);
      assert.equal(planned.source, sourceAgentPath(agent), agent.id);
      assert.equal(planned.destination, installedAgentPath(path.resolve(claudeHome), agent), agent.id);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("Claude installer performs a clean manifest-driven install and the installed skill works", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-claude-install-"));
  try {
    const claudeHome = path.join(temp, "claude-home");
    const result = runInstaller(["--claude-home", claudeHome]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = parseOutput(result);
    assert.equal(output.status, "INSTALLED");
    assert.equal(output.mode, "multi-agent");
    assert.equal(output.specialist_dispatch, "available");

    const installedSkill = path.join(claudeHome, "skills/information-accessibility-practice");
    assertMirror(sourceSkill, installedSkill);
    for (const agent of defaultAgents) {
      assert.equal(sha256(installedAgentPath(claudeHome, agent)), sha256(sourceAgentPath(agent)), agent.id);
    }
    for (const agent of nonDefaultAgents) {
      assert.equal(fs.existsSync(installedAgentPath(claudeHome, agent)), false, agent.id);
    }

    const neutralCwd = path.join(temp, "neutral");
    fs.mkdirSync(neutralCwd);
    const assessment = path.join(neutralCwd, "assessment.json");
    const generated = run(process.execPath, [
      path.join(installedSkill, "scripts/generate-assessment.mjs"),
      "--profile", "web-modern",
      "--target-name", "Claude clean-install smoke test",
      "--target-version", "1",
      "--target-ref", "https://example.invalid/",
      "--evaluator", "Smoke test",
      "--evaluated-at", "2026-08-23",
      "--output", assessment
    ], neutralCwd);
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);

    const validated = run(
      process.execPath,
      [path.join(installedSkill, "scripts/validate-assessment.mjs"), assessment],
      neutralCwd
    );
    assert.equal(validated.status, 0, validated.stderr || validated.stdout);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("reviewer-only mode is an explicit local-fallback installation", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-claude-reviewer-only-"));
  try {
    const claudeHome = path.join(temp, "claude-home");
    const result = runInstaller(["--claude-home", claudeHome, "--reviewer-only"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = parseOutput(result);
    assert.equal(output.status, "INSTALLED");
    assert.equal(output.mode, "reviewer-only");
    assert.equal(output.specialist_dispatch, "local-fallback-only");
    assert.deepEqual(output.agents.map((agent) => agent.id), [reviewerAgent.id]);
    assert.equal(
      sha256(installedAgentPath(claudeHome, reviewerAgent)),
      sha256(sourceAgentPath(reviewerAgent))
    );
    for (const agent of defaultAgents.filter((entry) => entry.id !== reviewerAgent.id)) {
      assert.equal(fs.existsSync(installedAgentPath(claudeHome, agent)), false, agent.id);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("Claude installer rejects managed destination conflicts before writing any other target", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-claude-conflict-"));
  try {
    const claudeHome = path.join(temp, "claude-home");
    const existingAgent = installedAgentPath(claudeHome, reviewerAgent);
    fs.mkdirSync(path.dirname(existingAgent), { recursive: true });
    fs.writeFileSync(existingAgent, "user-owned reviewer\n", "utf8");

    const result = runInstaller(["--claude-home", claudeHome]);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /Installation conflict/u);
    assert.equal(fs.readFileSync(existingAgent, "utf8"), "user-owned reviewer\n");
    assert.equal(fs.existsSync(path.join(claudeHome, "skills/information-accessibility-practice")), false);
    for (const agent of defaultAgents.filter((entry) => entry.id !== reviewerAgent.id)) {
      assert.equal(fs.existsSync(installedAgentPath(claudeHome, agent)), false, agent.id);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("Japanese and English Claude instructions stay aligned with manifest defaults and fallback boundaries", () => {
  const japanese = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const english = fs.readFileSync(path.join(root, "README.en.md"), "utf8");
  const japaneseClaude = extractSection(japanese, "Claude で使う場合:", "\n## 対象別の確認範囲");
  const englishClaude = extractSection(english, "For Claude:", "\n## Detailed review coverage");

  for (const section of [japaneseClaude, englishClaude]) {
    assert.match(section, /install-claude\.mjs/u);
    assert.match(section, /install_by_default/u);
    assert.match(section, /--reviewer-only/u);
    for (const agent of defaultAgents) {
      assert.match(section, new RegExp(`\\`${agent.id}\\``, "u"), agent.id);
    }
  }

  assert.match(japaneseClaude, /specialist agentをdispatchできない場合だけ/u);
  assert.match(japaneseClaude, /同じrole artifact contract/u);
  assert.match(englishClaude, /only when the Claude host cannot dispatch specialist agents/iu);
  assert.match(englishClaude, /same role artifact contract/iu);
});
