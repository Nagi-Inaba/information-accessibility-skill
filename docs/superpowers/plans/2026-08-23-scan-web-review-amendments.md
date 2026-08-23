# `scan-web` Independent Review Amendments

This document is normative for `docs/superpowers/specs/2026-08-23-scan-web-design.md` and `docs/superpowers/plans/2026-08-23-scan-web.md`. Where the earlier documents conflict with this amendment, this amendment wins.

## 1. Terminology and reproducibility

The feature is a **rule-based automated Web scan**, not a promise that a live Web page produces byte-identical results on every run. `deterministic` means the same normalized input/result is processed without LLM inference. The scan SHA is an integrity link between the full scan and compact context, not a stability guarantee across separate live-page runs.

For the controlled CI fixture, the scanner fixes Chromium/axe versions, viewport, locale (`ja-JP`), timezone (`Asia/Tokyo`), device scale factor (`1`), color scheme (`light`), reduced motion (`reduce`), waits for `DOMContentLoaded`, then `document.fonts.ready`, then two animation frames before the primary scan. Real sites remain time-dependent and the output records `captured_at` and engine/browser versions.

## 2. Frame model and coverage

Do **not** claim complete cross-frame composition in this slice. Axe runs independently in each Playwright `Frame`. Each normalized result is namespaced by the frame URL and frame index/path. We do not set `bypassCSP`; the inspection must not weaken the target's CSP to make scanning easier.

The full scan and compact context add:

```json
"frame_coverage": {
  "attempted": 0,
  "succeeded": 0,
  "failed": 0,
  "skipped": 0,
  "entries": []
}
```

Each entry records frame URL, frame path/index, status (`succeeded|failed|skipped`), and a bounded reason. Sandboxed/CSP-blocked/detached/mid-navigation frames become explicit failed/skipped coverage records and `review_candidate` items. Tests cover `srcdoc`, sandboxed no-script, a frame that detaches/navigates during scan, and a normal same-origin child. Cross-origin frame coverage is best-effort and never silently treated as complete.

## 3. Rule result vs. profile outcome

A machine record never represents a WCAG/JIS profile outcome. `profile_requirement_ids` means only **related registered criteria**.

- axe `violations` with WCAG tags are `machine_violation` rule results with related criterion IDs.
- axe `incomplete` is `review_candidate`.
- `best-practice`, unknown, and other unmapped rules are retained in a dedicated `unmapped_findings` array; they cannot carry profile requirement IDs.
- passes are rule summaries only and never create profile pass records.

Every mapped item contains:

```json
"criterion_relation": "reference_only"
```

The schema forbids `profile_outcome`, `mapping_status`, `human_verified`, or equivalent conformance fields anywhere in scan items.

## 4. Completion and partial publication

The full scan contains `scan_status: "complete"`. Objects are fully assembled and schema-validated in memory before any final output is written.

The command writes the full scan first. If optional context publication fails, the valid full scan remains and the process exits non-zero with a diagnostic naming the retained scan. The scan is still marked `complete` because scanning itself completed; the failure is explicitly a context-publication failure. The manual workflow uploads artifacts **only after a successful CLI exit**, so a context-publication failure is not uploaded as a successful workflow artifact.

No rollback deletes a successfully written scan.

## 5. Reflow is a separate measured state

The 320 CSS-pixel viewport is a **proxy probe for likely reflow problems**, not a direct assertion that SC 1.4.10 fails. It is always a `review_candidate`.

Primary axe/DOM/AX/focus evidence is captured at the requested primary viewport. Reflow then changes the viewport and records its own:

- viewport;
- captured timestamp;
- document `scrollWidth/clientWidth`;
- bounded overflow candidates;
- candidate selectors and whether the element itself is an intentional horizontal scroll container.

The probe ignores hidden elements and does not flag an element solely because it is inside a container with explicit horizontal scrolling. It restores the primary viewport afterward, but the reflow result remains a separately stamped state. Documentation explicitly states that a 320px viewport is not equivalent to a full 400% zoom test.

## 6. Fixed execution order and navigation guard

The order is fixed:

1. navigate and settle primary state;
2. run axe per frame;
3. capture primary DOM and AX tree;
4. sample bounded Tab focus path;
5. assert final URL/origin did not change during focus sampling;
6. run separately stamped reflow probe;
7. restore primary viewport;
8. assemble/validate outputs.

Only `Tab` is sent. No Enter, Space, click, submit, upload, or activation is added. A focus handler that navigates causes the scan to fail rather than silently changing the inspected target.

## 7. Network and manual workflow hardening

The manual workflow remains an owner-triggered convenience path for public URLs and is not the trust boundary by itself.

