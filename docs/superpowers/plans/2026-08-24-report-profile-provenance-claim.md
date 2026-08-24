# Report Profile, Provenance, Locale, and Claim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render standalone and run-backed Markdown reports from one profile-aware, provenance-explicit, locale-aware presentation model with guarded claim wording.

**Architecture:** Preserve the existing report core as a compatibility library, then add a pure presentation-model module and a new supported report CLI. The public report command validates inputs through the current validators, retains the existing run-backed sanitizer, enriches rows from registry/catalog metadata, and renders localized Markdown.

**Tech Stack:** Node.js 20+, ECMAScript modules, `node:test`, JSON registries/catalogs, existing immutable audit-run runtime.

**Spec:** `docs/superpowers/specs/2026-08-24-report-profile-provenance-claim-design.md`

## Global Constraints

- Do not add target mutation to the standard CLI.
- Do not promote automated or AI screening to `human_verified` or a machine-readable profile outcome.
- Use only registered claim templates from `standards-registry.json`.
- Keep internal IDs, schema keys, and enum values locale-independent.
- Preserve no-overwrite and stable-input checks.
- Keep Codex and Claude distributions byte-identical.
- Support Ubuntu and Windows with Node.js 20 and 22.

---

### Task 1: Failing report presentation tests

**Files:**
- Create: `tests/report-profile-provenance-claim.test.mjs`
- Create: `tests/fixtures/report-profile/standalone-web-modern.json`
- Create: `tests/fixtures/report-profile/standalone-jp-public-web.json`
- Test: `tests/audit-report.test.mjs`

**Interfaces:**
- Consumes: current `generateAssessment()`, `validateAssessment()`, and run-backed fixtures.
- Produces: executable expectations for profile titles, group counts, row provenance, locale, and claim sections.

- [ ] **Step 1: Add tests for Japanese and English profile titles**

Assert that `web-modern` uses WCAG 2.2 A/AA wording and `jp-public-web` uses separate JIS and additional-WCAG group headings.

- [ ] **Step 2: Add tests for row metadata and provenance**

Assert that each row contains criterion number, localized title, level, group, primary URL, source kind, evidence level, and rationale. Include human-reviewed, screening-only, and not-run rows.

- [ ] **Step 3: Add tests for the claim section**

Assert requested tier, maximum tier, fixed registry wording, coverage, limiting reasons, and the formal-conformance boundary.

- [ ] **Step 4: Run the focused test in RED**

Run: `node --test tests/report-profile-provenance-claim.test.mjs`

Expected: FAIL because the new report CLI and presentation model do not exist.

- [ ] **Step 5: Commit the RED tests**

Commit message: `test: define profile-aware report presentation`

### Task 2: Compatibility split and pure presentation model

**Files:**
- Create: `codex/skills/information-accessibility-practice/scripts/legacy-report-core.mjs`
- Create: `codex/skills/information-accessibility-practice/scripts/lib/report-locale.mjs`
- Create: `codex/skills/information-accessibility-practice/scripts/lib/report-presentation.mjs`
- Modify: `codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs`
- Test: `tests/report-profile-provenance-claim.test.mjs`

**Interfaces:**
- Consumes: legacy exports, standards registry, criteria catalog, validation guard, and optional sanitized run-backed model.
- Produces:
  - `buildStandalonePresentation({ record, validation, registry, catalog, locale })`
  - `buildRunBackedPresentation({ run, assessment, validation, publicModel, registry, catalog, locale })`
  - `renderReportMarkdown(presentation)`

- [ ] **Step 1: Copy the current renderer blob to `legacy-report-core.mjs`**

Use the current blob unchanged so existing imports and safety behavior remain reviewable.

- [ ] **Step 2: Add a closed locale catalog**

Define `ja` and `en` labels for titles, headings, outcomes, provenance, claim tiers, evidence notes, group labels, and the JIS 4.1.1 note. Reject unsupported locales.

- [ ] **Step 3: Build criterion metadata lookup**

Join profile requirement IDs to catalog records and registry report groups. Select localized title with an explicit fallback rule and retain primary URLs.

- [ ] **Step 4: Build standalone row provenance**

Map `human_verified` to `human_review` and every remaining profile row to `not_run`; do not interpret screening-check rows as profile outcomes.

