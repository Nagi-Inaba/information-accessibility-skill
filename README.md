# Information Accessibility Skill and Agent

任意の対象について、範囲固定、実査、証拠記録、所見、改善、再検査までを行う、Codex / Claude 向けの汎用アクセシビリティ監査スキル／エージェントです。

Webサイト、アプリ、文書、スライド、動画、イベント案内、会議運営、コミュニティ導線などを対象に、「情報があるか」だけでなく、必要な人が見つけられるか、受け取れるか、理解できるか、参加できるか、後から確認できるかを確認します。

この版は、次の2層を分けて扱います。

1. **参加アクセシビリティ**: Find / Receive / Understand / Participate / Continue の5ゲートで、参加体験全体をレビューする。
2. **規格証拠レコード**: 対象、規格プロファイル、条項別結果、証拠強度、主張上限をJSONで記録する。

`web-modern` はWCAG 2.2 A/AAの55件、`jp-public-web` はJIS X 8341-3:2016 A/AAの38件と追加WCAG 18件（合計56件）を、未評価状態から漏れなく開始できます。対象固有の証拠、カタログ被覆、実評価被覆、主張上限を別々に検証します。全条項に対する実行可能な試験手順までは収録していないため、主張上限は `evaluated_subset` です。適合・準拠・認証を自動判定するものではありません。

## 内容

```text
codex/
  skills/information-accessibility-practice/
    agents/openai.yaml
    assets/audit-report.template.md
    assets/assessment-record.template.json
    assets/waic-publication.template.md
    scripts/generate-assessment.mjs
    scripts/render-audit-report.mjs
    scripts/show-requirement.mjs
    scripts/validate-assessment.mjs
    references/
  agents/information-accessibility-reviewer.toml
claude/
  skills/information-accessibility-practice/
    assets/assessment-record.template.json
    scripts/generate-assessment.mjs
    scripts/render-audit-report.mjs
    scripts/show-requirement.mjs
    scripts/validate-assessment.mjs
    references/
  agents/information-accessibility-reviewer.md
scripts/verify-package.ps1
scripts/verify-package.mjs
scripts/install-codex.ps1
tests/claim-guard.test.mjs
tests/audit-workflow.test.mjs
tests/audit-report.test.mjs
tests/install-codex.test.mjs
```

各 skill には、実行時に読む参照ファイルが入っています。

```text
references/
  development-accessibility.md
  document-slide-accessibility.md
  event-community-accessibility.md
  standards-assessment.md
  standards-registry.json
  criteria-catalog.json
  criteria-catalog.schema.json
  web-audit-methods.json
  web-audit-methods.schema.json
  aria-html-review.md
  aria-review-rules.json
  aria-review-rules.schema.json
  assessment-record.schema.json
  source-basis.md
```

## 参照ファイルの内容

`development-accessibility.md` は、Webサイト、アプリ、フォーム、ダッシュボード、UI、開発タスクを見るための参照です。見出し、ラベル、リンク名、キーボード操作、フォーカス順、エラー表示、状態変化、表やグラフ、フォーム入力、モバイル表示などを確認します。

`document-slide-accessibility.md` は、PDF、Word文書、レポート、スライド、配布資料、告知画像を見るための参照です。見出し構造、読み上げ順、リンク名、表、画像説明、図表の要約、PDF化後のテキスト抽出、スライドの読み順、告知画像に日時や場所が閉じ込められていないかなどを確認します。

`event-community-accessibility.md` は、イベント、会議、セミナー、コミュニティ導線、支援依頼フローを見るための参照です。事前案内、会場導線、オンライン参加、支援依頼、字幕、文字起こし、手話通訳、マイク運用、チャット/Q&A、資料共有、事後の要約・記録・次の行動を確認します。

`standards-assessment.md` は、規格監査を始める前の対象・範囲・環境の固定、完全な検査票の生成、5種類の結果、E0〜E5の証拠強度、被覆判定、主張ガードを定義します。

