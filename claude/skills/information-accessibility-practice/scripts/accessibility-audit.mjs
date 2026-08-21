#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptRoot);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
const packageInfo = readJson(path.join(skillRoot, "package.json"));
const standardsRegistry = readJson(path.join(skillRoot, "references", "standards-registry.json"));

const commands = new Map([
  ["init", {
    script: "create-audit-run.mjs",
    summary: "Create a new immutable audit run.",
    usage: "accessibility-audit init --run-id <id> --profile <id> --target-name <name> --target-version <version> --target-ref <url|file> --artifact-root <directory> --network <mode> --interaction <mode> --source-write <mode> --output <new-run.json>"
  }],
  ["assessment", {
    script: "generate-assessment.mjs",
    summary: "Create a complete not-tested assessment for an active profile.",
    usage: "accessibility-audit assessment --profile <id> [--target-name <name> --target-version <version> --target-ref <url|file> --evaluator <name> --evaluated-at <YYYY-MM-DD>] [--output <new-assessment.json>]"
  }],
  ["requirement", {
    script: "show-requirement.mjs",
    summary: "Show one registered requirement and its review method.",
    usage: "accessibility-audit requirement --profile <id> --id <requirement-id> [--format json|markdown]"
  }],
  ["screen-reader-checklist", {
    script: "show-screen-reader-checklist.mjs",
    summary: "Show supporting checks for stateful UI and screen-reader behavior.",
    usage: "accessibility-audit screen-reader-checklist [--pattern modal-dialog|disclosure|menu-button|fragmented-text|all] [--format json|markdown]"
  }],
  ["validate-run", {
    script: "validate-audit-run.mjs",
    summary: "Validate an immutable audit run and write a new validation record.",
    usage: "accessibility-audit validate-run --input <run.json> --output <new-validation.json>"
  }],
  ["validate-assessment", {
    script: "validate-assessment.mjs",
    summary: "Validate an assessment and print its coverage and claim guard result.",
    usage: "accessibility-audit validate-assessment <assessment.json>"
  }],
  ["register", {
    script: "register-audit-artifact.mjs",
    summary: "Register one validated artifact in a new audit-run version.",
    usage: "accessibility-audit register --run <run.json> --artifact <artifact.json> --output <new-run.json>"
  }],
  ["merge", {
    script: "merge-audit-artifacts.mjs",
    summary: "Merge registered artifacts into a new assessment.",
    usage: "accessibility-audit merge --run <run.json> --assessment <assessment.json> --artifact <artifact.json> --output <new-assessment.json>"
  }],
  ["report", {
    script: "render-audit-report.mjs",
    summary: "Render a new guarded Markdown report from a validated assessment.",
    usage: "accessibility-audit report (--input <assessment.json> [--output <new-report.md>] | --run <run.json> --assessment <assessment.json> --output <new-report.md>)"
  }],
  ["retest", {
    script: "create-audit-run.mjs",
    summary: "Create a fresh audit run from a completed authorized-change predecessor.",
    usage: "accessibility-audit retest --supersedes-run <old-run.json> [all init options for the new target version]",
    requiredFlag: "--supersedes-run"
  }],
  ["profiles", {
    internal: true,
    summary: "List installed assessment profiles and their activation state.",
    usage: "accessibility-audit profiles [--format text|json]"
  }],
  ["doctor", {
    internal: true,
    summary: "Inspect the installed CLI, Node runtime, profiles, and required package files.",
    usage: "accessibility-audit doctor [--format text|json]"
  }]

]);

function helpText() {
  const commandLines = [...commands].map(([name, definition]) => `  ${name.padEnd(20)} ${definition.summary}`);
  return [
    "Information Accessibility Audit CLI",
    "",
    "Usage:",
    "  accessibility-audit <command> [options]",
    "",
    "Commands:",
    ...commandLines,
    "",
    "This command is a thin control-plane wrapper around the installed skill runtime.",
    "It does not evaluate conformance by itself and does not expose target mutation.",
    "Run accessibility-audit <command> --help for command-specific usage."
  ].join("\n");
}

function selectedFormat(args) {
  if (args.length === 0) return "text";
  if (args.length !== 2 || args[0] !== "--format" || !["text", "json"].includes(args[1])) {
    throw new Error("Use --format text or --format json");
  }
  return args[1];
}

