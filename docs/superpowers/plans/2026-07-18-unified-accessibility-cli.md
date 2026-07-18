# 情報アクセシビリティ統一CLI改善プラン

## 目的

運用担当者が個別スクリプト名と配置場所を覚えなくても、同じ監査条件を再現し、途中結果を検証し、別の担当者へ引き継げる実行入口を提供する。

CLIは既存の監査エンジンを呼び出す薄い層とし、規格判定、証拠境界、上書き拒否、runの不変性、報告書の主張制限を再実装しない。

## 変更前の課題

- 監査開始から報告までの処理が13本の実行CLIに分かれ、利用者がファイル名と配置場所を知る必要があった。これとは別に、実行CLIが共有する内部ライブラリが7本ある。
- READMEの例は個別のNode.jsスクリプトを直接呼ぶため、日常運用とCIで同じ入口を共有しにくかった。
- `audit <URL>`のような短縮形を作ると、対象版、範囲、プロファイル、権限が未確定のまま監査を開始したように見える危険があった。
- 通常監査と認可済み修正を同じ入口に置くと、読み取り中心の監査権限と対象変更権限の区別が弱くなる。

## MVP設計

標準CLI名を`accessibility-audit`とし、次の固定コマンドだけを公開する。

| コマンド | 委譲先 | 境界 |
| --- | --- | --- |
| `init` | `create-audit-run.mjs` | 対象、版、権限を必須入力にする |
| `assessment` | `generate-assessment.mjs` | 全条項を未評価で開始する |
| `requirement` | `show-requirement.mjs` | 1条項ずつ確認する |
| `validate-run` | `validate-audit-run.mjs` | 検証結果を別ファイルへ書く |
| `validate-assessment` | `validate-assessment.mjs` | 被覆と主張上限を検証する |
| `register` | `register-audit-artifact.mjs` | 登録後は新しいrun版を作る |
| `merge` | `merge-audit-artifacts.mjs` | 登録済み成果物だけを統合する |
| `report` | `render-audit-report.mjs` | 検証済み入力から新規出力する |
| `retest` | `create-audit-run.mjs` | `--supersedes-run`を必須にする |

実行はNode.jsの固定パスと`spawnSync(..., { shell: false })`を使う。
利用者の引数をシェル文字列へ組み立てず、既存スクリプトの入力検証へそのまま渡す。

`fix`、`apply-fix`、`apply-authorized-fix`は標準CLIで拒否する。
認可済み修正は、既存のauthorized fixerランタイムと外部認可を使う別手順として維持する。

## 実装段階

### 第1段階

- 統一CLI、ヘルプ、コマンド別ヘルプを追加する。
- skill内の`package.json`で`accessibility-audit`の実行名を定義する。
- Codexを正本としてClaude配布へ機械同期する。
- 条項参照、評価生成、評価検証、報告生成、上書き拒否、修正拒否、再検査前提をテストする。
- 日本語と英語のREADMEへ同じ導入手順と安全境界を追加する。

### 第2段階の候補

- 対話式の`request init`で、対象、範囲、プロファイル、権限の入力漏れを減らす。
- CI向けの機械可読な実行要約を追加する。
- run-backed監査の各段階を案内する`status`を追加する。
- Windows、macOS、Linuxの導入確認をCIで実行する。

第2段階でも、URLだけから監査済みとみなす自動`audit`コマンドは追加しない。
対象固有の実査と外部の人手確認は、CLIによるファイル生成とは別に必要である。

## 受入条件

- `accessibility-audit --help`が安全な九つのコマンドを表示する。
- `fix`系コマンドが終了コード2で拒否される。
- 条項参照結果が既存CLIと一致する。
- 評価生成、検証、報告生成が統一CLI経由で完了する。
- 既存出力を上書きしない。
- `retest`が`--supersedes-run`なしでは実行されない。
- CodexとClaudeのskill配布内容が一致する。
- パッケージ検証と新規CLIテストが成功する。

## 残る境界

このCLIは監査を自動完了させるものではない。
CLIが作る評価レコードは、対象固有の証拠と外部の人手確認が入るまで`not_tested`とE0/E1の境界を保つ。
公開前の報告書については、個人名、非公開URL、機微な証拠の別途確認が必要である。
