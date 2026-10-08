import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "codex/skills/information-accessibility-practice");
const readText = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8").replace(/\r\n/gu, "\n");
const readJson = (...parts) => JSON.parse(readText(...parts));

const skillPackage = readJson("shared/skill/package.json");
const minimumMajor = Number(/^>=(\d+)$/u.exec(skillPackage.engines.node)?.[1]);

test("the Node.js baseline is declared once per surface and agrees everywhere", () => {
  // Node.js 20 reached end of life on 2026-04-30.
  assert.ok(Number.isInteger(minimumMajor) && minimumMajor >= 22, `engines.node must be >=N with N of at least 22: ${skillPackage.engines.node}`);
  const workspace = readJson("package.json");
  assert.equal(workspace.private, true);
  assert.equal(workspace.engines.node, skillPackage.engines.node);
  assert.equal(workspace.devDependencies.exceljs, skillPackage.dependencies.exceljs);
  assert.equal(readJson("shared/skill/references/web-capabilities.json").dependencies.node, skillPackage.engines.node);
  const doctor = spawnSync(process.execPath, [path.join(skillRoot, "scripts/accessibility-audit.mjs"), "doctor", "--format", "json"], { cwd: root, encoding: "utf8" });
  assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  const reported = JSON.parse(doctor.stdout).node;
  assert.equal(reported.required, skillPackage.engines.node);
  assert.equal(reported.supported, Number.parseInt(process.versions.node, 10) >= minimumMajor);
});

test("documentation states the same minimum Node.js major", () => {
  for (const file of ["README.md", "README.en.md", "docs/installing.md", "docs/version-support.md"]) {
    const stated = [...readText(file).matchAll(/Node\.js (\d+)(?:以上| or later)/gu)].map((match) => Number(match[1]));
    assert.ok(stated.length > 0, `${file} states no Node.js minimum`);
    assert.ok(stated.every((major) => major === minimumMajor), `${file} states Node.js ${stated.join(", ")}`);
  }
});

test("CI tests every supported Node.js major on Ubuntu, Windows and macOS and runs nothing older", () => {
  const verify = readText(".github/workflows/verify.yml");
  const nodes = JSON.parse(/node:\s*(\[[^\]]*\])/u.exec(verify)?.[1] ?? "[]");
  const systems = (/os:\s*\[([^\]]*)\]/u.exec(verify)?.[1] ?? "").split(",").map((item) => item.trim());
  assert.ok(nodes.includes(minimumMajor), `the verify matrix omits Node.js ${minimumMajor}`);
  assert.ok(nodes.every((major) => major >= minimumMajor), `the verify matrix lists ${nodes.join(", ")}`);
  assert.deepEqual(systems, ["ubuntu-latest", "windows-latest", "macos-latest"]);
  for (const file of fs.readdirSync(path.join(root, ".github/workflows")).filter((name) => name.endsWith(".yml"))) {
    for (const match of readText(".github/workflows", file).matchAll(/node-version:\s*(\d+)\s*$/gmu)) {
      assert.ok(Number(match[1]) >= minimumMajor, `${file} runs Node.js ${match[1]}`);
    }
  }
});
