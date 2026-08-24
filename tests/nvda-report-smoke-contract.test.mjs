import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(root, ".github/workflows/report-nvda-smoke.yml");
const scriptPath = path.join(root, "scripts/run-nvda-report-smoke.ps1");

function read(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/gu, "\n");
}

test("NVDA smoke workflow pins the official stable build and uploads bounded evidence", () => {
  assert.equal(fs.existsSync(workflowPath), true, "missing NVDA smoke workflow");
  const workflow = read(workflowPath);
  assert.match(workflow, /windows-latest/u);
  assert.match(workflow, /NVDA_VERSION:\s*"2026\.1\.1"/u);
  assert.match(workflow, /NVDA_SHA256:\s*"6e0289eb5a3aa076eb97ea99c5d5465cb48b5ecc6a3257dc3d811f881a1747c9"/u);
  assert.match(workflow, /download\.nvaccess\.org\/releases\/2026\.1\.1\/nvda_2026\.1\.1\.exe/u);
  assert.match(workflow, /run-nvda-report-smoke\.ps1/u);
  assert.match(workflow, /upload-artifact@[0-9a-f]{40}/u);
  assert.match(workflow, /nvda-smoke-record\.json/u);
  assert.match(workflow, /nvda\.log/u);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true|if-no-files-found:\s*ignore/iu);
});

test("NVDA smoke script requires real speech output from multiple report regions", () => {
  assert.equal(fs.existsSync(scriptPath), true, "missing NVDA smoke script");
  const script = read(scriptPath);
  for (const token of [
    "--create-portable-silent",
    "--portable-path",
    "--minimal",
    "--disable-addons",
    "--debug-logging",
    "--log-file",
    "--check-running",
    "Speaking [",
    "title",
    "heading",
    "table",
    "speech_entry_count",
    "matched_regions",
    "limitations"
  ]) assert.ok(script.includes(token), `missing ${token}`);
  assert.match(script, /Get-FileHash[^\n]*SHA256/iu);
  assert.match(script, /throw[^\n]*(?:speech|Speaking|region)/iu);
  assert.match(script, /AppActivate|SendKeys/u);
  assert.match(script, /nvda\.exe[^\n]*--quit|--quit[^\n]*nvda\.exe/iu);
  assert.doesNotMatch(script, /accessibility tree|fixture text.*speech/iu);
});
