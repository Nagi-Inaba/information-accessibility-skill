# 監査ファイルと前段の署名をオフラインで検証する

`audit-bundle`は、保存したrun、登録artifact、証拠、assessment、レポートを一つの署名対象へまとめます。受領者は、実ファイルのバイト列と外部の署名をオフラインで照合できます。元のファイルを変更せず、新しい非公開の記録を作成します。

署名は、記録したファイルの改変を検出するためのものです。レポート本文の正しさ、監査の網羅性、対象サイトの現在状態、規格への適合性は証明しません。[人手レビューの署名](reviewer-assurance.md)とは対象が異なり、bundleに組織の署名があってもレビュー担当者の本人認証やclaim tierは昇格しません。

## 保存するファイルを確定する

runとassessmentを検証してレポートを生成した後、保管するファイルを一つのディレクトリ内に置きます。現在のrun契約とassessment 2.0.0が必要です。assessmentのID、評価結果、指摘、制約はrunの登録証拠と一致しなければなりません。必要な配布版を保存し、検証に使う規格catalog等の版・ハッシュも一致させてください。

次の例はスキルディレクトリから実行します。CLIで指定する相対パスは作業ディレクトリ基準です。生成されるmanifest内のパスは`--root`基準になり、ディレクトリを移しても照合できます。

```powershell
node scripts/accessibility-audit.mjs audit-bundle prepare --root archive --run archive/audit-run.json --assessment archive/assessment.json --report archive/report.md --report archive/report.html --attachment archive/artifacts/saved-web-bundle.json --output archive/private-bundle.json
```

登録artifactとscreening evidenceの保存ファイルは自動で含めます。レポートは`--report`、そのほかの保存済みソース・DOM・AX等は`--attachment`で明示します。`target_inventory`には測定時のハッシュが入りますが、そこに記載された全ソースファイルを自動収集する機能ではありません。未登録・未指定のファイルは署名対象に含まれません。`coverage`と`entire_target_archive_verified: false`をそのまま残します。

上書き、ファイルの自動コピー、対象サイトへの通信、秘密鍵の生成・読込み、外部署名サービスへの送信は行いません。証拠や署名者情報を含む記録は非公開で保存します。透明性ログへの登録も行わず、機密証拠や低エントロピー情報のハッシュを公開しません。

## 外部の担当者が署名する

記録形式は[audit-bundle-record.schema.json](audit-bundle-record.schema.json)の1.0.0です。`attestation: null`が未署名を表します。署名担当者は実ファイルとレポートを確認し、別の承認された仕組みで署名します。

1. `scripts/lib/audit-bundle.mjs`の`auditBundleSigningSubject(record)`で署名対象を組み立てる。
2. `attestationDigest(subject)`をstatementの`subject_sha256`、`auditBundleTargetContextSha256(record.manifest.context)`を`target_context_sha256`に入れる。
3. [共通署名プロトコル](reviewer-assurance.md)のstatementに、`kind: "audit_bundle"`、担当者の`signer_id`、`key_id`、`role`、要求する保証水準、`signed_at`、`expires_at`を指定する。`predecessor_attestation_sha256`はmanifestの前段署名ハッシュと一致させ、前段がなければ`null`にする。
4. 共通の`attestationSigningBytes(statement)`へEd25519署名を付ける。新しい非公開記録の`attestation`に`statement`、Ed25519公開JWK、base64urlの`signature`を保存する。

署名対象にはbundle ID、run IDと契約版、対象・環境・scope・profile、測定inventory、resourceの版・ハッシュ、全ファイルの相対パス・SHA-256・バイト数、前段のbundle/run ID・run実バイトのハッシュ・署名対象ハッシュ・署名ハッシュが入ります。登録artifactはIDと保存パスを対応付けます。署名者、役割、鍵ID、期限は署名されたstatementに入ります。

ファイルのハッシュは生のバイト列で計算するため、JSONの空白1バイトの変更も検出します。記録とstatement自体は共通のRFC 8785正規化に従います。空白やプロパティ順を変えても内容が同じなら、記録の署名は変わりません。重複キー、不正UTF-8、未知フィールド、私有鍵フィールド、曖昧なパスは拒否します。

## 受領者が照合する

```powershell
node scripts/accessibility-audit.mjs audit-bundle verify --root archive --record archive/private-bundle-signed.json --trust-policy recipient-policy.json --trust-policy-sha256 <受領者が別途信頼した方針の正規化SHA-256> --minimum-assurance organization_attested
```

