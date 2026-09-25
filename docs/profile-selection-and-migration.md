# Profile selection and migration

Choose the profile that matches the standard or policy adopted for the assessment. A Japanese-language or public-facing website does not automatically require the legacy composite.

| Assessment basis | Profile | Requirements |
| --- | --- | ---: |
| JIS X 8341-3:2016 A/AA | `jis-x-8341-3-2016-aa` | 38 |
| WCAG 2.2 A/AA | `web-modern` | 55 |
| Explicitly adopted legacy Digital Agency-derived composite | `jp-public-web` | 56 |

The composite keeps the 38 JIS requirements and the 18 additional WCAG 2.1/2.2 requirements in separate report groups. Their basis is labeled as a standard or an organizational policy. The registry records that the current Digital Agency policy does not define the repository's exact 18-item set. Do not present that stored set as a general Japanese public-sector requirement or as a new statement of current policy.

The registered sources, scope, and adoption metadata are in [the standards registry](../shared/skill/references/standards-registry.json). Use `accessibility-audit profiles list --locale en` to inspect the available profiles.

## Existing records

Existing `jp-public-web` records remain unchanged. Their profile ID and 56-item composition are retained for compatibility; updated reports explain the organizational adoption boundary.

To evaluate a different standard, create a new assessment or audit run with the selected profile. Do not rename the profile ID inside an existing record or treat its results as evidence for a different profile without reviewing the corresponding requirements and evidence.

Selecting a profile or creating a record does not complete an evaluation. Newly initialized rows remain untested, and formal outcomes still require the registered procedures and target-specific human evidence.

## 日本語での選び方

JISだけで評価する場合は`jis-x-8341-3-2016-aa`、WCAG 2.2だけで評価する場合は`web-modern`を選びます。`jp-public-web`は、JISの38件と追加WCAGの18件を組み合わせた方針を、組織が明示的に採用するときに使います。

既存の`jp-public-web`記録は、そのまま保存してください。別の規格で評価する場合は、新しい評価台帳または監査runを作成します。既存記録のプロファイルIDを書き換えても、評価した範囲や証拠が新しい規格へ引き継がれるわけではありません。
