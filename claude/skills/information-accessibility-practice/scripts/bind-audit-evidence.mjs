import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertNewOutputPath, assertStableFile, readStableFile, resolveInside, validateAuditRun, validateArtifact, writeNewJson } from "./lib/audit-run.mjs";
import { createRunEvidenceReference, collectScreeningEvidence } from "./lib/run-evidence.mjs";

function parseArgs(argv) {
  const options = {};
  const flags = new Set(["run", "artifact", "observation", "file", "type", "target-ref", "captured-at", "snapshot-id", "output"]);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/u, "");
    if (argv[i] !== `--${key}` || !flags.has(key)) throw new Error(`Unknown argument: ${argv[i]}`);
    if (options[key] !== undefined) throw new Error(`Duplicate argument: ${argv[i]}`);
    if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Missing value for ${argv[i]}`);
    options[key] = argv[i + 1];
  }
  for (const key of flags) if (key !== "snapshot-id" && !options[key]) throw new Error(`--${key} is required`);
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const output = path.resolve(options.output);
  const runSnapshot = readStableFile(options.run);
  const run = JSON.parse(runSnapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  const validation = validateAuditRun(run, { runFile: path.resolve(options.run) });
  if (!validation.valid) throw new Error(`Invalid audit run:\n- ${validation.errors.join("\n- ")}`);
  if (run.schema_version !== validation.resources.auditRunSchema.properties.schema_version.const) throw new Error("Evidence binding requires a current audit run.");
  const outputRelative = path.relative(validation.artifactRoot, output);
  if (!outputRelative || path.isAbsolute(outputRelative) || outputRelative.split(path.sep).includes("..")) throw new Error("Bound artifact output must be within the artifact root.");
  assertNewOutputPath(output);
  const artifactSnapshot = readStableFile(resolveInside(validation.artifactRoot, options.artifact));
  const artifact = JSON.parse(artifactSnapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  if (artifact.artifact_type !== "screening-observations" || artifact.payload?.schema_version !== "3.0.0" || artifact.run_id !== run.run_id) {
    throw new Error("Evidence binding requires a screening-observations 3.0.0 artifact for this run.");
  }
  if (run.artifacts.some((item) => item.artifact_id === artifact.artifact_id)) throw new Error("Bind evidence before artifact registration; registered evidence is immutable.");
  const matches = artifact.payload.observations?.filter((item) => item.requirement_id === options.observation) ?? [];
  if (matches.length !== 1) throw new Error("--observation must match exactly one screening requirement_id.");
  const file = resolveInside(validation.artifactRoot, options.file);
  const snapshot = readStableFile(file);
  const reference = createRunEvidenceReference({ run, targetRef: options["target-ref"], evidenceType: options.type,
    relativePath: path.relative(validation.artifactRoot, file).split(path.sep).join("/"), bytes: snapshot.bytes,
    capturedAt: options["captured-at"], targetSnapshotId: options["snapshot-id"] });
  const observation = matches[0];
  if (!Array.isArray(observation.evidence_refs)) throw new Error("observation.evidence_refs must be an array.");
  observation.evidence_refs.push(reference);
  // A draft can contain other E1 rows awaiting capture. Validate this binding
  // completely now; registration validates every row and reference together.
  const draft = structuredClone(artifact);
  draft.payload.observations = [observation];
  const schemaResult = validateArtifact(draft, validation.resources);
  if (!schemaResult.valid) throw new Error(`Invalid observation:\n- ${schemaResult.errors.join("\n- ")}`);
  const evidence = collectScreeningEvidence(run, [draft], (relativePath) => readStableFile(resolveInside(validation.artifactRoot, path.join(validation.artifactRoot, ...relativePath.split("/")))));
  if (evidence.errors.length) throw new Error(evidence.errors.join("\n"));
  assertStableFile(runSnapshot, "audit run");
  assertStableFile(artifactSnapshot, "draft artifact");
  assertStableFile(snapshot, "raw evidence");
  for (const { snapshot: registered } of validation.envelopesById.values()) assertStableFile(registered, "registered artifact");
  for (const raw of [...validation.evidenceSnapshots.values(), ...evidence.snapshots.values()]) assertStableFile(raw, "raw evidence");
  writeNewJson(output, artifact);
  process.stdout.write(`${JSON.stringify({ status: "PASS", output, observation: options.observation, evidence_count: observation.evidence_refs.length })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
