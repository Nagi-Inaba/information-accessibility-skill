import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const codexSkill = path.join(root, "codex", "skills", "information-accessibility-practice");
const claudeSkill = path.join(root, "claude", "skills", "information-accessibility-practice");
const errors = [];

function walk(base, current = base) {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(current, entry.name);
    return entry.isDirectory() ? walk(base, full) : [path.relative(base, full).split(path.sep).join("/")];
  }).sort();
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function normalize(text) {
  return text.replace(/(?:\r\n|\r|\n)$/, "").replace(/\r\n?/g, "\n");
}

const codexFiles = walk(codexSkill).filter((file) => file !== "agents/openai.yaml");
const claudeFiles = walk(claudeSkill);
for (const file of codexFiles.filter((item) => !claudeFiles.includes(item))) errors.push(`Missing from Claude skill: ${file}`);
for (const file of claudeFiles.filter((item) => !codexFiles.includes(item))) errors.push(`Missing from Codex skill: ${file}`);
const commonFiles = codexFiles.filter((file) => claudeFiles.includes(file));
for (const file of commonFiles) {
  if (sha256(path.join(codexSkill, file)) !== sha256(path.join(claudeSkill, file))) errors.push(`Content mismatch: ${file}`);
}

const allFiles = walk(root).map((file) => path.join(root, ...file.split("/")));
const jsonFiles = allFiles.filter((file) => file.endsWith(".json"));
for (const file of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    errors.push(`Invalid JSON: ${file} - ${error.message}`);
  }
}

let manifest = { agents: [] };
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, "shared", "agents", "agent-manifest.json"), "utf8").replace(/^\uFEFF/, ""));
} catch (error) {
  errors.push(`Could not read agent manifest: ${error.message}`);
}

const agentResults = [];
for (const agent of manifest.agents ?? []) {
  const result = { id: agent.id, bodies_equal: false };
  const codexFile = path.join(root, "codex", "agents", `${agent.id}.toml`);
  const claudeFile = path.join(root, "claude", "agents", `${agent.id}.md`);
  const sharedFile = path.join(root, "shared", "agents", agent.body_file);
  let codexAgent;
  let claudeAgent;
  let sharedBody;
  try {
    codexAgent = fs.readFileSync(codexFile, "utf8");
    claudeAgent = fs.readFileSync(claudeFile, "utf8");
    sharedBody = fs.readFileSync(sharedFile, "utf8");
  } catch (error) {
    errors.push(`Could not read generated files for ${agent.id}: ${error.message}`);
    agentResults.push(result);
    continue;
  }

  const codexMatch = codexAgent.match(/developer_instructions = """\r?\n(?<body>[\s\S]*?)\r?\n"""/);
  const claudeMatch = claudeAgent.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n(?<body>[\s\S]*)$/);
  if (!codexMatch?.groups?.body) errors.push(`Could not extract Codex developer_instructions for ${agent.id}.`);
  else if (!claudeMatch?.groups?.body) errors.push(`Could not extract Claude agent body for ${agent.id}.`);
  else {
    const normalizedShared = normalize(sharedBody);
    result.bodies_equal = normalize(codexMatch.groups.body) === normalizedShared && normalize(claudeMatch.groups.body) === normalizedShared;
    if (!result.bodies_equal) errors.push(`Generated agent instruction bodies differ from the shared source for ${agent.id}.`);
  }
  agentResults.push(result);
}

const result = {
  shared_skill_files: commonFiles.length,
  json_files_parsed: jsonFiles.length,
  agent_bodies_equal: agentResults.every((item) => item.bodies_equal),
  agent_count: agentResults.length,
  default_agent_count: (manifest.agents ?? []).filter((item) => item.install_by_default).length,
  agents: agentResults,
  status: errors.length ? "FAIL" : "PASS",
  errors
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
