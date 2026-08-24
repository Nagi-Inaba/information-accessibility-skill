# Profile Basis and Composition Design

## Goal

Correct the ambiguous `jp-public-web` profile without breaking existing records. The runtime must distinguish a general standards profile from an organization-specific policy pattern and expose each report group's adoption basis.

## Verified source context

- JIS X 8341-3:2016 is the Japanese standard profile aligned with WCAG 2.0; WAIC provides public implementation and testing guidance.
- The Digital Agency accessibility page, verified on 2026-08-24, states that the agency uses JIS X 8341-3:2016 and WCAG 2.2 as indicators for its own continuing accessibility work.
- The Digital Agency's published 2025 test result identifies `https://www.digital.go.jp/` as the tested page set and reports the result under JIS X 8341-3:2016.
- The repository's existing set of 18 additional WCAG 2.1/2.2 criteria is therefore retained only as a legacy organization-policy extension derived from the recorded Digital Agency source. It is not described as a general Japanese public-sector requirement.

## Active profile choices

### `web-modern`

- 55 WCAG 2.2 A/AA requirements.
- Profile kind: `standard_profile`.
- Default adoption basis: W3C Recommendation.

### `jis-x-8341-3-2016-aa`

- 38 JIS X 8341-3:2016 A/AA requirements.
- Profile kind: `standard_profile`.
- Formal standards target with WAIC public guidance.
- This is the default choice when the requested basis is JIS alone.

### `jp-public-web`

- Existing ID retained for read and generation compatibility.
- Display name explicitly identifies it as a Digital Agency-derived legacy composite.
- Profile kind: `organizational_policy_pattern`.
- Overall composite is not presented as a general Japanese standards profile or a formal conformance target.
- Requires explicit adoption.
- Contains two separately labelled groups:
  - 38 JIS requirements with `standard` basis.
  - 18 additional WCAG requirements with `organizational_policy` basis and `explicit_only` adoption.
- Migration guidance recommends `jis-x-8341-3-2016-aa` for JIS-only work and `web-modern` for WCAG 2.2 work.

## Machine-readable metadata

Every active profile declares:

- `profile_kind`
- `explicit_adoption_required`
- `localized.ja` profile and group labels
- `group_bases`, keyed exactly by report group ID

Every group basis declares:

- `kind`: `standard` or `organizational_policy`
- `adoption`: `profile_default` or `explicit_only`
- `source_ids`
- Japanese and English labels
- Japanese and English scope statements

The custom registry validator and JSON Schema reject missing, extra, or malformed basis entries.

## Report behavior

The profile-aware presentation includes a localized basis object for each group. Markdown and HTML reports display:

- the basis beside each group section;
- the basis and adoption rule in the claim boundary;
- a clear warning for the legacy composite that explicit adoption is required.

Machine outcomes, requirement IDs, evidence provenance, and claim tiers are unchanged.

## Migration

Existing `jp-public-web` assessment and audit-run records remain readable because the profile ID and 56 requirement IDs are retained. New work should select:

- `jis-x-8341-3-2016-aa` for JIS X 8341-3:2016 A/AA only;
- `web-modern` for WCAG 2.2 A/AA only;
- `jp-public-web` only when the organization explicitly adopts the legacy Digital Agency-derived 56-item composite.

The migration document explains that changing a profile requires a new assessment or run; existing records are never silently rewritten.

## Non-goals

- Do not claim that the current Digital Agency page defines the repository's exact 18-item set.
- Do not define the composite as a Japanese law, JIS requirement, WAIC standard profile, or universal public-sector requirement.
- Do not silently migrate or reinterpret historical `jp-public-web` records.
