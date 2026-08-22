import assert from "node:assert/strict";
import test from "node:test";
import { authorizeInteraction, validateInteractionPolicy } from "../codex/skills/information-accessibility-practice/scripts/lib/interaction-policy.mjs";

const base = {
  mode: "supervised",
  run_id: "RUN-1",
  target_snapshot_id: "TARGET-1",
  supervisor_id: "supervisor@example.invalid",
  approval_mode: "per_action",
  allowed_actions: ["focus", "expand", "type_non_secret"]
};

test("read-only mode permits inspection-oriented actions and blocks activation", () => {
  const policy = { mode: "read_only", run_id: "RUN-1", target_snapshot_id: "TARGET-1" };
  const log = authorizeInteraction({ action_id: "ACTION-1", type: "focus", target: "Checkout > Continue" }, policy);
  assert.equal(log.decision, "allowed");
  assert.equal(log.execution_performed, false);
  assert.equal(log.supervisor_id, null);
  assert.throws(() => authorizeInteraction({ action_id: "ACTION-2", type: "expand", target: "Help" }, policy), /not allowed/u);
});

test("per-action supervision requires the exact supervisor and action ID", () => {
  const action = { action_id: "ACTION-FOCUS", type: "focus", target: "Checkout > Continue" };
  const log = authorizeInteraction(action, base, {
    approved: true,
    supervisor_id: "supervisor@example.invalid",
    action_id: "ACTION-FOCUS",
    approved_at: "2026-08-22T00:00:00Z"
  });
  assert.equal(log.approval_reference, "ACTION-FOCUS");
  assert.equal(log.run_id, "RUN-1");
  assert.equal(log.target_snapshot_id, "TARGET-1");
  assert.equal(log.side_effect_boundary, "no_persistent_or_high_impact_side_effects");

  assert.throws(() => authorizeInteraction(action, base, {
    approved: true,
    supervisor_id: "someone-else",
    action_id: "ACTION-FOCUS",
    approved_at: "2026-08-22T00:00:00Z"
  }), /Matching supervisor approval/u);
  assert.throws(() => authorizeInteraction(action, base, {
    approved: true,
    supervisor_id: "supervisor@example.invalid",
    action_id: "ACTION-OTHER",
    approved_at: "2026-08-22T00:00:00Z"
  }), /exact action ID/u);
});

test("session supervision is bound to one declared session", () => {
  const policy = { ...base, approval_mode: "session", session_id: "SESSION-1" };
  const log = authorizeInteraction({ action_id: "ACTION-EXPAND", type: "expand", target: "Help panel" }, policy, {
    approved: true,
    supervisor_id: "supervisor@example.invalid",
    session_id: "SESSION-1",
    approved_at: "2026-08-22T00:00:00Z"
  });
  assert.equal(log.approval_reference, "SESSION-1");
  assert.throws(() => authorizeInteraction({ action_id: "ACTION-EXPAND", type: "expand", target: "Help panel" }, policy, {
    approved: true,
    supervisor_id: "supervisor@example.invalid",
    session_id: "SESSION-2",
    approved_at: "2026-08-22T00:00:00Z"
  }), /exact session ID/u);
});

test("persistent side effects and secret entry remain forbidden even under supervision", () => {
  assert.throws(() => validateInteractionPolicy({ ...base, allowed_actions: ["submit_form"] }), /non-persistent interaction types/u);
  assert.throws(() => authorizeInteraction({ action_id: "ACTION-SUBMIT", type: "submit_form", target: "Checkout form" }, base, {
    approved: true,
    supervisor_id: "supervisor@example.invalid",
    action_id: "ACTION-SUBMIT",
    approved_at: "2026-08-22T00:00:00Z"
  }), /forbidden|not allowed/u);
  assert.throws(() => authorizeInteraction({ action_id: "ACTION-TYPE", type: "type_non_secret", target: "Password", field_type: "password" }, base, {
    approved: true,
    supervisor_id: "supervisor@example.invalid",
    action_id: "ACTION-TYPE",
    approved_at: "2026-08-22T00:00:00Z"
  }), /Secret or password entry/u);
});

test("denied mode blocks all interactions", () => {
  assert.throws(() => authorizeInteraction({ action_id: "A", type: "inspect", target: "Page" }, { mode: "denied" }), /denied by policy/u);
});
