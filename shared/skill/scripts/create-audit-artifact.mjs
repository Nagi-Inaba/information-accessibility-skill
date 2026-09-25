import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertNewOutputPath, assertStableFile, readStableFile, resolveInside, validateAuditRun, validateArtifactCandidate, writeNewJson } from "./lib/audit-run.mjs";
import { parseAttestationJson } from "./lib/attestation-canonical.mjs";
import { createRunEvidenceReference } from "./lib/run-evidence.mjs";

const types = ["screening-observations", "human-review-queue", "declared-human-review", "remediation-plan",
  "audit-context", "participant-usability-observation", "declared-change-record", "fix-handoff"];

export function main(argv = process.argv.slice(2)) {
  const [action, ...args] = argv;
  if (!["init", "validate"].includes(action)) throw new Error("Use artifact init or artifact validate; see accessibility-audit artifact --help.");
  const allowed = action === "init" ? ["run", "type", "payload", "input", "artifact-id", "output", "role",
    "evidence-file", "target-ref", "captured-at", "after-inventory"] : ["run", "artifact"];
  const options = { input: [] }, seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/u, "");
    if (args[i] !== `--${key}` || !allowed.includes(key)) throw new Error(`Unknown argument: ${args[i]}`);
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Missing value for ${args[i]}`);
    if (seen.has(key) && key !== "input") throw new Error(`Duplicate argument: ${args[i]}`);
    seen.add(key);
    if (key === "input") options.input.push(args[i + 1]); else options[key] = args[i + 1];
  }
  for (const key of action === "init" ? ["run", "type", "payload", "output"] : ["run", "artifact"]) {
    if (!options[key]) throw new Error(`--${key} is required`);
  }
  const snapshots = [];
  const read = (file) => {
    const snapshot = readStableFile(file, { maxBytes: 8 * 1024 * 1024 });
    snapshots.push(snapshot);
    return structuredClone(parseAttestationJson(snapshot.bytes));
  };
  const runFile = path.resolve(options.run), run = read(runFile);
  const validation = validateAuditRun(run, { runFile });
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  for (const { snapshot } of validation.envelopesById.values()) {
    parseAttestationJson(snapshot.bytes);
    snapshots.push(snapshot);
  }
  snapshots.push(...validation.evidenceSnapshots.values());
  let artifact, output;
  if (action === "init") {
    if (!types.includes(options.type)) throw new Error(`--type must be one of: ${types.join(", ")}`);
    const payload = read(options.payload);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Payload must be a JSON object.");
    if (options.type === "declared-change-record") {
      if (!options["after-inventory"]) throw new Error("declared-change-record requires --after-inventory from capture-targets --after-version.");
      payload.after_target_inventory = read(options["after-inventory"]);
    } else if (options["after-inventory"]) throw new Error("--after-inventory requires declared-change-record.");
    if (!Object.hasOwn(payload, "schema_version")) payload.schema_version = validation.resources.currentPayloadVersions.get(options.type);
    if (["audit-context", "participant-usability-observation", "declared-change-record"].includes(options.type)) {
      const roles = options.type === "audit-context"
        ? ["declared_context_reviewer", "declared_context_owner"]
        : options.type === "declared-change-record"
          ? ["declared_change_reviewer", "declared_change_owner"] : ["declared_participant_facilitator"];
      if (!roles.includes(options.role)) {
        throw new Error(`${options.type} requires --role ${roles.join(" or ")}.`);
      }
      if (!options["evidence-file"] || !options["target-ref"] || !options["captured-at"]) {
        throw new Error(`${options.type} requires --evidence-file, --target-ref, and --captured-at.`);
      }
      const evidenceFile = resolveInside(validation.artifactRoot, path.resolve(options["evidence-file"]));
      const evidenceSnapshot = readStableFile(evidenceFile, { maxBytes: 8 * 1024 * 1024 });
      snapshots.push(evidenceSnapshot);
      const relativePath = path.relative(validation.artifactRoot, evidenceFile).split(path.sep).join("/");
      const reference = createRunEvidenceReference({ run, targetRef: options["target-ref"], evidenceType: "other",
        relativePath, bytes: evidenceSnapshot.bytes, capturedAt: options["captured-at"] });
      payload.evidence_refs = [...(payload.evidence_refs ?? []), reference];
      payload.source_artifact_ids = payload.source_artifact_ids ?? [...options.input];
    } else if (options.role || options["evidence-file"] || options["target-ref"] || options["captured-at"]) {
      throw new Error("Producer and evidence options require a declared supplemental artifact type.");
    }
    const role = validation.resources.orchestrationRegistry.roles.find((item) => item.output_type === options.type
      && (!options.role || item.id === options.role));
    if (!role) throw new Error("No registered producer role matches the requested artifact.");
    const inputs = options.input.map((id) => {
      const entry = run.artifacts.find((item) => item.artifact_id === id);
      if (!entry) throw new Error(`Input is not registered in this run: ${id}`);
      return { artifact_id: id, run_id: run.run_id, sha256: entry.sha256 };
    });
    artifact = {
      schema_version: validation.resources.envelopeSchema.properties.schema_version.const,
      artifact_id: options["artifact-id"] ?? `ART-${crypto.randomUUID().toUpperCase()}`,
      artifact_type: options.type, run_id: run.run_id,
      target_snapshot_ids: run.target_inventory?.snapshots.map((item) => item.snapshot_id) ?? [],
      producer: { role_id: role.id, producer_kind: role.producer_kind, origin: "accessibility-audit artifact init; caller-supplied payload (no agent dispatch)" },
      created_at: new Date().toISOString(), inputs, payload
    };
    output = path.resolve(options.output);
    const relative = path.relative(validation.artifactRoot, output);
    if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes("..")) throw new Error("Artifact output must be within the private artifact root.");
  } else {
    artifact = read(resolveInside(validation.artifactRoot, path.resolve(options.artifact)));
    if (!types.includes(artifact?.artifact_type)) throw new Error(`Supported authoring types: ${types.join(", ")}`);
  }
  const candidate = validateArtifactCandidate(run, artifact, validation);
  if (!candidate.valid) throw new Error(candidate.errors.join("\n"));
  snapshots.push(...candidate.evidenceSnapshots.values());
  const assertStable = () => { for (const snapshot of snapshots) assertStableFile(snapshot, "artifact authoring input"); };
  assertStable();
  if (output) {
    assertNewOutputPath(output);
    writeNewJson(output, artifact, { beforeWrite: assertStable });
  }
  process.stdout.write(`${JSON.stringify({ status: "candidate_valid", artifact_type: artifact.artifact_type, artifact_id: artifact.artifact_id, ...(output ? { output } : {}) })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
