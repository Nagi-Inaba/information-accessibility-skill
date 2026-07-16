import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildDistribution } from "../scripts/sync-distributions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function runNode(relativePath, args = []) {
  return spawnSync(process.execPath, [path.join(root, relativePath), ...args], {
    cwd: root,
    encoding: "utf8"
  });
}

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourceEntry = path.join(source, entry.name);
    const destinationEntry = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(sourceEntry, destinationEntry);
    else fs.copyFileSync(sourceEntry, destinationEntry);
  }
}

function fixture() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-distribution-"));
  for (const relative of [
    "shared/agents",
    "codex/agents",
    "claude/agents",
    "codex/skills/information-accessibility-practice",
    "claude/skills/information-accessibility-practice"
  ]) {
    copyTree(path.join(root, relative), path.join(target, relative));
  }
  fs.mkdirSync(path.join(target, "scripts"), { recursive: true });
  for (const script of ["sync-distributions.mjs", "verify-package.mjs"]) {
    fs.copyFileSync(path.join(root, "scripts", script), path.join(target, "scripts", script));
  }
  return target;
}

function withFixture(callback) {
  const target = fixture();
  try {
    return callback(target);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function fixtureManifest(target) {
  return JSON.parse(fs.readFileSync(path.join(target, "shared/agents/agent-manifest.json"), "utf8"));
}

function writeFixtureManifest(target, manifest) {
  fs.writeFileSync(path.join(target, "shared/agents/agent-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function parseCodexJsonStringBody(text) {
  const match = text.match(/^developer_instructions = (?<body>"(?:\\.|[^"\\])*")$/m);
  assert.ok(match?.groups?.body, "Codex instructions must use an escaped basic string");
  return JSON.parse(match.groups.body);
}

function parseClaudeFrontmatter(text) {
  const match = text.match(/^---\r?\n(?<frontmatter>[\s\S]*?)\r?\n---\r?\n\r?\n(?<body>[\s\S]*)$/);
  assert.ok(match?.groups, "Claude frontmatter must be extractable");
  const values = Object.fromEntries(match.groups.frontmatter.split(/\r?\n/u).map((line) => {
    const separator = line.indexOf(":");
    const serialized = line.slice(separator + 1).trim();
    let value;
    assert.doesNotThrow(() => { value = JSON.parse(serialized); }, `${line.slice(0, separator)} must use JSON-compatible YAML serialization`);
    return [line.slice(0, separator), value];
  }));
  return { values, body: match.groups.body.replace(/(?:\r\n|\r|\n)$/u, "") };
}

function normalizeBody(text) {
  return text.replace(/(?:\r\n|\r|\n)$/u, "").replace(/\r\n?/gu, "\n");
}

function runFixtureVerifier(target) {
  return spawnSync(process.execPath, [path.join(target, "scripts/verify-package.mjs")], {
    cwd: target,
    encoding: "utf8"
  });
}

function createLinkOrSkip(t, target, link, type) {
  try {
    fs.symlinkSync(target, link, type);
    return true;
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "UNKNOWN"].includes(error.code)) {
      t.skip(`link creation unavailable (${error.code}): ${error.message}`);
      return false;
    }
    throw error;
  }
}

test("distribution sync renders every manifest agent for Codex and Claude", () => {
  const manifest = readJson("shared/agents/agent-manifest.json");
  const check = runNode("scripts/sync-distributions.mjs", ["--check"]);
  assert.equal(check.status, 0, check.stderr || check.stdout);
  for (const agent of manifest.agents) {
    assert.equal(fs.existsSync(path.join(root, "codex/agents", `${agent.id}.toml`)), true);
    assert.equal(fs.existsSync(path.join(root, "claude/agents", `${agent.id}.md`)), true);
  }
});

test("package verification reports manifest-derived agent counts", () => {
  const manifest = readJson("shared/agents/agent-manifest.json");
  const verification = runNode("scripts/verify-package.mjs");
  assert.equal(verification.status, 0, verification.stderr || verification.stdout);
  const result = JSON.parse(verification.stdout);
  assert.equal(result.agent_count, manifest.agents.length);
  assert.equal(result.default_agent_count, manifest.agents.filter((agent) => agent.install_by_default).length);
  assert.equal(result.agents.length, manifest.agents.length);
});

test("Codex serialization round-trips every accepted reviewer body", () => {
  withFixture((target) => {
    const body = "# Edge body\nWindows C:\\Users\\Reviewer\nQuotes: \"double\", '''literal''', and \"\"\"basic\"\"\"\nControls: \u0000\u0001\b\t\f\u007f\r\n";
    fs.writeFileSync(path.join(target, "shared/agents/information-accessibility-reviewer.md"), body, "utf8");

    const written = buildDistribution(target, { write: true });
    assert.equal(written.status, "PASS", written.errors.join("\n"));
    const codex = fs.readFileSync(path.join(target, "codex/agents/information-accessibility-reviewer.toml"), "utf8");
    const parsed = parseCodexJsonStringBody(codex);
    assert.equal(normalizeBody(parsed), normalizeBody(body));
    assert.equal(codex.includes("\u0000"), false, "raw NUL must not enter TOML");
    assert.equal(codex.includes("\u007f"), false, "raw DEL must not enter TOML");
    assert.equal(codex.endsWith("\n"), true);
  });
});

test("Claude frontmatter serializes every metadata value as a string", () => {
  withFixture((target) => {
    const manifest = fixtureManifest(target);
    manifest.agents[0].description = "null\u007f";
    manifest.agents[0].claude.tools = ["null", "true", "Read\u0080"];
    manifest.agents[0].claude.model = "true";
    writeFixtureManifest(target, manifest);

    const written = buildDistribution(target, { write: true });
    assert.equal(written.status, "PASS", written.errors.join("\n"));
    const claude = fs.readFileSync(path.join(target, "claude/agents/information-accessibility-reviewer.md"), "utf8");
    const parsed = parseClaudeFrontmatter(claude);
    assert.equal(parsed.values.name, "information-accessibility-reviewer");
    assert.equal(parsed.values.description, "null\u007f");
    assert.deepEqual(parsed.values.tools, ["null", "true", "Read\u0080"]);
    assert.equal(parsed.values.model, "true");
    assert.equal(parsed.values.effort, "medium");
    assert.equal(/[\u007F-\u009F]/u.test(claude.slice(0, claude.indexOf("---", 3))), false, "raw control characters must not enter YAML frontmatter");
  });
});

test("manifest validation rejects semantic and schema failures in sync and verification", async (t) => {
  const cases = [
    {
      name: "empty agents",
      expected: /at least 1 item/u,
      mutate(target, manifest) { manifest.agents = []; writeFixtureManifest(target, manifest); }
    },
    {
      name: "duplicate agent IDs",
      expected: /Duplicate agent id/u,
      mutate(target, manifest) { manifest.agents.push(structuredClone(manifest.agents[0])); writeFixtureManifest(target, manifest); }
    },
    {
      name: "duplicate body files",
      expected: /Duplicate agent body file/u,
      mutate(target, manifest) {
        const duplicate = structuredClone(manifest.agents[0]);
        duplicate.id = "information-accessibility-secondary";
        manifest.agents.push(duplicate);
        writeFixtureManifest(target, manifest);
      }
    },
    {
      name: "missing body",
      expected: /Missing agent body/u,
      mutate(target, manifest) { fs.rmSync(path.join(target, "shared/agents", manifest.agents[0].body_file)); }
    },
    {
      name: "unsafe output name",
      expected: /does not match|Unsafe/u,
      mutate(target, manifest) { manifest.agents[0].id = "../escape"; writeFixtureManifest(target, manifest); }
    },
    {
      name: "invalid manifest schema",
      expected: /Invalid manifest schema/u,
      mutate(target) { fs.writeFileSync(path.join(target, "shared/agents/agent-manifest.schema.json"), "{}\n", "utf8"); }
    }
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => withFixture((target) => {
      entry.mutate(target, fixtureManifest(target));
      const sync = buildDistribution(target, { write: false });
      assert.equal(sync.status, "FAIL");
      assert.match(sync.errors.join("\n"), entry.expected);

      const verification = runFixtureVerifier(target);
      assert.notEqual(verification.status, 0, verification.stderr || verification.stdout);
      const result = JSON.parse(verification.stdout);
      assert.equal(result.status, "FAIL");
      assert.match(result.errors.join("\n"), entry.expected);
    }));
  }
});

test("Windows reserved device basenames are rejected case-insensitively", () => {
  for (const reserved of ["con", "PRN", "aux", "NUL", "clock$", "com1", "COM9", "lpt1", "LPT9"]) {
    withFixture((target) => {
      const manifest = fixtureManifest(target);
      manifest.agents[0].id = reserved.toLowerCase();
      manifest.agents[0].body_file = `${reserved}.md`;
      fs.writeFileSync(path.join(target, "shared/agents", `${reserved}.md`), "reserved\n", "utf8");
      writeFixtureManifest(target, manifest);
      const result = buildDistribution(target, { write: true });
      assert.equal(result.status, "FAIL", reserved);
      assert.match(result.errors.join("\n"), /reserved Windows device name/iu, reserved);
    });
  }
});

test("validation errors prevent every generated write", () => {
  withFixture((target) => {
    const generated = path.join(target, "codex/agents/information-accessibility-reviewer.toml");
    fs.writeFileSync(generated, "DO NOT REPLACE\n", "utf8");
    const manifest = fixtureManifest(target);
    manifest.agents = [];
    writeFixtureManifest(target, manifest);

    const result = buildDistribution(target, { write: true });
    assert.equal(result.status, "FAIL");
    assert.equal(fs.readFileSync(generated, "utf8"), "DO NOT REPLACE\n");
    assert.deepEqual(result.changed, []);
  });
});

test("undeclared agent files fail without modifying declared outputs", () => {
  withFixture((target) => {
    const generated = path.join(target, "codex/agents/information-accessibility-reviewer.toml");
    const before = fs.readFileSync(generated);
    fs.writeFileSync(path.join(target, "codex/agents/information-accessibility-rogue.toml"), "rogue\n", "utf8");

    const result = buildDistribution(target, { write: true });
    assert.equal(result.status, "FAIL");
    assert.match(result.errors.join("\n"), /Undeclared generated agent file/u);
    assert.equal(fs.readFileSync(generated).equals(before), true);
  });
});

test("rendering preserves source line endings and always adds a final newline", () => {
  withFixture((target) => {
    const body = "first\r\nsecond";
    fs.writeFileSync(path.join(target, "shared/agents/information-accessibility-reviewer.md"), body, "utf8");
    const result = buildDistribution(target, { write: true });
    assert.equal(result.status, "PASS", result.errors.join("\n"));

    for (const relative of [
      "codex/agents/information-accessibility-reviewer.toml",
      "claude/agents/information-accessibility-reviewer.md"
    ]) {
      const rendered = fs.readFileSync(path.join(target, relative), "utf8");
      assert.equal(rendered.endsWith("\r\n"), true, relative);
      assert.equal(rendered.replace(/\r\n/gu, "").includes("\n"), false, relative);
    }
  });
});

test("checkout line-ending conversion does not make escaped Codex bodies stale", () => {
  withFixture((target) => {
    const bodyFile = path.join(target, "shared/agents/information-accessibility-reviewer.md");
    const codexFile = path.join(target, "codex/agents/information-accessibility-reviewer.toml");
    const claudeFile = path.join(target, "claude/agents/information-accessibility-reviewer.md");
    for (const file of [bodyFile, codexFile, claudeFile]) {
      const crlf = fs.readFileSync(file, "utf8").replace(/\r?\n/gu, "\r\n");
      fs.writeFileSync(file, crlf, "utf8");
    }

    const result = buildDistribution(target, { write: false });
    assert.equal(result.status, "PASS", result.errors.join("\n"));
    assert.deepEqual(result.changed, []);
    assert.equal(result.agents[0].bodies_equal, true);
  });
});

test("stale skill mirrors are repaired once and subsequent writes are idempotent", () => {
  withFixture((target) => {
    const relative = "claude/skills/information-accessibility-practice/SKILL.md";
    fs.appendFileSync(path.join(target, relative), "STALE\n", "utf8");

    const stale = buildDistribution(target, { write: false });
    assert.equal(stale.status, "FAIL");
    assert.equal(stale.changed.includes(relative), true);

    const repaired = buildDistribution(target, { write: true });
    assert.equal(repaired.status, "PASS", repaired.errors.join("\n"));
    assert.equal(repaired.changed.includes(relative), true);

    const firstCheck = buildDistribution(target, { write: false });
    const secondWrite = buildDistribution(target, { write: true });
    assert.equal(firstCheck.status, "PASS", firstCheck.errors.join("\n"));
    assert.deepEqual(firstCheck.changed, []);
    assert.equal(secondWrite.status, "PASS", secondWrite.errors.join("\n"));
    assert.deepEqual(secondWrite.changed, []);
  });
});

function assertFileSymlinkRejected(t, kind) {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "a11y-distribution-outside-"));
  try {
    withFixture((target) => {
      const outsideFile = path.join(outside, `${kind.replace(" ", "-")}.txt`);
      fs.writeFileSync(outsideFile, "OUTSIDE\n", "utf8");
      const linked = kind === "agent target"
        ? path.join(target, "codex/agents/information-accessibility-reviewer.toml")
        : path.join(target, "shared/agents/information-accessibility-reviewer.md");
      fs.rmSync(linked);
      if (!createLinkOrSkip(t, outsideFile, linked, "file")) return;

      const result = buildDistribution(target, { write: true });
      assert.equal(result.status, "FAIL", kind);
      assert.match(result.errors.join("\n"), /symbolic link|reparse/iu, kind);
      assert.equal(fs.readFileSync(outsideFile, "utf8"), "OUTSIDE\n", kind);
      fs.unlinkSync(linked);
    });
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

test("agent targets cannot be redirected through file symlinks", (t) => {
  assertFileSymlinkRejected(t, "agent target");
});

test("body sources cannot be redirected through file symlinks", (t) => {
  assertFileSymlinkRejected(t, "body source");
});

test("agent directories and skill trees cannot be redirected through junctions", (t) => {
  const linkType = process.platform === "win32" ? "junction" : "dir";
  const scenarios = [
    "shared/agents",
    "codex/agents",
    "claude/agents",
    "codex/skills/information-accessibility-practice",
    "claude/skills/information-accessibility-practice"
  ];
  for (const [index, relative] of scenarios.entries()) {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), `a11y-distribution-junction-${index}-`));
    try {
      withFixture((target) => {
        const linked = path.join(target, relative);
        fs.rmSync(linked, { recursive: true, force: true });
        if (!createLinkOrSkip(t, outside, linked, linkType)) return;
        const result = buildDistribution(target, { write: true });
        assert.equal(result.status, "FAIL", relative);
        assert.match(result.errors.join("\n"), /symbolic link|reparse/iu, relative);
        assert.deepEqual(fs.readdirSync(outside), [], relative);
        fs.unlinkSync(linked);
      });
      if (t.skipped) return;
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  }
});
