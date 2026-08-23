#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const manifestPath = path.join(root, "shared/agents/agent-manifest.json");
const sourceSkill = path.join(root, "claude/skills/information-accessibility-practice");
const sourceAgents = path.join(root, "claude/agents");
const reviewerId = "information-accessibility-reviewer";

function pathExists(candidate) {
  try {
    fs.lstatSync(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.agents)) {
    throw new Error("Invalid agent manifest: agents must be an array.");
  }

  const ids = new Set();
  const bodyFiles = new Set();
  for (const agent of manifest.agents) {
    if (!agent || typeof agent !== "object") {
      throw new Error("Invalid agent manifest: every agent must be an object.");
    }
    if (typeof agent.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(agent.id)) {
      throw new Error(`Invalid agent manifest ID: ${String(agent.id)}`);
    }
    if (ids.has(agent.id)) throw new Error(`Duplicate agent manifest ID: ${agent.id}`);
    ids.add(agent.id);

    if (
      typeof agent.body_file !== "string" ||
      path.basename(agent.body_file) !== agent.body_file ||
      !agent.body_file.endsWith(".md")
    ) {
      throw new Error(`Invalid Claude agent body_file for ${agent.id}: ${String(agent.body_file)}`);
    }
    if (bodyFiles.has(agent.body_file)) {
      throw new Error(`Duplicate Claude agent body_file: ${agent.body_file}`);
    }
    bodyFiles.add(agent.body_file);

    if (typeof agent.install_by_default !== "boolean") {
      throw new Error(`Invalid install_by_default value for ${agent.id}`);
    }
    if (!agent.claude || typeof agent.claude !== "object") {
      throw new Error(`Missing Claude configuration for ${agent.id}`);
    }
  }

  const defaults = manifest.agents.filter((agent) => agent.install_by_default);
  if (defaults.length === 0) throw new Error("Invalid agent manifest: no default agents are configured.");
  const reviewer = defaults.find((agent) => agent.id === reviewerId);
  if (!reviewer) throw new Error(`Invalid agent manifest: ${reviewerId} must be installed by default.`);

  return { defaults, reviewer };
}

function parseArgs(argv) {
  const options = {
    claudeHome: null,
    dryRun: false,
    reviewerOnly: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--reviewer-only") {
      options.reviewerOnly = true;
      continue;
    }
    if (argument === "--claude-home") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --claude-home.");
      if (options.claudeHome !== null) throw new Error("--claude-home may be specified only once.");
      options.claudeHome = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function usage() {
  return [
    "Usage: node scripts/install-claude.mjs [options]",
    "",
    "Options:",
    "  --claude-home <path>  Install under this Claude home directory.",
    "  --dry-run             Validate and print the installation plan without writing files.",
    "  --reviewer-only       Install only the reviewer for hosts without specialist dispatch.",
    "  --help, -h            Show this help.",
    "",
    "Claude home resolution: --claude-home, then CLAUDE_HOME, then ~/.claude.",
    "Existing managed destinations are never overwritten."
  ].join("\n");
}

function resolveClaudeHome(options) {
  const configured = options.claudeHome ?? process.env.CLAUDE_HOME;
  return path.resolve(configured || path.join(os.homedir(), ".claude"));
}

function assertSourceDirectory(directory) {
  const stat = fs.statSync(directory);
  if (!stat.isDirectory()) throw new Error(`Expected source directory: ${directory}`);
}

function assertSourceFile(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`Expected source file: ${filePath}`);
}

function buildPlan(options) {
  const manifest = readJson(manifestPath);
  const { defaults, reviewer } = validateManifest(manifest);
  const claudeHome = resolveClaudeHome(options);
  const selectedAgents = options.reviewerOnly ? [reviewer] : defaults;
  const skillDestination = path.join(claudeHome, "skills/information-accessibility-practice");
  const agents = selectedAgents.map((agent) => ({
    id: agent.id,
    source: path.join(sourceAgents, agent.body_file),
    destination: path.join(claudeHome, "agents", agent.body_file)
  }));

  assertSourceDirectory(sourceSkill);
  for (const agent of agents) assertSourceFile(agent.source);

  const destinations = [skillDestination, ...agents.map((agent) => agent.destination)];
  const conflicts = destinations.filter(pathExists);
  if (conflicts.length > 0) {
    throw new Error(`Installation conflict: managed destination already exists: ${conflicts.join(", ")}`);
  }

  return {
    status: options.dryRun ? "DRY_RUN" : "INSTALLED",
    mode: options.reviewerOnly ? "reviewer-only" : "multi-agent",
    specialist_dispatch: options.reviewerOnly ? "local-fallback-only" : "available",
    claude_home: claudeHome,
    skill: {
      source: sourceSkill,
      destination: skillDestination
    },
    agents
  };
}

function nearestExistingDirectory(candidate) {
  let current = path.resolve(candidate);
  while (!pathExists(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Could not resolve an existing staging parent for: ${candidate}`);
    current = parent;
  }
  const stat = fs.statSync(current);
  if (!stat.isDirectory()) throw new Error(`Staging parent is not a directory: ${current}`);
  return current;
}

function ensureDirectory(directory, createdDirectories) {
  const missing = [];
  let current = path.resolve(directory);
  while (!pathExists(current)) {
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Could not create directory hierarchy: ${directory}`);
    current = parent;
  }
  if (!fs.statSync(current).isDirectory()) {
    throw new Error(`Directory parent is not a directory: ${current}`);
  }
  for (const item of missing.reverse()) {
    fs.mkdirSync(item);
    createdDirectories.push(item);
  }
}

function removeEmptyDirectories(directories) {
  for (const directory of [...directories].reverse()) {
    try {
      fs.rmdirSync(directory);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error;
    }
  }
}

function install(plan) {
  const stagingParent = nearestExistingDirectory(path.dirname(plan.claude_home));
  const stagingRoot = fs.mkdtempSync(path.join(stagingParent, ".information-accessibility-claude-install-"));
  const stagedSkill = path.join(stagingRoot, "skill");
  const stagedAgentsDirectory = path.join(stagingRoot, "agents");
  const activatedPaths = [];
  const createdDirectories = [];

  try {
    fs.cpSync(plan.skill.source, stagedSkill, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false
    });
    fs.mkdirSync(stagedAgentsDirectory);
    for (const agent of plan.agents) {
      fs.copyFileSync(agent.source, path.join(stagedAgentsDirectory, path.basename(agent.destination)));
    }

    ensureDirectory(path.dirname(plan.skill.destination), createdDirectories);
    ensureDirectory(path.dirname(plan.agents[0].destination), createdDirectories);

    fs.renameSync(stagedSkill, plan.skill.destination);
    activatedPaths.push(plan.skill.destination);

    for (const agent of plan.agents) {
      const stagedAgent = path.join(stagedAgentsDirectory, path.basename(agent.destination));
      fs.renameSync(stagedAgent, agent.destination);
      activatedPaths.push(agent.destination);
    }
  } catch (error) {
    for (const activatedPath of activatedPaths.reverse()) {
      fs.rmSync(activatedPath, { recursive: true, force: true });
    }
    removeEmptyDirectories(createdDirectories);
    throw error;
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const plan = buildPlan(options);
  if (!options.dryRun) install(plan);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