`standards-registry.json` は、`web-modern`、`jp-public-web`、`authoring-agent` などの版、一次資料URL、実装状態、条項カタログ状態、主張上限を機械可読で保存します。

`criteria-catalog.json` は、WCAG 55件、JIS 38件、追加WCAG 18件のID、名称、レベル、一次資料URL、適用判断・証拠の足場を収録します。規格本文は収録せず、全件を人手またはハイブリッド評価が必要なものとして扱います。

`web-audit-methods.json` は、55／56件の各行を、適用判断、再現可能な手順、必要証拠、`cant_tell` 条件を持つ14種類の監査プレイブックへルーティングします。旧JIS固有の4.1.1「構文解析」は専用手順へ分離しています。各行の一次資料・Understanding資料を開くことを必須とし、タイトルだけから合否を推測しません。

`show-requirement.mjs` は、指定した1条項と対応する1監査方法だけを返します。個別条項の評価時はこのスクリプトを使い、全カタログをモデルのコンテキストへ読み込みません。

`aria-html-review.md` と `aria-review-rules.json` は、ARIA in HTMLとWAI-ARIAに基づく12件の補助検査です。結果は必ず `SCREEN-ARIA-*` として記録し、WCAG 4.1.2等の合否へ自動変換しません。

`assessment-record.schema.json` と `assessment-record.template.json` は、対象、スコープ、環境、条項別結果、構造化されたP0/P1/P2所見、5ゲート、証拠、主張要求を分離して記録します。失敗した条項には、場所、影響を受ける利用者、観察、改善、再検査方法を持つ所見を必ず紐付けます。

`render-audit-report.mjs` は、検証済みの評価レコードから、未評価・不明・失敗・主張上限を明示した単独配布可能なMarkdown監査報告を生成します。無効なレコードや既存の出力ファイルは受け付けません。`audit-report.template.md` は手作業で追記する場合のひな形です。

`source-basis.md` は、監査方法が参照する公開一次資料、収録範囲、著作権上の境界を示します。

スキル本体は、対象に応じて必要な参照ファイルを選び、具体的な確認項目として使います。

## 使い方

規格プロファイルを使う監査は、次の順序で実行します。

1. 対象名、版、URL／ファイル、含む範囲、除外、完全な利用プロセス、第三者コンテンツ、検査環境を固定する。
2. 完全な検査票を生成する。
3. 実物を検査し、各行を `pass / fail / not_applicable / not_tested / cant_tell` のいずれかにし、場所・観察・日時を証拠として残す。`fail` にはP0/P1/P2、影響を受ける利用者、改善、再検査方法を持つ所見を紐付ける。
4. バリデータでカタログ被覆と実評価被覆を別々に確認する。
5. 検証済みのレコードから、所見、未検証、使える主張上限を含むMarkdown監査報告を生成する。

```powershell
node .\codex\skills\information-accessibility-practice\scripts\generate-assessment.mjs --profile web-modern --output .\audit.json
node .\codex\skills\information-accessibility-practice\scripts\show-requirement.mjs --profile web-modern --id WCAG-2.2-SC-2.1.1 --format markdown
node .\codex\skills\information-accessibility-practice\scripts\validate-assessment.mjs .\audit.json
node .\codex\skills\information-accessibility-practice\scripts\render-audit-report.mjs --input .\audit.json --output .\audit-report.md
```

上記はこの配布パッケージのルートから実行するコマンドです。スキルを配置した後は、配置先の `information-accessibility-practice` フォルダーを基準に `scripts` を解決してください。日本向けWeb監査では `--profile jp-public-web` を使います。既存ファイルは上書きしません。

macOS / Linuxではパス区切りを `/` にします。

```sh
node ./codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs --profile web-modern --output ./audit.json
node ./codex/skills/information-accessibility-practice/scripts/show-requirement.mjs --profile web-modern --id WCAG-2.2-SC-2.1.1 --format markdown
node ./codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs ./audit.json
node ./codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs --input ./audit.json --output ./audit-report.md
```