- [ ] **Step 5: Build run-backed row provenance**

Use sanitized `recordedHumanChecks` and `screeningCandidates` from the existing public model. Human review wins over screening; otherwise map an exact registered screening projection; otherwise emit `not_run`.

- [ ] **Step 6: Compute group and aggregate counts from rendered rows**

Counts must be derived from the same rows shown in the table, preventing aggregate/provenance drift.

- [ ] **Step 7: Build the guarded claim section**

Read requested and maximum tiers, choose only a registry-fixed localized template, and derive deterministic limiting reasons from guard blockers and coverage.

- [ ] **Step 8: Render escaped Markdown**

Render profile title, provenance legend, claim section, group summaries, full criterion tables, JIS note, findings/remediation, scope, environment, and limitations.

- [ ] **Step 9: Replace `render-audit-report.mjs` with a compatibility wrapper**

Re-export every legacy export and delegate direct execution to the new supported report CLI created in Task 3.

- [ ] **Step 10: Run focused tests**

Run: `node --test tests/report-profile-provenance-claim.test.mjs`

Expected: remaining failures only for the not-yet-created CLI wiring.

### Task 3: Supported report CLI and command registry

**Files:**
- Create: `codex/skills/information-accessibility-practice/scripts/render-report.mjs`
- Modify: `codex/skills/information-accessibility-practice/scripts/lib/cli-command-registry.mjs`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/getting-started.md`
- Test: `tests/unified-cli.test.mjs`
- Test: `tests/readme-entrypoint.test.mjs`

**Interfaces:**
- Consumes: presentation builders and legacy validation/public-model functions.
- Produces: `accessibility-audit report ... --locale ja|en` for both standalone and run-backed inputs.

- [ ] **Step 1: Parse the report interfaces**

Accept exactly one of `--input` or `--run`/`--assessment`, require run-backed output, accept `--locale ja|en`, and preserve no-overwrite behavior.

- [ ] **Step 2: Implement standalone rendering**

Load references, validate assessment, build standalone presentation, and write or print Markdown.

- [ ] **Step 3: Implement run-backed rendering**

Perform stable reads, current-run validation, assessment validation, legacy run-backed binding validation, sanitized public-model construction, presentation enrichment, and stable-input checks before writing.

- [ ] **Step 4: Route the unified CLI**

Change only the report command target and help contract. Keep all other commands unchanged.

- [ ] **Step 5: Update public examples**

Use the unified report command and show matching Japanese/English locale examples.

- [ ] **Step 6: Run focused CLI and documentation tests**

Run: `node --test tests/report-profile-provenance-claim.test.mjs tests/unified-cli.test.mjs tests/readme-entrypoint.test.mjs`

Expected: PASS.

### Task 4: Distribution parity, golden fixtures, and full verification

**Files:**
- Modify generated Claude distribution through `scripts/sync-distributions.mjs`
- Create: `tests/fixtures/report-profile/expected-web-modern-ja.md`
- Create: `tests/fixtures/report-profile/expected-web-modern-en.md`
- Create: `tests/fixtures/report-profile/expected-jp-public-web-ja.md`
- Create: `tests/fixtures/report-profile/expected-jp-public-web-en.md`
- Test: `tests/report-profile-provenance-claim.test.mjs`

**Interfaces:**
- Consumes: final report CLI.
- Produces: deterministic fixtures and cross-distribution parity.

- [ ] **Step 1: Generate and review four golden reports**

Check headings, group counts, row sources, claim wording, primary links, and JIS 4.1.1 text.

- [ ] **Step 2: Add untranslated-text and enum-stability assertions**

Japanese/English output may differ only in human-readable text; JSON IDs and enum values remain unchanged.

- [ ] **Step 3: Synchronize distributions**

Run: `node scripts/sync-distributions.mjs`

- [ ] **Step 4: Run full verification**

Run: `node scripts/verify-all.mjs`

Expected: `status: PASS` and zero failing test files.

- [ ] **Step 5: Review the complete diff**

Confirm no target mutation, no AI-to-human promotion, no free-form stronger claim, no internal run metadata in public output, and no overwrite regression.

- [ ] **Step 6: Update the PR and merge after four-platform CI succeeds**

The PR closes #18, #19, and #23. It records partial progress on #21 without closing it.
