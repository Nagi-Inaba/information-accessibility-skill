#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const exampleRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(exampleRoot, "../..");
const cli = path.join(repositoryRoot, "codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs");

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--output" || !argv[1] || argv[1].startsWith("--")) {
    throw new Error("Usage: node examples/standalone-ledger/run.mjs --output <empty-directory>");
  }
  return { output: path.resolve(argv[1]) };
}

function runCli(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `CLI failed: ${args[0]}`);
  return result.stdout;
}

function ensureEmptyDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.readdirSync(directory).length > 0) throw new Error(`Output directory must be empty: ${directory}`);
}

export function main(argv = process.argv.slice(2)) {
  const { output } = parseArgs(argv);
  ensureEmptyDirectory(output);
  const assessment = path.join(output, "assessment.json");
  const report = path.join(output, "audit-report.md");

  runCli([
    "assessment",
    "--profile", "web-modern",
    "--target-name", "Public accessibility example",
    "--target-version", "fixture-v1",
    "--target-ref", "https://example.com/",
    "--evaluator", "External human review required",
    "--evaluated-at", "2026-08-23",
    "--output", assessment
  ]);
  const validation = JSON.parse(runCli(["validate-assessment", assessment]));
  if (!validation.valid) throw new Error(`Generated assessment failed validation: ${validation.errors.join("; ")}`);
  runCli(["report", "--input", assessment, "--output", report]);

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    output,
    assessment,
    report,
    requirement_count: 55,
    document_mode: "reference_guidance"
  })}\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
