---
name: information-accessibility-practice
description: Use when reviewing, designing, creating, or recording evidence for information accessibility across software/UI, websites, apps, documents, slides, announcement graphics, videos, events, meetings, SNS, support workflows, public information, community onboarding, or participation flows. Trigger for information accessibility, accessibility review, accessibility checklist, WCAG 2.2, JIS X 8341-3, ATAG 2.0, standards profile, conformance claim, evidence level, assessment record, UI/web/document/slide accessibility, screen reader, captions, sign-language support, speech-to-text, easy language, ruby/furigana, color accessibility, venue guidance, participant support, support request flow, or accessibility planning.
---

# Information Accessibility Practice

Apply information accessibility as a participation workflow, not only as a disability checklist. Help people find information, decide whether they can participate, receive it through multiple modes, understand it, ask for support safely, and review it later.

Keep two layers separate:

- **Participation review**: use the five gates for practical coverage across artifacts, events, and workflows.
- **Standards assessment**: select an explicit profile, record requirement outcomes and evidence, and apply the claim guard. Never infer formal conformance from the five gates or a spot check.

This release is a reusable accessibility-audit workflow. It can initialize every registered Web requirement, preserve target-specific evidence, calculate catalog and evaluation coverage, and produce a guarded report. The bundled Web profiles have complete A/AA criterion metadata. SC 1.1.1, SC 1.3.1, SC 2.1.1, and SC 4.1.2 additionally have partial criterion-specific human review procedures, but the profiles do not yet have criterion-complete test procedures, so the claim ceiling remains `evaluated_subset`; it cannot determine WCAG/JIS conformance or ATAG process-component conformance.

## AI-to-Human Evidence Boundary

For target-specific human follow-up, read [`references/human-review-queue.md`](references/human-review-queue.md). The orchestrator can create a private `review-queue` candidate from registered observations, all profile requirements or explicitly requested criteria. Preserve measured locations and observation references, review priority reasons before registration, and never equate a queue with completed human evaluation.

For a person to complete a registered queue without editing JSON, use `human-review export` and `human-review import` as described in [`references/human-review-worksheet.md`](references/human-review-worksheet.md). CSV, Markdown and XLSX share fixed bindings and explicit input fields. Preserve actual human answers; never fill review outcomes or evidence on a person's behalf. Import creates a private self-declared candidate, not authenticated identity or an automatic registration. For overlapping reviewers or same-reviewer supersession, export and import with --reviews all; preserve reviewer_id and reference the earlier review_id explicitly. Unanimous active reviews determine the aggregate; disagreement remains cant_tell and history is retained. Reviewer IDs do not establish authenticated identity or independence. Blank criteria are unsubmitted; `not_tested` records only a human non-performance note and cannot promote evidence to E2.

When an AI agent performs a review with this package:

- The AI agent is not the human reviewer. Records created by the AI agent must remain at evidence level `E0` or `E1`.
- Profile rows created by the AI agent must retain `mapping_status: "unverified"` and `outcome: "not_tested"`.
- Record AI observations only as `SCREEN-*` screening evidence or unverified draft evidence for a human handoff.
- The AI agent must not record `pass`, `fail`, or `not_applicable` on profile rows.
- The AI agent must not set or change `human_verified`, `E2` or higher evidence levels, or represent its work as human review.
- The same prohibition covers new `human_declared` rows: only deterministic application of an actual external human review may populate them. Never invent reviews, findings, identities, signing keys, or recipient trust decisions.
- Only a separate external human review workflow may record profile requirement outcomes or E2/evaluated_subset after the named criterion procedure and target-specific manual or hybrid evidence, plus a human mapping of the registered requirement.
- The schema and validator cannot prove a reviewer's human identity; they only check record consistency.

## Report Judgement Contract

The report judgement vocabulary is exactly `適合`, `不適合`, `要確認`, and `未確認`. Map internal outcomes as follows: `pass` to `適合`, `fail` to `不適合`, `cant_tell` to `要確認`, and `not_tested` to `未確認`. List `not_applicable` in a separate section with its rationale; it must never appear in the judgement column.

