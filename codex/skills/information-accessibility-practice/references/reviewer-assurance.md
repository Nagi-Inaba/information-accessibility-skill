# 人手レビューの申告と署名の検証

`scripts/human-review.mjs` は、人手レビューを非公開JSONへまとめ、署名とレビュー担当者の帰属をオフラインで検証するCLIです。対象情報、レビュー全文、担当者IDを結び付けます。run付きでは、登録済みartifactの実ファイル、測定対象の台帳、入力artifactのハッシュも照合します。

この機能は#57／#58の部分実装です。assessment結果行、claim guard、公開レポートには、ここで得た認証結果をまだ反映しません。既存の`human_verified`は人手レビューの申告を表し、本人認証を証明しません。CLIの成功を理由に、この値、証拠レベル、適合主張を変更しないでください。最終bundle全体と過去の署名鎖の検証は未実装です。

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

単独のassessmentでは、実際の担当者から受け取った`declared-human-review` 1.0.0のpayloadと、その評価を一意に識別するIDを指定します。

```powershell
node scripts/human-review.mjs prepare --assessment assessment.json --assessment-id ASSESSMENT-001 --review declared-review.json --reviewer-id reviewer-001 --output private-review-record.json
```

`assessment-id`は検証側でも同じ値を明示し、別の評価に再利用しないでください。単独経路では対象・規格・範囲・環境を照合しますが、assessment結果行とレビュー本文の一致はまだ検証しません。AIは実在する外部レビューの記録整形を支援できますが、人の実施内容や本人情報を作って補ってはいけません。

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

単独経路では、同じ`--assessment`と`--assessment-id`を指定します。`--trust-policy`を省略した署名は、暗号学的に一致しても`self_signed`です。方針とハッシュは必ず対で指定します。

`--minimum-assurance`を省略すると、構造とcontextが正しい自己申告でも終了コード0を返します。認証が必要な処理は`--minimum-assurance signed`以上を明示してください。不足・改変・期限切れ・失効などは終了コード1です。終了コード0だけを本人認証の証拠として扱ってはいけません。

現在の出力は`review_correctness_verified: false`、`assessment_result_binding_verified: false`、`final_bundle_verified: false`を含みます。次にassessment結果行との対応、旧`human_verified`の表示、claim guardと公開レポートの保証水準表示を接続します。その後、#58で最終bundleの実ファイルハッシュと前段の署名鎖を検証します。