Codex で使う場合:

1. `codex/skills/information-accessibility-practice/` を Codex の `skills/` 配下に配置する。
2. `codex/agents/information-accessibility-reviewer.toml` を Codex の `agents/` 配下に配置する。
3. 情報アクセシビリティを確認したい資料、Webページ、UI、イベント案内などに対して `information-accessibility-practice` を使う。

Windowsでは、バックアップ付きインストーラーを利用できます。`-WhatIf` は配置先を変更しません。

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\install-codex.ps1" -WhatIf
powershell -ExecutionPolicy Bypass -File ".\scripts\install-codex.ps1"
```

`CODEX_HOME` が設定されていればその場所を使用し、未設定の場合は `~/.codex` へ配置します。既存のスキルとエージェントは、配置前に `backups/information-accessibility-practice/<timestamp>/` へ退避されます。

Claude で使う場合:

1. `claude/skills/information-accessibility-practice/` を Claude の `skills/` 配下に配置する。
2. `claude/agents/information-accessibility-reviewer.md` を Claude の `agents/` 配下に配置する。
3. 情報アクセシビリティを確認したい対象に対して `information-accessibility-reviewer` を使う。

## できること

- Webサイト、アプリ、フォーム、ダッシュボードで、見出し、ラベル、リンク名、キーボード操作、フォーカス順、エラー表示、状態変化、表やグラフの読み取りやすさを確認する。
- PDF、Word文書、スライド、配布資料で、見出し構造、読み上げ順、リンク名、表、画像説明、図表の要約、PDF化後のテキスト抽出や読み順を確認する。
- 告知画像、SNS投稿、チラシ、イベントページで、日時、場所、参加条件、変更時の確認先、申込方法、支援依頼先が画像だけに閉じていないか確認する。
- 動画、音声、アーカイブで、字幕、文字起こし、要約、資料リンク、公開場所、後から見返す導線を確認する。
- イベント、会議、セミナーで、会場案内、オンライン参加、マイク運用、チャット/Q&A、字幕、手話通訳、資料共有、記録公開、問い合わせ導線を確認する。
- コミュニティ参加者向け導線で、初参加者が必要な場所、予定、資料、役割、相談先、次の行動を迷わず見つけられるか確認する。
- 支援依頼フローで、依頼方法、締切、対応範囲、担当者への引き継ぎ、プライバシーの扱い、当日の運用を確認する。
- 法令、会場、契約、個人情報、公開範囲など、実装前に確認が必要な制約を整理する。
- WCAG/JIS/ATAG等を指定したレビューで、対象・版・範囲・環境を固定し、条項結果を `pass / fail / not_applicable / not_tested / cant_tell` で記録する。
- 自動・静的検査は `screening_check`、人が一次資料へ対応付けた規格条項は `profile_requirement` として分離する。
- 自動・簡易検査、条項レビュー、実機・支援技術、第三者監査をE0〜E5に分ける。
- E4/E5は、独立監査の範囲・報告書や法務／調達ドシエの責任者・成果物が記録されない限り拒否する。
- 禁止された認証表現、証拠のない `pass`、理由のない `not_applicable`、未検証を隠した主張を機械的に拒否する。

## 確認する観点

レビューでは主に次の5点を見ます。

1. **Find**: 必要な人が情報を見つけられるか。
2. **Receive**: 視覚、音声、テキスト、支援技術、アーカイブなど複数の方法で受け取れるか。
3. **Understand**: 構造、順序、言葉、日付、リンク、色、図表、専門用語が理解しやすいか。
4. **Participate**: 質問、申込、支援依頼、当日の参加、次の行動ができるか。
5. **Continue**: 後から要約、資料、記録、決定事項、次の行動を確認できるか。

## 依頼例

```text
このイベント告知ページを、情報アクセシビリティの観点でレビューしてください。
```

```text
このスライドをPDFで共有する前提で、読み上げ順、図表説明、リンク、後から見返す導線を確認してください。
```

```text
この申込フォームについて、ラベル、エラー表示、支援依頼欄、送信後の案内に問題がないか確認してください。
```

```text
この会議運営案について、字幕、マイク運用、質問方法、資料共有、アーカイブ公開の観点で不足を出してください。
```

```text
このWebアプリを web-modern プロファイルで確認し、検査した条項の証拠レコードを作ってください。適合判定はせず、未検証を残してください。
```

```text
この日本向けサイトについて、JIS X 8341-3:2016と追加のWCAG 2.2基準を分けて記録し、使える表現の上限を示してください。
```

## 出力例

レビュー結果は、必要に応じて次のような形で返します。

```markdown
## Accessibility Review

