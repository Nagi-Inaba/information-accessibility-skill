# Standalone assessment example

This example creates one complete WCAG 2.2 A/AA ledger, validates it, and renders guarded Markdown reference guidance.

From the repository root:

```powershell
node .\examples\standalone-ledger\run.mjs --output .\audit-runs\examples\standalone-ledger
```

```sh
node ./examples/standalone-ledger/run.mjs --output ./audit-runs/examples/standalone-ledger
```

Generated files:

- `assessment.json` — all 55 `web-modern` requirements initialized as `not_tested`
- `audit-report.md` — reference guidance, not a completed inspection result

The runner uses a public placeholder identity and fixed example metadata. It does not fetch or inspect the live `example.com` page. Replace the target identity only in your own private output directory, then add target-specific evidence and external human outcomes through the applicable procedures.