- `--allow-localhost` is not exposed as a workflow input and the workflow contract test rejects any occurrence of it.
- extra origins are capped at 8 and must be exact HTTP(S) origins; wildcard origins are rejected.
- target and extra-origin hostnames are checked for private/link-local/reserved addresses before navigation.
- each HTTP(S) request route re-resolves the request hostname immediately before allowing the request and rejects private/link-local/reserved results; redirects therefore receive the same check.
- request methods are limited to GET/HEAD for this scanner slice; other methods are aborted.
- workflow permissions are explicitly minimal (`contents: read`).
- workflow does not use repository/user secrets.
- query strings and fragments are stripped from URLs written to the compact context. The full internal scan may retain the requested URL and is documented as sensitive.
- artifacts upload only on successful scan and retain for 7 days.

DNS re-resolution is defense-in-depth, not a claim of a cryptographically pinned connection. The documentation says the manual workflow must be used only for intentionally public targets.

## 8. Explicit context bounds

The compact context is bounded and schema-visible:

- maximum 100 total items;
- maximum 20 nodes per rule/item;
- maximum 2,000 Unicode code points per HTML/failure text field;
- maximum serialized context size 512 KiB before write;
- deterministic priority order: machine violations first, then review candidates; stable rule/dedup ordering within a class.

When data is omitted, the context requires:

```json
"truncation": {
  "truncated": true,
  "omitted_items": 0,
  "omitted_nodes": 0,
  "reason": "context_limit"
}
```

Full scan retains the normalized full result subject to per-node text bounds. Truncation is Unicode-code-point safe (`Array.from(value).slice(...)`) and each truncated text field has an adjacent `*_truncated` boolean.

## 9. Dependency resolution

`axe-core` is an exact direct dependency of the skill package at `4.13.0`. Playwright remains an optional host capability because Chromium installation is external; the package declares the supported Playwright version and the scanner rejects unsupported/missing Playwright with an actionable diagnostic.

The scanner resolves axe from its own package tree and reads the version from the resolved `axe-core/package.json`. Tests cover execution from:

- repository source path;
- an installed-package symlink like the existing unified CLI test;
- a temporary `npm install --global`-style package layout.

The CI workflow installs the exact supported Playwright version and Chromium. Do not depend on the target application's dependencies.

## 10. Deduplication

The dedup identity uses:

- engine name/version;
- rule ID;
- frame path plus sanitized frame URL origin/path;
- normalized selector tokens with unstable numeric `:nth-child()` / `:nth-of-type()` indices removed from the identity form;
- normalized failure summary;
- impact.

The original selectors remain in evidence. Tests cover stable duplicates, distinct failure summaries on the same selector, and nth-child index drift.

## 11. Pre-refactor compatibility oracle

Before changing `capture-web-evidence.mjs`, add a characterization fixture generated by the current adapter for the fixed local Web fixture. Compare semantic output fields rather than volatile timestamps/browser patch strings:

- bundle kind/schema;
- target URL/status;
- DOM and AX hashes for the fixed fixture;
- capability list;
- focus-path structure;
- allowed/blocked origin behavior.

The refactor must pass this oracle before scanner work proceeds.

## 12. Exit codes and output safety

Exit codes:

- `0`: scan completed and all requested outputs were published, regardless of whether machine violations were found;
- `2`: CLI usage/profile/argument error;
- `3`: target/network/policy/navigation failure;
- `4`: scanner/browser/dependency/runtime failure;
- `5`: schema validation failure;
- `6`: output publication/preflight failure.

Machine findings do not cause a non-zero exit in this slice.

`assertNewOutputPath`/existing safe writer remains authoritative: refuse an existing destination, reject unsafe parent traversal/symlink/reparse conditions per current runtime, create guarded parent directories, and never overwrite. Output and context paths must resolve to different destinations.

## 13. Manual workflow action pinning and artifact sensitivity

Use SHA-pinned GitHub Actions, not floating major tags, in the new workflow. Add an explicit workflow summary warning that full scan artifacts can contain page text, selectors, and URLs and are internal evidence. Do not scan authenticated pages or URLs carrying access tokens/query secrets in the manual workflow.

## 14. Compact context stability

`automated-web-scan-context` version `1.0.0` is explicitly marked **experimental** until the later run-artifact binding/import slice lands. Downstream consumers must validate `schema_version` and must not assume backward compatibility before that binding is released.

## 15. Additional tests required before implementation is accepted

In addition to the original plan:

- CSP/sandbox/srcdoc/detaching frame coverage tests;
- static-fixture settle/reproducibility test and documentation that live-site hashes may differ;
- best-practice/unmapped isolation test;
- context truncation/512-KiB limit tests including surrogate pairs;
- reflow separately stamped state and horizontal-scroll-container exemption tests;
- focus-triggered navigation failure test;
- per-request private-address re-resolution and redirect tests;
- workflow extra-origin cap/wildcard/localhost/query-secret contract tests;
- installed/global-layout axe dependency resolution tests;
- dedup nth-child drift and distinct-failure tests;
- pre-refactor semantic compatibility characterization test;
- exit-code table tests.

Implementation must not begin until an independent reviewer evaluates the original spec/plan **plus this amendment** and returns `APPROVED FOR IMPLEMENTATION`.