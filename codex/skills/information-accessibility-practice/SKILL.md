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

When an AI agent performs a review with this package:

- The AI agent is not the human reviewer. Records created by the AI agent must remain at evidence level `E0` or `E1`.
- Profile rows created by the AI agent must retain `mapping_status: "unverified"` and `outcome: "not_tested"`.
- Record AI observations only as `SCREEN-*` screening evidence or unverified draft evidence for a human handoff.
- The AI agent must not record `pass`, `fail`, or `not_applicable` on profile rows.
- The AI agent must not set or change `human_verified`, `E2` or higher evidence levels, or represent its work as human review.
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
- **Documents, PDFs, reports, Word files, slide decks, lecture materials, handouts, announcement graphics, or presentation scripts**: read `references/document-slide-accessibility.md`.
- **Events, meetings, seminars, community operations, community onboarding, public participation, or civic information**: read `references/event-community-accessibility.md`.
- **WCAG, JIS, ATAG, standards-based assessment, procurement evidence, or any conformance wording**: read `references/standards-assessment.md` and `references/standards-registry.json`. For a specific registered requirement, run `node <skill_root>/scripts/show-requirement.mjs --profile <profile-id> --id <requirement-id>`; when it returns a criterion-specific procedure, use it as the human-review procedure. When it reports `not_available`, retain the generic playbook and primary-source boundary. Do not load the full criteria and method catalogs into context.
- **HTML that uses ARIA**: also read `references/aria-html-review.md` and `references/aria-review-rules.json`. Record these only as `SCREEN-ARIA-*` supporting checks until a person maps evidence to a profile requirement.
- **Source provenance or maintenance from new research**: read `references/source-basis.md`.
Do not split the five gates into separate workflows. They are shared evaluation axes. Route by target surface because concrete checks, evidence, and fixes differ by target.

## Workflow

1. Choose the review mode:
   - Use participation review by default.
   - When the request names WCAG, JIS, ATAG, a standards profile, or asks for a standards-based inspection, use standards assessment from the start and produce the report format in this skill.

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
   - For every human-recorded `fail`, add a structured finding with `P0`/`P1`/`P2`, the related requirement ID, location, affected users, observation, remediation, and retest method. Do not leave a failed result without an actionable finding.
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

| Priority | Issue | Who is affected | Fix | Verification |
| --- | --- | --- | --- | --- |
| P0 |  |  |  |  |

## Missing Evidence

- Not checked:
- Needs human/user confirmation:
```

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

