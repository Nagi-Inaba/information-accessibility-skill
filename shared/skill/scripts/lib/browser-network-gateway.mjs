// CDP Fetch pauses each redirect hop. Playwright route alone does not receive
// redirected requests, so it cannot establish the per-hop contract here.
export async function installBrowserNetworkGateway(context, page, network, requested) {
  const cdp = await context.newCDPSession(page);
  const frames = new Map();
  const requests = new Map();
  const pending = new Set();
  let failure = null;
  const lanes = Array.from({ length: 4 }, () => Promise.resolve());
  let nextLane = 0;
  const tree = await cdp.send("Page.getFrameTree");
  const mainId = tree.frameTree.frame.id;
  const recordFrame = (frame) => frames.set(frame.id, { parent: frame.parentId ?? null, url: frame.url });
  recordFrame(tree.frameTree.frame);
  cdp.on("Page.frameAttached", ({ frameId, parentFrameId }) => frames.set(frameId, { parent: parentFrameId, url: "about:blank" }));
  cdp.on("Page.frameNavigated", ({ frame }) => recordFrame(frame));
  cdp.on("Network.requestWillBeSent", (event) => {
    requests.set(event.requestId, { redirect: event.redirectResponse?.url ?? null, document: event.documentURL });
  });
  cdp.on("Network.loadingFinished", ({ requestId }) => requests.delete(requestId));
  cdp.on("Network.loadingFailed", ({ requestId }) => requests.delete(requestId));
  cdp.on("Fetch.requestPaused", (event) => {
    if (pending.size >= 64) {
      try { network.rejectOverflow("browser_queue_limit_exceeded"); } catch (error) { failure ??= error; }
      network.stop();
      cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" }).catch(() => {});
      return;
    }
    // A queued lane may run after loadingFinished deletes or a redirect overwrites this ID.
    const metadata = requests.get(event.networkId);
    const lane = nextLane++ % lanes.length;
    const operation = lanes[lane].then(async () => {
      try {
        const navigation = event.resourceType === "Document";
        const type = navigation ? event.frameId === mainId ? "main_document" : "iframe" : "subresource";
        const frame = frames.get(event.frameId);
        if (!metadata) throw Object.assign(new Error(`Browser request metadata unavailable; per-hop enforcement cannot be established (${type}, networkId=${Boolean(event.networkId)}, redirectedRequestId=${Boolean(event.redirectedRequestId)}).`), { code: "BROWSER_REQUEST_METADATA_MISSING" });
        const initiator = type === "iframe" ? frames.get(frame?.parent)?.url : metadata?.document ?? frame?.url;
        const response = await network.request({ url: event.request.url, method: event.request.method, resource_type: type,
          initiator_url: /^https?:/u.test(initiator ?? "") ? initiator : requested.href, redirect_from: metadata?.redirect ?? null });
        const headers = Object.entries(response.headers).filter(([key]) => !["set-cookie", "connection", "transfer-encoding", "content-length"].includes(key))
          .map(([name, value]) => ({ name, value: Array.isArray(value) ? value.join(", ") : String(value) }));
        await cdp.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: response.status,
          responseHeaders: headers, body: response.bytes.toString("base64") });
      } catch (error) {
        failure ??= error;
        network.stop();
        await cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" }).catch(() => {});
      }
    });
    lanes[lane] = operation.catch(() => {});
    pending.add(operation);
    operation.finally(() => pending.delete(operation)).catch(() => {});
  });
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  return { async drain() { while (pending.size) await Promise.allSettled([...pending]); }, get failure() { return failure; } };
}
