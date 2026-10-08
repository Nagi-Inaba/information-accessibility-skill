import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { observeTarget, assertTargetUnchanged } from "../codex/skills/information-accessibility-practice/scripts/lib/target-observer.mjs";
import { targetDigest, targetIdentityErrors, compareTargetIdentities } from "../codex/skills/information-accessibility-practice/scripts/lib/target-identity.mjs";
import { assertStableFile, readStableFile } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { createNetworkPolicy } from "../codex/skills/information-accessibility-practice/scripts/lib/network-policy.mjs";

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-target-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", shell: false, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function repository(t) {
  const root = temporary(t);
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Audit fixture"]);
  git(root, ["config", "user.email", "fixture@users.noreply.github.com"]);
  git(root, ["config", "core.autocrlf", "false"]);
  fs.writeFileSync(path.join(root, "page.html"), "<main>Before</main>\n");
  git(root, ["add", "--", "page.html"]);
  git(root, ["-c", "core.hooksPath=", "commit", "-qm", "test: create fixture"]);
  return root;
}

test("file identity measures exact bytes and canonical location, ignoring mtime-only changes", async (t) => {
  const root = temporary(t);
  const file = path.join(root, "page.html");
  fs.writeFileSync(file, "<main>First</main>");
  const spec = { kind: "file", target_ref: pathToFileURL(file).href };
  const before = await observeTarget(spec);
  assert.deepEqual(targetIdentityErrors(before.snapshot), []);
  assert.equal(before.snapshot.identity.sha256, targetDigest(fs.readFileSync(file)));
  assert.equal(before.snapshot.identity.canonical_path, file);
  assert.equal(before.snapshot.publication, "private_by_default");
  assert.ok(Object.isFrozen(before.snapshot.identity));
  fs.utimesSync(file, new Date(0), new Date(0));
  const unchanged = await assertTargetUnchanged(before.snapshot, spec);
  assert.equal(unchanged.snapshot.snapshot_id, before.snapshot.snapshot_id);
  fs.writeFileSync(file, "<main>Other</main>");
  await assert.rejects(assertTargetUnchanged(before.snapshot, spec), (error) => error.code === "TARGET_DRIFT" && error.comparison.changed_identity_fields.includes("sha256"));
});

test("bounded stable reads reject oversized and subsequently enlarged target files", async (t) => {
  const root = temporary(t);
  const file = path.join(root, "bytes.txt");
  fs.writeFileSync(file, "1234");
  const read = readStableFile(file, { maxBytes: 4 });
  assert.equal(read.bytes.length, 4);
  await assert.rejects(observeTarget({ kind: "file", target_ref: file }, { maxBytes: 3 }), /byte limit/);
  fs.appendFileSync(file, "5");
  assert.throws(() => assertStableFile(read), /byte limit/);
  await assert.rejects(observeTarget({ kind: "file", target_ref: "\\\\server\\share\\file" }), /Network shares|device paths/);
  await assert.rejects(observeTarget({ kind: "file", target_ref: "https://example.invalid/" }), /filesystem path/);
});

