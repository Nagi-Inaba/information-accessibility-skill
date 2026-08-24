# Accessible HTML Report Design

## Goal

Add a formally supported HTML export generated from the same validated and visibility-processed presentation model as the Markdown report. The HTML must be readable with keyboard navigation, small viewports, automated accessibility checks, and a bounded NVDA smoke test.

## Interface

```text
accessibility-audit report ... --format markdown|html
```

- Default: `markdown`
- `--detail summary|full`, `--appendix`, `--visibility internal|public`, `--reviewer-disclosure`, and `--redaction-manifest` apply identically to both formats.
- An HTML summary with an appendix contains a descriptive link to the full HTML appendix.
- PDF is not a formally supported output. Browser printing is not presented as tagged-PDF support.

## Shared data and privacy boundary

Validation, evidence provenance, claim guards, locale selection, detail selection, and public redaction happen before format rendering. Markdown and HTML receive the same `ReportPresentation` object after `applyReportVisibility()`.

Dynamic values are escaped separately for HTML text and HTML attributes. Raw assessment prose is never inserted as markup.

## Document structure

Every HTML report contains:

- `<!doctype html>`
- `<html lang="ja|en">`
- charset, viewport, and color-scheme metadata
- a descriptive `<title>`
- a visible-on-focus skip link to `#main-content`
- `<header>` with one `<h1>`
- `<nav aria-label="...">` with an ordered table of contents
- `<main id="main-content" tabindex="-1">`
- logical `<section>` elements with stable unique IDs and heading levels
- `<footer>` containing format and support limitations

The report uses no script for core content or navigation. Anchor targets remain usable when JavaScript is disabled.

## Tables

Each data table has:

- a visible `<caption>`
- `<thead>` and `<tbody>`
- `<th scope="col">` for every column header
- `<th scope="row">` for the criterion or group label
- a focusable `.table-region` wrapper with `role="region"` and an accessible name
- visually hidden instructions explaining horizontal table scrolling on narrow screens

The page itself does not overflow horizontally at 320 CSS pixels. Wide tables scroll inside their named region.

## Visible status and evidence

Judgement, evidence source, evidence level, and remediation priority are rendered as text. CSS may supplement these values but never replaces the visible text.

Each finding is an `<article>` with its own heading and stable unique ID. Criterion source links use descriptive accessible names rather than a bare URL.

## Styling

The embedded stylesheet provides:

- high-contrast text and borders in normal and forced-colors modes
- visible `:focus-visible` outlines
- a skip link that becomes visible on focus
- responsive spacing and typography
- internal table scrolling without page-level horizontal overflow
- reduced-motion-safe behavior
- print rules that preserve headings, links, tables, and reading order while hiding only navigation aids

## Verification

### Structural tests

Node tests verify:

- `lang`, title, landmarks, skip link, TOC, heading order, and unique IDs
- captions and `scope` attributes
- visible judgement/source/evidence/priority text
- 55 and 56 criterion rows in full HTML
- summary/full/appendix behavior
- Japanese and English fixtures
- HTML text and attribute injection escaping
- public HTML uses the same sanitizer and manifest as public Markdown
- no-overwrite and output-path preflight

### Chromium and axe

A dedicated workflow installs the pinned Playwright and axe-core versions, generates Japanese and English fixtures, and verifies:

- no serious or critical axe violations for WCAG A/AA tags
- the skip link is the first keyboard focus target and moves focus to `<main>`
- every TOC target exists
- focus indicators are visible
- at 320×800, the page has no horizontal overflow and wide tables scroll within `.table-region`
- report links and table regions are keyboard reachable

### NVDA smoke

A Windows workflow downloads the official stable NVDA 2026.1.1 installer and verifies its published SHA-256 before execution. It launches NVDA with debug logging, opens the generated English HTML fixture in Microsoft Edge, and sends bounded navigation keys for the skip link, headings, table, and links. The workflow passes only when the NVDA log contains speech events for multiple report-specific landmarks or headings.

If the hosted runner cannot provide an interactive desktop session, that limitation must be reported explicitly; process startup alone is not accepted as a screen-reader smoke result.

## Supported formats

- Markdown: canonical editable and diff-friendly format.
- HTML: formally supported distribution format with structural and runtime accessibility checks.
- PDF: not formally supported until tagging, reading order, and link semantics can be verified deterministically.
