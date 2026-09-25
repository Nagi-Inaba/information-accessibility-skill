import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createAuditRun, writeNewJson, validateAuditRun } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { createRunEvidenceReference } from "../codex/skills/information-accessibility-practice/scripts/lib/run-evidence.mjs";
import { auditStatus } from "../codex/skills/information-accessibility-practice/scripts/show-audit-status.mjs";
const cliFile = fileURLToPath(new URL("../codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs", import.meta.url));
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const cli = (args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [cliFile, ...args], { windowsHide: true });
  let output = "";
  child.stdout.on("data", (value) => { output += value; });
  child.stderr.on("data", (value) => { output += value; });
  child.on("close", (code) => resolve({ code, output }));
});
const pass = (result) => { assert.equal(result.code, 0, result.output); return result; };

test("policy proposal is offline; HTTP capture, bind and register persist logs bound to immutable evidence", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-network-workflow-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifacts = path.join(root, "artifacts"); fs.mkdirSync(artifacts);
  let requests = 0;
  const server = http.createServer((_req, res) => { requests++; res.end("stable"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/`;
  const policyFile = path.join(root, "policy.json");
  const proposal = JSON.parse(pass(await cli(["network-policy", "--target", url, "--allow-localhost", "true", "--include-official-sources", "true", "--output", policyFile])).output);
  assert.equal(proposal.authority_granted, false);
  assert.equal(proposal.network_access_performed, false);
  assert.ok(proposal.policy.standards_sources.exact_urls.length);
  assert.equal(requests, 0);
  const runFile = path.join(root, "run.json");
  const options = { runFile, artifactRoot: artifacts, runId: "RUN-20260918T000000Z-NETFLOW1", profile: "web-modern",
    targetName: "Network fixture", targetVersion: "1", targetRefs: [url], network: "allowlisted", interaction: "safe_read_only", sourceWrite: "none",
    inspectionMode: "quick", inspectionPurpose: "Verify bounded network evidence" };
  assert.throws(() => createAuditRun(options), /network policy|Network policy/);
  const run = createAuditRun({ ...options, networkPolicy: read(policyFile) });
  writeNewJson(runFile, run);
  const specs = path.join(root, "specs.json"); writeNewJson(specs, [{ kind: "http", target_ref: url }]);
  const targets = path.join(artifacts, "targets.json");
  const captureLog = path.join(artifacts, "capture-network.json");
  const authorization = ["--allow-url", url, "--allow-localhost", "true"];
  const missing = await cli(["capture-targets", "--run", runFile, "--specs", specs, "--output", targets, ...authorization]);
  assert.notEqual(missing.code, 0); assert.match(missing.output, /network-log-output/); assert.equal(requests, 0);
  pass(await cli(["capture-targets", "--run", runFile, "--specs", specs, "--output", targets, "--network-log-output", captureLog, ...authorization]));
  assert.equal(requests, 1);
  const boundFile = path.join(root, "bound.json");
  const bindLog = path.join(artifacts, "bind-network.json");
  pass(await cli(["bind-targets", "--run", runFile, "--targets", targets, "--output", boundFile, "--network-log-output", bindLog, ...authorization]));
  assert.equal(requests, 2);
  const bound = read(boundFile);
  const at = new Date().toISOString();
  const reference = createRunEvidenceReference({ run: bound, targetRef: url, evidenceType: "network_log",
    relativePath: "capture-network.json", bytes: fs.readFileSync(captureLog), capturedAt: at });
  const artifact = { schema_version: "4.0.0", artifact_id: "ART-NETWORK-OBS", artifact_type: "screening-observations", run_id: run.run_id,
    target_snapshot_ids: bound.target_inventory.snapshots.map((item) => item.snapshot_id),
    producer: { role_id: "e1_inspector", producer_kind: "ai_agent", origin: "Network fixture" }, created_at: at, inputs: [],
    payload: { schema_version: "4.0.0", observations: [{ requirement_id: "SCREEN-NETWORK", evidence_level: "E1", evidence_refs: [reference],
      method: "Recorded HTTP request", location: "HTTP response", observation: "Pinned response received", captured_at: at,
      profile_requirement_id: null, report_outcome: null, applicability: "undetermined", report_rationale: "Network evidence only" }] } };
  const artifactFile = path.join(artifacts, "screening.json"); writeNewJson(artifactFile, artifact);
  const registeredFile = path.join(root, "registered.json");
  const registerLog = path.join(artifacts, "register-network.json");
  pass(await cli(["register", "--run", boundFile, "--artifact", artifactFile, "--output", registeredFile, "--network-log-output", registerLog, ...authorization]));
  assert.equal(requests, 3);
  assert.equal(read(registerLog).observations[0].log.entries[0].request_sent, true);
  const status = auditStatus(registeredFile);
  assert.equal(status.valid, true);
  assert.equal(status.run.network_scope.enforcement, "declared_policy_requires_adapter_evidence");
  assert.equal(requests, 3, "status remains offline");
  if (process.env.RUN_WEB_CAPABILITIES_E2E === "1") {
    const browserLog = path.join(artifacts, "browser-network.json");
    const args = ["scan-web", "--run", runFile, "--url", url, "--profile", "web-modern", "--allow-origin", origin,
      "--allow-localhost", "--network-log-output", browserLog, "--output", path.join(artifacts, "scan.json"),
      "--axe-output", path.join(artifacts, "axe.json"), "--evidence-output", path.join(artifacts, "web.json")];
    if (process.env.A11Y_BROWSER_CHANNEL) args.push("--browser-channel", process.env.A11Y_BROWSER_CHANNEL);
    pass(await cli(args));
    assert.equal(read(browserLog).adapter, "browser-http-pinned-v1");
    assert.equal(read(browserLog).run_id, run.run_id);
  }
  const saved = read(captureLog); saved.observations[0].log.run_id += "X";
  fs.writeFileSync(captureLog, JSON.stringify(saved));
  assert.equal(validateAuditRun(read(registeredFile), { runFile: registeredFile }).valid, false);
  const partialRunFile = path.join(root, "partial-run.json");
  const deniedUrl = `${origin}/outside-exact-scope`;
  const partial = createAuditRun({ ...options, runFile: partialRunFile, runId: "RUN-20260918T000000Z-NETFLOW2",
    targetRefs: [url, deniedUrl], networkPolicy: { ...read(policyFile), targets: { origins: [], exact_urls: [url] } } });
  writeNewJson(partialRunFile, partial);
  const partialSpecs = path.join(root, "partial-specs.json");
  writeNewJson(partialSpecs, [url, deniedUrl].map((target_ref) => ({ kind: "http", target_ref })));
  const partialLog = path.join(artifacts, "partial-network.json");
  const failed = await cli(["capture-targets", "--run", partialRunFile, "--specs", partialSpecs, "--output", path.join(artifacts, "partial-targets.json"),
    "--network-log-output", partialLog, "--allow-origin", origin, "--allow-localhost", "true"]);
  assert.notEqual(failed.code, 0);
  assert.equal(read(partialLog).kind, "run-network-failure");
  assert.equal(read(partialLog).completed.length, 1);
  assert.equal(read(partialLog).failed_log.entries[0].reason, "outside_run_scope");
});
