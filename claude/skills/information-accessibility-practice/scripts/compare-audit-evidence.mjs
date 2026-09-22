import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertNewOutputPath, assertStableFile, readStableFile, validateAuditRun, writeNewJson } from "./lib/audit-run.mjs";
import { compareEvidenceReferences } from "./lib/run-evidence.mjs";

export function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--before", "--after", "--output"].includes(argv[i])) throw new Error(`Unknown argument: ${argv[i]}`);
    if (options[argv[i]] !== undefined) throw new Error(`Duplicate argument: ${argv[i]}`);
    if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`Missing value for ${argv[i]}`);
    options[argv[i]] = argv[i + 1];
  }
  for (const flag of ["--before", "--after", "--output"]) if (!options[flag]) throw new Error(`${flag} is required`);
  assertNewOutputPath(options["--output"]);
  const inputs = [options["--before"], options["--after"]].map((file) => {
    const snapshot = readStableFile(file);
    const run = JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
    const validation = validateAuditRun(run, { runFile: path.resolve(file) });
    if (!validation.valid) throw new Error(`Invalid comparison run:\n- ${validation.errors.join("\n- ")}`);
    const screenings = [...validation.envelopesById.values()].map(({ envelope }) => envelope).filter((artifact) => artifact.artifact_type === "screening-observations");
    if (screenings.some((artifact) => !["3.0.0", "4.0.0"].includes(artifact.payload.schema_version))) throw new Error("Comparison requires saved evidence in screening-observations 3.0.0 or 4.0.0; legacy prose is not comparable.");
    return { run, snapshot, validation, rows: screenings.flatMap((artifact) => artifact.payload.observations) };
  });
  const [before, after] = inputs;
  const result = { schema_version: "1.0.0", publication: "private_by_default", before_run_id: before.run.run_id, after_run_id: after.run.run_id,
    limitation: "Byte differences are not accessibility judgements or proof that a live target still matches its capture.",
    comparisons: compareEvidenceReferences(before.rows, after.rows) };
  for (const input of inputs) {
    assertStableFile(input.snapshot, "comparison run");
    for (const { snapshot } of input.validation.envelopesById.values()) assertStableFile(snapshot, "registered artifact");
    for (const raw of input.validation.evidenceSnapshots.values()) assertStableFile(raw, "raw evidence");
  }
  writeNewJson(options["--output"], result);
  process.stdout.write(`${JSON.stringify({ status: "PASS", output: options["--output"], comparisons: result.comparisons.length })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
