import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { cliFile, cli, pass, read, measuredScannerRun, importedReport } from "./helpers/scanner-import.mjs";

const enabled = process.env.RUN_SCANNER_IMPORT_E2E === "1";
function asyncCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliFile, ...args], { shell: false, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("real axe scan exports capture-linked evidence through import, registration and public report", { skip: !enabled, timeout: 120000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-import-browser-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifacts = path.join(root, "artifacts");
  fs.mkdirSync(artifacts);
  const secret = "BROWSER-IMPORT-PRIVATE-SECRET";
  const html = `<!doctype html><html lang="en"><head><title>Scanner import fixture</title></head><body><main><h1>Fixture</h1><img src="/pixel.svg"><input id="${secret}"><button>Submit</button></main></body></html>`;
  let writes = 0;
  const server = http.createServer((request, response) => {
    if (!["GET", "HEAD"].includes(request.method)) writes += 1;
    response.writeHead(200, { "content-type": request.url === "/pixel.svg" ? "image/svg+xml" : "text/html; charset=utf-8" });
    response.end(request.url === "/pixel.svg" ? '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>' : html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const capture = path.join(artifacts, "capture.json");
  const input = path.join(artifacts, "axe-export.json");
  const args = ["scan-web", "--url", url, "--profile", "web-modern", "--allow-localhost", "--focus-steps", "0",
    "--output", path.join(artifacts, "scan.json"), "--axe-output", input, "--evidence-output", capture];
  if (process.env.A11Y_BROWSER_CHANNEL) args.push("--browser-channel", process.env.A11Y_BROWSER_CHANNEL);
  pass(await asyncCli(args));
  const exported = read(input);
  assert.ok(exported.frames[0].result.violations.some((rule) => rule.id === "image-alt"));
  assert.ok(exported.frames[0].result.violations.some((rule) => rule.id === "label"));
  const f = await measuredScannerRun(root, capture, url);
  const artifactFile = path.join(artifacts, "screening.json");
  pass(cli(["import", "axe", "--run", f.runFile, "--input", input, "--output", artifactFile]));
  const record = read(`${artifactFile}.import.json`);
  assert.equal(record.binding_assurance, "hash_linked_saved_capture");
  assert.equal(record.configuration_assurance, "package_recorded");
  assert.ok(record.rows.some((row) => row.source_outcome === "passes"));
  assert.ok(record.rows.some((row) => row.source_outcome === "inapplicable"));
  const pipeline = importedReport(f, artifactFile);
  assert.doesNotMatch(pipeline.report, new RegExp(secret));
  assert.doesNotMatch(pipeline.report, /TARGET-[a-f0-9]|ENV-[a-f0-9]/);
  assert.ok(pipeline.assessment.assessment.results.filter((row) => row.requirement_kind === "profile_requirement").every((row) => !["pass", "fail"].includes(row.outcome)));
  assert.equal(writes, 0);
});
