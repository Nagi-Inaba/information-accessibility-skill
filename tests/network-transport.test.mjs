import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createNetworkPolicy, networkPolicyHash } from "../codex/skills/information-accessibility-practice/scripts/lib/network-policy.mjs";
import { createNetworkSession } from "../codex/skills/information-accessibility-practice/scripts/lib/network-transport.mjs";
import { validateNetworkEvidence } from "../codex/skills/information-accessibility-practice/scripts/lib/network-evidence.mjs";

const runId = "RUN-20260918T000000Z-NETWORK1";
async function fixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const policy = createNetworkPolicy({ targetOrigins: [origin], allowLocalhost: true });
  const caller = { network: "allowlisted", allowedOrigins: [origin], allowLocalhost: true };
  return { origin, policy, caller, session: (overrides = {}) => createNetworkSession({ runId, policy, caller, ...overrides }) };
}

test("transport records pinned GET and HEAD without forwarding credentials, with run and policy bindings", async (t) => {
  const requests = [];
  const f = await fixture(t, (req, res) => { requests.push(req); res.end("hello"); });
  const session = f.session();
  assert.equal((await session.fetch({ url: `${f.origin}/` })).bytes.toString(), "hello");
  assert.equal((await session.fetch({ url: `${f.origin}/`, method: "HEAD" })).bytes.length, 0);
  assert.deepEqual(requests.map((req) => req.method), ["GET", "HEAD"]);
  assert.ok(requests.every((req) => !req.headers.authorization && !req.headers.cookie && req.headers["accept-encoding"] === "identity"));
  const log = session.log();
  assert.equal(log.run_id, runId);
  assert.equal(log.network_policy_sha256, networkPolicyHash(f.policy));
  assert.ok(log.entries.every((entry) => entry.pinned_address === "127.0.0.1" && entry.request_sent && entry.outcome === "succeeded"));
  const run = { schema_version: "16.0.0", run_id: runId, permissions: { network: "allowlisted", network_policy: f.policy } };
  const reference = { target_ref: `${f.origin}/`, captured_at: new Date().toISOString() };
  validateNetworkEvidence(Buffer.from(JSON.stringify(log)), run, reference);
  for (const mutate of [
    (value) => { value.run_id += "X"; },
    (value) => { value.network_policy_sha256 = "0".repeat(64); },
    (value) => { value.entries[0].pinned_address = "10.0.0.1"; },
    (value) => { value.entries[0].url = "https://other.example/"; },
    (value) => { value.entries[0].method = "POST"; }
  ]) {
    const altered = structuredClone(log); mutate(altered);
    assert.throws(() => validateNetworkEvidence(Buffer.from(JSON.stringify(altered)), run, reference), /Network evidence/);
  }
});

test("scope, unsafe methods, private networks and caller-only localhost grants are denied before transmission", async (t) => {
  let received = 0;
  const f = await fixture(t, (_req, res) => { received++; res.end("ok"); });
  for (const [overrides, request, code] of [
    [{}, { url: `${f.origin}/`, method: "POST" }, "method_not_allowed"],
    [{ caller: { ...f.caller, allowedOrigins: ["https://elsewhere.example"] } }, { url: `${f.origin}/` }, "outside_caller_scope"],
    [{ policy: { ...f.policy, allow_localhost_fixture: false } }, { url: `${f.origin}/` }, "PRIVATE_ADDRESS_DENIED"],
    [{ caller: { ...f.caller, allowLocalhost: false } }, { url: `${f.origin}/` }, "PRIVATE_ADDRESS_DENIED"]
  ]) {
    await assert.rejects(f.session(overrides).fetch(request), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.networkLog.entries[0].request_sent, false);
      assert.equal(error.networkLog.entries[0].outcome, "blocked");
      return true;
    });
  }
  assert.equal(received, 0);
  for (const address of ["10.0.0.1", "169.254.169.254", "192.0.2.1", "[::1]"]) {
    const origin = `http://${address}`;
    const policy = createNetworkPolicy({ targetOrigins: [origin] });
    await assert.rejects(createNetworkSession({ runId, policy, caller: { network: "allowlisted", allowedOrigins: [origin] } }).fetch({ url: `${origin}/` }), /PRIVATE_ADDRESS_DENIED/);
  }
});

