import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { withNetworkEvidenceOutput } from "./lib/network-cli.mjs";

import {
  assertStableFile,
  assertNewOutputPath,
  readStableFile,
  registerArtifactChecked,
  resolveInside,
  validateAuditRun,
  writeNewJson
} from "./lib/audit-run.mjs";

function parseArgs(argv) {
  const options = { origins: [], urls: [] };
  const flags = new Map([["--run", "run"], ["--artifact", "artifact"], ["--output", "output"], ["--network-log-output", "networkOutput"], ["--allow-origin", "origins"], ["--allow-url", "urls"], ["--allow-localhost", "localhost"]]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!flags.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (["--allow-origin", "--allow-url"].includes(arg)) options[flags.get(arg)].push(value);
    else {
      if (options[flags.get(arg)] !== undefined) throw new Error(`Duplicate argument: ${arg}`);
      options[flags.get(arg)] = value;
    }
    index += 1;
  }
  for (const key of ["run", "artifact", "output"]) if (!options[key]) throw new Error(`--${key} is required`);
  if (options.localhost !== undefined && options.localhost !== "true") throw new Error("--allow-localhost accepts only the explicit value true.");
  return options;
}

function parseSnapshot(snapshot, label) {
  try {
    return JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${error.message}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
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
  const next = await withNetworkEvidenceOutput({ run, artifactRoot: initialValidation.artifactRoot, output: options.networkOutput,
    needsNetwork: artifact.artifact_type !== "change-record" && run.target_inventory?.snapshots.some((item) => item.kind === "http"),
    inputs: [runSnapshot, artifactSnapshot], otherOutputs: [output] }, (onNetworkEvidence) => registerArtifactChecked(run, artifact, { runFile, artifactFile: resolvedArtifact, onNetworkEvidence,
    networkPolicy: options.origins.length || options.urls.length ? { network: "allowlisted", allowedOrigins: options.origins, exactUrls: options.urls, allowLocalhost: options.localhost === "true" } : undefined }));
  assertStableFile(runSnapshot, "audit run input");
  assertStableFile(artifactSnapshot, "artifact input");
  const finalValidation = validateAuditRun(next, { runFile });
  if (!finalValidation.valid) throw new Error(`Registered audit run failed final validation:\n- ${finalValidation.errors.join("\n- ")}`);
  for (const { snapshot } of finalValidation.envelopesById.values()) assertStableFile(snapshot, "registered artifact");
  for (const snapshot of finalValidation.evidenceSnapshots.values()) assertStableFile(snapshot, "raw evidence");
  writeNewJson(output, next);
  process.stdout.write(`${JSON.stringify({ status: "PASS", run_id: next.run_id, run_status: next.status, artifact_id: artifact.artifact_id, output })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
