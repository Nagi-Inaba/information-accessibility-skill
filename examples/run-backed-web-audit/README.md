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
- `human-review-queue.json`
- optional `declared-human-review.json`
- `remediation-plan.json`
- `merged-assessment.json`
- `audit-report.md`

The registered artifact originals remain under each scenario's private `artifacts/` directory. Root-level copies are included only so readers can inspect the example handoff easily.

The example uses a documented fixture observation and `https://example.com/` as a public identity. It does not claim to have inspected the live site. The screening-only report must not be read as a profile outcome; the human-reviewed path records one declared, unauthenticated external review so that the difference is visible without overstating reviewer assurance.
