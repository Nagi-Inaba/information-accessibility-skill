import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  assertStableFile,
  assertNewOutputPath,
  readStableFile,
  registerArtifact,
  resolveInside,
  validateAuditRun,
  writeNewJson
} from "./lib/audit-run.mjs";

function parseArgs(argv) {
  const options = {};
  const flags = new Map([["--run", "run"], ["--artifact", "artifact"], ["--output", "output"]]);
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

function parseSnapshot(snapshot, label) {
  try {
    return JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${error.message}`);
  }
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const runFile = path.resolve(options.run);
  const artifactFile = options.artifact;
  const output = path.resolve(options.output);
  assertNewOutputPath(output);
  if (path.resolve(path.dirname(output)) !== path.resolve(path.dirname(runFile))) {
    throw new Error("Versioned audit-run output must remain beside the input run so artifact_root keeps the same meaning.");
  }
  const runSnapshot = readStableFile(runFile, { label: "audit run input" });
  const run = parseSnapshot(runSnapshot, "audit run input");
  const initialValidation = validateAuditRun(run, { runFile });
  if (!initialValidation.valid) throw new Error(`Invalid audit run:\n- ${initialValidation.errors.join("\n- ")}`);
  const resolvedArtifact = resolveInside(initialValidation.artifactRoot, artifactFile);
  const artifactSnapshot = readStableFile(resolvedArtifact, { label: "artifact input" });
  const artifact = parseSnapshot(artifactSnapshot, "artifact input");
  const next = registerArtifact(run, artifact, { runFile, artifactFile: resolvedArtifact });
  assertStableFile(runSnapshot, "audit run input");
  assertStableFile(artifactSnapshot, "artifact input");
  const finalValidation = validateAuditRun(next, { runFile });
  if (!finalValidation.valid) throw new Error(`Registered audit run failed final validation:\n- ${finalValidation.errors.join("\n- ")}`);
  for (const { snapshot } of finalValidation.envelopesById.values()) assertStableFile(snapshot, "registered artifact");
  writeNewJson(output, next);
  process.stdout.write(`${JSON.stringify({ status: "PASS", run_id: next.run_id, run_status: next.status, artifact_id: artifact.artifact_id, output })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
