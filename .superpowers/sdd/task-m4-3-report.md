# M4-3 implementation report

## Outcome

M4-3 is implemented as registry data, schema support, tests, and distribution documentation without changing agent bodies or queue runtime code.

The exact-lookup runtime now reports criterion procedures as available for WCAG 2.2 SC 2.1.1 and SC 4.1.2, and a queue composed only from those two lookup bindings registers with coverage `2 available / 0 unavailable`.

## Scope and task base

- Task base: `cebc3197b745b61328134ba3b1c3803de724df50`
- Changed implementation surface: criterion procedure catalog and schema, Codex skill/source documentation, README, two test files, and generated Claude skill mirrors.
- Generated mirrors were produced only with `node scripts/sync-distributions.mjs --write`.
- No changes were made under `shared/agents/**`, `codex/agents/**`, or `claude/agents/**`.
- No changes were made to `show-requirement.mjs`, `scripts/lib/audit-run.mjs`, queue schemas, or other runtime branches.
- Changed-path audit before this report: 11 changed paths, 0 outside the task brief allowlist.

## TDD evidence

### RED

Command:

```powershell
node --test .\tests\criterion-procedures.test.mjs .\tests\audit-orchestration-cli.test.mjs
```

Observed before catalog/schema implementation: 65 tests, 61 passed, 4 failed.

The four intended failures were:

1. SC 2.1.1 had no criterion-specific procedure.
2. SC 4.1.2 had no criterion-specific procedure.
3. Exact lookup reported the new procedure binding as `not_available` instead of `available`.
4. The two-item queue had `0 available / 2 unavailable` instead of `2 available / 0 unavailable`.

### GREEN

The same targeted command after implementation completed with 65 tests, 65 passed, 0 failed, and 0 skipped.

## Implemented records

- `wcag22-sc-2-1-1-keyboard` fixes scope and permitted interactive states, requires keyboard-interface-only exercise and key/result/unreachable-function evidence, records path-dependent exceptions, keeps adjacent keyboard criteria separate, and uses `keyboard_test` plus `manual_observation`.
- `wcag22-sc-4-1-2-name-role-value` compares native and custom components in the DOM and accessibility tree before and after permitted interaction, checks name/role/user-settable state-property-value exposure and change notification, keeps status-message-only behavior under SC 4.1.3, and uses `browser_inspection` plus `assistive_technology_test`.
- Both records contain applicability steps, procedures, expected results, pass/fail/cant-tell counterexamples, cant-tell conditions, primary W3C sources, and the existing AI-to-human outcome boundary.
- Catalog `verified_at` is `2026-07-18`; the usage rule now states that four criteria have procedures.
- `keyboard_test` was added to the criterion-procedure evidence enum.
- Unavailable lookup coverage moved from SC 2.1.1 to still-unimplemented SC 2.2.1 without weakening its exact generic-binding assertion.

## Verification evidence

| Command | Result |
| --- | --- |
| `node --test .\tests\criterion-procedures.test.mjs .\tests\audit-orchestration-cli.test.mjs` | PASS: 65 tests, 65 passed, 0 failed, 0 skipped |
| `node --test .\tests\audit-report.test.mjs .\tests\distribution-sync.test.mjs` | PASS: 39 tests, 37 passed, 0 failed, 2 skipped |
| `node .\scripts\sync-distributions.mjs --check` | PASS: 49 shared skill files; 4 agent bodies equal; no changed mirrors |
| `node .\scripts\verify-package.mjs` | PASS: 58 JSON files parsed; 49 shared skill files; 4 agent bodies equal |
| `node --test .\tests\*.test.mjs` | PASS: 210 tests, 208 passed, 0 failed, 2 skipped |
| `git diff --check` | PASS |
| `git diff --exit-code cebc3197b745b61328134ba3b1c3803de724df50 -- shared/agents codex/agents claude/agents` | PASS: agent bodies unchanged from task base |

The two skipped distribution tests require Windows symbolic-link creation and reported `EPERM`; all executable tests in the current permissions passed.

## Review and residual risk

The local code-review pass found no scope, correctness, or regression issue in the final diff.

The catalog remains intentionally partial at four criterion procedures, so the claim ceiling remains `evaluated_subset`.

These records define executable human-review procedures; they do not supply target-specific keyboard or assistive-technology outcomes, and an external human reviewer is still required to record a criterion result.

The commit containing this report is identified in the parent handoff because a commit cannot embed its own final hash.
