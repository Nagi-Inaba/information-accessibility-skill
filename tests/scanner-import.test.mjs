import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAxeImport, scannerDedupKey } from "../codex/skills/information-accessibility-practice/scripts/lib/scanner-import.mjs";
import { loadAuditResources, writeNewJson, readStableFile, validateAuditRun } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { targetDigest } from "../codex/skills/information-accessibility-practice/scripts/lib/target-identity.mjs";
import { canonicalJson } from "../codex/skills/information-accessibility-practice/scripts/lib/canonical-json.mjs";
import { cli, pass, read, measuredScannerRun, importedReport } from "./helpers/scanner-import.mjs";

const url = "https://example.invalid/fixture";
const secret = "SCANNER-PRIVATE-SECRET";
function result() {
  const rule = (id, nodes = true) => ({ id, impact: "serious", tags: ["wcag111"], helpUrl: `https://example.invalid/${secret}`,
    help: secret, description: secret, nodes: nodes ? [{ target: [["#shadow", `#${secret}`]], html: `<img data-secret="${secret}">`, impact: "serious", failureSummary: secret, any: [], all: [], none: [] }] : [] });
  return { testEngine: { name: "axe-core", version: "4.13.0" }, testEnvironment: { userAgent: secret, windowWidth: 1280, windowHeight: 800 },
    url, timestamp: "2026-09-18T00:00:00Z", toolOptions: { reporter: "v1", custom: secret },
    violations: [rule("image-alt"), rule(`unknown-${secret}`)], incomplete: [rule("label")],
    passes: [rule("image-alt")], inapplicable: [rule("frame-title", false)] };
}
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-scanner-import-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifacts = path.join(root, "artifacts");
  fs.mkdirSync(artifacts);
  const bundle = { schema_version: "1.0.0", kind: "web-evidence-bundle", captured_at: "2026-09-18T00:00:01Z",
    target: { requested_url: url, final_url: url, http_status: 200, dom_sha256: targetDigest("<main>fixture</main>"), ax_tree_sha256: targetDigest("[]") },
    environment: { adapter: "synthetic-fixture", browser_version: "fixture", viewport: { width: 1280, height: 800 }, rendering: { locale: "ja-JP" } },
    evidence: { dom: "<main>fixture</main>", accessibility_tree: [] } };
  const bundleFile = path.join(artifacts, "capture.json");
  writeNewJson(bundleFile, bundle);
  const f = await measuredScannerRun(root, bundleFile, url);
  const raw = result();
  const input = path.join(artifacts, "axe.json");
  writeNewJson(input, raw);
  return { ...f, raw, input, bundle, output: path.join(artifacts, "screening.json") };
}
const build = (f, input = f.raw) => buildAxeImport({ input, run: f.run, targetRef: url, rawSha256: readStableFile(f.input).sha256, resources: loadAuditResources() });

test("axe import preserves all outcomes, raw evidence and unknown rules through registration and public reporting", async (t) => {
  const f = await fixture(t);
  pass(cli(["import", "axe", "--run", f.runFile, "--input", f.input, "--output", f.output]));
  const record = read(`${f.output}.import.json`);
  assert.deepEqual(new Set(record.rows.map((row) => row.source_outcome)), new Set(["violations", "incomplete", "passes", "inapplicable"]));
  assert.equal(record.rows.length, 5);
  assert.equal(record.rows.filter((row) => row.mapping_status === "unsupported_rule_retained").length, 1);
  assert.equal(record.raw_result_sha256, readStableFile(f.input).sha256);
  assert.equal(record.binding_assurance, "declared_saved_capture");
  assert.equal(record.configuration.reported_run_options.custom, secret);
  assert.deepEqual(record.rows[0].target, [["#shadow", `#${secret}`]]);
  assert.equal(record.rows[0].screening_check_id, "SCREEN-WEB-ALT-MISSING");
  const artifact = read(f.output);
  assert.ok(artifact.payload.observations.every((row) => row.human_review_required && !["pass", "fail"].includes(row.report_outcome)));
  const pipeline = importedReport(f, f.output);
  assert.doesNotMatch(pipeline.report, new RegExp(secret));
  assert.doesNotMatch(pipeline.report, /TARGET-[a-f0-9]|ENV-[a-f0-9]|raw_result_sha256/);
  assert.ok(pipeline.assessment.assessment.results.filter((row) => row.requirement_kind === "profile_requirement").every((row) => !["pass", "fail"].includes(row.outcome)));
  fs.appendFileSync(f.input, " ");
  assert.equal(validateAuditRun(read(pipeline.runFile), { runFile: pipeline.runFile }).valid, false);
});

