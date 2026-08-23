# JIS Procedure Reuse Implementation Plan

> **For Codex:** Execute this plan with test-driven development. Verify the focused test fails before changing production code, then run the complete verification suite before merge.

**Goal:** Reuse existing WCAG criterion-specific procedures for equivalent JIS requirements without changing the selected JIS profile, claim boundary, or JIS source provenance.

**Architecture:** Keep `criteria-catalog.json` as the mapping source. Resolve a procedure first by the selected requirement ID and, only when no direct procedure exists, by the selected criterion's `web_modern_record_id`. Preserve the selected criterion and profile in the lookup result; reuse only the procedure contract. Merge JIS official method sources with the reused procedure's primary sources. Do not fall back through `success_criterion` alone, so JIS-specific 4.1.1 remains unmapped.

**Tech stack:** Node.js ESM, `node:test`, JSON reference catalogs, Codex/Claude mirrored distributions.

---

## Task 1: Add failing regression coverage

**Files:**
- Create: `tests/jis-procedure-reuse.test.mjs`

1. Add a table-driven test for JIS 1.1.1, 1.3.1, 2.1.1, and 4.1.2.
2. Assert each lookup reports an available criterion-specific procedure sourced from the expected WCAG record.
3. Assert the selected profile remains `jp-public-web`, the selected criterion remains the JIS ID, and WAIC URLs remain in `procedure_binding.official_sources`.
4. Assert JIS-specific 4.1.1 remains unavailable and does not acquire a WCAG procedure.
5. Scan the complete JIS profile and assert exactly four requirements receive detailed procedures in this slice.
6. Open a draft PR and verify the focused test fails because the current lookup uses only direct ID equality.

## Task 2: Implement canonical fallback in both distributions

**Files:**
- Modify: `codex/skills/information-accessibility-practice/scripts/show-requirement.mjs`
- Modify: `claude/skills/information-accessibility-practice/scripts/show-requirement.mjs`

1. Resolve direct procedure matches first.
2. When direct resolution fails and `criterion.web_modern_record_id` is present, resolve that exact canonical WCAG requirement ID.
3. Reuse only the canonical procedure contract while retaining the selected profile, criterion, and existing output shape.
4. For reused procedures, combine the selected JIS criterion's official sources with the procedure's primary sources, removing duplicates.
5. Keep the selected profile, criterion, and claim ceiling unchanged.
6. Do not use title or success-criterion string matching.

## Task 3: Verify and merge

**Files:**
- Verify: `tests/jis-procedure-reuse.test.mjs`
- Verify: `tests/criterion-procedures.test.mjs`
- Verify: full repository suite through `node scripts/verify-all.mjs`

1. Confirm the focused regression test passes.
2. Confirm existing WCAG procedure tests still pass.
3. Confirm Codex/Claude package parity passes.
4. Confirm Ubuntu/Windows and Node.js 20/22 GitHub Actions checks pass.
5. Review the final diff against every acceptance criterion in Issue #15.
6. Merge with squash after checks pass, then close Issue #15 and update backlog Issue #144.
