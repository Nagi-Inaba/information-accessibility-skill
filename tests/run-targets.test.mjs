import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createNetworkPolicy } from "../codex/skills/information-accessibility-practice/scripts/lib/network-policy.mjs";
import { observeRunTargets, targetInventoryErrors, checkRunTargets, consumeRunTargetCheck, compareRunTargets } from "../codex/skills/information-accessibility-practice/scripts/lib/run-targets.mjs";
import { canonicalJson } from "../codex/skills/information-accessibility-practice/scripts/lib/canonical-json.mjs";
import { createTargetIdentity, targetDigest } from "../codex/skills/information-accessibility-practice/scripts/lib/target-identity.mjs";

function setup(t, refs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-run-targets-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "page.html"), "<main>Before</main>");
  return { root, options: { baseDir: root }, run: {
    schema_version: "17.0.0",
    run_id: "RUN-20260918T000000Z-TARGET01",
    target: { name: "Fixture", version_or_commit: "fixture-1", urls_or_files: refs ?? ["page.html"] },
    environment: { os: ["Fixture"], browsers: [], assistive_technologies: [], input_modes: [] },
    permissions: { network: "denied" }, artifacts: []
  } };
}
const specs = [{ kind: "file", target_ref: "page.html" }];

test("run target inventory covers exact references, retains measured identities, and is immutable", async (t) => {
  const { run, options } = setup(t);
  const inventory = await observeRunTargets(run, specs, options);
  assert.deepEqual(targetInventoryErrors(inventory, run), []);
  assert.equal(inventory.publication, "private_by_default");
  assert.equal(inventory.snapshots[0].kind, "file");
  assert.ok(Object.isFrozen(inventory.snapshots[0].identity));
  await assert.rejects(observeRunTargets(run, [{ kind: "file", target_ref: "unrequested.html" }], options), /exactly the run target/);
  await assert.rejects(observeRunTargets(run, [...specs, ...specs], options), /Duplicate|duplicate/);
  await assert.rejects(observeRunTargets(run, [], options), /between 1 and 32/);
});

test("offline inventory validation rejects changed context, identity, publication, or unknown fields", async (t) => {
  const { run, options } = setup(t);
  const inventory = await observeRunTargets(run, specs, options);
  for (const mutate of [
    (value) => { value.snapshots[0].identity.sha256 = "0".repeat(64); },
    (value) => { value.publication = "public"; },
    (value) => { value.allow_network = true; },
    (value) => { value.run_id = "RUN-20260918T000000Z-TARGET02"; },
    (value) => { value.snapshots = [null]; }
  ]) {
    const altered = structuredClone(inventory);
    mutate(altered);
    assert.ok(targetInventoryErrors(altered, run).length);
  }
  const changed = structuredClone(run);
  changed.environment.os = ["Different"];
  assert.match(targetInventoryErrors(inventory, changed).join("\n"), /environment_sha256/);
});

test("distinct measurements cannot masquerade as one declared target reference", async (t) => {
  const { run, options } = setup(t);
  await assert.rejects(observeRunTargets(run, [specs[0], { kind: "git", target_ref: "page.html", paths: ["src"] }], options), /Duplicate target reference/);
  const inventory = structuredClone(await observeRunTargets(run, specs, options));
  const first = inventory.snapshots[0];
  inventory.snapshots.push(createTargetIdentity({ kind: "file", targetRef: first.target_ref,
    identity: { ...first.identity, canonical_path: `${first.identity.canonical_path}.different` },
    evidenceBindings: first.evidence_bindings }));
  const { sha256, ...body } = inventory;
  inventory.sha256 = targetDigest(canonicalJson(body));
  assert.match(targetInventoryErrors(inventory, run).join("\n"), /exactly one snapshot/);
});

test("run target checks are in-process, single-use, and bound to all run fields", async (t) => {
  const { run, options } = setup(t);
  const inventory = await observeRunTargets(run, specs, options);
  const check = await checkRunTargets(run, inventory, options);
  assert.throws(() => consumeRunTargetCheck(structuredClone(check), run, inventory), /in-process/);
  const accepted = consumeRunTargetCheck(check, run, inventory);
  assert.deepEqual(accepted.snapshot_ids, inventory.snapshots.map((snapshot) => snapshot.snapshot_id));
  assert.ok(accepted.observations[0].observed_at);
  assert.throws(() => consumeRunTargetCheck(check, run, inventory), /reused/);
  const second = await checkRunTargets(run, inventory, options);
  run.artifacts.push({ artifact_id: "ART-NEW" });
  assert.throws(() => consumeRunTargetCheck(second, run, inventory), /different run/);
});

