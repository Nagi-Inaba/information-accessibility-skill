# Report formats and accessibility / レポート形式とアクセシビリティ

This guide defines the supported human-readable report formats, their publication boundaries, and the checks applied to generated reports.
このガイドは、人向けレポートの対応形式、公開境界、生成物そのものに対して行う検証を定義します。

## 1. Canonical data and output formats / 正本データと出力形式

The validated assessment and its sanitized presentation model are the canonical report data. Markdown and HTML are sibling projections from that same model.
検証済みassessmentとsanitization後のpresentation modelがレポートデータの正本です。MarkdownとHTMLは同じmodelから生成する並列の表示形式です。

| Format / 形式 | Command / コマンド | Supported purpose / 対応用途 | Boundary / 境界 |
| --- | --- | --- | --- |
| Markdown | `--format markdown` | Editing, version control, review, and downstream conversion / 編集、差分管理、レビュー、後工程への受渡し | Default format. Final accessibility depends on the renderer used to display or convert it / 既定形式。最終的なアクセシビリティは表示・変換先にも依存 |
| HTML | `--format html` | Supported distribution format for direct browser reading / ブラウザーで直接読むための正式な配布形式 | Includes semantic structure and is tested as described below / セマンティック構造を持ち、後述の検証対象 |
| PDF | Not available / 利用不可 | None / なし | PDF is unsupported because the package does not yet provide a verified tagged-PDF and reading-order path / タグ付きPDFと読み順を検証できる経路がないためサポート対象外 |

Markdown remains the default when `--format` is omitted.
`--format`を省略した場合はMarkdownが既定です。

## 2. Detail and appendix modes / 詳細度と付録

```sh
accessibility-audit report --input assessment.json --format markdown --detail summary --output summary.md
accessibility-audit report --input assessment.json --format markdown --detail full --output full.md
accessibility-audit report --input assessment.json --format html --detail summary --appendix full.html --output summary.html
```

- `--detail summary` prioritizes the judgement boundary, key barriers, high-priority follow-up, group counts, provenance, and claim limitations.
- `--detail full` includes every registered profile requirement exactly once in a result table or a reasoned not-applicable section.
- `--appendix` is available only with `--detail summary` and writes a complete report in the same selected format.
- The report, appendix, and redaction manifest are preflighted as distinct new paths. Existing files are not overwritten.

- `--detail summary`は、判定境界、主要な障壁、優先度の高い追加対応、group別件数、provenance、claim制限を先に示します。
- `--detail full`は、対象profileの全条項を結果表または理由付き適用対象外sectionへ一度ずつ表示します。
- `--appendix`は`--detail summary`でのみ利用でき、同じ形式の完全版を別ファイルへ出力します。
- レポート、付録、redaction manifestは別々の新規pathとして事前検証され、既存ファイルを上書きしません。

## 3. Public and internal visibility / 公開用と内部用

```sh
accessibility-audit report --input assessment.json --visibility internal --output internal.md
accessibility-audit report --input assessment.json --visibility public --reviewer-disclosure redact --redaction-manifest redactions.json --output public.md
```

`--visibility internal` preserves internal target metadata and is not publication-ready.
`--visibility internal`は内部のtarget metadataを保持するため、公開用ではありません。

`--visibility public` applies the same sanitizer to standalone and run-backed reports, and to Markdown and HTML. It handles local paths, private or reserved network identifiers, URL user information, query strings, fragments, credential-like values, common personal-data candidates, and reviewer disclosure. A machine-readable redaction manifest records the field and reason without copying the removed secret value.
`--visibility public`は、standalone／run-backedおよびMarkdown／HTMLで共通のsanitizerを使います。local path、private／reserved network identifier、URL userinfo、query、fragment、credential候補、一般的な個人情報候補、reviewerの公開可否を処理します。machine-readableなredaction manifestには、削除値そのものを複製せずfieldと理由を記録します。

Automated redaction is not publication approval. Human publication review remains required.
自動伏字は公開承認ではありません。公開前の人による確認が必要です。

## 4. HTML semantics / HTMLのセマンティクス

Generated HTML includes:
生成HTMLには次を含みます。

- a locale-correct `lang` attribute and document title
- one `h1`, logical section headings, and `header`, `nav`, `main`, and `footer` landmarks
- a skip link to the focusable main region and a report table of contents
- named, keyboard-focusable regions around long tables
- table `caption`, column headers, and row headers using `scope`
- descriptive primary-source links
- textual judgement, evidence provenance, evidence level, and priority rather than color-only encoding
- visible keyboard focus, forced-colors support, reduced-motion handling, mobile reflow, and a print stylesheet
- HTML escaping for all assessment and artifact prose

