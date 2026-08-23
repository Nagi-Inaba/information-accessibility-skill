# `scan-web` Code-Review Amendments

This note records the implementation changes made after independent review of PR #145. It is normative for this slice where it differs from the earlier design or plan.

## Network containment

- Allowed DNS hostnames are resolved before browser launch.
- Chromium is launched with exact `--host-resolver-rules` mappings for those selected endpoints and a catch-all `MAP * ~NOTFOUND` rule.
- Proxy use is disabled for the scanner session.
- Service workers are blocked.
- WebSocket connections are routed without connecting to the server; WebTransport and WebRTC constructors are blocked before page code runs.
- HTTP requests are limited to `GET` and `HEAD`, exact allowed origins, and sanitized policy logging.
- IPv4-mapped IPv6 and additional non-public/reserved address ranges are denied.
- The repository does not add a manual arbitrary-public-URL GitHub Actions workflow in this slice. The owner can invoke the CLI in a deliberately isolated environment instead.

## Compatibility

The shared browser-session refactor keeps the existing raw evidence adapter's default viewport-only context. Fixed locale, timezone, device scale, color scheme, reduced motion, service-worker blocking, host pinning, and active-channel blocking are scanner-only options and are recorded in scanner output.

## Coverage and output

- `scan_status: complete` means the pipeline finished and published a complete record.
- `frame_coverage.coverage_status` separately reports `complete`, `partial`, or `none` machine-rule coverage.
- Full scan and compact context schemas are strict and reject undeclared properties in rule records.
- Context prioritization retains frame failures and the reflow candidate before bulk rule violations, then records omitted item/node counts.
- Same-document fragment changes during Tab sampling are permitted; document navigation is not.
