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
  return text.replace(/\r\n/g, "\n").trim();
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

const codexAgent = fs.readFileSync(path.join(root, "codex", "agents", "information-accessibility-reviewer.toml"), "utf8");
const claudeAgent = fs.readFileSync(path.join(root, "claude", "agents", "information-accessibility-reviewer.md"), "utf8");
const codexMatch = codexAgent.match(/developer_instructions = """\r?\n(?<body>[\s\S]*?)\r?\n"""/);
const claudeMatch = claudeAgent.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n(?<body>[\s\S]*)$/);
if (!codexMatch?.groups?.body) errors.push("Could not extract Codex developer_instructions.");
else if (!claudeMatch?.groups?.body) errors.push("Could not extract Claude agent body.");
else if (normalize(codexMatch.groups.body) !== normalize(claudeMatch.groups.body)) errors.push("Codex and Claude agent instruction bodies differ.");

const result = {
  shared_skill_files: commonFiles.length,
  json_files_parsed: jsonFiles.length,
  agent_bodies_equal: Boolean(codexMatch?.groups?.body && claudeMatch?.groups?.body && normalize(codexMatch.groups.body) === normalize(claudeMatch.groups.body)),
  status: errors.length ? "FAIL" : "PASS",
  errors
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
