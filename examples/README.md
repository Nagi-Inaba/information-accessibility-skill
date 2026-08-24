# Reproducible usage examples

These examples show the three supported entry paths without requiring private URLs or machine-specific paths.

| Path | Use it when | Result |
| --- | --- | --- |
| [Natural-language review](natural-language-review/README.md) | You want an immediate first pass over a Web page, document, event, or workflow | Barriers, improvement ideas, and explicit human follow-up |
| [Standalone assessment](standalone-ledger/README.md) | You need one complete WCAG/JIS ledger and a guarded report | One validated assessment JSON and reference guidance or an evidence-backed report |
| [Run-backed audit](run-backed-web-audit/README.md) | You need durable multi-stage provenance | Immutable run versions and registered artifacts |

The run-backed example makes the handoff visible in order:

```text
screening
  → human review queue
  → optional external human review
  → remediation
  → merge
  → report
```

AI and automated screening remain E0/E1 evidence. Only an external human review using the applicable procedure and target-specific evidence may record a profile outcome. The sample files use `https://example.com/` as a public placeholder and do not claim that the live site was audited.
