import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { assertNewOutputPath, assertStableFile, readStableFile, validateAuditRun, writeNewJson } from "./lib/audit-run.mjs";

function parseArgs(argv) {
  const options = {};
  const flags = new Map([["--input", "input"], ["--output", "output"]]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!flags.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (options[flags.get(arg)] !== undefined) throw new Error(`Duplicate argument: ${arg}`);
    options[flags.get(arg)] = value;
    index += 1;
  }
  for (const [flag, key] of flags) if (!options[key]) throw new Error(`${flag} is required`);
  return options;
}

function parseSnapshot(snapshot) {
  return JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const input = path.resolve(options.input);
  const output = path.resolve(options.output);
  assertNewOutputPath(output);
  const snapshot = readStableFile(input, { label: "audit run input" });
  const result = validateAuditRun(parseSnapshot(snapshot), { runFile: input });
  assertStableFile(snapshot, "audit run input");
  writeNewJson(output, { valid: result.valid, errors: result.errors });
  process.stdout.write(`${JSON.stringify({ status: result.valid ? "PASS" : "FAIL", input, output, valid: result.valid })}\n`);
  if (!result.valid) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
