# Source Basis

## Method Basis

The five-gate participation model organizes practical accessibility review across discovery, receipt, understanding, participation, and continuity. Standards profiles, evidence levels, assessment records, and claim guards are checked against the public primary sources below.

## Primary Public Sources

- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- WCAG 2.2 SC 2.1.1 Keyboard and Understanding guidance: https://www.w3.org/TR/WCAG22/#keyboard and https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html
- WCAG 2.2 SC 4.1.2 Name, Role, Value and Understanding guidance: https://www.w3.org/TR/WCAG22/#name-role-value and https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html
- ATAG 2.0: https://www.w3.org/TR/ATAG20/
- ACT Rules Format 1.1: https://www.w3.org/TR/act-rules-format/
- WCAG-EM 1.0: https://www.w3.org/TR/WCAG-EM/
- WAI-ARIA 1.2: https://www.w3.org/TR/wai-aria-1.2/
- ARIA in HTML, W3C Recommendation 2026-04-15: https://www.w3.org/TR/html-aria/
- ARIA Authoring Practices modal dialog pattern: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- ARIA Authoring Practices disclosure pattern: https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
- ARIA Authoring Practices menu button pattern: https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
- WAI-ARIA 1.2 `aria-hidden`: https://www.w3.org/TR/wai-aria-1.2/#aria-hidden
- WCAG 2.2 Understanding 1.3.1, Info and Relationships: https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html
- W3C Accessibility Conformance Testing Rules: https://www.w3.org/WAI/standards-guidelines/act/rules/
- WAIC JIS X 8341-3:2016 quick reference: https://waic.jp/resource/jis-x-8341-3-2016/
- WAIC JIS test checklist example: https://waic.jp/docs/jis2016/test-guidelines/202012/gcl_example.html
- WAIC JIS X 8341-3:2016 compliance wording guideline: https://waic.jp/docs/jis2016/compliance-guidelines/202104/
- WAIC JIS X 8341-3:2016 testing guideline: https://waic.jp/docs/jis2016/test-guidelines/
- WAIC 2026 notice on WCAG 2.2 and planned JIS revision: https://waic.jp/news/20260608/
- Japan Digital Agency accessibility statement: https://www.digital.go.jp/accessibility-statement
- MIC Web accessibility evaluation-tool page: https://www.soumu.go.jp/info-accessibility-portal/webaccessibility/michecker/
- MIC April 2024 FAQ of common tool findings and remediation examples: https://www.soumu.go.jp/info-accessibility-portal/assets/documents/webaccessibility/michecker/faq.pdf
- Eclipse ACTF public miChecker manual sources, including the evaluation guide, user guide, criterion-use guide, and worksheet: https://github.com/eclipse-actf/org.eclipse.actf/tree/master/org.eclipse.actf.examples.michecker.doc.nl1/manual_src

## Derived Screening And Evidence Patterns

- `common-web-failure-patterns.json` contains eleven original, tool-independent screening patterns derived from the April 2024 FAQ and rechecked against current W3C sources. The catalog preserves ambiguous mappings as human-review candidates. It does not reproduce the FAQ text or convert a tool message into a WCAG or JIS result.
- `screening-observations.schema.json` records `candidate_issue`, `no_automated_signal`, or `inconclusive` separately from report outcomes. It also records collection method, tool name and version, rule ID, target DOM reference, and viewport when available.
- A mapped screening observation must be routed through an input-linked human-review queue. In particular, no automated signal is never treated as a pass.
- The FAQ research original, extracted text, integrity hash, and related manual links are retained outside the distributed skill under `docs/sources/michecker/`.
- The ACTF evaluation flow and worksheet informed the separation of signal triage, target-specific human judgement, and reproducible evidence fields. No ACTF code, result adapter, CSV parser, or application dependency is bundled.

## Distribution Boundary

- Included as original metadata: complete WCAG 2.2 A/AA identifiers (55), JIS X 8341-3:2016 A/AA identifiers (38), and the separately identified 18 added WCAG criteria used by the Japanese public-Web profile.
- Source HTML hashes are stored in `criteria-catalog.json`; normative standards text is not reproduced.
- Partially implemented: original human-review procedures for WCAG 2.2 SC 1.1.1, SC 1.3.1, SC 1.4.4, SC 2.1.1, SC 2.4.1, SC 3.1.1, SC 3.3.2, and SC 4.1.2 in `criterion-procedures.json`, each linked to W3C primary and Understanding sources. They do not supply a result without target-specific human evidence.
- Not yet implemented: criterion-complete executable test procedures for every active profile requirement, the ATAG 2.0 Part B criterion catalog and feature map, and formal PDF/UA, EPUB, EN 301 549, Section 508, and organization profiles.

The current registry is metadata-complete for active Web profiles but method-incomplete. It supports full-profile audit initialization, structured evidence, coverage accounting, and claim blocking—not automated certification or complete conformance determination.
