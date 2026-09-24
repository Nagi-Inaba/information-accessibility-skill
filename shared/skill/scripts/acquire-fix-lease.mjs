import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { assertStableFile, writeNewJson } from "./lib/audit-run.mjs";
import {
  acquireFixLease,
  assertLeaseOutputPath,
  DEFAULT_FIX_LEASE_DIRECTORY,
  loadFixAuthorization,
  releaseFixLease
} from "./lib/fix-lease.mjs";

function parseArgs(argv) {
  const options = { recoverExpired: false };
  const valueFlags = new Map([
    ["--authorization", "authorization"],
    ["--run-id", "runId"],
    ["--lock-dir", "lockDir"],
    ["--output", "output"],
    ["--expected-run-id", "expectedRunId"],
    ["--expected-authorization-sha256", "expectedAuthorizationSha256"]
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--recover-expired") {
      if (options.recoverExpired) throw new Error("Duplicate argument: --recover-expired");
      options.recoverExpired = true;
      continue;
    }
    const key = valueFlags.get(flag);
    if (!key) throw new Error(`Unknown argument: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (options[key] !== undefined) throw new Error(`Duplicate argument: ${flag}`);
    options[key] = value;
    index += 1;
  }
  for (const required of ["authorization", "runId", "output"]) {
    if (!options[required]) throw new Error(`--${required.replace(/[A-Z]/gu, (value) => `-${value.toLowerCase()}`)} is required`);
  }
  if (!options.lockDir) options.lockDir = DEFAULT_FIX_LEASE_DIRECTORY;
  if (options.recoverExpired && (!options.expectedRunId || !options.expectedAuthorizationSha256)) {
    throw new Error("--recover-expired requires --expected-run-id and --expected-authorization-sha256");
  }
  if (!options.recoverExpired && (options.expectedRunId || options.expectedAuthorizationSha256)) {
    throw new Error("Recovery identity arguments require --recover-expired");
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const loaded = loadFixAuthorization(options.authorization, options.runId);
  const sourceRoot = loaded.authorization.payload.source_root;
  const output = assertLeaseOutputPath(options.output, sourceRoot, options.lockDir);
  const receipt = acquireFixLease({
    authorization: loaded.authorization,
    authorizationSha256: loaded.snapshot.sha256,
    sourceRoot,
    lockDir: options.lockDir,
    runId: options.runId,
    recoverExpired: options.recoverExpired,
    expectedRunId: options.expectedRunId,
    expectedAuthorizationSha256: options.expectedAuthorizationSha256
  });
  try {
    assertStableFile(loaded.snapshot, "fix authorization");
    writeNewJson(output, receipt);
  } catch (error) {
    try {
      releaseFixLease({ receipt, runId: options.runId, authorizationSha256: loaded.snapshot.sha256 });
    } catch (releaseError) {
      throw new Error(`${error.message}; failed to release lease after receipt write failure: ${releaseError.message}`);
    }
    throw error;
  }
  process.stdout.write(`${JSON.stringify({ status: "PASS", lease_id: receipt.lease_id, output: path.resolve(output) })}\n`);
  return receipt;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
