# Real Web inspection / 実Web検査

The core CLI remains a dependency-light control plane. Browser inspection is optional and has two entry points:

- `accessibility-audit scan-web`: run axe-core and bounded browser probes before AI analysis.
- `capture-web-evidence.mjs`: capture raw rendered evidence without the rule engine.

## Install the browser capability

Install the exact supported versions in the host environment. Use only a browser runtime permitted by that host:

```sh
npm install --no-save --package-lock=false playwright@1.62.1 axe-core@4.13.0
accessibility-audit preflight-web --browser-channel chrome --format json
```

`axe-core` is a direct dependency of the installable skill package. Playwright and the browser remain optional host capabilities. `--browser-channel chrome` selects installed system Chrome without installing a browser. On a host that explicitly permits Playwright Chromium (such as the existing Ubuntu CI job), install it with `npx playwright@1.62.1 install chromium` and omit the channel. Verify browser trust/signature using the host's own policy. The capability probe measures behavior, not binary trust. Chrome's observed version is recorded because it can update independently of Playwright.

## 検査前の機能確認 / Capability preflight

`doctor` only checks package and dependency presence. `preflight-web` starts an isolated browser process and measures the following capabilities on a fixed fixture. Both scanner and capture adapter repeat this probe before resolving the target hostname or opening the target. The machine-readable source is the installed [capability contract](../shared/skill/references/web-capabilities.json), referenced by the skill package and shared agent manifest; the latter path is relative to the installed skill root.

| Capability | Fixed-fixture measurement | What still needs target evidence |
| --- | --- | --- |
| `browser_dom` | A script-generated DOM property and button text | Target structure and meaning |
| `accessibility_tree` | Chromium CDP returns a button's expected role/name | Target roles, names and relationships |
| `keyboard_input` | Two Tab presses move to the expected buttons | Complete target keyboard paths and state changes |
| `responsive_viewport` | Width and media query change at 320 and 1280 CSS pixels | Human reflow/text-resize procedures |
| `screen_reader_runtime` | Always `not_verified` by this adapter | Human session with OS/browser/AT versions and results |
| `network_fetch` | Intercepted fixture GET succeeds; denied fetch and WebSocket are actually intercepted and blocked | Target reachability, authentication, permission and origin policy |

The fixture is fulfilled locally; other requests are aborted and browser DNS is disabled. The browser control connection uses an ephemeral loopback endpoint. No real target is supplied to preflight. The probe has bounded operations and teardown; it terminates only its own browser on a timeout. [Playwright BrowserServer](https://playwright.dev/docs/api/class-browserserver) supplies the lifecycle controls, and [BrowserContext routing](https://playwright.dev/docs/api/class-browsercontext#browser-context-route-web-socket) supplies request interception.

The default requirement is the five browser capabilities. To require an actual screen-reader environment as well, use:

```sh
accessibility-audit preflight-web --browser-channel chrome \
  --require browser_dom,accessibility_tree,keyboard_input,responsive_viewport,network_fetch,screen_reader_runtime \
  --format json
```

That request returns `blocked` with exit code 4 because this adapter cannot verify an actual screen-reader session. A missing dependency, unsupported Playwright version, browser launch failure, operation failure or timeout also leaves affected checks unconfirmed with an explicit `next_test`. Invalid arguments exit 2. Success exits 0 with `ready`, but `target_inspected`, `inspection_complete`, and `profile_outcomes_written` remain false. The command does not open or change an assessment or run. Keep affected profile rows `not_tested` and include unavailable checks and next tests in the report; do not translate an infrastructure failure into target failure or an automatic pass.

Codex, Claude and other Node hosts use this same optional adapter and must pass the same probe under their own permissions. Their native browser tools are not automatically detected. Use separately measured capability evidence for another integration. The AX tree is not a substitute for speech output or real assistive-technology behavior. A successful probe and a freshly initialized 55-row ledger do not complete an inspection.

## Run rule-based checks first

```sh
accessibility-audit scan-web \
  --browser-channel chrome \
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
  --browser-channel chrome \
  --url https://example.com/ \
  --output audit-runs/example/web-evidence.json
```

It captures rendered DOM, Chromium accessibility tree, focus path, viewport/browser metadata, the diagnostic `runtime_preflight`, and cross-origin request evidence, but does not run axe-core. The raw bundle is internal evidence and can contain page text and target-specific information. The stored preflight describes the earlier fixture, not the target itself.

## Current integration seam

The compact context is a standalone review aid. For immutable run registration, export the raw axe results and evidence bundle with paired `--axe-output` and `--evidence-output`, measure and bind that saved target, and use the [scanner importer](../shared/skill/references/scanner-import.md). It preserves raw hashes, configuration, snapshot identity, unknown rules and human-review requirements without generating profile pass/fail outcomes.