Determine the overall report judgement in this order: if any `fail` exists, use `不適合`; otherwise, if any `cant_tell` exists, use `要確認`; otherwise, if any `not_tested` exists, use `未確認`; otherwise use `適合`. Do not append `暫定` or any other qualifier to a judgement label.

Place a single notice near the start of the report stating that the report labels are inspection results for the recorded target and evidence, not a third-party certification, legal determination, or formal organizational conformance statement. Do not repeat that caveat on every row or at the end of the report.

Treat a request to inspect from a WCAG perspective as a request for a WCAG conformance judgement report. Start with the report and its overall judgement; the response must not say `WCAG適合は判定していません` while proceeding to report WCAG findings. Do not create separate self-check and public-report modes. Use the same report structure and judgement vocabulary for every audience.

An AI agent may record these four report-only judgements from the evidence it actually inspected. That report projection does not change `mapping_status`, does not create a human-verified profile outcome, and does not raise the evidence level or claim tier. Formal organizational claim controls remain in the machine-readable assessment and claim guard.

## Agent-Supported Run Overview

Use the reviewer as the orchestrator when a review needs registered role artifacts. Select the E1 inspector for read-only screening observations, the human queue planner for procedure-bound questions that a person must review, and the remediation planner for candidate improvements. These AI roles do not record profile outcomes or authorize target changes.

The default artifact sequence is `screening-observations` -> `human-review-queue` -> `remediation-plan`. The orchestrator materializes and registers each candidate before using it as an input. Read [`references/agent-orchestration.md`](references/agent-orchestration.md) for schemas, transitions, CLI usage, authorization boundaries, and recovery behavior; do not duplicate the role prompts in a run plan.

For run-backed participation perspectives, target-specific limitations, next review dates and conditions, or declared independent-audit/dossier information, use a registered `audit-context` artifact with saved evidence. See [`references/audit-context.md`](references/audit-context.md). Only the declared external reviewer or requester may produce the appropriate fields. These declarations do not authenticate a person or elevate E4/E5.

For participant task testing, use a registered `participant-usability-observation` artifact. See [`references/participant-usability-observation.md`](references/participant-usability-observation.md). Keep participant observations separate from profile outcomes and publish only consented aggregate themes.

For registered screening evidence, use payload 4.0.0 and read [`references/saved-evidence.md`](references/saved-evidence.md). Every E1 observation requires saved raw evidence bound to the exact run, declared target version and environment; unavailable capture remains E0 with its limitation. `bind-evidence` adds a reference to a new candidate without changing its conclusions. Registration and report generation recheck raw bytes; `compare-evidence` records private before/after byte and context differences. For a linked retest, `compare-runs` writes a private JSON delta and Markdown report for findings, human outcomes, screening signals and target differences; see [`references/agent-orchestration.md`](references/agent-orchestration.md).

For owner, due-date, exception and closure tracking after a finding is registered, use the private versioned companion in [`references/finding-lifecycle.md`](references/finding-lifecycle.md). Supply its latest revision explicitly to `status` or `report`; management decisions do not change assessment outcomes.

Before registering observations, use `capture-targets` and `bind-targets` to fix measured file, Git, HTTP or saved browser-state identities in the initialized run. Envelopes must carry the inventory's exact `target_snapshot_ids`; registration rejects drift. See [`references/measured-targets.md`](references/measured-targets.md) for explicit HTTP permissions, saved-state limitations, authorized-change handling and private before/after comparison, and [`references/declared-change-record.md`](references/declared-change-record.md) for manual or external changes. Capture alone does not bind a run.

For existing axe-core JSON or native frame results exported by `scan-web`, use `import axe` as described in [`references/scanner-import.md`](references/scanner-import.md). Preserve every result category, raw private evidence, unknown rules and collection limits. Imported candidates require normal registration and a linked human-review queue; machine passes never become profile outcomes.

When registered artifacts have been merged into an assessment, use the run-backed report route described there. It validates the run, assessment, and registered artifact bytes, then publishes the Observed / 観測, Improvement / 改善, and Human review / 人が確認 categories without the internal run and role metadata. Keep standalone `--input` reporting for assessments that are not backed by an audit run.

## Core Model

