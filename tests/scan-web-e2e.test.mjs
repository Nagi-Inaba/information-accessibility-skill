import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runAutomatedWebScan } from "../codex/skills/information-accessibility-practice/scripts/lib/automated-web-scan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = fs.readFileSync(path.join(root, "examples/web-e2e/target/index.html"));

test("scan-web finds machine violations and produces bounded AI context", async () => {
  const server = http.createServer((req,res) => { if (req.url === "/" || req.url === "/index.html") { res.writeHead(200,{"content-type":"text/html; charset=utf-8"}); res.end(fixture); } else { res.writeHead(404); res.end("not found"); } });
  await new Promise((resolve) => server.listen(0,"127.0.0.1",resolve));
  try {
    const { port } = server.address();
    const { scan, context } = await runAutomatedWebScan({ url:`http://127.0.0.1:${port}/`, profile:"web-modern", allowLocalhost:true, allowOrigins:[], focusSteps:4, viewport:{width:1280,height:800}, reflowWidth:320 });
    assert.equal(scan.kind,"automated-web-scan");
    assert.equal(scan.scan_status,"complete");
    assert.equal(scan.frame_coverage.succeeded,1);
    assert.ok(scan.machine_violations.some((x)=>x.rule_id==="image-alt"));
    assert.ok(scan.machine_violations.some((x)=>x.rule_id==="label"));
    assert.ok(scan.machine_violations.some((x)=>x.profile_requirement_ids.includes("WCAG-2.2-SC-1.1.1")));
    assert.ok(scan.review_candidates.some((x)=>x.rule_id==="reflow-overflow"));
    assert.ok(scan.evidence.focus_path.some((x)=>x?.id==="first"));
    assert.match(scan.target.dom_sha256,/^[a-f0-9]{64}$/u);
    assert.match(scan.raw_result_sha256,/^[a-f0-9]{64}$/u);
    assert.equal(context.kind,"automated-web-scan-context");
    assert.equal(context.stability,"experimental");
    assert.equal(JSON.stringify(context).includes("accessibility_tree"),false);
    assert.equal(JSON.stringify(context).includes("<main>"),false);
    assert.ok(Buffer.byteLength(JSON.stringify(context),"utf8") < Buffer.byteLength(JSON.stringify(scan),"utf8"));
  } finally { await new Promise((resolve,reject)=>server.close((e)=>e?reject(e):resolve())); }
});
