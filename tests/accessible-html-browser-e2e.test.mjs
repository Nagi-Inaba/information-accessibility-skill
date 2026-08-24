import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateAssessment } from "../codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs");
const enabled = process.env.RUN_ACCESSIBLE_HTML_BROWSER_E2E === "1";

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeAssessment(directory, locale) {
  const record = generateAssessment("web-modern", {
    targetName: locale === "ja" ? "ブラウザー検証用レポート" : "Browser verification report",
    targetVersion: "2026-08-24",
    targetRefs: ["https://example.com/"],
    evaluator: "Report browser E2E",
    evaluatedAt: "2026-08-24"
  });
  const assessment = path.join(directory, `${locale}.assessment.json`);
  writeJson(assessment, record);
  const report = path.join(directory, `${locale}.report.html`);
  const result = runCli([
    "report", "--input", assessment,
    "--format", "html",
    "--locale", locale,
    "--detail", "full",
    "--visibility", "internal",
    "--output", report
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return report;
}

async function auditPage(browser, report, axeSource) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(pathToFileURL(report).href, { waitUntil: "load" });
  await page.addScriptTag({ content: axeSource });
  const axe = await page.evaluate(async () => globalThis.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
    resultTypes: ["violations"]
  }));

  const links = await page.locator('nav a[href^="#"]').evaluateAll((items) => items.map((item) => item.getAttribute("href")));
  assert.ok(links.length >= 7, "the report must expose a useful table of contents");
  for (const href of links) {
    assert.equal(await page.locator(href).count(), 1, `missing TOC target ${href}`);
  }

  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    className: document.activeElement?.className,
    href: document.activeElement?.getAttribute?.("href")
  }));
  assert.equal(first.tag, "A");
  assert.match(String(first.className), /skip-link/u);
  assert.equal(first.href, "#main-content");
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.notEqual(outline, "none", "keyboard focus must remain visibly indicated");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "main-content");

  await page.goto(pathToFileURL(report).href, { waitUntil: "load" });
  const encountered = new Set();
  for (let index = 0; index < 140; index += 1) {
    await page.keyboard.press("Tab");
    const current = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? "",
      className: String(document.activeElement?.className ?? ""),
      href: document.activeElement?.getAttribute?.("href") ?? ""
    }));
    if (current.tag === "A" && current.href.startsWith("#")) encountered.add("toc-link");
    if (current.className.split(/\s+/u).includes("table-region")) encountered.add("table-region");
    if (encountered.size === 2) break;
  }
  assert.deepEqual([...encountered].sort(), ["table-region", "toc-link"]);

  await page.setViewportSize({ width: 320, height: 800 });
  const reflow = await page.evaluate(() => {
    const region = document.querySelector(".table-region");
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      tableScrollWidth: region?.scrollWidth ?? 0,
      tableClientWidth: region?.clientWidth ?? 0
    };
  });
  assert.ok(reflow.documentWidth <= reflow.viewportWidth + 1, JSON.stringify(reflow));
  assert.ok(reflow.tableScrollWidth > reflow.tableClientWidth, JSON.stringify(reflow));

  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator("main").isVisible(), true);
  assert.equal(await page.locator("h1").isVisible(), true);
  await page.close();

  return {
    report: path.basename(report),
    axe_violation_count: axe.violations.length,
    axe_violations: axe.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length
    })),
    toc_target_count: links.length,
    keyboard_targets: [...encountered].sort(),
    reflow
  };
}

test("generated Japanese and English HTML reports pass Chromium, axe, keyboard, and 320px checks", { skip: !enabled }, async (t) => {
  const playwright = await import("playwright");
  const axeModule = await import("axe-core");
  const axe = axeModule.default ?? axeModule;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-report-browser-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const reports = [makeAssessment(directory, "ja"), makeAssessment(directory, "en")];
  const browser = await playwright.chromium.launch({ headless: true });
  t.after(() => browser.close());
  const records = [];
  for (const report of reports) records.push(await auditPage(browser, report, axe.source));
  const failures = records.flatMap((record) => record.axe_violations.map((violation) => ({ report: record.report, ...violation })));
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));

  const output = process.env.REPORT_BROWSER_E2E_OUTPUT;
  if (output) writeJson(path.resolve(output), {
    schema_version: "1.0.0",
    browser: "chromium",
    viewport_width: 320,
    locales: ["ja", "en"],
    records
  });
});
