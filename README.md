日本語 | [English](README.en.md)

# 情報アクセシビリティ監査スキル／エージェント

## 30秒で分かる概要

Webサイト、アプリ、文書、スライド、動画、イベント案内などについて、**情報を見つけ、受け取り、理解し、目的の行動を完了し、後から確認できるか**を調べるCodex／Claude向けパッケージです。

自然言語レビュー、WCAG／JISのstandalone評価、複数工程を記録するrun-backed監査の3経路があります。WebではPlaywrightとaxe-coreを用いた読取り専用scanも利用できます。

AIと自動検査が作るものは、原則として問題候補やE0／E1のscreening evidenceです。規格条項の正式な判定には、該当手順を用いた外部の人による確認と、対象固有の証拠が必要です。**現行版だけで正式な適合宣言はできません。**

迷った場合は、まず対象と知りたいことをそのまま伝えてください。

```text
このWebサイトを情報アクセシビリティの観点で確認し、観測できた問題、改善案、人による確認が必要な点を分けてください。
```

## 目次

- [3つの利用経路](#まず選ぶ3つの利用経路)
- [対応対象と現在の制限](#対応対象と現在の制限)
- [前提条件と導入](#前提条件と導入)
- [5分で試す](#5分で試す)
- [生成されるもの](#生成されるもの)
- [実Web検査](#実web検査)
- [詳細ドキュメント](#詳細ドキュメント)
- [証拠と主張の境界](#証拠と主張の境界)

## まず選ぶ：3つの利用経路

| 利用経路 | 向いている目的 | 主な成果物 | 注意点 |
| --- | --- | --- | --- |
| **自然言語レビュー** | まず問題候補と改善案を知る。文書、動画、イベントも含む | 会話形式のレビュー、改善案、人による追加確認 | 規格台帳や工程履歴を残す用途ではない |
| **standalone評価** | WCAG／JISの全条項を含む一時点の評価台帳を作る | assessment JSONとprofile-awareなMarkdownレポート | 初期化直後は全条項が`not_tested`であり、検査完了ではない |
| **run-backed監査** | screening、人手確認、改善、再検査を追跡する | audit run、登録artifact、統合assessment、レポート | schemaとartifactの関係を理解する必要がある |

処理全体と役割分担は、[アーキテクチャと用語集](docs/architecture-and-glossary.md)で確認できます。3経路を実際に動かす場合は[実行可能なexamples](examples/README.md)を使います。

## 対応対象と現在の制限

| 対象 | 自然言語レビュー | 構造化screening／規格台帳 | 現在の制限 |
| --- | --- | --- | --- |
| Webサイト／Webアプリ | 対応 | `web-modern`、`jp-public-web`、読取り専用`scan-web` | 実機スクリーンリーダー確認は外部の人またはホスト機能が必要 |
| PDF／Word／スライド | 対応 | ガイダンス中心 | 専用のactive profileと正式なclaim経路は未実装 |
| 動画／音声 | 対応 | Web範囲内の関連条項確認 | 単独media profileは未実装 |
| イベント／会議／コミュニティ | 対応 | 情報利用の5観点によるレビュー | 専用の構造化assessmentは未実装 |
| ATAG／authoring process | 参照ガイダンス | 一部の参照情報 | `authoring-agent` profileは現在inactive |

`web-modern`は[WCAG 2.2](https://www.w3.org/TR/WCAG22/) A／AAの55件を扱います。`jp-public-web`は[JIS X 8341-3:2016（WAIC解説）](https://waic.jp/docs/jis2016/understanding/201604/) A／AAの38件と、WCAG 2.1／2.2で追加されたA／AAの18件、合計56件を扱います。JISに残る4.1.1「構文解析」は[WCAG 2.2では削除](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)されています。収録件数と実際の評価件数は別々に記録します。

## 前提条件と導入

- Node.js 20以上
- リポジトリのローカルコピー
- browser scanを使う場合のみ、指定版のPlaywright、axe-core、Chromium

### Codex

Windowsではmanifest対応installerを利用できます。

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\install-codex.ps1" -WhatIf
powershell -ExecutionPolicy Bypass -File ".\scripts\install-codex.ps1"
```

認可済み修正を明示的に導入する場合だけ`-IncludeAuthorizedFixer`を指定します。認可済み修正agentは読取り専用のhandoffを作成し、対象を直接変更しません。実際の変更、検証、rollbackは、外部許可を確認した信頼された運用者が行います。

macOS／Linuxでは`codex/skills/information-accessibility-practice/`とmanifestで既定指定されたagentを配置します。詳細は[はじめに](docs/getting-started.md)を参照してください。

### Claude

skillとmanifest既定4agentをまとめて配置します。

```powershell
node .\scripts\install-claude.mjs --dry-run
node .\scripts\install-claude.mjs
```

specialist agentをdispatchできない場合だけ`--reviewer-only`を使用します。

### CLI

```powershell
npm install --global .\codex\skills\information-accessibility-practice
accessibility-audit --help
accessibility-audit --version
accessibility-audit profiles list
accessibility-audit requirements search "focus" --profile web-modern --level AA
accessibility-audit doctor
```

これらのdiscovery commandはread-onlyです。標準CLIは監査対象を変更しません。

## 5分で試す

次の例は、WCAG 2.2 A／AAの55件を`not_tested`で初期化し、検証して、日本語のprofile-awareレポートを生成します。

```powershell
node .\codex\skills\information-accessibility-practice\scripts\accessibility-audit.mjs assessment --profile web-modern --target-name "Example Site" --target-version "2026-08-24" --target-ref "https://example.com/" --evaluator "Accessibility Reviewer" --evaluated-at "2026-08-24" --output .\audit-runs\quickstart\audit.json
node .\codex\skills\information-accessibility-practice\scripts\accessibility-audit.mjs validate-assessment .\audit-runs\quickstart\audit.json
node .\codex\skills\information-accessibility-practice\scripts\accessibility-audit.mjs report --input .\audit-runs\quickstart\audit.json --locale ja --output .\audit-runs\quickstart\audit-report.md
```

台帳を生成しただけでは対象を検査したことにはなりません。対象固有の証拠と判定が入るまでは、各行が`未確認`／`未実施`として表示されます。

レポート各行には、条項番号、名称、レベル、profile group、一次資料、判定の出所、証拠レベル、根拠を表示します。run-backedレポートでは、外部人手レビュー、AI／自動スクリーニング、未実施を区別します。screening projectionはreport-only judgementであり、profile outcomeへ自動昇格しません。

`--locale ja`と`--locale en`は人向け表示だけを変更し、内部ID、schema key、enumは変更しません。主張可能な範囲には、要求されたtier、validator上限、registryの固定wording、制限理由を表示します。

編集用プレースホルダーだけが必要な場合はtemplate modeを使います。

```powershell
node .\codex\skills\information-accessibility-practice\scripts\generate-assessment.mjs --template --profile web-modern --output .\audit-runs\quickstart\assessment.template.json
```

`render-audit-report.mjs`は既存利用者向けのlegacy-compatible direct rendererとして残ります。新しいprofile／provenance／locale／claim表示の正規経路は`accessibility-audit report`です。

## 生成されるもの

| 成果物 | 役割 | 通常の公開範囲 |
| --- | --- | --- |
| assessment JSON | profile全条項、証拠、判定、claim情報を保持 | 内部用。検証後にレポートへ投影 |
| automated scan JSON | axe結果、DOM／AX tree等の内部証拠 | 原則として内部用 |
| compact scan context | AIへ渡すために圧縮した問題候補 | 内部レビュー用 |
| audit run | 対象、権限、artifact hash、状態遷移を保持 | 非公開 |
| human-review queue | 人が確認する条項、手順、必要証拠 | 作業用 |
| Markdown report | profile、判定、provenance、claim、改善、未確認事項を表示 | publication review後に共有可能 |

各成果物の作成者、入力、出力、公開可否は[成果物マップ](docs/architecture-and-glossary.md)に整理しています。

## 実Web検査

`scan-web`は固定されたPlaywright／axe-coreを使って公開URLを読取り専用で検査します。自動検査結果をWCAG／JISの正式なpass／failへ直接昇格させることはありません。

```text
このサイトの最初の画面を、アクセシビリティCLIで検査して。
https://example.com/
```

依存関係、network／redirect制御、private address拒否、出力形式、compact AI context、Chromium E2Eの範囲は[実Web検査ガイド](docs/web-inspection.md)を参照してください。

## 詳細ドキュメント

- [はじめに：最初の1回と利用経路](docs/getting-started.md)
- [実行可能な3経路のexamples](examples/README.md)
- [アーキテクチャ、役割、成果物、日英用語集](docs/architecture-and-glossary.md)
- [実Web検査とbrowser／network境界](docs/web-inspection.md)
- [Codex向けagent orchestration](codex/skills/information-accessibility-practice/references/agent-orchestration.md)
- [Claude向けagent orchestration](claude/skills/information-accessibility-practice/references/agent-orchestration.md)
- [規格assessmentと証拠レベル](codex/skills/information-accessibility-practice/references/standards-assessment.md)
- [セキュリティ方針](SECURITY.md)
- [コントリビューション手順](CONTRIBUTING.md)
- [変更履歴](CHANGELOG.md)
- [第三者資料の帰属と利用条件](THIRD_PARTY_NOTICES.md)

## 証拠と主張の境界

AIエージェントが作成または更新するprofile requirement行は、`mapping_status: "unverified"`と`outcome: "not_tested"`に保ちます。AIの観測は`SCREEN-*`または未検証のhandoffとして記録します。

- AIと自動検査はE0／E1のscreening observationを作成できます。
- 自動・静的検査は`screening_check`、人が一次資料へ対応付ける規格条項は`profile_requirement`として分離します。
- 外部人手レビューだけが、手順と対象固有の証拠に基づくprofile outcomeを記録できます。
- `reference_only`、`screened`、`evaluated_subset`等のclaim tierは、記録された証拠とprofile ceilingを超えられません。
- raw DOM、AX tree、private URL、local path、個人情報、authorization情報は、公開方針が明示されない限り内部用です。
- レポートの判定語は、第三者認証、法的判断、正式な適合表明ではありません。

## 開発と保守

変更前に[CONTRIBUTING.md](CONTRIBUTING.md)を確認してください。通常の完全検証は次です。

```powershell
node .\scripts\verify-all.mjs
```

セキュリティ上の問題は公開Issueへ秘密情報を貼らず、[SECURITY.md](SECURITY.md)の案内に従ってください。

## ライセンス

オリジナルのコードと文書は[MIT License](LICENSE)です。第三者規格メタデータには各提供元の条件が残ります。詳細は[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)を確認してください。
