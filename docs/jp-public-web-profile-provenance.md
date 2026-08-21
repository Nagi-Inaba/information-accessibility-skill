# `jp-public-web` profile provenance and scope

The current `jp-public-web` identifier is retained for compatibility, but it describes a composite review preset rather than a universal Japanese public-sector standard profile.

## Components

### 1. JIS X 8341-3:2016 A/AA

- 38 A/AA success criteria represented with `JIS-X-8341-3-2016-SC-*` identifiers.
- This is the JIS portion of the preset and must be reported separately.
- JIS X 8341-3:2016 is based on the technical content of WCAG 2.0 / ISO/IEC 40500:2012.

### 2. Japan Digital Agency WCAG 2.2 extension

- 18 WCAG 2.1/2.2 A/AA criteria that are not included in JIS X 8341-3:2016.
- The source is the Japan Digital Agency accessibility policy for pages under the `www.digital.go.jp` domain.
- This is an organization-specific target set. It must not be described as a legal requirement, JIS requirement, or universal profile for every Japanese public website.

## Selection guidance

| Need | Recommended selection |
| --- | --- |
| Review against WCAG 2.2 A/AA as a complete modern WCAG set | `web-modern` |
| Review only the JIS X 8341-3:2016 A/AA portion | Use the JIS group of the composite preset until a standalone JIS profile is introduced |
| Reproduce the Digital Agency's published combination | `jp-public-web`, while naming both the JIS group and the Digital Agency extension |
| Apply an organization's own additional requirements | Define a separate organizational extension rather than relabeling the Digital Agency set |

## Reporting rule

A report using `jp-public-web` should state:

1. the exact organization and target scope;
2. that the JIS result covers 38 criteria;
3. that the additional 18 criteria are a separate WCAG extension;
4. why the extension was selected;
5. that results for one group do not change the normative status of the other group.

Do not use wording such as “the Japanese public-Web profile requires 56 criteria.” Prefer wording such as:

> This review used JIS X 8341-3:2016 A/AA together with the 18 additional WCAG 2.2 A/AA targets published in the Japan Digital Agency accessibility policy. The two groups are reported separately.

## Compatibility and migration

The `jp-public-web` ID remains available so existing audit records and integrations can still be read. A future profile-composition model should expose the following selections independently:

- JIS X 8341-3:2016 A/AA;
- WCAG 2.2 A/AA;
- the Digital Agency extension preset;
- an organization-defined extension set.

Introducing those independent selections requires a versioned migration that preserves the original profile ID, group provenance, requirement IDs, and claim boundary in historical runs.