test("axe import rejects wrong capture context, unsupported engines, omitted categories and unsafe output paths", async (t) => {
  const f = await fixture(t);
  for (const [mutate, pattern] of [
    [(raw) => { raw.url = "https://example.invalid/other"; }, /URL/],
    [(raw) => { raw.testEnvironment.windowWidth = 640; }, /viewport/],
    [(raw) => { delete raw.testEnvironment.windowWidth; }, /viewport/],
    [(raw) => { delete raw.testEnvironment.windowWidth; delete raw.testEnvironment.windowHeight; }, /viewport/],
    [(raw) => { delete raw.violations[0].nodes[0].any; }, /any checks/],
    [(raw) => { raw.testEngine.version = "5.0.0"; }, /4.x/],
    [(raw) => { delete raw.passes; }, /passes/],
    [(raw) => { raw.violations[0].nodes[0].target = [17]; }, /selector/],
    [(raw) => { raw.timestamp = "2026-02-30T00:00:00Z"; }, /timestamp/]
  ]) {
    const raw = result(); mutate(raw); assert.throws(() => build(f, raw), pattern);
  }
  const rejected = cli(["import", "axe", "--run", f.runFile, "--input", f.input, "--output", path.join(f.root, "public.json")]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /private artifact root/);
  assert.equal(fs.existsSync(path.join(f.root, "public.json")), false);
});

test("correlation keys survive tool/run changes but preserve exact selectors and UI state", async (t) => {
  const f = await fixture(t);
  const row = build(f).record.rows[0];
  const input = { checkId: row.screening_check_id, targetRef: url, frame: row.frame, target: row.target,
    state: Object.fromEntries(["authentication_state_id", "feature_flags", "locale", "viewport"].map((key) => [key, f.run.target_inventory.snapshots[0].identity[key]])) };
  assert.equal(scannerDedupKey({ ...input, tool: "axe-core", run: "before" }), scannerDedupKey({ ...input, tool: "another-tool", run: "after" }));
  assert.equal(scannerDedupKey(input), row.dedup_key);
  assert.notEqual(scannerDedupKey({ ...input, target: ["#shadow", `#${secret}`] }), row.dedup_key);
  assert.notEqual(scannerDedupKey({ ...input, state: { ...input.state, authentication_state_id: "signed-in" } }), row.dedup_key);
  const old = result(); old.testEngine.version = "4.10.3";
  assert.equal(build(f, old).record.sources[0].tool.version, "4.10.3");
});

test("package scanner export binds its capture and retains partial coverage and changed states", async (t) => {
  const f = await fixture(t);
  const identity = f.run.target_inventory.snapshots[0].identity;
  const frames = [{ frame: { path: "0", url }, result: f.raw }];
  const exported = { schema_version: "1.0.0", kind: "axe-scan-export", frames, raw_result_sha256: targetDigest(canonicalJson(frames)),
    capture: { bundle_sha256: identity.bundle_sha256, dom_sha256: identity.dom_sha256, ax_tree_sha256: identity.ax_tree_sha256, final_url: url },
    configuration: { configure: null, run_options: f.raw.toolOptions },
    frame_coverage: { attempted: 2, succeeded: 1, failed: 1, skipped: 0, coverage_status: "partial", entries: [
      { frame_path: "0", url, status: "succeeded", reason: null }, { frame_path: "0.1", url: `${url}/frame`, status: "failed", reason: secret }] },
    frame_states: [{ frame_path: "0", started_at: "2026-09-18T00:00:00Z", completed_at: "2026-09-18T00:00:01Z",
      before_url: url, after_url: url, before_dom_sha256: targetDigest("old"), after_dom_sha256: identity.dom_sha256, state_changed: true }] };
  const imported = build(f, exported);
  assert.equal(imported.record.binding_assurance, "state_changed_requires_review");
  assert.match(imported.record.limitations.join(" "), /partial/);
  assert.equal(imported.record.frame_coverage.entries[1].reason, secret);
  const wrong = structuredClone(exported); wrong.capture.bundle_sha256 = "0".repeat(64);
  assert.throws(() => build(f, wrong), /bound capture/);
  const lost = structuredClone(exported); delete lost.frame_coverage;
  assert.throws(() => build(f, lost), /coverage accounting/);
  const inflated = structuredClone(exported); inflated.frame_coverage.coverage_status = "complete";
  assert.throws(() => build(f, inflated), /coverage status/);
});
