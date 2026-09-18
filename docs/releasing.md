# リリース手順

この手順は、内容を確認できる配布候補の作成と、承認後の公開を分けています。通常の実装依頼やローカルcommitは、push、tag公開、GitHub Releaseの公開を意味しません。

## ローカルで候補を作る

1. [変更履歴](../CHANGELOG.md)、[対応版](version-support.md)、package版に対応する `docs/releases/<version>.md` を更新します。`release-files.json` はレビュー済みの収録パス一覧です。新しいファイルは内容と公開範囲を確認してから追加し、実監査証拠をfixtureとして登録しないでください。
2. 配布物同期・出典確認・関連テストを実行します。全体検証は `node scripts/verify-all.mjs` です。必要な実ブラウザ検査とリモートCIの結果は区別して記録します。
3. 対象変更をcommitし、worktreeをcleanにします。元の監査証拠や無関係な変更を配布のために削除しません。
4. 候補を生成します。出力先の既存ファイルは上書きしません。

```powershell
node .\scripts\build-release.mjs --output-dir .\audit-runs\release-candidate
```

アーカイブは現在のHEADに固定され、配布対象として許可したGit管理ファイルだけから生成します。ローカルのnode_modules、.git、audit-runs、研究用原本、内部レビュー・作業計画は収録しません。導入に必要なCodex／Claude、agent定義、installer、検証用スクリプト、サンプル、テスト、利用者向け文書、第三者noticeを含みます。

配布対象ディレクトリに未知のファイルが増えた場合は停止します。パス一覧は内容が安全であることの自動判定ではありません。既存ファイルへ秘密情報を追記していないかも、公開前のdiff reviewで確認してください。生成器はアーカイブを一時展開し、収録ファイルの実バイトとpackage検証を確認してから候補を保存します。Git、Node.js、gzip対応tarが必要です。

`source-manifest.json` は収録ファイルの相対パス・サイズ・SHA-256、完全なsource commit、package版、アーカイブのhashを記録します。`SHA256SUMS` は最後に生成する完了目印です。途中失敗した候補を公開せず、残ったファイルは確認用に保持してください。checksumは本人性や信頼できる時刻を証明する署名ではありません。

アーカイブを新しいディレクトリへ展開し、以下を確認します。

```powershell
tar -xzf <archive.tar.gz> -C <empty-directory>
node <extracted-root>/scripts/verify-package.mjs
node <extracted-root>/scripts/build-criteria-catalog.mjs --check
node <extracted-root>/scripts/install-claude.mjs --claude-home <temporary-home> --dry-run
```

Windowsでは64-bit Windows PowerShellでCodex installerの `-CodexHome <temporary-home> -WhatIf` も確認します。展開した全ファイルをmanifestのhashと照合し、研究用原本や実監査証拠がないことを確認します。

## 公開時の確認

公開の承認対象には、完全なcommit SHA、tag名、releaseの通常版／prerelease区分、公開するノート、4つの添付ファイル、残る検証制限を含めます。公開先はこのリポジトリの[Releases](https://github.com/Nagi-Inaba/information-accessibility-skill/releases)です。

承認後に対象commitを統合・pushし、同じcommitにtagを付け、候補のノートと添付をGitHub Releaseへ登録します。新規公開では先にdraftで内容を確認できます。別commitで作ったアーカイブを流用せず、公開後はtag・source commit・添付名・hash・ダウンロード可能性を照合します。公開済みの同じ版を差し替えず、修正は新しい版として扱います。GitHubの[release管理](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)を参照してください。

## リポジトリの案内設定

非公開の脆弱性報告はGitHubのPrivate vulnerability reportingを有効にし、[報告画面](https://github.com/Nagi-Inaba/information-accessibility-skill/security/advisories/new)へつなぎます。公開Issueには秘密情報や脆弱性の詳細を収集しません。

Aboutのdocumentation URLは `https://github.com/Nagi-Inaba/information-accessibility-skill#readme`、topicsは `accessibility`、`wcag`、`jis-x-8341-3`、`codex`、`claude-code`、`ai-agents` を候補とします。適用後はAPIの読戻しで設定を確認します。設定だけでは新しい文書やreleaseが公開されたことにはなりません。
