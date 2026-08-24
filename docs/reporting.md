# Reporting / レポート出力

The report command has two independent choices:
レポートコマンドでは、次の2つを別々に選択します。

1. `--detail summary|full`: how much validated information is displayed / 表示する情報量
2. `--visibility internal|public`: whether raw audit data is preserved or publication-oriented redaction is applied / 内部情報を保持するか、公開向け伏字を適用するか

Neither choice changes the assessment JSON, audit run, registered artifacts, profile outcomes, or claim guard.
どちらを選んでもassessment JSON、audit run、登録artifact、profile outcome、claim guardは変更されません。

## Summary and full / 要約と完全版

### Summary

```powershell
accessibility-audit report --input .\audit-runs\example\assessment.json --detail summary --visibility internal --output .\audit-runs\example\summary.md
```

The summary puts the following before the large untested set:
要約では、大量の未確認項目より先に次を表示します。

- overall judgement, evidence level, and claim boundary / 総合判定、証拠レベル、主張可能範囲
- verified failures and actionable screening candidates / 確認済みの不適合と対応が必要なscreening候補
- every externally human-reviewed requirement, including pass results / passを含む外部人手確認済みの全条項
- next checks and remaining not-run count / 次の確認と未実施件数
- profile-group and provenance counts / profile区分別・証拠由来別件数
- scope and limitations / 対象範囲と制約

A summary never changes or deletes rows in the machine-readable assessment. It only omits the bulk not-run table from that human-readable view.
要約は機械可読assessmentの行を変更・削除しません。人向け表示から大量の未実施行tableを省くものです。

### Full

```powershell
accessibility-audit report --input .\audit-runs\example\assessment.json --detail full --visibility internal --output .\audit-runs\example\full.md
```

A full `web-modern` report accounts for all 55 requirements. A full `jp-public-web` report accounts for all 56 requirements and separates JIS 38 from the 18 additional WCAG requirements.
完全版の`web-modern`は55件すべて、`jp-public-web`はJIS 38件と追加WCAG 18件を分離した56件すべてを表示します。

### Summary with a full appendix / 要約と完全版付録

```powershell
accessibility-audit report --input .\audit-runs\example\assessment.json --detail summary --visibility internal --output .\audit-runs\example\summary.md --appendix .\audit-runs\example\full-appendix.md
```

All requested output paths are checked before the first write. Existing files are never overwritten.
最初の書込み前にすべての出力先を確認し、既存ファイルは上書きしません。

## Internal reports / 内部用レポート

`--visibility internal` is the default. It preserves the audit data needed for diagnosis, including reviewer identity and target-specific evidence when present.
`--visibility internal`が既定です。確認者情報や対象固有の証拠を含め、診断に必要な監査情報を保持します。

Internal reports explicitly state that they may contain unsanitized data and are not publication-ready. Do not publish them without a separate review.
内部用レポートには、未伏字情報を含む可能性があり公開用ではないことを明示します。別途確認せず公開しないでください。

## Public reports / 公開向けレポート

Public output requires an explicit reviewer disclosure decision and a separate internal redaction manifest.
公開向け出力では、確認者名の公開方針と、内部確認用のredaction manifestを明示的に指定します。

```powershell
accessibility-audit report --input .\audit-runs\example\assessment.json --detail summary --visibility public --reviewer-disclosure redact --redaction-manifest .\audit-runs\example\redactions.json --output .\audit-runs\example\public-summary.md --appendix .\audit-runs\example\public-full.md
```

`--reviewer-disclosure` accepts:

- `include`: keep the reviewer field after the normal public sanitizer / 通常のpublic sanitizer適用後も確認者欄を残す
- `redact`: remove the reviewer identity from the public presentation / 公開用表示から確認者の本人情報を伏せる

The same policy is used for standalone and run-backed reports. Public processing covers target metadata, scope, environment, criterion rationale, findings, remediation prose, limitations, and other nested human-readable evidence.
standaloneとrun-backedで同じpolicyを使います。対象情報、scope、environment、条項根拠、finding、改善内容、limitationsなど、入れ子になった人向け証拠も対象です。

The policy removes or canonicalizes candidates such as:

- local paths, UNC paths, and `file:` URLs / local path、UNC、`file:` URL
- private, loopback, link-local, reserved, and single-label hosts / private・loopback・reserved host
- URL userinfo, query, and fragment / URLのuserinfo・query・fragment
- credential-like tokens and authorization values / credential・authorization候補
- email addresses and telephone-number candidates / email・電話番号候補
- reviewer identity when `redact` is selected / `redact`指定時の確認者情報

Safe public URL origins and paths are retained when userinfo, query, and fragment can be removed without hiding the whole reference.
userinfo、query、fragmentだけを除去できる場合は、安全な公開URLのoriginとpathを残します。

## Redaction manifest / 伏字記録

The manifest records only where a transformation occurred, why, and which action was used.
manifestには、どこを、なぜ、どう処理したかだけを記録します。

```json
{
  "schema_version": "1.0.0",
  "visibility": "public",
  "reviewer_disclosure": "redact",
  "publication_review_required": true,
  "redactions": [
    {
      "path": "target.urls_or_files[0]",
      "reason": "url_query_removed",
      "action": "canonicalized"
    }
  ]
}
```

Removed values, hashes derived from removed secrets, and reconstructable excerpts are not copied into the manifest.
削除した値、秘密情報から作ったhash、復元可能な抜粋はmanifestへ複製しません。

## Publication review remains required / 公開前確認は必須

Automated redaction cannot identify every personal, confidential, contractual, or context-sensitive detail. A public report always carries a warning that human publication review is required.
自動伏字だけですべての個人情報、機密情報、契約上の情報、文脈依存情報を検出することはできません。公開向けレポートには、人による公開前確認が必要であることを必ず表示します。

The redaction manifest is an internal review aid. It is not a declaration that the report contains no sensitive information.
redaction manifestは内部確認を助ける記録であり、レポートに機微情報が残っていないことの保証ではありません。
