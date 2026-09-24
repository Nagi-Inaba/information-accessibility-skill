# 参加観点・監査制約・次回確認の登録

現行run 15.0.0では、対象に結び付けた `audit-context` 1.0.0成果物を追加登録できます。1成果物は1件の申告です。登録でrunの状態は変わりません。runと保存証拠はハッシュで固定され、mergeとreportは登録済み成果物との完全一致を再確認します。旧runは読取り専用です。

| `kind` | `value` | 申告できる役割 |
| --- | --- | --- |
| `participation` | `perspective`（find／receive／understand／participate／continue）と `outcome` | `declared_context_reviewer`（外部の人） |
| `limitation` | 対象固有の `text` | `declared_context_reviewer` |
| `next_review` | `at`（日付）、`owner`、`condition` | `declared_context_owner`（外部の依頼者） |
| `independent_audit` | `performed`、`evaluator_independent`、`scope_method`、`report_location` | `declared_context_owner` |
| `dossier` | `prepared`、`responsible_owner`、`artifacts` | `declared_context_owner` |

実際に保存した根拠ファイルを先にrunの非公開artifact root内へ置きます。新規payloadには `kind`、`value`、`publication`（`public`／`internal`）、`declarant_name`、`declared_at`、`rationale` を書きます。`evidence_refs: []` とし、`source_artifact_ids` は省略できます。例:

```json
{
  "schema_version": "1.0.0",
  "kind": "participation",
  "publication": "public",
  "declarant_name": "External reviewer",
  "declared_at": "2026-09-25T09:00:00+09:00",
  "rationale": "Saved observation shows the requested journey could not be completed.",
  "evidence_refs": [],
  "value": { "perspective": "continue", "outcome": "cant_tell" }
}
```

`artifact init --run <run.json> --type audit-context --role declared_context_reviewer --payload <payload.json> --evidence-file <saved-source> --target-ref <runの対象> --captured-at <RFC3339> --output <artifact-root内の新規candidate.json>` が保存ファイルのSHA-256と対象snapshotを記録します。既存成果物を根拠に使う場合は `--input <登録済みART-id>` を繰り返します。申告の種類に合わせて `--role` を選び、作成した候補を `artifact validate` と `register` で確認・登録します。mergeには登録済み成果物を漏れなく渡します。

同じ参加観点、次回確認、独立監査、資料整備について複数の申告があれば、後勝ちにせず拒否します。新しい確認が必要なら新しいrunと証拠を作ります。本人性や独立性は役割名や申告だけでは認証されません。E4／E5には別途、受領側が選ぶ信頼方針で検証された独立した人手レビューと既存の範囲・操作条件が必要です。

内部用の制約文、次回確認の担当者名、証拠パスは公開レポートに出しません。公開用と指定した申告も、公開前に内容の人手確認が必要です。単独assessmentでは `participation_coverage`、`limitations`、`assurance`、`next_review_at` と任意の `next_review_owner`／`next_review_condition` を記録します。旧assessmentの次回確認日だけの記録は読み取れます。
