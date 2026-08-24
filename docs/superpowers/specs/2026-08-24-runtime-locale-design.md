# Runtime Locale Design

## Goal

Make the human-readable CLI, profile discovery, requirement browser, exact requirement lookup, screen-reader checklist, and report output consistently selectable with `ja` or `en`, while preserving every machine-readable ID, schema key, and enum value.

## Scope

- A global CLI selector: `accessibility-audit --locale ja|en ...`
- Command-local `--locale ja|en` for `profiles`, `requirements`, `requirement`, `screen-reader-checklist`, and `report`
- Localized root help, command help, and wrapper dispatch errors
- Localized profile names, target scopes, and group labels
- Localized requirement text/Markdown with bilingual search
- Japanese WCAG titles derived from the existing corresponding JIS or additional-WCAG record
- English JIS titles derived from the corresponding WCAG record; JIS 4.1.1 uses the maintained fallback `Parsing`
- A complete Japanese screen-reader-checklist overlay whose identifiers and evidence enums remain canonical
- Existing profile-aware report locale and golden fixtures remain the report implementation

## Architecture

`references/runtime-locales.json` is the human-readable locale catalog. `scripts/lib/runtime-locale.mjs` validates and reads it, resolves explicit global or command-local locale values, translates CLI registry strings, localizes profile metadata, and applies the screen-reader overlay. English canonical source text remains in the existing registries; the locale catalog contains Japanese UI text, profile text, and the complete checklist translation.

The wrapper removes only the global `--locale` pair, sets `ACCESSIBILITY_AUDIT_LOCALE` for child commands, and leaves command-local locale flags available to commands that explicitly accept them. JSON outputs add a `locale` and localized display fields but do not translate IDs, schema keys, enum values, evidence types, or claim tiers.

## Compatibility

- Existing commands without `--locale` retain their current default behavior.
- `requirements` retains English as its historical default.
- `report` retains Japanese as its historical default.
- Root CLI help retains English as its historical default.
- Exact IDs and enum values are byte-identical between localized JSON outputs.
- Codex and Claude distributions must contain byte-identical runtime locale files.

## Validation

The locale catalog validator rejects:

- unsupported locale IDs
- missing Japanese CLI strings used by the command registry
- missing or extra profile IDs/group IDs
- missing or extra screen-reader pattern/check IDs
- translated checklist arrays whose lengths differ from the canonical registry
- empty translated human-readable strings
- attempts to translate canonical evidence-type arrays or boolean fields

## Claim boundary

Localization changes presentation only. It does not change requirement mappings, evidence, outcomes, claim tiers, procedure availability, or conformance status.
