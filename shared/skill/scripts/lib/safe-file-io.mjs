import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { canonicalJson } from "./canonical-json.mjs";

const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0);

export function pathKey(value) {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isWithinPath(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

export function hasTraversal(value) {
  return String(value).split(/[\\/]+/u).includes("..");
}

export function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function statIdentity(stats) {
  return {
    dev: stats.dev.toString(),
    ino: stats.ino.toString(),
    size: stats.size.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    ctimeNs: stats.ctimeNs.toString()
  };
}

function directoryIdentity(stats) {
  return { dev: stats.dev.toString(), ino: stats.ino.toString() };
}

function sameIdentity(left, right) {
  return isDeepStrictEqual(left, right);
}

export function inspectRealComponents(target, { type, label = "path" } = {}) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stats;
    try {
      stats = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`Missing ${label}: ${current}`);
      throw error;
    }
    if (stats.isSymbolicLink()) throw new Error(`Unsafe ${label}: symbolic link, junction, or reparse point at ${current}`);
    const real = fs.realpathSync.native(current);
    if (pathKey(real) !== pathKey(current)) throw new Error(`Unsafe ${label}: reparse traversal from ${current} to ${real}`);
  }
  const stats = fs.lstatSync(absolute);
  if (type === "file" && !stats.isFile()) throw new Error(`Expected artifact file for ${label}: ${absolute}`);
  if (type === "directory" && !stats.isDirectory()) throw new Error(`Expected directory for ${label}: ${absolute}`);
  return { absolute, stats };
}

export function prepareSafeOutputDirectory(directory) {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    const next = path.join(current, part);
    try {
      const stats = fs.lstatSync(next);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`Unsafe output directory component: ${next}`);
      }
      const real = fs.realpathSync.native(next);
      if (pathKey(real) !== pathKey(next)) {
        throw new Error(`Unsafe output directory reparse traversal from ${next} to ${real}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      try {
        fs.mkdirSync(next, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError.code !== "EEXIST") throw mkdirError;
      }
      inspectRealComponents(next, { type: "directory", label: "output directory" });
    }
    current = next;
  }
  return absolute;
}

function inspectSafeOutput(output) {
  const absolute = path.resolve(output);
  try {
    fs.lstatSync(absolute);
    throw new Error(`Refusing to overwrite existing file: ${absolute}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const parentPath = prepareSafeOutputDirectory(path.dirname(absolute));
  const parent = inspectRealComponents(parentPath, { type: "directory", label: "output parent" });
  return { absolute, parentIdentity: directoryIdentity(fs.statSync(parent.absolute, { bigint: true })) };
}

export function assertNewOutputPath(output) {
  return inspectSafeOutput(output).absolute;
}

function removeCreatedOutput(inspected, createdIdentity) {
  if (!createdIdentity) return;
  const parentIdentity = directoryIdentity(fs.statSync(path.dirname(inspected.absolute), { bigint: true }));
  if (!sameIdentity(inspected.parentIdentity, parentIdentity)) throw new Error(`Output parent identity changed; refusing unsafe cleanup: ${path.dirname(inspected.absolute)}`);
  const stats = fs.lstatSync(inspected.absolute);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`Output identity changed; refusing unsafe cleanup: ${inspected.absolute}`);
  const currentIdentity = directoryIdentity(fs.statSync(inspected.absolute, { bigint: true }));
  if (!sameIdentity(createdIdentity, currentIdentity)) throw new Error(`Output file identity changed; refusing unsafe cleanup: ${inspected.absolute}`);
  fs.unlinkSync(inspected.absolute);
}

