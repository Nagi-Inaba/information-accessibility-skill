# Document And Slide Accessibility

Use this reference when creating or reviewing Word documents, PDFs, reports, slide decks, lecture materials, handouts, meeting notes, scripts, or shareable summaries.

## Review Frame

Documents and slides often fail accessibility when they look organized visually but do not expose structure. Review both the visible composition and the machine-readable/textual path.

1. Can readers find the document, section, version, date, and next action?
2. Can they receive the content as text, audio/screen reader output, printed material, and post-event archive?
3. Can they understand the order, emphasis, terms, charts, links, abbreviations, and assumptions?
4. Can they ask questions or request alternate formats without stigma?
5. Can they return later and recover the main points quickly?

## Document Checks

- Use real headings, lists, tables, captions, footnotes, and links instead of visual-only formatting.
- Give every link meaningful text; avoid naked URLs when the destination or action matters.
- Avoid image-only text. If screenshots or scanned pages are necessary, provide nearby text, alt text, OCR text, or a separate text version.
- For PDFs, verify selectable text, reading order, title/metadata, headings, link text, table structure, and whether the PDF should also have an HTML/Markdown alternative.
- Define jargon, acronyms, legal terms, institutional names, and technical terms at first use.
- Use concrete dates, times, time zones, locations, costs, prerequisites, and contact paths.
- Keep tables simple. If a table is complex, add a short textual takeaway before it.
- For Japanese materials, consider ruby/furigana, easy Japanese, mixed-language pronunciation, and screen-reader reading of symbols.

## Slide Checks

- Make each slide's main message explicit in the title or first text block.
- Keep reading order simple: title, key message, supporting details, visual explanation, next action.
- Avoid relying only on animation, color, position, tiny text, or speaker narration.
- Provide alt text or speaker-note equivalents for meaningful images, diagrams, screenshots, charts, and process flows.
- For charts, state the takeaway, axes, units, data period, and important caveats in text.
- For event announcement graphics or SNS cards, provide the same date, time, location, change policy, and latest-information path as adjacent plain text. Do not leave schedule details trapped in an image or design canvas.
- When adding ruby/furigana or pronunciation aids, check both visual density and machine reading order. If the rendered extraction splits names, dates, or times into isolated characters, provide a clean text alternative.
- For live presentation, prepare a shareable outline, transcript/notes, captions, and post-event summary when possible.
- When slides will become PDF, check that slide order, text extraction, links, and notes are usable after export.

## Output For Creation Work

When creating a document or slide deck, include accessibility requirements in the production checklist:

```markdown
## Accessibility Production Checklist

- Structure:
- Plain-language / easy-Japanese support:
- Images/charts/diagrams:
- Links and references:
- PDF/export path:
- Caption/transcript/archive path:
- Unverified items:
```

When reviewing an existing file, prioritize blockers that prevent reading, navigation, or reuse over cosmetic issues.
