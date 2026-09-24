import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertNewOutputPath, assertStableFile, readStableFile, validateAuditRun, validateArtifact, writeNewJson } from "./lib/audit-run.mjs";
import { createHumanReviewQueue, queueContextErrors } from "./lib/human-review-queue.mjs";

export function main(argv = process.argv.slice(2)) {
  const options = { requirement: [], scope: "screening" };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/u, "");
    if (argv[i] !== `--${key}` || !["run", "output", "scope", "requirement", "artifact-id"].includes(key)) throw new Error(`Unknown argument: ${argv[i]}`);
    if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Missing value for ${argv[i]}`);
    if (seen.has(key) && key !== "requirement") throw new Error(`Duplicate argument: ${argv[i]}`);
    seen.add(key);
    if (key === "requirement") options.requirement.push(argv[i + 1]); else options[key] = argv[i + 1];
  }
  for (const key of ["run", "output", "artifact-id"]) if (!options[key]) throw new Error(`--${key} is required`);
  if (!["screening", "profile_all"].includes(options.scope)) throw new Error("--scope must be screening or profile_all");
  const snapshot = readStableFile(options.run);
  const run = JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  const validation = validateAuditRun(run, { runFile: path.resolve(options.run) });
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  if (run.schema_version !== "15.0.0") throw new Error("Queue generation requires current run 15.0.0; old queues remain read-only.");
  if (!["initialized", "screened"].includes(run.status)) throw new Error("Create the queue before its registration; a registered queue is immutable.");
  const output = path.resolve(options.output);
  const relative = path.relative(validation.artifactRoot, output);
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes("..")) throw new Error("Queue output must be within the private artifact root.");
  assertNewOutputPath(output);
  const screenings = [...validation.envelopesById.values()].map((record) => record.envelope).filter((artifact) => artifact.artifact_type === "screening-observations");
  const profileIds = validation.resources.standardsRegistry.profiles.find((profile) => profile.id === run.profile.id).requirement_ids;
  const artifact = { schema_version: "3.0.0", artifact_id: options["artifact-id"], artifact_type: "human-review-queue", run_id: run.run_id,
    producer: { role_id: "human_queue_planner", producer_kind: "ai_agent", origin: "accessibility-audit review-queue candidate" },
    created_at: new Date().toISOString(), target_snapshot_ids: run.target_inventory?.snapshots.map((target) => target.snapshot_id) ?? [],
    inputs: screenings.map((source) => ({ artifact_id: source.artifact_id, run_id: run.run_id, sha256: run.artifacts.find((record) => record.artifact_id === source.artifact_id).sha256 })),
    payload: createHumanReviewQueue({ run, screenings, manualRequirements: options.requirement,
      profileRequirements: options.scope === "profile_all" ? profileIds : [], skillRoot: validation.resources.skillRoot }) };
  if (run.artifacts.some((entry) => entry.artifact_id === artifact.artifact_id)) throw new Error("Artifact ID is already registered.");
  const schema = validateArtifact(artifact, validation.resources);
  const errors = [...schema.errors, ...queueContextErrors(run, new Map([...validation.envelopesById, [artifact.artifact_id, artifact]]), profileIds)];
  if (errors.length) throw new Error(errors.join("\n"));
  assertStableFile(snapshot, "audit run");
  for (const record of validation.envelopesById.values()) assertStableFile(record.snapshot, "registered artifact");
  for (const evidence of validation.evidenceSnapshots.values()) assertStableFile(evidence, "saved evidence");
  writeNewJson(output, artifact);
  process.stdout.write(`${JSON.stringify({ status: "candidate", output, items: artifact.payload.items.length, priority: "unprioritized" })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
