import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

import { inspectVerificationFile } from "./lib/fix-verification.mjs";

function usage() {
  throw new Error("Usage: verify-authorized-file.mjs --source-root <root> --mode <exists|utf8|json> --path <authorized-relative-path>");
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || values.has(key)) usage();
    values.set(key, value);
  }
  if (values.size !== 3) usage();
  return {
    sourceRoot: values.get("--source-root"),
    mode: values.get("--mode"),
    relativePath: values.get("--path")
  };
}

function fileIdentity(stats) {
  return {
    dev: stats.dev.toString(),
    ino: stats.ino.toString(),
    mode: stats.mode.toString(),
    nlink: stats.nlink.toString(),
    size: stats.size.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    ctimeNs: stats.ctimeNs.toString()
  };
}

function pathIdentity(file) {
  const lstat = fs.lstatSync(file, { bigint: true });
  if (lstat.isSymbolicLink() || !lstat.isFile()) throw new Error("Verification target must remain a non-link regular file.");
  if (lstat.nlink > 1n) throw new Error("Verification target must remain a single-link file.");
  return fileIdentity(fs.statSync(file, { bigint: true }));
}

function readIdentityBoundFile(file, expectedIdentity) {
  const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
  try {
    const before = fileIdentity(fs.fstatSync(descriptor, { bigint: true }));
    if (!isDeepStrictEqual(expectedIdentity, before)) throw new Error("Verification target identity changed before it was opened.");
    const bytes = fs.readFileSync(descriptor);
    const after = fileIdentity(fs.fstatSync(descriptor, { bigint: true }));
    if (!isDeepStrictEqual(before, after)) throw new Error("Verification target changed while it was read.");
    return { bytes, identity: after };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function verifyAuthorizedFile({ sourceRoot, mode, relativePath, hooks = {} } = {}) {
  if (!sourceRoot || !relativePath || !new Set(["exists", "utf8", "json"]).has(mode)) usage();
  const file = inspectVerificationFile(sourceRoot, relativePath);
  const expectedIdentity = pathIdentity(file);
  const { bytes, identity } = readIdentityBoundFile(file, expectedIdentity);
  hooks.afterRead?.({ file, identity });
  const current = inspectVerificationFile(sourceRoot, relativePath);
  if (current !== file || !isDeepStrictEqual(identity, pathIdentity(current))) {
    throw new Error("Verification target identity changed after it was read.");
  }
  if (mode === "utf8" || mode === "json") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (mode === "json") JSON.parse(text.replace(/^\uFEFF/u, ""));
  }
  return {
    status: "structure_verified",
    mode,
    path: relativePath,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex")
  };
}

export function main(argv = process.argv.slice(2)) {
  const evidence = verifyAuthorizedFile(parseArguments(argv));
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  return evidence;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
