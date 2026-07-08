# Information Accessibility Skill and Agent

情報アクセシビリティのレビューと設計に使う、Codex / Claude 向けのスキル、エージェントです。

Webサイト、アプリ、文書、スライド、動画、イベント案内、会議運営、コミュニティ導線などを対象に、「情報があるか」だけでなく、必要な人が見つけられるか、受け取れるか、理解できるか、参加できるか、後から確認できるかを確認します。

## 内容

```text
codex/
  skills/information-accessibility-practice/
    agents/openai.yaml
  agents/information-accessibility-reviewer.toml
claude/
  skills/information-accessibility-practice/
  agents/information-accessibility-reviewer.md
```

各 skill には、実行時に読む参照ファイルが入っています。

```text
references/
  development-accessibility.md
  document-slide-accessibility.md
  event-community-accessibility.md
```

## 参照ファイルの内容

`development-accessibility.md` は、Webサイト、アプリ、フォーム、ダッシュボード、UI、開発タスクを見るための参照です。見出し、ラベル、リンク名、キーボード操作、フォーカス順、エラー表示、状態変化、表やグラフ、フォーム入力、モバイル表示などを確認します。

`document-slide-accessibility.md` は、PDF、Word文書、レポート、スライド、配布資料、告知画像を見るための参照です。見出し構造、読み上げ順、リンク名、表、画像説明、図表の要約、PDF化後のテキスト抽出、スライドの読み順、告知画像に日時や場所が閉じ込められていないかなどを確認します。

`event-community-accessibility.md` は、イベント、会議、セミナー、コミュニティ導線、支援依頼フローを見るための参照です。事前案内、会場導線、オンライン参加、支援依頼、字幕、文字起こし、手話通訳、マイク運用、チャット/Q&A、資料共有、事後の要約・記録・次の行動を確認します。

スキル本体は、対象に応じて必要な参照ファイルを選び、具体的な確認項目として使います。

## 使い方

Codex で使う場合:

1. `codex/skills/information-accessibility-practice/` を Codex の `skills/` 配下に配置する。
2. `codex/agents/information-accessibility-reviewer.toml` を Codex の `agents/` 配下に配置する。
3. 情報アクセシビリティを確認したい資料、Webページ、UI、イベント案内などに対して `information-accessibility-practice` を使う。

Claude で使う場合:

1. `claude/skills/information-accessibility-practice/` を Claude の `skills/` 配下に配置する。
2. `claude/agents/information-accessibility-reviewer.md` を Claude の `agents/` 配下に配置する。
3. 情報アクセシビリティを確認したい対象に対して `information-accessibility-reviewer` を使う。

## できること

- Webサイト、アプリ、フォーム、ダッシュボードで、見出し、ラベル、リンク名、キーボード操作、フォーカス順、エラー表示、状態変化、表やグラフの読み取りやすさを確認する。
- PDF、Word文書、スライド、配布資料で、見出し構造、読み上げ順、リンク名、表、画像説明、図表の要約、PDF化後のテキスト抽出や読み順を確認する。
- 告知画像、SNS投稿、チラシ、イベントページで、日時、場所、参加条件、変更時の確認先、申込方法、支援依頼先が画像だけに閉じていないか確認する。
- 動画、音声、アーカイブで、字幕、文字起こし、要約、資料リンク、公開場所、後から見返す導線を確認する。
- イベント、会議、セミナーで、会場案内、オンライン参加、マイク運用、チャット/Q&A、字幕、手話通訳、資料共有、記録公開、問い合わせ導線を確認する。
- コミュニティ参加者向け導線で、初参加者が必要な場所、予定、資料、役割、相談先、次の行動を迷わず見つけられるか確認する。
- 支援依頼フローで、依頼方法、締切、対応範囲、担当者への引き継ぎ、プライバシーの扱い、当日の運用を確認する。
- 法令、会場、契約、個人情報、公開範囲など、実装前に確認が必要な制約を整理する。

## 確認する観点

レビューでは主に次の5点を見ます。

1. **Find**: 必要な人が情報を見つけられるか。
2. **Receive**: 視覚、音声、テキスト、支援技術、アーカイブなど複数の方法で受け取れるか。
3. **Understand**: 構造、順序、言葉、日付、リンク、色、図表、専門用語が理解しやすいか。
4. **Participate**: 質問、申込、支援依頼、当日の参加、次の行動ができるか。
5. **Continue**: 後から要約、資料、記録、決定事項、次の行動を確認できるか。

## 依頼例

```text
このイベント告知ページを、情報アクセシビリティの観点でレビューしてください。
```

```text
このスライドをPDFで共有する前提で、読み上げ順、図表説明、リンク、後から見返す導線を確認してください。
```

```text
この申込フォームについて、ラベル、エラー表示、支援依頼欄、送信後の案内に問題がないか確認してください。
```

```text
この会議運営案について、字幕、マイク運用、質問方法、資料共有、アーカイブ公開の観点で不足を出してください。
```

## 出力例

レビュー結果は、必要に応じて次のような形で返します。

```markdown
## Accessibility Review

| Priority | Issue | Who is affected | Fix | Verification |
| --- | --- | --- | --- | --- |
| P0 |  |  |  |  |
| P1 |  |  |  |  |
| P2 |  |  |  |  |

## Missing Evidence

- Not checked:
- Needs confirmation:
```

## License

MIT Licenseです。個人・商用を問わず、利用、改変、再配布できます。
