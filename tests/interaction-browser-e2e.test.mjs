import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import test from "node:test";
import { createAuditRun, bindTargetInventory, writeNewJson } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { createNetworkPolicy } from "../codex/skills/information-accessibility-practice/scripts/lib/network-policy.mjs";
import { DEFAULT_FORBIDDEN_OPERATIONS } from "../codex/skills/information-accessibility-practice/scripts/lib/interaction-policy.mjs";
import { createInteractionSupervisor, createInteractionSession } from "../codex/skills/information-accessibility-practice/scripts/lib/interaction-session.mjs";
import { createBrowserInteractionAdapter } from "../codex/skills/information-accessibility-practice/scripts/lib/browser-interaction-adapter.mjs";
import { validateInteractionEvidence } from "../codex/skills/information-accessibility-practice/scripts/lib/interaction-evidence.mjs";
import { createRunEvidenceReference } from "../codex/skills/information-accessibility-practice/scripts/lib/run-evidence.mjs";
import { observeRunTargets } from "../codex/skills/information-accessibility-practice/scripts/lib/run-targets.mjs";
import { captureWebEvidence, withWebInspectionSession } from "../codex/skills/information-accessibility-practice/scripts/capture-web-evidence.mjs";

const enabled = process.env.RUN_WEB_CAPABILITIES_E2E === "1";
test("real Chrome uses live approval for native Tab, blocks focus handlers and refuses side-effect actions", { skip: !enabled }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-interaction-browser-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifacts = path.join(root, "artifacts"); fs.mkdirSync(artifacts);
  let sideEffects = 0;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/effect")) sideEffects++;
    res.setHeader("content-type", "text/html");
    res.end('<!doctype html><html lang="en"><head><title>Interaction</title></head><body><form action="/effect-submit" method="post"><button id="first" type="submit">Send</button><input id="second" type="file"></form><script>document.addEventListener("focusin",()=>{document.body.dataset.sideEffect="yes";fetch("/effect-focus")});document.addEventListener("click",()=>fetch("/effect-click"));</script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`, url = `${origin}/`;
  const networkPolicy = createNetworkPolicy({ targetOrigins: [origin], allowLocalhost: true });
  const interactionPolicy = { schema_version: "1.0.0", supervisor: { identity: "private-browser-fixture", role: "test supervisor" }, scope: [url],
    starts_at: new Date(Date.now() - 60_000).toISOString(), expires_at: new Date(Date.now() + 300_000).toISOString(),
    approval_mode: "per_action", allowed_operations: ["focus", "expand"], forbidden_operations: DEFAULT_FORBIDDEN_OPERATIONS,
    requires_per_action_confirmation: [], enforcement: "live_supervisor_and_registered_adapter_required" };
  const runFile = path.join(root, "run.json");
  const initial = createAuditRun({ runFile, artifactRoot: artifacts, runId: "RUN-20260918T000000Z-INTBROWS", profile: "web-modern",
    targetName: "Browser interaction", targetVersion: "1", targetRefs: [url], network: "allowlisted", networkPolicy,
    interaction: "human_supervised", interactionPolicy, sourceWrite: "none", inspectionMode: "quick", inspectionPurpose: "Verify approved native focus" });
  const options = { url, browserChannel: process.env.A11Y_BROWSER_CHANNEL, allowLocalhost: true, focusSteps: 2, settleBeforeInspection: true,
    networkRun: initial, networkCaller: { network: "allowlisted", allowedOrigins: [origin], allowLocalhost: true } };
  const baseline = await captureWebEvidence(options);
  assert.equal(baseline.evidence.focus_path.length, 0); assert.equal(baseline.interaction.effective_mode, "read_only");
  assert.equal(sideEffects, 0);
  const bundleFile = path.join(artifacts, "baseline.json"); writeNewJson(bundleFile, baseline);
  const inventory = await observeRunTargets(initial, [{ kind: "web_state", target_ref: url, bundle_path: bundleFile, locale: "en-US", authentication_state_id: "none", feature_flags: [] }], { baseDir: root });
  const run = bindTargetInventory(initial, inventory, { runFile }); writeNewJson(runFile, run);
  let approvalCount = 0;
  const supervisor = createInteractionSupervisor({ ...interactionPolicy.supervisor, isPresent: () => true,
    confirm: async (preview) => ({ approved: true, approval_id: `BROWSER-APPROVAL-${++approvalCount}`, preview_sha256: preview.preview_sha256, expires_at: preview.expires_at }) });
  const logFile = path.join(artifacts, "focus.jsonl");
  const evidence = await captureWebEvidence({ ...options, networkRun: run, interaction: { supervisor, runFile, logFile } });
  assert.deepEqual(evidence.evidence.focus_path.map((value) => value.id), ["first", "second"]);
  assert.equal(approvalCount, 2); assert.equal(sideEffects, 0);
  assert.equal(evidence.interaction.effective_mode, "human_supervised");
  const bytes = fs.readFileSync(logFile);
  const reference = createRunEvidenceReference({ run, targetRef: url, evidenceType: "interaction_log", relativePath: "focus.jsonl", bytes, capturedAt: new Date().toISOString() });
  validateInteractionEvidence(bytes, run, reference);
  await withWebInspectionSession({ ...options, networkRun: run, focusSteps: 0 }, async (browser) => {
    const adapter = await createBrowserInteractionAdapter(browser);
    const operations = createInteractionSession({ run, runFile, targetRef: url, supervisor, adapter, logFile: path.join(artifacts, "denied.jsonl") });
    try {
      for (const operation of ["submit", "purchase", "publish", "upload", "account_change", "expand", "navigate_cross_origin"]) {
        const result = await operations.execute({ operation });
        assert.equal(result.executed, false, operation);
      }
      assert.equal(await browser.page.locator("body").getAttribute("data-side-effect"), null);
    } finally { operations.close(); }
    return {};
  });
  assert.equal(sideEffects, 0); assert.equal(approvalCount, 2);
});
