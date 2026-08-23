# Claude Default-Agent Installer Implementation Plan

> **For Codex:** Execute this plan test-first. Confirm the focused test fails before adding the installer, then run the complete repository verification before merge.

**Goal:** Make the documented Claude installation reproduce the manifest-defined default multi-agent configuration instead of silently installing only the reviewer.

**Architecture:** Add a cross-platform Node.js installer that reads `shared/agents/agent-manifest.json`, copies the Claude skill and every `install_by_default` Claude agent, and refuses existing destination conflicts before writing anything. Keep an explicit `--reviewer-only` mode only for Claude hosts that cannot dispatch specialists. Derive tests and installed agent selection from the manifest so future default-agent changes cannot silently diverge.

**Tech stack:** Node.js ESM, `fs.cpSync`, `node:test`, existing Codex/Claude distributions and manifest.

---

## Task 1: Define failing installation and documentation tests

**Files:**
- Create: `tests/install-claude.test.mjs`

1. Verify dry-run selects every manifest default without creating `CLAUDE_HOME`.
2. Verify a clean install copies the full Claude skill and all default agents byte-for-byte.
3. Run an installed-skill assessment generation and validation smoke test from a neutral directory.
4. Verify `--reviewer-only` installs only the reviewer and explicitly reports local fallback mode.
5. Verify any existing managed destination causes a preflight failure before other files are written.
6. Verify both README languages list every current manifest default in the Claude section, document the installer, and constrain reviewer-only fallback to hosts without specialist dispatch.
7. Open a draft PR and confirm the focused test fails because the installer and corrected documentation do not yet exist.

## Task 2: Implement the manifest-driven installer

**Files:**
- Create: `scripts/install-claude.mjs`

1. Resolve Claude home from `--claude-home`, `CLAUDE_HOME`, or `~/.claude`.
2. Read and validate unique agent IDs/body files from the shared manifest.
3. Select all `install_by_default` agents by default; select only the default reviewer with `--reviewer-only`.
4. Validate all sources and all destination conflicts before mutation.
5. Support `--dry-run` and stable JSON output for inspection and automation.
6. Copy through a temporary staging directory and remove only paths created by the current invocation if activation fails.
7. Never install the opt-in authorized fixer through this command.

## Task 3: Correct the Japanese and English installation guidance

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`

1. Replace reviewer-only Claude instructions with the installer commands and manifest-defined default list.
2. Explain destination resolution and non-overwrite behavior.
3. Explain the multi-agent role separation and identical artifact contracts.
4. Document `--reviewer-only` only as a fallback for hosts without specialist dispatch and state what isolation is lost.
5. Add the installer and test to the package/verification listings where applicable.

## Task 4: Verify, review, and merge

1. Confirm `tests/install-claude.test.mjs` passes on Ubuntu and Windows with Node.js 20 and 22.
2. Confirm `node scripts/verify-all.mjs` passes, including Codex/Claude package parity.
3. Review the final diff against every acceptance criterion in Issue #52.
4. Merge with squash after all four CI jobs pass, close Issue #52, and update backlog Issue #144.
