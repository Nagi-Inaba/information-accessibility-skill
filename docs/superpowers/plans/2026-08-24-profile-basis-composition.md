# Profile Basis and Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Steps use checkbox syntax.

**Goal:** Complete Issue #45 by separating JIS-only, WCAG-only, and explicitly adopted Digital Agency-derived profile choices while retaining historical `jp-public-web` compatibility.

**Architecture:** Extend the standards registry with validated profile-kind and group-basis metadata, add a new active JIS-only profile, preserve the legacy composite ID, and project localized basis statements into CLI discovery and Markdown/HTML reports.

**Tech stack:** Node.js 20+, ECMAScript modules, JSON Schema, `node:test`, existing report renderers and Codex/Claude distribution sync.

**Spec:** `docs/superpowers/specs/2026-08-24-profile-basis-composition-design.md`

## Constraints

- Existing `jp-public-web` IDs and requirement order remain readable.
- No current Digital Agency page is represented as defining a universal Japanese 56-item profile.
- JIS and organizational-policy outcomes remain separate.
- No profile or group basis may increase claim tiers.
- Codex and Claude files remain byte-identical.
- Full verification is `node scripts/verify-all.mjs` on Ubuntu/Windows and Node 20/22.

---

### Task 1: Lock the profile-selection contract

**Files**
- Create: `tests/profile-basis-composition.test.mjs`

- [ ] Assert active 55-item WCAG, 38-item JIS, and legacy 56-item composite profiles.
- [ ] Assert profile kind, explicit-adoption flag, source basis, and migration metadata.
- [ ] Assert profile discovery in Japanese and English.
- [ ] Assert Markdown and HTML reports expose each group basis and claim adoption rule.
- [ ] Assert README selection guidance and migration documentation.
- [ ] Run the focused test and confirm RED failures are caused by missing profile/basis behavior.

### Task 2: Extend and validate registry metadata

**Files**
- Modify: `references/standards-registry.json` in Codex and Claude
- Modify: `references/standards-registry.schema.json` in Codex and Claude
- Modify: `scripts/lib/profile-registry.mjs` in Codex and Claude

- [ ] Add `profile_kind`, `explicit_adoption_required`, `localized`, and `group_bases` to all active profiles.
- [ ] Add active `jis-x-8341-3-2016-aa` with 38 JIS requirements.
- [ ] Reclassify `jp-public-web` as an explicitly adopted organizational policy pattern while retaining the ID and requirement set.
- [ ] Add migration metadata and current source-verification note.
- [ ] Validate exact group-basis keys, allowed kinds/adoption values, source IDs, and bilingual labels/scopes.
- [ ] Add helper returning localized group basis metadata.

### Task 3: Project basis into discovery and reports

**Files**
- Modify: `scripts/show-profiles.mjs`
- Modify: `scripts/lib/runtime-locale.mjs`
- Modify: `scripts/lib/report-locale.mjs`
- Modify: `scripts/lib/report-presentation.mjs`
- Modify: `scripts/lib/report-summary.mjs`
- Modify: `scripts/lib/report-html.mjs`
- Mirror all shared files to Claude

- [ ] Profile JSON/text/Markdown shows profile kind, explicit adoption, migration, and group basis.
- [ ] Registry-localized profile metadata takes precedence for new/renamed profiles.
- [ ] Add JIS-only and explicit Digital Agency composite report titles.
- [ ] Add localized group basis to report presentation and claim boundary.
- [ ] Render basis in full/summary Markdown and HTML without changing outcomes or evidence provenance.

### Task 4: Document selection and migration

**Files**
- Create: `docs/profile-selection-and-migration.md`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/getting-started.md`
- Modify: `CHANGELOG.md`

- [ ] Add a three-profile selection table.
- [ ] State that JIS-only is 38 items and WCAG 2.2-only is 55 items.
- [ ] State that the legacy 56-item composite requires explicit organizational adoption.
- [ ] Explain the current Digital Agency source context without claiming that it defines the exact 18-item set for all Japanese sites.
- [ ] Explain that changing profile creates a new record/run and never rewrites history.

### Task 5: Verify and merge

- [ ] Run focused profile and report tests.
- [ ] Run `node scripts/verify-all.mjs`.
- [ ] Confirm Codex/Claude parity.
- [ ] Review source-basis wording for overclaiming.
- [ ] Review backward compatibility and claim boundaries.
- [ ] Confirm Ubuntu/Windows × Node 20/22 CI.
- [ ] Update PR body, mark ready, review, squash merge, and confirm Issue #45 closes.
