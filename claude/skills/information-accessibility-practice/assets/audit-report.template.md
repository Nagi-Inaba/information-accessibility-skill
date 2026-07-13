# Accessibility Audit Report

> Status: draft / reviewed / final
> This report applies only to the target, version, scope, environment, and date stated below.

## 1. Audit Identity

- Target:
- Version / commit:
- URLs / files:
- Audit profile:
- Audit dates:
- Evaluator:
- Independent review:
- Evidence record:

## 2. Executive Summary

- Overall result: Do not use a generic pass/fail or compliance label.
- P0 findings:
- P1 findings:
- P2 findings:
- Untested requirements:
- Indeterminate requirements:
- Highest claim tier allowed by the validator:
- Required human decisions:

## 3. Scope

### Included

- [Included target]

### Excluded

- [Excluded target and rationale]

### Complete User Processes

- [Complete user process]

### Third-Party Content

- [Third-party content and responsibility boundary]

## 4. Test Environment

| Layer | Product / version | Configuration or purpose |
| --- | --- | --- |
| OS |  |  |
| Browser / renderer |  |  |
| Assistive technology |  |  |
| Input mode |  |  |
| Automated screening |  | Supporting evidence only |

## 5. Method

Describe sampling, full-page boundaries, complete-process coverage, manual checks, keyboard tests, browser accessibility-tree inspection, assistive-technology tests, document structure checks, and automated screening. Link the machine-readable assessment record.

## 6. Findings

For each failed result, create a structured record in `assessment.findings` before rendering. It must include the priority, related requirement ID, location, affected users, observation, remediation, and verification method.

| ID | Priority | Requirement / check | Location | Affected users | Observation | Remediation | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |

## 7. Profile Coverage

| Result | Registered profile requirements | Supporting screening checks |
| --- | ---: | ---: |
| Pass |  |  |
| Fail |  |  |
| Not applicable |  |  |
| Not tested |  |  |
| Cannot tell |  |  |

List missing catalog IDs and confirm whether every profile requirement has a recorded row. Catalog coverage is not the same as completed evaluation.

For `jp-public-web`, also report the two registered groups separately:

| Result | JIS X 8341-3:2016 A/AA (38) | Added WCAG 2.2 A/AA (18) |
| --- | ---: | ---: |
| Pass |  |  |
| Fail |  |  |
| Not applicable |  |  |
| Not tested |  |  |
| Cannot tell |  |  |

## 8. Participation Coverage

| Gate | Result | Evidence / limitation |
| --- | --- | --- |
| Find |  |  |
| Receive |  |  |
| Understand |  |  |
| Participate |  |  |
| Continue |  |  |

## 9. Limitations And Residual Risk

- [Limitation or residual risk]
- Automated tools do not prove absence of accessibility barriers.
- Results do not extend beyond the recorded target version and scope.

## 10. Remediation And Retest

| Action | Owner | Due | Retest method | Status |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## 11. Claim Statement

Insert only the exact wording accepted by `validate-assessment.mjs`. Put target-specific detail in this report, not by editing the registered claim template.