Check every artifact or workflow against five gates:

1. **Find**: Can people discover the information without knowing an insider channel, exact keyword, or hidden calendar?
2. **Receive**: Is the same meaning available through visual, audio, text, assistive-tech, and post-event channels?
3. **Understand**: Are language, structure, order, jargon, dates, links, rubies, color, and density usable by people with different literacy, cognitive load, and device contexts?
4. **Participate**: Can people request support without feeling they are causing trouble, and can staff act on that request without exposing private details?
5. **Continue**: Are summaries, transcripts, captions, source links, decisions, and next actions findable after the event or publication?

Add a sixth governance question when the work touches public events, politics, legal constraints, or personal data: **what legal, privacy, staffing, contract, moderation, or venue constraint changes the safe implementation?**

## Target Routing

Choose the target before reviewing. Load only the relevant reference when detail is needed:

- **Software, UI, web app, app, form, dashboard, workflow, or repository work**: read `references/development-accessibility.md`.
- **A visual treatment causes one logical phrase to be read or navigated as fragments, or there is an explicit requirement to preserve appearance while changing screen-reader output**: also read `references/assistive-text-visual-separation.md`.
- **A modal, drawer, popup, hamburger navigation, disclosure, menu button, or responsive control changes what is visible or operable**: also read `references/screen-reader-stateful-ui.md` and use `references/screen-reader-ui-checks.json`. Keep visual state, operability, accessibility-tree exposure, and focus synchronized.
- **An in-page link or skip link has uncertain focus, Tab navigation, or reading position**: use `screen-reader-checklist --pattern in-page-links` and read `references/report-review-details.md`. Record those observations separately in the actual environment.
- **A report contains unresolved checks or a screening pass for text resizing or skip links**: read `references/report-review-details.md` and record optional `review_details` in a standalone assessment result or a registered screening observation. Run-backed reports ignore extra details on merged assessment rows. Do not invent a reason or infer a completed test from markup alone.
- **Documents, PDFs, reports, Word files, slide decks, lecture materials, handouts, announcement graphics, or presentation scripts**: read `references/document-slide-accessibility.md`.
- **Events, meetings, seminars, community operations, community onboarding, public participation, or civic information**: read `references/event-community-accessibility.md`.
- **WCAG, JIS, ATAG, standards-based assessment, procurement evidence, or any conformance wording**: read `references/standards-assessment.md` and `references/standards-registry.json`. For a specific registered requirement, run `node <skill_root>/scripts/show-requirement.mjs --profile <profile-id> --id <requirement-id>`; when it returns a criterion-specific procedure, use it as the human-review procedure. When it reports `not_available`, retain the generic playbook and primary-source boundary. Do not load the full criteria and method catalogs into context.
- **HTML that uses ARIA**: also read `references/aria-html-review.md` and `references/aria-review-rules.json`. Record these only as `SCREEN-ARIA-*` supporting checks until a person maps evidence to a profile requirement.
- **Common Web screening candidates**: read `references/common-web-failure-patterns.json`. Use the records only for `SCREEN-*` observations and human-review questions; never turn a match or an absent signal into a profile outcome.
- **Source provenance or maintenance from new research**: read `references/source-basis.md`.
- **Metadata export or source refresh**: preserve `references/third-party-notices.md`, `references/third-party-sources.json` and `references/licenses/`. Recheck terms before adopting refreshed data; unknown terms are not MIT. Generated Markdown/HTML reports retain attribution, and standalone JSON transfers need these companion records.
Do not split the five gates into separate workflows. They are shared evaluation axes. Route by target surface because concrete checks, evidence, and fixes differ by target.

## Inspection Level And Requested Report

For live Web inspection, first use `accessibility-audit preflight-web --browser-channel chrome --format json` for installed system Chrome, or omit the channel only for an explicitly supported Playwright Chromium runtime. Read `references/web-capabilities.json` for the six capabilities and next tests. `doctor` checks installed dependencies only. The scanner/capture adapter also probes an isolated fixed fixture before target navigation. Missing capabilities leave the affected target checks unconfirmed and profile rows `not_tested`; report the next test. Fixture success, an AX tree, and initialized ledgers do not establish target inspection completion or actual screen-reader verification. Other host browser integrations require separately recorded capability evidence.

