import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertStableFile, readStableFile, validateAuditRun } from "./lib/audit-run.mjs";
import { advanceLifecycle, initialLifecycle, loadLifecycle, writeLifecycle } from "./lib/finding-lifecycle.mjs";

function options(argv) {
  const [action, ...args] = argv, result = {};
  if (!["init", "advance"].includes(action)) throw new Error("Lifecycle action must be init or advance.");
  const valid = action === "init" ? ["--run", "--finding", "--output", "--updated-at"]
    : ["--run", "--before", "--input", "--output"];
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!valid.includes(flag) || result[flag] !== undefined || !args[index + 1] || args[index + 1].startsWith("--")) {
      throw new Error(`Invalid lifecycle argument: ${flag}.`);
    }
    result[flag] = args[index + 1];
  }
  for (const flag of (action === "init" ? ["--run", "--finding", "--output"] : ["--run", "--before", "--input", "--output"])) {
    if (!result[flag]) throw new Error(`${flag} is required.`);
  }
  return { action, result };
}

export function main(argv = process.argv.slice(2)) {
  const { action, result } = options(argv);
  const runFile = path.resolve(result["--run"]), runSnapshot = readStableFile(runFile, { label: "lifecycle source run" });
  const run = JSON.parse(runSnapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  const validation = validateAuditRun(run, { runFile });
  if (!validation.valid) throw new Error(`Invalid lifecycle source run:\n- ${validation.errors.join("\n- ")}`);
  const inputs = [runSnapshot];
  let record;
  if (action === "init") {
    record = initialLifecycle(run, validation, result["--finding"], result["--updated-at"] ?? new Date().toISOString());
  } else {
    const prior = loadLifecycle(path.resolve(result["--before"]), { run, validation, runFile });
    const patchSnapshot = readStableFile(path.resolve(result["--input"]), { label: "lifecycle patch", maxBytes: 1024 * 1024 });
    const patch = JSON.parse(patchSnapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
    record = advanceLifecycle(prior.record, patch, prior.snapshot.path, prior.snapshot.sha256, validation.artifactRoot);
    inputs.push(...prior.snapshots, patchSnapshot);
  }
  const output = writeLifecycle(result["--output"], record, { run, validation, runFile, inputSnapshots: inputs });
  for (const snapshot of inputs) assertStableFile(snapshot, "lifecycle input");
  process.stdout.write(`${JSON.stringify({ status: "PASS", output, finding_id: record.finding_id, revision: record.revision, finding_status: record.state.status })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
