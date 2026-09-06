# External site audits

This directory holds durable accessibility audit reports produced by the `information-accessibility-reviewer` agent (or the underlying skill) against external sites/apps/documents — as opposed to `docs/reviews/`, which audits this repository's own tooling design and implementation plans.

- [`2026-09-06-transportation-accessibility-detail-review.md`](2026-09-06-transportation-accessibility-detail-review.md): WCAG 2.2 screening of `https://calico-blanket.github.io/Transportation-Accessibility/detail/` (E1 static-analysis evidence, human verification pending).
- [`2026-09-06-transportation-accessibility-detail-review-followup.md`](2026-09-06-transportation-accessibility-detail-review-followup.md): feedback for the skill author — why so many criteria came back "not tested," and why an in-page anchor link's jump target lacking `tabindex="-1"` can block screen-reader focus movement even when the `<a href>`/`id` pairing is syntactically correct.