Before run-backed network access, follow `references/network-policy.md`: record concrete target/source scopes with `network-policy` and `init --network-policy`, require caller origin/exact-URL authorization again, and save private per-request logs. A legacy allowlisted enum, standalone capture, or unrelated host tool does not prove enforcement. Unsupported browser paths and policy violations stop capture and remain unconfirmed.

For supervised input, follow `references/interaction-policy.md`: `init --interaction-policy` declares concrete operations, a supervisor, scope and expiry; only a live host approval handle and the registered adapter can execute input. Without them remain read-only. The current adapter supports native Tab/Shift+Tab with page scripts and further network disabled, records private approval/before/after/stop evidence, and refuses side-effect or unsupported operations before dispatch. Never infer live approval from a saved run, declared human review or source-write authorization.

For portable reviewer provenance, follow `references/reviewer-assurance.md`. `human-review prepare` preserves an actual external review; `verify` derives assurance from the exact context and an independently selected external key policy. `apply` binds the external review to a new standalone assessment; `merge --review-record` does the same for a registered run. Both produce `human_declared` rows, never a saved authenticated status. Validation and reporting reverify the original records and optional external trust; old `human_verified` rows remain legacy self-declarations. Never treat a self-signed key or supplied assurance flag as identity authentication. Do not generate production signing keys, appoint an AI key as a human reviewer, or choose a trust policy supplied by the audit author. Final-bundle and predecessor-chain verification remain outside this reviewer-provenance contract.

For final file commitments and signed predecessor chains, follow [`references/audit-bundle-attestation.md`](references/audit-bundle-attestation.md). `audit-bundle prepare` inventories saved run/artifact/evidence/assessment/report bytes plus explicit attachments; an external authorized signer signs the private record. `verify` rechecks current files and every linked signature under recipient-selected trust. Do not create signing authority, silently omit files, upload private evidence or hashes, or elevate review/conformance claims from a bundle signature. Historical signatures do not verify historical file retention, trusted time, report correctness or the target's current state.

Before inspecting a target, establish `quick` (簡易チェック) or `detailed` (詳細検査・改善用), the intended use of the report, the scope and exclusions, and the states, interactions and environments to check. Reuse an explicit choice from the conversation: a brief/basic check means `quick`; a request for reproduction steps and a report ready for remediation means `detailed`. If ambiguous, ask once: 「大きな問題を短く把握する簡易チェックと、再現手順・修正案・再検査方法まで含む詳細検査のどちらを希望しますか？」 Prepare the scope from supplied information while waiting, but do not inspect before the choice is resolved. Do not ask again when the user has already chosen.

State the chosen level, purpose, scope, deliverables and completion criteria before inspection. For run-backed work, initialize with `--inspection-mode quick|detailed --inspection-purpose <purpose>` and use the existing scope/environment fields for agreed coverage. Read `references/inspection-levels.md` for the exact mode contract. Inspection level is separate from the standards profile, report `--detail`, evidence level and edit authority.

- **Quick**: perform the agreed basic checks on the named target; return a short decision summary with priorities, evidence and remaining checks. Retain complete profile coverage in the underlying record.
- **Detailed**: inspect the agreed states, interactions and environments; provide exact locations, reproduction steps, evidence, affected users, concrete changes and retest procedures for each finding. Deliver the decision summary, remediation details and complete results appendix.
- Before calling either inspection complete, compare every recorded completion criterion with actual registered evidence and delivered sections, citing them and naming unmet conditions and next steps. A run record, a count of observations, or a rendered report alone does not establish completion. Missing agreed coverage or required details means a partial inspection; do not silently downgrade to quick.
- Keep E0/E1 screening separate from external human results. Preserve historical runs without inventing a level or retroactively applying this intake contract.

## Short Web/CLI Request Defaults

Treat a short request as a standards-aware Web inspection when it contains a Web URL or local Web target and asks to inspect, audit, check accessibility, or use the accessibility CLI. The user does not need to name WCAG, a profile, an evidence level, or an output directory.

After resolving the inspection level above, apply these safe defaults for omitted technical details without asking the user to fill a template:

