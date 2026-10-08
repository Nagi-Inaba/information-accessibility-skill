import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptsRoot = path.join(root, "shared/skill/scripts");

// Static relative imports and re-exports only. Dynamic import() is intentionally ignored.
const importPattern = /(?:^|\n)[ \t]*(?:import\s+(?:[\w\s{},*$]+?\s+from\s+)?|export\s+(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s+)["']([^"']+)["']/gu;

function moduleFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return moduleFiles(full);
    return entry.name.endsWith(".mjs") ? [full] : [];
  });
}

function relativeImports(file) {
  const text = fs.readFileSync(file, "utf8");
  const targets = new Set();
  for (const match of text.matchAll(importPattern)) {
    if (match[1].startsWith(".")) targets.add(path.resolve(path.dirname(file), match[1]));
  }
  return [...targets];
}

const label = (file) => path.relative(scriptsRoot, file).replaceAll("\\", "/");
const graph = new Map(moduleFiles(scriptsRoot).map((file) => [file, relativeImports(file)]));

function cycles() {
  let counter = 0;
  const stack = [];
  const onStack = new Set();
  const index = new Map();
  const low = new Map();
  const found = [];
  function visit(node) {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue;
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node), low.get(next)));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node), index.get(next)));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      if (component.length > 1 || graph.get(node).includes(node)) found.push(component.map(label).sort());
    }
  }
  for (const node of graph.keys()) if (!index.has(node)) visit(node);
  return found;
}

test("the skill runtime has no static import cycles", () => {
  assert.ok(graph.size > 50, "the module scan should cover the whole runtime");
  assert.deepEqual(cycles(), []);
});

// The network guard, the safe file layer and the public-report sanitizer must stay below the audit control plane
// and the CLI scripts, so a low-level helper can never pull in the code that depends on it.
const leafImports = new Map([
  ["lib/text-order.mjs", []],
  ["lib/network-address.mjs", []],
  ["lib/inspection-endpoint.mjs", ["lib/network-address.mjs"]],
  ["lib/canonical-json.mjs", []],
  ["lib/safe-file-io.mjs", ["lib/canonical-json.mjs"]],
  ["lib/report-judgement.mjs", []],
  ["lib/public-report-sanitizer.mjs", ["lib/network-address.mjs"]]
]);

for (const [leaf, allowed] of leafImports) {
  test(`${leaf} stays a leaf module`, () => {
    const actual = (graph.get(path.join(scriptsRoot, leaf)) ?? []).map(label).sort();
    assert.deepEqual(actual, [...allowed].sort());
  });
}
