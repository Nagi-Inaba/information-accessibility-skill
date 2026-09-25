# 対応版と互換性

初回の[プレリリース v0.1.0](https://github.com/Nagi-Inaba/information-accessibility-skill/releases/tag/v0.1.0)はsource commit `43b33adbfb454fc17781912aab20822a2a56ba5d`に固定されています。同じpackage版でも過去の開発履歴ではschemaと挙動が変わっているため、報告・再現・導入には完全なcommit SHAを記録してください。配布物にはpackage版、commit、各ファイルのSHA-256を添えています。

現行の監査専用導入と任意のauthorized fixerは、ともにorchestration registry `17.0.0`を使用します。installerは同梱されたfeature manifestとregistry版の一致を確認し、異なる組合せを拒否します。監査専用導入には`fix-authorization`・`fix-handoff`・`change-record`のpayload schemaと修正実行CLIを含めません。通常の監査runはこの構成で作成・検証できます。これらのartifactを含む既存runの読取りには、対応する修正機能と元のpackage／commitを保持してください。修正機能の追加・除外によって既存の監査runや元の証拠を書き換えません。

セキュリティ修正の対象は現在のmainと、公開済みreleaseがある場合はその最新版です。古い開発commitの個別保守や、旧形式で新しい監査を継続できることは保証しません。実行要件はNode.js 20以上です。Web検査の依存関係は同梱package.jsonを正本とし、現在はaxe-core 4.13.0、任意のPlaywright 1.62.1です。

## 現行の主要形式

| 記録 | 新規作成する版 | 過去形式の扱い |
| --- | --- | --- |
| audit run | 17.0.0 | 1.0.0〜16.0.0は凍結schemaで読取り。継続操作には現行runが必要。 |
| orchestration registry | 17.0.0 | runの版に対応する1.0.0〜16.0.0を保持。run 17の旧registry 16も読取り。 |
| artifact envelope | 4.0.0 | runの版に対応する1.0.0〜3.0.0を保持。 |
| assessment | 2.0.0 | 1.0.0を読取り。旧human_verifiedは本人確認のない自己申告として表示。 |
| screening observations | 4.0.0 | 1.0.0〜3.0.0を読取り。過去の不足証拠を自動補完しない。 |
| declared human review | 3.0.0 | 凍結1.0.0／2.0.0を読取り。複数確認者の一致・不一致と訂正履歴を保持。署名付きreview recordとは別のartifact。 |
| audit context | 1.0.0 | 現行runだけで登録。参加観点、制約、次回確認、独立監査・資料整備の申告を根拠付きで記録。旧runに暗黙適用しない。 |
| human review queue | 3.0.0 | 凍結1.0.0／2.0.0を過去runで読取り。箇所・優先度・観測参照は自動補完しない。 |
| remediation plan | 3.0.0 | 凍結1.0.0／2.0.0を対応する過去runで読取り。 |
| fix authorization／fix handoff／change record | 2.0.0／1.0.0／3.0.0 | 任意のfixer導入時のみ。旧change record 1.0.0／2.0.0は元記録として読取り、実行者の証明として扱わない。 |
| human review record／audit bundle record | 3.0.0／1.0.0 | review record 1.0.0／2.0.0の旧署名も読取り。 署名検証には受領者が別途選んだ信頼方針が必要。 |
| scanner import record | 1.0.0 | 保存済みraw結果との一致を検証。自動結果は人手の適否判定にならない。 |

その他の形式と正確な契約は配布物の `references/*.schema.json`、対応するregistry、`source-manifest.json`を参照してください。凍結schemaの存在だけで、現在の資料との互換性や全操作の利用可能性を意味するものではありません。

## 過去runの読取りと再レポート

| audit-run版 | 対応registry版 | 現行packageでの扱い |
| --- | --- | --- |
| 1.0.0〜2.0.0 | 1.0.0 | 保存済みresourceとassessmentが契約に合えばread-only検証・再レポート。登録・統合は不可。 |
| 3.0.0 | 2.0.0 | 同上。 |
| 4.0.0 | 3.0.0 | 同上。 |
| 5.0.0〜16.0.0 | run版から1を引いたregistry版 | 保存済みresourceとassessmentが契約に合えばread-only検証・再レポート。登録・統合は不可。 |
| 17.0.0 | 16.0.0または17.0.0 | 旧registry 16はread-only。registry 17のみ現行操作に対応。 |

旧runと同じ時点のskill folderを保管している場合、`validate-run --input <run.json> --output <new-validation.json> --historical-resources <saved-skill-root>`で読み取り、`report --run <run.json> --assessment <saved-assessment.json> --historical-resources <saved-skill-root> --output <new-report.md>`で再出力する。`<saved-skill-root>/references/`のcatalog・criterion procedures・audit methodsの実バイトSHA-256がrunの記録と一致しなければ拒否する。orchestration registryは現行packageに同梱した凍結版を使い、run 2以降は記録されたSHA-256とも照合する。standards registryはrunに版番号しか記録されていないため、過去の内容をハッシュで認証できない。元packageのcommit／release manifestを別途保存し、この制限を再出力したreportにも明示する。

この経路は元run・artifact・assessmentを変更しない。claim tierや人手確認結果を自動昇格せず、現在の検証契約を通る記録だけ再出力する。run 1.0.0にはorchestration registryのSHA-256記録がないため、現行packageに同梱した凍結版を版番号で解決する。保存済みresourceがないrunのハッシュ差分を推測して埋めることはしない。

## 既存記録を扱うとき

1. 元のrun、artifact、証拠、assessment、report、署名と、それを作成したpackage／commitを組で保存します。
2. まずそのpackageで読取り専用のvalidate・status・reportを実行します。現在のpackageでresource hashが一致しなければ、元の記録を書き換えて通しません。
3. 現行の対象測定、通信方針、操作承認、人手レビュー署名が必要なら、新しいrunで対象と証拠を取得します。移行・再検査の履歴を別記録として残します。
4. 過去の自己申告へ本人確認済みの署名を後付けしたと扱わず、必要な担当者が新しい対象範囲を確認して署名します。

一般的な自動移行ツールは未提供です。旧runは上記の読取り専用の再レポート経路を使います。旧記録の自動変換、署名維持、旧runのそのままの継続を利用者へ約束しないでください。破壊的変更と移行要否は[CHANGELOG](../CHANGELOG.md)へ記録します。
