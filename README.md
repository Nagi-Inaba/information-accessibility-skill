日本語 | [English](README.en.md)

# 情報アクセシビリティ監査スキル／エージェント

Webサイトや文書などの情報が、必要な人に届き、理解され、目的の行動につながるかを確認するためのCodex / Claude向けパッケージです。
対象と範囲の整理、実際の確認、証拠の記録、改善案の作成、修正後の再確認を支援します。

対象は、Webサイト、アプリ、文書、スライド、動画、イベント案内、会議運営などです。
必要な情報を見つけ、受け取り、理解し、申込みや質問などの目的の行動を行い、後から記録を確認できるかを一続きで見ます。
自然な言葉で確認を依頼する方法と、同じ条件で繰り返し実行するCLIの両方を収録しています。

確認結果は、次の二つを分けて記録します。

1. **情報利用の5つの観点**：「見つける」「受け取る」「理解する」「行動する」「後から確認する」に分け、情報を使う一連の流れを記録する。
2. **規格に基づく証拠記録**：対象、使用する規格、項目ごとの結果、証拠の強さ、結果としてどこまで言えるかをJSONで残す。

`web-modern`ではWCAG 2.2のレベルA・AAに該当する55項目を、`jp-public-web`ではJIS X 8341-3:2016のレベルA・AAに該当する38項目と追加のWCAG 18項目（合計56項目）を、すべて「未評価」の状態から開始できます。
収録している規格項目、対象から得た証拠、実際に評価した項目、結果として表明できる範囲を分けて検証します。

## できること

- Webサイト、アプリ、文書、動画、イベント運営などを、対象に合った項目で確認する。
- 利用を妨げる問題を、影響を受ける人、確認できた事実、改善案、再確認の方法とともに整理する。
- WCAG 2.2やJIS X 8341-3について、選択したA・AAプロファイルに含まれるすべての項目を「未評価」にした評価記録を作成する。
- 未評価、不明、失敗、証拠の強さを区別したまま、JSON形式の記録とMarkdown形式の報告書を生成する。
- CLIを使い、同じ条件の検証や報告書生成を繰り返す。既存の成果物は既定で上書きしない。

このパッケージだけで規格適合を自動判定することはできません。
AIが見つけた内容は候補または未検証の記録として残します。
規格項目の合否を記録するには、対象から得た証拠と、AIとは別の人による確認が必要です。
現在、結果として表明できる上限は`evaluated_subset`（評価した一部の範囲）です。

## 使い方を選ぶ

| したいこと | 入口 | 向いている使い方 |
| --- | --- | --- |
| まず問題点や改善案を知りたい | スキル／エージェント | 対象と目的を自然言語で伝えてレビューを依頼する |
| WCAGやJISに沿った記録を作りたい | スキル／エージェントとCLI | 範囲を相談し、選択したプロファイルの全項目を含む検査票、証拠、報告書を残す |
| 同じ条件で繰り返し検証したい | CLI | 定期検査、CI、引き継ぎ可能な成果物生成に使う |
| 許可された修正を安全に実行したい | 専用の認可済み修正機能 | 標準CLIとは分け、誰が何を修正してよいかと、修正後の確認方法を固定して扱う |

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

`event-community-accessibility.md` は、イベント、会議、セミナー、コミュニティへの参加方法、支援依頼の流れを見るための参照です。事前案内、会場までの案内、オンラインでの参加方法、支援依頼、字幕、文字起こし、手話通訳、マイク運用、チャットや質疑応答、資料共有、終了後の要約や記録、次の行動を確認します。

`standards-assessment.md` は、規格に基づく確認を始める前に、対象、範囲、環境を固定する方法を定めます。選択したプロファイルの全項目を含む検査票、5種類の結果、E0〜E5の証拠の強さ、確認範囲の判定、不適切な適合表現を防ぐ規則も扱います。

`standards-registry.json` は、`web-modern`、`jp-public-web`、`authoring-agent` などの版、一次資料URL、実装状態、規格項目の収録状況、結果として表明できる上限を、プログラムで読み取れる形で保存します。

`criteria-catalog.json` は、WCAG 55件、JIS 38件、追加WCAG 18件のID、名称、レベル、一次資料URL、適用判断に必要な情報、必要な証拠を収録します。規格本文は収録せず、すべての項目に人による確認、または自動検査と人による確認を組み合わせた評価が必要です。

