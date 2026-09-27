import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { commandDefinitions } from "../shared/skill/scripts/lib/cli-command-registry.mjs";
import { referencePath, renderCliReference } from "../scripts/build-cli-reference.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("committed CLI reference matches the command registry", () => {
  const result = spawnSync(process.execPath, ["scripts/build-cli-reference.mjs", "--check"], {
    cwd: root,
    encoding: "utf8",
    shell: false
  });
  assert.equal(result.status, 0, result.stderr);
});

test("CLI reference documents every registered command in both locales", () => {
  const reference = renderCliReference();
  for (const name of commandDefinitions.keys()) {
    const heading = `## \`${name}\``;
    const start = reference.indexOf(heading);
    assert.notEqual(start, -1, `missing section for ${name}`);
    const next = reference.indexOf("\n## ", start + heading.length);
    const section = reference.slice(start, next === -1 ? undefined : next);
    assert.match(section, /### English\n\n```text\n/u, `${name} lacks English help`);
    assert.match(section, /### 日本語\n\n```text\n/u, `${name} lacks Japanese help`);
    assert.match(reference, new RegExp(`\\| \\[\`${name}\`\\]\\(#${name}\\) \\|`, "u"), `${name} missing from index`);
  }
});

test("CLI reference rejects unknown modes without writing", () => {
  const before = fs.readFileSync(referencePath);
  const result = spawnSync(process.execPath, ["scripts/build-cli-reference.mjs", "--refresh"], {
    cwd: root,
    encoding: "utf8",
    shell: false
  });
  assert.equal(result.status, 2);
  assert.deepEqual(fs.readFileSync(referencePath), before);
});