test("each redirect is checked against exact query scope and separate origin permission", async (t) => {
  let destinationCalls = 0;
  const dest = await fixture(t, (_req, res) => { destinationCalls++; res.end("destination"); });
  const f = await fixture(t, (req, res) => {
    if (req.url === "/same") { res.writeHead(302, { location: "/?q=1" }); res.end(); }
    else if (req.url === "/cross") { res.writeHead(302, { location: `${dest.origin}/` }); res.end(); }
    else res.end("ok");
  });
  assert.equal((await f.session().fetch({ url: `${f.origin}/same` })).redirects.length, 1);
  const policy = { ...f.policy, targets: { origins: [f.origin, dest.origin], exact_urls: [] } };
  const caller = { ...f.caller, allowedOrigins: [f.origin, dest.origin] };
  await assert.rejects(f.session({ policy, caller }).fetch({ url: `${f.origin}/cross` }), /cross_origin_redirect_denied/);
  assert.equal(destinationCalls, 0);
  assert.equal((await f.session({ policy: { ...policy, redirects: "allowlisted" }, caller }).fetch({ url: `${f.origin}/cross` })).bytes.toString(), "destination");
  const exact = { ...f.policy, targets: { origins: [], exact_urls: [`${f.origin}/same`, `${f.origin}/?q=2`] } };
  await assert.rejects(f.session({ policy: exact }).fetch({ url: `${f.origin}/same` }), /outside_run_scope/);
});

test("byte and request limits are bounded, while transmitted failures remain distinct from denials", async (t) => {
  const f = await fixture(t, (req, res) => {
    if (req.url === "/encoded") res.setHeader("content-encoding", "gzip");
    res.end("1234567890");
  });
  await assert.rejects(f.session({ policy: { ...f.policy, max_response_bytes: 5 } }).fetch({ url: `${f.origin}/` }), (error) => {
    const entry = error.networkLog.entries[0];
    assert.equal(entry.decision, "allowed"); assert.equal(entry.outcome, "failed"); assert.equal(entry.request_sent, true);
    assert.ok(entry.response_bytes > 5);
    return true;
  });
  await assert.rejects(f.session().fetch({ url: `${f.origin}/encoded` }), /unexpected_content_encoding/);
  const limited = f.session({ policy: { ...f.policy, max_requests: 1 } });
  await limited.fetch({ url: `${f.origin}/` });
  await assert.rejects(limited.fetch({ url: `${f.origin}/` }), /request_limit_exceeded/);
  assert.equal(limited.log().truncated, true);
  assert.equal(limited.log().entries.length, 1);
});

test("DNS failure returns an attached failed log without an unhandled rejection", async () => {
  const origin = "https://does-not-exist.invalid";
  const policy = createNetworkPolicy({ targetOrigins: [origin] });
  const session = createNetworkSession({ runId, policy, caller: { network: "allowlisted", allowedOrigins: [origin] } });
  await assert.rejects(session.fetch({ url: `${origin}/` }), /DNS_RESOLUTION_FAILED/);
  assert.equal(session.log().entries[0].request_sent, false);
});

test("standards-source access uses a separate purpose and session body budget cannot be multiplied by requests", async (t) => {
  const f = await fixture(t, (_req, res) => res.end(Buffer.alloc(9 * 1024 * 1024, 65)));
  const policy = { ...f.policy, targets: { origins: [], exact_urls: [] }, standards_sources: { origins: [f.origin], exact_urls: [] } };
  await assert.rejects(f.session({ policy }).fetch({ url: `${f.origin}/` }), /outside_run_scope/);
  const sources = f.session({ policy, purpose: "standards_source" });
  for (let index = 0; index < 3; index++) await sources.fetch({ url: `${f.origin}/` });
  await assert.rejects(sources.fetch({ url: `${f.origin}/` }), /session_byte_limit_exceeded|response_aborted/);
  assert.equal(sources.log().purpose, "standards_source");
  assert.equal(sources.log().entries.at(-1).outcome, "failed");
  assert.equal(sources.log().entries[0].resource_type, "source_document");
});

test("stopping a session aborts pending I/O and prevents queued operations from starting", async (t) => {
  let reached;
  const started = new Promise((resolve) => { reached = resolve; });
  let requests = 0;
  const f = await fixture(t, () => { requests++; reached(); });
  const session = f.session();
  const pending = assert.rejects(session.fetch({ url: `${f.origin}/` }), /ABORT_ERR|network_session_stopped/);
  await started;
  session.stop();
  await pending;
  await assert.rejects(session.fetch({ url: `${f.origin}/queued` }), /network_session_stopped/);
  assert.equal(requests, 1);
  assert.equal(session.log().entries[0].outcome, "failed");
  assert.equal(session.log().entries[1].request_sent, false);
});
