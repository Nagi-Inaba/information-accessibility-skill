#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyPackage } from "./verify-package.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const manifestPath = path.join(root, "shared/agents/agent-manifest.json");
const featurePath = path.join(root, "shared/agents/authorized-fixer-feature.json");
const reviewerId = "information-accessibility-reviewer";
const fixerId = "information-accessibility-authorized-fixer";

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

function parseArgs(argv, target = "claude") {
  const options = {
    target,
    home: null,
    backupRoot: null,
    restoreRoot: null,
    dryRun: false,
    upgrade: false,
    uninstall: false,
    reviewerOnly: false,
    includeAuthorizedFixer: false,
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
    if (argument === "--upgrade" || argument === "--uninstall") {
      options[argument.slice(2)] = true;
      continue;
    }
    if (argument === "--reviewer-only") {
      options.reviewerOnly = true;
      continue;
    }
    if (argument === "--include-authorized-fixer") {
      options.includeAuthorizedFixer = true;
      continue;
    }
    if (argument === "--backup-root" || argument === "--restore" || argument === (target === "codex" ? "--codex-home" : "--claude-home")) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
      const key = argument === "--backup-root" ? "backupRoot" : argument === "--restore" ? "restoreRoot" : "home";
      if (options[key] !== null) throw new Error(`${argument} may be specified only once.`);
      options[key] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (Number(options.upgrade) + Number(options.uninstall) + Number(Boolean(options.restoreRoot)) > 1) {
    throw new Error("--upgrade, --uninstall and --restore cannot be combined.");
  }
  if ((options.uninstall || options.restoreRoot) && (options.reviewerOnly || options.includeAuthorizedFixer)) {
    throw new Error("--uninstall and --restore do not accept installation profile options.");
  }
  if (options.backupRoot && !options.upgrade && !options.uninstall && !options.restoreRoot) {
    throw new Error("--backup-root requires --upgrade, --uninstall or --restore.");
  }
  if (target === "codex" && options.reviewerOnly) throw new Error("--reviewer-only is Claude-only.");
  return options;
}

function usage(target = "claude") {
  return [
    `Usage: node scripts/install-${target}.mjs [options]`,
    "",
    "Options:",
    `  --${target}-home <path>  Install under this ${target} home directory.`,
    "  --dry-run             Validate and print the installation plan without writing files.",
    "  --upgrade             Back up and replace the current managed installation.",
    "  --uninstall           Move managed files to a backup without deleting them.",
    "  --restore <path>      Restore a previous backup; save the current installation first.",
    "  --backup-root <path>  New backup directory for upgrade, uninstall or restore.",
    ...(target === "claude" ? ["  --reviewer-only       Install only the reviewer for hosts without specialist dispatch."] : []),
    "  --include-authorized-fixer  Include the optional authorized fixer agent and runtime.",
    "  --help, -h            Show this help.",
    "",
    `${target} home resolution: --${target}-home, then ${target.toUpperCase()}_HOME, then ~/.${target}.`,
    "Initial install never overwrites existing destinations; upgrade and uninstall retain backups."
  ].join("\n");
}

function resolveHome(options) {
  const configured = options.home ?? process.env[`${options.target.toUpperCase()}_HOME`];
  return path.resolve(configured || path.join(os.homedir(), `.${options.target}`));
}

function assertSourceDirectory(directory) {
  const stat = fs.statSync(directory);
  if (!stat.isDirectory()) throw new Error(`Expected source directory: ${directory}`);
}

function assertSourceFile(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`Expected source file: ${filePath}`);
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertSafeAncestors(candidate) {
  let current = path.resolve(candidate);
  while (!pathExists(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  while (true) {
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symbolic-link path component is unsupported: ${current}`);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function assertNoLinks(directory) {
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error(`Symbolic links are unsupported in a restore source: ${directory}`);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are unsupported in a restore source: ${child}`);
    if (entry.isDirectory()) assertNoLinks(child);
    else if (!entry.isFile()) throw new Error(`Unsupported restore entry: ${child}`);
  }
}

function buildPlan(options) {
  const sourceSkill = path.join(root, options.target, "skills/information-accessibility-practice");
  const sourceAgents = path.join(root, options.target, "agents");
  const manifest = readJson(manifestPath);
  const feature = readJson(featurePath);
  const { defaults, reviewer } = validateManifest(manifest);
  const home = resolveHome(options);
  const registryVersion = readJson(path.join(sourceSkill, "references/orchestration-registry.json")).schema_version;
  if (feature.schema_version !== "1.0.0" || feature.core_registry_version !== registryVersion || feature.fixer_registry_version !== registryVersion) {
    throw new Error("Authorized fixer feature is incompatible with the installed orchestration registry.");
  }
  const optionalFiles = feature.optional_skill_files;
  if (!Array.isArray(optionalFiles) || optionalFiles.length === 0 || new Set(optionalFiles).size !== optionalFiles.length) {
    throw new Error("Invalid authorized fixer feature file list.");
  }
  for (const relative of optionalFiles) {
    if (typeof relative !== "string" || !/^(?:scripts|references)\/[a-z0-9./-]+$/u.test(relative) || relative.split("/").includes("..")) {
      throw new Error(`Unsafe optional feature path: ${String(relative)}`);
    }
    assertSourceFile(path.join(sourceSkill, ...relative.split("/")));
  }
  const fixer = manifest.agents.find((agent) => agent.id === fixerId);
  if (!fixer || fixer.install_by_default) throw new Error("Authorized fixer agent must be an opt-in manifest entry.");
  const selectedAgents = [...(options.reviewerOnly ? [reviewer] : defaults), ...(options.includeAuthorizedFixer ? [fixer] : [])];
  const skillDestination = path.join(home, "skills/information-accessibility-practice");
  const agentName = (agent) => options.target === "codex" ? `${agent.id}.toml` : agent.body_file;
  const agents = selectedAgents.map((agent) => ({
    id: agent.id,
    source: path.join(sourceAgents, agentName(agent)),
    destination: path.join(home, "agents", agentName(agent))
  }));
  const managed = [
    { source: skillDestination, backup: "skill", kind: "directory" },
    ...manifest.agents.map((agent) => ({
      source: path.join(home, "agents", agentName(agent)),
      backup: path.join("agents", agentName(agent)),
      kind: "file"
    }))
  ];

  assertSourceDirectory(sourceSkill);
  for (const agent of agents) assertSourceFile(agent.source);
  assertSafeAncestors(home);
  for (const entry of managed) assertSafeAncestors(path.dirname(entry.source));

  const destinations = [skillDestination, ...agents.map((agent) => agent.destination)];
  const conflicts = destinations.filter(pathExists);
  if (!options.upgrade && !options.uninstall && !options.restoreRoot && conflicts.length > 0) {
    throw new Error(`Installation conflict: managed destination already exists: ${conflicts.join(", ")}`);
  }
  if ((options.upgrade || options.uninstall) && !pathExists(skillDestination)) {
    throw new Error(`No installed skill to ${options.uninstall ? "uninstall" : "upgrade"}: ${skillDestination}`);
  }
  if ((options.upgrade || options.uninstall) && !fs.lstatSync(skillDestination).isDirectory()) {
    throw new Error(`Installed skill is not a directory: ${skillDestination}`);
  }
  const restoreRoot = options.restoreRoot ? path.resolve(options.restoreRoot) : null;
  const restoreSkill = restoreRoot ? path.join(restoreRoot, "skill") : null;
  if (restoreRoot) {
    if (!pathExists(restoreSkill) || !fs.lstatSync(restoreSkill).isDirectory()) {
      throw new Error(`Restore backup has no skill directory: ${restoreSkill}`);
    }
    if (isWithin(home, restoreRoot) || isWithin(restoreRoot, home) || isWithin(root, restoreRoot) || isWithin(restoreRoot, root)) {
      throw new Error("Restore backup must be separate from the host home and package source.");
    }
    assertSafeAncestors(restoreRoot);
    assertNoLinks(restoreSkill);
    assertSourceFile(path.join(restoreSkill, "package.json"));
  }
  const restoreAgents = restoreRoot ? manifest.agents.map((agent) => ({
    id: agent.id,
    source: path.join(restoreRoot, "agents", agentName(agent)),
    destination: path.join(home, "agents", agentName(agent))
  })).filter((agent) => pathExists(agent.source)) : [];
  if (restoreRoot && restoreAgents.length === 0) throw new Error("Restore backup has no managed agents.");
  for (const agent of restoreAgents) {
    if (!fs.lstatSync(agent.source).isFile()) throw new Error(`Invalid restore agent: ${agent.source}`);
  }
  if (restoreSkill) assertSourceFile(path.join(restoreSkill, "references/orchestration-registry.json"));
  const backupRoot = options.upgrade || options.uninstall || restoreRoot
    ? path.resolve(options.backupRoot ?? path.join(path.dirname(home), `${options.target}-backups`, `information-accessibility-${Date.now()}-${process.pid}`))
    : null;
  if (backupRoot) {
    if (pathExists(backupRoot)) throw new Error(`Backup root already exists: ${backupRoot}`);
    if (isWithin(home, backupRoot) || isWithin(backupRoot, home) || isWithin(root, backupRoot) || isWithin(backupRoot, root)
      || (restoreRoot && (isWithin(restoreRoot, backupRoot) || isWithin(backupRoot, restoreRoot)))) {
      throw new Error("Backup root must be separate from the host home and package source.");
    }
    assertSafeAncestors(backupRoot);
  }
  if (!options.uninstall && !restoreRoot) {
    const packageCheck = verifyPackage(root);
    if (packageCheck.status !== "PASS") throw new Error(`Package verification failed: ${packageCheck.errors.join("; ")}`);
  }
  const listedAgents = restoreRoot ? restoreAgents : options.uninstall ? [] : agents;
  const installedAgents = options.uninstall
    ? manifest.agents.filter((agent) => pathExists(path.join(home, "agents", agentName(agent))))
    : [];
  const reviewerOnly = restoreRoot
    ? restoreAgents.length === 1 && restoreAgents[0].id === reviewerId
    : options.uninstall
      ? installedAgents.length === 1 && installedAgents[0].id === reviewerId
      : options.reviewerOnly;
  const authorizedFixer = restoreRoot
    ? restoreAgents.some((agent) => agent.id === fixerId)
    : options.uninstall
      ? pathExists(path.join(home, "agents", agentName(fixer)))
      : options.includeAuthorizedFixer;

  return {
    status: options.dryRun ? "DRY_RUN" : options.uninstall ? "UNINSTALLED" : restoreRoot ? "RESTORED" : options.upgrade ? "UPGRADED" : "INSTALLED",
    operation: options.uninstall ? "uninstall" : restoreRoot ? "restore" : options.upgrade ? "upgrade" : "install",
    target: options.target,
    package_version: options.uninstall ? null : readJson(path.join(restoreSkill ?? sourceSkill, "package.json")).version,
    registry_version: options.uninstall ? null : restoreSkill
      ? readJson(path.join(restoreSkill, "references/orchestration-registry.json")).schema_version
      : registryVersion,
    mode: reviewerOnly ? "reviewer-only" : "multi-agent",
    specialist_dispatch: reviewerOnly ? "local-fallback-only" : "available",
    authorized_fixer: authorizedFixer,
    [`${options.target}_home`]: home,
    backup_root: backupRoot,
    skill: {
      source: restoreSkill ?? (options.uninstall ? null : sourceSkill),
      destination: skillDestination
    },
    agents: listedAgents,
    optionalFiles: options.uninstall || restoreRoot || options.includeAuthorizedFixer ? [] : optionalFiles,
    managed: managed.filter((entry) => pathExists(entry.source)),
    restore: restoreRoot ? { source: restoreRoot, skill: restoreSkill, agents: restoreAgents } : null
  };
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
    try {
      fs.mkdirSync(item);
      createdDirectories.push(item);
    } catch (error) {
      if (error?.code !== "EEXIST" || !fs.statSync(item).isDirectory()) throw error;
    }
  }
}

function copyDirectoryExclusive(source, destination, excluded = new Set(), prefix = "") {
  const sourceStat = fs.lstatSync(source);
  if (!sourceStat.isDirectory()) throw new Error(`Expected staged directory: ${source}`);

  fs.mkdirSync(destination);
  try {
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (excluded.has(relative)) continue;
      const sourceEntry = path.join(source, entry.name);
      const destinationEntry = path.join(destination, entry.name);

      if (entry.isDirectory()) {
        copyDirectoryExclusive(sourceEntry, destinationEntry, excluded, relative);
        continue;
      }
      if (entry.isFile()) {
        fs.copyFileSync(sourceEntry, destinationEntry, fs.constants.COPYFILE_EXCL);
        continue;
      }
      if (entry.isSymbolicLink()) {
        const target = fs.readlinkSync(sourceEntry);
        const targetStat = fs.statSync(sourceEntry);
        fs.symlinkSync(target, destinationEntry, targetStat.isDirectory() ? "dir" : "file");
        continue;
      }
      throw new Error(`Unsupported staged entry type: ${sourceEntry}`);
    }
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw error;
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
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "information-accessibility-claude-install-"));
  const stagedSkill = path.join(stagingRoot, "skill");
  const stagedAgentsDirectory = path.join(stagingRoot, "agents");
  const activatedPaths = [];
  const createdDirectories = [];

  try {
    copyDirectoryExclusive(plan.skill.source, stagedSkill, new Set(plan.optionalFiles));
    fs.mkdirSync(stagedAgentsDirectory);
    for (const agent of plan.agents) {
      fs.copyFileSync(agent.source, path.join(stagedAgentsDirectory, path.basename(agent.destination)));
    }

    ensureDirectory(path.dirname(plan.skill.destination), createdDirectories);
    ensureDirectory(path.dirname(plan.agents[0].destination), createdDirectories);

    copyDirectoryExclusive(stagedSkill, plan.skill.destination);
    activatedPaths.push(plan.skill.destination);

    for (const agent of plan.agents) {
      const stagedAgent = path.join(stagedAgentsDirectory, path.basename(agent.destination));
      fs.copyFileSync(stagedAgent, agent.destination, fs.constants.COPYFILE_EXCL);
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

function transition(plan) {
  const moved = [];
  const restored = [];
  const backupRoot = plan.backup_root;
  const createdDirectories = [];
  ensureDirectory(path.dirname(backupRoot), createdDirectories);
  fs.mkdirSync(backupRoot);
  try {
    for (const entry of plan.managed) {
      const state = fs.lstatSync(entry.source);
      if (state.isSymbolicLink() || (entry.kind === "directory" ? !state.isDirectory() : !state.isFile())) {
        throw new Error(`Managed destination changed type: ${entry.source}`);
      }
      const destination = path.join(backupRoot, entry.backup);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(entry.source, destination);
      moved.push({ ...entry, destination });
    }
    if (plan.operation === "upgrade") install(plan);
    if (plan.operation === "restore") {
      const createdDirectories = [];
      ensureDirectory(path.dirname(plan.skill.destination), createdDirectories);
      ensureDirectory(path.dirname(plan.restore.agents[0].destination), createdDirectories);
      copyDirectoryExclusive(plan.restore.skill, plan.skill.destination);
      restored.push(plan.skill.destination);
      for (const agent of plan.restore.agents) {
        fs.copyFileSync(agent.source, agent.destination, fs.constants.COPYFILE_EXCL);
        restored.push(agent.destination);
      }
    }
  } catch (error) {
    try {
      for (const entry of restored.reverse()) fs.rmSync(entry, { recursive: true, force: true });
      for (const entry of moved.reverse()) fs.renameSync(entry.destination, entry.source);
    } catch (rollbackError) {
      throw new Error(`${error.message}; restore failed: ${rollbackError.message}. Preserved backup: ${backupRoot}`);
    }
    throw error;
  }
}

export function runInstaller(argv, target = "claude") {
  const options = parseArgs(argv, target);
  if (options.help) {
    process.stdout.write(`${usage(target)}\n`);
    return;
  }

  const plan = buildPlan(options);
  if (!options.dryRun) {
    if (plan.operation === "install") install(plan);
    else transition(plan);
  }
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runInstaller(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
