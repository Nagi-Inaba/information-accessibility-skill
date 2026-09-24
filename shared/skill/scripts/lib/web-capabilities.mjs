import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const contract = JSON.parse(fs.readFileSync(new URL("../../references/web-capabilities.json", import.meta.url), "utf8"));
export const WEB_CAPABILITY_IDS = Object.freeze(contract.capabilities.map((item) => item.id));
export const DEFAULT_WEB_CAPABILITIES = Object.freeze([...contract.default_required]);
const FIXTURE_URL = "http://capability-fixture.invalid/";
const FIXTURE = '<!doctype html><html lang="en"><head><title>Runtime capability fixture</title><meta name="viewport" content="width=device-width"></head><body><button id="first">First probe</button><button id="second">Second probe</button><script>document.body.dataset.rendered="yes"</script></body></html>';

export class WebCapabilityError extends Error {
  constructor(report) {
    const missing = report.capabilities.filter((item) => report.missing_required.includes(item.id));
    super(`Web capability preflight blocked; target inspection has not started. ${missing.map((item) => `${item.id}: ${item.reason}. Next: ${item.next_test}`).join(" ")}`);
    this.name = "WebCapabilityError";
    this.code = "WEB_CAPABILITY_UNAVAILABLE";
    this.exitCode = 4;
    this.report = report;
  }
}

export function validateRequiredCapabilities(value = DEFAULT_WEB_CAPABILITIES) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !WEB_CAPABILITY_IDS.includes(item)) || new Set(value).size !== value.length) {
    throw new Error(`Required capabilities must be a nonempty unique list of: ${WEB_CAPABILITY_IDS.join(", ")}`);
  }
  return [...value];
}

export function browserLaunchOptions(options = {}) {
  if (options.browserChannel !== undefined && options.browserChannel !== "chrome") throw new Error("--browser-channel accepts only chrome.");
  return { headless: true, timeout: 15_000, ...(options.browserChannel ? { channel: "chrome" } : {}) };
}

function result(required, reason = "runtime_not_probed") {
  return {
    schema_version: "1.0.0", kind: "web-capability-preflight", adapter: contract.adapter,
    status: "blocked", checked_at: new Date().toISOString(), probe_scope: "isolated_fixture",
    runtime: { playwright_version: null, browser_version: null, browser_channel: null },
    required: validateRequiredCapabilities(required), missing_required: [],
    capabilities: contract.capabilities.map((item) => ({ ...item, status: "not_verified", reason,
      target_check_status: "unconfirmed", next_test: item.next_test })),
    target_inspected: false, inspection_complete: false, profile_outcomes_written: false,
    limitations: ["Fixture success does not establish target behavior or grant network/interaction permission.",
      "Actual screen-reader behavior and other host browser integrations are not automatically detected."]
  };
}

function finish(report) {
  report.missing_required = report.required.filter((id) => report.capabilities.find((item) => item.id === id).status !== "available");
  report.status = report.missing_required.length ? "blocked" : "ready";
  report.unconfirmed_checks = report.capabilities.filter((item) => item.status !== "available")
    .map(({ id, checks, reason, next_test }) => ({ capability: id, checks, reason, next_test, status: "unconfirmed" }));
  return report;
}

export function unavailableWebCapabilities(reason, options = {}) {
  const report = result(options.required, reason);
  for (const item of report.capabilities) {
    if (item.id === "screen_reader_runtime") item.reason = "external_human_session_required";
    else item.status = "unavailable";
  }
  return finish(report);
}

export function assertWebCapabilities(report) {
  if (report.status !== "ready") throw new WebCapabilityError(report);
}

async function deadline(operation, milliseconds) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Capability operation timed out.")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

