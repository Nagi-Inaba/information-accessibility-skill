import { canonicalJson } from "./canonical-json.mjs";
import { targetDigest, targetIdentityErrors, compareTargetIdentities } from "./target-identity.mjs";
import { observeTarget, observeLocalTarget, assertTargetUnchanged } from "./target-observer.mjs";
import { assertNetworkPolicy } from "./network-policy.mjs";

const checks = new WeakMap();
const MAX_TARGETS = 32;
const CHECK_LIFETIME_MS = 30000;
const digest = (value) => targetDigest(canonicalJson(value));
const sorted = (values) => [...new Set(values)].sort();
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const context = (run) => ({ run_id: run.run_id, target_context_sha256: digest(run.target), environment_sha256: digest(run.environment) });

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) && same(Object.keys(value).sort(), [...expected].sort());
}

// The snapshot itself retains everything needed to remeasure the same scope.
// No serialized object can grant network access; the caller supplies that policy.
export function targetSpecification(snapshot) {
  const errors = targetIdentityErrors(snapshot);
  if (errors.length) throw new Error(`Invalid target identity:\n- ${errors.join("\n- ")}`);
  const spec = { kind: snapshot.kind, target_ref: snapshot.target_ref };
  if (snapshot.kind === "git") spec.paths = [...snapshot.identity.selected_paths];
  if (snapshot.kind === "web_state") Object.assign(spec, {
    bundle_path: snapshot.identity.bundle_path,
    locale: snapshot.identity.locale,
    authentication_state_id: snapshot.identity.authentication_state_id,
    feature_flags: [...snapshot.identity.feature_flags]
  });
  return spec;
}

function assertRunContext(run) {
  if (!run || typeof run.run_id !== "string" || !run.target || !run.environment
      || !Array.isArray(run.target.urls_or_files) || !run.target.urls_or_files.length
      || run.target.urls_or_files.some((ref) => typeof ref !== "string" || !ref.trim())) {
    throw new Error("A run with explicit target references and environment is required.");
  }
}

function assertNetworkPermission(run, specs, options) {
  if (specs.some((spec) => spec.kind === "http")
      && (run.permissions?.network !== "allowlisted" || options.networkPolicy?.network !== "allowlisted")) {
    throw new Error("HTTP target checks require both run permission and an explicit caller network policy.");
  }
  if (specs.some((spec) => spec.kind === "http")) {
    if (run.schema_version !== "11.0.0") throw new Error("HTTP target checks require a current run with a concrete network policy.");
    assertNetworkPolicy(run.permissions.network_policy);
    options.runNetworkPolicy = structuredClone(run.permissions.network_policy);
    options.runId = run.run_id;
  }
}

export function targetInventoryErrors(inventory, run) {
  const errors = [];
  try { assertRunContext(run); } catch (error) { return [error.message]; }
  if (!exactKeys(inventory, ["schema_version", "run_id", "target_context_sha256", "environment_sha256", "publication", "snapshots", "sha256"])) {
    return ["Target inventory must contain exactly the supported fields."];
  }
  if (inventory.schema_version !== "1.0.0") errors.push("Unsupported target inventory version.");
  if (inventory.publication !== "private_by_default") errors.push("Target inventory must remain private by default.");
  for (const [key, expected] of Object.entries(context(run))) if (inventory[key] !== expected) errors.push(`Target inventory ${key} does not match the run.`);
  const { sha256, ...body } = inventory;
  if (sha256 !== digest(body)) errors.push("Target inventory hash mismatch.");
  if (!Array.isArray(inventory.snapshots) || inventory.snapshots.length < 1 || inventory.snapshots.length > MAX_TARGETS) {
    return [...errors, `Target inventory requires between 1 and ${MAX_TARGETS} snapshots.`];
  }
  const ids = new Set();
  const specifications = new Set();
  const targetRefs = inventory.snapshots.map((snapshot) => snapshot?.target_ref);
  if (new Set(targetRefs).size !== targetRefs.length || targetRefs.length !== run.target.urls_or_files.length) {
    errors.push("Duplicate or missing target reference; exactly one snapshot per declared target is required.");
  }
  for (const [index, snapshot] of inventory.snapshots.entries()) {
    const snapshotErrors = targetIdentityErrors(snapshot);
    errors.push(...snapshotErrors.map((error) => `snapshots[${index}]: ${error}`));
    if (snapshotErrors.length) continue;
    if (ids.has(snapshot.snapshot_id)) errors.push("Duplicate target snapshot ID.");
    ids.add(snapshot.snapshot_id);
    const key = canonicalJson(targetSpecification(snapshot));
    if (specifications.has(key)) errors.push("Conflicting or duplicate measurements for the same target specification.");
    specifications.add(key);
  }
  if (!same(sorted(inventory.snapshots.map((snapshot) => snapshot?.target_ref)), sorted(run.target.urls_or_files))) {
    errors.push("Target inventory must cover exactly the run target references.");
  }
  return errors;
}

