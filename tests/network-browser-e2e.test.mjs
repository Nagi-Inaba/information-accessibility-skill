import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import test from "node:test";
import { createNetworkPolicy } from "../codex/skills/information-accessibility-practice/scripts/lib/network-policy.mjs";
import { captureWebEvidence } from "../codex/skills/information-accessibility-practice/scripts/capture-web-evidence.mjs";
import { installBrowserNetworkGateway } from "../shared/skill/scripts/lib/browser-network-gateway.mjs";

const enabled = process.env.RUN_WEB_CAPABILITIES_E2E === "1";
async function server(t, handler) {
  const value = http.createServer(handler);
  await new Promise((resolve) => value.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { value.closeAllConnections(); value.close(resolve); }));
  return `http://127.0.0.1:${value.address().port}`;
}
function options(origin, policy, caller) {
  return { url: `${origin}/`, browserChannel: process.env.A11Y_BROWSER_CHANNEL, allowLocalhost: true, focusSteps: 0,
    settleBeforeInspection: true, networkRun: { run_id: "RUN-20260918T000000Z-NETBRWS1", permissions: { network_policy: policy } },
    networkCaller: caller ?? { network: "allowlisted", allowedOrigins: policy.targets.origins, allowLocalhost: true } };
}

test("browser gateway retains redirect lineage when Network metadata is unavailable", async () => {
  const cdp = new EventEmitter();
  cdp.send = async (method) => method === "Page.getFrameTree"
    ? { frameTree: { frame: { id: "main", url: "https://example.test/" } } } : {};
  const seen = [];
  const network = {
    async request(request) {
      seen.push(request);
      return { status: 200, headers: {}, bytes: Buffer.from("ok") };
    },
    stop() { throw new Error("Unexpected network stop."); }
  };
  const gateway = await installBrowserNetworkGateway({ newCDPSession: async () => cdp }, {}, network,
    new URL("https://example.test/"));
  const pause = (requestId, url, redirectedRequestId) => cdp.emit("Fetch.requestPaused", {
    requestId, networkId: `missing-${requestId}`, frameId: "main", resourceType: "Stylesheet",
    request: { url, method: "GET" }, ...(redirectedRequestId ? { redirectedRequestId } : {})
  });
  pause("first", "https://example.test/style.css");
  await gateway.drain();
  pause("second", "https://example.test/final.css", "first");
  await gateway.drain();
  assert.equal(gateway.failure, null);
  assert.equal(seen[0].redirect_from, null);
  assert.equal(seen[1].redirect_from, "https://example.test/style.css");
});

test("run browser gateway records redirects, frames and subresources through pinned bounded HTTP", { skip: !enabled }, async (t) => {
  const requested = [];
  const origin = await server(t, (req, res) => {
    requested.push(req.url);
    if (req.url === "/style.css") { res.writeHead(302, { location: "/final.css" }); res.end(); }
    else if (req.url === "/final.css") { res.setHeader("content-type", "text/css"); res.end("body { color: rgb(1, 2, 3) }"); }
    else { res.setHeader("content-type", "text/html"); res.end(req.url === "/frame" ? "<button>Frame</button>" : '<!doctype html><html lang="en"><head><title>Network</title><link rel="stylesheet" href="/style.css"></head><body><button>Main</button><iframe src="/frame"></iframe></body></html>'); }
  });
  const policy = createNetworkPolicy({ targetOrigins: [origin], allowLocalhost: true });
  const evidence = await captureWebEvidence(options(origin, policy));
  assert.match(evidence.evidence.dom, /Main/);
  assert.ok(requested.includes("/final.css"));
  const entries = evidence.networkLog.entries;
  assert.ok(entries.some((entry) => entry.resource_type === "iframe"));
  assert.ok(entries.some((entry) => entry.resource_type === "subresource" && entry.redirect_from?.endsWith("/style.css")));
  assert.ok(entries.every((entry) => entry.decision === "allowed" && entry.pinned_address === "127.0.0.1"));
});

test("browser rejects cross-origin iframe and CDN redirects before the disallowed destination is reached", { skip: !enabled }, async (t) => {
  let hits = 0;
  const destination = await server(t, (_req, res) => { hits++; res.end("destination"); });
  let content = "iframe";
  const origin = await server(t, (req, res) => {
    if (req.url === "/style.css") { res.writeHead(302, { location: `${destination}/cdn.css` }); res.end(); }
    else { res.setHeader("content-type", "text/html"); res.end(content === "iframe" ? `<iframe src="${destination}/frame"></iframe>` : '<link rel="stylesheet" href="/style.css">'); }
  });
  const policy = createNetworkPolicy({ targetOrigins: [origin, destination], allowLocalhost: true });
  await assert.rejects(captureWebEvidence(options(origin, policy)), (error) => {
    assert.ok(error.networkLog.entries.some((entry) => entry.reason === "cross_origin_resource_denied"));
    return true;
  });
  assert.equal(hits, 0);
  content = "cdn";
  await assert.rejects(captureWebEvidence(options(origin, policy)), (error) => {
    assert.ok(error.networkLog.entries.some((entry) => entry.reason === "cross_origin_redirect_denied"));
    return true;
  });
  assert.equal(hits, 0);
});

test("uncontrolled popup traffic cannot bypass the gateway even for a direct loopback IP", { skip: !enabled }, async (t) => {
  let hits = 0;
  const destination = await server(t, (_req, res) => { hits++; res.end("unexpected"); });
  const origin = await server(t, (_req, res) => { res.setHeader("content-type", "text/html"); res.end(`<script>window.open('${destination}/popup')</script><button>Main</button>`); });
  const policy = createNetworkPolicy({ targetOrigins: [origin], allowLocalhost: true });
  await assert.rejects(captureWebEvidence(options(origin, policy)), (error) => {
    assert.ok(error.networkLog.blocked_channel_count > 0);
    return true;
  });
  assert.equal(hits, 0);
});
