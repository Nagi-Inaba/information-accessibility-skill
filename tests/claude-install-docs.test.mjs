import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const manifest = JSON.parse(fs.readFileSync("shared/agents/agent-manifest.json", "utf8"));
const defaults = manifest.agents.filter((agent) => agent.install_by_default).map((agent) => agent.id);

for (const readme of ["README.md", "README.en.md"]) {
  test(`${readme} installs every default Claude agent`, () => {
    const text = fs.readFileSync(readme, "utf8");
    const section = text.split(readme === "README.md" ? "Claude で使う場合:" : "For Claude:")[1];
    assert.ok(section, "Claude section is required");
    for (const id of defaults) assert.match(section, new RegExp(id));
    assert.match(section, /install_by_default/);
    assert.match(section, /local fallback/i);
  });
}
