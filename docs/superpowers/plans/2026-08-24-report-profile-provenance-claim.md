# Report Profile, Provenance, Locale, and Claim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render standalone and run-backed Markdown reports from one profile-aware, provenance-explicit, locale-aware presentation model with guarded claim wording.

**Architecture:** Keep the existing direct `render-audit-report.mjs` behavior byte-compatible, copy its trusted validation and sanitizer implementation to `legacy-report-core.mjs`, and add a pure presentation-model module plus a new supported report CLI. The canonical `accessibility-audit report` path validates inputs through the current validators, builds the existing sanitized run-backed public model before enrichment, and renders localized Markdown.

**Tech Stack:** Node.js 20+, ECMAScript modules, `node:test`, JSON registries/catalogs, existing immutable audit-run runtime.

**Spec:** `docs/superpowers/specs/2026-08-24-report-profile-provenance-claim-design.md`

## Global Constraints

- Do not add target mutation to the standard CLI.
- Do not promote automated or AI screening to `human_verified` or a machine-readable profile outcome.
- Use only registered claim templates from `standards-registry.json`.
- Keep internal IDs, schema keys, and enum values locale-independent.
- Preserve no-overwrite and stable-input checks.
- Keep the legacy direct renderer behavior unchanged for existing callers.
- Keep Codex and Claude distributions byte-identical.
- Support Ubuntu and Windows with Node.js 20 and 22.

---

### Task 1: Failing report presentation tests

**Files:**
- Create: `tests/report-profile-provenance-claim.test.mjs`
- Test: `tests/examples-e2e.test.mjs`
- Test: `tests/unified-cli.test.mjs`

**Interfaces:**
- Consumes: current `generateAssessment()`, `validateAssessment()`, and the runnable run-backed fixtures.
- Produces: executable expectations for profile titles, group counts, row provenance, locale, claim sections, full-human provenance, and Markdown hardening.

- [x] **Step 1: Add tests for Japanese and English profile titles**

Assert that `web-modern` uses WCAG 2.2 A/AA wording and `jp-public-web` uses separate JIS and additional-WCAG group headings.

- [x] **Step 2: Add tests for row metadata and provenance**

Assert that each row contains criterion number, localized title, level, group, primary URL, source kind, evidence level, and rationale. Include human-reviewed, screening-only, and not-run rows.

- [x] **Step 3: Add tests for the claim section**

Assert requested tier, maximum tier, fixed registry wording, coverage, limiting reasons, and the formal-conformance boundary.

- [x] **Step 4: Add complete-human and injection fixtures**

Create a synthetic 55-row human-review fixture that retains human provenance without claiming certification. Add assessment prose containing HTML and Markdown heading injection and require escaped output.

- [x] **Step 5: Run the focused test in RED**

Run: `node --test tests/report-profile-provenance-claim.test.mjs`

Expected and observed: FAIL because the new report CLI and presentation model did not exist.

### Task 2: Trusted legacy copy and pure presentation model

**Files:**
- Create: `codex/skills/information-accessibility-practice/scripts/legacy-report-core.mjs`
- Create: `codex/skills/information-accessibility-practice/scripts/lib/report-locale.mjs`
- Create: `codex/skills/information-accessibility-practice/scripts/lib/report-presentation.mjs`
- Preserve unchanged: `codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs`
- Test: `tests/report-profile-provenance-claim.test.mjs`
- Test: existing direct-renderer regression suites

**Interfaces:**
- Consumes: trusted legacy exports, standards registry, criteria catalog, validation guard, and the already-sanitized run-backed public model.
- Produces:
  - `buildStandalonePresentation({ record, validation, registry, catalog, locale })`
  - `buildRunBackedPresentation({ run, assessment, validation, publicModel, registry, catalog, locale })`
  - `renderReportMarkdown(presentation)`

- [x] **Step 1: Copy the current renderer blob to `legacy-report-core.mjs`**

Use the current blob unchanged so the new CLI can reuse the existing run-backed binding validation and privacy sanitizer.

- [x] **Step 2: Keep the original direct renderer byte-compatible**

Do not replace or wrap `render-audit-report.mjs`. Existing imports, direct CLI behavior, headings, safety checks, and downstream callers remain unchanged.

- [x] **Step 3: Add a closed locale catalog**

Define `ja` and `en` labels for titles, headings, outcomes, provenance, claim tiers, evidence notes, group labels, and the JIS 4.1.1 note. Reject unsupported locales.

- [x] **Step 4: Build criterion metadata lookup**

Join profile requirement IDs to catalog records and registry report groups. Select localized titles with an explicit fallback rule and retain primary URLs.

