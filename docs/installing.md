# Installation, upgrade and removal / 導入・更新・削除

Use a pinned source revision for every install. The package is still version `0.1.0` without a published tagged release, so the package version alone does not identify its behavior. Record the full Git commit SHA or the archive's `source-manifest.json` with the audit. Node.js 20 or later is required. Browser scans additionally need a permitted browser adapter; ledger and report commands do not.

導入ごとにソース版を固定します。package `0.1.0`は公開済みtag付きreleaseがなく、版番号だけでは挙動を特定できません。完全なGit commit SHA、またはarchiveの`source-manifest.json`を監査記録とともに保管します。Node.js 20以上が必要です。ブラウザー検査には別途利用を認められたadapterが必要ですが、台帳・レポートのコマンドには不要です。

| Host | Windows | macOS / Linux | Installed components |
| --- | --- | --- | --- |
| Codex | `node scripts/install-codex.mjs` or existing `scripts/install-codex.ps1` | `node scripts/install-codex.mjs` | Skill with its CLI and four default agents |
| Claude | `node scripts/install-claude.mjs` | `node scripts/install-claude.mjs` | Skill with its CLI and four default agents |

Both hosts use `shared/agents/agent-manifest.json` for the default reviewer, E1 inspector, human queue planner and remediation planner. Both omit the authorized fixer by default; `--include-authorized-fixer` adds its matching agent and runtime. Claude alone supports `--reviewer-only` when specialist dispatch is unavailable. Neither installer installs a global npm CLI: run the CLI inside the installed skill to keep its version aligned with the agents and references.

両ホストの既定4agentはmanifestのreviewer、E1 inspector、human queue planner、remediation plannerです。認可済み修正機能は既定では含まず、`--include-authorized-fixer`で対応するagentとruntimeを同時に追加します。Claudeの`--reviewer-only`はspecialist dispatchがない環境専用です。global npm CLIは自動導入しません。導入先skill内のCLIを実行すると、agent・参照資料と同じ版を使えます。

## 1. Pin and verify the source / ソース版の固定

With Git, clone the repository and check out the **full approved commit SHA** in detached mode before running an installer. For an extracted release archive, verify its `SHA256SUMS` and `source-manifest.json` as described in [releasing.md](releasing.md), then run the same package check. Do not combine a skill from one checkout with agents or a global CLI from another.

Gitではリポジトリ取得後、承認した**完全なcommit SHA**をdetached checkoutしてから導入します。展開したrelease archiveなら[リリース手順](releasing.md)に従って`SHA256SUMS`と`source-manifest.json`を確認し、同じpackage検証を実行します。別々のcheckoutのskill、agent、global CLIを混ぜないでください。

```sh
git rev-parse HEAD
node scripts/verify-package.mjs
node --version
```

## 2. First install / 初回導入

Run from the pinned source root. These Node commands work on Windows, macOS and Linux. `--dry-run` prints the destination and selected files without writing. Use `--codex-home` or `--claude-home` to choose a non-default home; otherwise the installer uses the host's environment setting or `~/.codex` / `~/.claude`.

固定したソースのrootから実行します。Nodeコマンドは3 OS共通です。`--dry-run`は書き込まずに配置先と選択ファイルを表示します。標準以外の場所には`--codex-home`／`--claude-home`を指定します。省略時はホストの環境設定か`~/.codex`／`~/.claude`を使います。

```sh
node scripts/install-codex.mjs --dry-run
node scripts/install-codex.mjs
# Or, for Claude:
node scripts/install-claude.mjs --dry-run
node scripts/install-claude.mjs
```

Run only the pair for the host you use. A first install refuses existing managed destinations. On Windows, `scripts/install-codex.ps1 -WhatIf` and `scripts/install-codex.ps1` remain available, with their existing backup and transaction checks.

使うホストの2コマンドだけを実行します。初回導入は既存の管理対象pathがあると停止します。Windowsの`scripts/install-codex.ps1 -WhatIf`／`scripts/install-codex.ps1`も、既存のbackup・transaction確認付きで利用できます。

## 3. Upgrade, rollback and removal / 更新・復元・削除

For an upgrade, first pin and verify the **new** source. Choose a fresh backup directory outside both the source tree and host home, and use the same path for the dry-run and actual command. The installer moves the current skill and managed agent files into that backup, then installs the new skill and agents from one source revision. Unrelated agent files remain in place. An installation failure restores the moved files. Existing backup directories are never reused.

更新時は先に**新しい**ソース版を固定・検証します。ソースとホストhomeの外に新しいbackup pathを選び、dry-runと実行で同じpathを使います。現在のskillと管理対象agentを退避してから、単一のソース版から再導入します。無関係のagentは残します。導入失敗時は退避したファイルを戻します。既存のbackup pathは再利用しません。

```sh
node scripts/install-codex.mjs --upgrade --backup-root "$HOME/a11y-backups/codex-upgrade-1" --dry-run
node scripts/install-codex.mjs --upgrade --backup-root "$HOME/a11y-backups/codex-upgrade-1"
```

Use `install-claude.mjs` instead for Claude. To roll back, use the **current** installer with `--restore <previous-backup-directory>` and another fresh `--backup-root` for the version being replaced. The previous backup remains unchanged. `--uninstall` moves the installed skill and manifest-known agents to a fresh backup; it does not delete them. Review the backup before any later manual deletion. Restore does not change original audit runs or evidence.

Claudeでは`install-claude.mjs`に読み替えます。元に戻すときは**現在の**installerに`--restore <前回のbackup>`を指定し、置換される版のために別の新しい`--backup-root`を指定します。前回のbackupは保持されます。`--uninstall`は導入済みskillとmanifestで把握するagentを新しいbackupへ移動し、削除しません。手動削除の前にbackupを確認してください。復元は元の監査runや証拠を変更しません。

```sh
node scripts/install-codex.mjs --restore "$HOME/a11y-backups/codex-upgrade-1" --backup-root "$HOME/a11y-backups/codex-rollback-1" --dry-run
node scripts/install-codex.mjs --restore "$HOME/a11y-backups/codex-upgrade-1" --backup-root "$HOME/a11y-backups/codex-rollback-1"
node scripts/install-codex.mjs --uninstall --backup-root "$HOME/a11y-backups/codex-uninstall-1" --dry-run
node scripts/install-codex.mjs --uninstall --backup-root "$HOME/a11y-backups/codex-uninstall-1"
```

## 4. Check the installed version / 導入後の確認

Run `--version` and `doctor` from the **installed** skill. Replace `.codex` with `.claude` for Claude, or use the home path you selected. The first command identifies the installed package and contract versions; `doctor` checks the available runtime. Retain the source commit and the backup path alongside this output. If you also installed the optional global npm CLI, reinstall it from the same pinned source after each upgrade and remove it separately on uninstall.

**導入先の**skillから`--version`と`doctor`を実行します。Claudeなら`.codex`を`.claude`に、配置先を指定した場合はそのpathに読み替えます。前者はpackage・契約版を示し、後者は利用可能なruntimeを確認します。ソースcommitとbackup pathも結果とともに保管します。任意にglobal npm CLIを使っている場合は、更新ごとに同じ固定ソースから再導入し、削除時も別途アンインストールします。

```sh
node "$HOME/.codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs" --version
node "$HOME/.codex/skills/information-accessibility-practice/scripts/accessibility-audit.mjs" doctor
```
