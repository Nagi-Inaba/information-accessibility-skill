import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  assertStableFile,
  assertNewOutputPath,
  loadAuditResources,
  mergeArtifacts,
  readStableFile,
  resolveInside,
  validateAuditRun,
  writeNewJson
} from "./lib/audit-run.mjs";
import { parseAttestationJson } from "./lib/attestation-canonical.mjs";
import { loadReviewTrust, readReviewJson } from "./lib/review-trust-input.mjs";

function parseArgs(argv) {
  const options = { artifacts: [], reviewRecords: [] };
  const flags = new Map([["--run", "run"], ["--assessment", "assessment"], ["--artifact", "artifacts"], ["--output", "output"], ["--claim-tier", "claimTier"],
    ["--review-record", "reviewRecords"], ["--trust-policy", "trustPolicy"], ["--trust-policy-sha256", "trustPolicySha256"]]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!flags.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    const key = flags.get(arg);
    if (["artifacts", "reviewRecords"].includes(key)) options[key].push(value);
    else {
      if (options[key] !== undefined) throw new Error(`Duplicate argument: ${arg}`);
      options[key] = value;
    }
    index += 1;
  }
  for (const [flag, key] of flags) {
    if (["run", "assessment", "output"].includes(key) && !options[key]) throw new Error(`${flag} is required`);
  }
  if (!options.artifacts.length) throw new Error("--artifact is required");
  return options;
}

function parseSnapshot(snapshot, label) {
  try {
    return structuredClone(parseAttestationJson(snapshot.bytes));
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${error.message}`);
  }
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const runFile = path.resolve(options.run);
  const assessmentFile = path.resolve(options.assessment);
  const output = path.resolve(options.output);
  assertNewOutputPath(output);
  const runSnapshot = readStableFile(runFile, { label: "audit run input" });
  const assessmentSnapshot = readStableFile(assessmentFile, { label: "assessment input" });
  const run = parseSnapshot(runSnapshot, "audit run input");
  const runValidation = validateAuditRun(run, { runFile });
  if (!runValidation.valid) throw new Error(`Invalid audit run:\n- ${runValidation.errors.join("\n- ")}`);
  const registeredByPath = new Map(run.artifacts.map((entry) => {
    const absolute = resolveInside(runValidation.artifactRoot, path.join(runValidation.artifactRoot, ...entry.path.split("/")));
    return [process.platform === "win32" ? absolute.toLowerCase() : absolute, entry];
  }));
  const artifactSnapshots = [];
  const artifacts = [];
  const artifactSnapshotsById = new Map();
  const suppliedPaths = new Set();
  for (const candidate of options.artifacts) {
    const absolute = resolveInside(runValidation.artifactRoot, candidate);
    const key = process.platform === "win32" ? absolute.toLowerCase() : absolute;
    if (suppliedPaths.has(key)) throw new Error(`Duplicate supplied artifact path: ${candidate}`);
    suppliedPaths.add(key);
    const entry = registeredByPath.get(key);
    if (!entry) throw new Error(`Merge artifact path is not registered in the run: ${candidate}`);
    const snapshot = readStableFile(absolute, { label: `merge artifact ${entry.artifact_id}` });
    if (snapshot.sha256 !== entry.sha256) throw new Error(`Merge artifact exact current hash mismatch: ${entry.artifact_id}`);
    const artifact = parseSnapshot(snapshot, `merge artifact ${entry.artifact_id}`);
    artifactSnapshots.push(snapshot);
    artifactSnapshotsById.set(entry.artifact_id, snapshot);
    artifacts.push(artifact);
  }
  const resources = loadAuditResources();
  resources.artifact_snapshots_by_id = artifactSnapshotsById;
  resources.evidence_snapshots_by_path = runValidation.evidenceSnapshots;
  const trustInput = loadReviewTrust(options);
  resources.reviewTrust = trustInput.trust;
  const reviewInputs = options.reviewRecords.map((file) => readReviewJson(file, "portable human review"));
  const assessment = parseSnapshot(assessmentSnapshot, "assessment input");
  const merged = mergeArtifacts({ run, assessment, artifacts, registries: resources, claimTier: options.claimTier, reviewRecords: reviewInputs.map((input) => input.value) });
  assertStableFile(runSnapshot, "audit run input");
  assertStableFile(assessmentSnapshot, "assessment input");
  for (const snapshot of artifactSnapshots) assertStableFile(snapshot, "merge artifact");
  for (const { snapshot } of runValidation.envelopesById.values()) assertStableFile(snapshot, "registered artifact");
  for (const snapshot of runValidation.evidenceSnapshots.values()) assertStableFile(snapshot, "raw evidence");
  writeNewJson(output, merged, { beforeWrite() {
    for (const snapshot of [...trustInput.snapshots, ...reviewInputs.map((input) => input.snapshot)]) assertStableFile(snapshot, "review verification input");
  } });
  process.stdout.write(`${JSON.stringify({ status: "PASS", output, artifacts: artifacts.length, assessment_valid: true })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