`web-audit-methods.json` は、55件または56件の各項目を、14種類の確認手順に対応づけます。各手順には、項目が対象に当てはまるかを判断する方法、再現可能な確認方法、必要な証拠、判断できない場合の条件を記載しています。旧JIS固有の4.1.1「構文解析」は専用手順へ分けています。各項目の一次資料と解説資料を実際に開き、項目名だけから合否を推測しないようにします。

`criterion-procedures.json` は、SC 1.1.1、SC 1.3.1、SC 2.1.1、SC 4.1.2の詳しい確認手順を収録する部分カタログです。適用条件、手順、期待する結果、必要な証拠、判断できない場合の条件、反例、AIと人が担当する範囲を記載しています。掲載されていない項目は、この部分カタログに実行可能な条項別手順があるものとは扱いません。掲載済みの手順にも、AIとは別の人による確認と、対象から得た証拠が必要です。

`show-requirement.mjs` は、指定した一つの規格項目と、その確認方法だけを表示します。部分カタログにある項目では人が行う確認手順も表示し、未掲載の場合は実行可能な条項別手順がないことを明記します。個別項目を評価するときはこのスクリプトを使い、全カタログをAIへ一度に読み込ませません。

`aria-html-review.md` と `aria-review-rules.json` は、ARIA in HTMLとWAI-ARIAに基づく12件の補助検査を定めます。結果は必ず `SCREEN-ARIA-*` として記録し、WCAG 4.1.2などの合否へ自動では変換しません。

`assessment-record.schema.json` と `assessment-record.template.json` は、対象、確認範囲、環境、規格項目ごとの結果、P0/P1/P2に分類した問題、上記の5つの観点、証拠、結果として表明したい内容を分けて記録します。失敗とした規格項目には、問題の場所、影響を受ける人、確認できた事実、改善方法、再確認の方法を必ず紐付けます。

`render-audit-report.mjs` は、検証済みの評価記録から、未評価、不明、失敗、結果として表明できる上限を明記したMarkdown報告書を生成します。報告書は単独で配布できます。無効な記録は受け付けず、既存の出力ファイルも上書きしません。`audit-report.template.md` は手作業で追記する場合のひな形です。

`source-basis.md` は、監査方法が参照する公開一次資料、収録範囲、著作権上の境界を示します。

スキル本体は、対象に応じて必要な参照ファイルを選び、具体的な確認項目として使います。

## 詳しい使い方

### 統一CLI

`accessibility-audit`は、確認の実行記録（run）、評価記録、登録済みの成果物、報告書を扱う共通の入口です。
コマンドごとに確認処理を作り直すのではなく、既存のスクリプトを呼び分けます。引数は`shell: false`で渡すため、元のスクリプトが備える検証、上書きの防止、AIと人が扱える証拠の区別を保てます。

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
| `validate-assessment` | 評価記録と、結果として表明できる範囲を検証する |
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

標準CLIには、確認対象のファイルやコードを書き換えるコマンドはありません。
修正できるのは、別途導入したauthorized fixer（認可済み修正機能）を使い、対象、変更内容、修正前後のSHA-256、修正後の確認コマンドを定めた外部の許可がそろった場合だけです。
`retest`では`--supersedes-run`の指定が必須です。以前の実行記録にある証拠や結果は引き継がず、新しい再確認として開始します。

規格プロファイルを使う監査は、次の順序で実行します。

1. 対象名、版、URLまたはファイル、確認に含める範囲、除外する範囲、利用開始から完了までの操作、第三者コンテンツ、確認環境を固定する。
2. 選択したプロファイルの全項目を含む検査票を生成する。
3. `show-requirement.mjs`で条項ごとの方法と一次資料を確認してから実物を検査する。AIエージェントが作成または更新するプロファイル要件行は `mapping_status: "unverified"` と `outcome: "not_tested"` に保ち、観測は `SCREEN-*` または未検証の引き継ぎとして残す。外部の人手レビューは、条項別手順と対象固有の手動またはハイブリッド証拠を持つ場合だけ、`pass`、`fail`、`not_applicable`、`cant_tell` を記録できる。`fail` にはP0/P1/P2、影響を受ける利用者、改善、再検査方法を持つ所見を紐付ける。
4. 検証プログラムで、収録している規格項目と、実際に評価した項目を別々に確認する。
5. 検証済みの記録から、見つかった問題、未検証の項目、結果として表明できる上限を含むMarkdown報告書を生成する。

