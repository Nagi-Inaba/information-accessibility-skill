const safeActions = new Set(["inspect", "focus", "scroll", "expand", "collapse", "open_dialog", "close_dialog", "select_tab", "press_key", "type_non_secret", "activate_non_submitting_control"]);
const dangerousActions = Object.freeze(["submit_form", "purchase", "delete_data", "upload_file", "authenticate", "send_message", "accept_terms", "change_account", "install_software", "execute_code", "disclose_secret"]);
const approvalModes = new Set(["per_action", "session"]);
const utcInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function realUtcInstant(value) {
  return typeof value === "string" && utcInstant.test(value) && !Number.isNaN(Date.parse(value));
}

export function validateInteractionPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new Error("interaction policy must be an object");
  if (!["denied", "read_only", "supervised"].includes(policy.mode)) throw new Error("interaction policy mode must be denied, read_only, or supervised");
  if (policy.mode === "denied") return { mode: "denied", allowed_actions: [], forbidden_actions: [...dangerousActions] };
  const runId = requiredText(policy.run_id, "run_id");
  const targetSnapshotId = requiredText(policy.target_snapshot_id, "target_snapshot_id");
  if (policy.mode === "read_only") {
    return {
      mode: "read_only",
      run_id: runId,
      target_snapshot_id: targetSnapshotId,
      allowed_actions: ["inspect", "focus", "scroll"],
      forbidden_actions: [...dangerousActions]
    };
  }
  const supervisorId = requiredText(policy.supervisor_id, "supervisor_id");
  if (!approvalModes.has(policy.approval_mode)) throw new Error("approval_mode must be per_action or session");
  if (!Array.isArray(policy.allowed_actions) || policy.allowed_actions.length === 0) throw new Error("supervised policy requires allowed_actions");
  const allowedActions = [...new Set(policy.allowed_actions)];
  if (allowedActions.some((action) => !safeActions.has(action))) throw new Error("allowed_actions may contain only registered non-persistent interaction types");
  const normalized = {
    mode: "supervised",
    run_id: runId,
    target_snapshot_id: targetSnapshotId,
    supervisor_id: supervisorId,
    approval_mode: policy.approval_mode,
    allowed_actions: allowedActions.sort(),
    forbidden_actions: [...new Set([...dangerousActions, ...(policy.forbidden_actions ?? [])])].sort()
  };
  if (policy.approval_mode === "session") normalized.session_id = requiredText(policy.session_id, "session_id");
  return normalized;
}

export function authorizeInteraction(action, policy, approval = null) {
  const normalized = validateInteractionPolicy(policy);
  if (normalized.mode === "denied") throw new Error("Interaction is denied by policy");
  const actionId = requiredText(action?.action_id, "action.action_id");
  const actionType = requiredText(action?.type, "action.type");
  const target = requiredText(action?.target, "action.target");
  if (dangerousActions.includes(actionType)) throw new Error(`Persistent or high-impact interaction is forbidden: ${actionType}`);
  if (!normalized.allowed_actions.includes(actionType)) throw new Error(`Interaction type is not allowed: ${actionType}`);
  if (actionType === "type_non_secret" && (action.contains_secret === true || action.field_type === "password")) {
    throw new Error("Secret or password entry is forbidden");
  }

  let approvalReference = null;
  if (normalized.mode === "supervised") {
    if (approval?.approved !== true || approval.supervisor_id !== normalized.supervisor_id) throw new Error("Matching supervisor approval is required");
    if (!realUtcInstant(approval.approved_at)) throw new Error("approval.approved_at must be a real UTC RFC 3339 instant");
    if (normalized.approval_mode === "per_action") {
      if (approval.action_id !== actionId) throw new Error("Per-action approval must reference the exact action ID");
      approvalReference = actionId;
    } else {
      if (approval.session_id !== normalized.session_id) throw new Error("Session approval must reference the exact session ID");
      approvalReference = normalized.session_id;
    }
  }

  return {
    schema_version: "1.0.0",
    decision: "allowed",
    execution_performed: false,
    run_id: normalized.run_id,
    target_snapshot_id: normalized.target_snapshot_id,
    action_id: actionId,
    action_type: actionType,
    target,
    supervisor_id: normalized.supervisor_id ?? null,
    approval_mode: normalized.approval_mode ?? null,
    approval_reference: approvalReference,
    approved_at: approval?.approved_at ?? null,
    side_effect_boundary: "no_persistent_or_high_impact_side_effects"
  };
}
