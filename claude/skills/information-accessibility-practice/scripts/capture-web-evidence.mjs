import crypto from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { assertNewOutputPath, writeNewJson } from "./lib/audit-run.mjs";

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const SAFE_LOCAL_PROTOCOLS = new Set(["about:", "blob:", "data:"]);
const MAX_BLOCKED_REQUEST_ENTRIES = 500;
const MAX_BLOCKED_CHANNEL_ENTRIES = 100;

export class WebInspectionError extends Error {
  constructor(message, { exitCode = 3, code = "WEB_INSPECTION_ERROR", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "WebInspectionError";
    this.exitCode = exitCode;
    this.code = code;
  }
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeIpLiteral(value) {
  return String(value)
    .trim()
    .replace(/^\[|\]$/gu, "")
    .replace(/%.+$/u, "")
    .toLowerCase();
}

function isPrivateIpv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b, c] = octets;
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function mappedIpv4FromIpv6(address) {
  const lower = normalizeIpLiteral(address);
  const dottedMatch = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(lower);
  if (dottedMatch) return dottedMatch[1];
  if (!lower.startsWith("::ffff:")) return null;
  const tail = lower.slice("::ffff:".length).split(":");
  if (tail.length !== 2 || tail.some((part) => !/^[a-f0-9]{1,4}$/u.test(part))) return null;
  const high = Number.parseInt(tail[0], 16);
  const low = Number.parseInt(tail[1], 16);
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

export function isPrivateAddress(value) {
  const address = normalizeIpLiteral(value);
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family !== 6) return false;

  const mapped = mappedIpv4FromIpv6(address);
  if (mapped) return isPrivateIpv4(mapped);

  if (address === "::" || address === "::1") return true;
  const firstGroup = Number.parseInt(address.split(":")[0] || "0", 16);
  if ((firstGroup & 0xffc0) === 0xfe80) return true;
  if ((firstGroup & 0xfe00) === 0xfc00) return true;
  if ((firstGroup & 0xff00) === 0xff00) return true;
  if (address.startsWith("2001:db8:") || address === "2001:db8::") return true;
  if (address.startsWith("2001:0:") || address === "2001::") return true;
  if (address.startsWith("2002:")) return true;
  return false;
}

function isExplicitLoopback(hostname) {
  const normalized = normalizeIpLiteral(hostname);
  return normalized === "localhost"
    || normalized === "localhost.localdomain"
    || normalized === "::1"
    || (isIP(normalized) === 4 && normalized.startsWith("127."));
}

export function sanitizeNetworkUrl(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "withheld-invalid-url";
  }
}

export function parseTargetUrl(value, { allowLocalhost = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new WebInspectionError("Target URL is invalid.", { exitCode: 2, code: "INVALID_TARGET_URL", cause });
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new WebInspectionError("Target URL must use http or https.", { exitCode: 3, code: "UNSAFE_TARGET_PROTOCOL" });
  }
  if (url.username || url.password) {
    throw new WebInspectionError("Target URL must not contain credentials.", { exitCode: 3, code: "TARGET_CREDENTIALS_DENIED" });
  }
  if (!allowLocalhost && isExplicitLoopback(url.hostname)) {
    throw new WebInspectionError("Localhost targets require --allow-localhost.", { exitCode: 3, code: "LOCALHOST_DENIED" });
  }
  return url;
}

export async function resolveInspectionEndpoint(url, { allowLocalhost = false } = {}) {
  const hostname = normalizeIpLiteral(url.hostname);
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname) && !(allowLocalhost && isExplicitLoopback(hostname))) {
      throw new WebInspectionError("Private, loopback, link-local, or reserved target addresses are denied by default.", {
        exitCode: 3,
        code: "PRIVATE_ADDRESS_DENIED"
      });
    }
    return { hostname, address: hostname, family: isIP(hostname) };
  }

  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch (cause) {
    throw new WebInspectionError("Target hostname did not resolve.", { exitCode: 3, code: "DNS_RESOLUTION_FAILED", cause });
  }
  if (!records.length) {
    throw new WebInspectionError("Target hostname did not resolve.", { exitCode: 3, code: "DNS_RESOLUTION_FAILED" });
  }
  if (records.some((record) => isPrivateAddress(record.address))) {
    const loopbackOnly = records.every((record) => isExplicitLoopback(record.address));
    if (!(allowLocalhost && isExplicitLoopback(hostname) && loopbackOnly)) {
      throw new WebInspectionError("Target hostname resolves to a private, loopback, link-local, or reserved address.", {
        exitCode: 3,
        code: "PRIVATE_DNS_RESULT_DENIED"
      });
    }
  }
  const preferred = records.find((record) => record.family === 4) ?? records[0];
  return { hostname, address: normalizeIpLiteral(preferred.address), family: preferred.family };
}

