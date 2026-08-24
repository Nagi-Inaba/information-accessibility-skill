# Report Detail and Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add summary/full report modes and a unified standalone/run-backed internal/public privacy policy with a separate redaction manifest.

**Architecture:** Keep validation and evidence collection unchanged. Build a raw presentation, apply one visibility policy, then select a summary or full renderer. Preflight every requested output before writing the report, appendix, or manifest.

**Tech Stack:** Node.js 20+, ECMAScript modules, node:test, existing safe writer and profile-aware presentation model.

**Spec:** `docs/superpowers/specs/2026-08-24-report-detail-privacy-design.md`

## Global Constraints

- Do not mutate assessment, run, or registered artifact inputs.
- Do not promote AI screening into profile outcomes.
- Do not change machine-readable IDs, keys, or enum values for locale or visibility.
- Public output requires an internal redaction manifest and human publication review.
- Manifest entries never include removed values or secret-derived hashes.
- Preserve Codex/Claude distribution parity and Ubuntu/Windows × Node.js 20/22 support.

---

### Task 1: Lock the CLI and report contracts with failing tests

**Files:**
- Create: `tests/report-detail-privacy.test.mjs`

**Interfaces:**
- Consumes: existing `accessibility-audit report`, standalone generator, and run-backed example.
- Produces: executable contracts for `--detail`, `--appendix`, `--visibility`, `--reviewer-disclosure`, and `--redaction-manifest`.

- [ ] Add tests for summary/full row counts, summary+appendix, human-review preservation, standalone/run-backed privacy, manifest secrecy, publication warnings, and output preflight.
- [ ] Run `node --test tests/report-detail-privacy.test.mjs` and confirm failures are caused by unknown arguments or missing output behavior.
- [ ] Commit the RED tests.

### Task 2: Build one field-aware visibility policy

**Files:**
- Create: `codex/skills/information-accessibility-practice/scripts/lib/report-privacy.mjs`
- Mirror: `claude/skills/information-accessibility-practice/scripts/lib/report-privacy.mjs`
- Modify: `codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs`
- Mirror: `claude/skills/information-accessibility-practice/scripts/render-audit-report.mjs`

**Interfaces:**
- Produces: `applyReportVisibility(presentation, { visibility, reviewerDisclosure }) -> { presentation, manifest }`.
- Produces: `buildPublicReportModel(..., visibility: "internal" | "public")` without changing the legacy default.

- [ ] Add field-aware URL, path, private-host, secret, email, phone, reviewer, and nested-prose redaction.
- [ ] Record only path/reason/action in manifest entries.
- [ ] Keep internal mode unchanged and add explicit publication metadata.
- [ ] Run focused privacy tests and confirm public input is redacted while internal input is preserved.
- [ ] Commit the visibility policy.

### Task 3: Add summary rendering and full appendix

**Files:**
- Create: `codex/skills/information-accessibility-practice/scripts/lib/report-summary.mjs`
- Mirror: `claude/skills/information-accessibility-practice/scripts/lib/report-summary.mjs`
- Modify: `codex/skills/information-accessibility-practice/scripts/lib/report-locale.mjs`
- Mirror: `claude/skills/information-accessibility-practice/scripts/lib/report-locale.mjs`

**Interfaces:**
- Produces: `renderReportSummaryMarkdown(presentation)`.
- Consumes: the same visibility-processed presentation used by the full renderer.

- [ ] Render high-impact barriers and actions before untested counts.
- [ ] Include every human-reviewed row and profile-group/provenance counts.
- [ ] Omit the bulk not-run table and state the remaining count.
- [ ] Preserve current full renderer as the complete report.
- [ ] Run summary/full tests and confirm 55/56 completeness only in full output.
- [ ] Commit the summary renderer.

### Task 4: Wire CLI output policy and preflight

**Files:**
- Modify: `codex/skills/information-accessibility-practice/scripts/render-report.mjs`
- Mirror: `claude/skills/information-accessibility-practice/scripts/render-report.mjs`
- Modify: `codex/skills/information-accessibility-practice/scripts/lib/cli-command-registry.mjs`
- Mirror: `claude/skills/information-accessibility-practice/scripts/lib/cli-command-registry.mjs`

**Interfaces:**
- Adds: `--detail summary|full`, `--appendix`, `--visibility internal|public`, `--reviewer-disclosure include|redact`, `--redaction-manifest`.

- [ ] Validate argument combinations and default to full/internal.
- [ ] Require reviewer disclosure and manifest for public output.
- [ ] Preflight report, appendix, and manifest paths before the first write.
- [ ] Render summary and full appendix from the same sanitized presentation.
- [ ] Preserve stdout for standalone report output where no file is requested.
- [ ] Run CLI and no-overwrite tests.
- [ ] Commit the CLI integration.

### Task 5: Document and verify the completed slice

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/getting-started.md`
- Modify: report-related tests as required by the final public contract.

**Interfaces:**
- Documents: safe internal default, explicit public flow, manifest review, and summary/full usage.

- [ ] Update Japanese and English examples with matching command structures.
- [ ] State that public redaction is incomplete without human review.
- [ ] Run `node --test tests/report-detail-privacy.test.mjs`.
- [ ] Run `node scripts/verify-all.mjs`.
- [ ] Confirm Codex/Claude parity and all four CI matrix jobs.
- [ ] Review the diff against Issue #20 and #22 acceptance criteria before merge.
