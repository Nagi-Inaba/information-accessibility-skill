# Audit artifact storage and publication

Audit records can contain private target URLs, local paths, reviewer names, run and artifact identifiers, hashes, raw observations, authorization details, and unredacted evidence. Keep operational artifacts separate from source files and publish only an explicitly reviewed export.

## Recommended local layout

```text
.a11y-audit/
  runs/
    <run-id>/
      audit-run-v1.json
      audit-run-v2.json
      artifacts/
        screening-observations.json
        human-review-queue.json
        declared-human-review.json
        remediation-plan.json
        evidence/
      merged-assessment.json
  reports/
    internal/
    public-candidates/
  catalog-candidates/
```

The repository ignores `.a11y-audit/` by default. Existing `audit-runs/` deployments remain ignored for compatibility. Documentation examples may use `.example-output/`, which is also ignored.

## Storage rules

1. **Use one run directory per audit chain.** Do not mix artifact files from unrelated run IDs.
2. **Do not overwrite immutable records.** Each run version, registered artifact, merged assessment, report candidate, and retest result uses a new file.
3. **Keep raw evidence inside the internal run tree.** DOM snapshots, accessibility-tree captures, screenshots, logs, private URLs, and reviewer worksheets are not public report assets.
4. **Use explicit public export.** Copy or generate a public candidate outside the internal artifact set only after applying the publication policy and reviewing the result.
5. **Preserve bindings.** Moving an artifact after registration changes its expected path and can invalidate the run. Archive the complete run directory rather than selecting individual files.
6. **Avoid repository-root filenames such as `audit.json`.** A dedicated root reduces accidental staging and makes cleanup, retention, and access control easier.

## Public report workflow

```text
internal run and evidence
  ↓ validate and merge
internal full report
  ↓ sanitize and publication review
public candidate
  ↓ explicit approval
published report
```

A public report is not a substitute for the internal evidence set. Retain the internal run according to the applicable organizational policy, contract, consent terms, and data-minimization requirements.

## Cleanup and retention

- Delete disposable examples such as `.example-output/` after verification.
- Do not delete an artifact that is referenced by an active run or a retained report.
- Before archival, verify the run, artifact hashes, merged assessment, and report candidate as one bundle.
- Apply the shortest retention period that still satisfies the audit purpose and any external obligations.
- Remove or separately protect participant data, authentication material, access tokens, and confidential target content.

## Git safety check

Before committing source changes, run:

```sh
git status --short
```

No file under `.a11y-audit/`, `audit-runs/`, or `.example-output/` should appear. Public reports intended for the repository should be placed in a deliberately reviewed documentation path and should not contain raw internal evidence.
