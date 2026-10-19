import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", shell: false })
    .split("\0")
    .filter(Boolean);
}

function localLinks(markdown) {
  const links = [];
  let inFence = false;
  for (const [index, line] of markdown.split(/\r?\n/u).entries()) {
    if (line.startsWith("```")) inFence = !inFence;
    if (inFence) continue;
    for (const match of line.matchAll(/\[[^\]]+\]\((?<target>[^)]+)\)/gu)) {
      const target = match.groups.target.trim();
      if (/^(?:https?:|mailto:|#)/iu.test(target)) continue;
      links.push({ line: index + 1, target });
    }
  }
  return links;
}

function targetExists(target, file, tracked) {
  const clean = target.split("#", 1)[0].split("?", 1)[0];
  if (!clean) return true;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), clean));
  return tracked.has(resolved) || [...tracked].some((entry) => entry.startsWith(`${resolved}/`));
}

test("every relative Markdown link in tracked files resolves", (t) => {
  let tracked;
  try {
    tracked = new Set(trackedFiles());
  } catch (error) {
    t.skip(`git unavailable or not a work tree: ${error.message}`);
    return;
  }

  const broken = [];
  for (const file of [...tracked].filter((entry) => entry.endsWith(".md"))) {
    const markdown = fs.readFileSync(path.join(root, file), "utf8");
    for (const { line, target } of localLinks(markdown)) {
      if (!targetExists(target, file, tracked)) broken.push(`${file}:${line} -> ${target}`);
    }
  }
  assert.deepEqual(broken, [], `broken relative Markdown links:\n${broken.join("\n")}`);
});
