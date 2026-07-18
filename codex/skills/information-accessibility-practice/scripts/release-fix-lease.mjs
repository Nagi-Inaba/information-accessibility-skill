import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { assertStableFile, readStableFile } from "./lib/audit-run.mjs";
import { loadFixAuthorization, releaseFixLease } from "./lib/fix-lease.mjs";

function parseArgs(argv) {
  const options = {};
  const flags = new Map([
    ["--receipt", "receipt"],
    ["--run-id", "runId"],
    ["--authorization", "authorization"]
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const key = flags.get(flag);
    if (!key) throw new Error(`Unknown argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (options[key] !== undefined) throw new Error(`Duplicate argument: ${flag}`);
    options[key] = value;
    index += 1;
  }
  for (const [flag, key] of flags) if (!options[key]) throw new Error(`${flag} is required`);
  return options;
}

function loadReceipt(file) {
  const snapshot = readStableFile(file, { label: "fix lease receipt" });
  let receipt;
  try {
    receipt = JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new Error(`Invalid JSON in fix lease receipt: ${error.message}`);
  }
  return { receipt, snapshot };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const loadedAuthorization = loadFixAuthorization(options.authorization, options.runId);
  const loadedReceipt = loadReceipt(options.receipt);
  if (loadedReceipt.receipt.authorization_sha256 !== loadedAuthorization.snapshot.sha256) {
    throw new Error("Lease receipt authorization SHA-256 does not match the supplied authorization.");
  }
  assertStableFile(loadedAuthorization.snapshot, "fix authorization");
  assertStableFile(loadedReceipt.snapshot, "fix lease receipt");
  const result = releaseFixLease({
    receipt: loadedReceipt.receipt,
    runId: options.runId,
    authorizationSha256: loadedAuthorization.snapshot.sha256
  });
  process.stdout.write(`${JSON.stringify({ status: "PASS", ...result })}\n`);
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