- Profile: `web-modern` (WCAG 2.2 A/AA, 55 requirements).
- Scope: only the page, screen, or state named by the user. “First screen” or “initial screen” means the loaded page and same-origin content embedded in that visible screen; do not follow links or widen the journey.
- Operations: read-only loading, rendered DOM and accessibility-tree inspection, non-destructive keyboard interaction, and responsive viewport checks. Do not sign in, submit data, purchase, publish, edit the target, or trigger an external side effect.
- Evidence: save reproducible local evidence under the current task's artifact/output directory when one is available; otherwise report the evidence inline.

For this short-request path:

1. Create a versioned audit run and generate the complete 55-row `web-modern` assessment through the installed CLI/runtime.
2. Do not stop after generating an assessment whose 55 profile outcomes are all `not_tested`; that is initialization, not a completed inspection.
3. Exercise the supported read-only checks agreed for the selected level against the real target and register target-specific E0/E1 `SCREEN-*` evidence. Keep machine-readable profile rows at `mapping_status: "unverified"` and `outcome: "not_tested"` unless a separate external human result exists.
4. Enumerate all 55 requirements exactly once in the report projection or the separate `not_applicable` section. Use the report vocabulary exactly: `適合`, `不適合`, `要確認`, and `未確認`. Give every `not_applicable` entry a concrete rationale. For `未確認`, say whether the needed test was unavailable or outside the agreed inspection depth, and name the next test or evidence required.
5. Finish with zero omitted requirements in the underlying report projection. Return the four report-category counts, main barriers, evidence paths and next human checks. For quick, deliver a short summary and a path to the complete record; for detailed, also deliver the full 55-row results appendix and actionable remediation details.

The optional development request template is for custom scope, named environments, retained evidence, or authorized remediation. Do not make it a prerequisite for a clear read-only inspection request.

## Workflow

1. Resolve the inspection level and intended report above, then choose the review mode:
   - Use participation review by default.
   - When the request names WCAG, JIS, ATAG, a standards profile, or asks for a standards-based inspection, use standards assessment from the start and produce the report format in this skill.
   - Use the Short Web/CLI Request Defaults for a Web URL or local Web target paired with an accessibility inspection or CLI request.
   - Use standards assessment when the user names a standards profile or when the Short Web/CLI defaults supply the missing profile, scope, operations, and evidence boundary.

2. Define the object under review:
   - Artifact: event plan, announcement, venue page, form, slide, PDF, video, transcript, website, SNS flow, support portal, or onboarding path.
   - Audience: first-time participant, returning participant, blind or low-vision user, deaf or hard-of-hearing user, wheelchair or mobility user, child-care participant, older adult, foreign-language or easy-language reader, neurodivergent/cognitive-load-sensitive user, temporary injury/illness, or low-digital-literacy user.
   - Context: online, offline, hybrid, public-facing content, organizational workflow, archive, or regulated/public context.

3. Map the participation journey:
   - Notice the opportunity.
   - Decide whether participation is possible.
   - Arrive at the place or open the content.
   - Receive the main message.
   - Ask questions or request support.
   - Leave with next actions.
   - Catch up later if absent.

4. Review the five gates. Prefer concrete tests over generic advice:
   - Inspect headings, labels, links, alt text, PDF text, reading order, focus order, and screen-reader-facing names.
   - For stateful UI, compare closed and open rendered DOM, accessibility tree, active element, keyboard path, and screen-reader output. A closed surface must not leave descendants exposed or focusable; an announced control must be operable in that state.
   - Check whether video/audio has captions, transcript, summary, and clear archive location.
   - Check whether the same information is not color-only, audio-only, image-only, hover-only, gesture-only, or insider-channel-only.
   - Check whether event support requests move from form to responsible staff with privacy boundaries.
   - Check whether legal constraints, interpreter/caption contracts, venue rules, recording permissions, or personal data sharing are named.

