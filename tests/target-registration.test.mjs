import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createNetworkPolicy } from "../codex/skills/information-accessibility-practice/scripts/lib/network-policy.mjs";
import { fixtureInventory } from "./helpers/measured-targets.mjs";
import { createAuditRun, bindTargetInventory, registerArtifact, registerArtifactChecked, validateAuditRun, loadAuditResources, writeNewJson } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { observeRunTargets, checkRunTargets, targetSnapshotIds } from "../codex/skills/information-accessibility-practice/scripts/lib/run-targets.mjs";
import { createRunEvidenceReference } from "../codex/skills/information-accessibility-practice/scripts/lib/run-evidence.mjs";

const cliFile = fileURLToPath(new URL("../codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs", import.meta.url));
const cli = (args) => spawnSync(process.execPath, [cliFile, ...args], { encoding: "utf8", shell: false });
const pass = (result) => assert.equal(result.status, 0, result.stderr || result.stdout);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const at = "2026-09-18T00:00:00Z";

function fixture(t, refs = ["page.html"], network = "none") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-target-registration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifactRoot = path.join(root, "artifacts");
  fs.mkdirSync(artifactRoot);
  fs.writeFileSync(path.join(root, "page.html"), "<main>Before</main>");
  const runFile = path.join(root, "run.json");
  const run = createAuditRun({ runFile, artifactRoot, runId: "RUN-20260918T000000Z-REGTGT01", profile: "web-modern",
    targetName: "Measured target", targetVersion: "release-1", targetRefs: refs, network, interaction: "safe_read_only", sourceWrite: "none",
    networkPolicy: network === "allowlisted" ? createNetworkPolicy({ targetOrigins: refs, allowLocalhost: true }) : null,
    inspectionMode: "quick", inspectionPurpose: "Verify target drift" });
  writeNewJson(runFile, run);
  return { root, artifactRoot, runFile, run };
}

function screening(f, run, { id = "ART-TARGET-SCREEN", e0 = false, bytes = Buffer.from("<main>Before</main>"), evidenceType = "dom_snapshot" } = {}) {
  const refs = [];
  if (!e0) {
    const rawPath = `${id}.txt`;
    fs.writeFileSync(path.join(f.artifactRoot, rawPath), bytes);
    refs.push(createRunEvidenceReference({ run, targetRef: run.target.urls_or_files[0], evidenceType, relativePath: rawPath, bytes, capturedAt: at }));
  }
  return { schema_version: "3.0.0", artifact_id: id, artifact_type: "screening-observations", run_id: run.run_id,
    target_snapshot_ids: targetSnapshotIds(run), producer: { role_id: "e1_inspector", producer_kind: "ai_agent", origin: "target registration fixture" }, created_at: at, inputs: [],
    payload: { schema_version: "3.0.0", observations: [{ requirement_id: `SCREEN-${id.slice(4)}`, evidence_level: e0 ? "E0" : "E1", evidence_refs: refs,
      method: "Fixture inspection", location: "main", observation: e0 ? "Capture unavailable" : "Saved observation", captured_at: at,
      profile_requirement_id: null, report_outcome: null, applicability: "undetermined", report_rationale: "Unmapped observation" }] } };
}

function saveArtifact(f, artifact) {
  const file = path.join(f.artifactRoot, `${artifact.artifact_id}.json`);
  fs.writeFileSync(file, JSON.stringify(artifact), "utf8");
  return file;
}

async function boundFile(f) {
  const inventory = await observeRunTargets(f.run, [{ kind: "file", target_ref: "page.html" }], { baseDir: f.root });
  return bindTargetInventory(f.run, inventory, { runFile: f.runFile });
}

test("capture, bind and register CLI reject target drift while historical validation remains offline", (t) => {
  const f = fixture(t);
  const specs = path.join(f.root, "specs.json");
  writeNewJson(specs, [{ kind: "file", target_ref: "page.html" }]);
  const inventoryFile = path.join(f.artifactRoot, "targets.json");
  pass(cli(["capture-targets", "--run", f.runFile, "--specs", specs, "--output", inventoryFile]));
  const boundRunFile = path.join(f.root, "run-bound.json");
  pass(cli(["bind-targets", "--run", f.runFile, "--targets", inventoryFile, "--output", boundRunFile]));
  const bound = read(boundRunFile);
  const artifact = screening(f, bound);
  const artifactFile = saveArtifact(f, artifact);
  const registeredFile = path.join(f.root, "run-registered.json");
  pass(cli(["register", "--run", boundRunFile, "--artifact", artifactFile, "--output", registeredFile]));
  fs.writeFileSync(path.join(f.root, "page.html"), "<main>Changed</main>");
  const nextArtifact = screening(f, bound, { id: "ART-TARGET-SECOND" });
  const nextFile = saveArtifact(f, nextArtifact);
  const refusedOutput = path.join(f.root, "refused.json");
  const rejected = cli(["register", "--run", registeredFile, "--artifact", nextFile, "--output", refusedOutput]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Target drift/);
  assert.equal(fs.existsSync(refusedOutput), false);
  fs.unlinkSync(path.join(f.root, "page.html"));
  assert.equal(validateAuditRun(read(registeredFile), { runFile: registeredFile }).valid, true);
});

