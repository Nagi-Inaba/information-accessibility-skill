import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createAuditRun, bindTargetInventory, validateAuditRun, writeNewJson, loadAuditResources } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { createInteractionSupervisor, createInteractionSession } from "../codex/skills/information-accessibility-practice/scripts/lib/interaction-session.mjs";
import { createBrowserInteractionAdapter } from "../codex/skills/information-accessibility-practice/scripts/lib/browser-interaction-adapter.mjs";
import { DEFAULT_FORBIDDEN_OPERATIONS, interactionPolicyErrors, interactionScopeSummary } from "../codex/skills/information-accessibility-practice/scripts/lib/interaction-policy.mjs";
import { validateInteractionEvidence } from "../codex/skills/information-accessibility-practice/scripts/lib/interaction-evidence.mjs";
import { createRunEvidenceReference, collectScreeningEvidence } from "../codex/skills/information-accessibility-practice/scripts/lib/run-evidence.mjs";
import { fixtureInventory, fixtureBytes } from "./helpers/measured-targets.mjs";
import { buildPublicReportModel, renderRunBackedReport } from "../codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs";

const targetRef = "https://example.com/";
export function supervisionPolicy(ref = targetRef, overrides = {}) {
  return { schema_version: "1.0.0", supervisor: { identity: "private-supervisor@example.test", role: "accessibility owner" },
    scope: [ref], starts_at: new Date(Date.now() - 60_000).toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(),
    approval_mode: "per_action", allowed_operations: ["focus"], forbidden_operations: [...DEFAULT_FORBIDDEN_OPERATIONS],
    requires_per_action_confirmation: [], enforcement: "live_supervisor_and_registered_adapter_required", ...overrides };
}

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-interaction-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifacts = path.join(root, "artifacts"); fs.mkdirSync(artifacts);
  const runFile = path.join(root, "run.json"), policy = supervisionPolicy(targetRef, overrides);
  const options = { runFile, artifactRoot: artifacts, runId: "RUN-20260918T000000Z-INTERACT", profile: "web-modern",
    targetName: "Interaction fixture", targetVersion: "1", targetRefs: [targetRef], network: "none", interaction: "human_supervised",
    interactionPolicy: policy, sourceWrite: "none", inspectionMode: "quick", inspectionPurpose: "Bounded focus sampling" };
  const initial = createAuditRun(options);
  const run = bindTargetInventory(initial, fixtureInventory(initial, artifacts), { runFile });
  writeNewJson(runFile, run);
  return { run, runFile, options, policy, artifacts };
}
async function fakeAdapter({ perform, snapshot, content = fixtureBytes.toString() } = {}) {
  let presses = 0, stops = 0;
  const page = { url: () => targetRef, content: async () => content,
    evaluate: async () => snapshot ? snapshot() : { tag: "button", id: String(presses), role: null, name: "Focus" },
    keyboard: { press: async (key) => { presses++; await perform?.(key); } }, close: async () => { stops++; } };
  const adapter = await createBrowserInteractionAdapter({ page, context: { newCDPSession: async () => ({ send: async () => {} }) },
    networkSession: { stop() {} }, gateway: { drain: async () => {}, failure: null } });
  return { adapter, presses: () => presses, stops: () => stops };
}
function host(f, callback, presence = () => true) {
  let count = 0;
  const supervisor = createInteractionSupervisor({ ...f.policy.supervisor, isPresent: presence,
    confirm: async (preview) => { count++; return callback ? callback(preview, count) : { approved: true, approval_id: `APPROVAL-${count}`, preview_sha256: preview.preview_sha256, expires_at: preview.expires_at }; } });
  return { supervisor, count: () => count };
}
const action = { operation: "focus", direction: "next" };
function session(f, supervisor, adapter, name = "operations.jsonl") {
  const logFile = path.join(f.artifacts, name);
  return { value: createInteractionSession({ ...f, targetRef, supervisor, adapter, logFile }), logFile };
}
function validateLog(f, file) {
  const bytes = fs.readFileSync(file);
  const reference = createRunEvidenceReference({ run: f.run, targetRef, evidenceType: "interaction_log", relativePath: path.basename(file), bytes, capturedAt: new Date().toISOString() });
  validateInteractionEvidence(bytes, f.run, reference);
  return { bytes, reference, entries: bytes.toString().trim().split("\n").map(JSON.parse) };
}

test("human supervision requires concrete bounded policy and does not widen source-write authority", (t) => {
  const f = fixture(t);
  assert.equal(validateAuditRun(f.run, { runFile: f.runFile }).valid, true);
  assert.throws(() => createAuditRun({ ...f.options, interactionPolicy: undefined }), /interaction-policy/);
  assert.equal(f.run.permissions.source_write, "denied");
  assert.ok(interactionPolicyErrors({ ...f.policy, forbidden_operations: [] }).length);
  assert.ok(interactionPolicyErrors({ ...f.policy, allowed_operations: ["submit"] }).length);
  assert.ok(interactionPolicyErrors({ ...f.policy, expires_at: "2099-01-01T00:00:00Z" }).length);
  assert.ok(interactionPolicyErrors({ ...f.policy, scope: ["https://other.example/"] }, [targetRef]).length);
  const publicScope = JSON.stringify(interactionScopeSummary(f.run.permissions));
  assert.equal(publicScope.includes(f.policy.supervisor.identity), false);
  assert.equal(publicScope.includes(f.policy.supervisor.role), false);
  assert.equal(JSON.parse(publicScope).effective_mode, "read_only");
});

