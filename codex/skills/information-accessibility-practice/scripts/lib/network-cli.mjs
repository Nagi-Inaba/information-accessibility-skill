import path from "node:path";
import { readStableFile, validateAuditRun, assertStableFile, assertNewOutputPath, writeNewJson } from "./audit-run.mjs";
import { assertNetworkPolicy, callerNetworkScope, networkPolicyHash } from "./network-policy.mjs";

export async function withNetworkEvidenceOutput({ run, artifactRoot, output, needsNetwork, inputs = [], otherOutputs = [] }, operation) {
  if (needsNetwork && !output) throw new Error("HTTP verification requires --network-log-output inside the private artifact root.");
  if (!output) return operation(undefined);
  const file = path.resolve(output);
  const relative = path.relative(artifactRoot, file);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) throw new Error("Network log must remain inside the private artifact root.");
  const key = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (otherOutputs.some((value) => key(value) === key(file))) throw new Error("Network log must have a distinct new output path.");
  assertNewOutputPath(file);
  const observations = [];
  try { return await operation((entry) => observations.push(entry)); }
  finally {
    if (observations.length) {
      for (const input of inputs) assertStableFile(input, "network operation input");
      writeNewJson(file, { schema_version: "1.0.0", kind: "run-network-evidence", run_id: run.run_id,
        network_policy_sha256: networkPolicyHash(run.permissions.network_policy), publication: "private_by_default", observations });
    }
  }
}

export function prepareNetworkCapture(options, outputs = []) {
  if (!options.run && !options.networkLogOutput) return null;
  if (!options.run || !options.networkLogOutput) throw new Error("Run-backed browser capture requires both --run and --network-log-output.");
  const runFile = path.resolve(options.run);
  const snapshot = readStableFile(runFile);
  const run = JSON.parse(snapshot.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  const validation = validateAuditRun(run, { runFile });
  if (!validation.valid || run.schema_version !== "15.0.0" || run.permissions.network !== "allowlisted") throw new Error("Browser capture requires a validated current run with concrete network permission.");
  assertNetworkPolicy(run.permissions.network_policy);
  if (!run.target.urls_or_files.some((value) => { try { return new URL(value).href === new URL(options.url).href; } catch { return false; } })) throw new Error("Browser URL must be a declared run target.");
  const caller = { network: "allowlisted", allowedOrigins: options.allowOrigins ?? [], exactUrls: options.allowUrls ?? [], allowLocalhost: options.allowLocalhost === true };
  callerNetworkScope(caller);
  const output = path.resolve(options.networkLogOutput);
  const relative = path.relative(validation.artifactRoot, output);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) throw new Error("Network log output must remain inside the private artifact root.");
  const key = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (outputs.filter(Boolean).some((value) => key(value) === key(output))) throw new Error("Network log output must be distinct from every other output.");
  assertNewOutputPath(output);
  options.networkRun = run;
  options.networkCaller = caller;
  return { save(log) {
    assertStableFile(snapshot, "network run input");
    for (const record of validation.envelopesById.values()) assertStableFile(record.snapshot, "registered artifact");
    for (const raw of validation.evidenceSnapshots.values()) assertStableFile(raw, "raw evidence");
    writeNewJson(output, log);
  } };
}
