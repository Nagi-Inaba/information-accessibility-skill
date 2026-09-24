# 対応版と互換性

2026-09-19時点では、package `0.1.0` は開発中で、公開済みのtag付きreleaseはありません。同じpackage版でも履歴中にschemaと挙動が変わっているため、報告・再現・導入には完全なcommit SHAを記録してください。今後の配布物はpackage版、commit、各ファイルのSHA-256をセットで示します。

現行の監査専用導入と任意のauthorized fixerは、ともにorchestration registry `17.0.0`を使用します。installerは同梱されたfeature manifestとregistry版の一致を確認し、異なる組合せを拒否します。監査専用導入には`fix-authorization`・`fix-handoff`・`change-record`のpayload schemaと修正実行CLIを含めません。通常の監査runはこの構成で作成・検証できます。これらのartifactを含む既存runの読取りには、対応する修正機能と元のpackage／commitを保持してください。修正機能の追加・除外によって既存の監査runや元の証拠を書き換えません。

セキュリティ修正の対象は現在のmainと、公開済みreleaseがある場合はその最新版です。古い開発commitの個別保守や、旧形式で新しい監査を継続できることは保証しません。実行要件はNode.js 20以上です。Web検査の依存関係は同梱package.jsonを正本とし、現在はaxe-core 4.13.0、任意のPlaywright 1.62.1です。

## 現行の主要形式

| 記録 | 新規作成する版 | 過去形式の扱い |
| --- | --- | --- |
| audit run | 16.0.0 | 1.0.0〜15.0.0は凍結schemaで読取り。継続操作には現行runが必要。 |
| orchestration registry | 15.0.0 | runの版に対応する1.0.0〜14.0.0を保持。 |
| artifact envelope | 3.0.0 | runの版に対応する1.0.0／2.0.0を保持。 |
| assessment | 2.0.0 | 1.0.0を読取り。旧human_verifiedは本人確認のない自己申告として表示。 |
| screening observations | 4.0.0 | 1.0.0〜3.0.0を読取り。過去の不足証拠を自動補完しない。 |
| declared human review | 3.0.0 | 凍結1.0.0／2.0.0を読取り。複数確認者の一致・不一致と訂正履歴を保持。署名付きreview recordとは別のartifact。 |
| audit context | 1.0.0 | 現行runだけで登録。参加観点、制約、次回確認、独立監査・資料整備の申告を根拠付きで記録。旧runに暗黙適用しない。 |
| human review queue | 3.0.0 | 凍結1.0.0／2.0.0を過去runで読取り。箇所・優先度・観測参照は自動補完しない。 |
| remediation plan | 3.0.0 | 凍結1.0.0／2.0.0を対応する過去runで読取り。 |
| fix authorization／change record | 各2.0.0 | 凍結1.0.0を対応する過去runで読取り。古い許可を現行の実行許可へ昇格しない。 |
| human review record／audit bundle record | 3.0.0／1.0.0 | review record 1.0.0／2.0.0の旧署名も読取り。 署名検証には受領者が別途選んだ信頼方針が必要。 |
| scanner import record | 1.0.0 | 保存済みraw結果との一致を検証。自動結果は人手の適否判定にならない。 |

その他の形式と正確な契約は配布物の `references/*.schema.json`、対応するregistry、`source-manifest.json`を参照してください。凍結schemaの存在だけで、現在の資料との互換性や全操作の利用可能性を意味するものではありません。

## 既存記録を扱うとき

1. 元のrun、artifact、証拠、assessment、report、署名と、それを作成したpackage／commitを組で保存します。
2. まずそのpackageで読取り専用のvalidate・status・reportを実行します。現在のpackageでresource hashが一致しなければ、元の記録を書き換えて通しません。
3. 現行の対象測定、通信方針、操作承認、人手レビュー署名が必要なら、新しいrunで対象と証拠を取得します。移行・再検査の履歴を別記録として残します。
4. 過去の自己申告へ本人確認済みの署名を後付けしたと扱わず、必要な担当者が新しい対象範囲を確認して署名します。

一般的な自動移行ツールは未提供です（Issue #28）。旧記録の自動変換、署名維持、旧runのそのままの継続を利用者へ約束しないでください。破壊的変更と移行要否は[CHANGELOG](../CHANGELOG.md)へ記録します。
