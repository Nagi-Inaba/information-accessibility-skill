import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateScreenReaderRegistry } from "../codex/skills/information-accessibility-practice/scripts/show-screen-reader-checklist.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skill = path.join(root, "codex", "skills", "information-accessibility-practice");
const script = path.join(skill, "scripts", "show-screen-reader-checklist.mjs");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(skill, relative), "utf8"));

function run(args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd ?? root,
    encoding: "utf8"
  });
}

test("screen-reader checklist registry is schema-valid and supporting-only", () => {
  const registry = readJson("references/screen-reader-ui-checks.json");
  const schema = readJson("references/screen-reader-ui-checks.schema.json");
  const errors = validateScreenReaderRegistry(registry, schema);

  assert.deepEqual(errors, []);
  assert.equal(registry.claim_effect, "supporting_only");
  for (const id of ["modal-dialog", "disclosure", "menu-button", "fragmented-text", "in-page-links", "tabs", "combobox", "status-messages"]) {
    assert.ok(registry.patterns.some((pattern) => pattern.id === id), `missing ${id}`);
  }

  const checks = registry.patterns.flatMap((pattern) => pattern.checks);
  assert.equal(new Set(checks.map((check) => check.id)).size, checks.length);
  assert.ok(checks.every((check) => check.id.startsWith("SCREEN-SR-")));
  assert.ok(checks.every((check) => check.human_review_required === true));
  assert.ok(checks.every((check) => check.code_inspection.length > 0));
  assert.ok(checks.every((check) => check.runtime_verification.length > 0));
  assert.ok(checks.every((check) => check.cant_tell_when.length > 0));
});

