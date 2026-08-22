import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { captureWebEvidence } from "../codex/skills/information-accessibility-practice/scripts/capture-web-evidence.mjs";

let playwrightAvailable = true;
try { await import("playwright"); } catch { playwrightAvailable = false; }

const fixture = fs.readFileSync(path.resolve("examples/web-e2e/target/index.html"));

test("browser adapter captures rendered DOM, AX tree, focus path, and hashes", { skip: !playwrightAvailable }, async () => {
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
    const result = await captureWebEvidence({
      url: `http://127.0.0.1:${port}/`,
      allowLocalhost: true,
      allowOrigins: [],
      focusSteps: 3,
      viewport: { width: 800, height: 600 }
    });
    assert.equal(result.kind, "web-evidence-bundle");
    assert.equal(result.target.http_status, 200);
    assert.equal(result.target.final_url, `http://127.0.0.1:${port}/`);
    assert.match(result.target.dom_sha256, /^[a-f0-9]{64}$/u);
    assert.match(result.target.ax_tree_sha256, /^[a-f0-9]{64}$/u);
    assert.match(result.evidence.dom, /注文確認/u);
    assert.ok(result.evidence.accessibility_tree.length > 0);
    assert.ok(result.evidence.focus_path.some((item) => item?.id === "first"));
    assert.ok(result.capabilities.includes("accessibility_tree"));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
