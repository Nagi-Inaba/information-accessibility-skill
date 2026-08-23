# Real Web inspection / 実Web検査

The core CLI remains a dependency-light control plane. Browser inspection is optional and has two entry points:

- `accessibility-audit scan-web`: run axe-core and bounded browser probes before AI analysis.
- `capture-web-evidence.mjs`: capture raw rendered evidence without the rule engine.

## Install the browser capability

Install the exact supported versions in the host environment:

```sh
npm install --no-save --package-lock=false playwright@1.62.1 axe-core@4.13.0
npx playwright@1.62.1 install chromium
```

`axe-core` is a direct dependency of the installable skill package. Playwright and its Chromium binary remain an optional host capability because they are substantially larger.

## Run rule-based checks first

```sh
accessibility-audit scan-web \
  --url https://example.com/ \
  --profile web-modern \
  --output audit-runs/example/automated-scan.json \
  --context-output audit-runs/example/automated-scan.context.json
```

The full scan contains:

- axe-core violations, incomplete results, pass summaries, and inapplicable summaries;
- exact related profile requirement IDs when a rule has a registered WCAG tag;
- rendered DOM and Chromium accessibility tree with SHA-256 values;
- bounded Tab focus sampling;
- a separately stamped 320 CSS-pixel reflow proxy measurement;
- frame coverage, final URL, browser/scanner versions, viewport, and blocked-network evidence.

The compact context is designed for AI review. It omits the raw DOM, full accessibility tree, pass-node details, and inapplicable details. It is capped at 100 findings, 20 nodes per finding, and 512 KiB, with explicit truncation counts. Start AI analysis from the compact context and open only the bounded evidence needed for a disputed or unclear item.

Machine results use `machine_violation`, `review_candidate`, and `unmapped_finding`. Related WCAG/JIS identifiers are references only; the scan does not write profile outcomes.

## Network and interaction boundary

For `scan-web`, the browser session:

- accepts only HTTP(S) targets and rejects URL credentials;
- rejects private, loopback, link-local, reserved, mapped-private, and multicast addresses by default;
- resolves every allowed hostname before launch and pins Chromium's resolver to the selected public endpoint;
- denies all unlisted hostnames with Chromium host-resolver rules;
- allows only the target origin and up to eight explicitly named extra origins;
- blocks service workers, WebSocket server connections, WebTransport, and WebRTC;
- permits HTTP `GET` and `HEAD` only;
- records sanitized blocked-request and blocked-channel entries;
- performs Tab-only focus sampling and aborts if focus causes a real document navigation.

`--allow-localhost` is only for a trusted local fixture or development server. Do not use it for an untrusted URL. Extra origins must be exact bare origins such as `https://cdn.example.com`; wildcards, credentials, paths, query strings, and fragments are rejected.

Host pinning selects one verified endpoint per hostname for the scan. A site that requires DNS-based traffic steering or an enterprise proxy may therefore need a controlled test environment or an explicitly prepared fixture.

The scanner does not click, press Enter/Space, submit forms, download files, purchase, publish, upload, or edit the target. A 320 CSS-pixel viewport is a repeatable overflow proxy, not a substitute for the complete reflow procedure.

## Raw evidence-only adapter

The original adapter remains available and retains its lighter behavior:

```sh
node codex/skills/information-accessibility-practice/scripts/capture-web-evidence.mjs \
  --url https://example.com/ \
  --output audit-runs/example/web-evidence.json
```

It captures rendered DOM, Chromium accessibility tree, focus path, viewport/browser metadata, and cross-origin request evidence, but does not run axe-core. The raw bundle is internal evidence and can contain page text and target-specific information.

## Current integration seam

`automated-web-scan.json` and its compact context are standalone scanner outputs in this release. They are not yet registered directly in the immutable audit-run artifact graph. The next integration slice will bind the scan hash and selected machine observations to the run-backed screening/import workflow.
