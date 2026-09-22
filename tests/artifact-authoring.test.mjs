import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { cli, pass, read } from "./helpers/scanner-import.mjs";

const example = fileURLToPath(new URL("../examples/run-backed-web-audit/run.mjs", import.meta.url));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value), "utf8");
function reject(result, pattern) {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, pattern);
}

test("author four standard candidates, edit, validate, register, merge and report without agents", (t) => {
  const help = cli(["artifact", "--help"]); pass(help);
  assert.match(help.stdout, /artifact init.*--payload/s);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-authoring-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Reuse the published synthetic fixture, including its saved E1 evidence.
  pass(spawnSync(process.execPath, [example, "--output", root], { encoding: "utf8", shell: false }));
  const scenario = path.join(root, "human-reviewed"), artifacts = path.join(scenario, "artifacts");
  let runFile = path.join(scenario, "audit-run.bound.json");
  const types = ["screening-observations", "human-review-queue", "declared-human-review", "remediation-plan"];
  for (const [index, type] of types.entries()) {
    const source = read(path.join(artifacts, `${type}.json`)), payloadFile = path.join(artifacts, `payload-${index}.json`);
    const payload = structuredClone(source.payload); delete payload.schema_version; write(payloadFile, payload);
    const output = path.join(artifacts, `authored-${index}.json`), before = fs.readFileSync(runFile);
    const args = ["artifact", "init", "--run", runFile, "--type", type, "--payload", payloadFile,
      "--artifact-id", source.artifact_id, ...source.inputs.flatMap((input) => ["--input", input.artifact_id]), "--output", output];
    pass(cli(args));
    const authored = read(output), run = read(runFile);
    assert.equal(authored.run_id, run.run_id);
    assert.equal(authored.schema_version, source.schema_version);
    assert.equal(authored.payload.schema_version, source.payload.schema_version);
    assert.equal(authored.producer.role_id, source.producer.role_id);
    assert.match(authored.producer.origin, /no agent dispatch/);
    assert.match(authored.created_at, /Z$/);
    for (const input of authored.inputs) assert.equal(input.sha256, run.artifacts.find((entry) => entry.artifact_id === input.artifact_id).sha256);
    assert.deepEqual(fs.readFileSync(runFile), before);
    pass(cli(["artifact", "validate", "--run", runFile, "--artifact", output]));
    if (index === 0) {
      authored.payload.observations[0].observation += " Edited synthetic observation; literal $(never-execute).";
      write(output, authored);
      reject(cli(args), /exist/i);
      const outside = path.join(root, "outside.json");
      reject(cli([...args.slice(0, -1), outside]), /private artifact root/);
      assert.equal(fs.existsSync(outside), false);
      const generated = path.join(artifacts, "generated-id.json"), autoArgs = [...args];
      autoArgs.splice(autoArgs.indexOf("--artifact-id"), 2); autoArgs[autoArgs.length - 1] = generated;
      pass(cli(autoArgs)); assert.match(read(generated).artifact_id, /^ART-[A-F0-9-]{36}$/);
      write(payloadFile, { ...payload, schema_version: null });
      const invalidOutput = path.join(artifacts, "invalid-version.json");
      reject(cli([...args.slice(0, -1), invalidOutput]), /schema_version/);
      assert.equal(fs.existsSync(invalidOutput), false);
      write(payloadFile, payload);
    }
    if (index === 1) {
      const invalid = path.join(artifacts, "invalid.json");
      for (const [mutate, pattern] of [
        [(value) => { value.run_id = "RUN-20260823T120000Z-OTHER001"; }, /another run/],
        [(value) => { value.inputs[0].run_id = "RUN-20260823T120000Z-OTHER001"; }, /same run/],
        [(value) => { value.inputs[0].sha256 = "0".repeat(64); }, /hash mismatch/],
        [(value) => { value.inputs[0].artifact_id = "ART-UNREGISTERED"; }, /not registered/]
      ]) {
        const value = structuredClone(authored); mutate(value); write(invalid, value);
        reject(cli(["artifact", "validate", "--run", runFile, "--artifact", invalid]), pattern);
      }
      const rejectedOutput = path.join(artifacts, "rejected.json");
      reject(cli([...args.slice(0, -2), "--input", "ART-UNREGISTERED", "--output", rejectedOutput]), /not registered/);
      assert.equal(fs.existsSync(rejectedOutput), false);
      const registeredFile = path.join(artifacts, run.artifacts[0].path), registeredBytes = fs.readFileSync(registeredFile);
      try {
        fs.appendFileSync(registeredFile, " ");
        reject(cli(["artifact", "validate", "--run", runFile, "--artifact", output]), /SHA-256|hash/i);
      } finally { fs.writeFileSync(registeredFile, registeredBytes); }
    }
    pass(cli(["artifact", "validate", "--run", runFile, "--artifact", output]));
    const next = path.join(scenario, `authored-run-${index}.json`);
    pass(cli(["register", "--run", runFile, "--artifact", output, "--output", next]));
    assert.deepEqual(fs.readFileSync(runFile), before);
    runFile = next;
  }
  const merged = path.join(scenario, "authored-assessment.json"), report = path.join(scenario, "authored-report.md");
  pass(cli(["merge", "--run", runFile, "--assessment", path.join(scenario, "baseline-assessment.json"),
    ...read(runFile).artifacts.flatMap((entry) => ["--artifact", path.join(artifacts, entry.path)]), "--output", merged]));
  pass(cli(["report", "--run", runFile, "--assessment", merged, "--output", report]));
  assert.ok(fs.statSync(report).size > 0);
});
