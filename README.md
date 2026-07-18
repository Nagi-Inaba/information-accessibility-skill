日本語 | [English](README.en.md)

# 情報アクセシビリティ監査スキル／エージェント

情報アクセシビリティのレビューを、対象と範囲の整理から、実査、証拠記録、改善案、再確認まで支援するCodex / Claude向けパッケージです。

Webサイト、アプリ、文書、スライド、動画、イベント案内、会議運営などについて、情報へたどり着くところから、参加後に記録を確認するところまでを一続きでレビューできます。
自然言語でレビューを依頼する入口と、同じ条件で繰り返し実行するCLIの両方を収録しています。

レビュー結果は、次の二つを分けて記録します。

1. **参加アクセシビリティ**：Find、Receive、Understand、Participate、Continueの5つの観点で、情報の発見から参加後の確認までを見る。
2. **規格証拠レコード**：対象、規格プロファイル、条項別結果、証拠強度、表明できる範囲をJSONで残す。

`web-modern`ではWCAG 2.2 A/AAの55件、`jp-public-web`ではJIS X 8341-3:2016 A/AAの38件と追加WCAG 18件（合計56件）を、すべて未評価の状態から開始できます。
対象固有の証拠、カタログの収録範囲、実際に評価した範囲、表明できる上限を混同せずに検証します。

## できること

- Webサイト、アプリ、文書、動画、イベント運営などを、対象に合った確認項目でレビューする。
- 見つかった障壁を、影響を受ける利用者、観測内容、改善案、再確認方法とともに整理する。
- WCAG 2.2やJIS X 8341-3のプロファイルから、抜けのない評価記録を未評価状態で作成する。
- 未評価、不明、失敗、証拠の強さを区別したまま、JSON記録とMarkdown報告書を生成する。
- CLIを使い、同じ条件の検証や報告書生成を繰り返す。既存の成果物は既定で上書きしない。

このパッケージだけで規格適合を自動判定することはできません。
AIによる観測は候補または未検証の記録として残し、条項の合否には対象固有の証拠と外部の人手確認が必要です。
現在の主張上限は`evaluated_subset`です。

## 使い方を選ぶ

| したいこと | 入口 | 向いている使い方 |
| --- | --- | --- |
| まず問題点や改善案を知りたい | スキル／エージェント | 対象と目的を自然言語で伝えてレビューを依頼する |
| WCAGやJISの記録を作りたい | スキル／エージェントとCLI | 範囲を相談し、完全な検査票、証拠、報告書を残す |
| 同じ条件で繰り返し検証したい | CLI | 定期検査、CI、引き継ぎ可能な成果物生成に使う |
| 認可済みの修正を実行したい | 専用の認可済み修正機能 | 標準CLIとは分け、外部認可と検証条件を固定して扱う |

迷った場合は、対象と知りたいことをそのまま依頼してください。

```text
このWebサイトを情報アクセシビリティの観点で確認し、観測できた問題、改善案、人による確認が必要な点を分けてください。
```

CLIを導入済みであれば、次のコマンドから利用できる操作を確認できます。

```powershell
accessibility-audit --help
```

## パッケージ構成

```text
codex/
  skills/information-accessibility-practice/
    package.json
    agents/openai.yaml
    assets/audit-report.template.md
    assets/assessment-record.template.json
    assets/waic-publication.template.md
    scripts/accessibility-audit.mjs
    scripts/generate-assessment.mjs
    scripts/render-audit-report.mjs
    scripts/show-requirement.mjs
    scripts/validate-assessment.mjs
    references/
  agents/
    information-accessibility-reviewer.toml
    information-accessibility-e1-inspector.toml
    information-accessibility-human-queue-planner.toml
    information-accessibility-remediation-planner.toml
claude/
  skills/information-accessibility-practice/
    package.json
    assets/assessment-record.template.json
    scripts/accessibility-audit.mjs
    scripts/generate-assessment.mjs
    scripts/render-audit-report.mjs
    scripts/show-requirement.mjs
    scripts/validate-assessment.mjs
    references/
  agents/
    information-accessibility-reviewer.md
    information-accessibility-e1-inspector.md
    information-accessibility-human-queue-planner.md
    information-accessibility-remediation-planner.md
scripts/verify-package.ps1
scripts/verify-package.mjs
scripts/install-codex.ps1
tests/claim-guard.test.mjs
tests/audit-workflow.test.mjs
tests/audit-report.test.mjs
tests/install-codex.test.mjs
tests/unified-cli.test.mjs
```

