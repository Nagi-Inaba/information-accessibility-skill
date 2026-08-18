# 開発中Webサイトのアクセシビリティ監査依頼

`information-accessibility-reviewer` エージェントを使い、次の対象をレビューしてください。対象範囲、証拠、未検証事項を分け、根拠のない適合・準拠・認証の表現は使わないでください。

## 対象

- 対象URLまたはローカルパス: `<TARGET_URL_OR_PATH>`
- 対象名と版・コミット: `<TARGET_NAME_AND_VERSION>`
- 規格プロファイル: `<PROFILE>`
- 含む範囲: `<INCLUDED_SCOPE>`
- 除外範囲: `<EXCLUDED_SCOPE>`
- 完全な利用プロセス: `<COMPLETE_PROCESSES>`
- 第三者コンテンツ: `<THIRD_PARTY_CONTENT>`

## 実行条件

- 許可する操作: `<PERMITTED_OPERATIONS>`
- 編集対象のソースと変更権限: `<EDITABLE_SOURCE_AND_AUTHORITY_OR_NONE>`
- 修正後に必ず実行する検証コマンド: `<VERIFICATION_COMMANDS>`
- 実行環境（OS、ブラウザ、支援技術、入力方法）: `<ENVIRONMENT>`
- 証拠の保存可否・除外する情報: `<EVIDENCE_RETENTION_BOUNDARY>`
- 出力先: `<OUTPUT_DIRECTORY>`

編集対象・変更権限・許可操作・検証コマンドのすべてが明示されていない場合、対象を変更せず、修正案と再検査方法だけを提示してください。

## 必須の出力

1. 対象範囲と証拠レベル
2. 証拠付きで確認できた事項（人手確認済みの規格条項と `SCREEN-*` 補助検査を分ける）
3. 修正が必要な事項（優先度、場所、影響利用者、修正案、再検査方法）
4. 人が確認すべき事項（未検証理由と次の確認方法）
5. 主張可能な範囲と、評価JSON・監査レポートの出力先
