import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "codex/skills/information-accessibility-practice");
const cli = path.join(skillRoot, "scripts/accessibility-audit.mjs");

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
}

function parseJson(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("root help, version, and command help expose discoverable installed capabilities", () => {
  const rootHelp = runCli(["--help"]);
  assert.equal(rootHelp.status, 0, rootHelp.stderr || rootHelp.stdout);
  for (const value of ["profiles", "requirements", "doctor", "--version"]) {
    assert.match(rootHelp.stdout, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }

  const version = runCli(["--version"]);
  assert.equal(version.status, 0, version.stderr || version.stdout);
  assert.match(version.stdout, /information-accessibility-practice-cli 0\.1\.0/u);
  assert.match(version.stdout, /standards registry 1\.0\.0/u);
  assert.match(version.stdout, /audit-run schema 6\.0\.0/u);

  const initHelp = runCli(["init", "--help"]);
  assert.equal(initHelp.status, 0, initHelp.stderr || initHelp.stdout);
  for (const value of [
    "--run-id", "--profile", "--target-name", "--target-version", "--target-ref",
    "--artifact-root", "--network", "none", "local_read_only",
    "--interaction", "safe_read_only", "human_supervised",
    "--source-write", "authorized_only", "--config", "--output"
  ]) assert.match(initHelp.stdout, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));

  const reportHelp = runCli(["report", "--help"]);
  assert.equal(reportHelp.status, 0, reportHelp.stderr || reportHelp.stdout);
  assert.match(reportHelp.stdout, /--input <assessment\.json>/u);
  assert.match(reportHelp.stdout, /--run <audit-run\.json>/u);
  assert.match(reportHelp.stdout, /--assessment <assessment\.json>/u);
});

test("profiles list reports active profiles, counts, versions, and claim ceilings", () => {
  const output = parseJson(runCli(["profiles", "list", "--format", "json"]));
  assert.equal(output.schema_version, "1.0.0");
  assert.equal(output.registry_version, "1.0.0");
  assert.deepEqual(output.profiles.map((profile) => profile.id), ["jp-public-web", "web-modern"]);
  assert.equal(output.profiles.find((profile) => profile.id === "web-modern").requirement_count, 55);
  assert.equal(output.profiles.find((profile) => profile.id === "jp-public-web").requirement_count, 56);
  assert.ok(output.profiles.every((profile) => profile.active === true));
  assert.ok(output.profiles.every((profile) => typeof profile.claim_ceiling === "string"));
});

test("doctor reports runtime, installation, registry, and optional browser capability without mutating", () => {
  const output = parseJson(runCli(["doctor", "--format", "json"]));
  assert.match(output.status, /^(?:PASS|WARN)$/u);
  assert.equal(output.node.supported, true);
  assert.equal(output.package.name, "information-accessibility-practice-cli");
  assert.equal(output.registry.valid, true);
  assert.deepEqual(output.registry.active_profiles, ["jp-public-web", "web-modern"]);
  assert.equal(typeof output.capabilities.browser.playwright.available, "boolean");
  assert.equal(typeof output.capabilities.browser.axe_core.available, "boolean");
  assert.equal(output.mutation_available, false);
});

test("requirements list and show work without requiring internal IDs", () => {
  const list = parseJson(runCli([
    "requirements", "list",
    "--profile", "web-modern",
    "--format", "json"
  ]));
  assert.equal(list.count, 55);
  assert.ok(list.requirements.every((item) => item.profile_ids.includes("web-modern")));

  const shown = parseJson(runCli([
    "requirements", "show", "1.1.1",
    "--profile", "web-modern",
    "--locale", "ja",
    "--format", "json"
  ]));
  assert.equal(shown.requirement.id, "WCAG-2.2-SC-1.1.1");
  assert.equal(shown.requirement.success_criterion, "1.1.1");
  assert.ok(shown.requirement.title_en);
  assert.ok(shown.requirement.title_ja);
  assert.match(shown.requirement.normative_url, /^https:\/\//u);
  assert.match(shown.requirement.understanding_url, /^https:\/\//u);
  assert.equal(shown.requirement.procedure_status, "available");
});

test("requirements search supports Japanese and English terms plus profile, level, and procedure filters", () => {
  const japanese = parseJson(runCli([
    "requirements", "search", "フォーカス",
    "--profile", "web-modern",
    "--format", "json"
  ]));
  assert.ok(japanese.count > 0);
  assert.ok(japanese.requirements.some((item) => item.success_criterion.startsWith("2.4.")));

  const english = parseJson(runCli([
    "requirements", "search", "focus",
    "--profile", "web-modern",
    "--level", "AA",
    "--format", "json"
  ]));
  assert.ok(english.count > 0);
  assert.ok(english.requirements.every((item) => item.level === "AA"));

  const procedure = parseJson(runCli([
    "requirements", "list",
    "--profile", "web-modern",
    "--procedure", "available",
    "--format", "json"
  ]));
  assert.deepEqual(
    procedure.requirements.map((item) => item.success_criterion),
    ["1.1.1", "1.3.1", "2.1.1", "4.1.2"]
  );
});

test("requirements results expose WCAG/JIS relations and primary guidance links", () => {
  const output = parseJson(runCli([
    "requirements", "show", "1.1.1",
    "--profile", "jp-public-web",
    "--format", "json"
  ]));
  assert.equal(output.requirement.success_criterion, "1.1.1");
  assert.ok(output.requirement.related_requirement_ids.includes("WCAG-2.2-SC-1.1.1"));
  assert.ok(output.requirement.source_urls.some((url) => url.includes("waic.jp")));
  assert.ok(output.requirement.source_urls.some((url) => url.includes("w3.org")));
});

