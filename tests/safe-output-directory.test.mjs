import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeNewText } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";

test("safe writer creates a missing nested output directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "safe-output-"));
  const output = path.join(root, "one", "two", "report.md");
  writeNewText(output, "report\n");
  assert.equal(fs.readFileSync(output, "utf8"), "report\n");
});

test("safe writer refuses to overwrite an existing file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "safe-output-existing-"));
  const output = path.join(root, "report.md");
  fs.writeFileSync(output, "sentinel\n");
  assert.throws(() => writeNewText(output, "replacement\n"), /Refusing to overwrite/);
  assert.equal(fs.readFileSync(output, "utf8"), "sentinel\n");
});

test("safe writer rejects a symlinked directory component", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "safe-output-link-"));
  const real = path.join(root, "real");
  const link = path.join(root, "link");
  fs.mkdirSync(real);
  fs.symlinkSync(real, link, "dir");
  assert.throws(() => writeNewText(path.join(link, "report.md"), "report\n"), /Unsafe output directory|symbolic link|reparse/i);
  assert.equal(fs.existsSync(path.join(real, "report.md")), false);
});
