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
| **standalone評価** | WCAG／JISの全条項を含む一時点の評価台帳を作る | 1つのassessment JSONとMarkdownレポート | 初期化直後は全条項が`not_tested`であり、検査完了ではない |
| **run-backed監査** | 複数担当者、screening、人手確認、改善、再検査を追跡する | audit run、登録artifact、統合assessment、レポート | schemaとartifactの関係を理解する必要がある |

処理全体と役割分担は、[アーキテクチャと用語集](docs/architecture-and-glossary.md)で一枚のフローとして確認できます。

## 対応対象と現在の制限

| 対象 | 自然言語レビュー | 構造化screening／規格台帳 | 現在の制限 |
| --- | --- | --- | --- |
| Webサイト／Webアプリ | 対応 | `web-modern`、`jp-public-web`、読取り専用`scan-web` | 実機スクリーンリーダー確認は外部の人またはホスト機能が必要 |
| PDF／Word／スライド | 対応 | ガイダンス中心 | 専用のactive profileと正式なclaim経路は未実装 |
| 動画／音声 | 対応 | Web範囲に含まれる場合の関連条項確認 | 単独media profileは未実装 |
| イベント／会議／コミュニティ | 対応 | 情報利用の5観点によるレビュー | 専用の構造化assessmentは未実装 |
| ATAG／authoring process | 参照ガイダンス | 一部の参照情報 | `authoring-agent` profileは現在inactive |

WCAG 2.2 A／AAの55件は`web-modern`、JIS X 8341-3:2016 A／AAの38件と追加WCAG 18件は`jp-public-web`で扱います。収録条項数と、実際に評価できた条項数は別々に記録します。

## 前提条件と導入

- Node.js 20以上
- リポジトリのローカルコピー
- Webのブラウザscanを使う場合のみ、指定版のPlaywright、axe-core、Chromium

### Codex

Windowsでは、manifestを読むバックアップ付きinstallerを利用できます。

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\install-codex.ps1" -WhatIf
powershell -ExecutionPolicy Bypass -File ".\scripts\install-codex.ps1"
```

macOS／Linuxでは、`codex/skills/information-accessibility-practice/`とmanifestで既定指定されたagentをCodexの配置先へコピーします。導入内容の詳細は[はじめに](docs/getting-started.md)と[アーキテクチャ](docs/architecture-and-glossary.md)を参照してください。

### Claude

Claude skillと既定4agentは、cross-platform installerでまとめて配置できます。

```powershell
node .\scripts\install-claude.mjs --dry-run
node .\scripts\install-claude.mjs
```

specialist agentをdispatchできないClaudeホストに限り、`--reviewer-only`を使用します。

### CLI

skill folderからglobal commandを導入するか、Node.jsで直接実行します。

```powershell
npm install --global .\codex\skills\information-accessibility-practice
accessibility-audit --help
```

```powershell
node .\codex\skills\information-accessibility-practice\scripts\accessibility-audit.mjs --help
```

## 5分で試す

次の例は、WCAG 2.2 A／AAの全55件を`not_tested`で初期化したstandalone評価台帳を作り、検証し、参照ガイダンスを生成します。リポジトリのルートで実行してください。

```powershell
node .\codex\skills\information-accessibility-practice\scripts\generate-assessment.mjs --profile web-modern --target-name "Example Site" --target-version "2026-08-23" --target-ref "https://example.com/" --evaluator "Accessibility Reviewer" --evaluated-at "2026-08-23" --output .\audit-runs\quickstart\audit.json
node .\codex\skills\information-accessibility-practice\scripts\validate-assessment.mjs .\audit-runs\quickstart\audit.json
node .\codex\skills\information-accessibility-practice\scripts\render-audit-report.mjs --input .\audit-runs\quickstart\audit.json --output .\audit-runs\quickstart\audit-report.md
```

`audit.json`を生成しただけでは、対象を検査したことにはなりません。対象固有の証拠と判定が入るまでは、レポートは未確認事項を示す参照ガイダンスです。macOS／Linuxのコマンドと次の手順は、[5分クイックスタート](docs/getting-started.md)にあります。

## 生成されるもの

| 成果物 | 役割 | 通常の公開範囲 |
| --- | --- | --- |
| assessment JSON | profile全条項、証拠、判定、claim情報を保持 | 内部用。検証後にレポートへ投影 |
| automated scan JSON | axe結果、DOM／AX tree等の内部証拠 | 原則として内部用 |
| compact scan context | AIへ渡すために圧縮した問題候補と未解決項目 | 内部レビュー用 |
| audit run | 対象、権限、artifact hash、状態遷移を保持 | 非公開 |
| human-review queue | 人が確認する条項、手順、必要証拠 | 作業用 |
| Markdown report | 確認範囲、判定、改善、未確認事項を表示 | publication review後に共有可能 |

各成果物の作成者、入力、出力、公開可否は[成果物マップ](docs/architecture-and-glossary.md#artifact-map--成果物の関係)に整理しています。

## 実Web検査

`scan-web`は、固定されたPlaywright／axe-coreを使って、公開URLを読取り専用で検査します。自動検査結果をWCAG／JISの正式なpass／failへ直接昇格させることはありません。

依存関係、network／redirect制御、private address拒否、出力形式、compact AI context、Chromium E2Eの範囲は[実Web検査ガイド](docs/web-inspection.md)を参照してください。

## 詳細ドキュメント

- [はじめに：最初の1回と利用経路](docs/getting-started.md)
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

AIエージェントが作成または更新するプロファイル要件行は、`mapping_status: "unverified"`と`outcome: "not_tested"`に保ちます。AIの観測は`SCREEN-*`または未検証の引き継ぎとして記録します。外部の人手レビューは、該当手順と対象固有の手動またはハイブリッド証拠がある場合だけ、`pass`、`fail`、`not_applicable`、`cant_tell`を記録できます。

- AIと自動検査はE0／E1のscreening observationを作成できます。
- 未確認、不明、適用対象外は省略せず、passへ変換しません。
- `reference_only`、`screened`、`evaluated_subset`等のclaim tierは、記録された証拠とprofile ceilingを超えられません。
- raw DOM、AX tree、private URL、local path、個人情報、authorization情報は、公開方針が明示されない限り内部用です。
- authorized fixerは任意機能であり、標準CLIは監査対象を変更しません。

## 開発と保守

変更前に[CONTRIBUTING.md](CONTRIBUTING.md)を確認し、Codex／Claude同期、schema互換性、一次資料、claim boundary、全テストを検証してください。通常の完全検証は次です。

```powershell
node .\scripts\verify-all.mjs
```

セキュリティ上の問題は公開Issueへ秘密情報を貼らず、[SECURITY.md](SECURITY.md)の案内に従ってください。

## ライセンス

オリジナルのコードと文書は[MIT License](LICENSE)です。収録する第三者規格メタデータには各提供元の条件が残ります。詳細は[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)を確認してください。
