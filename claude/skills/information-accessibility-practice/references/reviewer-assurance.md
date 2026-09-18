# 人手レビューの申告と署名の検証

`scripts/human-review.mjs` は、人手レビューを非公開JSONへまとめ、署名とレビュー担当者の帰属をオフラインで検証するCLIです。対象情報、レビュー全文、担当者IDを結び付けます。run付きでは、登録済みartifactの実ファイル、測定対象の台帳、入力artifactのハッシュも照合します。

assessment 2.0.0では、この共通記録を結果行へ結び付け、claim guardと公開レポートで保証水準を表示します。既存の`human_verified`は旧形式の自己申告として扱い、本人認証を証明しません。単なるCLIの成功を理由に、認証済みと解釈したり適合主張を強めたりしないでください。最終bundle全体と過去の署名鎖の検証は#58で扱う別の機能です。

## 検証結果

`assurance`は入力JSONに書き込む資格ではなく、検証時に計算する結果です。

| assurance | 確認できたこと | reviewer_identity_authenticated |
| --- | --- | --- |
| `self_declared` | 構造と対象への結び付き。署名はない | `false` |
| `self_signed` | 同封公開鍵による署名の一致。外部の方針では鍵の帰属を確認できない | `false` |
| `signed` | 受領者が信頼する方針で、人に帰属する鍵、担当者ID、役割、対象範囲を確認した | `true` |
| `organization_attested` | 上記に加え、受領者の方針が所属組織とこの保証水準を認める | `true` |
| `independent` | 上記に加え、受領者の方針が対象範囲で独立した担当者として認める | `true` |

署名者IDと記録の`reviewer_id`が異なる場合は拒否します。`reviewer_name`は署名対象に含めますが、表示名そのものの真正性は確認しません。組織やAIの鍵を人手レビューの本人認証に使うことも拒否します。レビュー内容の正しさ、全条項の検査完了、法的な適合性は、どの保証水準でも証明されません。

標準出力には担当者名・担当者ID・役割名・所属・公開鍵・内部ハッシュを含めません。元のレビュー記録はこれらを含むため、非公開で保存してください。検証結果のJSONを保存しても、それ自体が後の認証や操作承認になることはありません。

## 記録の準備

以下はスキルディレクトリを作業ディレクトリにした例です。入力のrun、assessment、artifactは変更しません。出力先は新規ファイルに限ります。

run付きでは、既に登録した人手申告artifactを指定します。

```powershell
node scripts/human-review.mjs prepare --run audit-run.json --artifact-id ART-HUMAN-001 --reviewer-id reviewer-001 --output private-review-record.json
```

CLIは現在のrun契約、登録artifactの関係とハッシュ、保存済みの証拠を検証します。署名対象のcontextをrunから組み立て、登録元のレビューをそのまま保存します。対象サイトへの通信は行いません。対象の現在状態を再検査したことにはなりません。

単独のassessmentでは、実際の担当者から受け取った`declared-human-review` 1.0.0のpayloadを指定します。新しいassessment 2.0.0には生成時に一意の`assessment_id`が入り、そのIDを使います。

```powershell
node scripts/human-review.mjs prepare --assessment assessment.json --review declared-review.json --reviewer-id reviewer-001 --output private-review-record.json
```

`--assessment-id`を明示した場合は保存済みIDとの完全一致が必要です。旧assessment 1.0.0の準備・検証に限り、検証側でも同じIDを明示してください。別の評価にIDを再利用しないでください。AIは実在する外部レビューの記録整形を支援できますが、人の実施内容や本人情報を作って補ってはいけません。

## 外部で署名するプロトコル

生成した記録の`attestation`は`null`です。秘密鍵の生成、読込み、保管、署名サービスへの送信は、このCLIに含めません。外部の署名担当者が内容を確認してから署名します。

