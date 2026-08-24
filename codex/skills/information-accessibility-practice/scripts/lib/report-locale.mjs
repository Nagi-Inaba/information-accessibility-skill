const messages = {
  ja: {
    reportTitles: {
      "web-modern": "WCAG 2.2 A/AA 監査レポート",
      "jp-public-web": "JIS X 8341-3:2016＋追加WCAG A/AA 監査レポート"
    },
    groupLabels: {
      wcag_2_2: "WCAG 2.2 A/AA",
      jis_x_8341_3_2016: "JIS X 8341-3:2016 A/AA",
      jp_wcag_2_2_additional: "追加WCAG 2.1/2.2 A/AA"
    },
    outcomes: {
      pass: "適合",
      fail: "不適合",
      not_applicable: "適用対象外",
      not_tested: "未確認",
      cant_tell: "要確認"
    },
    sources: {
      human_review: "外部人手レビュー",
      screening: "AI／自動スクリーニング",
      not_run: "未実施"
    },
    evidenceLevels: {
      E0: "E0",
      E1: "E1",
      E2: "E2",
      E3: "E3",
      E4: "E4",
      E5: "E5"
    },
    headings: {
      summary: "判定の概要",
      legend: "判定の出所",
      claim: "主張可能な範囲",
      target: "検査対象",
      findings: "指摘事項と改善",
      scope: "対象範囲と検査環境",
      coverage: "記録の範囲",
      limitations: "制約と残る確認事項"
    },
    fields: {
      criterion: "達成基準",
      title: "名称",
      level: "レベル",
      group: "区分",
      outcome: "判定",
      source: "判定の出所",
      evidence: "証拠レベル",
      primarySource: "一次資料",
      rationale: "根拠・未確認事項",
      result: "結果",
      count: "件数",
      target: "対象",
      version: "版・コミット",
      references: "URL・ファイル",
      profile: "適用プロファイル",
      date: "確認日",
      evaluator: "確認者",
      included: "含む範囲",
      excluded: "除外した範囲",
      processes: "一連の利用手順",
      thirdParty: "第三者コンテンツ",
      fullPages: "ページ全体を確認",
      os: "OS",
      browsers: "ブラウザー・表示環境",
      assistiveTechnologies: "支援技術",
      inputModes: "入力方法",
      requestedTier: "要求されたtier",
      maximumTier: "検証上限tier",
      fixedWording: "使用可能な固定表現",
      humanCoverage: "人による確認済み",
      catalogCoverage: "登録済み達成基準",
      evidenceLevel: "記録全体の証拠レベル"
    },
    text: {
      reportNotice: "このレポートの判定語は、記録された対象・範囲・環境・証拠に限って改善判断を支援するものです。第三者認証、法的判断、または組織による正式な適合表明ではありません。",
      screeningLegend: "スクリーニングによる表示はreport-only judgementであり、profile outcomeではありません。外部人手レビューだけが対象固有の手順と証拠に基づくprofile outcomeを記録できます。",
      formalBoundary: "この表示は正式な適合表明ではありません。",
      noEvidence: "この検査では確認していません。",
      noRecord: "記録なし",
      yes: "はい",
      no: "いいえ",
      noFindings: "指摘事項の記録はありません。",
      noLimitations: "制約の記録はありません。",
      requestedReasonNone: "人による条項確認は記録されていません。",
      requestedReasonPartial: "一部の条項だけが人により確認されており、全条項の評価ではありません。",
      blockerPrefix: "未解消のprofile outcome",
      missingPrefix: "未登録のprofile条項",
      judgementLabel: "総合判定",
      profileCountLabel: "プロファイル全体",
      parsingNote: "4.1.1「構文解析」はJIS X 8341-3:2016の対象に残りますが、WCAG 2.2では削除されています。",
      provenanceHuman: "対象固有の手順と証拠を伴う外部人手レビュー。",
      provenanceScreening: "AIまたは自動検査による限定的なE0／E1スクリーニング。profile outcomeではありません。",
      provenanceNotRun: "対象固有の確認がまだ記録されていません。"
    }
  },
  en: {
    reportTitles: {
      "web-modern": "WCAG 2.2 A/AA Audit Report",
      "jp-public-web": "JIS X 8341-3:2016 + Additional WCAG A/AA Audit Report"
    },
    groupLabels: {
      wcag_2_2: "WCAG 2.2 A/AA",
      jis_x_8341_3_2016: "JIS X 8341-3:2016 A/AA",
      jp_wcag_2_2_additional: "Additional WCAG 2.1/2.2 A/AA"
    },
    outcomes: {
      pass: "Pass",
      fail: "Fail",
      not_applicable: "Not applicable",
      not_tested: "Not tested",
      cant_tell: "Cannot tell"
    },
    sources: {
      human_review: "External human review",
      screening: "AI/automated screening",
      not_run: "Not run"
    },
    evidenceLevels: {
      E0: "E0",
      E1: "E1",
      E2: "E2",
      E3: "E3",
      E4: "E4",
      E5: "E5"
    },
    headings: {
      summary: "Judgement summary",
      legend: "Evidence provenance",
      claim: "Claim boundary",
      target: "Audit target",
      findings: "Findings and remediation",
      scope: "Scope and environment",
      coverage: "Record coverage",
      limitations: "Limitations and remaining checks"
    },
    fields: {
      criterion: "Criterion",
      title: "Title",
      level: "Level",
      group: "Group",
      outcome: "Judgement",
      source: "Evidence source",
      evidence: "Evidence level",
      primarySource: "Primary source",
      rationale: "Rationale or missing check",
      result: "Result",
      count: "Count",
      target: "Target",
      version: "Version or commit",
      references: "URLs or files",
      profile: "Profile",
      date: "Reviewed on",
      evaluator: "Evaluator",
      included: "Included scope",
      excluded: "Excluded scope",
      processes: "Complete processes",
      thirdParty: "Third-party content",
      fullPages: "Full pages reviewed",
      os: "OS",
      browsers: "Browsers and display environments",
      assistiveTechnologies: "Assistive technologies",
      inputModes: "Input modes",
      requestedTier: "Requested tier",
      maximumTier: "Validator maximum tier",
      fixedWording: "Registered fixed wording",
      humanCoverage: "Human-reviewed requirements",
      catalogCoverage: "Recorded profile requirements",
      evidenceLevel: "Overall evidence level"
    },
    text: {
      reportNotice: "The judgement terms in this report support improvement decisions only for the recorded target, scope, environment, and evidence. They are not third-party certification, a legal determination, or an organization's formal conformance declaration.",
      screeningLegend: "A screening projection is a report-only judgement, not a machine-readable profile outcome. Only external human review using target-specific procedures and evidence can record a profile outcome.",
      formalBoundary: "This report is not a formal conformance declaration.",
      noEvidence: "This requirement was not checked in this audit.",
      noRecord: "Not recorded",
      yes: "yes",
      no: "no",
      noFindings: "No findings were recorded.",
      noLimitations: "No limitations were recorded.",
      requestedReasonNone: "No human criterion review is recorded.",
      requestedReasonPartial: "Only a subset of requirements was reviewed by a person; this is not a complete evaluation.",
      blockerPrefix: "Unresolved profile outcomes",
      missingPrefix: "Missing profile requirements",
      judgementLabel: "Overall judgement",
      profileCountLabel: "Entire profile",
      parsingNote: "4.1.1 Parsing is retained by JIS X 8341-3:2016 but was removed from WCAG 2.2.",
      provenanceHuman: "External human review with a target-specific procedure and evidence.",
      provenanceScreening: "Limited E0/E1 screening produced by AI or an automated tool; it is not a profile outcome.",
      provenanceNotRun: "No target-specific check has been recorded."
    }
  }
};

export function normalizeReportLocale(locale = "ja") {
  if (!Object.hasOwn(messages, locale)) throw new Error("--locale must be ja or en");
  return locale;
}

export function reportMessages(locale = "ja") {
  return messages[normalizeReportLocale(locale)];
}

export function localizedReportTitle(profileId, locale = "ja") {
  const selected = reportMessages(locale).reportTitles[profileId];
  if (!selected) throw new Error(`No report title is registered for profile ${profileId}.`);
  return selected;
}

export function localizedGroupLabel(groupId, locale = "ja") {
  return reportMessages(locale).groupLabels[groupId] ?? groupId;
}

function containsJapanese(value) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(String(value ?? ""));
}

export function fixedClaimWording(registry, tier, locale = "ja") {
  const templates = registry?.claim_templates?.[tier];
  if (!Array.isArray(templates) || templates.length === 0) {
    throw new Error(`No registered claim template is available for tier ${String(tier)}.`);
  }
  const normalized = normalizeReportLocale(locale);
  const selected = templates.find((template) => normalized === "ja" ? containsJapanese(template) : !containsJapanese(template));
  if (!selected) throw new Error(`No ${normalized} claim template is registered for tier ${tier}.`);
  return selected;
}
