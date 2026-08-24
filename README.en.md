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
| **Standalone assessment** | A complete WCAG or JIS ledger for one bounded snapshot | Assessment JSON and a profile-aware Markdown or HTML inspection report | Every profile row starts as `not_tested`; initialization is not completed inspection |
| **Run-backed audit** | Track screening, human review, remediation, and retesting | Audit run, registered artifacts, merged assessment, report | Requires understanding the schema and artifact relationships |

See the [architecture and glossary](docs/architecture-and-glossary.md) for the complete flow. Use the [runnable examples](examples/README.md) to execute all three paths.

## Supported targets and current limits

| Target | Natural-language review | Structured screening or standards ledger | Current limit |
| --- | --- | --- | --- |
| Website or Web application | Supported | `web-modern`, `jp-public-web`, read-only `scan-web` | A real screen-reader session remains an external human or host capability |
| PDF, Word document, or slide deck | Supported | Guidance-oriented | No active dedicated profile or formal claim path |
| Video or audio | Supported | Relevant Web requirements inside a named Web scope | No standalone media profile |
| Event, meeting, or community process | Supported | Review through five information-use perspectives | No dedicated structured assessment yet |
| ATAG or authoring process | Reference guidance | Partial reference information | The `authoring-agent` profile is currently inactive |

