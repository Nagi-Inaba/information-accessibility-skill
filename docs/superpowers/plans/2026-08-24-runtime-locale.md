# Runtime Locale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Issue #21 by making all principal human-readable runtime surfaces explicitly selectable as Japanese or English without changing machine contracts.

**Architecture:** Add one validated locale catalog and one runtime locale helper. Route the CLI wrapper, profile browser, requirement browser, exact requirement lookup, checklist, and report help through that helper; retain existing report presentation internals.

**Tech Stack:** Node.js 20+, ECMAScript modules, JSON registries, `node:test`, existing Codex/Claude distribution sync.

**Spec:** `docs/superpowers/specs/2026-08-24-runtime-locale-design.md`

## Global Constraints

- Preserve all IDs, schema keys, enum values, evidence types, claim tiers, and outcomes.
- Preserve historical defaults when `--locale` is omitted.
- Reject unsupported locale values with exit code 2 at the wrapper.
- Do not duplicate standards metadata or normative text.
- Codex and Claude files must remain byte-identical.
- Full verification is `node scripts/verify-all.mjs` on Ubuntu/Windows and Node 20/22.

---

### Task 1: Lock the runtime locale contract

**Files:**
- Test: `tests/runtime-locale.test.mjs`

**Interfaces:**
- Consumes: current CLI and registries
- Produces: failing acceptance tests for root help/errors, profiles, requirements, checklist, report, and README examples

- [x] Add tests covering explicit `ja` and `en`, stable IDs/enums, title provenance, complete checklist translation, and report locale.
- [ ] Run `node --test tests/runtime-locale.test.mjs` and confirm failures are caused by missing locale behavior.

### Task 2: Add the validated locale catalog

**Files:**
- Create: `codex/skills/information-accessibility-practice/references/runtime-locales.json`
- Create: `codex/skills/information-accessibility-practice/scripts/lib/runtime-locale.mjs`
- Mirror through distribution sync to Claude

**Interfaces:**
- Produces:
  - `normalizeRuntimeLocale(value, fallback): "ja" | "en"`
  - `runtimeLocaleFromEnvironment(fallback): "ja" | "en"`
  - `translateRuntimeText(text, locale): string`
  - `localizedProfile(profile, locale): object`
  - `localizeScreenReaderRegistry(registry, locale): object`
  - `validateRuntimeLocaleCatalog(catalog, resources): string[]`

- [ ] Define Japanese CLI string translations for every string rendered by `cli-command-registry.mjs`.
- [ ] Define Japanese profile display names, scopes, and group labels.
- [ ] Define a complete Japanese screen-reader-checklist overlay.
- [ ] Validate exact pattern/check correspondence and array lengths.
- [ ] Run the focused tests and confirm catalog validation passes.

### Task 3: Localize CLI wrapper and help

**Files:**
- Modify: `codex/.../scripts/accessibility-audit.mjs`
- Modify: `codex/.../scripts/lib/cli-command-registry.mjs`
- Mirror to Claude

**Interfaces:**
- Consumes: runtime locale helper
- Produces: global `--locale ja|en`, localized root/command help, localized wrapper errors, child locale environment

- [ ] Parse a single global `--locale` pair before dispatch.
- [ ] Render root and command help through the locale catalog.
- [ ] Translate unknown-command, mutation-boundary, required-flag, and version-argument errors.
- [ ] Pass `ACCESSIBILITY_AUDIT_LOCALE` to child commands without changing command-local flags.
- [ ] Run focused help/error tests.

### Task 4: Localize profiles and requirements

**Files:**
- Modify: `codex/.../scripts/show-profiles.mjs`
- Modify: `codex/.../scripts/browse-requirements.mjs`
- Modify: `codex/.../scripts/show-requirement.mjs`
- Mirror to Claude

**Interfaces:**
- Consumes: runtime locale helper and existing catalog relationships
- Produces: localized text/Markdown/JSON display fields and title provenance

- [ ] Add `--locale` to profiles and exact requirement lookup.
- [ ] Translate text/Markdown headings and explanatory boundaries.
- [ ] Derive Japanese WCAG titles from equivalent Japanese profile records.
- [ ] Derive English JIS titles from corresponding WCAG records; use maintained `Parsing` fallback for JIS 4.1.1.
- [ ] Add `title_locale_status` without changing canonical IDs or enums.
- [ ] Run focused profile/requirement tests.

### Task 5: Localize the screen-reader checklist and report help

**Files:**
- Modify: `codex/.../scripts/show-screen-reader-checklist.mjs`
- Modify: `codex/.../scripts/render-report.mjs`
- Mirror to Claude

**Interfaces:**
- Consumes: complete checklist overlay and existing report locale layer
- Produces: localized checklist JSON/Markdown and localized report help/errors

- [ ] Add `--locale ja|en` and environment fallback to checklist.
- [ ] Localize every checklist human-readable field while preserving IDs, evidence types, and booleans.
- [ ] Localize checklist Markdown headings and evidence boundary.
- [ ] Localize report help and common argument errors while leaving report presentation unchanged.
- [ ] Run focused checklist/report tests.

### Task 6: Document and verify

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/getting-started.md`
- Test: all repository tests

**Interfaces:**
- Produces: matching Japanese and English examples using explicit locale selection

- [ ] Add root help, requirements, checklist, and report examples to each README in the matching locale.
- [ ] Document backward-compatible defaults and stable machine-readable values.
- [ ] Run `node --test tests/runtime-locale.test.mjs`.
- [ ] Run `node scripts/verify-all.mjs`.
- [ ] Confirm Ubuntu/Windows × Node 20/22 CI.
- [ ] Review the PR for untranslated output, catalog drift, and distribution parity before merge.
