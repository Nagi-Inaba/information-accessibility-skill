# Deterministic `scan-web` Design

## Context

The repository already has two complementary pieces:

- `capture-web-evidence.mjs` opens a page in Playwright Chromium and captures rendered DOM, the Chromium accessibility tree, a bounded Tab focus path, viewport metadata, request-policy logs, and hashes.
- `accessibility-audit` manages assessment records, immutable audit runs, artifact registration, merge, validation, and report generation.

What is missing is a deterministic rule engine between page capture and AI interpretation. Today an AI reviewer may inspect raw DOM and accessibility-tree data to rediscover issues that a mature rules engine can identify directly. That increases context size and makes repeatability worse.

## Goal

Add a `scan-web` command that performs machine-detectable checks before AI analysis, records exactly what engine and target state were inspected, and emits a compact context bundle containing only machine violations and unresolved review candidates.

## Non-goals

- Changing the current audit-run or screening-observation schemas in this slice.
- Registering deterministic scanner output as a run artifact in this slice.
- Automatically converting an axe result into a profile `pass` or `fail`.
- Replacing manual keyboard, screen-reader, content-quality, or end-to-end task review.
- Adding multiple scanner engines in the first implementation.

## Architecture

### 1. Shared browser session

Refactor `capture-web-evidence.mjs` so both evidence capture and automated scanning use one browser session and one network policy implementation.

The module will expose:

```js
export async function withWebInspectionSession(options, inspect)
export async function collectWebEvidence(session, options)
export async function captureWebEvidence(options)
```

`withWebInspectionSession` owns URL validation, DNS/private-address checks, Playwright loading, Chromium launch, request interception, navigation, final-origin enforcement, and browser cleanup. The callback receives a loaded `page`, `context`, `browser`, response metadata, and the blocked-request log. `captureWebEvidence` remains backward compatible by composing the two new functions.

### 2. Deterministic scanner

Add `scripts/lib/automated-web-scan.mjs`. It will:

1. Load `axe-core` dynamically.
2. Inject the exact installed `axe-core` source into every loaded frame.
3. Run axe and normalize `violations`, `incomplete`, `passes`, and `inapplicable` results.
4. Map WCAG tags such as `wcag111` to the selected profile's registered requirement IDs using `criteria-catalog.json`, rather than hard-coding profile IDs.
5. Compute a stable deduplication key from engine name, rule ID, frame URL, and normalized targets.
6. Run a bounded 320 CSS-pixel reflow probe and record horizontal-overflow elements as review candidates, not machine violations.
7. Combine the scan with the existing DOM, accessibility-tree, focus-path, viewport, target, and request-policy evidence from the same page load.

The first supported engine versions for CI are:

- Playwright `1.62.1`
- axe-core `4.13.0`

The output records the versions it actually used, so later upgrades remain visible.

### 3. Output contracts

Add two JSON Schemas.

#### `automated-web-scan.schema.json`

The full internal scan record contains:

```json
{
  "schema_version": "1.0.0",
  "kind": "automated-web-scan",
  "captured_at": "2026-08-23T00:00:00Z",
  "profile": {
    "id": "web-modern",
    "registry_version": "1.0.0"
  },
  "target": {
    "requested_url": "https://example.com/",
    "final_url": "https://example.com/",
    "http_status": 200,
    "dom_sha256": "...",
    "ax_tree_sha256": "..."
  },
  "environment": {
    "adapter": "playwright-chromium",
    "browser_version": "...",
    "viewport": { "width": 1280, "height": 800 },
    "scanner": { "name": "axe-core", "version": "4.13.0" }
  },
  "policy": {
    "allowed_origins": ["https://example.com"],
    "blocked_request_count": 0,
    "reflow_width": 320
  },
  "summary": {
    "machine_violations": 1,
    "review_candidates": 2,
    "machine_pass_rules": 30,
    "inapplicable_rules": 45
  },
  "machine_violations": [],
  "review_candidates": [],
  "machine_passes": [],
  "inapplicable": [],
  "evidence": {
    "active_element": null,
    "focus_path": [],
    "reflow": {},
    "blocked_requests": []
  },
  "raw_result_sha256": "...",
  "interpretation": "Automated scan results are machine observations and do not by themselves determine formal WCAG conformance."
}
```

A normalized finding contains:

- `dedup_key`
- `kind`: `machine_violation` or `review_candidate`
- `source`: `axe-core` or `internal-reflow-probe`
- `rule_id`
- `impact`
- `help`
- `help_url`
- `tags`
- `profile_requirement_ids`
- `nodes`, each with frame URL, selectors, bounded HTML, and failure summary

Machine passes are stored as rule summaries only. They never become profile passes.

#### `automated-web-scan-context.schema.json`

The compact AI context contains:

- target identity and scanner versions;
- aggregate counts;
- machine violations;
- unresolved candidates;
- focus and reflow summaries;
- the SHA-256 of the full scan file.

It excludes raw DOM, the full accessibility tree, machine-pass node details, and inapplicable rule details.

