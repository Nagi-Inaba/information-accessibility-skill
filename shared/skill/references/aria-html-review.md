# ARIA In HTML Review

Use this reference when HTML contains `role` or `aria-*`, or when custom widgets expose semantics through ARIA. Use the current ARIA in HTML Recommendation and WAI-ARIA 1.2 as the requirement sources.

## Scope

ARIA can expose semantics, states, properties, and relationships that native HTML does not provide. It can also replace correct native semantics with an invalid or misleading accessibility tree. Review the rendered HTML and accessibility tree, not source strings alone.

Read `aria-review-rules.json` for the machine-readable review checks. These are local review rules mapped to primary specifications; they are not W3C ACT Rules and do not independently prove WCAG results.

## Review Order

1. Identify every element with `role` or `aria-*` and every custom interactive widget.
2. Record the element, native HTML semantics, implicit role, explicit role, states/properties, accessible name, focusability, and owned descendants.
3. Apply the rules in `aria-review-rules.json`.
4. Inspect the computed accessibility tree in at least one target browser.
5. Test keyboard interaction and relevant state changes.
6. Use a screen reader when the widget, live status, name, relationship, or dynamic state is material to the result.
7. Record `cant_tell` when browser/accessibility-tree or assistive-technology evidence is unavailable.

## High-Risk Patterns

- Native interactive element overridden with a non-interactive role.
- Role not permitted on the HTML element.
- `aria-*` attribute not permitted for the element or role.
- Required state or property missing for the role.
- Invalid token, boolean, tristate, integer, number, ID reference, or token-list value.
- Broken `aria-labelledby`, `aria-describedby`, `aria-controls`, `aria-owns`, or active-descendant reference.
- Accessible name prohibited, missing, duplicated, or inconsistent with the visible label.
- Hidden or inert content referenced as if it were operable or visible.
- Deprecated role, state, property, or attribute.
- Incorrect case or whitespace in role/state/property values.
- Owned descendants or required context roles inconsistent with the selected role.
- Redundant explicit role that merely repeats native semantics and creates maintenance risk.

## Evidence

Prefer:

- rendered DOM snapshot;
- conformance-checker output with tool/version/ruleset;
- browser accessibility-tree capture;
- keyboard path and state-transition notes;
- screen-reader announcement notes;
- exact element selector or stable component identifier.

Automated output may identify a candidate failure. Confirm element applicability, computed semantics, and user-facing behavior before recording a profile-requirement `pass` or `fail`.

## Output

For each issue, record:

```markdown
| Rule ID | Element | Finding | Evidence | Outcome | Related WCAG result |
| --- | --- | --- | --- | --- | --- |
```

Keep ARIA conformance findings separate from WCAG success-criterion outcomes. Map them to WCAG only when the target behavior and criterion applicability were reviewed.