各スキルには、実行時に読む参照ファイルが入っています。

```text
references/
  development-accessibility.md
  document-slide-accessibility.md
  event-community-accessibility.md
  standards-assessment.md
  standards-registry.json
  criteria-catalog.json
  criteria-catalog.schema.json
  criterion-procedures.json
  criterion-procedures.schema.json
  web-audit-methods.json
  web-audit-methods.schema.json
  aria-html-review.md
  aria-review-rules.json
  aria-review-rules.schema.json
  assessment-record.schema.json
  source-basis.md
```

## 参照ファイル

`development-accessibility.md` は、Webサイト、アプリ、フォーム、ダッシュボード、UI、開発タスクを見るための参照です。見出し、ラベル、リンク名、キーボード操作、フォーカス順、エラー表示、状態変化、表やグラフ、フォーム入力、モバイル表示などを確認します。

`document-slide-accessibility.md` は、PDF、Word文書、レポート、スライド、配布資料、告知画像を見るための参照です。見出し構造、読み上げ順、リンク名、表、画像説明、図表の要約、PDF化後のテキスト抽出、スライドの読み順、告知画像に日時や場所が閉じ込められていないかなどを確認します。

`event-community-accessibility.md` は、イベント、会議、セミナー、コミュニティ導線、支援依頼フローを見るための参照です。事前案内、会場導線、オンライン参加、支援依頼、字幕、文字起こし、手話通訳、マイク運用、チャット/Q&A、資料共有、事後の要約・記録・次の行動を確認します。

`standards-assessment.md` は、規格監査を始める前の対象・範囲・環境の固定、完全な検査票の生成、5種類の結果、E0〜E5の証拠強度、被覆判定、主張ガードを定義します。

`standards-registry.json` は、`web-modern`、`jp-public-web`、`authoring-agent` などの版、一次資料URL、実装状態、条項カタログ状態、主張上限を機械可読で保存します。

`criteria-catalog.json` は、WCAG 55件、JIS 38件、追加WCAG 18件のID、名称、レベル、一次資料URL、適用判断・証拠の足場を収録します。規格本文は収録せず、全件を人手またはハイブリッド評価が必要なものとして扱います。

`web-audit-methods.json` は、55／56件の各行を、適用判断、再現可能な手順、必要証拠、`cant_tell` 条件を持つ14種類の監査プレイブックへルーティングします。旧JIS固有の4.1.1「構文解析」は専用手順へ分離しています。各行の一次資料・Understanding資料を開くことを必須とし、タイトルだけから合否を推測しません。

`criterion-procedures.json` は、SC 1.1.1、SC 1.3.1、SC 2.1.1、SC 4.1.2について、適用条件、手順、期待結果、必要証拠、`cant_tell`条件、反例、AIと人手の境界を収録する部分カタログです。未掲載の条項を実行可能とみなさず、どの手順も外部の人手レビューと対象固有の証拠を必要とします。

`show-requirement.mjs` は、指定した1条項と対応する1監査方法だけを返します。部分カタログにある条項では条項別の人手確認手順も返し、未掲載の条項にはその不在を明記します。個別条項の評価時はこのスクリプトを使い、全カタログをモデルのコンテキストへ読み込みません。

`aria-html-review.md` と `aria-review-rules.json` は、ARIA in HTMLとWAI-ARIAに基づく12件の補助検査です。結果は必ず `SCREEN-ARIA-*` として記録し、WCAG 4.1.2等の合否へ自動変換しません。

`assessment-record.schema.json` と `assessment-record.template.json` は、対象、スコープ、環境、条項別結果、構造化されたP0/P1/P2所見、5ゲート、証拠、主張要求を分離して記録します。失敗した条項には、場所、影響を受ける利用者、観察、改善、再検査方法を持つ所見を必ず紐付けます。

`render-audit-report.mjs` は、検証済みの評価レコードから、未評価・不明・失敗・主張上限を明示した単独配布可能なMarkdown監査報告を生成します。無効なレコードや既存の出力ファイルは受け付けません。`audit-report.template.md` は手作業で追記する場合のひな形です。