### 監査実行記録（run）を使うワークフロー

複数の役割で進める場合は、読み取り専用の監査実行記録を作成します。`screening-observations`（簡易確認の結果）、`human-review-queue`（人が確認する項目）、`remediation-plan`（改善計画）の順に成果物を登録します。
登録するたびに新しい監査実行記録を作り、直前の記録と確認対象のファイルは書き換えません。
その後、規格項目をまだ評価していないE0評価記録と、登録したすべての成果物（artifact）を統合します。`--run`と`--assessment`を指定すると、公開用の報告書を生成できます。

公開用報告は、`Observed / 観測`、`Improvement / 改善`、`Human review / 人が確認`を分けて表示します。
規格項目の結果、簡易確認の結果、収録している規格項目数、実際に評価した項目数も別々に記録します。
監査実行ID（run ID）、成果物ID（artifact ID）、役割ID、処理の履歴、ローカルパスは内部のrunに残し、公開用報告には出力しません。
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

認可済み修正を扱う`information-accessibility-authorized-fixer`は、既定では導入されません。`-IncludeAuthorizedFixer`を明示した場合だけ導入される、読み取り専用の引き渡しエージェントです。汎用コマンドの実行や、確認対象への直接の書き込みは許可されていません。外部の許可、対象、変更内容、修正後の確認コマンドを確かめ、必要事項を定型の引き渡し記録にまとめます。実際の変更は、信頼された運用者が、同じ入力なら同じ処理を行い、失敗した場合に復旧できる実行基盤を使って行います。

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

WCAG、JIS、ATAGなどの規格を指定した場合は、確認した証拠と、結果として表明できる範囲を次の規則で管理します。

- WCAG/JIS/ATAG等を指定したレビューで、対象・版・範囲・環境を固定し、AIの観測は `SCREEN-*` または未検証の引き継ぎとして記録する。プロファイル条項の結果は、条項別手順と対象固有の手動またはハイブリッド証拠を持つ外部の人手レビューだけが記録する。
- 自動・静的検査は `screening_check`、人が一次資料へ対応付けた規格条項は `profile_requirement` として分離する。
- 自動・簡易検査、条項レビュー、実機・支援技術、第三者監査をE0〜E5に分ける。
- E4/E5は、独立監査の範囲と報告書、または法務や調達の判断に使う証拠一式について、責任者と成果物が記録されていない場合は認めない。
- 禁止された認証表現、証拠のない `pass`、理由のない `not_applicable`、未検証を隠した主張を機械的に拒否する。

## 確認する観点

対象の種類にかかわらず、情報を使う流れを次の5つに分けて確認します。

1. **見つける（Find）**：必要な人が、必要な情報を迷わず見つけられるか。
2. **受け取る（Receive）**：テキスト、音声、画像、支援技術、保存された記録など、自分に合う方法で情報を受け取れるか。
3. **理解する（Understand）**：構成、順序、言葉、日付、リンク、色、図表、専門用語が分かりやすいか。
4. **行動する（Participate）**：質問、申込み、サービスの利用、支援依頼、イベントへの参加など、情報を使って目的の行動ができるか。
5. **後から確認する（Continue）**：要約、資料、記録、決定事項、次に行うことを後から確認できるか。

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
この会議運営案について、字幕、マイク運用、質問方法、資料共有、アーカイブ公開の観点で不足している点を挙げてください。
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

検証プログラムは、規格上の合否を判定しません。JSONの不整合、必要な規格項目がそろっているか、実際に評価した範囲、証拠を超えた表明を検出し、結果として表明できる最大の段階を返します。

報告書の集計には、規格項目用の`profile_outcome_counts`と、簡易確認用の`screening_outcome_counts`を使います。`outcome_counts`は後方互換用にすべての結果を合算した値であり、規格項目の集計には使いません。

すべての規格項目について詳しい確認手順が完成していない現行版では、`proposed_wording`に自由な文章は設定できません。レジストリに登録した、結果の段階ごとの日本語・英語の固定文だけを使用できます。対象ごとの確認内容、確認できた事実、未評価の範囲は、固定文を変更せず、別の監査報告書に記載します。

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

比較結果は、一次資料のハッシュ変更、規格項目の追加や削除、名称またはレベルの変更、確認手順との対応づけの変更を分けて表示します。
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
