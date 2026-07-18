import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { assertNewOutputPath, assertStableFile, createAuditRun, readStableFile, writeNewJson } from "./lib/audit-run.mjs";

function parseArgs(argv) {
  const options = { targetRefs: [] };
  const repeatable = new Set(["--target-ref"]);
  const optional = new Set(["--supersedes-run"]);
  const map = new Map([
    ["--run-id", "runId"], ["--profile", "profile"], ["--target-name", "targetName"],
    ["--target-version", "targetVersion"], ["--target-ref", "targetRefs"],
    ["--artifact-root", "artifactRoot"], ["--network", "network"],
    ["--interaction", "interaction"], ["--source-write", "sourceWrite"], ["--supersedes-run", "supersedesRunFile"], ["--output", "output"]
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!map.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (repeatable.has(arg)) options[map.get(arg)].push(value);
    else {
      if (options[map.get(arg)] !== undefined) throw new Error(`Duplicate argument: ${arg}`);
      options[map.get(arg)] = value;
    }
    index += 1;
  }
  for (const [flag, key] of map) {
    if (!repeatable.has(flag) && !optional.has(flag) && options[key] === undefined) throw new Error(`${flag} is required`);
  }
  if (!options.targetRefs.length) throw new Error("--target-ref is required");
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const output = path.resolve(options.output);
  assertNewOutputPath(output);
  let predecessor;
  if (options.supersedesRunFile) {
    const snapshot = readStableFile(options.supersedesRunFile, { label: "superseded audit run" });
    let value;
    try {
      value = JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
    } catch (error) {
      throw new Error(`Invalid JSON in superseded audit run: ${error.message}`);
    }
    predecessor = { value, snapshot };
  }
  const run = createAuditRun({
    ...options,
    runFile: output,
    supersedesRun: predecessor?.value,
    supersedesRunFile: predecessor?.snapshot.path
  });
  if (predecessor) assertStableFile(predecessor.snapshot, "superseded audit run");
  writeNewJson(output, run);
  process.stdout.write(`${JSON.stringify({ status: "PASS", run_id: run.run_id, output })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