test("binding is one-shot and artifact IDs cannot refer to another measured snapshot", async (t) => {
  const f = fixture(t);
  const run = await boundFile(f);
  assert.throws(() => bindTargetInventory(run, run.target_inventory, { runFile: f.runFile }), /only be bound once/);
  const artifact = screening(f, run);
  artifact.target_snapshot_ids = [`TARGET-${"0".repeat(64)}`];
  const file = saveArtifact(f, artifact);
  assert.throws(() => registerArtifact(run, artifact, { runFile: f.runFile, artifactFile: file }), /target_snapshot_ids/);
  artifact.target_snapshot_ids = targetSnapshotIds(run);
  artifact.payload.observations[0].evidence_refs[0] = { ...artifact.payload.observations[0].evidence_refs[0], target_snapshot_id: `TARGET-${"1".repeat(64)}` };
  saveArtifact(f, artifact);
  assert.throws(() => registerArtifact(run, artifact, { runFile: f.runFile, artifactFile: file }), /target_snapshot_id/);
});

test("unmeasured runs support only E0 planning and cannot acquire targets after registration", async (t) => {
  const f = fixture(t);
  const artifact = screening(f, f.run, { e0: true });
  const file = saveArtifact(f, artifact);
  const planned = registerArtifact(f.run, artifact, { runFile: f.runFile, artifactFile: file });
  assert.equal(planned.target_inventory, null);
  artifact.payload.observations[0].evidence_level = "E1";
  saveArtifact(f, artifact);
  assert.throws(() => registerArtifact(f.run, artifact, { runFile: f.runFile, artifactFile: file }), /evidence_refs|measured targets/);
  artifact.payload.observations[0].evidence_level = "E0";
  saveArtifact(f, artifact);
  const inventory = await observeRunTargets(f.run, [{ kind: "file", target_ref: "page.html" }], { baseDir: f.root });
  assert.throws(() => bindTargetInventory(planned, inventory, { runFile: f.runFile }), /only be bound once/);
});

test("DOM evidence must be the bytes measured for its target, not just a valid private file", async (t) => {
  const f = fixture(t);
  const run = await boundFile(f);
  const artifact = screening(f, run, { bytes: Buffer.from("<main>Different capture</main>") });
  const file = saveArtifact(f, artifact);
  assert.throws(() => registerArtifact(run, artifact, { runFile: f.runFile, artifactFile: file }), /DOM or AX evidence bytes/);
});

test("HTTP registration requires fresh explicit policy and rejects a changed response", async (t) => {
  let body = "Response one";
  const server = http.createServer((_request, response) => response.end(body));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const f = fixture(t, [origin], "allowlisted");
  const networkPolicy = { network: "allowlisted", allowedOrigins: [origin], allowLocalhost: true };
  const inventory = await observeRunTargets(f.run, [{ kind: "http", target_ref: origin }], { networkPolicy });
  const token = await checkRunTargets(f.run, inventory, { networkPolicy });
  const run = bindTargetInventory(f.run, inventory, { runFile: f.runFile, targetCheck: token });
  const artifact = screening(f, run, { bytes: Buffer.from(body), evidenceType: "other" });
  const artifactFile = saveArtifact(f, artifact);
  assert.throws(() => registerArtifact(run, artifact, { runFile: f.runFile, artifactFile }), /asynchronous check/);
  await assert.rejects(registerArtifactChecked(run, artifact, { runFile: f.runFile, artifactFile }), /explicit caller network policy/);
  const registered = await registerArtifactChecked(run, artifact, { runFile: f.runFile, artifactFile, networkPolicy });
  assert.equal(registered.status, "screened");
  body = "Response two";
  await assert.rejects(registerArtifactChecked(run, artifact, { runFile: f.runFile, artifactFile, networkPolicy }), /Target drift/);
  assert.equal(validateAuditRun(registered, { runFile: f.runFile }).valid, true);
});