`source-basis.md` は、監査方法が参照する公開一次資料、収録範囲、著作権上の境界を示します。

スキル本体は、対象に応じて必要な参照ファイルを選び、具体的な確認項目として使います。

## 詳しい使い方

### 統一CLI

`accessibility-audit`は、監査実行記録（run）、評価レコード、登録済み成果物、報告書を扱う既存スクリプトの統一入口です。
監査ロジックを再実装せず、固定されたスクリプトへ`shell: false`で引数を引き渡すため、個別CLIと同じ検証、上書き拒否、証拠境界が保たれます。

スキルフォルダーからコマンドを導入します。

```powershell
npm install --global .\codex\skills\information-accessibility-practice
accessibility-audit --help
```

グローバル導入を行わない場合は、Node.jsから同じ入口を直接実行できます。

```powershell
node .\codex\skills\information-accessibility-practice\scripts\accessibility-audit.mjs --help
```

| コマンド | 用途 |
| --- | --- |
| `init` | 対象、版、範囲、権限を固定した新しい監査実行記録を作る |
| `assessment` | 全条項を`not_tested`で初期化した評価レコードを作る |
| `requirement` | 指定した1条項と確認方法を表示する |
| `validate-run` | 監査実行記録を検証し、別ファイルへ検証結果を書く |
| `validate-assessment` | 評価レコードと主張上限を検証する |
| `register` | 検証済み成果物を新しいrun版へ登録する |
| `merge` | 登録済み成果物を新しい評価レコードへ統合する |
| `report` | 検証済み評価から新しいMarkdown報告書を作る |
| `retest` | 修正後に、旧runを上書きせず新しい再検査runを作る |

最小の単独評価は次の3コマンドで実行できます。

```powershell
accessibility-audit assessment --profile web-modern --target-name "Example" --target-version "2026-07-18" --target-ref "https://example.com/" --evaluator "external-human-review-required" --evaluated-at "2026-07-18" --output .\audit.json
accessibility-audit validate-assessment .\audit.json
accessibility-audit report --input .\audit.json --output .\audit-report.md
```

標準CLIは、対象ソースを修正するコマンドを公開しません。
修正は、別途導入したauthorized fixerと、対象、変更内容、修正前後のSHA-256、検証コマンドを固定した外部認可がそろった場合だけ実行します。
`retest`は`--supersedes-run`を必須とし、旧runの証拠や結果を引き継がない新規監査として開始します。

規格プロファイルを使う監査は、次の順序で実行します。

1. 対象名、版、URL／ファイル、含む範囲、除外、完全な利用プロセス、第三者コンテンツ、検査環境を固定する。
2. 完全な検査票を生成する。
3. `show-requirement.mjs`で条項ごとの方法と一次資料を確認してから実物を検査する。AIエージェントが作成または更新するプロファイル要件行は `mapping_status: "unverified"` と `outcome: "not_tested"` に保ち、観測は `SCREEN-*` または未検証の引き継ぎとして残す。外部の人手レビューは、条項別手順と対象固有の手動またはハイブリッド証拠を持つ場合だけ、`pass`、`fail`、`not_applicable`、`cant_tell` を記録できる。`fail` にはP0/P1/P2、影響を受ける利用者、改善、再検査方法を持つ所見を紐付ける。
4. バリデータでカタログ被覆と実評価被覆を別々に確認する。
5. 検証済みのレコードから、所見、未検証、使える主張上限を含むMarkdown監査報告を生成する。

### 監査実行記録（run）を使うワークフロー

複数の役割で進める場合は、読み取り専用の監査実行記録を作成し、`screening-observations`、`human-review-queue`、`remediation-plan`の順に成果物を登録します。
登録するたびに新しい監査実行記録を作り、直前の記録と対象ファイルは書き換えません。
その後、未評価のプロファイル行を持つE0評価と、登録したすべての成果物（artifact）を統合し、`--run`と`--assessment`を指定して公開用報告を生成します。

