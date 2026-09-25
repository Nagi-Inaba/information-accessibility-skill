# 指摘・改善案の継続管理

`finding-lifecycle` 1.0.0は、登録済み指摘1件を管理する私的な補助成果物です。監査run、assessment、条項の判定を変更しません。管理判断を使って `pass` や指摘の解消を自動宣言しないでください。新しい版は別ファイルに作り、前版のSHA-256に結び付けます。古い版を編集すると、後続版の読取りが失敗します。

```sh
accessibility-audit lifecycle init --run old-run.json --finding REM-EXAMPLE --output artifacts/lifecycle-1.json
accessibility-audit lifecycle advance --run old-run.json --before artifacts/lifecycle-1.json --input artifacts/update.json --output artifacts/lifecycle-2.json
accessibility-audit status --run old-run.json --lifecycle artifacts/lifecycle-2.json --as-of 2026-09-30 --format text --locale ja
accessibility-audit report --run old-run.json --assessment merged.json --lifecycle artifacts/lifecycle-2.json --as-of 2026-09-30 --output updated-report.md
```

`advance` の入力は変更する項目だけのJSONです。たとえば `{"status":"planned","assignee":"担当者","accountable_owner":"責任者","due_on":"2026-09-30","target_release":"v1.4","external_issues":[{"system":"tracker","id":"A11Y-123"}]}` とします。`blocked_by` は依存先IDの配列です。複数の指摘をstatus／reportへ表示する場合は `--lifecycle` を繰り返します。基準日を省略すると実行環境の現地日付を使います。

状態は `open → investigating → planned → in_progress → fixed → verified → closed` を基本とし、調査からopen、計画からopen、作業中からplanned、修正後・検証後から作業中、閉鎖後からopenへ戻せます。同じ状態で担当・期限などの変更を記録することもできます。各更新には時刻、変更後の状態、前版の場所とhashを保存します。

`decision` は作業状態と別です。`false_positive`、`duplicate`、`obsolete`、`deferred`、`accepted_risk`、`exception_granted` を区別し、すべてに `approved_by` と `rationale` を要します。`duplicate` には `duplicate_of`、延期・リスク受容・例外には `expires_on` と `review_on` が必要です。更新時に `decision:null` とすれば判断を解除できます。判断が残る間は `verified`／`closed` へ進めず、規格の判定も変わりません。期限超過、P0/P1の責任者未設定、例外の失効・再確認日到来をstatusで警告します。

`verified`／`closed` には、旧runに登録済みの変更記録、新runの再検査記録、新run内の保存済み確認根拠を `closure` で結び付けます。例:

```json
{
  "status": "verified",
  "closure": {
    "change_artifact_id": "ART-CHANGE-EXAMPLE",
    "retest_run_file": "retest-reviewed.json",
    "retest_run_sha256": "<64文字のSHA-256>",
    "verification_file": "verification.txt",
    "verification_sha256": "<64文字のSHA-256>"
  }
}
```

新runが旧runを `supersedes_run_id` で参照し、対象・profile・scopeが一致すること、新しい対象inventoryと関連条項すべての人手 `pass` 申告があること、根拠ファイルの現在のバイトがhashと一致することを確認します。これは保存記録の整合確認であり、確認者の本人性や実際の作業を自動認証するものではありません。

レポートには状態、期限、警告、判断種別だけを載せます。担当者名、承認者名、外部Issue ID、保存ファイルの場所は掲載しません。statusのJSONは私的な管理情報を含むため、公開レポートとして配布しないでください。
