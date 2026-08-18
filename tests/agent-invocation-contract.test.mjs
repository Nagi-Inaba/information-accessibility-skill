import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedAgent = path.join(root, "shared", "agents", "information-accessibility-reviewer.md");
const codexAgent = path.join(root, "codex", "agents", "information-accessibility-reviewer.toml");
const claudeAgent = path.join(root, "claude", "agents", "information-accessibility-reviewer.md");
const codexTemplate = path.join(root, "codex", "skills", "information-accessibility-practice", "assets", "development-web-audit-request.template.md");
const claudeTemplate = path.join(root, "claude", "skills", "information-accessibility-practice", "assets", "development-web-audit-request.template.md");
const codexSkill = path.join(root, "codex", "skills", "information-accessibility-practice", "SKILL.md");
const claudeSkill = path.join(root, "claude", "skills", "information-accessibility-practice", "SKILL.md");
const codexPrompt = path.join(root, "codex", "skills", "information-accessibility-practice", "agents", "openai.yaml");
const readme = path.join(root, "README.md");

function read(file) {
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}

test("short Web requests enter the versioned standards-aware audit path", () => {
  const sources = [read(sharedAgent), read(codexAgent), read(claudeAgent)];

  for (const text of sources) {
    assert.match(text, /## Short Web Request Contract/);
    assert.match(text, /versioned audit run/);
    assert.match(text, /safe read-only/);
    assert.match(text, /Do not (?:authenticate|require it)/);
  }
});

test("development-site request template is mirrored and captures safe audit inputs", () => {
  assert.equal(fs.existsSync(codexTemplate), true);
  assert.equal(fs.existsSync(claudeTemplate), true);
  const codex = read(codexTemplate);
  const claude = read(claudeTemplate);

  assert.equal(codex, claude);
  for (const placeholder of ["<TARGET_URL_OR_PATH>", "<PROFILE>", "<INCLUDED_SCOPE>", "<EXCLUDED_SCOPE>", "<PERMITTED_OPERATIONS>", "<VERIFICATION_COMMANDS>", "<OUTPUT_DIRECTORY>"]) {
    assert.match(codex, new RegExp(placeholder.replace(/[<>]/g, "\\$&")));
  }
});

test("skill and default prompt preserve the AI-to-human evidence boundary", () => {
  const codex = read(codexSkill);
  const claude = read(claudeSkill);
  const prompt = read(codexPrompt);

  assert.equal(codex, claude);
  for (const text of [codex, prompt]) {
    assert.match(text, /mapping_status: "unverified"|unverified/);
    assert.match(text, /outcome: "not_tested"|not_tested/);
    assert.match(text, /E0\/E1|E0 or E1/);
  }
});

test("a short Web inspection request defaults to a complete WCAG report projection", () => {
  const sources = [
    read(sharedAgent),
    read(codexAgent),
    read(claudeAgent),
    read(codexSkill),
    read(claudeSkill),
    read(codexPrompt),
  ];

  for (const text of sources) {
    assert.match(text, /web-modern/);
    assert.match(text, /55/);
    assert.match(text, /not_tested/);
    assert.match(text, /適合/);
    assert.match(text, /不適合/);
    assert.match(text, /要確認/);
    assert.match(text, /未確認/);
    assert.match(text, /not_applicable/);
  }

  for (const text of [read(sharedAgent), read(codexAgent), read(claudeAgent), read(codexSkill), read(claudeSkill)]) {
    assert.match(text, /initialization, not (?:a )?(?:completed inspection|completion)/);
    assert.match(text, /zero omitted requirements/);
    assert.match(text, /(?:optional|Do not make it a prerequisite|Do not require it)/);
  }

  const readmeText = read(readme);
  assert.match(readmeText, /このサイトの最初の画面を、アクセシビリティCLIで検査して。/);
  assert.match(readmeText, /全55項目/);
  assert.match(readmeText, /初期台帳を作っただけでは完了としない/);
});
