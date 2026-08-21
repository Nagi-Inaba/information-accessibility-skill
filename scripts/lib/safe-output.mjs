import fs from "node:fs";
import path from "node:path";

const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0);

function pathKey(value) {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function inspectExistingDirectory(directory) {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stats;
    try { stats = fs.lstatSync(current); }
    catch (error) {
      if (error.code === "ENOENT") throw new Error(`Output parent must already exist: ${current}`);
      throw error;
    }
    if (stats.isSymbolicLink()) throw new Error(`Unsafe output parent: symbolic link, junction, or reparse point at ${current}`);
    if (!stats.isDirectory()) throw new Error(`Output parent component is not a directory: ${current}`);
    const real = fs.realpathSync.native(current);
    if (pathKey(real) !== pathKey(current)) throw new Error(`Unsafe output parent traversal from ${current} to ${real}`);
  }
  return absolute;
}

export function writeNewTextFile(output, content) {
  const absolute = path.resolve(output);
  inspectExistingDirectory(path.dirname(absolute));
  let descriptor;
  try {
    descriptor = fs.openSync(absolute, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow, 0o600);
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    return absolute;
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    throw error;
  }
}
