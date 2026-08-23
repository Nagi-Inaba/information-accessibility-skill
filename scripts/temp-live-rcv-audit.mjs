import fs from "node:fs";
import { chromium } from "playwright";
import axe from "axe-core";

const out = "live-audit";
const url = "https://rcv.team-mir.ai/";
fs.mkdirSync(`${out}/screenshots`, { recursive: true });

const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];
const responses = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  colorScheme: "light",
  reducedMotion: "reduce"
});
const page = await context.newPage();
page.on("console", (msg) => consoleMessages.push({ type: msg.type(), text: msg.text() }));
page.on("pageerror", (error) => pageErrors.push({ name: error.name, message: error.message }));
page.on("requestfailed", (request) => failedRequests.push({
  url: request.url().replace(/[?#].*$/u, ""),
  method: request.method(),
  resourceType: request.resourceType(),
  failure: request.failure()?.errorText ?? null
}));
page.on("response", (response) => {
  if (responses.length >= 500) return;
  responses.push({
    url: response.url().replace(/[?#].*$/u, ""),
    status: response.status(),
    resourceType: response.request().resourceType()
  });
});

const startedAt = new Date().toISOString();
let mainResponse = null;
let navigationError = null;
try {
  mainResponse = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
} catch (error) {
  navigationError = { name: error.name, message: error.message };
}

const basic = await page.evaluate(() => {
  const clean = (value, max = 500) => String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);
  const safeUrl = (value) => {
    try {
      const parsed = new URL(value, location.href);
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      parsed.hash = "";
      return parsed.href;
    } catch {
      return clean(value, 1000);
    }
  };
  const controls = Array.from(document.querySelectorAll("a[href],button,input,select,textarea,[role],[tabindex]")).slice(0, 800).map((el, index) => ({
    index,
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute("type"),
    role: el.getAttribute("role"),
    id: el.id || null,
    name: el.getAttribute("name"),
    ariaLabel: el.getAttribute("aria-label"),
    ariaLabelledby: el.getAttribute("aria-labelledby"),
    ariaDescribedby: el.getAttribute("aria-describedby"),
    ariaChecked: el.getAttribute("aria-checked"),
    ariaPressed: el.getAttribute("aria-pressed"),
    ariaExpanded: el.getAttribute("aria-expanded"),
    checked: "checked" in el ? Boolean(el.checked) : null,
    disabled: "disabled" in el ? Boolean(el.disabled) : null,
    tabIndex: el.tabIndex,
    href: el instanceof HTMLAnchorElement ? safeUrl(el.href) : null,
    text: clean(el.innerText || el.textContent, 500),
    outerHTML: el.outerHTML.slice(0, 2500)
  }));
  return {
    finalUrl: safeUrl(location.href),
    title: document.title,
    lang: document.documentElement.lang || null,
    bodyText: clean(document.body?.innerText || document.body?.textContent, 20000),
    headings: Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((el) => ({
      level: Number(el.tagName.slice(1)),
      text: clean(el.innerText || el.textContent, 1000),
      id: el.id || null
    })),
    landmarks: Array.from(document.querySelectorAll("main,nav,header,footer,aside,form,[role=main],[role=navigation],[role=banner],[role=contentinfo],[role=form]")).map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      label: el.getAttribute("aria-label"),
      labelledby: el.getAttribute("aria-labelledby"),
      text: clean(el.innerText || el.textContent, 1000)
    })),
    liveRegions: Array.from(document.querySelectorAll("[aria-live],[role=alert],[role=status],[role=log]")).map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      ariaLive: el.getAttribute("aria-live"),
      ariaAtomic: el.getAttribute("aria-atomic"),
      text: clean(el.innerText || el.textContent, 1000),
      outerHTML: el.outerHTML.slice(0, 2500)
    })),
    controls,
    links: Array.from(document.querySelectorAll("a[href]")).map((el) => ({
      text: clean(el.innerText || el.textContent, 500),
      href: safeUrl(el.href),
      ariaLabel: el.getAttribute("aria-label")
    })).slice(0, 800),
    forms: Array.from(document.forms).map((form) => ({
      action: safeUrl(form.action),
      method: form.method,
      text: clean(form.innerText || form.textContent, 2000),
      outerHTML: form.outerHTML.slice(0, 10000)
    })),
    images: Array.from(document.images).map((img) => ({
      src: safeUrl(img.src),
      alt: img.getAttribute("alt"),
      role: img.getAttribute("role"),
      width: img.width,
      height: img.height
    })).slice(0, 500),
    scripts: Array.from(document.scripts).map((script) => ({ src: script.src ? safeUrl(script.src) : null, type: script.type || null, inlineLength: script.src ? 0 : script.textContent?.length ?? 0 })).slice(0, 500)
  };
}).catch((error) => ({ evaluationError: error.message }));

