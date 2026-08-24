# Report profile, provenance, locale, and claim design

## Scope

This design implements the report-core portion of Issues #18, #19, and #23. It also establishes the report locale interface needed by Issue #21, but Issue #21 remains open until requirement, checklist, CLI help/error, and report surfaces all use the same locale contract.

## Supported entry points

The supported `accessibility-audit report` command renders both:

- standalone: `--input <assessment.json>`
- run-backed: `--run <audit-run.json> --assessment <assessment.json>`

Both paths use the same presentation model and Markdown renderer. `--locale ja|en` controls only human-readable text; IDs, schema keys, enum values, profile IDs, and artifact contracts remain unchanged.

## Compatibility boundary

The existing `render-audit-report.mjs` module is imported by tests and downstream runtime code, and its direct-script output is a public compatibility surface. Keep that file byte-identical to its pre-change implementation.

Copy the same implementation byte-for-byte to `legacy-report-core.mjs` so the new supported report command can reuse trusted validation and sanitization functions without changing the old module. Route only the unified CLI command `accessibility-audit report` to `render-report.mjs`.

This boundary provides two explicit paths:

- `render-audit-report.mjs`: legacy-compatible direct renderer for existing callers
- `accessibility-audit report`: canonical profile-aware, provenance-explicit, locale-aware renderer

The new report command consumes these trusted legacy functions:

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

The renderer never synthesizes a stronger free-form claim. Fixed wording is selected only from `standards-registry.json`.

## Output and safety

- Markdown cells escape HTML, table delimiters, line breaks, and injected heading markers from untrusted text.
- Existing files are never overwritten.
- Run-backed rendering retains stable-file checks for the run, assessment, and registered artifacts.
- Run-backed presentation is built only after the existing sanitizer creates the public model.
- Codex and Claude distributions remain byte-identical through the existing distribution sync check.