`web-modern` covers 55 WCAG 2.2 Level A and AA requirements from [WCAG 2.2](https://www.w3.org/TR/WCAG22/). `jp-public-web` contains 38 Level A and AA requirements from [JIS X 8341-3:2016 guidance by WAIC](https://waic.jp/docs/jis2016/understanding/201604/) plus 18 Level A and AA requirements introduced in WCAG 2.1 and 2.2, for 56 checks in total. JIS retains 4.1.1, Parsing, which [WCAG 2.2 removed](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/). Catalog coverage and actual evaluation coverage are recorded separately.

## Requirements and installation

- Node.js 20 or later
- A local copy of this repository
- The pinned Playwright, axe-core, and Chromium versions only when using the browser scan

### Codex

On Windows, use the manifest-aware installer.

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\install-codex.ps1" -WhatIf
powershell -ExecutionPolicy Bypass -File ".\scripts\install-codex.ps1"
```

Specify `-IncludeAuthorizedFixer` only when deliberately installing authorized remediation. The authorized fixer is a read-only handoff agent and does not modify the target. A trusted operator performs the actual bounded change, verification, and rollback after checking external authorization.

On macOS or Linux, copy `codex/skills/information-accessibility-practice/` and the manifest-default agents. See [Getting started](docs/getting-started.md).

### Claude

Use `shared/agents/agent-manifest.json` entries with `install_by_default: true` as the source of truth, and install the skill with these four default agents:

- `information-accessibility-reviewer`
- `information-accessibility-e1-inspector`
- `information-accessibility-human-queue-planner`
- `information-accessibility-remediation-planner`

```powershell
node .\scripts\install-claude.mjs --dry-run
node .\scripts\install-claude.mjs
```

The multi-agent installation preserves the same role artifact contract as Codex. Use `--reviewer-only` only when the Claude host cannot dispatch specialist agents.

### CLI

```powershell
npm install --global .\codex\skills\information-accessibility-practice
accessibility-audit --locale en --help
accessibility-audit --version
accessibility-audit profiles list --locale en
accessibility-audit requirements search "focus" --profile web-modern --level AA --locale en
accessibility-audit screen-reader-checklist --pattern modal-dialog --locale en --format markdown
accessibility-audit doctor --locale en
```

`--locale ja` and `--locale en` change only human-readable CLI help, profile metadata, requirement list/search/show output, the legacy requirement view, the screen-reader checklist, and reports. Internal IDs, schema keys, enum values, evidence types, and claim tiers remain stable.

These discovery commands are read-only. The standard CLI does not modify the audited target.

## Try it in five minutes

The following example initializes all 55 WCAG 2.2 Level A and AA requirements as `not_tested`, validates the ledger, and creates a profile-aware English report.

```powershell
node .\codex\skills\information-accessibility-practice\scripts\accessibility-audit.mjs assessment --profile web-modern --target-name "Example Site" --target-version "2026-08-24" --target-ref "https://example.com/" --evaluator "Accessibility Reviewer" --evaluated-at "2026-08-24" --output .\audit-runs\quickstart\audit.json
node .\codex\skills\information-accessibility-practice\scripts\accessibility-audit.mjs validate-assessment .\audit-runs\quickstart\audit.json
node .\codex\skills\information-accessibility-practice\scripts\accessibility-audit.mjs report --input .\audit-runs\quickstart\audit.json --locale en --output .\audit-runs\quickstart\audit-report.md
```

Creating the ledger does not mean the target was inspected. Until target-specific evidence and outcomes are added, every row remains `Not tested` and `Not run`. At this stage, the document is reference guidance; it is distinct from an inspection report backed by target-specific evidence and judgements.

Each report row shows the criterion number, localized title, level, profile group, primary source, judgement source, evidence level, and rationale. A Run-backed report distinguishes External human review, AI/automated screening, and Not run. A screening projection is a report-only judgement and is never promoted to a profile outcome.

`--locale ja` and `--locale en` change human-readable text only; internal IDs, schema keys, and enum values remain stable. The claim section shows the requested tier, validator maximum, registry-fixed wording, and limiting reasons.

`--format markdown` is the default editable and diff-friendly format. `--format html` produces accessible HTML for direct browser distribution. Both support `--detail summary` or `--detail full`, a same-format complete `--appendix`, and `--visibility internal` or `--visibility public`.

PDF is unsupported because there is no formally verified tagging and reading-order path. See [Report formats and accessibility](docs/report-formats.md) for HTML semantics, generated-output E2E, the NVDA smoke test, and remaining external checks.

Use template mode only for an editable placeholder.

```powershell
node .\codex\skills\information-accessibility-practice\scripts\generate-assessment.mjs --template --profile web-modern --output .\audit-runs\quickstart\assessment.template.json
```

`render-audit-report.mjs` remains a legacy-compatible direct renderer for existing users. The canonical route for profile, provenance, locale, and claim presentation is `accessibility-audit report`.

## Outputs

| Output | Purpose | Usual publication boundary |
| --- | --- | --- |
| Assessment JSON | Stores every profile row, evidence, outcome, and claim data | Internal; projected into a report after validation |
| Automated scan JSON | Stores axe findings and internal DOM or accessibility-tree evidence | Internal by default |
| Compact scan context | Provides bounded barrier candidates for AI review | Internal review material |
| Audit run | Stores target metadata, permissions, artifact hashes, and state transitions | Not public |
| Human-review queue | Lists requirements, procedures, and requested evidence for a person | Working material |
| Markdown report | Presents profile, judgement, provenance, claim, remediation, and missing checks | Shareable after publication review |
| HTML report | Provides `lang`, landmarks, contents, a skip link, and table semantics for distribution | Shareable after public visibility processing and publication review |

The [artifact map](docs/architecture-and-glossary.md) lists the typical producer, inputs, purpose, and publication boundary for every artifact. See the [report-format guide](docs/report-formats.md) for format-specific support.

## Live Web inspection

`scan-web` uses pinned Playwright and axe-core versions to inspect a public URL without mutating it. Automated results are never promoted directly to formal WCAG or JIS pass or fail outcomes.

```text
Inspect the first screen of this site with the accessibility CLI.
https://example.com/
```

See the [Web inspection guide](docs/web-inspection.md) for dependencies, network and redirect controls, private-address rejection, output contracts, compact AI context, and Chromium E2E coverage.

## Detailed documentation

- [Getting started: first run and usage paths](docs/getting-started.md)
- [Runnable examples for all three paths](examples/README.md)
- [Report formats, HTML accessibility, and verification boundaries](docs/report-formats.md)
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

AI agents that create or update profile requirement rows keep `mapping_status: "unverified"` and `outcome: "not_tested"`. Their observations remain `SCREEN-*` results or unverified handoffs.

- AI and automated tools may create E0/E1 screening observations.
- Automated and static checks remain `screening_check` records, separate from standards `profile_requirement` rows.
- Only external human review using an applicable procedure and target-specific evidence may record a profile outcome.
- Claim tiers such as `reference_only`, `screened`, and `evaluated_subset` cannot exceed the recorded evidence or the profile ceiling.
- Raw DOM, accessibility trees, private URLs, local paths, personal data, and authorization details remain internal unless an explicit publication policy permits them.
- Report judgement terms are not third-party certification, a legal determination, or a formal conformance declaration.

## Development and maintenance

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing the package. Run the full verification command:

```powershell
node .\scripts\verify-all.mjs
```

Do not place secrets or private evidence in a public issue. Follow [SECURITY.md](SECURITY.md) for security reporting.

## License

Original code and documentation use the [MIT License](LICENSE). Third-party standards metadata remains subject to its source terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
