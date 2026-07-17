# Task 7 Report

## 結論

Codex インストーラーの配置先検証、経路分離、TOCTOU 対策、ロールバック検証を強化した。レビューで指定された junction 拒否試験を含むインストーラー試験は、10件すべて通過した。

## 変更

- `shared/agents/agent-manifest.json` から `install_by_default: true` のエージェントを選択する。
- スキル配置先と各エージェント配置先を、WhatIf とステージングより前に厳密検査する。ディレクトリ、特殊ファイル、reparse point は変更せず拒否する。
- パッケージ、Codex home、バックアップ、ステージング、変更対象の経路を、大文字小文字を区別しない正規化済み経路で分離する。
- 変更前に親ディレクトリの最終経路、ボリュームID、ファイルIDを記録し、各コピー・同一親内 rename・削除の前後で同一性を再確認する。
- 既存ファイルは `skill/` と `agents/<agent-id>.toml` に個別退避し、ハッシュまたはミラー比較で退避内容を検証する。
- 途中失敗では、スキルと選択済みエージェントだけを元のバイト列へ復元し、元からない選択済みエージェントを削除する。復元後もハッシュまたはミラー比較を行う。
- WhatIf は選択IDと全配置先を表示し、導入先、バックアップ先、ステージング先を変更しない。
- `-IncludeAuthorizedFixer` は、現時点では fixer 未収録として明示的に拒否する。
- マニフェストID、重複、パッケージ内ソース、宛先、および既存コンポーネントの reparse point を検査する。
- 本番コードから試験用失敗注入環境変数を削除し、外部 PowerShell ラッパーで遅延失敗を注入する。

## TDD

- RED：レビュー指定試験を追加した直後の `node --test .\tests\install-codex.test.mjs` は、10件中1件通過、9件失敗だった。
- GREEN：実装修正後の同試験は、10件中10件が通過した。junction 拒否試験も skip されず通過した。

## 検証

- `node --test .\tests\install-codex.test.mjs`：10件中10件通過。
- `node --test .\tests\install-codex.test.mjs .\tests\distribution-sync.test.mjs`：38件中36件通過、2件 skip。
- `node --test .\tests\*.test.mjs`：205件中203件通過、2件 skip。
- `node .\scripts\verify-package.mjs`：PASS、agent_count 4、default_agent_count 4。
- `node .\scripts\sync-distributions.mjs --check`：PASS。
- `git diff --check`：PASS。
- PowerShell パーサー検査：PASS。
- 本番スクリプトの試験用失敗注入環境変数検索：該当なし。

## 残る懸念

プロセス外から内容を書き換える競合は、Windows の一般的なファイル操作だけでは完全に排除できない。インストール中に別プロセスで対象を変更しない運用条件を README に明記した。全体試験の skip 2件は既存の distribution file symlink 試験で、junction 拒否試験は実測済みである。