// Always use a separate context containing only this trusted fixed fixture.
// All requests are fulfilled here or aborted; no remote test endpoint is contacted.
export async function probeBrowserCapabilities(browser, options = {}) {
  const report = result(options.required);
  report.runtime = { playwright_version: options.playwrightVersion ?? null,
    browser_version: browser.version(), browser_channel: options.browserChannel ?? "playwright-chromium" };
  const set = (id, available, reason) => Object.assign(report.capabilities.find((item) => item.id === id), {
    status: available ? "available" : "unavailable", reason
  });
  const check = async (id, fn) => {
    try { set(id, Boolean(await deadline(fn(), 5_000)), "fixture_check_failed");
      const item = report.capabilities.find((item) => item.id === id);
      if (item.status === "available") item.reason = "verified_on_isolated_fixture";
    } catch { set(id, false, "fixture_operation_unavailable"); }
  };
  let context;
  try {
    context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block", acceptDownloads: false });
    context.setDefaultTimeout(5_000);
    context.setDefaultNavigationTimeout(5_000);
    let fixtureRequests = 0;
    let blockedRequests = 0;
    let blockedSockets = 0;
    const canRouteSockets = typeof context.routeWebSocket === "function";
    if (canRouteSockets) await context.routeWebSocket(/.*/u, async (socket) => {
      blockedSockets += 1;
      await socket.close({ code: 1008, reason: "Capability fixture block" });
    });
    await context.route("**/*", async (route) => {
      if (route.request().method() === "GET" && route.request().url() === FIXTURE_URL) {
        fixtureRequests += 1;
        await route.fulfill({ status: 200, contentType: "text/html", body: FIXTURE });
      } else {
        if (route.request().url() === "http://blocked-capability.invalid/probe") blockedRequests += 1;
        await route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    const response = await page.goto(FIXTURE_URL, { waitUntil: "load" });
    await check("network_fetch", async () => {
      if (!canRouteSockets) return false;
      const denied = await page.evaluate(async () => {
        const requestDenied = await fetch("http://blocked-capability.invalid/probe").then(() => false, () => true);
        const socketDenied = await new Promise((resolve) => {
          const socket = new WebSocket("ws://blocked-capability.invalid/probe");
          const timer = setTimeout(() => { socket.close(); resolve(false); }, 2_000);
          socket.onmessage = () => { clearTimeout(timer); socket.close(); resolve(false); };
          socket.onerror = () => { clearTimeout(timer); resolve(true); };
          socket.onclose = () => { clearTimeout(timer); resolve(true); };
        });
        return requestDenied && socketDenied;
      });
      return fixtureRequests === 1 && response?.status() === 200 && denied && blockedRequests === 1 && blockedSockets === 1;
    });
    await check("browser_dom", () => page.evaluate(() => document.body.dataset.rendered === "yes" && document.querySelector("#first")?.textContent === "First probe"));
    await check("accessibility_tree", async () => {
      const cdp = await context.newCDPSession(page);
      try {
        await cdp.send("Accessibility.enable");
        const tree = await cdp.send("Accessibility.getFullAXTree");
        return tree.nodes.some((node) => node.role?.value === "button" && node.name?.value === "First probe");
      } finally { await cdp.detach(); }
    });
    await check("keyboard_input", async () => {
      await page.keyboard.press("Tab");
      const first = await page.evaluate(() => document.activeElement?.id);
      await page.keyboard.press("Tab");
      const second = await page.evaluate(() => document.activeElement?.id);
      return first === "first" && second === "second";
    });
    await check("responsive_viewport", async () => {
      await page.setViewportSize({ width: 320, height: 640 });
      const narrow = await page.evaluate(() => window.innerWidth === 320 && matchMedia("(max-width: 400px)").matches);
      await page.setViewportSize({ width: 1280, height: 800 });
      return narrow && await page.evaluate(() => window.innerWidth === 1280 && !matchMedia("(max-width: 400px)").matches);
    });
  } catch {
    for (const item of report.capabilities) {
      if (item.id !== "screen_reader_runtime" && item.status === "not_verified") set(item.id, false, "fixture_context_unavailable");
    }
  } finally {
    if (context) await deadline(context.close(), 5_000);
  }
  report.capabilities.find((item) => item.id === "screen_reader_runtime").reason = "external_human_session_required";
  return finish(report);
}

export async function loadWebRuntime() {
  const runtime = await import("playwright");
  return { ...runtime, version: require("playwright/package.json").version };
}

export async function preflightWeb(options = {}, load = loadWebRuntime) {
  validateRequiredCapabilities(options.required);
  const launch = browserLaunchOptions(options);
  let runtime;
  try { runtime = await load(); } catch { return unavailableWebCapabilities("playwright_not_available", options); }
  if (runtime.version !== contract.dependencies.playwright) return unavailableWebCapabilities("unsupported_playwright_version", options);
  let server;
  try { server = await runtime.chromium.launchServer({ ...launch, host: "127.0.0.1", args: ["--host-resolver-rules=MAP * ~NOTFOUND", "--no-proxy-server"] }); }
  catch { return unavailableWebCapabilities("browser_launch_unavailable", options); }
  let browser;
  let report;
  try {
    browser = await deadline(runtime.chromium.connect(server.wsEndpoint(), { timeout: 5_000 }), 6_000);
    report = await deadline(probeBrowserCapabilities(browser, { ...options, playwrightVersion: runtime.version }), 20_000);
  } catch { report = unavailableWebCapabilities("fixture_runtime_failed_or_timed_out", options); }
  finally {
    // Windows process teardown can exceed two seconds during concurrent scans.
    // Keep a finite grace period before force-killing this owned process.
    try { await deadline(server.close(), 10_000); }
    catch {
      report = unavailableWebCapabilities("fixture_runtime_cleanup_failed", options);
      try { await deadline(server.kill(), 2_000); }
      catch { server.process()?.kill("SIGKILL"); }
    }
  }
  return report;
}