export function buildHostResolverRules(endpoints) {
  const maps = [];
  const exclusions = [];
  for (const endpoint of endpoints) {
    if (isIP(endpoint.hostname)) {
      exclusions.push(`EXCLUDE ${endpoint.hostname}`);
      continue;
    }
    const address = endpoint.family === 6 ? `[${endpoint.address}]` : endpoint.address;
    maps.push(`MAP ${endpoint.hostname} ${address}`);
  }
  return [...maps, ...exclusions, "MAP * ~NOTFOUND"].join(", ");
}

async function resolveAllowedEndpoints(requested, allowedOrigins, options) {
  const urls = [requested, ...[...allowedOrigins]
    .filter((origin) => origin !== requested.origin)
    .map((origin) => new URL(origin))];
  const byHostname = new Map();
  for (const url of urls) {
    const endpoint = await resolveInspectionEndpoint(url, options);
    byHostname.set(endpoint.hostname, endpoint);
  }
  return [...byHostname.values()].sort((left, right) => left.hostname.localeCompare(right.hostname, "en"));
}

function parseArgs(argv) {
  const options = {
    allowOrigins: [],
    focusSteps: 8,
    viewport: { ...DEFAULT_VIEWPORT },
    allowLocalhost: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-localhost") {
      options.allowLocalhost = true;
      continue;
    }
    if (arg === "--allow-origin") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --allow-origin");
      options.allowOrigins.push(new URL(value).origin);
      continue;
    }
    if (["--url", "--output", "--focus-steps", "--width", "--height"].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--url") options.url = value;
      if (arg === "--output") options.output = value;
      if (arg === "--focus-steps") options.focusSteps = Number(value);
      if (arg === "--width") options.viewport.width = Number(value);
      if (arg === "--height") options.viewport.height = Number(value);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.url || !options.output) throw new Error("--url and --output are required.");
  if (!Number.isInteger(options.focusSteps) || options.focusSteps < 0 || options.focusSteps > 50) {
    throw new Error("--focus-steps must be an integer from 0 to 50.");
  }
  for (const key of ["width", "height"]) {
    if (!Number.isInteger(options.viewport[key]) || options.viewport[key] < 240 || options.viewport[key] > 7680) {
      throw new Error(`--${key} is outside the supported range.`);
    }
  }
  return options;
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (cause) {
    throw new WebInspectionError(
      "Playwright is not installed. Install it in the host environment (for example: npm install --no-save playwright && npx playwright install chromium) and retry.",
      { exitCode: 4, code: "PLAYWRIGHT_MISSING", cause }
    );
  }
}

async function focusSnapshot(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return null;
    return {
      tag: element.tagName?.toLowerCase() ?? null,
      id: element.id || null,
      role: element.getAttribute?.("role") || null,
      name: element.getAttribute?.("aria-label") || element.textContent?.trim().slice(0, 160) || null
    };
  });
}

