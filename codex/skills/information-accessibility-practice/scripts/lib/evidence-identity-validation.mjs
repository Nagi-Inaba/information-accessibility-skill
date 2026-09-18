import path from "node:path";
import { isRfc3339DateTime } from "./date-time.mjs";

export const isRealUtcInstant = (value) => isRfc3339DateTime(value) && value.endsWith("Z");
export const isNonemptyText = (value) => typeof value === "string" && Boolean(value.trim());

// The serialized path has the same meaning on Windows and POSIX. This does
// not inspect a filesystem or authorize following symlinks beneath a root.
export function isSafeRelativePath(value) {
  if (!isNonemptyText(value) || value === "." || value.endsWith("/")) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /[\\:<>"|?*\u0000-\u001f\u007f]/u.test(value)) return false;
  if (path.posix.normalize(value) !== value) return false;
  return value.split("/").every((part) => part !== ".." && !/[. ]$/u.test(part)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part));
}

export function digestBytes(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new Error("bytes must be Buffer or Uint8Array");
  return bytes;
}
