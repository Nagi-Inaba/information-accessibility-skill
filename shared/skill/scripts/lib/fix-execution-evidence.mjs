import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fixLedgerPaths } from "./fix-ledger-path.mjs";

export const executionReceiptRelativePath = (authorizationSha256) =>
  `.fix-execution/${authorizationSha256}.json`;

export function expectedExecutionReceipt(artifact, artifactSha256) {
  const payload = artifact.payload, execution = payload.execution, changed = payload.changed_files[0];
  return {
    schema_version: "1.0.0", run_id: artifact.run_id,
    change_artifact_id: artifact.artifact_id, change_sha256: artifactSha256,
    authorization_sha256: payload.authorization_artifact.sha256,
    handoff_sha256: payload.handoff_artifact.sha256,
    lease_id: payload.lease.lease_id, operator_id: execution.operator_id,
    runtime_sha256: execution.runtime_sha256,
    command_broker_sha256: execution.command_broker_sha256,
    started_at: execution.started_at, completed_at: execution.completed_at,
    before_sha256: changed.before_sha256, after_sha256: changed.after_sha256
  };
}

export function collectFixExecutionEvidence(run, records, reader, { artifactRoot, requireGlobal = false } = {}) {
  const errors = [], snapshots = new Map();
  const byId = new Map(records.map((item) => [item.envelope.artifact_id, item.envelope]));
  for (const item of records.filter((entry) =>
    entry.envelope.artifact_type === "change-record" && entry.envelope.payload?.schema_version === "3.0.0")) {
    const artifact = item.envelope, authRef = artifact.payload.authorization_artifact;
    const expectedPath = executionReceiptRelativePath(authRef.sha256);
    if (artifact.payload.execution.receipt.path !== expectedPath) {
      errors.push("change-record execution receipt path must match its authorization hash.");
      continue;
    }
    try {
      const localPath = path.join(artifactRoot, ...expectedPath.split("/"));
      const local = reader(localPath, { label: "fix execution receipt" });
      const expected = expectedExecutionReceipt(artifact, item.sha256);
      const parsed = JSON.parse(local.bytes.toString("utf8").replace(/^\uFEFF/u, ""));
      if (!isDeepStrictEqual(parsed, expected)) errors.push("Fix execution receipt does not match the registered change record.");
      snapshots.set(expectedPath, local);
      if (requireGlobal) {
        const authorization = byId.get(authRef.artifact_id);
        if (!authorization?.payload?.source_root) throw new Error("Registered authorization source root is unavailable.");
        const globalPath = fixLedgerPaths({
          authorizationSha256: authRef.sha256, sourceRoot: authorization.payload.source_root, runId: run.run_id
        }).completionPath;
        const global = reader(globalPath, { label: "host-protected fix execution receipt" });
        if (global.sha256 !== local.sha256 || !global.bytes.equals(local.bytes)) {
          errors.push("Host-protected completion receipt differs from the portable receipt.");
        }
      }
    } catch (error) {
      errors.push(`Fix execution receipt unavailable or invalid: ${error.message}`);
    }
  }
  return { errors, snapshots };
}