信頼方針とそのハッシュは、監査データの作成者とは独立に受領者が選びます。同封された方針とハッシュの組合せだけでは鍵の帰属を確認できません。共通方針の`kinds`に`audit_bundle`、`roles`に認める役割、`target_context_sha256`に確認した各run contextの正確なハッシュを列挙します。人または組織の鍵を使用できます。署名付きの人手レビューが含まれる場合、そのレビューの再検証に必要な`human_review`の人・役割・contextも同じ方針へ登録します。

| assurance | 確認結果 |
| --- | --- |
| `unsigned` | ファイルが未署名manifestと一致。第三者がmanifestごと書き換えた可能性は排除できない |
| `self_signed` | 同封公開鍵で署名が一致。受領者の方針では鍵の帰属を確認できない |
| `signed` | 外部方針で署名者、鍵、役割、対象範囲、期限を確認 |
| `organization_attested` | 外部方針が対象の組織保証を認める |
| `independent` | 外部方針が対象の独立した署名者による保証を認める |

`--minimum-assurance`の既定値は`unsigned`です。`status: PASS`だけで署名済みとは判断せず、`assurance`、`signature_valid`、`signer_policy_matched`を確認してください。署名者の独立性そのものをソフトウェアが調査するわけではありません。保存した検証結果のJSONを、次の実行の信頼根拠として使用することもできません。

過去の有効なbundleへの置換を防ぐには、受領者が別途確認した今回の`subject_sha256`を`--expected-subject-sha256`へ渡します。照合結果は`expected_subject_matched`です。新しい版がほかに存在するかは検索しないため、`latest_version_verified`は常に`false`です。標準出力のハッシュも自動公開しないでください。

## supersedesの連結を確認する

後続runをまとめる際は、署名済みの直前記録を最初の`--predecessor`に指定します。その記録に前段がある場合は、さらに前の記録も同じオプションで渡します。検証側でも同じ全記録を明示します。ファイル名やURLを記録から自動追跡することはありません。

```powershell
node scripts/accessibility-audit.mjs audit-bundle prepare --root current --run current/audit-run.json --assessment current/assessment.json --report current/report.md --predecessor old/private-bundle-signed.json --require-complete-chain --output current/private-bundle.json
node scripts/accessibility-audit.mjs audit-bundle verify --root current --record current/private-bundle-signed.json --predecessor old/private-bundle-signed.json --require-complete-chain --trust-policy recipient-policy.json --trust-policy-sha256 <方針の正規化SHA-256> --minimum-assurance signed
```

前段のrun IDは現在の`supersedes_run_id`に一致する必要があります。署名ハッシュだけでなく、前段の署名対象・run実バイトのハッシュ・bundle IDも照合し、全段の署名と外部方針を検証します。欠けたリンク、別の前段、重複、余分な記録、循環は拒否します。`--minimum-assurance`は全段に適用し、`chain_assurance`は最も低い段の保証水準を返します。

署名を導入する前のrunを引き継ぐ場合、前段なしで準備できますが、`chain_complete: false`になります。`--require-complete-chain`はこれを拒否します。連結の完全性と署名の有効性は別に表示し、未署名の現在記録を含む場合は`chain_signatures_valid: false`です。

過去の署名は、その時点で記録されたハッシュへの署名として検証します。過去の実ファイル本体は開かないため、`historical_file_bytes_verified`は常に`false`です。過去の保存状態も確認する場合は、その記録を`--record`に、対応する保存ディレクトリを`--root`にして個別に検証してください。

## 鍵の交代、失効、保管上の制約

鍵を交代するときは、同じ署名者に新しい`key_id`と別の公開鍵を登録します。過去の署名を検証するには古い鍵の登録も必要です。ただし、失効済みまたは期限切れの鍵・署名・方針は、過去の署名であっても拒否します。`revoked_at`が非nullなら失効として扱い、署名日時を過去に書き換えても救済しません。

期限は検証時のシステム時計で確認します。`signed_at`は署名者の申告時刻であり、信頼できるタイムスタンプではありません。時刻証明、透明性ログ、長期検証形式、外部の失効情報取得は未対応です。オフライン実行では、受領者が選んだ信頼方針より新しい失効や鍵の侵害を検出できません。

固定上限は、1ファイル64 MiB、全ファイル合計256 MiB、4096ファイル、16レポート、現在を含む32段です。厳密JSON入力は8 MiB・深さ64・10万ノードまでです。ファイル一覧は重複・大小文字の衝突を拒否し、root外パス、Windowsのドライブ相対パスや代替ストリーム、シンボリックリンク等も拒否します。読込み中と完了前にファイルの同一性・ハッシュを再確認します。上限超過のファイルを黙って省略することはありません。