function navigationIdentity(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}${url.search}`;
}

export async function settlePage(page) {
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

function contextOptions(options) {
  const result = { viewport: options.viewport ?? DEFAULT_VIEWPORT };
  if (options.renderingProfile) Object.assign(result, options.renderingProfile);
  if (options.blockServiceWorkers) result.serviceWorkers = "block";
  if (options.acceptDownloads === false) result.acceptDownloads = false;
  return result;
}

function recordBlockedRequest(blockedRequestState, request, reason, includeReason) {
  blockedRequestState.total += 1;
  if (blockedRequestState.entries.length >= MAX_BLOCKED_REQUEST_ENTRIES) return;
  const entry = {
    url: sanitizeNetworkUrl(request.url()),
    resource_type: request.resourceType()
  };
  if (includeReason) entry.reason = reason;
  blockedRequestState.entries.push(entry);
}

function recordBlockedChannel(blockedChannelState, entry) {
  blockedChannelState.total += 1;
  if (blockedChannelState.entries.length < MAX_BLOCKED_CHANNEL_ENTRIES) blockedChannelState.entries.push(entry);
}

async function installActiveChannelBlocks(context, blockedChannelState) {
  if (typeof context.routeWebSocket !== "function") {
    throw new WebInspectionError("The installed Playwright version cannot route WebSocket connections.", {
      exitCode: 4,
      code: "WEBSOCKET_ROUTING_UNAVAILABLE"
    });
  }
  await context.routeWebSocket(/.*/u, async (socket) => {
    recordBlockedChannel(blockedChannelState, {
      kind: "websocket",
      url: sanitizeNetworkUrl(socket.url()),
      reason: "blocked_by_scan_policy"
    });
    await socket.close({ code: 1008, reason: "Blocked by accessibility scan policy" });
  });

  await context.exposeBinding("__a11yRecordBlockedChannel", (_source, kind, value) => {
    recordBlockedChannel(blockedChannelState, {
      kind,
      url: sanitizeNetworkUrl(value),
      reason: "blocked_by_scan_policy"
    });
  });
  await context.addInitScript(() => {
    const report = (kind, value) => {
      try {
        Promise.resolve(globalThis.__a11yRecordBlockedChannel?.(kind, String(value ?? ""))).catch(() => {});
      } catch {}
    };
    const blockedConstructor = (kind) => class {
      constructor(value) {
        report(kind, value);
        throw new DOMException(`${kind} is blocked during accessibility scanning.`, "SecurityError");
      }
    };
    const replaceConstructor = (name, kind) => {
      if (!(name in globalThis)) return;
      try {
        Object.defineProperty(globalThis, name, { value: blockedConstructor(kind), configurable: false });
      } catch {}
    };
    replaceConstructor("WebTransport", "webtransport");
    replaceConstructor("RTCPeerConnection", "webrtc");
    replaceConstructor("webkitRTCPeerConnection", "webrtc");
  });
}

export async function withWebInspectionSession(options, inspect) {
  const requested = parseTargetUrl(options.url, options);
  const allowedOrigins = new Set([requested.origin, ...(options.allowOrigins ?? [])]);
  const blockedRequestState = { entries: [], total: 0 };
  const blockedChannelState = { entries: [], total: 0 };
  const endpoints = await resolveAllowedEndpoints(requested, allowedOrigins, options);
  const { chromium } = await loadPlaywright();
  const launchOptions = { headless: true };
  if (options.pinResolvedHosts) {
    launchOptions.args = [
      `--host-resolver-rules=${buildHostResolverRules(endpoints)}`,
      "--host-resolver-retry-attempts=0",
      "--no-proxy-server"
    ];
  }
  const browser = await chromium.launch(launchOptions);
  let context;
  try {
    context = await browser.newContext(contextOptions(options));
    if (options.blockActiveNetworkChannels) await installActiveChannelBlocks(context, blockedChannelState);
    await context.route("**/*", async (route) => {
      const request = route.request();
      let requestUrl;
      try {
        requestUrl = new URL(request.url());
      } catch {
        recordBlockedRequest(blockedRequestState, request, "invalid_url", options.includeBlockReasons);
        await route.abort("blockedbyclient");
        return;
      }
      if (!["http:", "https:"].includes(requestUrl.protocol)) {
        if (SAFE_LOCAL_PROTOCOLS.has(requestUrl.protocol)) await route.continue();
        else {
          recordBlockedRequest(blockedRequestState, request, "protocol_not_allowed", options.includeBlockReasons);
          await route.abort("blockedbyclient");
        }
        return;
      }
      if (!allowedOrigins.has(requestUrl.origin)) {
        recordBlockedRequest(blockedRequestState, request, "origin_not_allowed", options.includeBlockReasons);
        await route.abort("blockedbyclient");
        return;
      }
      if (options.allowedMethods && !options.allowedMethods.has(request.method().toUpperCase())) {
        recordBlockedRequest(blockedRequestState, request, "method_not_allowed", options.includeBlockReasons);
        await route.abort("blockedbyclient");
        return;
      }
      if (options.revalidateRequests) {
        try {
          await resolveInspectionEndpoint(requestUrl, options);
        } catch {
          recordBlockedRequest(blockedRequestState, request, "address_not_public", options.includeBlockReasons);
          await route.abort("blockedbyclient");
          return;
        }
      }
      await route.continue();
    });

    const page = await context.newPage();
    const response = await page.goto(requested.href, {
      waitUntil: "domcontentloaded",
      timeout: options.navigationTimeoutMs ?? 30_000
    });
    if (options.settleBeforeInspection) await settlePage(page);
    const finalUrl = new URL(page.url());
    if (!allowedOrigins.has(finalUrl.origin)) {
      throw new WebInspectionError(`Navigation escaped the allowed origins: ${finalUrl.origin}`, {
        exitCode: 3,
        code: "NAVIGATION_ORIGIN_ESCAPE"
      });
    }
    await resolveInspectionEndpoint(finalUrl, options);
    return await inspect({
      page,
      context,
      browser,
      requested,
      finalUrl,
      response,
      allowedOrigins,
      blockedRequests: blockedRequestState.entries,
      blockedRequestCount: blockedRequestState.total,
      blockedChannels: blockedChannelState.entries,
      blockedChannelCount: blockedChannelState.total,
      pinnedEndpoints: options.pinResolvedHosts ? endpoints : []
    });
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close();
  }
}

export async function collectWebEvidence(session, options = {}) {
  const {
    page,
    context,
    browser,
    requested,
    finalUrl,
    response,
    allowedOrigins,
    blockedRequests,
    blockedRequestCount = blockedRequests.length,
    blockedChannels = [],
    blockedChannelCount = blockedChannels.length,
    pinnedEndpoints = []
  } = session;
  const dom = await page.content();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Accessibility.enable");
  const accessibility = await cdp.send("Accessibility.getFullAXTree");
  const focusPath = [];
  const baselineNavigation = navigationIdentity(finalUrl.href);
  for (let step = 0; step < (options.focusSteps ?? 0); step += 1) {
    await page.keyboard.press("Tab");
    focusPath.push(await focusSnapshot(page));
    if (options.guardFocusNavigation && navigationIdentity(page.url()) !== baselineNavigation) {
      throw new WebInspectionError("Focus sampling navigated away from the inspected document; scan aborted.", {
        exitCode: 3,
        code: "FOCUS_NAVIGATION"
      });
    }
  }
  const activeElement = await focusSnapshot(page);
  const environment = {
    adapter: "playwright-chromium",
    browser_version: browser.version(),
    viewport: options.viewport ?? DEFAULT_VIEWPORT
  };
  if (options.renderingProfile) environment.rendering = { ...options.renderingProfile };
  const network = {
    allowed_origins: [...allowedOrigins].sort(),
    blocked_requests: blockedRequests
  };
  if (options.includeNetworkPolicyDetails) {
    network.blocked_request_count = blockedRequestCount;
    network.blocked_requests_truncated = blockedRequestCount > blockedRequests.length;
    network.blocked_channels = blockedChannels;
    network.blocked_channel_count = blockedChannelCount;
    network.blocked_channels_truncated = blockedChannelCount > blockedChannels.length;
    network.dns_binding = options.pinResolvedHosts ? "pinned_host_resolver" : "preflight_only";
    network.pinned_endpoints = pinnedEndpoints.map((endpoint) => ({
      hostname: endpoint.hostname,
      address: endpoint.address
    }));
  }
  return {
    schema_version: "1.0.0",
    kind: "web-evidence-bundle",
    captured_at: new Date().toISOString(),
    target: {
      requested_url: requested.href,
      final_url: finalUrl.href,
      http_status: response?.status() ?? null,
      dom_sha256: sha256(dom),
      ax_tree_sha256: sha256(JSON.stringify(accessibility.nodes))
    },
    environment,
    capabilities: ["rendered_dom", "accessibility_tree", "keyboard_focus_path", "request_policy_log"],
    evidence: {
      dom,
      accessibility_tree: accessibility.nodes,
      active_element: activeElement,
      focus_path: focusPath
    },
    network
  };
}

export async function captureWebEvidence(options) {
  return withWebInspectionSession(options, (session) => collectWebEvidence(session, options));
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const output = path.resolve(options.output);
  assertNewOutputPath(output);
  const evidence = await captureWebEvidence(options);
  writeNewJson(output, evidence);
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    output,
    kind: evidence.kind,
    final_url: evidence.target.final_url
  })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
