# Assistive Text And Visual Separation

Use this playbook when visual styling causes one logical phrase to be read or navigated as fragments, while the visible design must remain unchanged. Typical cases include numbers and units, dates, split labels, or words whose characters use different sizes or colors. Separate DOM or accessibility-tree nodes are not a defect by themselves.

## Goal

Expose one complete, equivalent text string to assistive technology while preserving the existing visible fragments and their styling.

## Decision Rule

1. Confirm a reported or measured problem with reading, accessible naming, or navigation granularity, or identify an explicit target-assistive-technology requirement. If no such evidence is available, record a candidate and defer the implementation decision.
2. Inspect the rendered DOM and computed accessibility tree before editing. Record the logical phrase and the nodes currently exposed.
3. Prefer ordinary semantic HTML when it can express the same content without changing the design.
4. When visual fragmentation is required, render one visually hidden complete string and hide the decorative visual group from the accessibility tree.
5. Derive the hidden string and visible fragments from the same input and formatting rules. Do not maintain two unrelated literals.
6. Verify the rendered result, not only the component source.

```html
<span class="visually-hidden">complete text</span>
<span aria-hidden="true" class="existing-visual-classes">
  <!-- styled fragments derived from the same value -->
</span>
```

Treat this as a framework-independent HTML pattern. In React, Vue, Svelte, or another renderer, bind both branches to the same input instead of copying the example as fixed text. Confirm that the project already defines the named visually-hidden utility; names such as `visually-hidden` and `sr-only` are conventions, not browser features. The utility must remove the text from the visual layout without using `display: none`, `visibility: hidden`, or the `hidden` attribute, because those also remove it from the accessibility tree.

## Guardrails

- Do not add `aria-label` to a generic `div` or `span` as the primary fix. A generic role does not reliably support an accessible name.
- Do not place interactive controls, links, focusable elements, live regions, or information with different meaning inside the `aria-hidden` visual group.
- Do not expose both the complete text and the visible fragments. That creates duplicate or fragmented output.
- Preserve signs, separators, units, and contextual words needed to understand the value. The assistive text must carry the same meaning as the visible text.
- Check every responsive variant. CSS must ensure only the active variant is exposed at a given viewport.
- Treat charts, canvas, and elements with `role="img"` separately. They need an overall text alternative or structured data, not only a hidden copy of one internal label.
- Do not claim pronunciation is correct from source or tree inspection alone. Voice, locale, punctuation settings, browser, and screen-reader version can change spoken output.

## Verification

Run the cheapest reliable checks first:

1. **Component or markup test**: from one input, assert one complete visually hidden string, one `aria-hidden="true"` visual group, no duplicated assistive text, and meaning-equivalent visible fragments.
2. **Update test**: change values, signs, units, and locale where applicable, then rerender and confirm both branches update from the same formatting rules.
3. **Accessibility-tree inspection**: confirm the logical phrase appears as one text/name entry and the styled fragments are absent.
4. **Visual regression check**: compare layout, typography, spacing, color, wrapping, and responsive behavior before and after.
5. **Screen-reader spot check**: verify navigation granularity and pronunciation with the target browser and assistive technology when available.

When the product relies on copying, page search, translation, printing, or CSS-disabled output, add targeted regression checks for those modes. Hiding visual fragments from assistive technology can change how these secondary surfaces collect text.

If the final screen-reader check is unavailable, report the structure as verified and the actual spoken result as `not_tested`. Do not promote an accessibility-tree result into a formal WCAG/JIS pass.

## Evidence To Record

- Target page, component, and logical phrase.
- Before: exposed accessibility-tree nodes and reproduction steps.
- After: complete assistive string and hidden visual group.
- Automated test command and result.
- Browser/accessibility-tree environment.
- Screen reader, voice, locale, browser, and version when manually tested.
- Remaining untested pronunciation or interaction behavior.