test("per-action approval persists before/after and immutable chain bound to measured DOM", async (t) => {
  const f = fixture(t), fake = await fakeAdapter(), human = host(f);
  const s = session(f, human.supervisor, fake.adapter);
  assert.equal(s.value.mode, "read_only");
  for (let i = 0; i < 2; i++) assert.equal((await s.value.execute(action)).effective_mode, "human_supervised");
  s.value.close();
  assert.equal(fake.presses(), 2); assert.equal(human.count(), 2);
  const log = validateLog(f, s.logFile);
  assert.deepEqual(log.entries.map((entry) => entry.kind), ["interaction-session", "preview", "approval", "before", "after", "preview", "approval", "before", "after", "closed"]);
  assert.equal(log.entries[2].supervisor.identity, f.policy.supervisor.identity);
  const tampered = Buffer.from(log.bytes.toString().replace('"direction":"next"', '"direction":"previous"'));
  assert.throws(() => validateInteractionEvidence(tampered, f.run, log.reference), /Interaction evidence/);
  const foreign = structuredClone(f.run); foreign.run_id = "RUN-20260918T000000Z-OTHER123";
  assert.throws(() => validateInteractionEvidence(log.bytes, foreign, log.reference), /Interaction evidence/);
  const incomplete = Buffer.from(log.bytes.toString().trim().split("\n").slice(0, -1).join("\n"));
  assert.throws(() => validateInteractionEvidence(incomplete, f.run, log.reference), /Interaction evidence/);
  const artifact = { artifact_type: "screening-observations", artifact_id: "ART-INTERACTION", created_at: log.reference.captured_at,
    payload: { schema_version: "3.0.0", observations: [{ requirement_id: "SCREEN-FOCUS", evidence_level: "E1", captured_at: log.reference.captured_at, evidence_refs: [log.reference] }] } };
  assert.deepEqual(collectScreeningEvidence(f.run, [artifact], () => ({ bytes: log.bytes, sha256: log.reference.sha256 })).errors, []);
});

test("per-run approval is reused within scope, while configured per-action checks remain separate", async (t) => {
  for (const requires of [[], ["focus"]]) {
    const f = fixture(t, { approval_mode: "per_run", requires_per_action_confirmation: requires });
    const fake = await fakeAdapter(), human = host(f), s = session(f, human.supervisor, fake.adapter);
    await s.value.execute(action); await s.value.execute(action); s.value.close();
    assert.equal(human.count(), requires.length ? 2 : 1); validateLog(f, s.logFile);
  }
});

test("forged handles, absent supervisor, unsupported adapter and dangerous operations never press keys", async (t) => {
  const f = fixture(t), fake = await fakeAdapter(), human = host(f);
  for (const [name, supervisor, adapter, requested] of [
    ["forged", JSON.parse(JSON.stringify(human.supervisor)), fake.adapter, action],
    ["absent", host(f, undefined, () => false).supervisor, fake.adapter, action],
    ["adapter", human.supervisor, { supports: () => true, perform: () => { throw new Error("Must not run"); } }, action],
    ...["submit", "purchase", "publish", "upload", "account_change", "consent", "download", "delete"].map((operation) => [operation, human.supervisor, fake.adapter, { operation }]),
    ["enter", human.supervisor, fake.adapter, { operation: "focus", direction: "Enter" }]
  ]) {
    const s = session(f, supervisor, adapter, `${name}.jsonl`);
    assert.equal((await s.value.execute(requested)).executed, false); s.value.close(); validateLog(f, s.logFile);
  }
  assert.equal(fake.presses(), 0); assert.equal(human.count(), 0);
});

test("approval response is bound to preview and cannot be replayed across sessions", async (t) => {
  const f = fixture(t), fake = await fakeAdapter(); let saved;
  const human = host(f, (preview) => saved ??= { approved: true, approval_id: "APPROVAL-ONCE", preview_sha256: preview.preview_sha256, expires_at: preview.expires_at });
  for (const name of ["first", "second"]) {
    const s = session(f, human.supervisor, fake.adapter, `${name}.jsonl`);
    assert.equal((await s.value.execute(action)).executed, name === "first"); s.value.close(); validateLog(f, s.logFile);
  }
  assert.equal(fake.presses(), 1);
});

