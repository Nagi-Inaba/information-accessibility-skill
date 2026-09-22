import { networkPolicyHash, networkRequestDecision, NETWORK_ADAPTERS } from "./network-policy.mjs";
import { isPrivateAddress } from "../capture-web-evidence.mjs";
import { isIP } from "node:net";

const instant = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value));

// Validates a saved declaration against its run and measured target. This does
// not authenticate the producer or retroactively authorize any request.
export function validateNetworkEvidence(bytes, run, reference) {
  if (!["9.0.0", "10.0.0", "11.0.0", "12.0.0"].includes(run.schema_version)) return;
  const fail = () => { throw new Error("Network evidence does not match this run, policy, target or bounded adapter contract."); };
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(); }
  if (run.permissions.network !== "allowlisted") fail();
  const policy = run.permissions.network_policy;
  const digest = networkPolicyHash(policy);
  let logs;
  if (value?.kind === "run-network-evidence") {
    if (value.schema_version !== "1.0.0" || value.run_id !== run.run_id || value.network_policy_sha256 !== digest
        || value.publication !== "private_by_default" || !Array.isArray(value.observations)
        || !value.observations.length || value.observations.length > 32) fail();
    if (!value.observations.some((item) => item.target_snapshot_id === reference.target_snapshot_id)) fail();
    logs = value.observations.map((item) => {
      if (!run.target_inventory.snapshots.some((snapshot) => snapshot.snapshot_id === item.target_snapshot_id)) fail();
      return item.log;
    });
  } else logs = [value];
  let targetSeen = false;
  for (const log of logs) {
    if (log?.kind !== "network-request-log" || log.schema_version !== "1.0.0" || log.run_id !== run.run_id
        || log.network_policy_sha256 !== digest || !NETWORK_ADAPTERS.includes(log.adapter)
        || !["target", "standards_source"].includes(log.purpose) || log.publication !== "private_by_default"
        || log.credentials !== "not_forwarded" || !instant(log.started_at) || !instant(log.completed_at)
        || Date.parse(log.started_at) > Date.parse(log.completed_at) || Date.parse(log.completed_at) > Date.parse(reference.captured_at)
        || !Array.isArray(log.entries) || !log.entries.length || log.entries.length > policy.max_requests
        || typeof log.truncated !== "boolean" || !Number.isSafeInteger(log.dropped_request_count)
        || log.dropped_request_count < 0 || log.truncated !== (log.dropped_request_count > 0)) fail();
    for (const [index, entry] of log.entries.entries()) {
      if (entry.request_id !== `REQ-${String(index + 1).padStart(4, "0")}` || !instant(entry.at)
          || Date.parse(entry.at) < Date.parse(log.started_at) || Date.parse(entry.at) > Date.parse(log.completed_at)
          || typeof entry.url !== "string" || entry.url.length > 4096 || !["allowed", "denied"].includes(entry.decision)
          || !["succeeded", "failed", "blocked"].includes(entry.outcome) || typeof entry.request_sent !== "boolean"
          || !Number.isSafeInteger(entry.response_bytes) || entry.response_bytes < 0) fail();
      const decision = networkRequestDecision(policy, { ...entry, purpose: log.purpose, adapter: log.adapter }, log.caller_authorization);
      if (entry.decision === "allowed") {
        if (!decision.allowed || entry.reason !== "validated_and_pinned" || !isIP(entry.pinned_address)
            || isIP(entry.pinned_address) !== entry.address_family || entry.outcome === "blocked") fail();
        if (entry.outcome === "succeeded" && (entry.response_bytes > policy.max_response_bytes || !entry.request_sent
            || !Number.isInteger(entry.response_status) || entry.response_status < 100 || entry.response_status > 599)) fail();
        if (isPrivateAddress(entry.pinned_address)) {
          const hostname = new URL(entry.url).hostname.replace(/^\[|\]$/gu, "");
          const loopback = (value) => value === "::1" || isIP(value) === 4 && value.startsWith("127.");
          if (!decision.allow_localhost || !loopback(entry.pinned_address)
              || !["localhost", "localhost.localdomain"].includes(hostname) && !loopback(hostname)) fail();
        }
      } else if (entry.outcome !== "blocked" || entry.request_sent || entry.response_bytes !== 0) fail();
      if (log.purpose === "target" && entry.resource_type === "main_document") {
        try { if (new URL(entry.url).href === new URL(reference.target_ref).href) targetSeen = true; } catch { /* local targets cannot claim HTTP evidence */ }
      }
    }
  }
  if (!targetSeen) fail();
}