export async function observeRunTargetsWithEvidence(run, specifications, options = {}) {
  assertRunContext(run);
  if (!Array.isArray(specifications) || specifications.length < 1 || specifications.length > MAX_TARGETS) throw new Error(`Provide between 1 and ${MAX_TARGETS} target specifications.`);
  const runHash = digest(run);
  const specs = structuredClone(specifications);
  const fixedOptions = structuredClone(options);
  if (new Set(specs.map((spec) => spec?.target_ref)).size !== specs.length) throw new Error("Duplicate target reference; use one specification per declared target.");
  if (!same(sorted(specs.map((spec) => spec?.target_ref)), sorted(run.target.urls_or_files))) throw new Error("Target specifications must cover exactly the run target references.");
  assertNetworkPermission(run, specs, fixedOptions);
  const snapshots = [];
  const networkEvidence = [];
  for (const spec of specs) {
    let observation;
    try { observation = await observeTarget(spec, fixedOptions); }
    catch (error) {
      error.networkEvidence = { completed: networkEvidence, failed_target_ref: spec.target_ref, failed_log: error.networkLog ?? null };
      throw error;
    }
    snapshots.push(observation.snapshot);
    if (observation.network?.kind === "network-request-log") networkEvidence.push({ target_snapshot_id: observation.snapshot.snapshot_id, log: observation.network });
  }
  // Recheck local targets after awaiting other captures, including Git HEAD/index.
  for (const snapshot of snapshots) if (snapshot.kind !== "http") {
    assertSameTarget(snapshot, observeLocalTarget(targetSpecification(snapshot), fixedOptions).snapshot);
  }
  if (runHash !== digest(run)) throw Object.assign(new Error("Run context changed during target observation."), { networkEvidence: { completed: networkEvidence, failed_target_ref: null, failed_log: null } });
  snapshots.sort((a, b) => a.snapshot_id.localeCompare(b.snapshot_id, "en"));
  const body = { schema_version: "1.0.0", ...context(run), publication: "private_by_default", snapshots };
  const inventory = { ...body, sha256: digest(body) };
  const errors = targetInventoryErrors(inventory, run);
  if (errors.length) throw new Error(`Invalid target inventory:\n- ${errors.join("\n- ")}`);
  return freeze({ inventory, networkEvidence });
}

export async function observeRunTargets(run, specifications, options = {}) {
  return (await observeRunTargetsWithEvidence(run, specifications, options)).inventory;
}

function assertSameTarget(expected, actual) {
  const comparison = compareTargetIdentities(expected, actual);
  if (comparison.changed) {
    const error = new Error("Target drift detected; use a fresh run or an explicitly captured new state.");
    error.code = "TARGET_DRIFT";
    error.comparison = comparison;
    throw error;
  }
}

// A check is an in-process, single-use capability. Saving/copying its JSON does
// not authorize registration, and previous checks cannot be replayed on a new run.
export async function checkRunTargets(run, inventory, options = {}) {
  const startedAt = performance.now();
  const errors = targetInventoryErrors(inventory, run);
  if (errors.length) throw new Error(`Invalid target inventory:\n- ${errors.join("\n- ")}`);
  const fixedRun = structuredClone(run);
  const fixedInventory = structuredClone(inventory);
  const { onNetworkEvidence, ...copyableOptions } = options;
  const fixedOptions = structuredClone(copyableOptions);
  const specs = fixedInventory.snapshots.map(targetSpecification);
  assertNetworkPermission(fixedRun, specs, fixedOptions);
  const observations = [];
  for (const [index, snapshot] of fixedInventory.snapshots.entries()) {
    let observed;
    try { observed = await observeTarget(specs[index], fixedOptions); }
    catch (error) {
      if (error.networkLog) onNetworkEvidence?.({ target_snapshot_id: snapshot.snapshot_id, log: error.networkLog });
      throw error;
    }
    if (observed.network?.kind === "network-request-log") onNetworkEvidence?.({ target_snapshot_id: snapshot.snapshot_id, log: observed.network });
    assertSameTarget(snapshot, observed.snapshot);
    observations.push({ snapshot_id: observed.snapshot.snapshot_id, observed_at: observed.snapshot.observed_at });
  }
  if (!same(fixedRun, run) || !same(fixedInventory, inventory)) throw new Error("Run or target inventory changed during verification.");
  if (performance.now() - startedAt > CHECK_LIFETIME_MS) throw new Error("Target checks exceeded their shared freshness window; reduce the run scope.");
  const token = Object.freeze({});
  checks.set(token, { runHash: digest(run), inventoryHash: digest(inventory), inventory: fixedInventory,
    options: fixedOptions, observations, checkedAt: new Date().toISOString(), expiresAt: startedAt + CHECK_LIFETIME_MS });
  return token;
}

