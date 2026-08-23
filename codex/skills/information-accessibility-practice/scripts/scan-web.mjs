#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { assertNewOutputPath, writeNewJson } from "./lib/audit-run.mjs";
import { normalizeOrigin, runAutomatedWebScan } from "./lib/automated-web-scan.mjs";

const DEFAULTS = {
  focusSteps: 8,
  width: 1280,
  height: 800,
  reflowWidth: 320
};
const SINGLE_VALUE_OPTIONS = new Map([
  ["--url", "url"],
  ["--profile", "profile"],
  ["--output", "output"],
  ["--context-output", "contextOutput"],
  ["--focus-steps", "focusSteps"],
  ["--width", "width"],
  ["--height", "height"],
  ["--reflow-width", "reflowWidth"]
]);
const NUMERIC_OPTION_KEYS = new Set(["focusSteps", "width", "height", "reflowWidth"]);

class ScanWebUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "ScanWebUsageError";
    this.exitCode = 2;
    this.code = "SCAN_WEB_USAGE";
  }
}

function usage() {
  return [
    "Run rule-based browser checks and create a compact AI review context.",
    "",
    "Usage:",
    "  accessibility-audit scan-web --url <http-or-https-url> --profile <active-profile> --output <new-scan.json> [--context-output <new-context.json>] [--allow-origin <origin>] [--allow-localhost] [--focus-steps <0-50>] [--width <240-7680>] [--height <240-7680>] [--reflow-width <240-1280>]",
    "",
    "Defaults:",
    "  --focus-steps 8",
    "  --width 1280",
    "  --height 800",
    "  --reflow-width 320"
  ].join("\n");
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new ScanWebUsageError(`Missing value for ${flag}`);
  return value;
}

function integerInRange(value, flag, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ScanWebUsageError(`${flag} must be an integer from ${minimum} to ${maximum}.`);
  }
}

export function parseScanWebArgs(argv) {
  const options = { allowOrigins: [], allowLocalhost: false, ...DEFAULTS };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--allow-localhost") {
      if (seen.has(arg)) throw new ScanWebUsageError(`Duplicate argument: ${arg}`);
      seen.add(arg);
      options.allowLocalhost = true;
      continue;
    }
    if (arg === "--allow-origin") {
      const value = requireValue(argv, index, arg);
      index += 1;
      options.allowOrigins.push(normalizeOrigin(value));
      continue;
    }
    const key = SINGLE_VALUE_OPTIONS.get(arg);
    if (!key) throw new ScanWebUsageError(`Unknown argument: ${arg}`);
    if (seen.has(arg)) throw new ScanWebUsageError(`Duplicate argument: ${arg}`);
    seen.add(arg);
    const value = requireValue(argv, index, arg);
    index += 1;
    options[key] = NUMERIC_OPTION_KEYS.has(key) ? Number(value) : value;
  }

  for (const required of ["url", "profile", "output"]) {
    if (!options[required]) throw new ScanWebUsageError(`--${required} is required.`);
  }
  options.allowOrigins = [...new Set(options.allowOrigins)].sort((left, right) => left.localeCompare(right, "en"));
  if (options.allowOrigins.length > 8) throw new ScanWebUsageError("At most 8 distinct --allow-origin values are allowed.");
  integerInRange(options.focusSteps, "--focus-steps", 0, 50);
  integerInRange(options.width, "--width", 240, 7680);
  integerInRange(options.height, "--height", 240, 7680);
  integerInRange(options.reflowWidth, "--reflow-width", 240, 1280);
  options.viewport = { width: options.width, height: options.height };
  return options;
}

function pathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function outputPath(value, label) {
  const resolved = path.resolve(value);
  try {
    assertNewOutputPath(resolved);
  } catch (cause) {
    const error = new Error(`${label} is not a safe new output path: ${cause instanceof Error ? cause.message : String(cause)}`);
    error.exitCode = 6;
    error.code = "OUTPUT_PREFLIGHT_FAILED";
    throw error;
  }
  return resolved;
}

function publishJson(output, value, label) {
  try {
    writeNewJson(output, value);
  } catch (cause) {
    const error = new Error(`${label} publication failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    error.exitCode = 6;
    error.code = "OUTPUT_PUBLICATION_FAILED";
    throw error;
  }
}

function exitCodeFor(error) {
  return Number.isInteger(error?.exitCode) ? error.exitCode : 4;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseScanWebArgs(argv);
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    const output = outputPath(options.output, "Scan output");
    const contextOutput = options.contextOutput ? outputPath(options.contextOutput, "Context output") : null;
    if (contextOutput && pathKey(output) === pathKey(contextOutput)) {
      throw new ScanWebUsageError("Scan output and context output must be different paths.");
    }

    const { scan, context } = await runAutomatedWebScan(options);
    publishJson(output, scan, "Scan output");
    if (contextOutput) {
      try {
        publishJson(contextOutput, context, "Compact context");
      } catch (error) {
        process.stderr.write(`Compact context publication failed; complete scan retained at ${output}.\n`);
        throw error;
      }
    }
    process.stdout.write(`${JSON.stringify({
      status: "PASS",
      output,
      context_output: contextOutput,
      violations: scan.summary.machine_violations,
      review_candidates: scan.summary.review_candidates,
      coverage_status: scan.frame_coverage.coverage_status
    })}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return exitCodeFor(error);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main();
}