function writeNewContent(output, content, hooks = {}) {
  const inspected = inspectSafeOutput(output);
  let descriptor;
  let createdIdentity;
  let writtenIdentity;
  try {
    descriptor = fs.openSync(inspected.absolute, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow, 0o600);
    const openedStats = fs.fstatSync(descriptor, { bigint: true });
    createdIdentity = directoryIdentity(openedStats);
    writtenIdentity = statIdentity(openedStats);
    const currentParent = directoryIdentity(fs.statSync(path.dirname(inspected.absolute), { bigint: true }));
    if (!sameIdentity(inspected.parentIdentity, currentParent)) throw new Error(`Unsafe output parent changed before write: ${path.dirname(inspected.absolute)}`);
    hooks.beforeWrite?.(inspected.absolute);
    fs.writeFileSync(descriptor, content, "utf8");
    writtenIdentity = statIdentity(fs.fstatSync(descriptor, { bigint: true }));
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    hooks.afterClose?.(inspected.absolute);
    inspectRealComponents(inspected.absolute, { type: "file", label: "output file" });
    const currentIdentity = statIdentity(fs.statSync(inspected.absolute, { bigint: true }));
    if (!sameIdentity(writtenIdentity, currentIdentity)) throw new Error(`Output file identity changed after close: ${inspected.absolute}`);
    const finalParent = directoryIdentity(fs.statSync(path.dirname(inspected.absolute), { bigint: true }));
    if (!sameIdentity(inspected.parentIdentity, finalParent)) throw new Error(`Unsafe output parent changed during write: ${path.dirname(inspected.absolute)}`);
    return inspected.absolute;
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      removeCreatedOutput(inspected, createdIdentity);
    } catch (cleanupError) {
      throw new Error(`${error.message}; output cleanup failed: ${cleanupError.message}`);
    }
    throw error;
  }
}

export function writeNewJson(output, value, hooks = {}) {
  return writeNewContent(output, canonicalJson(value), hooks);
}

export function writeNewText(output, value, hooks = {}) {
  if (typeof value !== "string") throw new Error("Text output must be a string.");
  return writeNewContent(output, value, hooks);
}

export function writeNewBytes(output, value, hooks = {}) {
  if (!Buffer.isBuffer(value)) throw new Error("Binary output must be a Buffer.");
  return writeNewContent(output, value, hooks);
}

export function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

export function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${error.message}`);
  }
}

export function readStableFile(file, { label = "input file", maxBytes = Infinity } = {}) {
  if (maxBytes !== Infinity && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) throw new Error("maxBytes must be a positive safe integer.");
  const inspected = inspectRealComponents(file, { type: "file", label });
  const descriptor = fs.openSync(inspected.absolute, fs.constants.O_RDONLY | noFollow);
  try {
    const before = statIdentity(fs.fstatSync(descriptor, { bigint: true }));
    let bytes;
    if (maxBytes === Infinity) bytes = fs.readFileSync(descriptor);
    else {
      if (BigInt(before.size) > BigInt(maxBytes)) throw new Error(`${label} exceeds the ${maxBytes}-byte limit.`);
      const chunks = [];
      let total = 0;
      while (true) {
        const chunk = Buffer.alloc(Math.min(65536, maxBytes + 1 - total));
        const count = fs.readSync(descriptor, chunk, 0, chunk.length, null);
        if (!count) break;
        total += count;
        if (total > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte limit.`);
        chunks.push(chunk.subarray(0, count));
      }
      bytes = Buffer.concat(chunks, total);
    }
    const after = statIdentity(fs.fstatSync(descriptor, { bigint: true }));
    if (!sameIdentity(before, after)) throw new Error(`${label} changed while it was read: ${inspected.absolute}`);
    return { path: inspected.absolute, bytes, sha256: sha256Bytes(bytes), identity: after, ...(maxBytes === Infinity ? {} : { maxBytes }) };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function assertStableFile(snapshot, label = "input file") {
  const current = readStableFile(snapshot.path, { label, maxBytes: snapshot.maxBytes });
  if (!sameIdentity(snapshot.identity, current.identity) || snapshot.sha256 !== current.sha256 || !snapshot.bytes.equals(current.bytes)) {
    throw new Error(`${label} changed before commit: ${snapshot.path}`);
  }
  return current;
}

export function resolveInside(root, candidate) {
  if (hasTraversal(candidate)) throw new Error(`Artifact path contains traversal: ${candidate}`);
  const safeRoot = inspectRealComponents(root, { type: "directory", label: "artifact root" }).absolute;
  const resolved = path.resolve(candidate);
  if (pathKey(resolved) === pathKey(safeRoot)) throw new Error(`Artifact path names the artifact root itself: ${candidate}`);
  const inspected = inspectRealComponents(resolved, { type: "file", label: "artifact path" });
  const canonicalRoot = fs.realpathSync.native(safeRoot);
  const canonicalCandidate = fs.realpathSync.native(inspected.absolute);
  if (!isInside(canonicalRoot, canonicalCandidate)) throw new Error(`Artifact path is outside the declared root: ${candidate}`);
  return canonicalCandidate;
}