公開用報告は、`Observed / 観測`、`Improvement / 改善`、`Human review / 人が確認`を分けて表示します。
プロファイル結果、スクリーニング結果、カタログ被覆、実評価被覆の件数も別々に記録します。
run ID、artifact ID、役割ID、遷移履歴、ローカルパスは内部のrunに残し、公開用報告には出力しません。
観測と改善候補は、人が確認するまで合否や適合性の根拠にはなりません。

役割分担、成果物の順序、停止条件、外部の人手レビューとの境界は、[Codex向けエージェント連携リファレンス](codex/skills/information-accessibility-practice/references/agent-orchestration.md)と[Claude向けエージェント連携リファレンス](claude/skills/information-accessibility-practice/references/agent-orchestration.md)にまとめています。
監査実行記録から公開用報告だけを生成する最小コマンドは次のとおりです。

```powershell
node .\codex\skills\information-accessibility-practice\scripts\render-audit-report.mjs --run .\audit-run.json --assessment .\merged-assessment.json --output .\public-report.md
```

```powershell
node .\codex\skills\information-accessibility-practice\scripts\generate-assessment.mjs --profile web-modern --output .\audit.json
node .\codex\skills\information-accessibility-practice\scripts\show-requirement.mjs --profile web-modern --id WCAG-2.2-SC-1.1.1 --format markdown
node .\codex\skills\information-accessibility-practice\scripts\validate-assessment.mjs .\audit.json
node .\codex\skills\information-accessibility-practice\scripts\render-audit-report.mjs --input .\audit.json --output .\audit-report.md
```

上記はこの配布パッケージのルートから実行するコマンドです。スキルを配置した後は、配置先の `information-accessibility-practice` フォルダーを基準に `scripts` を解決してください。日本向けWeb監査では `--profile jp-public-web` を使います。既存ファイルは上書きしません。

macOS / Linuxではパス区切りを `/` にします。

```sh
node ./codex/skills/information-accessibility-practice/scripts/generate-assessment.mjs --profile web-modern --output ./audit.json
node ./codex/skills/information-accessibility-practice/scripts/show-requirement.mjs --profile web-modern --id WCAG-2.2-SC-1.1.1 --format markdown
node ./codex/skills/information-accessibility-practice/scripts/validate-assessment.mjs ./audit.json
node ./codex/skills/information-accessibility-practice/scripts/render-audit-report.mjs --input ./audit.json --output ./audit-report.md
```

Codex で使う場合:

1. `codex/skills/information-accessibility-practice/` を Codex の `skills/` 配下に配置する。
2. `shared/agents/agent-manifest.json` の `install_by_default: true` である4件の `.toml` を、Codex の `agents/` 配下へ配置する。
3. 既定の4件は、`information-accessibility-reviewer`、`information-accessibility-e1-inspector`、`information-accessibility-human-queue-planner`、`information-accessibility-remediation-planner` である。
4. 情報アクセシビリティを確認したい資料、Webページ、UI、イベント案内などに対して `information-accessibility-practice` を使う。

