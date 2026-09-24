import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertNewOutputPath, assertStableFile, readStableFile, resolveInside, validateAuditRun, validateArtifact, writeNewJson } from "./lib/audit-run.mjs";
import { buildAxeImport, importedScreeningArtifact } from "./lib/scanner-import.mjs";
import { createRunEvidenceReference, collectScreeningEvidence } from "./lib/run-evidence.mjs";
import { targetSpecification } from "./lib/run-targets.mjs";
import { observeLocalTarget } from "./lib/target-observer.mjs";
import { canonicalJson } from "./lib/canonical-json.mjs";
import { targetDigest } from "./lib/target-identity.mjs";

const json = (snapshot) => JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
function parse(argv) {
  if (argv[0] !== "axe") throw new Error("Supported importer: import axe. Other scanner formats are not converted implicitly.");
  const result = {};
  const keys = new Set(["run", "input", "target-ref", "configuration", "output", "record-output", "artifact-id"]);
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i].slice(2);
    if (argv[i] !== `--${key}` || !keys.has(key)) throw new Error(`Unknown argument: ${argv[i]}`);
    if (result[key] !== undefined) throw new Error(`Duplicate argument: ${argv[i]}`);
    if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Missing value for ${argv[i]}`);
    result[key] = argv[i + 1];
  }
  for (const key of ["run", "input", "output"]) if (!result[key]) throw new Error(`--${key} is required`);
  return result;
}

export function main(argv = process.argv.slice(2)) {
  const options = parse(argv);
  const runFile = path.resolve(options.run);
  const runSnapshot = readStableFile(runFile, { maxBytes: 10 * 1024 * 1024 });
  const run = json(runSnapshot);
  const validation = validateAuditRun(run, { runFile });
  if (!validation.valid) throw new Error(`Invalid audit run:\n- ${validation.errors.join("\n- ")}`);
  const root = validation.artifactRoot;
  const targetRef = options["target-ref"] ?? (run.target.urls_or_files.length === 1 ? run.target.urls_or_files[0] : null);
  if (!targetRef) throw new Error("--target-ref is required when the run declares multiple targets.");
  const inputFile = resolveInside(root, path.resolve(options.input));
  const inputSnapshot = readStableFile(inputFile, { maxBytes: 10 * 1024 * 1024 });
  const configSnapshot = options.configuration ? readStableFile(resolveInside(root, path.resolve(options.configuration)), { maxBytes: 1024 * 1024 }) : null;
  const output = path.resolve(options.output);
  const recordFile = path.resolve(options["record-output"] ?? `${output}.import.json`);
  for (const file of [output, recordFile]) {
    const relative = path.relative(root, file);
    if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes("..")) throw new Error("Import outputs must remain inside the private artifact root.");
    assertNewOutputPath(file);
  }
  if ((process.platform === "win32" ? output.toLowerCase() === recordFile.toLowerCase() : output === recordFile)) throw new Error("Artifact and import-record outputs must differ.");
  const { record, snapshot: targetSnapshot } = buildAxeImport({ input: json(inputSnapshot), run, targetRef, rawSha256: inputSnapshot.sha256,
    configuration: configSnapshot ? json(configSnapshot) : null, resources: validation.resources });
  const artifactId = options["artifact-id"] ?? `ART-IMPORT-${targetDigest(`${run.run_id}:${inputSnapshot.sha256}:${record.imported_at}`).slice(0, 24).toUpperCase()}`;
  if (run.artifacts.some((entry) => entry.artifact_id === artifactId)) throw new Error("Import artifact ID is already registered.");
  record.raw_result_path = path.relative(root, inputFile).split(path.sep).join("/");
  const recordBytes = Buffer.from(canonicalJson(record));
  if (recordBytes.length > 10 * 1024 * 1024) throw new Error("Normalized import record exceeds 10 MiB; split the scan scope.");
  const files = [{ path: inputFile, ...inputSnapshot }, { path: recordFile, bytes: recordBytes, sha256: targetDigest(recordBytes) },
    ...(configSnapshot ? [configSnapshot] : [])];
  const relative = (file) => path.relative(root, file).split(path.sep).join("/");
  const evidenceRefs = files.map((file) => createRunEvidenceReference({ run, targetRef, evidenceType: "other",
    relativePath: relative(file.path), bytes: file.bytes, capturedAt: record.imported_at }));
  const artifact = importedScreeningArtifact({ run, record, artifactId, evidenceRefs });
  const errors = validateArtifact(artifact, validation.resources).errors;
  const byPath = new Map(files.map((file) => [relative(file.path), file]));
  errors.push(...collectScreeningEvidence(run, [artifact], (file) => byPath.get(file)).errors);
  if (errors.length) throw new Error(errors.join("\n"));
  assertStableFile(runSnapshot, "audit run");
  assertStableFile(inputSnapshot, "raw scanner result");
  if (configSnapshot) assertStableFile(configSnapshot, "scanner configuration");
  for (const { snapshot } of validation.envelopesById.values()) assertStableFile(snapshot, "registered artifact");
  for (const snapshot of validation.evidenceSnapshots.values()) assertStableFile(snapshot, "saved evidence");
  const current = observeLocalTarget(targetSpecification(targetSnapshot), { baseDir: path.dirname(runFile) }).snapshot;
  if (current.snapshot_id !== targetSnapshot.snapshot_id) throw new Error("Target drift in the saved scanner capture.");
  writeNewJson(recordFile, record);
  writeNewJson(output, artifact);
  process.stdout.write(`${JSON.stringify({ status: "PASS", registered: false, observations: artifact.payload.observations.length, unsupported_rows: record.rows.filter((row) => row.mapping_status === "unsupported_rule_retained").length })}\n`);
  return artifact;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
