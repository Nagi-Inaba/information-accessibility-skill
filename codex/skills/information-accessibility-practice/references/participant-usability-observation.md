# 当事者による利用テストの記録

現行run 16.0.0では、規格評価と独立した `participant-usability-observation` 1.0.0成果物を登録できます。1成果物は1人の1タスク実施です。外部の進行役が記録し、参加者本人の認証や障害の証明を意味しません。これだけでWCAG／JISのpass／fail、assessmentの証拠レベル、runの状態は変わりません。

参加者IDはランダムな `P-` と8〜32文字の英数字、進行役IDは `F-` と8〜32文字の英数字を使います。実名、連絡先、診断名は書かず、必要最小限のaccess needsと支援技術の区分を選びます。`task_id`、`journey`、5つの参加観点から該当する `perspectives`、利用環境、完了状況、秒数、支援の有無、行動・障壁・回避策などの観測を記録します。繰り返しを数えるテーマには同じIDとラベルを使います。

次のpayloadをJSONファイルに保存し、対象固有の記録ファイルをrunの非公開artifact rootへ置きます。関係する登録済み改善案があれば、その成果物IDを `--input` に渡し、`related_remediation_ids` を記入します。人手指摘の場合は同じrunの人手レビュー成果物を `--input` に渡し、`related_finding_ids` を記入します。

```json
{
  "schema_version": "1.0.0",
  "participant_id": "P-ABCDEFGH",
  "facilitator_id": "F-ABCDEFGH",
  "session_at": "2026-09-25T10:00:00+09:00",
  "access_needs": ["vision"],
  "assistive_technology": ["screen_reader"],
  "task_id": "checkout",
  "journey": "購入手続きを完了する",
  "perspectives": ["find", "continue"],
  "environment": "Desktop browser and screen reader",
  "outcome": "partial",
  "duration_seconds": 300,
  "assistance_required": true,
  "observations": [{"kind": "barrier", "text": "次の操作を見つけられなかった", "severity": "medium"}],
  "themes": [{"id": "THM-NAVIGATION", "label": "購入手続きの移動"}],
  "related_finding_ids": [],
  "related_remediation_ids": [],
  "consent": {
    "participation": true,
    "public_aggregate": true,
    "quote_capture": false,
    "quote_publication": false,
    "recording_capture": false,
    "recording_publication": false,
    "recording_collected": false,
    "retention_until": "2027-09-25",
    "redaction_status": "verified"
  },
  "source_artifact_ids": [],
  "evidence_refs": []
}
```

`artifact init --run <run.json> --type participant-usability-observation --role declared_participant_facilitator --payload <payload.json> --evidence-file <保存した記録> --target-ref <runの対象> --captured-at <RFC3339> --output <artifact-root内のcandidate.json>` で保存ファイルの参照とSHA-256を付けます。必要な `--input` は繰り返せます。次に `artifact validate` と `register` を実行します。記録ファイル自体は非公開で保管し、期限到来時の削除は保管者が行います。

参加同意がない記録、引用・録画の取得権限を超える記録、同じ人・タスク・日時の重複、別runや未登録の指摘・改善案へのリンクを拒否します。連絡先らしい自由文も拒否しますが、氏名などを自動で完全検出することはできません。公開前の人手確認は必要です。公開レポートは `public_aggregate` と `redaction_status: verified` の両方を満たし、保存期限内にある記録だけを使い、2人以上に共通するテーマと参加者数のみを表示します。個人ID、引用、録画、観測文、根拠パスは公開しません。同意の撤回や訂正後は元記録・既発行レポートの取扱いを人が確認し、新しいrunで再記録します。