Windowsでは、マニフェストを読み取るバックアップ付きインストーラーを利用できます。`-WhatIf` は選択したエージェントIDと全配置先を表示するだけで、`CodexHome` と `BackupRoot` を作成または変更しません。

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\install-codex.ps1" -WhatIf
powershell -ExecutionPolicy Bypass -File ".\scripts\install-codex.ps1"
```

`CODEX_HOME` が設定されていればその場所を使用し、未設定の場合は `~/.codex` へ配置します。既定のバックアップ先は、`CodexHome` と重ならない兄弟領域の `codex-backups/information-accessibility-practice/<timestamp>/` です。既存のスキルはその `skill/` へ、既存のマニフェスト管理エージェントは `agents/<agent-id>.toml` へ退避されます。退避対象が一つもない初回導入では、バックアップ先を作成しません。配置の途中で失敗した場合は、置換済みのスキルと選択済みエージェントだけをバックアップと照合して復元し、無関係なユーザーエージェントには触れません。

インストーラーは既存パスの最終パスとファイルIDを置換直前まで再検査し、同じ親ディレクトリ内の rename で切り替えます。ただし、別プロセスが同じファイル内容を同時に書き換える競合をOSレベルでロックするものではありません。インストール中は、別のインストーラーや手作業で同じスキルとエージェントを変更しないでください。

認可済み修正を扱う`information-accessibility-authorized-fixer`は、既定では導入されません。`-IncludeAuthorizedFixer`を明示した場合だけ導入される読み取り専用の引き渡しエージェントであり、汎用コマンドや対象への直接書き込みは許可されていません。外部認可、対象、変更内容、検証コマンドを確認して構造化された引き渡しを作り、実際の変更は信頼された運用者が決定的なトランザクション実行基盤を使って行います。

Claude で使う場合:

1. `claude/skills/information-accessibility-practice/` を Claude の `skills/` 配下に配置する。
2. `claude/agents/information-accessibility-reviewer.md` を Claude の `agents/` 配下に配置する。
3. 情報アクセシビリティを確認したい対象に対して `information-accessibility-reviewer` を使う。

## 対象別の確認範囲

- Webサイト、アプリ、フォーム、ダッシュボードで、見出し、ラベル、リンク名、キーボード操作、フォーカス順、エラー表示、状態変化、表やグラフの読み取りやすさを確認する。
- PDF、Word文書、スライド、配布資料で、見出し構造、読み上げ順、リンク名、表、画像説明、図表の要約、PDF化後のテキスト抽出や読み順を確認する。
- 告知画像、SNS投稿、チラシ、イベントページで、日時、場所、参加条件、変更時の確認先、申込方法、支援依頼先が画像だけに閉じていないか確認する。
- 動画、音声、アーカイブで、字幕、文字起こし、要約、資料リンク、公開場所、後から見返す導線を確認する。
- イベント、会議、セミナーで、会場案内、オンライン参加、マイク運用、チャット/Q&A、字幕、手話通訳、資料共有、記録公開、問い合わせ導線を確認する。
- コミュニティ参加者向け導線で、初参加者が必要な場所、予定、資料、役割、相談先、次の行動を迷わず見つけられるか確認する。
- 支援依頼フローで、依頼方法、締切、対応範囲、担当者への引き継ぎ、プライバシーの扱い、当日の運用を確認する。
- 法令、会場、契約、個人情報、公開範囲など、実装前に確認が必要な制約を整理する。
- WCAG/JIS/ATAG等を指定したレビューで、対象・版・範囲・環境を固定し、AIの観測は `SCREEN-*` または未検証の引き継ぎとして記録する。プロファイル条項の結果は、条項別手順と対象固有の手動またはハイブリッド証拠を持つ外部の人手レビューだけが記録する。
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

規格証拠レコードを作る場合は、対象プロファイルの全行を生成してから検証します。AIが作成するレコードはプロファイル要件を未検証のまま保持し、外部の人手レビューが条項別手順と対象固有の手動またはハイブリッド証拠を記録した場合だけ、該当するプロファイル条項を評価します。配布パッケージのルートでは次を実行します。

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
node --test ".\tests\criterion-procedures.test.mjs"
node --test ".\tests\audit-report.test.mjs"
node --test ".\tests\install-codex.test.mjs"
node --test ".\tests\unified-cli.test.mjs"
node ".\scripts\build-criteria-catalog.mjs" --check
```

`verify-package.ps1` とクロスプラットフォーム版の `verify-package.mjs` は、Codex/Claude両スキルの相対パス、SHA-256、JSONパース、エージェント指示本文の一致を確認します。

### 条項カタログの保守

通常の検証には `--check` を使います。
このコマンドはネットワークへ接続せず、保存済みのCodex版とClaude版について、バイト一致、件数、レジストリIDとの一致を検証します。

一次資料から候補を更新する保守作業では、既存カタログとは別の出力先を指定します。
`--refresh` は3件の一次資料へ接続し、既存ファイルへの上書きを拒否します。

```powershell
node ".\scripts\build-criteria-catalog.mjs" --refresh --verified-at YYYY-MM-DD --output ".\criteria-catalog.candidate.json"
node ".\scripts\compare-criteria-catalog.mjs" --current ".\codex\skills\information-accessibility-practice\references\criteria-catalog.json" --candidate ".\criteria-catalog.candidate.json"
```

比較結果は、一次資料のハッシュ変更、条項の追加、削除、名称またはレベルの変更、監査手順へのルーティング変更を分けて表示します。
候補を正本へ反映する前に、比較結果と一次資料を人が確認してください。

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
