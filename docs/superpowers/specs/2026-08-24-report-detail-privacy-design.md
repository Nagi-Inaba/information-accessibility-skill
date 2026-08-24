# Report Detail and Privacy Design

## Goal

Provide one report pipeline that can render a concise summary or a complete 55/56-row report and can explicitly produce either internal or publication-oriented output for both standalone and run-backed assessments.

## User-facing interface

```text
accessibility-audit report ... --detail summary|full --visibility internal|public
accessibility-audit report ... --detail summary --appendix <full-report.md>
accessibility-audit report ... --visibility public --reviewer-disclosure include|redact --redaction-manifest <manifest.json>
```

Defaults preserve existing behavior without implying publication safety:

- `--detail full`
- `--visibility internal`
- internal reports include an explicit not-for-publication notice

Public output requires both `--reviewer-disclosure` and `--redaction-manifest`. Automated redaction is a safety aid, not a publication approval; every public report states that human publication review remains required.

## Architecture

1. Build the existing raw presentation model from validated standalone or run-backed input.
2. For run-backed input, request an internal model from the legacy evidence collector so target, scope, environment, evidence prose, and reviewer data have not already been irreversibly redacted.
3. Apply one field-aware visibility policy to either presentation type.
4. Render `summary` or `full` Markdown from the resulting presentation.
5. Optionally render a full appendix from the same sanitized presentation.
6. Write the internal redaction manifest separately; it records field paths, reasons, and actions but never copies removed values.

## Detail modes

### Summary

The summary contains, in this order:

- report and visibility notice
- overall judgement, evidence level, and claim boundary
- high-impact findings and screening candidates
- every externally human-reviewed requirement, including pass results
- next human checks and the number of remaining not-run requirements
- profile-group outcome counts and evidence provenance counts
- scope and limitations

The summary omits the large table of unreviewed rows. It must not hide a formal human-reviewed result.

### Full

The full report preserves the current profile-aware layout and includes every profile requirement exactly once. `web-modern` contains 55 rows; `jp-public-web` contains 56 rows split into JIS 38 and additional WCAG 18.

### Summary plus appendix

`--detail summary --appendix <path>` renders the concise report to the normal output and the complete report to the appendix path. All requested file paths are checked for conflicts before any output is written.

## Visibility modes

### Internal

- no content redaction
- reviewer names and raw evidence remain available
- report states that it may contain private data and is not publication-ready
- no redaction manifest is generated

### Public

The policy processes all human-readable strings, including nested finding and evidence prose.

It removes or canonicalizes:

- local, UNC, and `file:` paths
- private, loopback, link-local, reserved, and single-label hosts
- URL userinfo, query, and fragment; a safe public origin/path is retained when possible
- credential-like and authorization tokens
- email addresses and phone-number candidates
- reviewer identity when `--reviewer-disclosure redact` is selected

The report includes a publication-review warning. The manifest includes only:

```json
{
  "path": "target.urls_or_files[0]",
  "reason": "url_query_removed",
  "action": "canonicalized"
}
```

It must not contain the removed value, a hash of the removed value, or enough text to reconstruct it.

## Safety and compatibility

- Machine-readable assessment and audit-run inputs are never modified.
- IDs, schema keys, enum values, claim guards, and profile outcomes are unchanged.
- AI screening remains report-only and cannot become `human_verified`.
- Existing output paths are never overwritten.
- Public and internal policy is identical for standalone and run-backed input.
- Codex and Claude distributions remain byte-equivalent for shared runtime files.