5. If standards assessment is requested, initialize a complete profile record instead of hand-building an empty checklist:
   - Resolve `skill_root` as the directory containing this `SKILL.md`; never resolve scripts from the audited target's working directory.
   - Run `node <skill_root>/scripts/generate-assessment.mjs --profile web-modern --output <assessment.json>` for WCAG 2.2 A/AA (55 requirements).
   - Run `node <skill_root>/scripts/generate-assessment.mjs --profile jp-public-web --output <assessment.json>` for JIS X 8341-3:2016 A/AA plus the separately identified 18 added WCAG 2.2 requirements (56 total).
   - Use `assets/assessment-record.template.json` only for profiles without a generated catalog.
   - After an available named criterion procedure, or the returned generic playbook plus primary sources when no criterion procedure is available, and target-specific manual or hybrid evidence, a separate external human review workflow may record profile requirement outcomes as `pass`, `fail`, `not_applicable`, `not_tested`, or `cant_tell`.
   - Before evaluating each row, run `show-requirement.mjs` for that exact profile and requirement. Follow the returned method and any available criterion procedure, open its primary sources, and do not evaluate from the title alone.
   - Attach evidence to the exact page, element, screen, file, process step, environment, or test.
   - Use real calendar dates and RFC 3339 timestamps with `Z` or an explicit offset (for example `2026-09-18T09:00:00+09:00`). Preserve recorded offsets and evidence bytes; never rewrite timestamps or hashes to bypass validation. Frozen legacy schemas remain UTC-only. Leap seconds and timezone-free timestamps are unsupported.
   - For every human-recorded `fail`, add a structured finding with `P0`/`P1`/`P2`, the related requirement ID, location, affected users, and observation. When remediation and a retest method are not yet available, preserve the confirmed finding with `remediation_status: unplanned`; add the plan later without dropping the finding. An unplanned finding does not complete remediation planning or retesting.
   - Record the evidence level from E0 to E5 and keep `participation_coverage` separate from standards results.
   - Run `node <skill_root>/scripts/validate-assessment.mjs <assessment.json>` before proposing claim wording.

6. Run `node <skill_root>/scripts/validate-assessment.mjs <assessment.json>` and inspect both `catalog_coverage` and `evaluation_coverage`. A complete catalog row set does not mean a completed audit. Use `render-audit-report.mjs --input` for a standalone assessment, or the run-backed report route for a merged assessment with registered artifacts. Both routes refuse invalid records and existing output files.

7. Produce a concise review or fill `assets/audit-report.template.md`:
   - `P0`: blocks participation or excludes a group from the core information.
   - `P1`: creates avoidable friction, anxiety, or staff confusion.
   - `P2`: improves quality, comfort, recovery, or long-term maintainability.
   - Include affected users, fix, owner/timing when known, verification method, and "cannot verify yet" items.

## Baseline Checks

### Digital Content

- Use real headings, lists, labels, link names, and document structure instead of visual-only formatting.
- Avoid image-only text. If unavoidable, provide nearby text, alt text, OCR text, or a separate text version.
- Write dates, times, numbers, and abbreviations in forms that read correctly aloud.
- Provide captions, transcript, summary, and source links for audio/video.
- Avoid color-only meaning; pair color with text, shape, pattern, or position.
- Keep language short, concrete, and explain jargon. Add easy-language or glossary support when the audience is broad.
- Make external links, downloads, sign-in requirements, and required apps explicit before users commit.

### Events And Meetings

- Publish venue route, elevator, restroom, seating, child/family space, quiet/recovery room, streaming availability, and recording/archive policy before the event.
- Ask for needed support with concrete examples, and state what can and cannot be provided.
- Share only the minimum support information with staff who need it.
- Prepare paper/pen, chat/Q&A route, caption route, microphone discipline, repeated questions, and visible agenda.
- Keep the speaker's mouth/face visible when lip reading or sign interpretation may matter.
- For sign-language interpretation, confirm lead time, request route, placement, lighting, camera framing, breaks, two-person rotation for long sessions, preparation materials, terminology alignment, and archive permission.
- For live captions or speech-to-text, define the tool category, audio input path, editor role, participant access route such as QR/link, backup, and correction policy.

### Public Participation

