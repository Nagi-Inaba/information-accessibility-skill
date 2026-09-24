import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertNewOutputPath, assertStableFile, readStableFile, validateAuditRun, writeNewJson, writeNewText } from "./lib/audit-run.mjs";
import { buildRetestDelta, renderRetestDelta } from "./lib/retest-delta.mjs";

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!["--before", "--after", "--output", "--report", "--mapping"].includes(flag)) throw new Error(`Unknown argument: ${flag}`);
    if (options[flag] !== undefined) throw new Error(`Duplicate argument: ${flag}`);
    if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`Missing value for ${flag}`);
    options[flag] = argv[index + 1];
  }
  for (const flag of ["--before", "--after", "--output", "--report"]) if (!options[flag]) throw new Error(`${flag} is required`);
  return options;
}

function readRun(file) {
  const absolute = path.resolve(file), snapshot = readStableFile(absolute);
  const run = JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  const validation = validateAuditRun(run, { runFile: absolute });
  if (!validation.valid) throw new Error(`Invalid comparison run:\n- ${validation.errors.join("\n- ")}`);
  return { run, snapshot, validation };
}

function insidePrivateRoot(root, file) {
  const absolute = path.resolve(file), relative = path.relative(root, absolute);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("Comparison outputs must stay inside the successor private artifact root.");
  }
  return assertNewOutputPath(absolute);
}

export function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const before = readRun(options["--before"]), after = readRun(options["--after"]);
  const output = insidePrivateRoot(after.validation.artifactRoot, options["--output"]);
  const report = insidePrivateRoot(after.validation.artifactRoot, options["--report"]);
  if (output === report) throw new Error("JSON output and Markdown report must use different files.");
  const mappingSnapshot = options["--mapping"] ? readStableFile(path.resolve(options["--mapping"]), { label: "comparison mapping" }) : null;
  const mapping = mappingSnapshot ? JSON.parse(mappingSnapshot.bytes.toString("utf8").replace(/^\uFEFF/u, "")) : {};
  const delta = buildRetestDelta(before.run, before.validation, after.run, after.validation, mapping);
  if (mappingSnapshot) delta.mapping_sha256 = mappingSnapshot.sha256;
  const assertInputsStable = () => {
    for (const input of [before, after]) {
      assertStableFile(input.snapshot, "comparison run");
      for (const { snapshot } of input.validation.envelopesById.values()) assertStableFile(snapshot, "registered artifact");
      for (const snapshot of input.validation.evidenceSnapshots.values()) assertStableFile(snapshot, "raw evidence");
    }
    if (mappingSnapshot) assertStableFile(mappingSnapshot, "comparison mapping");
  };
  assertInputsStable();
  writeNewJson(output, delta, { beforeWrite: assertInputsStable });
  writeNewText(report, renderRetestDelta(delta), { beforeWrite: assertInputsStable });
  process.stdout.write(`${JSON.stringify({ status: "PASS", output, report, findings: delta.findings.length })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
