# Supervised interaction and private operation evidence

Current run 13.0.0 requires `permissions.interaction_policy`. It is `null` for `read_only`. `human_supervised` requires the concrete policy below. Creating or reading this JSON records a proposed supervision scope; it does not establish live permission, authenticate a person, or authorize source writes. Run 12 and earlier remain read-only under their frozen schemas.

## Define the scope before starting a run

Supply a UTF-8 JSON file with `init --interaction human_supervised --interaction-policy <private-policy.json>`. Use the actual agreed start and expiry times; the supervision window must be positive and no longer than eight hours. The following values illustrate the shape and must be replaced with the current supervisor, target and times:

```json
{
  "schema_version": "1.0.0",
  "supervisor": { "identity": "supervisor-reference", "role": "accessibility owner" },
  "scope": ["https://example.com/"],
  "starts_at": "2026-09-19T09:00:00+09:00",
  "expires_at": "2026-09-19T10:00:00+09:00",
  "approval_mode": "per_action",
  "allowed_operations": ["focus"],
  "forbidden_operations": ["submit", "purchase", "publish", "upload", "download", "account_change", "consent", "delete"],
  "requires_per_action_confirmation": [],
  "enforcement": "live_supervisor_and_registered_adapter_required"
}
```

`scope` contains exact declared run targets. `per_run` permits reuse of one live approval only within that session's run, measured target, allowed operations and expiry. `per_action` requests a new decision for each action. Operations listed in `requires_per_action_confirmation` always need a separate decision. Cross-origin navigation must be on that list if declared, but is currently unsupported by the browser adapter. The mandatory forbidden operations cannot be enabled by this policy; a future side-effect adapter would need a separate authorization design.

## Connect a host's live approval UI

The JavaScript integration is `createInteractionSupervisor` in `scripts/lib/interaction-session.mjs`. It requires identity/role and two host callbacks: `isPresent()` must synchronously return `true` for the current supervisor; `confirm(preview)` must obtain the current human's decision using the host's trusted UI. The preview includes run ID, target reference and measured snapshot ID, operation or run scope, adapter, expiry and a unique challenge hash. An approved response contains `approved: true`, a unique 8–128 character `approval_id` using letters, digits, `_` or `-`, the exact `preview_sha256`, and an `expires_at` no later than the policy expiry. Reused IDs, stale challenges, JSON copies of a supervisor handle and expired responses are rejected.

Pass the live handle to `captureWebEvidence` or `runAutomatedWebScan` through `interaction: { supervisor, runFile, logFile }`, alongside the validated `networkRun` and explicit `networkCaller` scope. `logFile` must be a new file inside the run's private artifact root. First capture a baseline without interaction, save it as a web-state target and bind its measured inventory. Before every action, the adapter checks the current DOM hash against that measured snapshot. Changed documents need a new measured run; approval is not silently transferred.

The CLI has no live supervision UI and never reconstructs a supervisor from a file or flag. Run-backed captures without this host integration skip keyboard sampling and report `read_only`. A generic browser tool, external host, standalone legacy capture, declared-human-review record, or source fix authorization cannot claim this adapter's supervision enforcement.

## Supported browser behavior

`chromium-frozen-focus-v1` supports only `{ "operation": "focus", "direction": "next" }` and `previous`, using native Tab or Shift+Tab. It drains the run-bound HTTP gateway, disables page script execution, stops further network access and loading, and keeps the disposable page frozen until capture ends. This samples native focus order on the measured rendered DOM. Application keyboard handlers, script-driven widgets, dialogs, expansion and navigation are not exercised. Unsupported operations are denied before any input is dispatched. A focus-triggered handler cannot submit a form or send a request through this path. Chrome E2E fixtures verify that boundary; other browsers and hosts are not thereby verified.

`supervisor.revoke()` stops every attached session. Presence and expiry are checked when approving, after preparing and persisting the before-state, and immediately before dispatch. An expiry timer and presence polling also stop in-flight work. Read-only status takes effect on absence, expiry, revocation or adapter failure. A keyboard event already sent to Chrome cannot be recalled; interruption is recorded as `indeterminate`, never as a confirmed success.

## Preserve the private trail

Each session creates an exclusive JSONL file and appends a header, previews, approvals, before/after states, denials, stop reasons and close event. Each entry has a sequence, timestamp, previous hash and its own hash. Approvals and before-states are flushed to disk before input. The writer refuses external replacement, truncation or edits. The trail contains supervisor details, raw target references and focus text, so keep it private. Windows file access follows the artifact directory's ACL; the script does not make that directory confidential by itself.

Bind the closed file with `bind-evidence --type interaction_log` as saved evidence. Normal evidence binding, registration and validation check its raw hash, chain, run/target/policy bindings, approval scope and action ordering. A stopped session cannot contain a subsequent action start. An interrupted or unclosed file remains forensic material and cannot be registered as a complete interaction log. The hash chain is not an external signature, an authenticated identity or permission to replay an action.

`status` is an internal diagnostic and includes private run permissions. Public report models and both report formats expose only a redacted interaction summary and limitations; they do not copy identities, roles, approval IDs, private log paths or event contents. Reports still require human review before any standards-level conclusion.
