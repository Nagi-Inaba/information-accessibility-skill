import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildRelease } from "../scripts/build-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function run(command, args, cwd, input) {
  const result = spawnSync(command, args, { cwd, input, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, GIT_AUTHOR_NAME: "Release fixture", GIT_AUTHOR_EMAIL: "fixture@users.noreply.github.com",
      GIT_COMMITTER_NAME: "Release fixture", GIT_COMMITTER_EMAIL: "fixture@users.noreply.github.com" } });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  return result.stdout.trim();
}
function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const src = path.join(source, entry.name), dst = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, "utf8");
}
function commitFixture(directory) {
  run("git", ["add", "--all"], directory);
  const tree = run("git", ["write-tree"], directory);
  const commit = run("git", ["commit-tree", tree], directory, "Synthetic release fixture\n");
  run("git", ["update-ref", "HEAD", commit], directory);
  return commit;
}
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-release-")), checkout = path.join(base, "checkout");
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(checkout);
  for (const directory of ["codex", "claude", "shared", "platform", "scripts", "examples", "tests", ".github"]) copyTree(path.join(root, directory), path.join(checkout, directory));
  for (const file of ["README.md", "README.en.md", "LICENSE", "SECURITY.md", "CONTRIBUTING.md", "CHANGELOG.md", "THIRD_PARTY_NOTICES.md", "release-files.json", ".gitattributes", ".gitignore"]) fs.copyFileSync(path.join(root, file), path.join(checkout, file));
  for (const file of fs.readdirSync(path.join(root, "docs")).filter(file => file.endsWith(".md"))) write(path.join(checkout, "docs", file), fs.readFileSync(path.join(root, "docs", file)));
  copyTree(path.join(root, "docs/releases"), path.join(checkout, "docs/releases"));
  write(path.join(checkout, "docs/sources/research-original.txt"), "DO_NOT_SHIP_RESEARCH_ORIGINAL");
  write(path.join(checkout, "docs/reviews/private-review.md"), "DO_NOT_SHIP_INTERNAL_REVIEW");
  write(path.join(checkout, ".env"), "DO_NOT_SHIP_ENV_SECRET");
  run("git", ["init", "--quiet"], checkout);
  commitFixture(checkout);
  write(path.join(checkout, "audit-runs/private.json"), JSON.stringify({ private: "DO_NOT_SHIP_AUDIT_EVIDENCE" }));
  return { base, checkout };
}
test("release archive pins the source, preserves every manifest byte and excludes private/research inputs", t => {
  const { base, checkout } = fixture(t), outputDir = path.join(base, "candidate");
  const result = buildRelease({ root: checkout, outputDir });
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, "source-manifest.json"), "utf8"));
  assert.equal(manifest.source_commit, run("git", ["rev-parse", "HEAD"], checkout));
  assert.equal(manifest.publication_status, "local_candidate");
  const archive = path.join(outputDir, result.archive);
  assert.equal(hash(fs.readFileSync(archive)), manifest.archive.sha256);
  const extracted = path.join(base, "extracted");
  fs.mkdirSync(extracted);
  run("tar", ["-xzf", archive, "-C", extracted], checkout);
  const packageRoot = path.join(extracted, result.archive.replace(/\.tar\.gz$/u, ""));
  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(path.join(directory, entry.name)) : [path.relative(packageRoot, path.join(directory, entry.name)).split(path.sep).join("/")]);
  assert.deepEqual(walk(packageRoot).sort(), manifest.files.map(file => file.path).sort());
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(packageRoot, file.path));
    assert.equal(bytes.length, file.size, file.path);
    assert.equal(hash(bytes), file.sha256, file.path);
  }
  assert.ok(manifest.files.some(file => file.path.endsWith("references/licenses/w3c-document-2023.html")));
  assert.ok(manifest.files.some(file => file.path === "docs/releases/0.1.0.md"));
  assert.ok(manifest.files.some(file => file.path === ".github/workflows/report-nvda-smoke.yml"));
  assert.equal(manifest.files.some(file => /(?:^\.(?!github\/)|docs\/sources\/|docs\/reviews\/|audit-runs\/)/u.test(file.path) && ![".gitattributes", ".gitignore"].includes(file.path)), false);
  assert.ok(manifest.files.some(file => file.path === "codex/skills/information-accessibility-practice/.npmignore"));
  const packageCheck = JSON.parse(run(process.execPath, ["scripts/verify-package.mjs"], packageRoot));
  assert.equal(packageCheck.status, "PASS");
  assert.equal(JSON.parse(run(process.execPath, ["scripts/build-criteria-catalog.mjs", "--check"], packageRoot)).status, "PASS");
  run(process.execPath, ["scripts/install-claude.mjs", "--claude-home", path.join(base, "claude-home"), "--dry-run"], packageRoot);
  const sums = fs.readFileSync(path.join(outputDir, "SHA256SUMS"), "utf8").trim().split("\n");
  for (const line of sums) {
    const [expected, file] = line.split("  ");
    assert.equal(hash(fs.readFileSync(path.join(outputDir, file))), expected);
  }
  const second = buildRelease({ root: checkout, outputDir: path.join(base, "second") });
  assert.equal(hash(fs.readFileSync(path.join(base, "second", second.archive))), manifest.archive.sha256);
  assert.throws(() => buildRelease({ root: checkout, outputDir }), /must be empty/);
  assert.equal(hash(fs.readFileSync(archive)), manifest.archive.sha256);
  write(path.join(checkout, "README.md"), "pending edit");
  assert.throws(() => buildRelease({ root: checkout, outputDir: path.join(base, "dirty") }), /clean committed checkout/);
  assert.equal(fs.existsSync(path.join(base, "dirty")), false);
});

test("release preparation refuses hidden inputs inside packaged code trees", t => {
  const { base, checkout } = fixture(t);
  write(path.join(checkout, "shared/skill/.private-key"), "DO_NOT_SHIP");
  commitFixture(checkout);
  assert.throws(() => buildRelease({ root: checkout, outputDir: path.join(base, "candidate") }), /Package verification failed|Excluded content inside a release source tree/);
  assert.equal(fs.existsSync(path.join(base, "candidate")), false);
});

test("unknown fixture and example files require explicit inventory review before inclusion", t => {
  const { base, checkout } = fixture(t);
  for (const relative of ["tests/fixtures/client-capture.json", "examples/client-record.json"]) {
    write(path.join(checkout, relative), JSON.stringify({ capture: "DO_NOT_SHIP_REAL_AUDIT" }));
  }
  commitFixture(checkout);
  assert.throws(() => buildRelease({ root: checkout, outputDir: path.join(base, "candidate") }), /Unreviewed release input/);
  assert.equal(fs.existsSync(path.join(base, "candidate")), false);
});
