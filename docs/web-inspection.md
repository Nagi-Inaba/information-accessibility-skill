# Real Web inspection adapter / 実Web検査adapter

The core CLI remains a dependency-light control plane for audit records. Real rendered-Web evidence is provided by the optional Playwright adapter:

```sh
node codex/skills/information-accessibility-practice/scripts/capture-web-evidence.mjs \
  --url https://example.com/ \
  --output .a11y-audit/evidence/example.web-evidence.json
```

Install Playwright in the host environment when this capability is required:

```sh
npm install --no-save playwright
npx playwright install chromium
```

## What it captures

- requested URL, final URL, and HTTP status;
- rendered DOM and SHA-256;
- Chromium accessibility tree and SHA-256;
- browser version and viewport;
- keyboard Tab focus path;
- active element after the sampling sequence;
- cross-origin requests blocked by the adapter policy.

The bundle is **raw internal evidence**. It may contain page text and target-specific information and should not be published directly. A public report must use the project's sanitization/publication boundary.

## Network boundary

By default the adapter:

- accepts only HTTP(S);
- rejects URLs containing credentials;
- rejects localhost/private/link-local targets;
- resolves the target hostname before inspection and rejects private-address resolution;
- allows the target origin only;
- blocks undeclared cross-origin requests.

Use repeated `--allow-origin https://cdn.example.com` only for origins that are intentionally required by the named target. `--allow-localhost` exists for trusted local fixtures and development environments; it should not be used as a generic bypass for untrusted URLs.

## Interaction boundary

The adapter performs read-only page loading plus bounded `Tab` focus sampling. It does not submit forms, purchase, publish, upload, modify accounts, or intentionally activate controls. Use `--focus-steps 0` when even focus movement is outside the permitted inspection scope.

## Capability boundary

This adapter provides rendered DOM, Chromium accessibility-tree, viewport, and keyboard-focus evidence. It does **not** claim to replace a real screen reader session. NVDA, VoiceOver, JAWS, TalkBack, or other assistive-technology behavior must be recorded separately when the applicable procedure requires it.
