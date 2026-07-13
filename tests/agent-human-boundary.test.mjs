import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function normalize(text) {
  return text.replace(/\r\n/g, "\n").trim();
}

function codexReviewerBody(text) {
  return text.match(/developer_instructions = """\r?\n(?<body>[\s\S]*?)\r?\n"""/)?.groups?.body;
}

function claudeReviewerBody(text) {
  return text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n(?<body>[\s\S]*)$/)?.groups?.body;
}

function assertAiHumanBoundary(text, artifact) {
  assert.match(text, /The AI agent is not the human reviewer\./, `${artifact} must distinguish the AI agent from the human reviewer`);
  assert.match(text, /remain at evidence level `E0` or `E1`/, `${artifact} must keep agent-created records at E0/E1`);
  assert.match(text, /`mapping_status: "unverified"`/, `${artifact} must preserve unverified profile-row mapping status`);
  assert.match(text, /`outcome: "not_tested"`/, `${artifact} must preserve not_tested profile-row outcome`);
  assert.match(text, /`SCREEN-\*` screening evidence or unverified draft evidence/, `${artifact} must keep AI observations as screening or drafts`);
  assert.match(text, /must not record `pass`, `fail`, or `not_applicable` on profile rows/, `${artifact} must prohibit AI profile-row outcomes`);
  assert.match(text, /must not set or change `human_verified`, `E2` or higher/, `${artifact} must prohibit AI elevation to human-verified or E2+`);
  assert.match(text, /separate external human review workflow[^]*record profile requirement outcomes[^]*named criterion procedure[^]*target-specific manual or hybrid evidence/, `${artifact} must reserve profile outcomes for a procedure-led external human review`);
  assert.match(text, /target-specific manual or hybrid evidence/, `${artifact} must require target-specific manual or hybrid evidence for E2`);
  assert.match(text, /cannot prove a reviewer's human identity/, `${artifact} must not misrepresent schema or validator identity checks`);
  assert.doesNotMatch(text, /Record each applicable requirement as `pass`, `fail`, `not_applicable`, `not_tested`, or `cant_tell`\./, `${artifact} must not use the old unconditional profile-outcome imperative`);
  assert.doesNotMatch(text, /Record pass, fail, not_applicable, not_tested, or cant_tell with location-specific evidence/, `${artifact} must not use the old unconditional agent profile-outcome imperative`);
}

test("AI reviewer prompt contract preserves the agent-to-human evidence boundary", () => {
  const codexBody = codexReviewerBody(read("codex/agents/information-accessibility-reviewer.toml"));
  const claudeBody = claudeReviewerBody(read("claude/agents/information-accessibility-reviewer.md"));

  assert.ok(codexBody, "Codex reviewer body must be extractable");
  assert.ok(claudeBody, "Claude reviewer body must be extractable");
  assert.equal(normalize(codexBody), normalize(claudeBody), "Codex and Claude reviewer bodies must remain normalized-equal");
  assertAiHumanBoundary(codexBody, "reviewer instructions");
});

test("shared skill prompt contract preserves the agent-to-human evidence boundary", () => {
  const codexSkill = read("codex/skills/information-accessibility-practice/SKILL.md");
  const claudeSkill = read("claude/skills/information-accessibility-practice/SKILL.md");

  assert.deepEqual(Buffer.from(codexSkill), Buffer.from(claudeSkill), "Codex and Claude SKILL.md files must remain byte-for-byte equal");
  assertAiHumanBoundary(codexSkill, "shared skill instructions");
});

test("README reserves profile outcomes for external human review and keeps AI output as a handoff", () => {
  const readme = read("README.md");

  assert.match(readme, /AIエージェントが作成または更新するプロファイル要件行は[^]*`mapping_status: "unverified"`[^]*`outcome: "not_tested"`/, "README must keep AI-owned profile rows unverified and not_tested");
  assert.match(readme, /外部の人手レビュー[^]*対象固有の手動またはハイブリッド証拠[^]*`pass`[^]*`fail`/, "README must reserve profile outcomes for procedure-led external human review");
  assert.match(readme, /`SCREEN-\*`[^]*未検証の引き継ぎ/, "README must describe AI output as screening or an unverified handoff");
  assert.doesNotMatch(readme, /実物を検査し、各行を `pass \/ fail \/ not_applicable \/ not_tested \/ cant_tell` のいずれかにし/, "README must not issue an unconditional profile-outcome imperative");
  assert.doesNotMatch(readme, /条項結果を `pass \/ fail \/ not_applicable \/ not_tested \/ cant_tell` で記録する。/, "README must not make an unqualified profile-outcome claim");
});
