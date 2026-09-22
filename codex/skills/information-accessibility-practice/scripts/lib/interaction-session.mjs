import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertNewOutputPath, inspectRealComponents, validateAuditRun } from "./audit-run.mjs";
import { assertInteractionPolicy, interactionHash } from "./interaction-policy.mjs";
import { isBrowserInteractionAdapter } from "./browser-interaction-adapter.mjs";
import { canonicalJson } from "./canonical-json.mjs";

const supervisors = new WeakMap();

// This is a host integration boundary, not an authentication service. The host
// must obtain the current human's decision through its own trusted UI. JSON,
// saved run permissions and a declared-human-review artifact are not handles.
export function createInteractionSupervisor({ identity, role, confirm, isPresent }) {
  if (typeof identity !== "string" || !identity.trim() || typeof role !== "string" || !role.trim()
      || typeof confirm !== "function" || typeof isPresent !== "function") throw new Error("Live supervisor callbacks and identity/role are required.");
  const state = { identity, role, confirm, isPresent, revoked: false, usedIds: new Set(), stops: new Set() };
  const handle = Object.freeze({ revoke() {
    state.revoked = true;
    for (const stop of state.stops) stop("supervisor_revoked");
  } });
  supervisors.set(handle, state);
  return handle;
}

function journal(file, root, header) {
  const parent = inspectRealComponents(root, { type: "directory", label: "private artifact root" }).absolute;
  const relative = path.relative(parent, path.resolve(file));
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) throw new Error("Interaction log must remain inside the private artifact root.");
  assertNewOutputPath(file);
  const fd = fs.openSync(file, "wx+", 0o600);
  let bytes = Buffer.alloc(0), sequence = 0, previous = null, closed = false;
  const append = (event) => {
    if (closed) throw new Error("Interaction journal is closed.");
    const stat = fs.fstatSync(fd);
    inspectRealComponents(file, { type: "file", label: "interaction journal" });
    const current = fs.lstatSync(file);
    if (!current.isFile() || current.isSymbolicLink() || current.ino !== stat.ino || current.dev !== stat.dev || stat.size !== bytes.length) throw new Error("Interaction journal changed outside the session.");
    const saved = Buffer.alloc(bytes.length);
    fs.readSync(fd, saved, 0, saved.length, 0);
    if (!saved.equals(bytes)) throw new Error("Interaction journal bytes changed outside the session.");
    const entry = { sequence: sequence + 1, previous_sha256: previous, at: new Date().toISOString(), ...event };
    entry.sha256 = interactionHash(entry);
    const next = Buffer.from(`${JSON.stringify(JSON.parse(canonicalJson(entry)))}\n`);
    if (fs.writeSync(fd, next, 0, next.length, bytes.length) !== next.length) throw new Error("Incomplete interaction journal write.");
    fs.fsyncSync(fd); // No action may start until its approval and before-state are durable.
    bytes = Buffer.concat([bytes, next]); sequence++; previous = entry.sha256;
    return entry;
  };
  try { append(header); } catch (error) { fs.closeSync(fd); throw error; }
  return { append, close() { if (!closed) { closed = true; fs.closeSync(fd); } }, digest() { return crypto.createHash("sha256").update(bytes).digest("hex"); } };
}

