[日本語](README.md) | English

# Information Accessibility Audit Skill and Agent

This Codex and Claude package helps review whether people can find information, understand it, and use it to complete their intended actions. It supports scope definition, inspection, evidence records, improvement proposals, and retesting after changes.

It covers websites, applications, documents, slides, videos, event announcements, and meeting operations.
Each review follows the whole journey: finding information, receiving and understanding it, completing the necessary action, and checking results or records later.

## Check and improve your own product

This package supports inspections that compare a website, application, or other product with WCAG or JIS success criteria, identify barriers, and guide improvements.
It provides natural-language requests and a repeatable CLI so that people can begin reviewing products without being accessibility specialists.
Results separate actionable improvements from items that need additional human review.

These results are not third-party certification or a formal declaration of WCAG or JIS conformance.
When formal conformance is the goal, the package can also organize the target, scope, environment, and evidence for each success criterion before human evaluation.
The current results alone cannot support a conformance declaration.
Human evaluation using the required procedures is still necessary.

Review results keep these two layers separate:

1. **Five perspectives on using information**: Uses Find, Receive, Understand, Participate (act), and Continue (check later) to record the journey from discovery through intended action and follow-up.
2. **Standards evidence records**: Store the target, standards profile, per-requirement outcomes, evidence strength, and allowed claim tier in JSON.

