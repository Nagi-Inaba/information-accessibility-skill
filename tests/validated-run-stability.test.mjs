import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertValidatedRunStable, validatedRunSnapshots } from "../codex/skills/information-accessibility-practice/scripts/lib/audit-run.mjs";
import { readStableFile } from "../codex/skills/information-accessibility-practice/scripts/lib/safe-file-io.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A stand-in for what validateAuditRun returns: one registered artifact, one saved evidence file, one historical resource.
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-validated-run-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const files = Object.fromEntries(["artifact", "evidence", "historical"].map((name) => {
    const file = path.join(directory, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify({ name }));
    return [name, file];
  }));
  const validation = {
    valid: true,
    envelopesById: new Map([["ARTIFACT-1", { envelope: {}, snapshot: readStableFile(files.artifact) }]]),
    evidenceSnapshots: new Map([["evidence.json", readStableFile(files.evidence)]]),
    historicalResourceSnapshots: [readStableFile(files.historical)]
  };
  return { files, validation };
}

test("a validated run passes while nothing it read has changed", (t) => {
  const { validation } = fixture(t);
  assert.doesNotThrow(() => assertValidatedRunStable(validation));
  assert.equal(validatedRunSnapshots(validation).length, 3);
});

for (const [name, label] of [["artifact", "registered artifact"], ["evidence", "raw evidence"], ["historical", "historical resource"]]) {
  test(`a change to the ${name} input after validation is refused with its label`, (t) => {
    const { files, validation } = fixture(t);
    fs.writeFileSync(files[name], JSON.stringify({ name, edited: true }));
    assert.throws(() => assertValidatedRunStable(validation), new RegExp(`${label} changed before commit`, "u"));
  });
}

test("callers can rename the inputs, and a validation without snapshots is tolerated", (t) => {
  const { files, validation } = fixture(t);
  fs.writeFileSync(files.evidence, "{}");
  assert.throws(() => assertValidatedRunStable(validation, { evidence: "saved evidence" }), /saved evidence changed before commit/u);
  assert.doesNotThrow(() => assertValidatedRunStable({ valid: false, errors: ["rejected"] }));
  assert.deepEqual(validatedRunSnapshots({ valid: false, errors: ["rejected"] }), []);
});

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".mjs") ? [full] : [];
  });
}

test("no command re-implements the post-validation re-check by hand", () => {
  const helper = path.join(root, "shared/skill/scripts/lib/audit-run-validation.mjs");
  const offenders = sourceFiles(path.join(root, "shared/skill/scripts")).filter((file) => file !== helper).flatMap((file) =>
    fs.readFileSync(file, "utf8").split(/\r?\n/u).flatMap((line, index) =>
      /assertStableFile\(/u.test(line) && /\b(?:envelopesById|evidenceSnapshots|historicalResourceSnapshots)\b/u.test(line)
        ? [`${path.relative(root, file).split(path.sep).join("/")}:${index + 1}`] : []));
  assert.deepEqual(offenders, [], "use assertValidatedRunStable or validatedRunSnapshots from lib/audit-run.mjs");
});
