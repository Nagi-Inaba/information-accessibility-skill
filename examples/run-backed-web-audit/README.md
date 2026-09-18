# Run-backed Web audit example

This runner demonstrates two deterministic audit chains:

1. `screening-only` — E1 screening, human-review queue, unverified remediation candidate, merge, and report
2. `human-reviewed` — the same chain plus a declared external human review and verified-failure remediation

Run from the repository root:

```powershell
node .\examples\run-backed-web-audit\run.mjs --output .\audit-runs\examples\run-backed-web-audit
```

```sh
node ./examples/run-backed-web-audit/run.mjs --output ./audit-runs/examples/run-backed-web-audit
```

Each scenario contains:

- `audit-run.json` and versioned predecessor files
- `baseline-assessment.json`
- `screening-observations.json`
- `artifacts/captured-fixture.html`, the saved bytes referenced by each E1 observation
- `artifacts/fixture-state-*.json` and `target-inventory.json`, the synthetic saved-state bundles and measured private inventory
- `human-review-queue.json`
- optional `declared-human-review.json`
- `remediation-plan.json`
- `merged-assessment.json`
- `audit-report.md`

The registered artifact originals remain under each scenario's private `artifacts/` directory. Root-level copies are included only so readers can inspect the example handoff easily.

The runner captures and binds the synthetic saved states before registering envelope 3.0.0 artifacts in run 8.0.0. Screening payload 3.0.0 records a hash of `fixture.html`, its illustrative capture date, and the measured target/environment binding. Registration rechecks the saved bundle and rejects drift; reports validate the recorded files offline. Optional `--target-name` and repeatable HTTP(S) `--target-ref` arguments change the declared example context before evidence is bound; they do not fetch those targets. Do not edit a generated run's target after registration.

The example uses a documented fixture observation and `https://example.com/` as a public identity. It does not claim to have inspected the live site. The screening-only report must not be read as a profile outcome; the human-reviewed path records one declared, unauthenticated external review so that the difference is visible without overstating reviewer assurance.
