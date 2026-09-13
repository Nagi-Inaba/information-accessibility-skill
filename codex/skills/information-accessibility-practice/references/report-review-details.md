# Recording unresolved checks in reports

Use optional `review_details` on a standalone assessment result or a version 2.0.0 screening observation to record what was checked, why work remains, and the next check. The Japanese and English Markdown/HTML renderers show these details in the criterion row. Run-backed reports use details only from registered screening observations; they ignore extra details added to merged assessment rows. The declared human-review artifact contract is unchanged. Older records remain valid without this field; an unresolved row with no reason displays “Reason not recorded”. Do not infer a cause from missing evidence.

## Record shape

```json
{
  "review_details": {
    "reason": "scope_incomplete",
    "performed_checks": [],
    "next_checks": ["Inspect the remaining pages in the declared process."]
  }
}
```

All three members are required when the optional object is present. Set `reason` to `null` when no unresolved reason applies, or use one of:

| Value | Meaning |
| --- | --- |
| `unknown` | The reason has not been recorded. |
| `test_not_run` | The necessary test was not performed. |
| `applicability_pending` | Applicability still needs checking. |
| `meaning_review` | Content or functional meaning needs comparison. |
| `scope_incomplete` | The inspected scope is insufficient. |
| `evidence_incomplete` | A required test record is incomplete. |

Record the actual reason and an actionable next step. Absence of a video, image, or form in a limited observation does not create an automatic `not_applicable` result. Free-text evidence stays in its recorded language; interface labels follow the report locale.

## Screening pass records

This first implementation checks record completeness for report projections of SC 1.4.4 and SC 2.4.1, including corresponding JIS IDs. For a report-only `pass`, an E1 observation needs a matching completed check:

```json
{
  "review_details": {
    "reason": null,
    "performed_checks": [{
      "id": "text_resize_200",
      "outcome": "pass",
      "environment": "Actual OS and browser with versions; resize method",
      "evidence": "Describe results up to 200%, including content and functionality."
    }],
    "next_checks": []
  }
}
```

Use `text_resize_200` for SC 1.4.4 and `skip_link_navigation` for the skip-link route to SC 2.4.1. Each check requires an outcome (`pass`, `fail`, or `cant_tell`), a nonblank environment, and nonblank evidence. A viewport declaration or a link's existence is insufficient. Record the target, operation, and observed result in the evidence; never copy the example as if it were an actual test.

For skip links, record the link's role, activation method, destination, and subsequent keyboard navigation. Use the in-page checklist below when reading position is at issue. [W3C G1](https://www.w3.org/WAI/WCAG22/Techniques/general/G1) and [G124](https://www.w3.org/WAI/WCAG22/Techniques/general/G124) describe link-based techniques; other ways to meet SC 2.4.1 exist. This initial guard cannot establish an alternative technique's success and conservatively retains a review requirement. For text resizing, consult [Understanding SC 1.4.4](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html).

Missing required records, E0-only observations, incomplete checks, a pending reason, or remaining next checks turn a proposed screening `pass` into report-only `cant_tell`. Counts use the adjusted result. This validates declared record completeness, not truth, test coverage, or reviewer identity. It does not run a browser or assistive technology, promote evidence to E2, alter saved artifacts, or override a human-verified profile result.

The optional fields extend the current schemas. Existing record shapes remain accepted, but installed schema/resource hashes change. Preserve the original installed resources for an old hash-pinned run; start a new run with current resources rather than rewriting recorded hashes.

## In-page link checklist

From the installed skill root:

```sh
node scripts/accessibility-audit.mjs screen-reader-checklist --pattern in-page-links --locale en --format markdown
```

Use `--locale ja` for Japanese. Record the page version, OS/browser/assistive technology versions, mode, and activation method. Keep scroll position, DOM focus, next Tab destination, and screen-reader reading position as separate observations. When AT cannot be run, record that check as untested or indeterminate; do not infer speech from DOM focus. The checklist supplies manual follow-up steps and does not add registered criterion procedures to the immutable human-review queue.

Missing `tabindex` alone is not a failure. Any local-copy experiment with `tabindex="-1"` or `focus()` requires an editable copy and authorization for that operation. The checklist itself only prints instructions and does not change the audited target.
