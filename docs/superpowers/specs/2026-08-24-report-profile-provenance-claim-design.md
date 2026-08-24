# Report profile, provenance, locale, and claim design

## Scope

This design implements the report-core portion of Issues #18, #19, and #23. It also establishes the report locale interface needed by Issue #21, but Issue #21 remains open until requirement, checklist, CLI help/error, and report surfaces all use the same locale contract.

## Supported entry points

The supported `accessibility-audit report` command must render both:

- standalone: `--input <assessment.json>`
- run-backed: `--run <audit-run.json> --assessment <assessment.json>`

Both paths use the same presentation model and Markdown renderer. `--locale ja|en` controls only human-readable text; IDs, schema keys, enum values, profile IDs, and artifact contracts remain unchanged.

## Compatibility boundary

The current `render-audit-report.mjs` exports are imported by existing tests and runtime code. Preserve those exports by copying the current implementation byte-for-byte to `legacy-report-core.mjs`. Replace `render-audit-report.mjs` with a compatibility module that re-exports the legacy functions and delegates direct CLI execution to the new report command.

The new report command may consume these trusted legacy functions:

- `validateRunBackedAssessment()`
- `buildPublicReportModel()`

The new public renderer must not weaken the existing run-backed privacy sanitizer or internal-control-metadata rejection.

## Presentation model

Each profile-requirement row contains:

- `requirement_id`
- `success_criterion`
- localized `title`
- `level`
- `group_id` and localized `group_label`
- `primary_url`
- `outcome`
- localized `outcome_label`
- `source_kind`: `human_review | screening | not_run`
- localized `source_label`
- `evidence_level`
- `rationale`
- `applicability`

Provenance rules:

1. `mapping_status: human_verified` is `human_review`; it is never inferred from AI or automated evidence.
2. A run-backed report-only projection is `screening` only when a registered screening observation names that profile requirement.
3. A row without either source is `not_run` with `not_tested`.
4. Report-only screening judgement is explicitly described as not being a machine-readable profile outcome.

## Profile metadata

`web-modern` renders as WCAG 2.2 A/AA.

`jp-public-web` renders two separate groups from registry metadata:

- JIS X 8341-3:2016 A/AA: 38 requirements
- Additional WCAG 2.1/2.2 A/AA: 18 requirements

Each group shows pass, fail, cant_tell, not_tested, and not_applicable counts. JIS 4.1.1 includes an explicit note that WCAG 2.2 removed Parsing while the JIS 2016 profile retains it.

## Claim presentation

The report displays:

- requested tier
- validator maximum tier
- registry-fixed wording for the selected locale
- evidence/human-review coverage
- human-readable limiting reasons
- a statement that report judgement labels are not a formal conformance declaration

The renderer must never synthesize a stronger free-form claim. Fixed wording is selected only from `standards-registry.json`.

## Output and safety

- Markdown cells escape untrusted text.
- Existing files are never overwritten.
- Run-backed rendering retains stable-file checks for the run, assessment, and registered artifacts.
- Codex and Claude distributions remain byte-identical through the existing distribution sync check.