### 4. CLI contract

Add the following unified command:

```sh
accessibility-audit scan-web \
  --url https://example.com/ \
  --profile web-modern \
  --output audit-runs/example/automated-scan.json \
  --context-output audit-runs/example/automated-scan.context.json
```

Supported options:

- `--url <http-or-https-url>` required
- `--profile <active-profile-id>` required
- `--output <new-json-file>` required
- `--context-output <new-json-file>` optional
- `--allow-origin <origin>` repeatable
- `--allow-localhost` explicit fixture/development escape hatch
- `--focus-steps <0-50>` default `8`
- `--width <240-7680>` default `1280`
- `--height <240-7680>` default `800`
- `--reflow-width <240-1280>` default `320`

Both output paths use the existing exclusive safe writer. If the optional context output fails, the command removes only files it created and never overwrites a concurrent file.

### 5. Profile mapping

The scanner loads `standards-registry.json` and `criteria-catalog.json`.

For each active profile it builds a map from `success_criterion` to the exact registered profile requirement IDs. Axe tags matching `wcagNNN` are converted to dotted success-criterion numbers and looked up in that map.

Rules with no registered requirement mapping are retained with an empty `profile_requirement_ids` array. They are not silently discarded.

### 6. Security and privacy

- Reuse the existing URL, DNS, private-address, allowed-origin, redirect, and bounded interaction controls.
- Do not submit forms or activate controls; only the existing bounded Tab sampling runs.
- Treat the full scan as internal evidence because bounded HTML fragments and selectors may contain target-specific data.
- Keep the AI context smaller, but do not label it public-safe; publication sanitization remains a separate step.
- Limit stored HTML per node to 2,000 UTF-16 code units and failure summaries to 2,000 code units.
- Sort arrays and normalize selectors before hashing so deduplication is stable.

### 7. Manual GitHub Actions entry

Add a read-only `workflow_dispatch` workflow for the repository owner to run the same CLI against a named public URL. Inputs are URL, profile, and optional extra origins. The workflow:

- uses `contents: read` only;
- installs exact Playwright and axe-core versions;
- installs Chromium;
- runs `scan-web`;
- uploads the full scan and compact context with seven-day retention;
- relies on the CLI's private-network and origin controls rather than accepting a generic bypass.

This gives the project a reproducible execution path for the first real Web-tool inspection without introducing a server or storing credentials.

## Error handling

The command fails without writing completed output when:

- the profile is unknown or inactive;
- Playwright, Chromium, or axe-core is unavailable;
- the URL is unsafe or resolves to a denied address;
- navigation escapes the allowed origins;
- axe execution fails in a frame;
- the resulting scan or context does not validate against its schema;
- an output already exists;
- an input dependency changes during a stable-file read.

Cross-origin frames blocked by policy remain visible in the blocked-request log. They do not make the rest of the scan disappear, but the summary records that coverage was incomplete.

## Testing

### Unit tests

- URL/network-policy behavior remains unchanged after refactoring.
- Axe WCAG tags map to exact profile IDs for `web-modern` and `jp-public-web`.
- Unknown/best-practice rules remain visible with no profile mapping.
- Normalization truncates target HTML and produces stable dedup keys.
- Machine passes cannot be represented as profile outcomes.
- Compact context omits raw DOM, full AX tree, and pass-node details.
- Both schemas accept complete output and reject missing engine, target, and hash fields.

### Browser E2E

A fixed local fixture will contain:

- an image without alternative text;
- an unlabeled form control;
- a wide element that creates a 320px reflow candidate;
- two focusable controls.

The E2E test verifies:

- axe reports the expected rules;
- profile requirement candidates are mapped;
- reflow is a review candidate;
- DOM/AX hashes and focus path are present;
- the context file is smaller and excludes raw evidence;
- the unified CLI dispatches the command;
- Codex and Claude distributions remain byte-equivalent.

### CI

Extend the existing Web evidence workflow to install Playwright `1.62.1` and axe-core `4.13.0`, run unit and browser E2E tests, then run package verification.

## Compatibility

- Existing `capture-web-evidence.mjs` CLI arguments and output shape remain unchanged.
- Existing unified CLI commands remain unchanged.
- No audit-run, artifact-envelope, screening-observation, or assessment schema version changes occur in this slice.
- The new scan schemas begin at `1.0.0` and are not added to the orchestration registry until a later evidence-binding slice.

## Acceptance criteria

- `accessibility-audit scan-web` works against the fixed fixture and a public URL.
- The same browser load produces capture evidence and axe results.
- Machine violations, incomplete results, passes, and inapplicable rules are distinguishable.
- Machine passes never alter profile outcomes.
- A compact AI context is generated without raw DOM or full AX-tree content.
- Network and interaction boundaries remain at least as strict as the existing adapter.
- Exact tool versions, target hashes, viewport, final URL, and blocked requests are recorded.
- CI covers the deterministic scanner with real Chromium.
- The manual workflow can produce downloadable scan artifacts for a public URL.
