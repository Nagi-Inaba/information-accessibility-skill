# CLI Discovery, Requirements Browser, and Examples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the installed CLI self-discoverable, let users find WCAG/JIS requirements without internal IDs, and provide three reproducible example paths.

**Architecture:** Keep the standard CLI read-only and introduce one versioned command registry as the help source. Add focused scripts for profile discovery, runtime diagnosis, and requirement browsing. Examples invoke the installed deterministic runtime and write only into an explicit output directory.

**Tech Stack:** Node.js 20+, ECMAScript modules, built-in `node:test`, existing JSON catalogs and audit runtime.

**Spec:** GitHub Issues #12, #7, and #9.

## Global Constraints

- Keep Codex and Claude skill distributions byte-for-byte aligned.
- Do not add target mutation to the standard CLI.
- Keep inactive profiles out of selectable profile lists.
- Automated or AI observations remain screening evidence and never become profile outcomes automatically.
- All generated example artifacts use safe no-overwrite writers and an explicit output directory.
- Ubuntu and Windows on Node.js 20 and 22 must pass `node scripts/verify-all.mjs`.

---

### Task 1: CLI command registry and complete help

**Files:**
- Create: `codex/skills/information-accessibility-practice/scripts/lib/cli-command-registry.mjs`
- Create: `claude/skills/information-accessibility-practice/scripts/lib/cli-command-registry.mjs`
- Modify: `codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs`
- Modify: `claude/skills/information-accessibility-practice/scripts/accessibility-audit.mjs`
- Test: `tests/cli-discovery-requirements.test.mjs`

**Interfaces:**
- Produces: `commandDefinitions`, `rootHelpText()`, `commandHelpText(name)`, and `versionText(skillRoot)`.

- [ ] Write and run the failing root-help, version, init-help, and report-help tests.
- [ ] Add the command registry with complete flags, values, defaults, side-effect notes, examples, and both report interfaces.
- [ ] Refactor the wrapper to consume the registry and preserve shell-free dispatch.
- [ ] Run the focused test and full verification.

### Task 2: Profile listing and doctor

**Files:**
- Create: `codex/skills/information-accessibility-practice/scripts/show-profiles.mjs`
- Create: `claude/skills/information-accessibility-practice/scripts/show-profiles.mjs`
- Create: `codex/skills/information-accessibility-practice/scripts/doctor.mjs`
- Create: `claude/skills/information-accessibility-practice/scripts/doctor.mjs`
- Modify: both `accessibility-audit.mjs` files
- Test: `tests/cli-discovery-requirements.test.mjs`

**Interfaces:**
- Produces: `profiles list [--format text|json|markdown]` and `doctor [--format text|json]`.

- [ ] Verify tests fail because the commands are absent.
- [ ] List only active profiles with count, groups, source, and claim ceiling.
- [ ] Diagnose Node, package placement, mirrored resources, registry validity, and optional browser dependencies without treating optional absence as fatal.
- [ ] Run focused and full verification.

### Task 3: Human-facing requirements browser

**Files:**
- Create: `codex/skills/information-accessibility-practice/scripts/browse-requirements.mjs`
- Create: `claude/skills/information-accessibility-practice/scripts/browse-requirements.mjs`
- Modify: both CLI wrapper files and command registry files
- Test: `tests/cli-discovery-requirements.test.mjs`

**Interfaces:**
- Produces: `requirements list`, `requirements search <query>`, and `requirements show <id-or-success-criterion>`.
- Filters: `--profile`, `--level`, `--procedure`, `--locale`, and `--format`.

- [ ] Verify Japanese search, English search, success-criterion resolution, and filters fail before implementation.
- [ ] Build one deduplicated index from active profile records, JIS/WCAG equivalence links, and criterion-procedure availability.
- [ ] Preserve internal IDs and expose Japanese/English titles, level, profiles, sources, and related requirement IDs.
- [ ] Run focused and full verification.

### Task 4: Reproducible examples

**Files:**
- Create: `examples/README.md`
- Create: `examples/natural-language-review/README.md`
- Create: `examples/standalone-ledger/README.md`
- Create: `examples/standalone-ledger/run.mjs`
- Create: `examples/run-backed-web-audit/README.md`
- Create: `examples/run-backed-web-audit/run.mjs`
- Test: `tests/examples-e2e.test.mjs`

**Interfaces:**
- Consumes: exported assessment, validation, audit-run, merge, and report functions.
- Produces: isolated standalone, screening-only, and human-reviewed artifact directories.

- [ ] Verify example file and execution tests fail before implementation.
- [ ] Add the natural-language request and bounded sample output explanation.
- [ ] Add a standalone runner that creates a complete 55-row ledger, validates it, and renders reference guidance.
- [ ] Add a run-backed runner that creates and validates registered screening, queue, optional human-review, remediation, merge, and report artifacts.
- [ ] Keep sample content public-safe, deterministic, repository-relative, and no-overwrite.
- [ ] Run example tests and full verification.

### Task 5: Documentation and completion

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/getting-started.md`

- [ ] Link profiles, requirements, doctor, and examples from the short entry path.
- [ ] Preserve the existing bilingual structure and evidence boundaries.
- [ ] Run `node scripts/verify-all.mjs` on all four CI jobs.
- [ ] Review the final diff, make the PR ready, merge, and confirm Issues #12, #7, and #9 close.
