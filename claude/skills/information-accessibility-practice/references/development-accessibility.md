# Development Accessibility

Use this reference when the target is software, UI, a website, an app, a form, a dashboard, a repository, or a development task that affects user-facing information.

## Review Frame

Treat accessibility as whether users can complete the information journey:

1. Find the feature, page, state, error, or next action.
2. Receive the same meaning through visual UI, text, screen reader output, keyboard/focus, and status messages.
3. Understand labels, validation, state, dates, units, links, and consequences.
4. Participate or act without needing hidden knowledge, mouse-only interaction, or private support.
5. Continue after errors, interruptions, saved states, exports, notifications, or later review.

## Development Checks

- Use semantic elements before custom widgets: buttons for actions, links for navigation, headings for sections, labels for inputs, lists/tables for structured data.
- Ensure every interactive control has an accessible name, visible purpose, keyboard operation, focus indicator, disabled/loading/error state, and non-color-only status.
- Keep focus order aligned with visual and task order. After modals, async saves, route changes, validation, or errors, place focus where the user can continue.
- Announce dynamic changes that matter: save completion, validation errors, filtering results, upload progress, copied state, destructive confirmation, and session timeout.
- Do not hide core information behind hover-only, drag-only, gesture-only, canvas-only, image-only, or color-only interactions.
- For forms, pair each field with label, help text, required/optional status, examples, validation timing, error summary, and recovery path.
- For tables and dashboards, preserve headers, units, sorting meaning, filters, empty states, export availability, and text alternatives for charts.
- For media or generated content, provide captions, transcript, summary, alt text, or structured text equivalent as appropriate.
- For Japanese text, check reading order, ruby/furigana needs, dates/times, abbreviations, mixed-language pronunciation, and screen-reader-unfriendly symbols.
- For responsive design, verify mobile zoom, text wrapping, touch target size, orientation, and content not being lost at narrow widths.

## Evidence To Prefer

- DOM/HTML structure, aria labels, heading order, form labels, focus behavior, keyboard path.
- Screen reader spot checks when possible, especially VoiceOver/TalkBack/NVDA-facing names and reading order.
- Automated lint/a11y tools as supporting evidence only; do not treat them as sufficient.
- Screenshots or reproduction notes for P0/P1 findings.

## ARIA Review

When HTML uses explicit roles or `aria-*` attributes, apply `aria-html-review.md` and `aria-review-rules.json`. Record each result as a `screening_check` with its `SCREEN-ARIA-*` identifier. These checks can expose likely semantic defects, but they remain supporting evidence: do not automatically convert them into a pass or fail for WCAG 4.1.2 or any other profile requirement. Confirm the element's native semantics, computed accessibility tree, keyboard behavior, state changes, and accessible name before a person maps evidence to a criterion.

When visual styling causes one logical phrase to be read or navigated as fragments, or the requested fix must preserve appearance while changing assistive output, apply `assistive-text-visual-separation.md`. Use it for numbers and units, stylized dates, split labels, badges, and similar read-as-one content. DOM or accessibility-tree fragmentation alone is not a defect. Do not use the pattern to hide interactive descendants or to replace chart descriptions.

## Output For Code Work

For implementation or code review, report findings like this:

```markdown
| Priority | Surface | Issue | Affected users | Fix | Verification |
| --- | --- | --- | --- | --- | --- |
| P0 |  |  |  |  |  |
```

When editing code, prefer small fixes that preserve existing design patterns. Verify with tests, lint/build, targeted DOM inspection, or browser/manual checks depending on the project.
