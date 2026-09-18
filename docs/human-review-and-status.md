# 人手レビューの記録と監査の再開

人が確認した不適合は、改善計画が決まる前に記録できます。登録済みの証拠から主張できる範囲を確認し、必要な範囲を明示してレポートを作成します。

## 改善計画前に不適合を記録する

`declared-human-review`の各reviewには、任意の`finding`を追加できます。`profile_outcome`が`fail`の場合だけ使用できます。

```json
{
  "finding": {
    "id": "FIND-IMAGE-001",
    "priority": "P1",
    "location": "購入画面の商品画像",
    "affected_users": ["スクリーンリーダーを使う利用者"],
    "observation": "画像が伝える商品の違いを代替テキストから読み取れない。"
  }
}
```

これはreviewへ加えるフィールドの例です。review全体には、従来どおり条項、手順、一次資料、対象固有の証拠、判定理由が必要です。人手の確認をAIが代行したと申告するためのフィールドではありません。

`merge`はこの指摘をassessmentへ反映し、対応する計画がなければ`remediation_status: "unplanned"`、`remediation: null`、`verification: null`とします。レポートには「改善計画は未策定」と表示します。standalone assessmentも同じ表現を使えます。

後から`remediation-plan`を登録するときは、従来どおり同じrun内の人手レビューをinputとし、`basis: "verified_failure"`、該当条項、`source_artifact_ids`を指定します。新しいrun版から再度統合すると、指摘のID・箇所・影響・観測・優先度を維持したまま、計画を追加します。複数の計画がある場合はID順に改善案と再確認方法をまとめます。指摘を記録する責任と、改善を計画・担当する責任は別です。

従来の、指摘情報を改善計画から取得する記録も引き続き使用できます。その経路では不適合に対応する計画が必要です。`finding`を使う新しい経路でも、箇所・影響・優先度・観測・対象固有の証拠は省略できません。

## 証拠が許す主張範囲を選ぶ

```sh
node codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs merge \
  --run audit-runs/example/run.v4.json \
  --assessment audit-runs/example/baseline.json \
  --artifact audit-runs/example/artifacts/screen.json \
  --artifact audit-runs/example/artifacts/queue.json \
  --artifact audit-runs/example/artifacts/human.json \
  --claim-tier evaluated_subset \
  --output audit-runs/example/assessment-reviewed.json
```

`--artifact`にはrunへ登録した全成果物を渡します。元のassessmentには、同じ対象・範囲・環境で作成したE0の初期台帳を使います。既存の成果物や出力ファイルは上書きしません。

| 指定値 | 主張範囲 | 必要な記録 |
| --- | --- | --- |
| `reference_only`（既定値） | 規格を参照した記録 | 初期台帳でも使用可能 |
| `screened` | スクリーニングを実施した範囲 | 対象固有のスクリーニング証拠 |
| `evaluated_subset` | 一部を人手で評価した範囲 | 外部の人によるレビューと対象固有の手動証拠 |

実際の上限は、standaloneと共通のguardが証拠、プロファイル、手順の整備状況から判定します。指定しただけでは上限を超えられず、文言もregistryの固定テンプレートに限定されます。人手レビューの身元は申告であり、認証済みとは扱いません。この制約はレポートに残ります。

## 中断した監査の状態を確認する

```sh
node codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs status --run audit-runs/example/run.v4.json --locale ja
node codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs status --run audit-runs/example/run.v4.json --format json
```

`status`はrunと登録済み成果物を読み直し、hash、入力の対応、状態遷移を検証します。対象への通信、ブラウザ操作、成果物の書込みは行いません。検証成功時は終了コード0、失敗時は1を返します。

- 現在の状態、schema版、登録成果物数としてのrevision、権限
- 成果物の型、作成役割、hash、検証結果
- 人手確認件数、プロファイル全件数、証拠が許す主張の上限
- 次の遷移、必要な成果物、担当role、権限による制限
- 統合・報告・再検査の可否と不足条件

「reportが利用可能」は、対応するassessmentからレポートを作れるという意味です。検査の完了や適合を意味しません。`merge`前の人手レビューに指摘情報が足りなければ、run自体が有効でも統合は不可と表示します。

同じディレクトリのJSONに後続runがある場合は警告します。同じrun IDの登録履歴と成果物が包含関係にある版、または`supersedes_run_id`が一致する再検査の候補を示します。複数の候補から最新版を自動選択しません。別ディレクトリや外部サービスにあるコピーは検索しないため、警告がないことは全体の最新版である保証にはなりません。

JSON出力は[version 1.0.0のschema](../codex/skills/information-accessibility-practice/references/audit-status.schema.json)に従います。これは内部運用の出力で、run ID・hash・ファイル名を含みます。外部配布にはレポートのpublic出力を使ってください。

## 既存記録との互換性

`finding`と`remediation_status`は追加フィールドです。従来の有効なpayloadと計画付き指摘を変更する必要はありません。新しいnull表現は`remediation_status: "unplanned"`の場合に限ります。

runはインストールされたregistryのhashにも結び付いています。更新前のrunに保存されたhashを新しい値へ書き換えないでください。過去のパッケージを固定して検証する経路は維持し、異なるresource hash間の移行・再報告は#28の残課題として扱います。