- [x] **Step 5: Build standalone row provenance**

Map `human_verified` to `human_review` and every remaining profile row to `not_run`; do not interpret screening-check rows as profile outcomes.

- [x] **Step 6: Build run-backed row provenance**

Use sanitized `recordedHumanChecks` and `screeningCandidates` from the existing public model. Human review wins over screening; otherwise map an exact registered screening projection; otherwise emit `not_run`.

- [x] **Step 7: Compute group and aggregate counts from rendered rows**

Counts are derived from the same rows shown in the table, preventing aggregate/provenance drift.

- [x] **Step 8: Build the guarded claim section**

Read requested and maximum tiers, choose only a registry-fixed localized template, and derive deterministic limiting reasons from guard blockers and coverage.

- [x] **Step 9: Render and harden Markdown**

Render profile title, provenance legend, claim section, group summaries, full criterion tables, JIS note, findings/remediation, scope, environment, and limitations. Escape HTML, table delimiters, line breaks, and injected heading markers.

### Task 3: Supported report CLI and command registry

**Files:**
- Create: `codex/skills/information-accessibility-practice/scripts/render-report.mjs`
- Modify: `codex/skills/information-accessibility-practice/scripts/lib/cli-command-registry.mjs`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/getting-started.md`
- Test: `tests/unified-cli.test.mjs`
- Test: `tests/readme-entrypoint.test.mjs`
- Test: `tests/assessment-output-contract.test.mjs`

**Interfaces:**
- Consumes: presentation builders and legacy validation/public-model functions.
- Produces: `accessibility-audit report ... --locale ja|en` for both standalone and run-backed inputs.

- [x] **Step 1: Parse the report interfaces**

Accept exactly one of `--input` or `--run`/`--assessment`, require run-backed output, accept `--locale ja|en`, and preserve no-overwrite behavior.

- [x] **Step 2: Implement standalone rendering**

Load references, validate assessment, build standalone presentation, and write or print Markdown.

- [x] **Step 3: Implement run-backed rendering**

Perform stable reads, current-run validation, assessment validation, legacy run-backed binding validation, sanitized public-model construction, presentation enrichment, and stable-input checks before writing.

- [x] **Step 4: Route only the unified CLI**

Change the report command target in the command registry to `render-report.mjs`. Keep the legacy direct renderer unchanged and keep all non-report commands unchanged.

- [x] **Step 5: Update public examples**

Use the unified assessment/report commands and show matching Japanese/English locale examples. Preserve explicit record-mode versus template-mode guidance.

- [x] **Step 6: Run focused CLI and documentation tests**

Run: `node --test tests/report-profile-provenance-claim.test.mjs tests/unified-cli.test.mjs tests/readme-entrypoint.test.mjs tests/assessment-output-contract.test.mjs`

Expected: PASS.

### Task 4: Distribution parity and full verification

**Files:**
- Mirror new runtime files into the Claude distribution
- Test: `tests/report-profile-provenance-claim.test.mjs`
- Test: all existing repository test files through `scripts/verify-all.mjs`

**Interfaces:**
- Consumes: final report CLI.
- Produces: deterministic runtime-generated Japanese and English fixtures, cross-distribution parity, and four-platform CI evidence.

- [x] **Step 1: Verify four report variants through runtime fixtures**

Generate and inspect Web-modern Japanese/English and JP-public-Web Japanese/English reports. Check headings, group counts, row sources, claim wording, primary links, and JIS 4.1.1 text.

- [x] **Step 2: Verify no-human, partial-human, and all-human provenance**

Use runnable run-backed fixtures plus a synthetic complete-human standalone fixture. Require exact row counts and evidence-source labels without certification wording.

- [x] **Step 3: Verify locale and machine-contract stability**

Japanese/English output changes only human-readable text; JSON IDs, schema keys, and enum values remain unchanged.

- [x] **Step 4: Synchronize distributions**

Mirror `legacy-report-core.mjs`, `render-report.mjs`, `report-locale.mjs`, `report-presentation.mjs`, and the command registry into both Codex and Claude distributions. Package parity verification must remain green.

- [ ] **Step 5: Run final full verification on the exact merge head**

Run: `node scripts/verify-all.mjs`

Expected: `status: PASS` and zero failing test files on Ubuntu/Windows with Node.js 20/22.

- [ ] **Step 6: Review the complete diff and merge**

Confirm no target mutation, no AI-to-human promotion, no free-form stronger claim, no internal run metadata in public output, no overwrite regression, and unchanged legacy direct-renderer behavior. Merge only after four-platform CI succeeds.
