import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runAutomatedWebScan } from "../codex/skills/information-accessibility-practice/scripts/lib/automated-web-scan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = fs.readFileSync(path.join(root, "examples/web-e2e/target/index.html"));
const require = createRequire(import.meta.url);

function hasExactBrowserDependencies() {
  try {
    const playwright = JSON.parse(fs.readFileSync(require.resolve("playwright/package.json"), "utf8"));
    const axe = JSON.parse(fs.readFileSync(require.resolve("axe-core/package.json"), "utf8"));
    return playwright.version === "1.62.1" && axe.version === "4.13.0";
  } catch {
    return false;
  }
}

const browserDependenciesAvailable = hasExactBrowserDependencies();

test("scan-web finds machine violations and produces bounded AI context", {
  skip: !browserDependenciesAvailable
}, async () => {
  const server = http.createServer((request, response) => {
    if (request.url === "/" || request.url === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(fixture);
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const { scan, context } = await runAutomatedWebScan({
      url: `http://127.0.0.1:${port}/`,
      profile: "web-modern",
      allowLocalhost: true,
      allowOrigins: [],
      focusSteps: 4,
      viewport: { width: 1280, height: 800 },
      reflowWidth: 320
    });

    assert.equal(scan.kind, "automated-web-scan");
    assert.equal(scan.scan_status, "complete");
    assert.equal(scan.frame_coverage.succeeded, 1);
    assert.ok(scan.machine_violations.some((item) => item.rule_id === "image-alt"));
    assert.ok(scan.machine_violations.some((item) => item.rule_id === "label"));
    assert.ok(scan.machine_violations.some((item) => item.profile_requirement_ids.includes("WCAG-2.2-SC-1.1.1")));
    assert.ok(scan.review_candidates.some((item) => item.rule_id === "reflow-overflow"));
    assert.ok(scan.evidence.focus_path.some((item) => item?.id === "first"));
    assert.match(scan.target.dom_sha256, /^[a-f0-9]{64}$/u);
    assert.match(scan.raw_result_sha256, /^[a-f0-9]{64}$/u);

    assert.equal(context.kind, "automated-web-scan-context");
    assert.equal(context.stability, "experimental");
    assert.equal(JSON.stringify(context).includes("accessibility_tree"), false);
    assert.equal(JSON.stringify(context).includes("<main>"), false);
    assert.ok(Buffer.byteLength(JSON.stringify(context), "utf8") < Buffer.byteLength(JSON.stringify(scan), "utf8"));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
