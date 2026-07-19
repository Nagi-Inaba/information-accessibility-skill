# Screen Reader Stateful UI

Use this playbook for modal dialogs, drawers, popups, hamburger navigation, disclosures, menu buttons, and controls that appear or disappear responsively. Use `assistive-text-visual-separation.md` with it when one logical phrase is visually split into styled fragments.

## State Invariant

For every open, closed, loading, disabled, and responsive state, keep these four surfaces synchronized:

1. **Visual state**: what sighted users can see.
2. **Operability**: what pointer, keyboard, touch, and gesture users can operate.
3. **Accessibility-tree exposure**: what role, name, state, relationship, and descendants assistive technology receives.
4. **Focus**: where keyboard and assistive-technology interaction starts, remains, and returns.

An element that is visually hidden but still focusable or exposed is not closed. An element announced as an input or button must be operable in that same state. Source code or an accessibility-tree capture can establish likely structure; neither proves actual spoken output.

## Choose The Interaction Pattern First

- Use a **modal dialog** only when background interaction must stop until close. Require a named dialog, deliberate initial focus, background isolation, contained focus, Escape close, and logical focus return.
- Use a **disclosure** for ordinary show/hide content, including many hamburger navigation panels. Keep the trigger's expanded state synchronized; do not add modal or menu semantics merely because the content floats visually.
- Use a **menu button** only for a composite menu of actions that implements the menu keyboard model. Ordinary navigation links usually remain a disclosure or navigation region.
- Treat a visually fragmented number, date, or label as **fragmented text** only when a reported or measured reading or navigation problem exists.

## Inspection Order

1. Record the target viewport, browser, screen reader, version, voice, locale, input method, and focus before the action.
2. Inspect source and rendered DOM for the state source, conditional rendering, semantics, name, relationships, hidden mechanism, and focus handlers.
3. Capture the computed accessibility tree in the closed state.
4. Open through every distinct trigger and capture the open tree and active element.
5. Exercise forward and backward keyboard navigation, Escape, explicit close, item activation, and responsive breakpoint transitions as applicable.
6. Close and record the resulting active element and closed accessibility tree.
7. Perform the target screen-reader check. Record actual announcements separately from visual and DOM observations.

Use the machine-readable checks in `screen-reader-ui-checks.json`, or run:

```powershell
accessibility-audit screen-reader-checklist --pattern modal-dialog --format markdown
```

Available patterns are `modal-dialog`, `disclosure`, `menu-button`, `fragmented-text`, and `all`.

## Evidence Boundary

- Record code and DOM inspection, accessibility-tree inspection, keyboard behavior, and spoken output as separate evidence.
- If the target screen reader is unavailable, keep spoken behavior as `not_tested` or `cant_tell`; do not infer pronunciation or gesture navigation from markup.
- Keep `SCREEN-SR-*` results as supporting screening observations until a person maps target-specific evidence to an applicable profile requirement.
- Test each active responsive variant and the exact breakpoint boundary. Confirm that only the active variant is exposed and focusable.
- Do not put private, editable, or access-controlled source URLs into public reports, pull requests, issues, or comments. Publish a redacted observation and verification method unless external publication of the source is explicitly authorized.

## Primary Sources

- https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
- https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/

ARIA Authoring Practices describes expected patterns and does not prove support in a particular browser and assistive-technology combination. Verify the target combination.
