#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { commandDefinitions } from "./lib/cli-command-registry.mjs";
import {
  localeAwareCommands,
  localizedCommandHelpText,
  localizedRootHelpText,
  versionText
} from "./lib/localized-cli-help.mjs";
import {
  normalizeRuntimeLocale,
  runtimeCliError
} from "./lib/runtime-locale.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(scriptRoot);

function writeError(message) {
  process.stderr.write(`${message}\n`);
}

function parseGlobalLocale(argv) {
  if (argv[0] !== "--locale") return { locale: "en", explicit: false, argv };
  const value = argv[1];
  if (!value || value.startsWith("--")) return { error: "locale_missing", locale: "ja", argv: [] };
  if (!["ja", "en"].includes(value)) return { error: "locale_invalid", locale: "en", argv: [] };
  return { locale: value, explicit: true, argv: argv.slice(2) };
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

function localizedArgs(command, args, globalLocale) {
  if (!globalLocale.explicit || !localeAwareCommands.has(command) || args.includes("--locale")) return args;
  return [...args, "--locale", globalLocale.locale];
}

export function main(input = process.argv.slice(2)) {
  const globalLocale = parseGlobalLocale(input);
  if (globalLocale.error) {
    writeError(runtimeCliError(globalLocale.locale, globalLocale.error));
    return 2;
  }
  const argv = globalLocale.argv;
  const locale = normalizeRuntimeLocale(globalLocale.locale, "en");

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(`${localizedRootHelpText(locale)}\n`);
    return 0;
  }
  if (argv[0] === "--version" || argv[0] === "-V") {
    if (argv.length !== 1) {
      writeError(runtimeCliError(locale, "version_extra"));
      return 2;
    }
    process.stdout.write(`${versionText(skillRoot)}\n`);
    return 0;
  }

  const [command, ...rawArgs] = argv;
  if (["fix", "apply-fix", "apply-authorized-fix"].includes(command)) {
    writeError(runtimeCliError(locale, "mutation_blocked"));
    return 2;
  }

  const definition = commandDefinitions.get(command);
  if (!definition) {
    writeError(runtimeCliError(locale, "unknown_command", { command }));
    writeError(runtimeCliError(locale, "help_hint"));
    return 2;
  }

  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    process.stdout.write(`${localizedCommandHelpText(command, locale)}\n`);
    return 0;
  }

  const args = localizedArgs(command, rawArgs, globalLocale);
  if (definition.requiredFlag && !args.includes(definition.requiredFlag)) {
    writeError(runtimeCliError(locale, "required_flag", { command, flag: definition.requiredFlag }));
    writeError(localizedCommandHelpText(command, locale));
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