function profilesOutput(args) {
  const format = selectedFormat(args);
  const profiles = standardsRegistry.profiles.map((profile) => ({
    id: profile.id,
    display_name: profile.display_name,
    active: profile.assessment_configuration?.active === true,
    requirement_count: profile.requirement_ids?.length ?? 0,
    implementation_status: profile.implementation_status,
    claim_ceiling: profile.claim_rules?.claim_ceiling ?? null
  }));
  if (format === "json") return `${JSON.stringify({ registry_version: standardsRegistry.schema_version, profiles }, null, 2)}\n`;
  return `${profiles.map((profile) => `${profile.id}\t${profile.active ? "active" : "inactive"}\t${profile.requirement_count}\t${profile.display_name}`).join("\n")}\n`;
}

function doctorOutput(args) {
  const format = selectedFormat(args);
  const required = [
    "package.json",
    "references/standards-registry.json",
    "references/criteria-catalog.json",
    "references/assessment-record.schema.json",
    "scripts/accessibility-audit.mjs"
  ];
  const files = required.map((relative) => ({ relative, present: fs.existsSync(path.join(skillRoot, relative)) }));
  const result = {
    status: files.every((file) => file.present) && Number.parseInt(process.versions.node.split(".")[0], 10) >= 20 ? "PASS" : "FAIL",
    cli_version: packageInfo.version,
    node_version: process.versions.node,
    skill_root: skillRoot,
    standards_registry_version: standardsRegistry.schema_version,
    active_profiles: standardsRegistry.profiles.filter((profile) => profile.assessment_configuration?.active).map((profile) => profile.id),
    files
  };
  if (format === "json") return `${JSON.stringify(result, null, 2)}\n`;
  return [
    `Status: ${result.status}`,
    `CLI: ${result.cli_version}`,
    `Node: ${result.node_version}`,
    `Standards registry: ${result.standards_registry_version}`,
    `Active profiles: ${result.active_profiles.join(", ") || "none"}`,
    ...files.map((file) => `${file.present ? "OK" : "MISSING"}: ${file.relative}`)
  ].join("\n") + "\n";
}

function writeError(message) {
  process.stderr.write(`${message}\n`);
}

function runCommand(definition, args) {
  const script = path.join(scriptRoot, definition.script);
  const result = spawnSync(process.execPath, [script, ...args], {
    shell: false,
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error) {
    writeError(result.error instanceof Error ? result.error.message : String(result.error));
    return 1;
  }
  if (typeof result.status === "number") return result.status;
  writeError(`Command terminated without an exit status${result.signal ? ` (${result.signal})` : ""}.`);
  return 1;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }

  if (argv[0] === "--version" || argv[0] === "-V") {
    process.stdout.write(`${packageInfo.version}\n`);
    return 0;
  }

  const [command, ...args] = argv;
  if (["fix", "apply-fix", "apply-authorized-fix"].includes(command)) {
    writeError("Target mutation is not available from the standard CLI. Use the separately authorized fixer runtime with an exact validated authorization.");
    return 2;
  }

  const definition = commands.get(command);
  if (!definition) {
    writeError(`Unknown command: ${command}`);
    writeError("Run accessibility-audit --help to list supported commands.");
    return 2;
  }

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${definition.summary}\n\nUsage:\n  ${definition.usage}\n`);
    return 0;
  }

  if (definition.requiredFlag && !args.includes(definition.requiredFlag)) {
    writeError(`${command} requires ${definition.requiredFlag}.`);
    writeError(`Usage: ${definition.usage}`);
    return 2;
  }

  if (definition.internal) {
    try {
      process.stdout.write(command === "profiles" ? profilesOutput(args) : doctorOutput(args));
      return 0;
    } catch (error) {
      writeError(error instanceof Error ? error.message : String(error));
      return 2;
    }
  }

  return runCommand(definition, args);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    const entryPath = fs.realpathSync(process.argv[1]);
    const modulePath = fs.realpathSync(fileURLToPath(import.meta.url));
    return process.platform === "win32"
      ? entryPath.toLowerCase() === modulePath.toLowerCase()
      : entryPath === modulePath;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = main();
}
