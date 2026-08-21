import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { writeNewTextFile } from "../scripts/lib/safe-output.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("root safe writer refuses to create missing parent directories", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "safe-parent-"));
  const output = path.join(temp, "missing", "file.txt");
  assert.throws(() => writeNewTextFile(output, "data"), /must already exist/);
  assert.equal(fs.existsSync(path.dirname(output)), false);
});

test("root safe writer refuses symlinked parents", { skip: process.platform === "win32" }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "safe-link-"));
  const real = path.join(temp, "real");
  const link = path.join(temp, "link");
  fs.mkdirSync(real);
  fs.symlinkSync(real, link, "dir");
  assert.throws(() => writeNewTextFile(path.join(link, "file.txt"), "data"), /symbolic link|reparse/);
  assert.equal(fs.existsSync(path.join(real, "file.txt")), false);
});

test("standalone report does not create an unverified output parent", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "report-parent-"));
  const input = path.join(temp, "audit.json");
  const template = JSON.parse(fs.readFileSync(path.join(root, "codex/skills/information-accessibility-practice/assets/assessment-record.template.json"), "utf8"));
  template.assessment.target.name = "Example";
  template.assessment.target.version_or_commit = "v1";
  template.assessment.target.urls_or_files = ["https://example.invalid/"];
  template.assessment.evaluator = "Reviewer";
  template.assessment.evaluated_at = "2026-08-22";
  fs.writeFileSync(input, JSON.stringify(template));
  const output = path.join(temp, "missing", "report.md");
  const script = path.join(root, "codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs");
  const result = spawnSync(process.execPath, [script, "--input", input, "--output", output], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing output parent|must already exist/);
  assert.equal(fs.existsSync(path.dirname(output)), false);
});
