[日本語](README.md) | English

# Information Accessibility Audit Skill and Agent

## In 30 seconds

This Codex and Claude package reviews whether people can **find information, receive it, understand it, complete the intended action, and check the result later** across websites, applications, documents, slides, videos, and event information.

It provides three paths: Natural-language review, a WCAG or JIS Standalone assessment, and a multi-stage Run-backed audit. For Web targets, it also includes a read-only browser scan based on Playwright and axe-core.

AI and automated tools normally produce barrier candidates and E0/E1 screening evidence. A standards-requirement outcome requires an external human review using the applicable procedure and target-specific evidence. **The current release alone cannot support a formal conformance declaration.**

When unsure, start by naming the target and the result you need.

```text
Review this website for information accessibility. Separate observed barriers, possible improvements, and items that require human verification.
```

## Table of contents

- [Three usage paths](#choose-one-of-three-paths)
- [Supported targets and current limits](#supported-targets-and-current-limits)
- [Requirements and installation](#requirements-and-installation)
- [Five-minute trial](#try-it-in-five-minutes)
- [Outputs](#outputs)
- [Live Web inspection](#live-web-inspection)
- [Detailed documentation](#detailed-documentation)
- [Evidence and claim boundary](#evidence-and-claim-boundary)

## Choose one of three paths

| Path | Best for | Main outputs | Important boundary |
| --- | --- | --- | --- |
| **Natural-language review** | First-pass barriers and improvement ideas, including documents, media, and events | Conversational review, remediation ideas, human follow-up | Does not preserve a standards ledger or multi-stage history by itself |
| **Standalone assessment** | A complete WCAG or JIS ledger for one bounded snapshot | One assessment JSON and one Markdown report | Every profile row starts as `not_tested`; initialization is not completed inspection |
| **Run-backed audit** | Multi-role screening, human review, remediation, authorization, and retesting | Audit run, registered artifacts, merged assessment, report | Requires understanding the schema and artifact relationships |

See the [architecture and glossary](docs/architecture-and-glossary.md) for the complete flow and responsibility boundaries.

## Supported targets and current limits

| Target | Natural-language review | Structured screening or standards ledger | Current limit |
| --- | --- | --- | --- |
| Website or Web application | Supported | `web-modern`, `jp-public-web`, read-only `scan-web` | A real screen-reader session remains an external human or host capability |
| PDF, Word document, or slide deck | Supported | Guidance-oriented | No active dedicated profile or formal claim path |
| Video or audio | Supported | Relevant Web requirements when media is inside a named Web scope | No standalone media profile |
| Event, meeting, or community process | Supported | Review through the five information-use perspectives | No dedicated structured assessment yet |
| ATAG or authoring process | Reference guidance | Partial reference information | The `authoring-agent` profile is currently inactive |

`web-modern` covers 55 WCAG 2.2 Level A and AA requirements from [WCAG 2.2](https://www.w3.org/TR/WCAG22/). `jp-public-web` contains 38 Level A and AA requirements from [JIS X 8341-3:2016 guidance by WAIC](https://waic.jp/docs/jis2016/understanding/201604/) plus 18 Level A and AA requirements introduced in WCAG 2.1 and 2.2, for 56 checks in total. JIS retains 4.1.1, Parsing, which [WCAG 2.2 removed](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/). Catalog coverage and actual evaluation coverage are recorded separately.

## Requirements and installation

- Node.js 20 or later
- A local copy of this repository
- The pinned Playwright, axe-core, and Chromium versions only when using the browser scan

### Codex

On Windows, use the manifest-aware installer with backup and dry-run support.

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\install-codex.ps1" -WhatIf
powershell -ExecutionPolicy Bypass -File ".\scripts\install-codex.ps1"
```

Specify `-IncludeAuthorizedFixer` only when deliberately installing authorized remediation. The authorized fixer is a read-only handoff agent and does not modify the target. A trusted operator performs the actual bounded change, verification, and rollback after checking the external authorization.

On macOS or Linux, copy `codex/skills/information-accessibility-practice/` and the manifest-default agents into the Codex installation. See [Getting started](docs/getting-started.md) and the [architecture guide](docs/architecture-and-glossary.md) for the installed roles and usage paths.

### Claude

`shared/agents/agent-manifest.json` entries whose `install_by_default` value is `true` are the source of truth. Install the Claude skill and these four default agents together:

- `information-accessibility-reviewer`
- `information-accessibility-e1-inspector`
- `information-accessibility-human-queue-planner`
- `information-accessibility-remediation-planner`

```powershell
node .\scripts\install-claude.mjs --dry-run
node .\scripts\install-claude.mjs
```

The multi-agent installation preserves the same role artifact contract as the Codex distribution. Use `--reviewer-only` only when the Claude host cannot dispatch specialist agents, not merely to install fewer files.

### CLI

Install the global command from the skill directory, or invoke the entry point directly through Node.js.

```powershell
npm install --global .\codex\skills\information-accessibility-practice
accessibility-audit --help
```

```powershell
node .\codex\skills\information-accessibility-practice\scripts\accessibility-audit.mjs --help
```

After installation, use these read-only discovery commands to inspect the package version, active profiles, requirement search, and optional dependencies.

```powershell
accessibility-audit --version
accessibility-audit profiles list
accessibility-audit requirements search "focus" --profile web-modern --level AA
accessibility-audit doctor
```

## Try it in five minutes

The following example creates a complete WCAG 2.2 Level A and AA standalone ledger with all 55 rows initialized as `not_tested`, validates it, and renders guarded reference guidance. Run it from the repository root.

```powershell
node .\codex\skills\information-accessibility-practice\scripts\generate-assessment.mjs --profile web-modern --target-name "Example Site" --target-version "2026-08-23" --target-ref "https://example.com/" --evaluator "Accessibility Reviewer" --evaluated-at "2026-08-23" --output .\audit-runs\quickstart\audit.json
node .\codex\skills\information-accessibility-practice\scripts\validate-assessment.mjs .\audit-runs\quickstart\audit.json
node .\codex\skills\information-accessibility-practice\scripts\render-audit-report.mjs --input .\audit-runs\quickstart\audit.json --output .\audit-runs\quickstart\audit-report.md
```

Creating `audit.json` does not mean the target was inspected. Until target-specific evidence and outcomes are added, the report is reference guidance that keeps unverified requirements visible. See the [five-minute guide](docs/getting-started.md) for macOS or Linux commands and the next steps.

Use template mode only when you need an editable placeholder rather than a validated record.

```powershell
node .\codex\skills\information-accessibility-practice\scripts\generate-assessment.mjs --template --profile web-modern --output .\audit-runs\quickstart\assessment.template.json
```

`--template` returns `TEMPLATE_CREATED` and is not a validated assessment or inspection result. Omit `--template` for normal record creation and provide the target name, version, reference, evaluator, and evaluation date.

A `reference_only` ledger produces **reference guidance**; it is distinct from an evidence-backed **inspection report**.

## Outputs

| Output | Purpose | Usual publication boundary |
| --- | --- | --- |
| Assessment JSON | Stores every profile row, evidence, outcome, and claim data | Internal; projected into a report after validation |
| Automated scan JSON | Stores axe findings and internal DOM or accessibility-tree evidence | Internal by default |
| Compact scan context | Provides bounded findings and unresolved candidates for AI review | Internal review material |
| Audit run | Stores target metadata, permissions, artifact hashes, and state transitions | Not public |
| Human-review queue | Lists requirements, procedures, and requested evidence for a person | Working material |
| Markdown report | Presents scope, judgements, remediation, and missing checks | Shareable after publication review |

The [artifact map](docs/architecture-and-glossary.md) lists the typical producer, inputs, purpose, and publication boundary for every artifact.

## Live Web inspection

`scan-web` uses pinned Playwright and axe-core versions to inspect a public URL without mutating it. Automated results are never promoted directly to formal WCAG or JIS pass or fail outcomes.

A short URL-based request may start with:

```text
Inspect the first screen of this site with the accessibility CLI.
https://example.com/
```

When no profile is named, the reviewer uses `web-modern` and accounts for all 55 WCAG 2.2 Level A and AA requirements through the report projection or a reasoned not-applicable entry. An initial ledger whose 55 rows remain `not_tested` is not completion; the result must include target evidence, barrier candidates, and the next human checks.

See the [Web inspection guide](docs/web-inspection.md) for dependencies, network and redirect controls, private-address rejection, output contracts, compact AI context, and Chromium E2E coverage.

## Detailed documentation

- [Getting started: first run and usage paths](docs/getting-started.md)
- [Runnable examples for all three paths](examples/README.md)
- [Architecture, responsibilities, artifacts, and bilingual glossary](docs/architecture-and-glossary.md)
- [Browser-based Web inspection and network boundaries](docs/web-inspection.md)
- [Agent orchestration for Codex](codex/skills/information-accessibility-practice/references/agent-orchestration.md)
- [Agent orchestration for Claude](claude/skills/information-accessibility-practice/references/agent-orchestration.md)
- [Standards assessment and evidence levels](codex/skills/information-accessibility-practice/references/standards-assessment.md)
- [Security policy](SECURITY.md)
- [Contribution guide](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Third-party attribution and terms](THIRD_PARTY_NOTICES.md)

## Evidence and claim boundary

AI agents that create or update profile requirement rows keep `mapping_status: "unverified"` and `outcome: "not_tested"`. Their observations remain `SCREEN-*` results or unverified handoffs. External human review may record `pass`, `fail`, `not_applicable`, or `cant_tell` only when it uses the applicable procedure and target-specific manual or hybrid evidence.

- AI and automated tools may create E0/E1 screening observations.
- Automated and static checks remain `screening_check` records, separate from standards `profile_requirement` rows mapped to primary sources by a person.
- Missing, uncertain, and not-applicable states remain visible and are never converted to pass by omission.
- Claim tiers such as `reference_only`, `screened`, and `evaluated_subset` cannot exceed the recorded evidence or the profile ceiling.
- Raw DOM, accessibility trees, private URLs, local paths, personal data, and authorization details remain internal unless an explicit publication policy permits them.
- The authorized fixer is optional. The standard CLI does not modify the audited target.

## Development and maintenance

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing the package. Verify Codex and Claude parity, schema compatibility, primary-source provenance, claim boundaries, and the full test suite.

```powershell
node .\scripts\verify-all.mjs
```

Do not place secrets or private evidence in a public issue. Follow [SECURITY.md](SECURITY.md) for security reporting.

## License

Original code and documentation use the [MIT License](LICENSE). Third-party standards metadata remains subject to its source terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