test("revocation and expiry downgrade immediately and stop in-flight operations", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] }); t.mock.timers.setTime(Date.parse("2026-09-18T12:00:00Z"));
  const f = fixture(t, { approval_mode: "per_run" }), fake = await fakeAdapter(), human = host(f), s = session(f, human.supervisor, fake.adapter);
  await s.value.execute(action); assert.equal(s.value.mode, "human_supervised");
  t.mock.timers.setTime(Date.parse(f.policy.expires_at));
  assert.equal(s.value.mode, "read_only"); assert.equal((await s.value.execute(action)).executed, false); s.value.close();
  assert.equal(fake.presses(), 1); validateLog(f, s.logFile);
  const g = fixture(t), otherHuman = host(g);
  const interrupted = await fakeAdapter({ perform: () => otherHuman.supervisor.revoke() });
  const active = session(g, otherHuman.supervisor, interrupted.adapter);
  const result = await active.value.execute(action);
  assert.equal(result.effective_mode, "read_only"); assert.ok(interrupted.stops() > 0); active.value.close(); validateLog(g, active.logFile);
});

test("journal tampering or missing measured DOM prevents execution", async (t) => {
  const f = fixture(t), fake = await fakeAdapter(), human = host(f);
  const s = session(f, human.supervisor, fake.adapter);
  fs.appendFileSync(s.logFile, "tampered\n");
  await assert.rejects(s.value.execute(action), /journal/);
  assert.throws(() => s.value.close(), /journal/); assert.equal(fake.presses(), 0);
  const changed = await fakeAdapter({ content: "<button>Changed live DOM</button>" });
  const g = fixture(t), altered = session(g, host(g).supervisor, changed.adapter);
  assert.equal((await altered.value.execute(action)).reason, "target_document_changed_or_no_measured_dom");
  altered.value.close(); validateLog(g, altered.logFile); assert.equal(changed.presses(), 0);
  g.run.target_inventory.snapshots[0].evidence_bindings[0].sha256 = "0".repeat(64);
  assert.throws(() => session(g, host(g).supervisor, changed.adapter), /valid current run/);
});

test("expiry during the durable before-state write is refused before dispatch", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] }); t.mock.timers.setTime(Date.parse("2026-09-18T12:00:00Z"));
  const f = fixture(t), fake = await fakeAdapter(), human = host(f), s = session(f, human.supervisor, fake.adapter);
  const original = fs.fsyncSync; let writes = 0;
  t.mock.method(fs, "fsyncSync", (fd) => { original(fd); if (++writes === 3) t.mock.timers.setTime(Date.parse(f.policy.expires_at)); });
  const result = await s.value.execute(action); s.value.close();
  assert.equal(result.executed, false); assert.equal(fake.presses(), 0); validateLog(f, s.logFile);
});

test("public report models and rendered reports withhold supervisor identity and private approval trail", (t) => {
  const f = fixture(t);
  const assessment = { assessment: { results: [], findings: [], overall_notes: [], limitations: [], evidence_level: "E1",
    claim: { requested_tier: "reference_only", proposed_wording: "Unverified focus screening" } } };
  const model = buildPublicReportModel({ run: f.run, assessment, envelopesById: new Map() });
  const outputs = [JSON.stringify(model), renderRunBackedReport(model)];
  for (const output of outputs) {
    assert.equal(output.includes(f.policy.supervisor.identity), false);
    assert.equal(output.includes(f.policy.supervisor.role), false);
    assert.equal(output.includes("operations.jsonl"), false);
  }
  assert.equal(model.interactionScope.effective_mode, "read_only");
});

test("CLI requires the policy file while legacy run 9 remains readable without implicit supervision", (t) => {
  const f = fixture(t), output = path.join(path.dirname(f.runFile), "initialized.json"), policyFile = path.join(f.artifacts, "policy.json");
  const cli = fileURLToPath(new URL("../codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs", import.meta.url));
  const args = [cli, "init", "--run-id", f.run.run_id, "--profile", "web-modern", "--inspection-mode", "quick", "--inspection-purpose", "Verify policy input",
    "--target-name", "Policy input", "--target-version", "1", "--target-ref", targetRef, "--artifact-root", f.artifacts,
    "--network", "none", "--interaction", "human_supervised", "--source-write", "none", "--output", output];
  const missing = spawnSync(process.execPath, args, { encoding: "utf8", windowsHide: true });
  assert.notEqual(missing.status, 0); assert.match(missing.stderr, /interaction-policy/); assert.equal(fs.existsSync(output), false);
  writeNewJson(policyFile, f.policy);
  const result = spawnSync(process.execPath, [...args, "--interaction-policy", policyFile], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")).permissions.interaction_policy, f.policy);
  const legacy = structuredClone(f.run), resources = loadAuditResources();
  legacy.schema_version = "9.0.0"; delete legacy.permissions.interaction_policy;
  legacy.resource_versions.orchestration_registry_version = "8.0.0";
  legacy.resource_versions.orchestration_registry_sha256 = resources.orchestrationRegistries.get("8.0.0").sha256;
  const validation = validateAuditRun(legacy, { runFile: f.runFile });
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.throws(() => createInteractionSession({ run: legacy, runFile: f.runFile, targetRef, logFile: path.join(f.artifacts, "legacy.jsonl") }), /current run/);
});
