# Accessible HTML Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, semantic, keyboard-accessible HTML export and verify generated fixtures with structural tests, Chromium, axe-core, and NVDA.

**Architecture:** Keep validation, privacy processing, profile metadata, locale, and summary/full selection format-neutral. Add an HTML renderer over the existing `ReportPresentation`, then exercise the generated document in browser and screen-reader workflows.

**Tech Stack:** Node.js 20+, ECMAScript modules, node:test, Playwright 1.62.1, axe-core 4.13.0, Microsoft Edge, NVDA 2026.1.1.

**Spec:** `docs/superpowers/specs/2026-08-24-accessible-html-report-design.md`

## Global Constraints

- Markdown remains the default and canonical editable format.
- HTML and Markdown must use the same validated, locale-selected, visibility-processed presentation model.
- Escape every dynamic HTML text and attribute value.
- Do not add JavaScript as a dependency for core report content or navigation.
- Preserve Codex/Claude distribution parity.
- Do not claim PDF support without verified tagging and reading order.
- A successful process launch alone is not an NVDA smoke test.

---

### Task 1: Lock the HTML output contract with failing tests

**Files:**
- Create: `tests/accessible-html-report.test.mjs`

**Interfaces:**
- Consumes: `accessibility-audit report` and existing standalone/run-backed fixture builders.
- Produces: executable requirements for `--format html`, semantics, escaping, locale, detail, visibility, and appendix linking.

- [ ] Add tests for root language, title, skip link, landmarks, TOC, headings, unique IDs, captions, header scopes, visible status text, 55/56 rows, summary/full, public sanitizer parity, and injection escaping.
- [ ] Run `node --test tests/accessible-html-report.test.mjs` and verify failure is caused by the missing `--format` interface.
- [ ] Commit the RED tests.

### Task 2: Implement the format-neutral HTML renderer

**Files:**
- Create: `codex/skills/information-accessibility-practice/scripts/lib/report-html.mjs`
- Mirror: `claude/skills/information-accessibility-practice/scripts/lib/report-html.mjs`

**Interfaces:**
- Produces: `renderReportHtml(presentation, { detail, appendixHref }) -> string`.
- Consumes: the existing post-visibility `ReportPresentation`.

- [ ] Add HTML text and attribute escaping helpers.
- [ ] Render semantic header, navigation, main, sections, articles, footer, and descriptive links.
- [ ] Render named, focusable table regions with captions, column scopes, and row scopes.
- [ ] Embed responsive, forced-colors, focus-visible, reduced-motion, and print CSS.
- [ ] Render summary and full modes without changing assessment completeness.
- [ ] Run structural tests and commit the renderer.

### Task 3: Wire `--format markdown|html`

**Files:**
- Modify: `codex/skills/information-accessibility-practice/scripts/render-report.mjs`
- Mirror: `claude/skills/information-accessibility-practice/scripts/render-report.mjs`
- Modify: report help and documentation tests as needed.

**Interfaces:**
- Adds: `--format markdown|html`, default `markdown`.
- Preserves: `--detail`, `--appendix`, `--visibility`, and manifest behavior.

- [ ] Validate the format value and update help output.
- [ ] Render report and appendix in the selected format from one presentation.
- [ ] Add a descriptive full-appendix link to HTML summaries.
- [ ] Include format in machine-readable command output.
- [ ] Run CLI, no-overwrite, and parity tests; commit the integration.

### Task 4: Add Chromium, axe, keyboard, viewport, and print verification

**Files:**
- Create: `scripts/verify-generated-report-browser.mjs`
- Create or modify: `.github/workflows/report-accessibility.yml`
- Test fixtures: generated in an isolated temporary directory.

**Interfaces:**
- Produces: machine-readable browser verification results and uploaded Japanese/English HTML fixtures.

- [ ] Generate JA summary+appendix and EN full public HTML fixtures.
- [ ] Run axe-core WCAG A/AA checks and reject serious/critical violations.
- [ ] Verify first-tab skip link, focus transfer to main, TOC target existence, keyboard-reachable links and table regions.
- [ ] At 320×800, assert no page-level horizontal overflow and internal table-region scrolling.
- [ ] Emulate print media and confirm main report content remains visible in reading order.
- [ ] Upload fixtures and verification JSON; commit the workflow.

### Task 5: Add the bounded NVDA smoke workflow

**Files:**
- Create: `scripts/verify-report-nvda.ps1`
- Modify: `.github/workflows/report-accessibility.yml`

**Interfaces:**
- Consumes: generated English HTML fixture and official NVDA stable installer.
- Produces: NVDA log and machine-readable smoke record.

- [ ] Download `nvda_2026.1.1.exe` from the official stable release URL.
- [ ] Verify SHA-256 `6e0289eb5a3aa076eb97ea99c5d5465cb48b5ecc6a3257dc3d811f881a1747c9` before execution.
- [ ] Start NVDA with debug logging and open the fixture in Edge.
- [ ] Send bounded skip-link, heading, table, and link navigation keys.
- [ ] Require speech-log evidence for multiple report-specific headings or landmarks; fail when only process startup is observed.
- [ ] Upload the log and result record; commit the workflow.

### Task 6: Document support boundaries and verify the full slice

**Files:**
- Modify: `docs/reporting.md`
- Modify: `docs/getting-started.md`
- Modify: `README.md`
- Modify: `README.en.md`

**Interfaces:**
- Documents: Markdown/HTML support, accessibility verification, and unsupported PDF export.

- [ ] Add matching Japanese and English HTML command examples.
- [ ] Explain the HTML semantics and verification scope.
- [ ] State that PDF is not formally supported.
- [ ] Run focused structural tests.
- [ ] Run `node scripts/verify-all.mjs`.
- [ ] Confirm browser and NVDA workflow evidence.
- [ ] Review every Issue #61 acceptance criterion before merge.