| Priority | Issue | Who is affected | Fix | Verification |
| --- | --- | --- | --- | --- |
| P0 |  |  |  |  |
| P1 |  |  |  |  |
| P2 |  |  |  |  |

## Missing Evidence

- Not checked:
- Needs confirmation:
```

規格証拠レコードを作る場合は、対象プロファイルの全行を生成し、内容を埋めてから検証します。配布パッケージのルートでは次を実行します。

```powershell
node .\codex\skills\information-accessibility-practice\scripts\generate-assessment.mjs --profile web-modern --output <assessment.json>
node .\codex\skills\information-accessibility-practice\scripts\validate-assessment.mjs <assessment.json>
```

バリデータは規格上の判定を行いません。JSONの不整合、カタログ被覆、実評価被覆、主張上限違反を検出し、現在の最大許容段階を返します。報告集計には `profile_outcome_counts` と `screening_outcome_counts` を使います。`outcome_counts` は後方互換用の全結果合算値であり、規格条項の集計には使いません。条項別の完全な実行可能試験手順が未完成の現行版では、`proposed_wording` はレジストリに登録した段階別の日英固定テンプレートとの完全一致だけを許可します。対象固有の検査、観察結果、未評価範囲は、固定文言を改変せず別の監査報告へ記載します。

## 検証

配布パッケージでは次を実行します。

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\verify-package.ps1"
node ".\scripts\verify-package.mjs"
node --test ".\tests\claim-guard.test.mjs"
node --test ".\tests\audit-workflow.test.mjs"
node --test ".\tests\audit-report.test.mjs"
node --test ".\tests\install-codex.test.mjs"
node ".\scripts\build-criteria-catalog.mjs" --verified-at 2026-07-12 --check
```

`verify-package.ps1` とクロスプラットフォーム版の `verify-package.mjs` は、Codex/Claude両スキルの相対パス、SHA-256、JSONパース、エージェント指示本文の一致を確認します。

## 主張と制限

本プロジェクトは、WCAG 2.2およびJIS X 8341-3:2016を参照した、証拠指向のアクセシビリティ評価レコードを提供します。作者支援についてはATAG 2.0 Part Bを参照します。本プロジェクト自体がW3C、JIS、ISO、Section 508または法令上の認証を提供するものではありません。

現在未実装の主な範囲は次のとおりです。

- WCAG 2.2 A/AA、JIS X 8341-3:2016の各条項について、適用条件、期待結果、具体例まで備えた完全な実行可能試験手順
- ATAG 2.0 Part Bの完全な条項カタログと作者支援機能マップ
- `evaluated_complete`、`conformance_candidate`、正式な適合・準拠表現までの判定
- EN 301 549、Section 508、PDF/UA-2、EPUB Accessibility、組織プロファイル
- 実機・支援技術によるE3証拠の自動生成、第三者監査、法務・調達判断

## ライセンス

MIT Licenseです。個人・商用を問わず利用、改変、再配布できます。詳細は [LICENSE](LICENSE) を参照してください。
