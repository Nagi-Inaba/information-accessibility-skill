# Independent `scan-web` Plan Audit

## First pass

Verdict: `CHANGES REQUIRED BEFORE IMPLEMENTATION`.

The first review identified blockers around cross-frame execution, the meaning of deterministic results, criterion-reference provenance, partial output handling, reflow state, focus ordering, DNS rebinding, artifact sensitivity, compact-context bounds, dependency resolution, deduplication, and compatibility characterization.

## Applied plan changes

The design and implementation plan were amended to:

- treat deterministic as rule-based rather than byte-stable live-site output;
- use isolated per-frame axe execution with explicit coverage records;
- keep criterion IDs as `reference_only` links and isolate unmapped findings;
- preserve a complete full scan when optional context publication fails;
- record reflow as a separately stamped review candidate;
- fix the order of axe, DOM/AX, focus, and reflow operations;
- strengthen network, output, size, truncation, and dependency contracts;
- add compatibility, frame, Unicode, reflow, focus-navigation, network-policy, and global-install tests.

## Second pass

Verdict: `APPROVED FOR IMPLEMENTATION`.

The second reviewer found no remaining critical blockers. Its remaining clarifications—coverage status, context priority, exact Playwright support, fixture-only hash stability, origin normalization, dedup occurrence counts, explicit scroller definition, UTF-8 context size, and emitted experimental status—were incorporated into the final plan and implementation.
