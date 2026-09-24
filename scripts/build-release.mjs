import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyPackage } from "./verify-package.mjs";
import { buildDistribution, executableSkillScripts } from "./sync-distributions.mjs";
import { assertNewOutputPath, writeNewText } from "../shared/skill/scripts/lib/audit-run.mjs";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootFiles = new Set(["README.md", "README.en.md", "LICENSE", "SECURITY.md", "CONTRIBUTING.md", "CHANGELOG.md", "THIRD_PARTY_NOTICES.md", "release-files.json", ".gitattributes", ".gitignore"]);
const sourceTrees = ["shared/skill", "platform/codex", "codex/agents", "claude/agents", "shared/agents", "scripts", "examples", "tests"];
const underSourceTree = file => sourceTrees.some(tree => file.startsWith(tree + "/"));
const generatedSkillPath = file => /^(?:codex|claude)\/skills\/information-accessibility-practice\//u.test(file);
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const textJson = value => JSON.stringify(value, null, 2) + "\n";
function git(root, args, input) {
  const result = spawnSync("git", ["-C", root, ...args], { input, maxBuffer: 128 * 1024 * 1024, timeout: 30_000, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Git release input failed: ${result.stderr.toString("utf8").trim()}`);
  return result.stdout;
}
export function isReleasePath(file) {
  if (rootFiles.has(file)) return true;
  if (file === "shared/skill/.npmignore") return true;
  if (file === ".github/PULL_REQUEST_TEMPLATE.md" || /^\.github\/(?:workflows|ISSUE_TEMPLATE)\/[A-Za-z0-9._-]+\.ya?ml$/u.test(file)) return true;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(file) || file.split("/").some(part => part.startsWith(".") || ["node_modules", "audit-runs", "sources", "superpowers", "reviews", "audits"].includes(part))) return false;
  return /^(?:codex\/agents|claude\/agents|shared\/(?:agents|skill)|platform\/codex|scripts|examples|tests)\//u.test(file)
    || /^docs\/[^/]+\.md$/u.test(file) || /^docs\/releases\/[0-9][A-Za-z0-9.-]*\.md$/u.test(file);
}
function committedFiles(root, commit) {
  const inventory = JSON.parse(git(root, ["show", `${commit}:release-files.json`]).toString("utf8"));
  if (inventory.schema_version !== "1.0.0" || !Array.isArray(inventory.files) || !inventory.files.length
    || inventory.files.some(file => typeof file !== "string" || !isReleasePath(file))
    || new Set(inventory.files).size !== inventory.files.length) throw new Error("Invalid curated release file inventory.");
  const reviewedFiles = new Set(inventory.files);
  const entries = git(root, ["ls-tree", "-r", "-z", commit]).toString("utf8").split("\0").filter(Boolean).map(entry => {
    const match = /^(\d+) (\w+) ([a-f0-9]{40,64})\t(.+)$/u.exec(entry);
    if (!match) throw new Error("Unsupported Git tree entry.");
    if ((underSourceTree(match[4]) || generatedSkillPath(match[4])) && !isReleasePath(match[4])) throw new Error(`Excluded content inside a release source tree: ${match[4]}`);
    return { mode: match[1], kind: match[2], object: match[3], path: match[4] };
  }).filter(entry => isReleasePath(entry.path)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  for (const entry of entries) if (!reviewedFiles.has(entry.path)) throw new Error(`Unreviewed release input; inspect before adding to release-files.json: ${entry.path}`);
  for (const file of reviewedFiles) if (!entries.some(entry => entry.path === file)) throw new Error(`Curated release input missing from commit: ${file}`);
  if (!entries.length || entries.some(entry => entry.kind !== "blob" || !["100644", "100755"].includes(entry.mode))) throw new Error("Release inputs must be regular committed files; symbolic links and submodules are not supported.");
  const bytes = git(root, ["cat-file", "--batch"], entries.map(entry => entry.object + "\n").join(""));
  let offset = 0;
  for (const entry of entries) {
    const end = bytes.indexOf(10, offset), header = bytes.subarray(offset, end).toString("ascii").split(" ");
    const size = Number(header[2]);
    if (end < 0 || header[0] !== entry.object || header[1] !== "blob" || !Number.isSafeInteger(size) || size < 0 || end + size + 2 > bytes.length) throw new Error("Invalid Git blob batch.");
    const data = bytes.subarray(end + 1, end + 1 + size);
    entry.size = size; entry.sha256 = hash(data);
    offset = end + size + 2;
  }
  return entries.map(({ path: file, size, sha256 }) => ({ path: file, size, sha256 }));
}
function writeArchive(output, bytes) {
  const file = assertNewOutputPath(output), parent = path.dirname(file);
  const before = fs.statSync(parent, { bigint: true });
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  let created;
  try {
    created = fs.fstatSync(fd, { bigint: true });
    const openedParent = fs.statSync(parent, { bigint: true });
    if (before.dev !== openedParent.dev || before.ino !== openedParent.ino) throw new Error("Release output parent changed before write.");
    fs.writeFileSync(fd, bytes); fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  const after = fs.statSync(parent, { bigint: true }), actual = fs.lstatSync(file, { bigint: true });
  const samePath = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (before.dev !== after.dev || before.ino !== after.ino || actual.isSymbolicLink() || actual.dev !== created.dev || actual.ino !== created.ino
    || !samePath(fs.realpathSync.native(file), file) || hash(fs.readFileSync(file)) !== hash(bytes)) throw new Error("Release output changed during creation; do not publish this incomplete candidate.");
}
function verifyArchive(archive, stem, files) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-release-verify-"));
  const realTemporary = fs.realpathSync.native(temporary);
  const originalIdentity = fs.statSync(temporary, { bigint: true });
  try {
    const archiveFile = path.join(temporary, "candidate.tar.gz");
    fs.writeFileSync(archiveFile, archive, { flag: "wx", mode: 0o600 });
    const extraction = spawnSync("tar", ["-xzf", archiveFile, "-C", temporary], { maxBuffer: 1024 * 1024, timeout: 30_000, windowsHide: true });
    if (extraction.error) throw extraction.error;
    if (extraction.status !== 0) throw new Error("Release archive extraction failed; a tar implementation supporting gzip is required.");
    const extractedRoot = path.join(temporary, stem);
    const actual = [];
    const walk = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error("Unexpected symbolic link in release archive.");
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile()) actual.push(path.relative(extractedRoot, file).split(path.sep).join("/"));
        else throw new Error("Unexpected special file in release archive.");
      }
    };
    walk(extractedRoot);
    if (JSON.stringify(actual.sort()) !== JSON.stringify(files.map(file => file.path).sort())) throw new Error("Archive inventory differs from the committed source manifest.");
    for (const file of files) {
      const bytes = fs.readFileSync(path.join(extractedRoot, file.path));
      if (bytes.length !== file.size || hash(bytes) !== file.sha256) throw new Error(`Archive bytes differ from committed source: ${file.path} (${bytes.length}/${file.size}, ${hash(bytes)}/${file.sha256})`);
    }
    const verified = verifyPackage(extractedRoot);
    if (verified.status !== "PASS") throw new Error(`Archived package verification failed: ${verified.errors.join("; ")}`);
  } finally {
    const currentIdentity = fs.statSync(temporary, { bigint: true });
    if (fs.realpathSync.native(temporary) !== realTemporary || originalIdentity.dev !== currentIdentity.dev || originalIdentity.ino !== currentIdentity.ino) throw new Error("Release verification directory changed; refusing cleanup.");
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
function archiveCommittedSource(root, commit, sourceFiles, stem) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-release-stage-"));
  const temporaryIdentity = fs.statSync(temporary, { bigint: true });
  const temporaryReal = fs.realpathSync.native(temporary);
  const tempRoot = fs.realpathSync.native(os.tmpdir());
  if (!temporaryReal.startsWith(`${tempRoot}${path.sep}`)) throw new Error("Release stage escaped the temporary directory.");
  try {
    const sourcePaths = [
      ...sourceTrees.filter(tree => sourceFiles.some(file => file.path.startsWith(`${tree}/`))),
      ...sourceFiles.filter(file => !underSourceTree(file.path)).map(file => file.path)
    ];
    const sourceArchive = git(root, ["-c", "core.autocrlf=false", "archive", "--format=tar", "--prefix=source/", commit, "--", ...sourcePaths]);
    const inputArchive = path.join(temporary, "source.tar");
    fs.writeFileSync(inputArchive, sourceArchive, { flag: "wx" });
    const extraction = spawnSync("tar", ["-xf", inputArchive, "-C", temporary], { maxBuffer: 1024 * 1024, timeout: 30_000, windowsHide: true });
    if (extraction.error) throw extraction.error;
    if (extraction.status !== 0) throw new Error("Committed source extraction failed.");
    const stageRoot = path.join(temporary, "source");
    for (const file of sourceFiles) {
      const bytes = fs.readFileSync(path.join(stageRoot, file.path));
      if (bytes.length !== file.size || hash(bytes) !== file.sha256) throw new Error(`Committed source bytes differ in release stage: ${file.path}`);
    }
    const generation = buildDistribution(stageRoot, { write: true });
    if (generation.status !== "PASS") throw new Error(`Release distribution generation failed: ${generation.errors.join("; ")}`);
    const verified = verifyPackage(stageRoot);
    if (verified.status !== "PASS") throw new Error(`Release stage package verification failed: ${verified.errors.join("; ")}`);
    const sourcePathsSet = new Set(sourceFiles.map(file => file.path));
    const paths = [];
    const walk = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (directory === stageRoot && entry.name === ".git") continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Unexpected symbolic link in release stage: ${absolute}`);
        if (entry.isDirectory()) walk(absolute);
        else if (entry.isFile()) paths.push(path.relative(stageRoot, absolute).split(path.sep).join("/"));
        else throw new Error(`Unsupported release stage entry: ${absolute}`);
      }
    };
    walk(stageRoot);
    paths.sort();
    if (paths.some(file => !sourcePathsSet.has(file) && !generatedSkillPath(file))) throw new Error("Unexpected generated release file outside distribution paths.");
    const files = paths.map(file => {
      const bytes = fs.readFileSync(path.join(stageRoot, file));
      return { path: file, size: bytes.length, sha256: hash(bytes) };
    });
    git(stageRoot, ["init", "-q"]);
    git(stageRoot, ["-c", "core.autocrlf=false", "add", "-f", "-A"]);
    git(stageRoot, ["update-index", "--chmod=+x", "--", ...["shared", "codex", "claude"].flatMap(prefix =>
      [...executableSkillScripts].map(relative => prefix === "shared"
        ? `shared/skill/${relative}`
        : `${prefix}/skills/information-accessibility-practice/${relative}`))]);
    const tree = git(stageRoot, ["write-tree"]).toString("ascii").trim();
    const timestamp = git(root, ["show", "-s", "--format=%ct", commit]).toString("ascii").trim();
    const archive = gzipSync(git(stageRoot, ["-c", "core.autocrlf=false", "-c", "core.eol=lf", "archive", "--format=tar", `--mtime=@${timestamp}`, `--prefix=${stem}/`, tree]), { level: 9 });
    verifyArchive(archive, stem, files);
    return { archive, files };
  } finally {
    const actual = fs.statSync(temporary, { bigint: true });
    if (fs.realpathSync.native(temporary) !== temporaryReal || actual.dev !== temporaryIdentity.dev || actual.ino !== temporaryIdentity.ino) {
      throw new Error("Release stage identity changed; refusing cleanup.");
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
export function buildRelease({ root = defaultRoot, outputDir } = {}) {
  if (!outputDir) throw new Error("--output-dir is required. Use a new or empty directory outside the checkout or under ignored audit-runs/.");
  root = path.resolve(root);
  if (git(root, ["status", "--porcelain", "--untracked-files=normal"]).length) throw new Error("Release preparation requires a clean committed checkout; commit or preserve pending work first.");
  const commit = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]).toString("ascii").trim();
  const packageJson = JSON.parse(git(root, ["show", `${commit}:shared/skill/package.json`]).toString("utf8"));
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(packageJson.version)) throw new Error("Release package version must be a safe semantic version.");
  const version = packageJson.version, stem = `information-accessibility-skill-${version}-${commit.slice(0, 12)}`, archiveName = stem + ".tar.gz";
  const sourceFiles = committedFiles(root, commit);
  const notesPath = `docs/releases/${version}.md`;
  if (!sourceFiles.some(file => file.path === notesPath)) throw new Error(`Missing versioned release notes: ${notesPath}`);
  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) throw new Error("Release output directory must be empty; existing candidates are never overwritten.");
  const outputs = [archiveName, "source-manifest.json", "release-notes.md", "SHA256SUMS"].map(name => path.resolve(outputDir, name));
  for (const output of outputs) assertNewOutputPath(output);
  const { archive, files } = archiveCommittedSource(root, commit, sourceFiles, stem);
  const manifest = { schema_version: "1.0.0", package_version: version, source_commit: commit, publication_status: "local_candidate",
    archive: { name: archiveName, sha256: hash(archive), size: archive.length }, source_file_count: sourceFiles.length,
    generated_file_count: files.length - sourceFiles.length, files };
  const notes = `Source commit: ${commit}\nPackage: ${version}\nStatus: local candidate; publication and remote CI are not implied.\n\n${git(root, ["show", `${commit}:${notesPath}`]).toString("utf8")}`;
  const manifestText = textJson(manifest);
  // A final checksum file is the completion marker. Partial candidates are kept
  // for inspection on failure; no existing files are replaced or removed.
  if (git(root, ["rev-parse", "--verify", "HEAD^{commit}"]).toString("ascii").trim() !== commit
    || git(root, ["status", "--porcelain", "--untracked-files=normal"]).length) throw new Error("Checkout changed during release preparation.");
  writeArchive(outputs[0], archive);
  writeNewText(outputs[1], manifestText);
  writeNewText(outputs[2], notes);
  writeNewText(outputs[3], [`${hash(archive)}  ${archiveName}`, `${hash(manifestText)}  source-manifest.json`, `${hash(notes)}  release-notes.md`, ""].join("\n"));
  return { status: "PASS", publication_status: "local_candidate", package_version: version, source_commit: commit, file_count: files.length, output_dir: path.resolve(outputDir), archive: archiveName };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--output-dir") throw new Error("Usage: node scripts/build-release.mjs --output-dir <new-or-empty-directory>");
    console.log(textJson(buildRelease({ outputDir: process.argv[3] })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