test("file drift is rejected during checking and again when a check is consumed", async (t) => {
  const { root, run, options } = setup(t);
  const inventory = await observeRunTargets(run, specs, options);
  const check = await checkRunTargets(run, inventory, options);
  fs.writeFileSync(path.join(root, "page.html"), "<main>After</main>");
  assert.throws(() => consumeRunTargetCheck(check, run, inventory), (error) => error.code === "TARGET_DRIFT");
  await assert.rejects(checkRunTargets(run, inventory, options), (error) => error.code === "TARGET_DRIFT");
});

test("before/after comparisons separate target identity from environment changes and remain offline", async (t) => {
  const { root, run, options } = setup(t);
  const before = await observeRunTargets(run, specs, options);
  const afterRun = structuredClone(run);
  afterRun.run_id = "RUN-20260918T000000Z-TARGET02";
  afterRun.target.version_or_commit = "fixture-2";
  afterRun.environment.os = ["Different"];
  const after = await observeRunTargets(afterRun, specs, options);
  const unchanged = compareRunTargets(run, before, afterRun, after)[0];
  assert.equal(unchanged.status, "identity_unchanged");
  assert.equal(unchanged.environment_changed, true);
  fs.writeFileSync(path.join(root, "page.html"), "New content");
  const changed = await observeRunTargets(afterRun, specs, options);
  fs.unlinkSync(path.join(root, "page.html"));
  assert.deepEqual(targetInventoryErrors(before, run), []);
  const comparison = compareRunTargets(run, before, afterRun, changed)[0];
  assert.equal(comparison.status, "identity_changed");
  assert.ok(comparison.comparison.changed_identity_fields.includes("sha256"));
});

async function localServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test("HTTP inventory requires run permission and fresh explicit caller network policy", async (t) => {
  let requests = 0;
  let content = "Original";
  const origin = await localServer(t, (_req, response) => { requests += 1; response.end(content); });
  const { run } = setup(t, [origin]);
  const httpSpecs = [{ kind: "http", target_ref: origin }];
  const options = { networkPolicy: { network: "allowlisted", allowedOrigins: [origin], allowLocalhost: true } };
  await assert.rejects(observeRunTargets(run, httpSpecs, options), /both run permission/);
  run.permissions.network = "allowlisted";
  run.permissions.network_policy = createNetworkPolicy({ targetOrigins: [origin], allowLocalhost: true });
  await assert.rejects(observeRunTargets(run, httpSpecs), /explicit caller network policy/);
  assert.equal(requests, 0);
  const inventory = await observeRunTargets(run, httpSpecs, options);
  await assert.rejects(checkRunTargets(run, inventory), /explicit caller network policy/);
  assert.equal(requests, 1);
  const token = await checkRunTargets(run, inventory, options);
  assert.equal(requests, 2);
  consumeRunTargetCheck(token, run, inventory);
  assert.equal(requests, 2);
  assert.deepEqual(targetInventoryErrors(inventory, run), []);
  assert.equal(requests, 2);
  content = "Changed";
  await assert.rejects(checkRunTargets(run, inventory, options), (error) => error.code === "TARGET_DRIFT");
});

test("mutating caller run permission while awaiting HTTP cannot produce an accepted inventory or check", async (t) => {
  let onRequest = () => {};
  const origin = await localServer(t, (_req, response) => { onRequest(); response.end("Stable"); });
  const { run } = setup(t, [origin]);
  run.permissions.network = "allowlisted";
  run.permissions.network_policy = createNetworkPolicy({ targetOrigins: [origin], allowLocalhost: true });
  const options = { networkPolicy: { network: "allowlisted", allowedOrigins: [origin], allowLocalhost: true } };
  const inventory = await observeRunTargets(run, [{ kind: "http", target_ref: origin }], options);
  onRequest = () => { run.permissions.network = "denied"; };
  await assert.rejects(checkRunTargets(run, inventory, options), /changed during verification/);
  run.permissions.network = "allowlisted";
  await assert.rejects(observeRunTargets(run, [{ kind: "http", target_ref: origin }], options), /changed during target observation/);
});