1. `humanReviewSigningSubject(record)`で署名対象を再構築する。`attestation`以外のレビュー内容とcontextが含まれる。
2. `attestationDigest(subject)`と`humanReviewTargetContextSha256(record.context)`をstatementの`subject_sha256`と`target_context_sha256`へ入れる。
3. statementに`schema_version: "1.0.0"`、`kind: "human_review"`、`canonicalization: "RFC8785"`、`algorithm: "Ed25519"`、`signer_id`、`key_id`、`role`、`assurance_requested`、`signed_at`、`expires_at`、`predecessor_attestation_sha256: null`を指定する。
4. 外部の担当者が`attestationSigningBytes(statement)`のバイト列へEd25519署名を付ける。
5. 新しい非公開記録の`attestation`に、`statement`、公開JWK `{ kty: "OKP", crv: "Ed25519", x: "…" }`、base64urlの`signature`を入れる。秘密鍵のJWKフィールドは拒否される。

正規化は[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html)に基づき、UTF-16順のプロパティ整列、ECMAScriptの数値表現、UTF-8を用います。署名バイト列は`information-accessibility-attestation-v1`、NUL 1バイト、正規化したstatementの順です。署名の検証には[Node.js 22.19.0の`crypto.verify`](https://nodejs.org/download/release/v22.19.0/docs/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback)を使います。

JSONの空白やプロパティ順の違いは、正規化後の署名対象を変えません。一方、runに登録された元artifactは実ファイルのバイト列でハッシュを照合するため、空白1バイトの追加も拒否します。署名入力では、重複キー、不正UTF-8、孤立サロゲート、非有限数を拒否し、8 MiB・深さ64・10万ノードを上限にします。

## 受領者の信頼方針

署名済みレビューに同封された鍵だけでは、担当者を認証しません。受領者は、監査データの外で管理する信頼方針と、その方針の正規化SHA-256を別途指定します。**同封された方針と同封されたハッシュをそのまま信頼すると、鍵の帰属を独立に確認したことになりません。** AIや監査データの作成者が、自分の鍵を信頼済みとして追加する運用も認めません。

方針は`schema_version: "1.0.0"`、`policy_id`、`valid_from`、`valid_until`、`signers`を持ちます。各signerに次の全フィールドを指定します。

| フィールド | 内容 |
| --- | --- |
| `signer_id`、`key_id` | 人と鍵の別々の識別子。鍵IDは方針内で一意 |
| `subject_type` | `human`または`organization`。人手レビューの認証は`human`のみ |
| `organization` | 組織名または`null`。組織・独立保証には組織名が必要 |
| `roles`、`kinds` | 認める役割と署名対象。レビューには`human_review`が必要 |
| `assurance_ceiling` | `signed`、`organization_attested`、`independent`の上限 |
| `target_context_sha256` | 認めるassessment contextのハッシュ配列。ワイルドカードは不可 |
| `public_key` | Ed25519の公開JWK |
| `valid_from`、`valid_until` | 鍵の有効期間。時差付きRFC 3339で指定 |
| `revoked_at` | 未失効は`null`。日時が入っている鍵は拒否 |

同じ公開鍵を複数の担当者や別レコードへ重複割当てすることはできません。複数の役割は一つのsignerの`roles`に記載します。鍵の交代時は、新しい公開鍵と鍵IDを追加し、旧鍵を失効させた方針と新しいハッシュを受領者が採用します。

検証時の時計で、署名・鍵・方針の期限を確認します。`signed_at`は署名者の申告時刻で、信頼できる時刻認証ではありません。このため`revoked_at`が非nullの鍵は、失効前を主張する署名や将来の失効日時を含めて拒否します。過去の署名を長期検証するためのタイムスタンプ局や失効履歴の保証は未実装です。

## 検証コマンド

```powershell
node scripts/human-review.mjs verify --record signed-review-record.json --run audit-run.json --artifact-id ART-HUMAN-001 --trust-policy recipient-trust.json --trust-policy-sha256 <外部で確認した方針のハッシュ> --minimum-assurance signed
```

単独経路では、同じ`--assessment`を指定します。旧形式では`--assessment-id`も必要です。`--trust-policy`を省略した署名は、暗号学的に一致しても`self_signed`です。方針とハッシュは必ず対で指定します。

`--minimum-assurance`を省略すると、構造とcontextが正しい自己申告でも終了コード0を返します。認証が必要な処理は`--minimum-assurance signed`以上を明示してください。不足・改変・期限切れ・失効などは終了コード1です。終了コード0だけを本人認証の証拠として扱ってはいけません。

`verify`の出力は`review_correctness_verified: false`、`assessment_result_binding_verified: false`、`final_bundle_verified: false`を含みます。この操作は元のレビューと対象contextを確認するもので、結果行の反映を行いません。

## assessmentへの反映とレポート

単独経路では、新規ファイルへ結果を反映します。

```powershell
node scripts/human-review.mjs apply --assessment assessment.json --record signed-review-record.json --output reviewed-assessment.json --claim-tier evaluated_subset --trust-policy recipient-trust.json --trust-policy-sha256 <外部で確認した方針のハッシュ>
node scripts/validate-assessment.mjs reviewed-assessment.json --trust-policy recipient-trust.json --trust-policy-sha256 <外部で確認した方針のハッシュ>
node scripts/render-report.mjs --input reviewed-assessment.json --output report.md --trust-policy recipient-trust.json --trust-policy-sha256 <外部で確認した方針のハッシュ>
```

`apply`は未評価の登録条項に限って結果を反映し、既存結果を置き換えません。対象・規格・範囲・環境とIDを照合し、手順、一次資料、必要な証拠種別も登録内容に照合します。不適合には担当者が記録した構造化findingが必要です。反映成功時は`assessment_result_binding_verified: true`になりますが、レビュー内容の正しさや最終bundleを検証したことにはなりません。

run付きでは`merge-audit-artifacts.mjs`の既存引数に`--review-record signed-review-record.json`を追加します。複数の元artifactについて繰り返せます。指定しなかった元レビューも、非認証の自己申告recordとして統合します。検証には`validate-assessment.mjs reviewed-assessment.json --run audit-run.json`を使い、レポートには`render-report.mjs --run audit-run.json --assessment reviewed-assessment.json --output report.md`を使います。署名者確認が必要な操作では、いずれも上と同じ外部信頼方針とハッシュを渡してください。元artifactの実バイト列も毎回照合します。

assessment 2.0.0は`human_review_records`を持ち、`human_declared`行が署名対象のSHA-256を参照します。結果・証拠・手順説明・根拠・担当者が作成したfindingの一致を確認します。署名に含まれない`review_details`を行へ追加することはできません。改善計画、他のスクリーニング行、報告書全体などはこのレビュー署名の対象外です。

認証状態はファイルに保存しません。validatorの`guard.reviewer_assurance`とレポートで、検証時に保証水準を再計算します。全レビューの担当者を確認できない場合、claimは最大でも`evaluated_subset`に制限し、固定文言で自己申告を明示します。全員を確認できた場合にも、既存の証拠・網羅性・profileの上限を超えません。新形式のE4以上には、全評価済みレビューが外部方針で`independent`と検証されることも必要です。

旧assessment 1.0.0は凍結schemaで読み取り、`human_verified`を`legacy_self_declared`として表示します。既存の結果を自動で認証済みに移行しません。旧E4／E5の表示には「自己申告・独立した担当者の本人性は未確認」と付記します。旧形式へ`apply`はできません。担当者の確認を伴う新しい評価を作成してください。

公開用Markdown／HTMLでは、保証水準の件数と固定ラベルを使い、元の署名記録・担当者ID・鍵・所属を出しません。`--visibility public --reviewer-disclosure redact --redaction-manifest private-redactions.json`を指定すると、通常の公開出力処理で担当者表示名も伏せます。元のレビュー記録とassessmentは非公開で管理してください。

#58の最終bundleの実ファイルハッシュ・前段の署名鎖は別の契約です。現在のレビュー検証から、その検証済み状態を推定してはいけません。
