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
  assert.deepEqual(registry.patterns.map((pattern) => pattern.id), [
    "modal-dialog",
    "disclosure",
    "menu-button",
    "fragmented-text"
  ]);

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

test("screen-reader checklist semantic validation rejects duplicate and missing pattern IDs", () => {
  const registry = readJson("references/screen-reader-ui-checks.json");
  const schema = readJson("references/screen-reader-ui-checks.schema.json");
  registry.patterns[3] = structuredClone(registry.patterns[0]);

  const errors = validateScreenReaderRegistry(registry, schema);

  assert.ok(errors.some((error) => /exactly these IDs in order/iu.test(error)));
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
