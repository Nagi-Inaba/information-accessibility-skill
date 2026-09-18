import path from "node:path";
import { readStableFile } from "./audit-run.mjs";
import { parseAttestationJson } from "./attestation-canonical.mjs";
import { createAttestationTrust } from "./attestation-verifier.mjs";

export function readReviewJson(file, label = "review input") {
  const snapshot = readStableFile(path.resolve(file), { label, maxBytes: 8 * 1024 * 1024 });
  return { snapshot, value: structuredClone(parseAttestationJson(snapshot.bytes)) };
}

export function loadReviewTrust({ trustPolicy, trustPolicySha256 } = {}) {
  if (Boolean(trustPolicy) !== Boolean(trustPolicySha256)) throw new Error("--trust-policy and the independently selected --trust-policy-sha256 must be supplied together.");
  if (!trustPolicy) return { trust: undefined, snapshots: [] };
  const { value: policy, snapshot } = readReviewJson(trustPolicy, "external reviewer trust policy");
  return { trust: createAttestationTrust(policy, trustPolicySha256), snapshots: [snapshot] };
}
