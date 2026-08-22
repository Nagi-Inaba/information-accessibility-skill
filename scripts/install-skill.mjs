#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const defaultAgents = Object.freeze([
  "information-accessibility-reviewer",
  "information-accessibility-e1-inspector",
  "information-accessibility-human-queue-planner",
  "information-accessibility-remediation-planner"
]);

export function resolveRuntimeTargets({ runtime, home }) {
  if (!["codex", "claude"].includes(runtime)) throw new Error("runtime must be codex or claude");
  if (typeof home !== "string" || !home) throw new Error("home is required");
  const root = path.join(path.resolve(home), runtime === "codex" ? ".codex" : ".claude");
  return {
    runtime,
    skill: path.join(root, "skills", "information-accessibility-practice"),
    agents: defaultAgents.map((agent) => path.join(root, "agents", runtime === "codex" ? `${agent}.toml` : `${agent}.md`))
  };
}

export function buildInstallPlan({ runtime, home, operation = "install", version, existing = {} }) {
  if (!["install", "upgrade", "uninstall"].includes(operation)) throw new Error("operation must be install, upgrade, or uninstall");
  if (typeof version !== "string" || !version.trim()) throw new Error("A pinned version is required");
  const targets = resolveRuntimeTargets({ runtime, home });
  const actions = [];
  if (operation === "uninstall") {
    actions.push({ action: "remove_skill", target: targets.skill });
    actions.push(...targets.agents.map((target) => ({ action: "remove_agent", target })));
  } else {
    if (operation === "upgrade" && existing.skill) {
      actions.push({ action: "backup", target: targets.skill, backup: `${targets.skill}.backup-${version}` });
    }
    actions.push({ action: "copy_skill", target: targets.skill, version });
    actions.push(...targets.agents.map((target) => ({ action: "copy_agent", target, version })));
  }
  return {
    schema_version: "1.0.0",
    operation,
    runtime,
    version,
    targets,
    actions,
    execution: "dry_run_only",
    note: "This plan makes no filesystem changes. A later executor must verify source hashes, existing paths, backup completion, and rollback."
  };
}

function parseArgs(argv) {
  const options = { operation: "install", home: process.env.HOME };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") continue;
    if (!["--runtime", "--operation", "--version", "--home"].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2)] = value;
    index += 1;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(buildInstallPlan(options), null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