export function consumeRunTargetCheck(token, run, inventory) {
  const check = checks.get(token);
  checks.delete(token);
  if (!check) throw new Error("A fresh in-process target check is required; serialized or reused checks are not accepted.");
  if (check.runHash !== digest(run) || check.inventoryHash !== digest(inventory)) throw new Error("Target check belongs to a different run or inventory.");
  if (performance.now() > check.expiresAt) throw new Error("Target check expired; remeasure before registration.");
  for (const snapshot of check.inventory.snapshots) if (snapshot.kind !== "http") {
    assertSameTarget(snapshot, observeLocalTarget(targetSpecification(snapshot), check.options).snapshot);
  }
  if (performance.now() > check.expiresAt) throw new Error("Target check expired during local remeasurement; reduce the run scope.");
  return freeze({ checked_at: check.checkedAt, observations: check.observations,
    snapshot_ids: check.inventory.snapshots.map((snapshot) => snapshot.snapshot_id),
    limitations: ["HTTP identity is measured at check time, not continuously monitored.",
      "A saved rendered state is not a live authenticated session and does not authenticate its producer."] });
}

export function checkLocalRunTargets(run, inventory, options = {}) {
  const startedAt = performance.now();
  const errors = targetInventoryErrors(inventory, run);
  if (errors.length) throw new Error(`Invalid target inventory:\n- ${errors.join("\n- ")}`);
  if (inventory.snapshots.some((snapshot) => snapshot.kind === "http")) throw new Error("HTTP targets require an asynchronous check with an explicit caller network policy.");
  const observations = inventory.snapshots.map((snapshot) => {
    const observed = observeLocalTarget(targetSpecification(snapshot), options).snapshot;
    assertSameTarget(snapshot, observed);
    return { snapshot_id: observed.snapshot_id, observed_at: observed.observed_at };
  });
  const token = Object.freeze({});
  checks.set(token, { runHash: digest(run), inventoryHash: digest(inventory), inventory: structuredClone(inventory),
    options: structuredClone(options), observations, checkedAt: new Date().toISOString(), expiresAt: startedAt + CHECK_LIFETIME_MS });
  return token;
}

export function targetSnapshotIds(run) {
  return (run.target_inventory?.snapshots ?? []).map((snapshot) => snapshot.snapshot_id).sort();
}

export function targetBindingErrors(run, artifacts = []) {
  if (!["8.0.0", "9.0.0", "10.0.0", "11.0.0"].includes(run?.schema_version)) return [];
  const errors = [];
  if (run.target_inventory !== null) {
    errors.push(...targetInventoryErrors(run.target_inventory, run));
    if (errors.length) return errors;
  }
  const ids = targetSnapshotIds(run);
  for (const artifact of artifacts) {
    if (!Array.isArray(artifact?.target_snapshot_ids) || !same([...artifact.target_snapshot_ids].sort(), ids)) {
      errors.push(`${artifact?.artifact_id}: target_snapshot_ids must exactly match the fixed run target inventory.`);
    }
    const hasObservation = artifact?.artifact_type === "screening-observations"
      ? artifact.payload?.observations?.some((row) => row.evidence_level !== "E0" || row.evidence_refs?.length)
      : !["human-review-queue", "remediation-plan"].includes(artifact?.artifact_type);
    if (hasObservation && !ids.length) errors.push(`${artifact?.artifact_id}: bind measured targets before registering observations or authorization. An unmeasured run may contain only E0 planning evidence.`);
  }
  return errors;
}

export function compareRunTargets(beforeRun, beforeInventory, afterRun, afterInventory) {
  for (const [run, inventory] of [[beforeRun, beforeInventory], [afterRun, afterInventory]]) {
    const errors = targetInventoryErrors(inventory, run);
    if (errors.length) throw new Error(errors.join("\n"));
  }
  const refs = sorted([...beforeRun.target.urls_or_files, ...afterRun.target.urls_or_files]);
  return refs.map((targetRef) => {
    const before = beforeInventory.snapshots.filter((snapshot) => snapshot.target_ref === targetRef);
    const after = afterInventory.snapshots.filter((snapshot) => snapshot.target_ref === targetRef);
    const beforeIds = before.map((snapshot) => snapshot.snapshot_id).sort();
    const afterIds = after.map((snapshot) => snapshot.snapshot_id).sort();
    return { target_ref: targetRef, status: !before.length ? "added" : !after.length ? "removed" : same(beforeIds, afterIds) ? "identity_unchanged" : "identity_changed",
      environment_changed: beforeInventory.environment_sha256 !== afterInventory.environment_sha256,
      before_snapshot_ids: beforeIds, after_snapshot_ids: afterIds,
      comparison: before.length === 1 && after.length === 1 ? compareTargetIdentities(before[0], after[0]) : null };
  });
}