export function createInteractionSession({ run, runFile, targetRef, supervisor, adapter, logFile }) {
  run = structuredClone(run);
  const validation = validateAuditRun(run, { runFile });
  if (!validation.valid || run.schema_version !== "13.0.0") throw new Error("Interaction session requires a valid current run.");
  const target = run.target_inventory?.snapshots.find((item) => item.target_ref === targetRef);
  if (!target) throw new Error("Interaction requires a measured target snapshot.");
  const policy = structuredClone(run.permissions.interaction_policy);
  if (policy) assertInteractionPolicy(policy, run.target.urls_or_files);
  const live = supervisors.get(supervisor);
  const registered = isBrowserInteractionAdapter(adapter);
  const trail = journal(logFile, validation.artifactRoot, { kind: "interaction-session", schema_version: "1.0.0",
    run_id: run.run_id, target_ref: targetRef, target_snapshot_id: target.snapshot_id,
    interaction_policy_sha256: policy ? interactionHash(policy) : null, policy,
    adapter: registered ? adapter.id : "unsupported", publication: "private_by_default",
    supervisor_authentication: "host_reported_not_independently_authenticated",
    limitations: ["Only native focus order with page scripts and further network access disabled is supported; application keyboard handlers, dialogs and navigation are not exercised.", "A local hash chain detects changes when compared with the saved evidence hash; it is not an external signature or authenticated identity."] });
  let closed = false, busy = false, stopped = false, runApproval = null, actionCount = 0, journalFailure = null;
  const reason = () => {
    if (closed || stopped) return "session_stopped";
    if (!registered) return "adapter_unsupported";
    if (run.permissions.interaction !== "human_supervised" || !policy) return "read_only_permission";
    if (!live || live.revoked) return "supervisor_absent_or_revoked";
    try { if (live.isPresent() !== true) return "supervisor_absent"; } catch { return "supervisor_presence_unavailable"; }
    if (live.identity !== policy.supervisor.identity || live.role !== policy.supervisor.role) return "supervisor_mismatch";
    if (!policy.scope.includes(targetRef)) return "target_outside_interaction_scope";
    if (Date.now() < Date.parse(policy.starts_at) || Date.now() >= Date.parse(policy.expires_at)) return "supervision_expired_or_not_started";
    return null;
  };
  const emergencyStop = (stopReason = "emergency_stop") => {
    if (stopped || closed) return;
    stopped = true;
    try { trail.append({ kind: "stopped", reason: stopReason, effective_mode: "read_only" }); }
    catch (error) { journalFailure = error; }
    finally { if (registered) adapter.stop(); }
  };
  live?.stops.add(emergencyStop);
  const deny = (action, why) => {
    trail.append({ kind: "denied", action, reason: why, approval_id: null, result: "not_executed", side_effect: "none_from_adapter" });
    return { executed: false, effective_mode: "read_only", reason: why };
  };
  return Object.freeze({
    get mode() { return reason() || !runApproval ? "read_only" : "human_supervised"; },
    async execute(requestedAction) {
      const action = structuredClone(requestedAction);
      if (closed) throw new Error("Interaction session is closed.");
      if (busy) return deny(action, "concurrent_operation_denied");
      if (++actionCount > 200) { emergencyStop(); throw new Error("Interaction operation limit reached."); }
      const initial = reason();
      if (initial) return deny(action, initial);
      if (!policy.allowed_operations.includes(action?.operation) || policy.forbidden_operations.includes(action?.operation)) return deny(action, "operation_forbidden");
      if (!adapter.supports(action)) return deny(action, "operation_not_enforced_by_adapter");
      busy = true;
      let timer, presenceTimer, approval, before, started = false;
      const operationId = `ACT-${String(actionCount).padStart(4, "0")}`;
      try {
        const perAction = policy.approval_mode === "per_action" || policy.requires_per_action_confirmation.includes(action.operation);
        approval = !perAction && runApproval && Date.now() < Date.parse(runApproval.expires_at) ? runApproval : null;
        if (!approval) {
          const preview = { nonce: crypto.randomUUID(), run_id: run.run_id, target_ref: targetRef, target_snapshot_id: target.snapshot_id,
            policy_sha256: interactionHash(policy), approval_mode: perAction ? "per_action" : "per_run",
            operation_id: perAction ? operationId : null, action: perAction ? action : null,
            allowed_operations: perAction ? [action.operation] : policy.allowed_operations,
            expires_at: policy.expires_at, adapter: adapter.id };
          const previewHash = interactionHash(preview);
          trail.append({ kind: "preview", preview, preview_sha256: previewHash });
          const response = await live.confirm(Object.freeze(structuredClone({ ...preview, preview_sha256: previewHash })));
          const invalid = reason();
          if (invalid) return deny(action, invalid);
          if (response?.approved !== true || response.preview_sha256 !== previewHash || typeof response.approval_id !== "string"
              || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(response.approval_id)
              || live.usedIds.has(response.approval_id) || !Number.isFinite(Date.parse(response.expires_at))
              || Date.parse(response.expires_at) <= Date.now() || Date.parse(response.expires_at) > Date.parse(policy.expires_at)) return deny(action, "live_approval_missing_expired_or_replayed");
          approval = { approval_id: response.approval_id, expires_at: response.expires_at, approval_mode: preview.approval_mode, preview_sha256: previewHash };
          live.usedIds.add(approval.approval_id);
          trail.append({ kind: "approval", ...approval, supervisor: policy.supervisor });
          if (!perAction) runApproval = approval;
        }
        await adapter.prepare();
        before = await adapter.snapshot();
        if (before.url !== targetRef || !target.evidence_bindings.some((binding) => binding.evidence_type === "dom_snapshot" && binding.sha256 === before.dom_sha256)) return deny(action, "target_document_changed_or_no_measured_dom");
        const invalid = reason();
        if (invalid || Date.now() >= Date.parse(approval.expires_at)) return deny(action, invalid ?? "approval_expired");
        trail.append({ kind: "before", operation_id: operationId, action, approval_id: approval.approval_id, state: before });
        const beforeDispatch = reason();
        if (beforeDispatch || Date.now() >= Date.parse(approval.expires_at)) {
          trail.append({ kind: "failure", operation_id: operationId, approval_id: approval.approval_id,
            result: "not_executed", reason: beforeDispatch ?? "approval_expired", side_effect: "none_from_adapter" });
          return { executed: false, effective_mode: "read_only", reason: beforeDispatch ?? "approval_expired" };
        }
        // Expiry/revocation can interrupt an in-flight adapter operation. They
        // never retract already performed actions; those remain indeterminate.
        timer = setTimeout(() => emergencyStop("approval_expired"), Math.max(1, Math.min(Date.parse(approval.expires_at), Date.parse(policy.expires_at)) - Date.now()));
        presenceTimer = setInterval(() => { const absent = reason(); if (absent) emergencyStop(absent); }, 50);
        started = true;
        await adapter.perform(action, () => !reason() && Date.now() < Date.parse(approval.expires_at));
        const after = await adapter.snapshot();
        const invalidAfter = reason();
        if (invalidAfter || after.url !== before.url || after.dom_sha256 !== before.dom_sha256) {
          emergencyStop(invalidAfter ?? "document_changed");
          trail.append({ kind: "after", operation_id: operationId, approval_id: approval.approval_id, state: after,
            result: "indeterminate", reason: invalidAfter ?? "document_changed", side_effect: "unknown" });
          return { executed: true, effective_mode: "read_only", reason: invalidAfter ?? "document_changed" };
        }
        trail.append({ kind: "after", operation_id: operationId, approval_id: approval.approval_id, state: after,
          result: "succeeded", side_effect: "native_focus_only_scripts_and_network_disabled" });
        return { executed: true, effective_mode: "human_supervised", approval_id: approval.approval_id, after };
      } catch (error) {
        emergencyStop("adapter_or_approval_failed");
        trail.append({ kind: "failure", operation_id: operationId, approval_id: approval?.approval_id ?? null,
          result: started ? "indeterminate" : "not_executed", reason: "adapter_or_approval_failed", side_effect: started ? "unknown" : "none_from_adapter" });
        throw error;
      } finally { clearTimeout(timer); clearInterval(presenceTimer); busy = false; }
    },
    close() {
      if (closed) return;
      if (busy) throw new Error("Cannot close an active interaction; revoke and await it first.");
      try { if (journalFailure) throw journalFailure; trail.append({ kind: "closed", effective_mode: "read_only" }); }
      finally { closed = true; live?.stops.delete(emergencyStop); trail.close(); }
    },
    logHash: () => trail.digest()
  });
}
