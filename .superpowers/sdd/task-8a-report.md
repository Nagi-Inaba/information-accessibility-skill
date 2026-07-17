# Task 8A Report

## 結論

Task 7 で公開済みの五つの契約を凍結し、registry 3.0.0、audit-run 4.0.0、fix-authorization 2.0.0、change-record 2.0.0 を現行版にした。
run 1、run 2、run 3 は検証可能な読取専用版として残し、登録とマージは run 4 だけに限定した。

## 変更

- run 1 と run 2 は registry 1、run 3 は registry 2、run 4 は registry 3 に固定した。
- registry 2、audit-run 3、fix-authorization 1、change-record 1 の Git blob を Task 7 の基準コミットからそのまま凍結した。
- registry 3 は七つのロールと遷移を変えず、audit-run 4、fix-authorization 2、change-record 2 を現行版として宣言する。
- audit-run 4 に `permissions.command_execution` を追加した。
- `source_write: denied` ではコマンド実行を拒否し、`source_write: authorized_only` では承認済み検証コマンドだけを許可する。
- fix-authorization 2 は宣言された外部依頼者、絶対 `source_root`、相対 `allowed_paths`、明示的な操作、構造化検証コマンド、remediation artifact の ID と SHA-256 を要求する。
- change-record 2 は create、modify、delete ごとの前後ハッシュ、差分ハッシュ、構造化コマンド結果、lease 証拠、`retest_required` を要求する。
- 現行 registry の schema は artifact manifest を完全一致で固定する。
- 現行 change-record schema の正規化済み内容を registry 3 の SHA-256 に固定し、改行コードの差だけは同一内容として扱う。
- fix-authorization と change-record の登録、run 検証、merge は、`source_write: authorized_only` と `command_execution: authorized_verification_only` が同時に宣言された run だけを受理する。
- fix-authorization の `verification_commands.command_id`、change-record の `changed_files.path` と `command_results.command_id` は、ほかのフィールドが異なる場合も重複を拒否する。
- change-record のコマンド結果は `exited`、`signaled`、`spawn_error` を区別し、終了コードとシグナルの組合せを状態ごとに固定する。
- Claude 側の対応ファイルは `sync-distributions.mjs --write` で生成した。
- agent、manifest、installer、fixer runtime、target write、transaction CLI、lease runtime は変更していない。

## 互換性

| run schema | registry | payload policy | 操作可否 |
| --- | --- | --- | --- |
| 1.0.0 | 1.0.0 | 全 artifact が 1.0.0 | 読取専用 |
| 2.0.0 | 1.0.0 | 全 artifact が 1.0.0 | 読取専用 |
| 3.0.0 | 2.0.0 | queue と remediation が 2.0.0、fix と change が 1.0.0 | 読取専用 |
| 4.0.0 | 3.0.0 | queue、remediation、fix、change が 2.0.0 | 登録とマージが可能 |

旧版と現行版の payload は相互に受理されない。
fix-authorization 1 と change-record 1 は凍結 schema だけで受理され、version 2 payload は現行 schema だけで受理される。

## 凍結 blob

基準は `a65939d` である。
`git rev-parse` と `git hash-object --path` を比較し、五件すべての一致を確認した。

| 凍結ファイル | Git blob |
| --- | --- |
| `orchestration-registry-2.0.0.json` | `aa608df897b7823a3eaa3ba13987791e85a70c73` |
| `orchestration-registry-2.0.0.schema.json` | `4ebc6a017bb7d235aa80e0875d73605f690ad5c2` |
| `audit-run-3.0.0.schema.json` | `28bd2c7a1e61c4d2380212a004cb7d979276a93f` |
| `fix-authorization-1.0.0.schema.json` | `f52b9f66e1df54bedc59eb51a9ecb3d12bec3510` |
| `change-record-1.0.0.schema.json` | `69c6fcdbf48cf9cfe48b4afff70e92f3ffdd8f88` |

## TDD

- 基準確認では、対象二スイートの既存試験は81件中81件が通過した。
- RED では契約と dispatch の試験を先に追加し、86件中38件が通過、48件が失敗した。
- RED は凍結ファイル、現行 version 4 と version 2 payload、registry 3、permission coupling、run と registry の対応が未実装であることを示した。
- 実装後の初回試験は86件中84件が通過し、2件が失敗した。
- 残った2件は、registry 3 の artifact manifest を完全一致にした結果、旧テストの mutation とエラー文期待が先に schema で拒否されたためだった。
- テスト期待を現行の拒否位置に合わせた後、対象二スイートは86件中86件が通過した。
- 全体試験の初回は215件中205件が通過し、8件が失敗、2件が skip だった。
- 8件は将来ゲートの旧文言1件と、run 3 を現行版としていた report fixture 7件だった。
- 直接影響する文言と fixture を更新した後、全体試験は215件中213件が通過し、失敗0件、skip 2件になった。

## 独立レビュー修正

- RED は対象二スイートで89件中83件通過、6件失敗だった。
- 6件の失敗は、権限不足 run が fix-authorization と change-record の処理経路へ進めること、`changed_files.path` の意味的重複を検出しないこと、コマンド結果の状態を schema が表現できないことを再現した。
- run 3 と registry 2 の組合せは、実ファイルを登録した run を `validateAuditRun` へ渡し、fix-authorization 2 と change-record 2 をそれぞれ拒否することを確認した。
- run 4 と registry 3 の組合せは、`registerArtifact` の実経路で fix-authorization 1 と change-record 1 をそれぞれ拒否することを確認した。
- 権限不足の拒否は登録、run 検証、merge の三経路で確認した。正常系 fixture は二つの権限を明示する形へ変更した。
- 意味的重複は、同じキーを持ちながらほかのフィールドが異なるレコードで確認した。
- command result は三状態の正常例と、終了コードまたはシグナルが状態と矛盾する異常例を確認した。
- registry 3 は change-record schema の SHA-256 を保持する。内容変更は拒否し、LF と CRLF の差だけでは拒否しない。
- 配布文書から内部工程名の `Task 8B` と `Task 9` を除き、将来の runtime enforcement と public-report hardening という単独で理解できる表現へ変更した。
- 実装後の対象三スイートは101件中101件通過、失敗0件だった。
- 最終の全体試験は219件中217件通過、失敗0件、skip 2件だった。

## 検証

- `node --test .\tests\audit-orchestration-contract.test.mjs .\tests\audit-orchestration-cli.test.mjs .\tests\agent-role-contracts.test.mjs`：101件中101件通過。
- `node .\scripts\sync-distributions.mjs --write`：PASS。
- `node .\scripts\sync-distributions.mjs --check`：PASS、変更0件。
- `node .\scripts\verify-package.mjs`：PASS、JSON 68件を解析、shared skill 54件、agent 4件が一致。
- `node --test .\tests\*.test.mjs`：219件中217件通過、失敗0件、skip 2件。
- agent、manifest、installer の基準コミットとの差分：0件。
- 凍結 Git blob：5件中5件一致。
- `git diff --check`：PASS。

## 残る懸念

Task 8A は契約の版管理と、修正系 artifact を扱うための run 権限条件までを実装した。
絶対パスの runtime canonicalization、Windows namespace 拒否、操作とパスの照合、command broker、remediation binding、認可の単発利用、lease の取得と回復は Task 8B の範囲であり、現時点では未実装である。
したがって、schema validation は認可を作成せず、対象ファイルの変更やコマンド実行も行わない。
全体試験の skip 2件は、権限不足により file symlink を作成できなかった既存の distribution 試験である。
