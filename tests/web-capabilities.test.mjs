import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { assertWebCapabilities, DEFAULT_WEB_CAPABILITIES, preflightWeb, probeBrowserCapabilities, unavailableWebCapabilities, validateRequiredCapabilities, WEB_CAPABILITY_IDS } from "../codex/skills/information-accessibility-practice/scripts/lib/web-capabilities.mjs";
import { parsePreflightArgs, renderPreflightText } from "../codex/skills/information-accessibility-practice/scripts/preflight-web.mjs";

const cli = path.resolve("codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs");

test("capability contract covers six runtime features and every supported host without claiming native integration", () => {
  const contract = JSON.parse(fs.readFileSync("codex/skills/information-accessibility-practice/references/web-capabilities.json", "utf8"));
  assert.deepEqual(WEB_CAPABILITY_IDS, ["browser_dom", "accessibility_tree", "keyboard_input", "responsive_viewport", "screen_reader_runtime", "network_fetch"]);
  assert.deepEqual(contract.hosts.map((host) => host.id), ["codex", "claude", "other_node_host"]);
  assert.ok(contract.hosts.every((host) => host.native_browser_tools === "not_auto_detected"));
  const manifest = JSON.parse(fs.readFileSync("shared/agents/agent-manifest.json", "utf8"));
  assert.equal(manifest.web_capability_contract, "references/web-capabilities.json");
});

test("missing package, browser and unsupported version remain blocked with explicit next tests", async () => {
  const missing = await preflightWeb({}, async () => { throw new Error("secret-local-path"); });
  assert.equal(missing.status, "blocked");
  assert.deepEqual(missing.missing_required, DEFAULT_WEB_CAPABILITIES);
  assert.ok(missing.unconfirmed_checks.every((item) => item.next_test.length > 20 && item.status === "unconfirmed"));
  assert.equal(missing.target_inspected, false);
  assert.equal(missing.inspection_complete, false);
  assert.equal(missing.profile_outcomes_written, false);
  assert.doesNotMatch(JSON.stringify(missing), /secret-local-path/);
  assert.throws(() => assertWebCapabilities(missing), (error) => error.exitCode === 4 && /Next:/.test(error.message));
  const browser = await preflightWeb({}, async () => ({ version: "1.62.1", chromium: { launchServer: async () => { throw new Error("private-executable"); } } }));
  assert.ok(browser.capabilities.some((item) => item.reason === "browser_launch_unavailable"));
  assert.doesNotMatch(JSON.stringify(browser), /private-executable/);
  const unsupported = await preflightWeb({}, async () => ({ version: "1.1.0", chromium: {} }));
  assert.ok(unsupported.capabilities.some((item) => item.reason === "unsupported_playwright_version"));
});

test("context failure cannot claim capabilities and screen reader is never inferred from AX availability", async () => {
  const report = await probeBrowserCapabilities({ version: () => "fixture", newContext: async () => { throw new Error("no context"); } });
  assert.equal(report.status, "blocked");
  assert.ok(report.capabilities.filter((item) => item.id !== "screen_reader_runtime").every((item) => item.status === "unavailable"));
  assert.equal(report.capabilities.find((item) => item.id === "screen_reader_runtime").status, "not_verified");
  const explicit = unavailableWebCapabilities("missing", { required: ["screen_reader_runtime"] });
  assert.deepEqual(explicit.missing_required, ["screen_reader_runtime"]);
});

test("a failed browser connection cleans up only its owned server and returns blocked", async () => {
  let closed = 0;
  const report = await preflightWeb({}, async () => ({ version: "1.62.1", chromium: {
    launchServer: async (options) => {
      assert.equal(options.host, "127.0.0.1");
      assert.ok(options.args.includes("--host-resolver-rules=MAP * ~NOTFOUND"));
      return { wsEndpoint: () => "fixture", close: async () => { closed += 1; } };
    }, connect: async () => { throw new Error("connection failed"); }
  } }));
  assert.equal(closed, 1);
  assert.equal(report.status, "blocked");
});

test("unresponsive teardown has a deadline and forces termination of its owned browser", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let killed = 0;
  const pending = preflightWeb({}, async () => ({ version: "1.62.1", chromium: {
    launchServer: async () => ({ wsEndpoint: () => "fixture", close: () => new Promise(() => {}), kill: async () => { killed += 1; } }),
    connect: async () => { throw new Error("connection failed"); }
  } }));
  await new Promise(setImmediate);
  t.mock.timers.tick(10_000);
  const report = await pending;
  assert.equal(killed, 1);
  assert.equal(report.status, "blocked");
  assert.ok(report.capabilities.some((item) => item.reason === "fixture_runtime_cleanup_failed"));
});

test("preflight arguments reject unknown requirements and unsafe browser choices before launch", async () => {
  for (const required of [[], ["unknown"], ["browser_dom", "browser_dom"]]) assert.throws(() => validateRequiredCapabilities(required));
  for (const args of [["--require", "unknown"], ["--browser-channel", "path/to/browser"], ["--format", "yaml"], ["--url", "https://example.com"], ["--format", "json", "--format", "text"]]) assert.throws(() => parsePreflightArgs(args));
  let loaded = false;
  await assert.rejects(() => preflightWeb({ browserChannel: "unknown" }, async () => { loaded = true; }), /only chrome/);
  assert.equal(loaded, false);
  assert.deepEqual(parsePreflightArgs(["--require", "browser_dom,keyboard_input"]).required, ["browser_dom", "keyboard_input"]);
});

test("CLI exposes preflight and distinguishes unconfirmed target checks from fixture success", () => {
  const help = spawnSync(process.execPath, [cli, "preflight-web", "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--require/);
  const invalid = spawnSync(process.execPath, [cli, "preflight-web", "--require", "invalid"], { encoding: "utf8" });
  assert.equal(invalid.status, 2);
  const text = renderPreflightText(unavailableWebCapabilities("fixture_unavailable"), "ja");
  assert.match(text, /未確認・次のテスト/);
  assert.match(text, /検査完了や規格適合を示しません/);
});
