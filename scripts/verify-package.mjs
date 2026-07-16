import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateStandardsRegistry } from "../codex/skills/information-accessibility-practice/scripts/lib/profile-registry.mjs";
import { buildDistribution } from "./sync-distributions.mjs";

const defaultRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function walk(base, current = base) {
  return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(current, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? walk(base, full) : [path.relative(base, full).split(path.sep).join("/")];
  }).sort();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
}

export function verifyPackage(root = defaultRoot) {
  const packageRoot = path.resolve(root);
  const distribution = buildDistribution(packageRoot, { write: false });
  const errors = [...distribution.errors];
  const jsonFiles = distribution.status === "PASS"
    ? walk(packageRoot).map((file) => path.join(packageRoot, ...file.split("/"))).filter((file) => file.endsWith(".json"))
    : [];

  for (const file of jsonFiles) {
    try {
      readJson(file);
    } catch (error) {
      errors.push(`Invalid JSON: ${file} - ${error.message}`);
    }
  }

  const registryPath = path.join(
    packageRoot,
    "codex",
    "skills",
    "information-accessibility-practice",
    "references",
    "standards-registry.json"
  );
  try {
    const registryValidation = validateStandardsRegistry(readJson(registryPath));
    errors.push(...registryValidation.errors.map((error) => `Invalid standards registry: ${error}`));
  } catch (error) {
    errors.push(`Could not validate standards registry: ${registryPath} - ${error.message}`);
  }

  const agentResults = distribution.agents;
  return {
    shared_skill_files: distribution.shared_skill_files,
    json_files_parsed: jsonFiles.length,
    agent_bodies_equal: agentResults.length > 0 && agentResults.every((item) => item.bodies_equal),
    agent_count: agentResults.length,
    default_agent_count: distribution.default_agent_count,
    agents: agentResults,
    status: errors.length ? "FAIL" : "PASS",
    errors
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const result = verifyPackage();
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
}
