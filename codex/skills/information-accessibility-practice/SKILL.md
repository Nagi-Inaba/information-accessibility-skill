---
name: information-accessibility-practice
description: Use when reviewing, designing, or creating information accessibility for software/UI development, websites, apps, documents, slides, announcement graphics, videos, events, meetings, SNS posts, support workflows, public information, community onboarding, or participation flows. Trigger for information accessibility, accessibility review, accessibility checklist, UI review, web review, document accessibility, slide accessibility, screen reader, captions, subtitles, sign-language support, speech-to-text, easy language, ruby/furigana, color accessibility, venue guidance, participant support, support request flow, or accessibility planning.
---

# Information Accessibility Practice

Apply information accessibility as a participation workflow, not only as a disability checklist. Help people find information, decide whether they can participate, receive it through multiple modes, understand it, ask for support safely, and review it later.

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
- **Documents, PDFs, reports, Word files, slide decks, lecture materials, handouts, announcement graphics, or presentation scripts**: read `references/document-slide-accessibility.md`.
- **Events, meetings, seminars, community operations, community onboarding, public participation, or civic information**: read `references/event-community-accessibility.md`.
Do not split the five gates into separate workflows. They are shared evaluation axes. Route by target surface because concrete checks, evidence, and fixes differ by target.

## Workflow

1. Define the object under review:
   - Artifact: event plan, announcement, venue page, form, slide, PDF, video, transcript, website, SNS flow, support portal, or onboarding path.
   - Audience: first-time participant, returning participant, blind or low-vision user, deaf or hard-of-hearing user, wheelchair or mobility user, child-care participant, older adult, foreign-language or easy-language reader, neurodivergent/cognitive-load-sensitive user, temporary injury/illness, or low-digital-literacy user.
   - Context: online, offline, hybrid, public-facing content, organizational workflow, archive, or regulated/public context.

2. Map the participation journey:
   - Notice the opportunity.
   - Decide whether participation is possible.
   - Arrive at the place or open the content.
   - Receive the main message.
   - Ask questions or request support.
   - Leave with next actions.
   - Catch up later if absent.

3. Review the five gates. Prefer concrete tests over generic advice:
   - Inspect headings, labels, links, alt text, PDF text, reading order, focus order, and screen-reader-facing names.
   - Check whether video/audio has captions, transcript, summary, and clear archive location.
   - Check whether the same information is not color-only, audio-only, image-only, hover-only, gesture-only, or insider-channel-only.
   - Check whether event support requests move from form to responsible staff with privacy boundaries.
   - Check whether legal constraints, interpreter/caption contracts, venue rules, recording permissions, or personal data sharing are named.

4. Produce a concise review:
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

## Guardrails

- Legal compliance, WCAG conformance, JIS conformance, and election-law safety require qualified evidence.
- Automated accessibility tools are supporting evidence; combine them with structure checks, real-device checks, and user/staff workflow checks.
- Treat accessibility broadly: include permanent, temporary, situational, language, age, digital literacy, cognitive load, and care-giving contexts.
- Prefer practical first steps over perfection. Name what can be improved now, what needs staff/venue/legal confirmation, and what should become a future standard.

## Verification

When using the skill, verify claims with actual artifacts whenever possible: inspect document/page structure, check caption/transcript/archive availability, test or review screen-reader-facing labels, confirm event support handoff paths, and mark legal/privacy/staffing items as unverified unless qualified evidence is present.

