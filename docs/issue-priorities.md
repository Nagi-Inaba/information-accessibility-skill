# Issueの優先順位と進捗

2026-09-25確認。PR [#161](https://github.com/Nagi-Inaba/information-accessibility-skill/pull/161)と[#162](https://github.com/Nagi-Inaba/information-accessibility-skill/pull/162)はマージ済み。Ubuntu／Windows・Node.js 20／22の検証、実Chromeの証拠・レポート経路、NVDAレポートsmokeは成功した。個別Issueの受け入れ条件と統合後の実装を照合し、対応済み35件を完了にした。[v0.1.0プレリリース](https://github.com/Nagi-Inaba/information-accessibility-skill/releases/tag/v0.1.0)のtag・4添付ファイル・hash、非公開脆弱性報告とAbout設定も確認した。

## 残る優先順

この実装トラックの未完了Issueはありません。[#35](https://github.com/Nagi-Inaba/information-accessibility-skill/issues/35)の公開導線と、整理用の親Issue [#144](https://github.com/Nagi-Inaba/information-accessibility-skill/issues/144)も完了しました。親Issueの本文は当初の計画時点の記録です。

## 完了した実装トラック

- 先行・P1: #56、#40、#44、#39、#25、#54、#65、#13、#63、#64、#57、#58、#50。
- P2: #16、#17、#31、#42、#55、#43、#41、#60、#48、#49、#59、#53、#33、#28、#26、#27。
- P3: #14、#32、#30、#66、#51、#46。#46の初回監視はデジタル庁ページと旧カタログのsource hash差を検出した。公式ページの対象範囲と追加18条項を確認し、条項・routingの差がないことを候補diffで確認して出典メタデータを更新した。正本へ自動上書きする運用にはしていない。

## 確認済みの境界

- 旧audit-runは保存済みresourceとhashを照合して読取り・再レポートする。自動移行、旧runへの追記、署名の付け替えは行わない。
- 非Web記録は参加観点の人手記録であり、WCAG／JIS適合判定ではない。ATAGは参照ガイダンスに限定する。実対象の人手評価、支援技術の実機確認、macOSでの導入実機確認は別途必要。
- v0.1.0はプレリリースです。配布物のhash確認は出所の署名やアクセシビリティ適合の認証ではありません。
