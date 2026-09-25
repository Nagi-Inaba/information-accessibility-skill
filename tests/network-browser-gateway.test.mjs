import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { installBrowserNetworkGateway } from "../shared/skill/scripts/lib/browser-network-gateway.mjs";

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