- Check whether people can find the information across channels, calendars, notification paths, archives, and newcomer orientation.
- Separate legal or venue constraints from ordinary usability constraints. When display, signage, recording, or distribution may be regulated, name the constraint and use safer alternatives such as printed summaries, QR-access captions, post-event transcript, or web archive.
- Provide policy or event summaries in accessible text, easy language, audio, captioned video, and screen-reader-friendly PDF/HTML where possible.
- Treat "I do not know what I may ask for" as an accessibility issue. Publish available support options proactively.

## Output Patterns

For a quick review:

```markdown
## Accessibility Review

- Inspection level, intended report use and agreed scope:

| Priority | Issue | Who is affected | Fix | Verification |
| --- | --- | --- | --- | --- |
| P0 |  |  |  |  |

## Missing Evidence

- Not checked:
- Needs human/user confirmation:

## Completion review

- Each requested criterion, its evidence/section, and any unmet condition with next steps:
```

For a detailed inspection, including a development-site request at that level, use this report:

```markdown
## Scope and evidence level

- Inspection level, intended report use, target, profile, agreed states/environments, performed operations, and evidence level:

## Evidence-backed checks

- Human-verified profile requirements:
- `SCREEN-*` supporting checks (not criterion passes):

## Actionable barriers and remediation

| Priority | Location and reproduction steps | Affected users | Observed evidence | Remediation | Retest |
| --- | --- | --- | --- | --- | --- |

## Human verification required

- Untested or indeterminate item:
- Why it remains unresolved:
- Next evidence or test:

## Claim boundary and artifacts

- Each requested completion criterion, its evidence/section, and any unmet condition with next steps:

- Allowed claim tier:
- Validated assessment record and generated report:
```

Use `assets/development-web-audit-request.template.md` only when custom scope, environment, evidence retention, or authorized remediation requires additional inputs. Do not modify a target unless its editable source, modification authority, permitted operations, and verification commands are all explicit. Return this structure without overclaiming conformance.

For planning:

```markdown
## Before / During / After

| Phase | Required accessibility work | Owner | Due | Evidence |
| --- | --- | --- | --- | --- |
| Before |  |  |  |  |
| During |  |  |  |  |
| After |  |  |  |  |
```

For standards assessment, return the validated JSON record and the full report in `assets/audit-report.template.md`. Lead with the overall judgement and the criterion-level table. Use only the four report labels defined above; do not replace requirement outcomes with a percentage score.

## Guardrails

- Do not call the skill, agent, or an unchecked artifact "WCAG compliant", "JIS certified", or "ATAG conformant". Standards apply only to explicitly scoped targets and applicable requirements.
- Keep `not_tested` and `cant_tell` visible. Never convert uncertainty into `pass`.
- Formal WCAG or JIS wording requires complete scope, complete-process review, criterion-level results, suitable interaction evidence, and human sign-off. JIS wording must also follow the applicable WAIC publication and testing conditions.
- ATAG evaluation of this skill is limited to the named authoring process component; do not imply that the host UI or Part A was evaluated.
- Legal compliance, procurement suitability, WCAG/JIS conformance, and election-law safety require qualified responsibility and evidence.
- Automated accessibility tools are supporting evidence; combine them with structure checks, real-device checks, and user/staff workflow checks.
- Treat accessibility broadly: include permanent, temporary, situational, language, age, digital literacy, cognitive load, and care-giving contexts.
- Prefer practical first steps over perfection. Name what can be improved now, what needs staff/venue/legal confirmation, and what should become a future standard.

## Verification

When using the skill, verify claims with actual artifacts whenever possible: inspect document/page structure, check caption/transcript/archive availability, test or review screen-reader-facing labels, confirm event support handoff paths, and mark legal/privacy/staffing items as unverified unless qualified evidence is present.

When maintaining or packaging the skill:

```powershell
node <skill-folder>\scripts\validate-assessment.mjs <assessment.json>
node <skill-folder>\scripts\generate-assessment.mjs --profile web-modern --output <new-assessment.json>
node <skill-folder>\scripts\render-audit-report.mjs --input <assessment.json> --output <report.md>
```

## Source Basis

This reusable audit workflow is target- and organization-independent. Read `references/source-basis.md` for the public primary sources, included metadata, copyright boundary, and profiles that are not yet implemented.
