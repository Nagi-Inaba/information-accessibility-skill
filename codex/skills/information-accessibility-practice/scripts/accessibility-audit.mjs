#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  commandDefinitions,
  commandHelpText,
  rootHelpText,
  versionText
} from "./lib/cli-command-registry.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptRoot);

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
    process.stdout.write(`${rootHelpText()}\n`);
    return 0;
  }
  if (argv[0] === "--version" || argv[0] === "-V") {
    if (argv.length !== 1) {
      writeError("--version does not accept additional arguments.");
      return 2;
    }
    process.stdout.write(`${versionText(skillRoot)}\n`);
    return 0;
  }

  const [command, ...args] = argv;
  if (["fix", "apply-fix", "apply-authorized-fix"].includes(command)) {
    writeError("Target mutation is not available from the standard CLI. Use the separately authorized fixer runtime with an exact validated authorization.");
    return 2;
  }

  const definition = commandDefinitions.get(command);
  if (!definition) {
    writeError(`Unknown command: ${command}`);
    writeError("Run accessibility-audit --help to list supported commands.");
    return 2;
  }

  if (args.includes("--help") || args.includes("-h")) {
    if (command === "report") return runCommand(definition, ["--help"]);
    process.stdout.write(`${commandHelpText(command)}\n`);
    return 0;
  }

  if (definition.requiredFlag && !args.includes(definition.requiredFlag)) {
    writeError(`${command} requires ${definition.requiredFlag}.`);
    writeError(commandHelpText(command));
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

if (isMainModule()) process.exitCode = main();
