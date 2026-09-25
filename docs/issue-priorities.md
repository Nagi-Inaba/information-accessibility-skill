# Issueの優先順位と進捗

2026-09-25確認。PR [#161](https://github.com/Nagi-Inaba/information-accessibility-skill/pull/161)はマージ済み。Ubuntu／Windows・Node.js 20／22の検証、実Chromeの証拠・レポート経路、NVDAレポートsmokeは成功した。個別Issueの受け入れ条件と統合後の実装を照合し、対応済み35件を完了にした。

## 残る優先順

| 優先 | Issue | 状態と次の作業 |
| --- | --- | --- |
| P1 | [#35 公開プロジェクトの保守・リリース導線](https://github.com/Nagi-Inaba/information-accessibility-skill/issues/35) | SECURITY、CONTRIBUTING、CHANGELOG、Issue/PRテンプレート、対応版、release候補の生成手順は整備済み。Private vulnerability reportingは無効、Aboutのtopics・homepageは空で、公開Releaseもない。非公開報告先と公開設定・配布物を確定してから完了判定する。公開候補は最終main commitで再生成する。 |
| 整理 | [#144 Backlog整理](https://github.com/Nagi-Inaba/information-accessibility-skill/issues/144) | 親Issue。本文に古い進捗が残るため、個別Issueと本表で現在状態を確認する。#35完了後に整理する。 |

## 完了した実装トラック

- 先行・P1: #56、#40、#44、#39、#25、#54、#65、#13、#63、#64、#57、#58、#50。
- P2: #16、#17、#31、#42、#55、#43、#41、#60、#48、#49、#59、#53、#33、#28、#26、#27。
- P3: #14、#32、#30、#66、#51、#46。#46の初回監視はデジタル庁ページと旧カタログのsource hash差を検出した。公式ページの対象範囲と追加18条項を確認し、条項・routingの差がないことを候補diffで確認して出典メタデータを更新した。正本へ自動上書きする運用にはしていない。

## 確認済みの境界

- 旧audit-runは保存済みresourceとhashを照合して読取り・再レポートする。自動移行、旧runへの追記、署名の付け替えは行わない。
- 非Web記録は参加観点の人手記録であり、WCAG／JIS適合判定ではない。ATAGは参照ガイダンスに限定する。実対象の人手評価、支援技術の実機確認、macOSでの導入実機確認は別途必要。
- 公開ReleaseとGitHub設定は未実施。配布候補とCIの成功を公開完了とは扱わない。
