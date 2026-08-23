import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runAutomatedWebScan } from "../codex/skills/information-accessibility-practice/scripts/lib/automated-web-scan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = fs.readFileSync(path.join(root, "examples/web-e2e/target/index.html"));
const runBrowserE2E = process.env.RUN_SCAN_WEB_E2E === "1";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("scan-web finds machine violations and enforces the bounded network policy", {
  skip: !runBrowserE2E
}, async () => {
  let postRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.method === "POST") postRequests += 1;
    if (request.url === "/" || request.url === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(fixture);
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await listen(server);
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
    assert.equal(scan.frame_coverage.coverage_status, "complete");
    assert.equal(scan.frame_coverage.succeeded, 1);
    assert.ok(scan.machine_violations.some((item) => item.rule_id === "image-alt"));
    assert.ok(scan.machine_violations.some((item) => item.rule_id === "label"));
    assert.ok(scan.machine_violations.some((item) => item.profile_requirement_ids.includes("WCAG-2.2-SC-1.1.1")));
    assert.ok(scan.review_candidates.some((item) => item.rule_id === "reflow-overflow"));
    assert.ok(scan.evidence.focus_path.some((item) => item?.id === "first"));
    assert.equal(postRequests, 0);
    assert.ok(scan.evidence.blocked_requests.some((entry) => entry.reason === "method_not_allowed"));
    assert.ok(scan.policy.blocked_channels.some((entry) => entry.kind === "websocket"));
    assert.ok(scan.policy.blocked_channels.every((entry) => !entry.url.includes("fixture-secret")));
    assert.equal(scan.policy.dns_binding, "pinned_host_resolver");
    assert.match(scan.target.dom_sha256, /^[a-f0-9]{64}$/u);
    assert.match(scan.raw_result_sha256, /^[a-f0-9]{64}$/u);

    assert.equal(context.kind, "automated-web-scan-context");
    assert.equal(context.stability, "experimental");
    assert.equal(context.policy_summary.dns_binding, "pinned_host_resolver");
    assert.equal(JSON.stringify(context).includes("accessibility_tree"), false);
    assert.equal(JSON.stringify(context).includes("<main>"), false);
    assert.ok(Buffer.byteLength(JSON.stringify(context), "utf8") < Buffer.byteLength(JSON.stringify(scan), "utf8"));
  } finally {
    await close(server);
  }
});

test("scan-web rejects a redirect to an origin that was not allowed", {
  skip: !runBrowserE2E
}, async () => {
  const destination = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<title>denied destination</title>");
  });
  await listen(destination);
  const source = http.createServer((_request, response) => {
    const { port } = destination.address();
    response.writeHead(302, { location: `http://127.0.0.1:${port}/` });
    response.end();
  });
  await listen(source);
  try {
    const { port } = source.address();
    await assert.rejects(
      runAutomatedWebScan({
        url: `http://127.0.0.1:${port}/`,
        profile: "web-modern",
        allowLocalhost: true,
        allowOrigins: [],
        focusSteps: 0,
        viewport: { width: 1280, height: 800 },
        reflowWidth: 320
      }),
      (error) => error?.exitCode === 3
    );
  } finally {
    await Promise.all([close(source), close(destination)]);
  }
});
