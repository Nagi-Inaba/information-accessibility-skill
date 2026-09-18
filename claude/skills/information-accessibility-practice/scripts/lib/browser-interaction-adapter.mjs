import crypto from "node:crypto";

const adapters = new WeakSet();
export const isBrowserInteractionAdapter = (value) => adapters.has(value);

// Only native Tab focus sampling is supported. Script execution stays disabled
// until this disposable context is closed; no application handlers are tested.
export async function createBrowserInteractionAdapter({ page, context, networkSession, gateway }) {
  if (!networkSession || !gateway) throw new Error("Supervised interaction requires the run-bound network gateway.");
  const cdp = await context.newCDPSession(page);
  let frozen = false, stopped = false;
  const adapter = Object.freeze({
    id: "chromium-frozen-focus-v1",
    supports(action) {
      return action?.operation === "focus" && ["next", "previous"].includes(action.direction)
        && Object.keys(action).length === 2;
    },
    async prepare() {
      if (stopped) throw new Error("Interaction adapter stopped.");
      if (frozen) return;
      await gateway.drain();
      if (gateway.failure) throw gateway.failure;
      await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
      networkSession.stop();
      await cdp.send("Page.stopLoading");
      frozen = true;
    },
    async snapshot() {
      const focus = await page.evaluate(() => {
        const element = document.activeElement;
        return element ? { tag: element.tagName?.toLowerCase() ?? null, id: element.id?.slice(0, 256) ?? null,
          role: element.getAttribute?.("role")?.slice(0, 256) ?? null,
          name: (element.getAttribute?.("aria-label") || element.textContent || "").trim().slice(0, 160) } : null;
      });
      return { url: page.url(), dom_sha256: crypto.createHash("sha256").update(await page.content()).digest("hex"), focus };
    },
    async perform(action, guard) {
      if (stopped || !frozen || !adapter.supports(action) || typeof guard !== "function" || guard() !== true) throw new Error("Unsupported, unapproved or unprepared interaction.");
      await page.keyboard.press(action.direction === "next" ? "Tab" : "Shift+Tab");
    },
    stop() { stopped = true; networkSession.stop(); void page.close().catch(() => {}); }
  });
  adapters.add(adapter);
  return adapter;
}
