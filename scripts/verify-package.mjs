import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildDistribution } from "./sync-distributions.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function walk(base, current = base) {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(current, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? walk(base, full) : [path.relative(base, full).split(path.sep).join("/")];
  }).sort();
}

const distribution = buildDistribution(root, { write: false });
const errors = [...distribution.errors];
const jsonFiles = distribution.status === "PASS"
  ? walk(root).map((file) => path.join(root, ...file.split("/"))).filter((file) => file.endsWith(".json"))
  : [];

for (const file of jsonFiles) {
  try {
    JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
  } catch (error) {
    errors.push(`Invalid JSON: ${file} - ${error.message}`);
  }
}

const agentResults = distribution.agents;
const result = {
  shared_skill_files: distribution.shared_skill_files,
  json_files_parsed: jsonFiles.length,
  agent_bodies_equal: agentResults.length > 0 && agentResults.every((item) => item.bodies_equal),
  agent_count: agentResults.length,
  default_agent_count: distribution.default_agent_count,
  agents: agentResults,
  status: errors.length ? "FAIL" : "PASS",
  errors
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
