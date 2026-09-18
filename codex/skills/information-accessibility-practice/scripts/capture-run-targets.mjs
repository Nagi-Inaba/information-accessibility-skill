import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertNewOutputPath, assertStableFile, readStableFile, validateAuditRun, writeNewJson } from "./lib/audit-run.mjs";
import { observeRunTargets } from "./lib/run-targets.mjs";

function parse(argv) {
  const result = { origins: [] };
  const flags = new Map([["--run", "run"], ["--specs", "specs"], ["--output", "output"], ["--allow-origin", "origins"], ["--allow-localhost", "localhost"]]);
  for (let i = 0; i < argv.length; i += 2) {
    const key = flags.get(argv[i]);
    if (!key) throw new Error(`Unknown argument: ${argv[i]}`);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argv[i]}`);
    if (key === "origins") result.origins.push(value);
    else {
      if (result[key] !== undefined) throw new Error(`Duplicate argument: ${argv[i]}`);
      result[key] = value;
    }
  }
  for (const key of ["run", "specs", "output"]) if (!result[key]) throw new Error(`--${key} is required`);
  if (result.localhost !== undefined && result.localhost !== "true") throw new Error("--allow-localhost accepts only the explicit value true.");
  return result;
}

const json = (file) => JSON.parse(file.bytes.toString("utf8").replace(/^\uFEFF/u, ""));

export async function main(argv = process.argv.slice(2)) {
  const args = parse(argv);
  const runFile = path.resolve(args.run);
  const runSnapshot = readStableFile(runFile, { maxBytes: 10 * 1024 * 1024 });
  const run = json(runSnapshot);
  const validation = validateAuditRun(run, { runFile });
  if (!validation.valid) throw new Error(`Invalid audit run:\n- ${validation.errors.join("\n- ")}`);
  const output = path.resolve(args.output);
  const relative = path.relative(validation.artifactRoot, output);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) throw new Error("Target inventory output must remain inside the private artifact root.");
  assertNewOutputPath(output);
  const specsSnapshot = readStableFile(path.resolve(args.specs), { maxBytes: 1024 * 1024 });
  const specifications = json(specsSnapshot);
  const inventory = await observeRunTargets(run, specifications, {
    baseDir: path.dirname(runFile),
    ...(args.origins.length ? { networkPolicy: { network: "allowlisted", allowedOrigins: args.origins, allowLocalhost: args.localhost === "true" } } : {})
  });
  assertStableFile(runSnapshot, "audit run input");
  assertStableFile(specsSnapshot, "target specifications");
  for (const { snapshot } of validation.envelopesById.values()) assertStableFile(snapshot, "registered artifact");
  for (const snapshot of validation.evidenceSnapshots.values()) assertStableFile(snapshot, "raw evidence");
  writeNewJson(output, inventory);
  // Keep private paths and URLs out of stdout. The caller already knows output.
  process.stdout.write(`${JSON.stringify({ status: "PASS", snapshots: inventory.snapshots.length, registered: false })}\n`);
  return inventory;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