const tabOrder = [];
for (let index = 0; index < 30; index += 1) {
  await page.keyboard.press("Tab");
  await page.waitForTimeout(100);
  tabOrder.push(await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type"),
      id: el.id || null,
      role: el.getAttribute("role"),
      ariaLabel: el.getAttribute("aria-label"),
      ariaLabelledby: el.getAttribute("aria-labelledby"),
      text: String(el.innerText || el.textContent || "").replace(/\s+/gu, " ").trim().slice(0, 500),
      tabIndex: el.tabIndex,
      href: el instanceof HTMLAnchorElement ? el.href.replace(/[?#].*$/u, "") : null,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      focusStyle: { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor, boxShadow: style.boxShadow }
    };
  }));
}

await page.screenshot({ path: `${out}/screenshots/root-full.png`, fullPage: true });
await page.screenshot({ path: `${out}/screenshots/root-after-tabs.png`, fullPage: false });

const originalViewport = page.viewportSize();
await page.setViewportSize({ width: 320, height: 800 });
await page.waitForTimeout(600);
const reflow = await page.evaluate(() => {
  const viewportWidth = document.documentElement.clientWidth;
  const candidates = Array.from(document.querySelectorAll("body *")).map((el) => ({ el, rect: el.getBoundingClientRect() })).filter(({ rect }) => rect.width > 0 && (rect.right > viewportWidth + 1 || rect.left < -1 || rect.width > viewportWidth + 1)).slice(0, 150).map(({ el, rect }) => ({
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    className: typeof el.className === "string" ? el.className.slice(0, 500) : null,
    text: String(el.innerText || el.textContent || "").replace(/\s+/gu, " ").trim().slice(0, 500),
    rect: { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) },
    outerHTML: el.outerHTML.slice(0, 2500)
  }));
  return {
    viewportWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body?.scrollWidth ?? null,
    candidates
  };
});
await page.screenshot({ path: `${out}/screenshots/root-320px.png`, fullPage: true });
if (originalViewport) await page.setViewportSize(originalViewport);

let axeResults = null;
let axeError = null;
try {
  await page.evaluate((source) => { (0, eval)(source); }, axe.source);
  axeResults = await page.evaluate(async () => globalThis.axe.run(document, { resultTypes: ["violations", "incomplete", "passes", "inapplicable"] }));
} catch (error) {
  axeError = { name: error.name, message: error.message };
}

let axTree = null;
let axError = null;
try {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Accessibility.enable");
  axTree = await cdp.send("Accessibility.getFullAXTree");
} catch (error) {
  axError = { name: error.name, message: error.message };
}

fs.writeFileSync(`${out}/root.html`, await page.content().catch(() => ""));
fs.writeFileSync(`${out}/browser-evidence.json`, JSON.stringify({
  startedAt,
  finishedAt: new Date().toISOString(),
  requestedUrl: url,
  mainResponse: mainResponse ? { url: mainResponse.url().replace(/[?#].*$/u, ""), status: mainResponse.status(), headers: mainResponse.headers() } : null,
  navigationError,
  basic,
  tabOrder,
  reflow,
  axeError,
  axeResults,
  axError,
  axTree,
  consoleMessages,
  pageErrors,
  failedRequests,
  responses
}, null, 2));

await browser.close();
