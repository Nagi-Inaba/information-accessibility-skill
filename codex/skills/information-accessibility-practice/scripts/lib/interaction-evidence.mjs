import { interactionHash, assertInteractionPolicy } from "./interaction-policy.mjs";
import { canonicalJson } from "./canonical-json.mjs";
import { isRealInstant } from "./evidence-identity-validation.mjs";

// Offline consistency only. Neither an approval ID nor this hash chain is an
// authentication credential or permission to replay an operation.
export function validateInteractionEvidence(bytes, run, reference) {
  if (!["10.0.0", "11.0.0"].includes(run.schema_version)) return;
  const fail = () => { throw new Error("Interaction evidence has an invalid chain, approval, operation or run/target binding."); };
  let entries;
  try { entries = bytes.toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line)); } catch { fail(); }
  if (!entries.length || entries.length > 1002) fail();
  let previous = null, lastTime = -Infinity;
  for (const [index, entry] of entries.entries()) {
    const { sha256, ...body } = entry;
    if (entry.sequence !== index + 1 || entry.previous_sha256 !== previous || interactionHash(body) !== sha256
        || !isRealInstant(entry.at) || Date.parse(entry.at) < lastTime || Date.parse(entry.at) > Date.parse(reference.captured_at)) fail();
    previous = sha256; lastTime = Date.parse(entry.at);
  }
  const header = entries[0];
  if (header.kind !== "interaction-session" || header.schema_version !== "1.0.0" || header.run_id !== run.run_id
      || header.target_ref !== reference.target_ref || header.target_snapshot_id !== reference.target_snapshot_id
      || header.publication !== "private_by_default" || header.supervisor_authentication !== "host_reported_not_independently_authenticated"
      || canonicalJson(header.policy) !== canonicalJson(run.permissions.interaction_policy)
      || header.interaction_policy_sha256 !== (header.policy ? interactionHash(header.policy) : null)) fail();
  if (header.policy) assertInteractionPolicy(header.policy, run.target.urls_or_files);
  const previews = new Map(), approvals = new Map(), operations = new Map(), completed = new Set(), usedPerAction = new Set();
  let stopped = false;
  for (const entry of entries.slice(1, -1)) {
    if (entry.kind === "preview") {
      const p = entry.preview;
      if (!p || interactionHash(p) !== entry.preview_sha256 || previews.has(entry.preview_sha256)
          || p.run_id !== run.run_id || p.target_ref !== header.target_ref || p.target_snapshot_id !== header.target_snapshot_id
          || p.policy_sha256 !== header.interaction_policy_sha256 || p.adapter !== "chromium-frozen-focus-v1"
          || !["per_action", "per_run"].includes(p.approval_mode) || p.expires_at !== header.policy?.expires_at) fail();
      previews.set(entry.preview_sha256, p);
    } else if (entry.kind === "approval") {
      const preview = previews.get(entry.preview_sha256);
      if (!preview || approvals.has(entry.approval_id) || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(entry.approval_id)
          || canonicalJson(entry.supervisor) !== canonicalJson(header.policy?.supervisor)
          || entry.approval_mode !== preview.approval_mode || !isRealInstant(entry.expires_at)
          || Date.parse(entry.expires_at) <= Date.parse(entry.at) || Date.parse(entry.expires_at) > Date.parse(preview.expires_at)) fail();
      approvals.set(entry.approval_id, { ...entry, preview });
    } else if (entry.kind === "before") {
      const approval = approvals.get(entry.approval_id), policy = header.policy;
      if (stopped || header.adapter !== "chromium-frozen-focus-v1" || run.permissions.interaction !== "human_supervised"
          || !policy || !approval || operations.has(entry.operation_id) || entry.action?.operation !== "focus"
          || !["next", "previous"].includes(entry.action.direction) || Object.keys(entry.action).length !== 2
          || !policy.allowed_operations.includes("focus") || policy.forbidden_operations.includes("focus")
          || !policy.scope.includes(header.target_ref) || entry.state?.url !== header.target_ref
          || !/^[a-f0-9]{64}$/u.test(entry.state?.dom_sha256)
          || !run.target_inventory.snapshots.find((item) => item.snapshot_id === header.target_snapshot_id)?.evidence_bindings.some((binding) => binding.evidence_type === "dom_snapshot" && binding.sha256 === entry.state.dom_sha256)
          || Date.parse(entry.at) < Date.parse(policy.starts_at) || Date.parse(entry.at) >= Date.parse(approval.expires_at)
          || Date.parse(entry.at) >= Date.parse(policy.expires_at)) fail();
      if (approval.approval_mode === "per_action") {
        if (usedPerAction.has(entry.approval_id) || approval.preview.operation_id !== entry.operation_id
            || canonicalJson(approval.preview.action) !== canonicalJson(entry.action)) fail();
        usedPerAction.add(entry.approval_id);
      } else if (policy.approval_mode !== "per_run" || policy.requires_per_action_confirmation.includes("focus")
          || canonicalJson(approval.preview.allowed_operations) !== canonicalJson(policy.allowed_operations)) fail();
      operations.set(entry.operation_id, entry);
    } else if (entry.kind === "after") {
      const before = operations.get(entry.operation_id);
      if (!before || completed.has(entry.operation_id) || before.approval_id !== entry.approval_id || !["succeeded", "indeterminate"].includes(entry.result)) fail();
      if (entry.result === "succeeded") {
        const approval = approvals.get(entry.approval_id);
        if (stopped || entry.state?.url !== before.state.url || entry.state?.dom_sha256 !== before.state.dom_sha256
            || Date.parse(entry.at) >= Date.parse(approval.expires_at)
            || entry.side_effect !== "native_focus_only_scripts_and_network_disabled") fail();
      } else if (entry.side_effect !== "unknown") fail();
      completed.add(entry.operation_id);
    } else if (entry.kind === "failure") {
      if (!["not_executed", "indeterminate"].includes(entry.result)) fail();
      const before = operations.get(entry.operation_id);
      if (entry.result === "indeterminate" && !before) fail();
      if (before) {
        if (completed.has(entry.operation_id) || before.approval_id !== entry.approval_id
            || entry.side_effect !== (entry.result === "indeterminate" ? "unknown" : "none_from_adapter")) fail();
        completed.add(entry.operation_id);
      }
    } else if (entry.kind === "stopped") {
      if (stopped || entry.effective_mode !== "read_only" || typeof entry.reason !== "string") fail();
      stopped = true;
    } else if (entry.kind === "denied") {
      if (entry.result !== "not_executed" || entry.approval_id !== null || entry.side_effect !== "none_from_adapter") fail();
    } else fail();
  }
  if (entries.at(-1).kind !== "closed" || entries.at(-1).effective_mode !== "read_only" || completed.size !== operations.size) fail();
}
