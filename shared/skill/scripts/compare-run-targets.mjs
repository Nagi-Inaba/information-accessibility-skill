import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertNewOutputPath, assertStableFile, readStableFile, validateAuditRun, writeNewJson } from "./lib/audit-run.mjs";
import { compareRunTargets } from "./lib/run-targets.mjs";

export function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!["--before", "--after", "--output"].includes(flag)) throw new Error(`Unknown argument: ${flag}`);
    if (options[flag] !== undefined) throw new Error(`Duplicate argument: ${flag}`);
    if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`Missing value for ${flag}`);
    options[flag] = argv[index + 1];
  }
  for (const flag of ["--before", "--after", "--output"]) if (!options[flag]) throw new Error(`${flag} is required`);
  const inputs = [options["--before"], options["--after"]].map((file) => {
    const snapshot = readStableFile(path.resolve(file));
    const run = JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
    const validation = validateAuditRun(run, { runFile: path.resolve(file) });
    if (!validation.valid) throw new Error(`Invalid comparison run:\n- ${validation.errors.join("\n- ")}`);
    if (!run.target_inventory) throw new Error("Target comparison requires bound measured inventories in both runs; declarations alone are not comparable.");
    return { run, snapshot, validation };
  });
  const [before, after] = inputs;
  const output = path.resolve(options["--output"]);
  const relative = path.relative(after.validation.artifactRoot, output);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) throw new Error("Target comparison output must remain inside the after-run private artifact root.");
  assertNewOutputPath(output);
  const comparisons = compareRunTargets(before.run, before.run.target_inventory, after.run, after.run.target_inventory);
  for (const input of inputs) {
    assertStableFile(input.snapshot, "comparison run");
    for (const { snapshot } of input.validation.envelopesById.values()) assertStableFile(snapshot, "registered artifact");
    for (const snapshot of input.validation.evidenceSnapshots.values()) assertStableFile(snapshot, "raw evidence");
  }
  writeNewJson(output, { schema_version: "1.0.0", publication: "private_by_default", before_run_id: before.run.run_id,
    after_run_id: after.run.run_id, comparisons, limitation: "Measured identity differences do not establish accessibility improvement. This comparison does not contact live targets." });
  process.stdout.write(`${JSON.stringify({ status: "PASS", comparisons: comparisons.length })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
