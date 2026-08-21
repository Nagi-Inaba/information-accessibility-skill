# Basic standalone assessment example

This example verifies the smallest complete standalone path:

1. create a standards ledger for a named target;
2. validate the ledger;
3. render a Markdown report;
4. confirm that initialization remains visibly `not_tested` rather than becoming a positive conclusion.

The local HTML file is a stable fixture. The commands below create records about that fixture; they do not inspect its rendered DOM or accessibility tree. Add browser or human evidence only after performing the corresponding observation.

Run from the repository root:

```sh
mkdir -p .example-output
node ./codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs \
  --profile web-modern \
  --target-name "Basic standalone fixture" \
  --target-version "fixture-v1" \
  --target-ref "examples/basic-standalone/target/index.html" \
  --evaluator "Example reviewer" \
  --evaluated-at "2026-08-22" \
  --output ./.example-output/assessment.json

node ./codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs \
  ./.example-output/assessment.json

node ./codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs \
  --input ./.example-output/assessment.json \
  --output ./.example-output/audit-report.md
```

Expected results:

- `assessment.json` contains all 55 `web-modern` profile requirements exactly once.
- Every profile result begins with `mapping_status: "unverified"`, `outcome: "not_tested"`, and no target evidence.
- validation succeeds as a reference-only ledger.
- the report states an overall judgement of `未確認` and reports `0/55` human-reviewed requirements.

The example output directory is temporary. Do not commit target-specific evidence, private URLs, reviewer details, or internal paths without a deliberate publication review.