test("file observations refuse target paths through directory symlinks or junctions", async (t) => {
  const root = temporary(t);
  const actual = path.join(root, "actual");
  fs.mkdirSync(actual);
  fs.writeFileSync(path.join(actual, "page.html"), "<main>Target</main>");
  fs.symlinkSync(actual, path.join(root, "link"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(observeTarget({ kind: "file", target_ref: path.join(root, "link", "page.html") }), /symbolic link|junction|reparse/);
});

test("Git identities measure HEAD, index and selected working bytes without relying on a version label", async (t) => {
  const root = repository(t);
  const head = git(root, ["rev-parse", "HEAD"]);
  const spec = { kind: "git", target_ref: root, paths: ["page.html"], expected_commit: head };
  const before = await observeTarget(spec);
  assert.equal(before.snapshot.identity.head_commit, head);
  assert.equal(before.snapshot.identity.dirty, false);
  assert.equal(before.snapshot.identity.files[0].working_mode, process.platform === "win32" ? null : "100644");
  assert.equal(before.snapshot.identity.files[0].working_sha256, targetDigest(fs.readFileSync(path.join(root, "page.html"))));
  assert.equal((await assertTargetUnchanged(before.snapshot, spec)).snapshot.snapshot_id, before.snapshot.snapshot_id);
  fs.writeFileSync(path.join(root, "page.html"), "<main>After</main>\n");
  const dirty = await observeTarget(spec);
  assert.equal(dirty.snapshot.identity.dirty, true);
  await assert.rejects(assertTargetUnchanged(before.snapshot, spec), /Target drift/);
  await assert.rejects(observeTarget({ ...spec, expected_commit: "0".repeat(40) }), /expected_commit/);
  await assert.rejects(observeTarget({ ...spec, paths: ["../outside"] }), /normalized relative/);
  await assert.rejects(observeTarget(spec, { timeoutMs: 1 }), /timed out|command failed/);
});

test("Git executable-mode changes are detected without byte changes on POSIX", { skip: process.platform === "win32" }, async (t) => {
  const root = repository(t);
  const spec = { kind: "git", target_ref: root, paths: ["page.html"] };
  const before = await observeTarget(spec);
  fs.chmodSync(path.join(root, "page.html"), 0o755);
  const after = await observeTarget(spec);
  assert.equal(after.snapshot.identity.dirty, true);
  assert.equal(after.snapshot.identity.files[0].working_mode, "100755");
  assert.equal(after.snapshot.identity.files[0].working_sha256, before.snapshot.identity.files[0].working_sha256);
  await assert.rejects(assertTargetUnchanged(before.snapshot, spec), /Target drift/);
});

test("Git records untracked and deleted files, and refuses executable filters and filesystem monitor side effects", async (t) => {
  const root = repository(t);
  const marker = path.join(root, "executed.txt");
  fs.writeFileSync(path.join(root, "hostile.cjs"), "require('node:fs').writeFileSync('executed.txt','unexpected'); process.stdout.write('filtered');");
  fs.writeFileSync(path.join(root, ".gitattributes"), "page.html filter=hostile\n");
  git(root, ["config", "filter.hostile.clean", "node hostile.cjs"]);
  git(root, ["config", "filter.hostile.process", "node hostile.cjs"]);
  git(root, ["config", "core.fsmonitor", "node hostile.cjs"]);
  fs.writeFileSync(path.join(root, "page.html"), "<main>Changed</main>\n");
  fs.writeFileSync(path.join(root, "untracked.txt"), "untracked");
  const spec = { kind: "git", target_ref: root, paths: ["page.html", "untracked.txt"] };
  const result = await observeTarget(spec);
  assert.equal(fs.existsSync(marker), false, "target repository configuration must not execute tools");
  assert.equal(result.snapshot.identity.dirty, true);
  assert.equal(result.snapshot.identity.files.find((file) => file.path === "untracked.txt").index_oid, null);
  fs.unlinkSync(path.join(root, "page.html"));
  const deleted = await observeTarget(spec);
  assert.equal(deleted.snapshot.identity.files.find((file) => file.path === "page.html").working_sha256, null);
  assert.equal(fs.existsSync(marker), false);
});

const observeRunId = "RUN-20260918T000000Z-OBSERVE1";

async function serverFixture(t) {
  let body = "<main>Static response</main>";
  let etag = '"version-1"';
  let count = 0;
  const server = http.createServer((request, response) => {
    count += 1;
    if (request.url === "/redirect") { response.writeHead(302, { location: "/page" }); response.end(); return; }
    if (request.url === "/outside") { response.writeHead(302, { location: "http://169.254.169.254/metadata" }); response.end(); return; }
    if (request.url === "/loop") { response.writeHead(302, { location: "/loop" }); response.end(); return; }
    if (request.url === "/encoded") { response.writeHead(200, { "content-encoding": "gzip" }); response.end(body); return; }
    response.writeHead(200, { "content-type": "text/html", etag, "last-modified": "Fri, 18 Sep 2026 00:00:00 GMT" });
    response.end(request.url === "/dynamic" ? `${body} ${count}` : body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const caller = { network: "allowlisted", allowedOrigins: [origin], allowLocalhost: true };
  const runPolicy = createNetworkPolicy({ targetOrigins: [origin], allowLocalhost: true });
  return { origin, caller, runPolicy, options: { runId: observeRunId, runNetworkPolicy: runPolicy, networkPolicy: caller },
    setBody(value) { body = value; }, setEtag(value) { etag = value; }, requestCount() { return count; } };
}

test("HTTP identities pin endpoints and preserve final URL, response hash, headers and retrieval time", async (t) => {
  const server = await serverFixture(t);
  const spec = { kind: "http", target_ref: `${server.origin}/redirect` };
  const before = await observeTarget(spec, server.options);
  assert.equal(before.snapshot.identity.final_url, `${server.origin}/page`);
  assert.equal(before.snapshot.identity.redirects.length, 1);
  assert.equal(before.snapshot.identity.etag, '"version-1"');
  assert.equal(before.snapshot.identity.response_sha256, targetDigest(before.bytes));
  assert.equal(before.network.kind, "network-request-log");
  assert.equal(before.network.entries.length, 2);
  assert.ok(before.network.entries.every((entry) => entry.pinned_address === "127.0.0.1" && entry.request_sent && entry.outcome === "succeeded"));
  assert.ok(before.snapshot.captured_at);
  await assertTargetUnchanged(before.snapshot, spec, server.options);
  server.setEtag('"version-2"');
  await assert.rejects(assertTargetUnchanged(before.snapshot, spec, server.options), (error) => error.comparison.changed_identity_fields.includes("etag"));
  server.setBody("<main>New response</main>");
  const after = await observeTarget(spec, server.options);
  assert.ok(compareTargetIdentities(before.snapshot, after.snapshot).changed_identity_fields.includes("response_sha256"));
});

test("dynamic HTTP responses cannot be silently reused as the same snapshot", async (t) => {
  const server = await serverFixture(t);
  const spec = { kind: "http", target_ref: `${server.origin}/dynamic` };
  const before = await observeTarget(spec, server.options);
  assert.ok(before.snapshot.limitations.some((item) => item.includes("Dynamic")));
  await assert.rejects(assertTargetUnchanged(before.snapshot, spec, server.options), /Target drift/);
});

test("HTTP observation needs the saved run policy and fails closed before or during transmission", async (t) => {
  const server = await serverFixture(t);
  const spec = { kind: "http", target_ref: `${server.origin}/page` };
  const retired = /saved run network policy and run ID/;
  await assert.rejects(observeTarget(spec), retired);
  await assert.rejects(observeTarget(spec, { networkPolicy: server.caller }), retired);
  await assert.rejects(observeTarget(spec, { runId: observeRunId, networkPolicy: server.caller }), retired);
  await assert.rejects(observeTarget(spec, { runNetworkPolicy: server.runPolicy, networkPolicy: server.caller }), retired);
  await assert.rejects(observeTarget(spec, { ...server.options, networkPolicy: { ...server.caller, network: "denied" } }), /allowlist|caller/i);
  await assert.rejects(observeTarget({ ...spec, target_ref: spec.target_ref.replace("http://", "http://user:secret@") }, server.options), /credentials|Network operation stopped/);
  await assert.rejects(observeTarget({ ...spec, target_ref: `${spec.target_ref}#fragment` }, server.options), /fragments|Network operation stopped/);
  assert.equal(server.requestCount(), 0);
  await assert.rejects(observeTarget({ ...spec, target_ref: `${server.origin}/outside` }, server.options), (error) => /Network operation stopped/.test(error.message) && error.networkLog?.entries.some((entry) => entry.decision === "denied"));
  await assert.rejects(observeTarget({ ...spec, target_ref: `${server.origin}/loop` }, server.options), /redirect_loop/);
  await assert.rejects(observeTarget({ ...spec, target_ref: `${server.origin}/encoded` }, server.options), /unexpected_content_encoding/);
  // The abort and size-limit codes race, so the log is the stable evidence of a transmitted-then-failed request.
  await assert.rejects(observeTarget(spec, { ...server.options, runNetworkPolicy: { ...server.runPolicy, max_response_bytes: 3 } }), (error) => {
    const entry = error.networkLog.entries[0];
    return entry.decision === "allowed" && entry.outcome === "failed" && entry.request_sent === true && entry.response_bytes > 3;
  });
});

function webState(t) {
  const root = temporary(t);
  const file = path.join(root, "bundle.json");
  const dom = "<main>Saved application state</main>";
  const ax = [{ role: "main", name: "Saved application state" }];
  const bundle = { schema_version: "1.0.0", kind: "web-evidence-bundle", captured_at: "2026-09-18T00:00:00Z",
    target: { requested_url: "https://example.invalid/app?private-state=1", final_url: "https://example.invalid/app?private-state=1", http_status: 200,
      dom_sha256: targetDigest(dom), ax_tree_sha256: targetDigest(JSON.stringify(ax)) },
    environment: { viewport: { width: 800, height: 600 }, rendering: { locale: "ja-JP" } },
    evidence: { dom, accessibility_tree: ax } };
  fs.writeFileSync(file, JSON.stringify(bundle));
  return { file, bundle, spec: { kind: "web_state", target_ref: bundle.target.requested_url, bundle_path: file, locale: "ja-JP", authentication_state_id: "anonymous", feature_flags: ["menu-v2"] } };
}

test("saved rendered states bind DOM and AX bytes to viewport, locale and declared authentication context", async (t) => {
  const f = webState(t);
  const before = await observeTarget(f.spec);
  assert.equal(before.snapshot.identity.dom_sha256, f.bundle.target.dom_sha256);
  assert.equal(before.snapshot.evidence_bindings.length, 3);
  assert.equal(before.snapshot.identity.authentication_state_id, "anonymous");
  assert.equal(before.snapshot.captured_at, f.bundle.captured_at);
  assert.ok(before.snapshot.limitations.some((item) => item.includes("not the current live page")));
  assert.equal(before.snapshot.publication, "private_by_default");
  await assertTargetUnchanged(before.snapshot, f.spec);
  await assert.rejects(assertTargetUnchanged(before.snapshot, { ...f.spec, authentication_state_id: "account-role-editor" }), /Target drift/);
  await assert.rejects(observeTarget({ ...f.spec, locale: "en-US" }), /locale/);
  f.bundle.evidence.dom = "<main>Forged content</main>";
  fs.writeFileSync(f.file, JSON.stringify(f.bundle));
  await assert.rejects(observeTarget(f.spec), /hash mismatch/);
});

test("missing capture times and self-inconsistent identities are rejected instead of repaired", async (t) => {
  const f = webState(t);
  const before = (await observeTarget(f.spec)).snapshot;
  const forged = structuredClone(before);
  forged.identity.viewport.width = 1000;
  assert.ok(targetIdentityErrors(forged).some((error) => /snapshot ID/.test(error)));
  const disclosed = structuredClone(before);
  disclosed.publication = "public";
  assert.ok(targetIdentityErrors(disclosed).length);
  delete f.bundle.captured_at;
  fs.writeFileSync(f.file, JSON.stringify(f.bundle));
  await assert.rejects(observeTarget(f.spec), /original capture time/);
});
