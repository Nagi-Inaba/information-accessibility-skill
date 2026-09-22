# 対象箇所に結び付いた人手確認queue

`human-review-queue` 3.0.0は、人が次に確認する基準、画面・要素、必要な状態、観測の出所と確認理由をまとめる候補です。queueの生成・登録は検査完了や適合判定を意味しません。

## 候補の作成

現行run 12.0.0で対象inventoryを測定・固定してから、skillのCLIを実行します。登録済みscreeningがあれば、その全観測を確認候補へ結び付けます。

```powershell
node scripts/accessibility-audit.mjs review-queue --run run.json --artifact-id ART-QUEUE-001 --output artifacts/queue.json
```

`--scope profile_all` はrunのプロファイルに登録された全基準を含めます。`--requirement WCAG-2.2-SC-1.1.1` は明示した基準の手動追加で、複数回指定できます。観測がまだない場合も、全基準・手動指定の候補を作れます。scopeの既定値は `screening` です。対象へ再接続せず、保存済みrun・観測・証拠を読み取ります。

作成直後の優先度は `unprioritized`、状態は `pending` です。確認者は候補JSONの `reason`、`priority`、`priority_reason`、`affected_users`、`required_state` を具体化し、次の操作で新しいrunへ登録します。元のrunや既存出力は上書きしません。

```powershell
node scripts/accessibility-audit.mjs register --run run.json --artifact artifacts/queue.json --output queued-run.json
```

登録前の候補だけを修正してください。登録後のqueue・入力hash・署名済み記録は変更せず、新しいrunで確認計画を作ります。queueの分割・追加登録や一般的な移行は、このCLIの対象外です。

## 項目の意味と検証

| フィールド | 内容 |
| --- | --- |
| `origins` | `screening`（観測由来）、`profile_all`（全基準の確認）、`manual`（明示追加）。重なる場合は複数記録。 |
| `reason` | 人が確認する理由。 |
| `priority`／`priority_reason` | P0〜P3または未設定と、その根拠。自動結果のseverityだけから決めない。修正の確定優先度ではない。 |
| `target_locations` | 同一run・envelopeの測定snapshot ID、宣言対象参照、画面・要素の説明、確認に必要な状態。 |
| `related_screening_observations` | 登録済み入力artifact IDと、その中のscreening `requirement_id` の組。単独IDや自由記述による出典代替は不可。 |
| `affected_users` | 影響を確認する利用者。未確認なら空配列で保持し、レポートにも未確認と表示。 |
| `status` | `pending` または前提条件待ちの `blocked`。人手評価の完了状態は記録しない。 |

一つの基準は一つのqueue項目に集約し、複数の箇所・観測を配列で保持します。同じ基準の項目の重複、同一snapshot・箇所・状態の重複を拒否します。空白の前後とUnicodeの正規化で検出する範囲を超えた、意味の似た箇所名やselectorの同値性は自動判定しません。

観測参照は同じrunの登録済みscreening入力でなければならず、観測のprofile基準もqueue項目と一致する必要があります。観測に保存された箇所の説明と証拠の全対象snapshotを保持します。候補、不明、問題を自動検出しなかった観測も、入力内の基準が対応する全観測を明示的に含めます。入力hashと保存済み証拠は既存の登録検証で再確認します。

`profile_all` を使うときは、全登録基準をその由来で記録する必要があります。「全基準のqueueがある」ことは、全基準を検査した証拠ではありません。基準固有の手順または一般手順、公式資料、必要証拠、判断不能条件は、`show-requirement.mjs` の `procedure_binding` と完全一致させます。

自動生成した「対象ページ全体」は確認範囲の初期値です。必要な画面状態や利用者への影響を観測したことにはなりません。確認時には対象状態を再現し、対象に即した証拠を人手レビューへ記録してください。

## レポートと旧形式

日英のMarkdown／HTMLで、確認箇所、必要な状態、優先度と理由、由来、関連観測件数を表示します。本文・要約・別紙とも同じ情報を利用します。内部artifact ID、snapshot ID、元証拠のパスは公開モデルへ渡しません。公開用の自由記述には通常の伏字処理を適用しますが、公開前の内容確認は必要です。

queue 1.0.0／2.0.0、run 1〜10、registry 1〜9は元のschema・対応関係で読み取り専用として保持します。旧queueに箇所・優先度・観測の対応を推測して補完しません。新版へ移すには新しいrunで対象を測定し、観測と確認計画を作り直してください。旧版の番号だけを変更する移行や、元の登録hashの再計算は行いません。