`web-modern` covers the 55 Level A and AA success criteria in [WCAG 2.2](https://www.w3.org/TR/WCAG22/).
A success criterion is a testable condition defined by the standard.

`jp-public-web` covers the 38 Level A and AA success criteria in [JIS X 8341-3:2016 (public guidance by WAIC)](https://waic.jp/docs/jis2016/understanding/201604/).
It also covers 18 Level A and AA success criteria introduced in WCAG 2.1 and 2.2.
These criteria were not part of WCAG 2.0, on which the 2016 JIS profile is based.
These 18 criteria are recorded separately from the 38 JIS criteria.

The `jp-public-web` profile therefore contains 56 checks.
The difference comes from Success Criterion 4.1.1, Parsing.
JIS includes 4.1.1.
[WCAG 2.2 removed this success criterion](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/).

Both profiles begin with every success criterion marked as not tested.
Target-specific evidence, catalog coverage, actual evaluation coverage, and the allowed claim tier are validated separately.

## Capabilities

- Review websites, apps, documents, videos, and event operations with checks suited to the target.
- Organize barriers with affected users, observed evidence, remediation, and a retest method.
- Start complete WCAG 2.2 or JIS X 8341-3 profile records with every requirement explicitly unevaluated.
- Generate JSON records and Markdown reports while preserving untested, indeterminate, failed, and evidence-strength states.
- Repeat validation and report generation through the CLI without overwriting existing artifacts by default.

## Choose a usage path

| Goal | Entry point | Best use |
| --- | --- | --- |
| Identify barriers and possible improvements | Skill or agent | Describe the target and purpose in natural language |
| Create WCAG or JIS records | Skill or agent plus CLI | Agree on scope, then preserve a complete checklist, evidence, and report |
| Repeat the same checks | CLI | Use it for scheduled checks, CI, and handoff-ready artifacts |
| Apply an authorized source change | Separate authorized fixer | Keep mutation outside the standard CLI and bind it to authorization and verification conditions |

When unsure, describe the target and what you need to learn.

```text
Review this website for information accessibility, separating observed barriers, possible improvements, and items that require human verification.
```

If the CLI is installed, list the available operations with:

```powershell
accessibility-audit --help
```

## Package layout

```text
codex/
  skills/information-accessibility-practice/
    package.json
    agents/openai.yaml
    assets/audit-report.template.md
    assets/assessment-record.template.json
    assets/waic-publication.template.md
    scripts/accessibility-audit.mjs
    scripts/generate-assessment.mjs
    scripts/render-audit-report.mjs
    scripts/show-requirement.mjs
    scripts/validate-assessment.mjs
    references/
  agents/
    information-accessibility-reviewer.toml
    information-accessibility-e1-inspector.toml
    information-accessibility-human-queue-planner.toml
    information-accessibility-remediation-planner.toml
claude/
  skills/information-accessibility-practice/
    package.json
    assets/assessment-record.template.json
    scripts/accessibility-audit.mjs
    scripts/generate-assessment.mjs
    scripts/render-audit-report.mjs
    scripts/show-requirement.mjs
    scripts/validate-assessment.mjs
    references/
  agents/
    information-accessibility-reviewer.md
    information-accessibility-e1-inspector.md
    information-accessibility-human-queue-planner.md
    information-accessibility-remediation-planner.md
scripts/verify-package.ps1
scripts/verify-package.mjs
scripts/install-codex.ps1
tests/claim-guard.test.mjs
tests/audit-workflow.test.mjs
tests/audit-report.test.mjs
tests/install-codex.test.mjs
tests/unified-cli.test.mjs
```

Each skill contains the reference files it reads at runtime.

```text
references/
  development-accessibility.md
  document-slide-accessibility.md
  event-community-accessibility.md
  standards-assessment.md
  standards-registry.json
  criteria-catalog.json
  criteria-catalog.schema.json
  criterion-procedures.json
  criterion-procedures.schema.json
  web-audit-methods.json
  web-audit-methods.schema.json
  aria-html-review.md
  aria-review-rules.json
  aria-review-rules.schema.json
  assessment-record.schema.json
  source-basis.md
```

## Reference files

`development-accessibility.md` is the reference for reviewing websites, applications, forms, dashboards, user interfaces, and development tasks. It covers headings, labels, link names, keyboard operation, focus order, error presentation, state changes, tables and charts, form input, and mobile presentation.

`document-slide-accessibility.md` is the reference for reviewing PDFs, Word documents, reports, slides, handouts, and announcement images. It covers heading structure, reading order, link names, tables, image descriptions, chart summaries, text extraction after PDF conversion, slide reading order, and whether dates or locations are trapped inside announcement images.

`event-community-accessibility.md` is the reference for reviewing events, meetings, seminars, community participation paths, and accommodation-request workflows. It covers advance information, venue access, online participation, accommodation requests, captions, transcripts, sign-language interpretation, microphone practices, chat and Q&A, material sharing, post-event summaries and records, and next actions.

`standards-assessment.md` defines how to fix the target, scope, and environment before a standards audit; generate a complete checklist; use five outcome types and evidence strengths E0 through E5; determine coverage; and guard claims.

`standards-registry.json` stores machine-readable versions, primary-source URLs, implementation status, requirement-catalog status, and claim ceilings for profiles including `web-modern`, `jp-public-web`, and `authoring-agent`.

`criteria-catalog.json` contains IDs, names, levels, primary-source URLs, applicability prompts, and evidence scaffolding for 55 WCAG requirements, 38 JIS requirements, and 18 additional WCAG requirements. It does not reproduce the standards text, and treats every entry as requiring human or hybrid evaluation.

`web-audit-methods.json` routes each of the 55 or 56 rows to one of 14 audit playbooks containing applicability decisions, reproducible procedures, required evidence, and `cant_tell` conditions. Legacy JIS-specific 4.1.1, Parsing, has a separate procedure. Every row requires opening its primary source and Understanding resource; outcomes are not inferred from titles alone.

`criterion-procedures.json` is a partial catalog for SC 1.1.1, SC 1.3.1, SC 2.1.1, and SC 4.1.2. It contains applicability conditions, procedures, expected results, required evidence, `cant_tell` conditions, counterexamples, and the boundary between AI and human review. Requirements absent from the catalog are not treated as executable, and every procedure requires external human review and target-specific evidence.

`show-requirement.mjs` returns only one specified requirement and its corresponding audit method. For requirements in the partial catalog, it also returns the requirement-specific human-review procedure; for requirements not included, it explicitly reports the procedure's absence. Use this script when evaluating an individual requirement instead of loading the full catalog into model context.

`aria-html-review.md` and `aria-review-rules.json` define 12 supplementary checks based on ARIA in HTML and WAI-ARIA. Their results are always recorded as `SCREEN-ARIA-*` and are not automatically converted into outcomes for WCAG 4.1.2 or other requirements.

`assessment-record.schema.json` and `assessment-record.template.json` keep the target, scope, environment, per-requirement outcomes, structured P0/P1/P2 findings, five gates, evidence, and requested claims separate. Every failed requirement must link to a finding with a location, affected users, observation, remediation, and retest method.

`render-audit-report.mjs` generates a standalone distributable Markdown audit report from a validated assessment record, explicitly showing not-evaluated, indeterminate, and failed results and the claim ceiling. It rejects invalid records and existing output files. `audit-report.template.md` is a template for manual additions.

`source-basis.md` describes the public primary sources used by the audit methods, the included scope, and copyright boundaries.

The skill selects the reference files needed for the target and uses them as concrete review criteria.

## Detailed usage

### Unified CLI

`accessibility-audit` is the common entry point for the existing scripts that manage audit runs, assessment records, registered artifacts, and reports.
It does not reimplement audit logic. It forwards arguments to fixed installed scripts with `shell: false`, preserving the same validation, no-overwrite behavior, and evidence boundaries as the individual CLIs.

Install the command from the skill folder.

```powershell
npm install --global .\codex\skills\information-accessibility-practice
accessibility-audit --help
```

Without a global installation, run the same entry point through Node.js.

```powershell
node .\codex\skills\information-accessibility-practice\scripts\accessibility-audit.mjs --help
```

| Command | Purpose |
| --- | --- |
| `init` | Create a new audit run with a fixed target, version, scope, and permissions |
| `assessment` | Create a complete assessment with every requirement initialized as `not_tested` |
| `requirement` | Show one registered requirement and its review method |
| `validate-run` | Validate an audit run and write a separate validation record |
| `validate-assessment` | Validate an assessment and its claim ceiling |
| `register` | Register a validated artifact in a new run version |
| `merge` | Merge registered artifacts into a new assessment |
| `report` | Create a new Markdown report from a validated assessment |
| `retest` | Create a new post-change run without overwriting the predecessor |

A minimal standalone assessment uses these three commands.

```powershell
accessibility-audit assessment --profile web-modern --target-name "Example" --target-version "2026-07-18" --target-ref "https://example.com/" --evaluator "external-human-review-required" --evaluated-at "2026-07-18" --output .\audit.json
accessibility-audit validate-assessment .\audit.json
accessibility-audit report --input .\audit.json --output .\audit-report.md
```

The standard CLI does not expose a command that mutates audited source.
Mutation remains available only through the separately installed authorized fixer when an external authorization fixes the target, change, before and after SHA-256 values, and verification commands.
`retest` requires `--supersedes-run` and starts a fresh audit without carrying prior evidence or outcomes forward.

Run an audit with a standards profile in this order:

1. Fix the target name, version, URL or file, included scope, exclusions, complete user process, third-party content, and test environment.
2. Generate a complete checklist.
3. Inspect the actual target only after using `show-requirement.mjs` to review the method and primary sources for each requirement. Profile requirement rows created or updated by AI agents remain `mapping_status: "unverified"` and `outcome: "not_tested"`; observations remain `SCREEN-*` results or unverified handoffs. External human review requires a requirement-specific procedure and target-specific manual or hybrid evidence; only then may the reviewer record `pass`, `fail`, `not_applicable`, or `cant_tell`. A `fail` must link to a finding with P0/P1/P2 priority, affected users, remediation, and a retest method.
4. Use the validator to check catalog coverage and evaluated coverage separately.
5. Generate a Markdown report with an overall judgement, criterion-level judgements, findings, unverified areas, and improvements. The judgement column uses only `適合`, `不適合`, `要確認`, or `未確認`; not-applicable criteria are listed separately with their rationale.

### Run-backed workflow

When several roles collaborate, create a read-only run and register candidates in this order: `screening-observations`, `human-review-queue`, and `remediation-plan`.
Each registration creates a new run file and does not modify the previous run or target files.
Then merge an E0 assessment whose profile rows remain formally unevaluated with all registered artifacts, and generate the unified report by specifying `--run` and `--assessment`.

The report shows the overall judgement, criterion-level judgements, improvements, pending checks, scope, and test environment. The overall judgement follows this order: `不適合`, `要確認`, `未確認`, then `適合`. AI inspection judgements appear in the improvement report but do not elevate `human_verified` profile outcomes or an organizational conformance statement.
Run IDs, artifact IDs, role IDs, transition history, and local paths remain in the internal run and are not emitted in the report.

Role assignments, artifact order, stop conditions, and the boundary with external human review are documented in the [agent orchestration reference for Codex](codex/skills/information-accessibility-practice/references/agent-orchestration.md) and the [agent orchestration reference for Claude](claude/skills/information-accessibility-practice/references/agent-orchestration.md).
The minimum command for generating a run-backed report is:

```powershell
node .\codex\skills\information-accessibility-practice\scripts\render-audit-report.mjs --run .\audit-run.json --assessment .\merged-assessment.json --output .\audit-report.md
```

```powershell
node .\codex\skills\information-accessibility-practice\scripts\generate-assessment.mjs --profile web-modern --output .\audit.json
node .\codex\skills\information-accessibility-practice\scripts\show-requirement.mjs --profile web-modern --id WCAG-2.2-SC-1.1.1 --format markdown
node .\codex\skills\information-accessibility-practice\scripts\validate-assessment.mjs .\audit.json
node .\codex\skills\information-accessibility-practice\scripts\render-audit-report.mjs --input .\audit.json --output .\audit-report.md
```

Run these commands from the root of this distribution package. After installing the skill, resolve `scripts` relative to the installed `information-accessibility-practice` folder. Use `--profile jp-public-web` for audits of Japanese public websites. Existing files are not overwritten.

On macOS and Linux, use `/` as the path separator.

```sh
node ./codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs --profile web-modern --output ./audit.json
node ./codex/skills/information-accessibility-practice/scripts/show-requirement.mjs --profile web-modern --id WCAG-2.2-SC-1.1.1 --format markdown
node ./codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs ./audit.json
node ./codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs --input ./audit.json --output ./audit-report.md
```

For Codex:

1. Place `codex/skills/information-accessibility-practice/` under the Codex `skills/` directory.
2. Place the four `.toml` files whose `install_by_default` value is `true` in `shared/agents/agent-manifest.json` under the Codex `agents/` directory.
3. The four default agents are `information-accessibility-reviewer`, `information-accessibility-e1-inspector`, `information-accessibility-human-queue-planner`, and `information-accessibility-remediation-planner`.
4. Use `information-accessibility-practice` for materials, web pages, user interfaces, event announcements, and other targets that need an information-accessibility review.

On Windows, you can use the manifest-aware installer with backups. `-WhatIf` only displays the selected agent IDs and all destinations; it does not create or modify `CodexHome` or `BackupRoot`.

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\install-codex.ps1" -WhatIf
powershell -ExecutionPolicy Bypass -File ".\scripts\install-codex.ps1"
```

If `CODEX_HOME` is set, the installer uses that location; otherwise, it installs to `~/.codex`. The default backup destination is the sibling area `codex-backups/information-accessibility-practice/<timestamp>/`, which does not overlap `CodexHome`. The existing skill is moved to its `skill/` directory, and existing manifest-managed agents are moved to `agents/<agent-id>.toml`. On a first installation with nothing to back up, the backup destination is not created. If installation fails partway through, only the replaced skill and selected agents are checked against the backup and restored; unrelated user agents are untouched.

The installer rechecks the final path and file ID of existing paths immediately before replacement and switches them by renaming within the same parent directory. It does not, however, use an operating-system lock to prevent another process from writing the same file content concurrently. Do not modify the same skill and agents with another installer or manually while installation is running.

The authorized fixer, `information-accessibility-authorized-fixer`, is not installed by default. It is a read-only handoff agent installed only when `-IncludeAuthorizedFixer` is specified, and it has neither general command authority nor direct write authority. It confirms external authorization, the target, proposed changes, and verification commands, then creates a structured handoff. A trusted operator decides whether to apply the actual changes through the deterministic transaction runtime.

For Claude:

1. Place `claude/skills/information-accessibility-practice/` under the Claude `skills/` directory.
2. Place `claude/agents/information-accessibility-reviewer.md` under the Claude `agents/` directory.
3. Use `information-accessibility-reviewer` for the target to be reviewed for information accessibility.

## Detailed review coverage

- Review the readability of headings, labels, link names, keyboard operation, focus order, error presentation, state changes, and tables and charts in websites, applications, forms, and dashboards.
- Review heading structure, reading order, link names, tables, image descriptions, chart summaries, and text extraction and reading order after PDF conversion in PDFs, Word documents, slides, and handouts.
- Check announcement images, social-media posts, flyers, and event pages to ensure dates, locations, participation conditions, sources for updates, registration methods, and accommodation-request contacts are not available only in images.
- Check videos, audio, and archives for captions, transcripts, summaries, material links, publication locations, and ways to revisit the content.
- Check events, meetings, and seminars for venue guidance, online participation, microphone practices, chat and Q&A, captions, sign-language interpretation, material sharing, published records, and contact paths.
- Check community participation paths to ensure first-time participants can find the necessary location, schedule, materials, roles, contact points, and next actions without confusion.
- Check accommodation-request workflows for the request method, deadline, available support, handoff to responsible staff, privacy handling, and on-the-day operation.
- Identify constraints that require confirmation before implementation, including laws, venue conditions, contracts, personal information, and publication scope.

When WCAG, JIS, ATAG, or another standard is requested, the following rules govern the evidence and the claims that may be made from it.

- In reviews using WCAG, JIS, ATAG, or another specified standard, fix the target, version, scope, and environment, and record AI observations as `SCREEN-*` results or unverified handoffs. Only external human reviewers with requirement-specific procedures and target-specific manual or hybrid evidence record profile-requirement outcomes.
- Separate automated and static checks as `screening_check` from standards requirements mapped to primary sources by a person as `profile_requirement`.
- Classify automated or lightweight checks, requirement reviews, real-device and assistive-technology tests, and third-party audits as E0 through E5.
- Reject E4 or E5 unless the scope and report owner for an independent audit, or the responsible party and deliverable for a legal or procurement dossier, are recorded.
- Mechanically reject prohibited certification wording, unsupported `pass` results, unexplained `not_applicable` results, and claims that conceal unverified areas.

## Review perspectives

Regardless of the target type, each review separates the information-use journey into these five perspectives:

1. **Find**: Can the people who need the information find it without confusion?
2. **Receive**: Can they receive it through text, audio, images, assistive technology, or saved records in a form that works for them?
3. **Understand**: Are the structure, sequence, wording, dates, links, colors, charts, and technical terms understandable?
4. **Act (Participate)**: Can they use the information to ask questions, register, use the service, request accommodations, attend an event, or complete another intended action?
5. **Check later (Continue)**: Can they later find summaries, materials, records, decisions, and next actions?

## Example requests

```text
Review this event announcement page for information accessibility.
```

```text
This slide deck will be shared as a PDF. Check its reading order, chart descriptions, links, and ways to revisit the content later.
```

```text
Check this registration form for problems with labels, error messages, the accommodation-request field, and guidance after submission.
```

```text
Identify gaps in this meeting plan regarding captions, microphone practices, question channels, material sharing, and archive publication.
```

```text
Inspect this web application from the WCAG 2.2 perspective and create a report with an overall judgement and criterion-level judgements. Use only `適合`, `不適合`, `要確認`, or `未確認` in the judgement column.
```

```text
For this website intended for Japan, record JIS X 8341-3:2016 and the additional WCAG 2.2 requirements separately, and state the strongest wording supported by the evidence.
```

## Example output

Standards-based inspections such as WCAG use the following unified report format from the start.

```markdown
# WCAG Inspection Report

> Notice: these report judgements are inspection results for the recorded scope and evidence. They are not third-party certification, a legal determination, or a formal organizational conformance statement.

## Overall judgement

- Overall judgement: 不適合

| Success criterion | Judgement | Evidence or missing check |
| --- | --- | --- |
| WCAG 2.2 1.1.1 | 不適合 | The alternative text does not convey the purpose of the image. |
```

To create a standards evidence record, generate every row for the target profile before validation. Records created by AI keep profile requirements unverified. A profile requirement is evaluated only when an external human reviewer records requirement-specific procedures and target-specific manual or hybrid evidence. From the distribution-package root, run:

```powershell
node .\codex\skills\information-accessibility-practice\scripts\generate-assessment.mjs --profile web-modern --output <assessment.json>
node .\codex\skills\information-accessibility-practice\scripts\validate-assessment.mjs <assessment.json>
```

The validator does not invent new report judgements. It detects JSON inconsistencies, catalog coverage, evaluated coverage, and claim-ceiling violations. The report renderer combines validated formal outcomes and AI report-only judgements, then displays exactly `適合`, `不適合`, `要確認`, or `未確認`. Use `profile_outcome_counts` and `screening_outcome_counts` for machine-readable summaries. `outcome_counts` is a backward-compatible total across all result types and must not be used to summarize standards requirements. Because complete executable procedures for every requirement are not yet available, the current version permits `proposed_wording` only when it exactly matches the registered fixed Japanese or English template for the relevant stage.

## Verification

Run the following commands in the distribution package:

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\verify-package.ps1"
node ".\scripts\verify-package.mjs"
node --test ".\tests\claim-guard.test.mjs"
node --test ".\tests\audit-workflow.test.mjs"
node --test ".\tests\criterion-procedures.test.mjs"
node --test ".\tests\audit-report.test.mjs"
node --test ".\tests\install-codex.test.mjs"
node --test ".\tests\unified-cli.test.mjs"
node ".\scripts\build-criteria-catalog.mjs" --check
```

`verify-package.ps1` and the cross-platform `verify-package.mjs` verify relative paths, SHA-256 hashes, JSON parsing, and matching agent instruction bodies across the Codex and Claude skills.

### Maintaining the requirement catalog

Use `--check` for routine verification.
This command does not access the network. It checks the saved Codex and Claude versions for byte-for-byte equality, counts, and consistency with registry IDs.

When refreshing candidates from primary sources, specify an output destination separate from the existing catalog.
`--refresh` connects to three primary sources and refuses to overwrite an existing file.

```powershell
node ".\scripts\build-criteria-catalog.mjs" --refresh --verified-at YYYY-MM-DD --output ".\criteria-catalog.candidate.json"
node ".\scripts\compare-criteria-catalog.mjs" --current ".\codex\skills\information-accessibility-practice\references\criteria-catalog.json" --candidate ".\criteria-catalog.candidate.json"
```

The comparison reports primary-source hash changes, added and removed requirements, name or level changes, and audit-procedure routing changes separately.
Before applying a candidate to the authoritative catalog, a person must review the comparison and the primary sources.

## Claims and limitations

This project provides evidence-oriented accessibility assessment records referencing WCAG 2.2 and JIS X 8341-3:2016. It references ATAG 2.0 Part B for authoring support. The project itself does not provide certification by W3C, JIS, ISO, Section 508, or any law or regulation.
The current claim ceiling is `evaluated_subset`.

The principal areas not currently implemented are:

- Complete executable test procedures, including applicability conditions, expected results, and concrete examples, for every WCAG 2.2 Level A and AA and JIS X 8341-3:2016 requirement
- A complete ATAG 2.0 Part B requirement catalog and authoring-support feature map
- Determinations up to `evaluated_complete`, `conformance_candidate`, or formal conformance or compliance wording
- EN 301 549, Section 508, PDF/UA-2, EPUB Accessibility, and organizational profiles
- Automated generation of E3 evidence through real-device and assistive-technology tests, third-party audits, and legal or procurement decisions

## License

MIT License. You may use, modify, and redistribute this project for personal or commercial purposes. See [LICENSE](LICENSE) for details.
