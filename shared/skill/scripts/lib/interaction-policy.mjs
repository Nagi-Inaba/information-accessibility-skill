import crypto from "node:crypto";
import { canonicalJson } from "./canonical-json.mjs";
import { validateJsonSchema } from "./json-schema.mjs";

export const INTERACTION_OPERATIONS = ["focus", "expand", "open_modal", "navigate_same_origin", "navigate_cross_origin", "submit", "purchase", "publish", "upload", "download", "account_change", "consent", "delete"];
export const DEFAULT_FORBIDDEN_OPERATIONS = ["submit", "purchase", "publish", "upload", "download", "account_change", "consent", "delete"];
const operations = { type: "array", uniqueItems: true, maxItems: INTERACTION_OPERATIONS.length, items: { enum: INTERACTION_OPERATIONS } };
const text = { type: "string", minLength: 1, pattern: "^(?=[\\s\\S]{1,256}$)[\\s\\S]*\\S" };
export const INTERACTION_POLICY_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["schema_version", "supervisor", "scope", "starts_at", "expires_at", "approval_mode", "allowed_operations", "forbidden_operations", "requires_per_action_confirmation", "enforcement"],
  properties: {
    schema_version: { const: "1.0.0" },
    supervisor: { type: "object", additionalProperties: false, required: ["identity", "role"], properties: { identity: text, role: text } },
    scope: { type: "array", minItems: 1, maxItems: 32, uniqueItems: true, items: { type: "string", pattern: "^[\\s\\S]{1,4096}$" } },
    starts_at: { type: "string", format: "date-time" }, expires_at: { type: "string", format: "date-time" },
    approval_mode: { enum: ["per_run", "per_action"] },
    allowed_operations: { ...operations, minItems: 1 }, forbidden_operations: { ...operations, minItems: 1 },
    requires_per_action_confirmation: operations,
    enforcement: { const: "live_supervisor_and_registered_adapter_required" }
  }
};

export function interactionPolicyErrors(policy, targetRefs) {
  const errors = [];
  validateJsonSchema(policy, INTERACTION_POLICY_SCHEMA, "interaction_policy", errors);
  if (errors.length) return errors;
  const start = Date.parse(policy.starts_at), end = Date.parse(policy.expires_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 8 * 60 * 60 * 1000) errors.push("Interaction supervision must have a positive duration of at most eight hours.");
  if (DEFAULT_FORBIDDEN_OPERATIONS.some((operation) => !policy.forbidden_operations.includes(operation))) errors.push("Side-effect operations must remain explicitly forbidden; this adapter has no separate side-effect authorization mechanism.");
  if (policy.allowed_operations.some((operation) => policy.forbidden_operations.includes(operation))) errors.push("Allowed and forbidden interaction operations overlap.");
  if (policy.requires_per_action_confirmation.some((operation) => !policy.allowed_operations.includes(operation))) errors.push("Per-action confirmations must name allowed operations.");
  if (policy.allowed_operations.includes("navigate_cross_origin") && !policy.requires_per_action_confirmation.includes("navigate_cross_origin")) errors.push("Cross-origin navigation requires per-action confirmation.");
  if (targetRefs && policy.scope.some((ref) => !targetRefs.includes(ref))) errors.push("Interaction scope must use exact declared run targets.");
  return errors;
}

export function assertInteractionPolicy(policy, targetRefs) {
  const errors = interactionPolicyErrors(policy, targetRefs);
  if (errors.length) throw new Error(errors.join("\n"));
  return policy;
}

export const interactionHash = (value) => crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");

export function interactionScopeSummary(permissions) {
  const policy = permissions?.interaction_policy;
  return { declared_mode: permissions?.interaction ?? "unknown", effective_mode: "read_only",
    enforcement: policy ? "live_approval_required_not_established_by_manifest" : "no_live_supervision_evidence",
    allowed_operation_count: policy?.allowed_operations?.length ?? 0,
    approval_mode: policy?.approval_mode ?? null,
    supervisor_identity: "withheld", host_enforcement: "not_verified" };
}

export function interactionScopeText(scope, locale = "en") {
  return locale === "ja"
    ? `操作承認: 宣言=${scope.declared_mode}。保存済みrunだけでは監督中と扱わず、実行時の承認・期限・操作履歴が必要です。現在の対応はスクリプトと追加通信を停止した状態でのTab／Shift+Tabで、アプリ固有のキー操作は未確認です。承認者情報は非公開です。`
    : `Interaction approval: declared=${scope.declared_mode}. A saved run does not establish live supervision; runtime approval, expiry and operation evidence are required. Current support is native Tab/Shift+Tab with scripts and further network disabled; application keyboard behavior is unverified. Supervisor identity is private.`;
}
