# 手動・外部変更の申告と再検査

監査対象を人手、委託先、CMS、デザイン作業、通常のPRで変更した場合、`declared-change-record` で変更を申告できます。前runは対象を実測済みで、改善計画が登録された `remediation_ready` にある必要があります。申告者は外部の人または依頼者で、AIや `authorized_fixer` の実行記録とは別です。この経路で対象への書込み権限は与えられません。

1. 変更後の対象を用意し、前runと同じ対象種別・参照先・選択範囲で測定します。保存済みWeb状態では元のbundleを保持し、新しいcaptureを別のbundleファイルに保存します。DOM・アクセシビリティツリー・応答状態・最終URLのいずれかに変化が必要です。版は前runと異なる文字列にします。HTTPでは前runのネットワーク方針に加え、呼出側の明示的な許可先と非公開の通信ログが必要です。

   ```sh
   accessibility-audit capture-targets --run before.json --specs artifacts/after-specs.json --after-version release-2 --output artifacts/after-targets.json
   ```

   `after-specs.json` は前runの対象参照・選択範囲を引き継ぎます。保存済みWeb状態だけは `bundle_path` を新しいcaptureのパスに変更します。

2. 変更の根拠（作業記録、PRの保存済み資料、CMSの変更記録など）を前runの非公開artifact rootに保存します。以下のpayloadを作成し、`remediation_ids` に登録済み改善計画のIDを指定します。`change_kind` は `manual`、`vendor`、`cms`、`design`、`pull_request` から選びます。`declared_at` は対象測定と根拠保存の後の日時です。

   ```json
   {
     "publication": "private_by_default",
     "change_kind": "pull_request",
     "actor_name": "修正担当チーム",
     "declarant_name": "確認担当者",
     "declared_at": "2026-09-25T10:00:00+09:00",
     "summary": "代替テキストを更新",
     "before_version": "release-1",
     "after_version": "release-2",
     "remediation_ids": ["REM-EXAMPLE001"]
   }
   ```

3. 改善計画の登録済みartifact IDを `--input` に指定して候補を作り、検証・登録します。対象版の実測値と保存資料のhashを結び付けます。実測identityが同じ場合、登録直前に対象が再び変わった場合、異なる版を申告した場合は拒否します。

   ```sh
   accessibility-audit artifact init --run before.json --type declared-change-record --payload artifacts/change-payload.json --input ART-PLAN --role declared_change_reviewer --after-inventory artifacts/after-targets.json --evidence-file artifacts/change-note.txt --target-ref https://example.org/ --captured-at 2026-09-25T10:00:00+09:00 --output artifacts/declared-change.json
   accessibility-audit artifact validate --run before.json --artifact artifacts/declared-change.json
   accessibility-audit register --run before.json --artifact artifacts/declared-change.json --output before-declared.json
   ```

   依頼者による申告は `--role declared_change_owner` を使用します。`actor_name` は実際に変更した人・組織の申告名、`declarant_name` は確認した人の申告名です。これらは本人確認やPRの真正性を証明しません。

4. `retest --supersedes-run before-declared.json` で新しいrunを作り、変更後の対象をそのrunでも測定・固定してから再評価します。新runの `--target-version` は登録済み申告の `after_version` と一致させます。前runの指摘・評価結果は自動で合格に変わりません。

根拠ファイル、変更申告、前後の対象inventoryは非公開のまま保持します。対象identityの変化は変更の存在を示しますが、改善の成否は新runの再評価で判断します。既存の `fix-authorization`／`change-record` による承認付きfixerの経路は従来どおりです。
