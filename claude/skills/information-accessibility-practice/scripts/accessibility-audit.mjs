#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));

const commands = new Map([
  ["init", {
    script: "create-audit-run.mjs",
    summary: "Create a new immutable audit run.",
    usage: "accessibility-audit init --run-id <id> --profile <id> --target-name <name> --target-version <version> --target-ref <url|file> --artifact-root <directory> --network <mode> --interaction <mode> --source-write <mode> --output <new-run.json>"
  }],
  ["assessment", {
    script: "generate-assessment.mjs",
    summary: "Create a complete not-tested assessment for an active profile.",
    usage: "accessibility-audit assessment --profile <id> [assessment options]"
  }],
  ["requirement", {
    script: "show-requirement.mjs",
    summary: "Show one registered requirement and its review method.",
    usage: "accessibility-audit requirement --profile <id> --id <requirement-id> [--format json|markdown]"
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
    usage: "accessibility-audit report --input <assessment.json> --output <new-report.md>"
  }],
  ["retest", {
    script: "create-audit-run.mjs",
    summary: "Create a fresh audit run from a completed authorized-change predecessor.",
    usage: "accessibility-audit retest --supersedes-run <old-run.json> [all init options for the new target version]",
    requiredFlag: "--supersedes-run"
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