test("screen-reader checklist CLI filters one pattern as JSON", () => {
  const result = run(["--pattern", "modal-dialog", "--format", "json"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.pattern, "modal-dialog");
  assert.equal(output.claim_effect, "supporting_only");
  assert.equal(output.patterns.length, 1);
  assert.equal(output.patterns[0].id, "modal-dialog");
  for (const id of [
    "SCREEN-SR-MODAL-CLOSED-ABSENT",
    "SCREEN-SR-MODAL-FOCUS-ENTRY",
    "SCREEN-SR-MODAL-BACKGROUND-ISOLATED",
    "SCREEN-SR-MODAL-FOCUS-CONTAINED",
    "SCREEN-SR-MODAL-ESCAPE-CLOSE",
    "SCREEN-SR-MODAL-FOCUS-RETURN"
  ]) {
    assert.ok(output.patterns[0].checks.some((check) => check.id === id), `missing ${id}`);
  }
});

test("in-page-links pattern has required checks and evidence", () => {
  const result = run(["--pattern", "in-page-links", "--format", "json"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.patterns.length, 1);
  assert.equal(output.patterns[0].id, "in-page-links");
  assert.ok(output.patterns[0].checks.length >= 3);
  for (const id of [
    "SCREEN-SR-IN-PAGE-IDENTITY-CONDITIONS",
    "SCREEN-SR-IN-PAGE-FOCUS-AND-TAB",
    "SCREEN-SR-IN-PAGE-AT-READING"
  ]) {
    assert.ok(output.patterns[0].checks.some((check) => check.id === id), `missing ${id}`);
  }
  assert.ok(output.patterns[0].checks.some((check) => check.code_inspection.some((line) => /tabindex/i.test(line))));
  const runtimeText = JSON.stringify(output.patterns[0].checks.flatMap((check) => check.runtime_verification)).toLowerCase();
  assert.ok(runtimeText.includes("os"));
  assert.ok(runtimeText.includes("browser"));
  assert.ok(runtimeText.includes("assistive"));
  assert.ok(runtimeText.includes("version"));
});

test("screen-reader checklist semantic validation rejects duplicate pattern IDs", () => {
  const registry = readJson("references/screen-reader-ui-checks.json");
  const schema = readJson("references/screen-reader-ui-checks.schema.json");
  registry.patterns[3] = structuredClone(registry.patterns[0]);

  const errors = validateScreenReaderRegistry(registry, schema);

  assert.ok(errors.some((error) => /duplicate pattern IDs/iu.test(error)));
});

test("new stateful patterns expose distinct structure, keyboard, and spoken checks", () => {
  for (const id of ["tabs", "combobox", "status-messages"]) {
    const result = run(["--pattern", id, "--format", "json", "--locale", "ja"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    const checks = output.patterns[0].checks;
    assert.equal(checks.length, 3);
    assert.ok(checks.every((check) => check.human_review_required));
    assert.ok(checks.some((check) => check.evidence_types.includes("accessibility_tree")));
    assert.ok(checks.some((check) => check.evidence_types.includes("keyboard_test")));
    assert.ok(checks.some((check) => check.evidence_types.includes("assistive_technology_test")));
    assert.ok(checks.some((check) => check.evidence_types.includes("spoken_output_note")));
    assert.ok(output.patterns[0].title.length > 0);
  }
});

test("pattern listing and optional extension validate collisions and sources", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-screen-reader-extension-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const extensionFile = path.join(directory, "extension.json");
  const pattern = structuredClone(readJson("references/screen-reader-ui-checks.json").patterns[0]);
  pattern.id = "custom-dialog";
  pattern.checks.forEach((check, index) => { check.id = `SCREEN-SR-CUSTOM-${index + 1}`; });
  const writeExtension = () => fs.writeFileSync(extensionFile, JSON.stringify({ schema_version: "1.0.0", patterns: [pattern] }), "utf8");
  writeExtension();

  const listing = run(["--list-patterns", "--extension", extensionFile]);
  assert.equal(listing.status, 0, listing.stderr || listing.stdout);
  assert.ok(JSON.parse(listing.stdout).patterns.some((item) => item.id === "custom-dialog"));
  const selected = run(["--pattern", "custom-dialog", "--extension", extensionFile, "--locale", "ja"]);
  assert.equal(selected.status, 0, selected.stderr || selected.stdout);
  assert.deepEqual(JSON.parse(selected.stdout).untranslated_extension_patterns, ["custom-dialog"]);
  const all = run(["--extension", extensionFile]);
  assert.equal(all.status, 0, all.stderr || all.stdout);
  assert.equal(JSON.parse(all.stdout).patterns.length, readJson("references/screen-reader-ui-checks.json").patterns.length + 1);

  pattern.id = "tabs";
  writeExtension();
  assert.match(run(["--extension", extensionFile]).stderr, /duplicate pattern ID/iu);
  pattern.id = "custom-dialog";
  pattern.source_urls = ["https://example.com/unknown"];
  writeExtension();
  assert.match(run(["--extension", extensionFile]).stderr, /Invalid screen-reader extension/iu);
  pattern.source_urls = ["https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/"];
  pattern.checks[0].id = "SCREEN-SR-MODAL-NAMED";
  writeExtension();
  assert.match(run(["--extension", extensionFile]).stderr, /duplicate check ID/iu);
});

test("fragmented-text output includes only its directly related public sources", () => {
  const result = run(["--pattern", "fragmented-text", "--format", "json"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.ok(output.sources.some((source) => source.includes("#aria-hidden")));
  assert.ok(output.sources.some((source) => source.includes("info-and-relationships")));
  assert.equal(output.sources.some((source) => source.includes("dialog-modal")), false);
  assert.equal(output.sources.some((source) => source.includes("menu-button")), false);
});

test("screen-reader checklist CLI renders operational and evidence boundaries", () => {
  const result = run(["--pattern", "all", "--format", "markdown"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /visual state[^]*operability[^]*accessibility-tree exposure[^]*focus/iu);
  assert.match(result.stdout, /modal-dialog[^]*disclosure[^]*menu-button[^]*fragmented-text/iu);
  assert.match(result.stdout, /source or accessibility-tree inspection[^]*(?:does not|cannot)[^]*spoken output/iu);
  assert.match(result.stdout, /screen reader[^]*browser[^]*version[^]*locale/iu);
});

test("screen-reader checklist CLI rejects unknown patterns and formats", () => {
  const unknownPattern = run(["--pattern", "tooltip"]);
  assert.equal(unknownPattern.status, 1);
  assert.match(unknownPattern.stderr, /pattern.*modal-dialog.*disclosure.*menu-button.*fragmented-text.*all/iu);

  const unknownFormat = run(["--format", "html"]);
  assert.equal(unknownFormat.status, 1);
  assert.match(unknownFormat.stderr, /format.*json.*markdown/iu);
});

test("screen-reader checklist CLI does not write into the caller's working directory", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-screen-reader-checklist-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "existing.txt"), "unchanged\n", "utf8");
  const before = fs.readdirSync(directory);

  const result = run(["--pattern", "disclosure", "--format", "markdown"], { cwd: directory });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(fs.readdirSync(directory), before);
  assert.equal(fs.readFileSync(path.join(directory, "existing.txt"), "utf8"), "unchanged\n");
});
