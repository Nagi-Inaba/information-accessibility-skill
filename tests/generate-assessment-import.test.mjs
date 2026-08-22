import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modules = [
  ["Codex", path.join(root, "codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs")],
  ["Claude", path.join(root, "claude/skills/information-accessibility-practice/scripts/generate-assessment.mjs")]
];

for (const [distribution, modulePath] of modules) {
  test(`${distribution} generate-assessment imports when process.argv[1] is absent`, () => {
    const moduleUrl = pathToFileURL(modulePath).href;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(moduleUrl)})`],
      { encoding: "utf8" }
    );

    assert.equal(result.status, 0, result.stderr);
  });

  test(`${distribution} generate-assessment still executes directly`, () => {
    const result = spawnSync(process.execPath, [modulePath, "--help"], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: node scripts\/generate-assessment\.mjs/u);
  });
}