- localeに対応した`lang`属性とdocument title
- 1つの`h1`、論理的なsection heading、`header`、`nav`、`main`、`footer` landmark
- focus可能なmain regionへのskip linkとレポート内目次
- 長大tableを囲む名称付き・keyboard focus可能なregion
- `caption`、列header、`scope`付き行header
- 意味の分かる一次資料link
- 色だけに依存しない判定、証拠の出所、証拠レベル、priority表示
- visible focus、forced-colors、reduced motion、mobile reflow、print stylesheet
- assessmentおよびartifact由来proseのHTML escaping

## 5. Automated and browser verification / 自動検証とブラウザー検証

The standard test suite verifies the HTML contract, 55/56-row completeness, locale, group separation, privacy parity, output atomicity, unique IDs, and injection resistance.
通常のtest suiteは、HTML契約、55／56行の完全性、locale、group分離、privacy parity、output atomicity、unique ID、injection耐性を検証します。

`.github/workflows/report-accessibility-e2e.yml` runs the generated Japanese and English fixture reports in Chromium with pinned Playwright and axe-core versions. It verifies:
`.github/workflows/report-accessibility-e2e.yml`は、固定版Playwrightとaxe-coreを使い、生成した日本語・英語fixtureをChromiumで検証します。

- axe-core checks for the generated report
- table-of-contents targets and skip-link behavior
- keyboard traversal to report links and long-table regions
- whole-document reflow at a 320-pixel viewport while retaining table-region scrolling
- visibility of principal content under print media

- 生成レポートに対するaxe-core検査
- 目次linkの参照先とskip link動作
- report linkおよび長大table regionへのkeyboard traversal
- 320px viewportでdocument全体に横overflowを生じさせず、table region内のscrollを維持すること
- print mediaで主要内容が表示されること

The workflow uploads a machine-readable browser evidence record.
workflowはmachine-readableなbrowser evidence recordをartifactとして保存します。

## 6. NVDA smoke test / NVDA smoke test

`.github/workflows/report-nvda-smoke.yml` performs a bounded smoke test on Windows with Microsoft Edge and the official NVDA 2026.1.1 stable build. The workflow verifies the published installer SHA-256 before creating a portable copy.
`.github/workflows/report-nvda-smoke.yml`は、Windows、Microsoft Edge、公式stable版NVDA 2026.1.1を使った限定的なsmoke testを行います。portable copyを作る前に公開済みinstaller SHA-256を照合します。

The workflow opens a fixed generated English HTML report and sends real navigation gestures for the skip link, headings, a table, and a link. It passes only when NVDA's own IO log contains `Speaking [...]` entries that match the report title, a principal heading, and the long criteria table. It stores:
workflowは固定された生成済み英語HTMLレポートを開き、skip link、heading、table、linkへ実際のnavigation gestureを送ります。NVDA自身のIO logに、report title、主要heading、長大なcriteria tableへ対応する`Speaking [...]` entryがある場合だけpassします。次を保存します。

- the generated report
- `nvda.log`
- `nvda-smoke-record.json`, including the installer hash, report hash, gestures, speech-entry count, matched regions, log hash, and limitations

- 生成レポート
- `nvda.log`
- installer hash、report hash、gesture、speech entry件数、matched region、log hash、制限を含む`nvda-smoke-record.json`

This is a bounded smoke test, not a complete screen-reader usability study, independent audit, or formal conformance assessment. It does not evaluate audio quality, every section, every interaction state, or the experience of actual users with disabilities.
これは限定的なsmoke testであり、完全なscreen-reader usability study、独立監査、正式な適合性評価ではありません。音声品質、全section、全interaction state、障害当事者の実際の利用体験を評価するものではありません。

## 7. What remains external / 外部確認として残るもの

- Task-specific usability testing by people who use relevant assistive technologies
- Publication review for sensitive information and redaction quality
- Verification in the actual distribution environment, including a CMS, document portal, or downstream conversion
- Tagged PDF, reading order, and link verification before any future PDF support can be claimed

- 関連する支援技術を利用する人によるtask-specificな利用テスト
- 機微情報と伏字品質の公開前review
- CMS、document portal、後工程の変換を含む実際の配布環境での確認
- 将来PDF対応を表明する前に必要となるtag、reading order、linkの検証
