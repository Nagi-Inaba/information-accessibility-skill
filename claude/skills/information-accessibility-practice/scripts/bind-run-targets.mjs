import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertNewOutputPath, assertStableFile, bindTargetInventory, readStableFile, resolveInside, validateAuditRun, writeNewJson } from "./lib/audit-run.mjs";
import { checkRunTargets } from "./lib/run-targets.mjs";
import { withNetworkEvidenceOutput } from "./lib/network-cli.mjs";

export async function main(argv = process.argv.slice(2)) {
  const options = { origins: [], urls: [] };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!["--run", "--targets", "--output", "--allow-origin", "--allow-url", "--allow-localhost", "--network-log-output"].includes(flag)) throw new Error(`Unknown argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (flag === "--allow-origin") options.origins.push(value);
    else if (flag === "--allow-url") options.urls.push(value);
    else {
      if (options[flag] !== undefined) throw new Error(`Duplicate argument: ${flag}`);
      options[flag] = value;
    }
  }
  for (const flag of ["--run", "--targets", "--output"]) if (!options[flag]) throw new Error(`${flag} is required`);
  if (options["--allow-localhost"] !== undefined && options["--allow-localhost"] !== "true") throw new Error("--allow-localhost accepts only the explicit value true.");
  const runFile = path.resolve(options["--run"]);
  const output = path.resolve(options["--output"]);
  if (path.dirname(output) !== path.dirname(runFile)) throw new Error("The bound run output must remain beside the input run.");
  assertNewOutputPath(output);
  const runSnapshot = readStableFile(runFile);
  const run = JSON.parse(runSnapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  const validation = validateAuditRun(run, { runFile });
  if (!validation.valid) throw new Error(`Invalid audit run:\n- ${validation.errors.join("\n- ")}`);
  if (run.schema_version !== "11.0.0" || run.target_inventory !== null || run.status !== "initialized" || run.artifacts.length || run.history.length) {
    throw new Error("Target binding requires a fresh, unbound current run before any artifact registration.");
  }
  const inventorySnapshot = readStableFile(resolveInside(validation.artifactRoot, path.resolve(options["--targets"])), { maxBytes: 10 * 1024 * 1024 });
  const inventory = JSON.parse(inventorySnapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  const targetCheck = await withNetworkEvidenceOutput({ run, artifactRoot: validation.artifactRoot,
    output: options["--network-log-output"], needsNetwork: inventory.snapshots?.some((item) => item.kind === "http"),
    inputs: [runSnapshot, inventorySnapshot], otherOutputs: [output] }, (onNetworkEvidence) => checkRunTargets(run, inventory, { baseDir: path.dirname(runFile), onNetworkEvidence,
    networkPolicy: options.origins.length || options.urls.length ? { network: "allowlisted", allowedOrigins: options.origins, exactUrls: options.urls, allowLocalhost: options["--allow-localhost"] === "true" } : undefined }));
  const next = bindTargetInventory(run, inventory, { runFile, targetCheck });
  assertStableFile(runSnapshot, "audit run input");
  assertStableFile(inventorySnapshot, "target inventory input");
  writeNewJson(output, next);
  process.stdout.write(`${JSON.stringify({ status: "PASS", run_id: run.run_id, bound_targets: inventory.snapshots.length })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