test("run7 retains its frozen read contract and cannot register or bind current targets", async (t) => {
  const f = fixture(t);
  const resources = loadAuditResources();
  const legacy = structuredClone(f.run);
  legacy.schema_version = "7.0.0";
  delete legacy.permissions.network_policy;
  delete legacy.permissions.interaction_policy;
  delete legacy.target_inventory;
  legacy.resource_versions.orchestration_registry_version = "6.0.0";
  legacy.resource_versions.orchestration_registry_sha256 = resources.orchestrationRegistries.get("6.0.0").sha256;
  assert.equal(validateAuditRun(legacy, { runFile: f.runFile }).valid, true);
  const inventory = await observeRunTargets(legacy, [{ kind: "file", target_ref: "page.html" }], { baseDir: f.root });
  assert.throws(() => bindTargetInventory(legacy, inventory, { runFile: f.runFile }), /read-only|read.only/);
  const artifact = screening(f, f.run, { e0: true });
  assert.throws(() => registerArtifact(legacy, artifact, { runFile: f.runFile, artifactFile: saveArtifact(f, artifact) }), /read-only|read.only/);
});

test("Git registration detects HEAD changes even when the selected working bytes are unchanged", async (t) => {
  const f = fixture(t, ["."]);
  const git = (args) => {
    const result = spawnSync("git", ["-c", "user.name=Target fixture", "-c", "user.email=fixture@users.noreply.github.com", ...args], { cwd: f.root, encoding: "utf8", shell: false });
    pass(result);
  };
  git(["init", "--quiet"]);
  git(["add", "page.html"]);
  git(["commit", "--quiet", "-m", "test: measured target"]);
  const inventory = await observeRunTargets(f.run, [{ kind: "git", target_ref: ".", paths: ["page.html"] }], { baseDir: f.root });
  const run = bindTargetInventory(f.run, inventory, { runFile: f.runFile });
  const artifact = screening(f, run);
  const artifactFile = saveArtifact(f, artifact);
  assert.equal(registerArtifact(run, artifact, { runFile: f.runFile, artifactFile }).status, "screened");
  git(["commit", "--quiet", "--allow-empty", "-m", "test: changed HEAD"]);
  assert.throws(() => registerArtifact(run, artifact, { runFile: f.runFile, artifactFile }), /Target drift/);
});

test("saved browser state registration rejects a changed viewport without contacting the declared URL", (t) => {
  const f = fixture(t, ["https://example.invalid/private-state"]);
  const bytes = Buffer.from("<main>Before</main>");
  const inventory = fixtureInventory(f.run, f.artifactRoot, bytes);
  const run = bindTargetInventory(f.run, inventory, { runFile: f.runFile });
  const artifact = screening(f, run, { bytes });
  const artifactFile = saveArtifact(f, artifact);
  assert.equal(registerArtifact(run, artifact, { runFile: f.runFile, artifactFile }).status, "screened");
  const bundleFile = inventory.snapshots[0].identity.bundle_path;
  const bundle = read(bundleFile);
  bundle.environment.viewport.width = 640;
  fs.writeFileSync(bundleFile, JSON.stringify(bundle), "utf8");
  assert.throws(() => registerArtifact(run, artifact, { runFile: f.runFile, artifactFile }), /Target drift/);
});

test("before and after CLI comparison works offline and keeps its identities in the private artifact root", async (t) => {
  const f = fixture(t);
  const before = await boundFile(f);
  const beforeFile = path.join(f.root, "before.json");
  writeNewJson(beforeFile, before);
  fs.writeFileSync(path.join(f.root, "page.html"), "<main>After</main>");
  const afterBase = structuredClone(f.run);
  afterBase.run_id = "RUN-20260918T000001Z-REGTGT02";
  const inventory = await observeRunTargets(afterBase, [{ kind: "file", target_ref: "page.html" }], { baseDir: f.root });
  const after = bindTargetInventory(afterBase, inventory, { runFile: f.runFile });
  const afterFile = path.join(f.root, "after.json");
  writeNewJson(afterFile, after);
  fs.unlinkSync(path.join(f.root, "page.html"));
  const output = path.join(f.artifactRoot, "comparison.json");
  const result = cli(["compare-targets", "--before", beforeFile, "--after", afterFile, "--output", output]);
  pass(result);
  assert.doesNotMatch(result.stdout, /TARGET-|page\.html/);
  const comparison = read(output);
  assert.equal(comparison.publication, "private_by_default");
  assert.equal(comparison.comparisons[0].status, "identity_changed");
  assert.equal(comparison.comparisons[0].environment_changed, false);
  const refused = cli(["compare-targets", "--before", beforeFile, "--after", afterFile, "--output", path.join(f.root, "public.json")]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /private artifact root/);
});
