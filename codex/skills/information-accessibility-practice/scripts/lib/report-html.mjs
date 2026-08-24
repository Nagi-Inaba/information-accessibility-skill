const outcomeKeys = ["pass", "fail", "not_applicable", "not_tested", "cant_tell"];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/\r\n|[\r\n]/gu, " ");
}

function slug(value) {
  const normalized = String(value ?? "section")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || "section";
}

function outcomeToken(value) {
  return String(value ?? "unknown").replace(/_/gu, "-");
}

function list(values, emptyText) {
  if (!Array.isArray(values) || values.length === 0) return escapeHtml(emptyText);
  return escapeHtml(values.join(", "));
}

function localeText(locale) {
  if (locale === "ja") {
    return {
      skip: "本文へ移動",
      navigation: "レポート内目次",
      contents: "目次",
      summary: "要約",
      overview: "判定の概要",
      overall: "総合判定",
      profileCount: "プロファイル全体",
      keyFindings: "主要な問題と次の行動",
      humanReviewed: "人手確認済みの達成基準",
      noActionable: "主要な問題候補または確認済みの不適合は記録されていません。",
      groups: "プロファイル区分別件数",
      provenance: "証拠の出所別件数",
      legend: "判定の出所",
      claim: "主張可能な範囲",
      target: "検査対象",
      findings: "指摘事項と改善",
      criteria: "達成基準別結果",
      scope: "対象範囲と検査環境",
      coverage: "記録の範囲",
      limitations: "制約と残る確認事項",
      appendix: "完全版付録",
      appendixLink: "完全版レポート付録を開く",
      tableScroll: "狭い画面では、この表領域内を横方向にスクロールできます。",
      primarySource: "一次資料",
      result: "結果",
      count: "件数",
      criterion: "達成基準",
      title: "名称",
      level: "レベル",
      group: "区分",
      outcome: "判定",
      source: "判定の出所",
      evidence: "証拠レベル",
      rationale: "根拠・未確認事項",
      priority: "優先度",
      issue: "問題",
      change: "改善案",
      verification: "再確認方法",
      location: "箇所",
      requestedTier: "要求されたtier",
      maximumTier: "検証上限tier",
      fixedWording: "使用可能な固定表現",
      reasons: "制限理由",
      targetName: "対象",
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
      assistive: "支援技術",
      inputModes: "入力方法",
      yes: "はい",
      no: "いいえ",
      noRecord: "記録なし",
      noFindings: "指摘事項の記録はありません。",
      noLimitations: "制約の記録はありません。",
      formatBoundary: "Markdownは編集・差分管理向け、HTMLは配布向けです。PDFはタグと読み順を検証できる正式経路がないためサポート対象外です。",
      parsingTitle: "4.1.1 構文解析",
      parsingNote: "JIS X 8341-3:2016の対象に残りますが、WCAG 2.2では削除されています。"
    };
  }
  return {
    skip: "Skip to main content",
    navigation: "Report contents",
    contents: "Contents",
    summary: "Summary",
    overview: "Judgement summary",
    overall: "Overall judgement",
    profileCount: "Entire profile",
    keyFindings: "Key findings and next actions",
    humanReviewed: "Human-reviewed requirements",
    noActionable: "No verified failure or actionable screening candidate is recorded.",
    groups: "Profile group counts",
    provenance: "Evidence provenance counts",
    legend: "Evidence provenance",
    claim: "Claim boundary",
    target: "Audit target",
    findings: "Findings and remediation",
    criteria: "Requirement results",
    scope: "Scope and environment",
    coverage: "Record coverage",
    limitations: "Limitations and remaining checks",
    appendix: "Complete appendix",
    appendixLink: "Open the complete report appendix",
    tableScroll: "On a narrow screen, scroll horizontally within this named table region.",
    primarySource: "Primary source",
    result: "Result",
    count: "Count",
    criterion: "Criterion",
    title: "Title",
    level: "Level",
    group: "Group",
    outcome: "Judgement",
    source: "Judgement source",
    evidence: "Evidence level",
    rationale: "Rationale or missing check",
    priority: "Priority",
    issue: "Issue",
    change: "Proposed change",
    verification: "Verification",
    location: "Location",
    requestedTier: "Requested tier",
    maximumTier: "Validator maximum tier",
    fixedWording: "Registry-fixed wording",
    reasons: "Limiting reasons",
    targetName: "Target",
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
    assistive: "Assistive technologies",
    inputModes: "Input modes",
    yes: "yes",
    no: "no",
    noRecord: "Not recorded",
    noFindings: "No findings were recorded.",
    noLimitations: "No limitations were recorded.",
    formatBoundary: "Markdown is the editable, diff-friendly format. HTML is the supported distribution format. PDF is unsupported until tagging and reading order can be verified.",
    parsingTitle: "4.1.1 Parsing",
    parsingNote: "It is retained by JIS X 8341-3:2016 but was removed from WCAG 2.2."
  };
}

function css() {
  return `
:root { color-scheme: light dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
* { box-sizing: border-box; }
html, body { max-width: 100%; margin: 0; overflow-x: hidden; }
body { background: Canvas; color: CanvasText; }
a { color: LinkText; text-underline-offset: .18em; }
a:focus-visible, [tabindex="0"]:focus-visible { outline: 3px solid Highlight; outline-offset: 3px; }
.skip-link { position: absolute; inset-inline-start: 1rem; inset-block-start: -8rem; z-index: 100; padding: .75rem 1rem; background: Canvas; color: CanvasText; border: 2px solid CanvasText; }
.skip-link:focus { inset-block-start: 1rem; }
header, nav, main, footer { width: min(100% - 2rem, 82rem); margin-inline: auto; }
header { padding-block: 2rem 1rem; }
nav { padding-block: .5rem 1rem; border-block: 1px solid GrayText; }
main { padding-block: 1rem 3rem; }
footer { padding-block: 1.5rem 3rem; border-block-start: 1px solid GrayText; }
section { margin-block: 2rem; scroll-margin-block-start: 1rem; }
article { border-inline-start: .35rem solid GrayText; padding-inline-start: 1rem; margin-block: 1rem; }
h1, h2, h3 { line-height: 1.2; }
dl.meta { display: grid; grid-template-columns: minmax(10rem, 18rem) 1fr; gap: .35rem 1rem; }
dt { font-weight: 700; }
dd { margin: 0; overflow-wrap: anywhere; }
.notice { padding: 1rem; border: 2px solid GrayText; }
.table-region { max-width: 100%; overflow-x: auto; padding-block-end: .35rem; }
table { min-width: 58rem; width: 100%; border-collapse: collapse; }
caption { text-align: start; font-weight: 700; padding-block: .5rem; }
th, td { border: 1px solid GrayText; padding: .55rem; text-align: start; vertical-align: top; overflow-wrap: anywhere; }
thead th { position: sticky; inset-block-start: 0; background: Canvas; }
.status { font-weight: 700; }
.visually-hidden { position: absolute !important; inline-size: 1px !important; block-size: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
@media (max-width: 42rem) { header, nav, main, footer { width: min(100% - 1rem, 82rem); } dl.meta { grid-template-columns: 1fr; } table { min-width: 52rem; } }
@media (forced-colors: active) { .notice, article, th, td { border-color: CanvasText; } a:focus-visible, [tabindex="0"]:focus-visible { outline-color: Highlight; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; } }
@media print { .skip-link, nav { display: none !important; } header, main, footer { width: 100%; } .table-region { overflow: visible; } table { min-width: 0; break-inside: auto; } thead { display: table-header-group; } tr { break-inside: avoid; } a[href]::after { content: " (" attr(href) ")"; font-size: .85em; } }
`.trim();
}

function tableRegion({ id, caption, headers, rows, text }) {
  if (rows.length === 0) return `<p>${escapeHtml(text.noRecord)}</p>`;
  const captionId = `${id}-caption`;
  return [
    `<div class="table-region" role="region" aria-labelledby="${escapeAttribute(captionId)}" tabindex="0">`,
    "<table>",
    `<caption id="${escapeAttribute(captionId)}">${escapeHtml(caption)}<span class="visually-hidden"> ${escapeHtml(text.tableScroll)}</span></caption>`,
    `<thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead>`,
    `<tbody>${rows.join("")}</tbody>`,
    "</table>",
    "</div>"
  ].join("\n");
}

function countsTable(presentation, text) {
  const counts = presentation.counts ?? presentation.outcome_counts ?? {};
  const rows = outcomeKeys.map((key) => `<tr><th scope="row">${escapeHtml(presentation.messages.outcomes[key] ?? key)}</th><td>${escapeHtml(counts[key] ?? 0)}</td></tr>`);
  return tableRegion({
    id: "outcome-counts",
    caption: text.overview,
    headers: [text.result, text.count],
    rows,
    text
  });
}

function groupCountsTable(presentation, text) {
  const rows = (presentation.groups ?? []).map((group) => `<tr><th scope="row">${escapeHtml(`${group.label} (${group.expected_count})`)}</th>${outcomeKeys.map((key) => `<td>${escapeHtml(group.counts?.[key] ?? 0)}</td>`).join("")}</tr>`);
  return tableRegion({
    id: "group-counts",
    caption: text.groups,
    headers: [text.group, ...outcomeKeys.map((key) => presentation.messages.outcomes[key] ?? key)],
    rows,
    text
  });
}

function provenanceCounts(presentation) {
  const counts = { human_review: 0, screening: 0, not_run: 0 };
  for (const row of presentation.rows ?? []) {
    if (Object.hasOwn(counts, row.source_kind)) counts[row.source_kind] += 1;
  }
  return counts;
}

function definitionList(items) {
  return `<dl class="meta">${items.map(([term, value]) => `<dt>${escapeHtml(term)}</dt><dd>${value}</dd>`).join("")}</dl>`;
}

function criterionTable(group, presentation, text) {
  const rows = group.rows.map((row) => {
    const source = /^https?:\/\//u.test(String(row.primary_url ?? ""))
      ? `<a href="${escapeAttribute(row.primary_url)}" aria-label="${escapeAttribute(`${row.success_criterion} ${text.primarySource}`)}">${escapeHtml(text.primarySource)}</a>`
      : escapeHtml(row.primary_url || text.noRecord);
    return `<tr data-requirement-id="${escapeAttribute(row.requirement_id)}" data-outcome="${escapeAttribute(outcomeToken(row.outcome))}" data-source="${escapeAttribute(outcomeToken(row.source_kind))}"><th scope="row">${escapeHtml(row.success_criterion)}</th><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.level)}</td><td>${escapeHtml(row.group_label)}</td><td><span class="status">${escapeHtml(row.outcome_label)}</span></td><td>${escapeHtml(row.source_label)}</td><td>${escapeHtml(row.evidence_level)}</td><td>${source}</td><td>${escapeHtml(row.rationale)}</td></tr>`;
  });
  return tableRegion({
    id: `criteria-${slug(group.id)}`,
    caption: `${group.label} (${group.expected_count})`,
    headers: [text.criterion, text.title, text.level, text.group, text.outcome, text.source, text.evidence, text.primarySource, text.rationale],
    rows,
    text
  });
}

function compactCriterionTable(rows, presentation, text, id, caption) {
  const rendered = rows.map((row) => `<tr data-requirement-id="${escapeAttribute(row.requirement_id)}" data-outcome="${escapeAttribute(outcomeToken(row.outcome))}" data-source="${escapeAttribute(outcomeToken(row.source_kind))}"><th scope="row">${escapeHtml(row.success_criterion)}</th><td><span class="status">${escapeHtml(row.outcome_label)}</span></td><td>${escapeHtml(row.source_label)}</td><td>${escapeHtml(row.evidence_level)}</td><td>${escapeHtml(row.rationale)}</td></tr>`);
  return tableRegion({
    id,
    caption,
    headers: [text.criterion, text.outcome, text.source, text.evidence, text.rationale],
    rows: rendered,
    text
  });
}

function findingsSection(presentation, text) {
  if (!presentation.findings?.length) return `<p>${escapeHtml(text.noFindings)}</p>`;
  return presentation.findings.map((finding, index) => {
    const id = `finding-${index + 1}-${slug(finding.requirement_id ?? finding.requirement_ids?.join("-") ?? "item")}`;
    const title = finding.issue ?? finding.observation ?? `${text.findings} ${index + 1}`;
    return `<article id="${escapeAttribute(id)}"><h3>${escapeHtml(title)}</h3>${definitionList([
      [text.priority, escapeHtml(finding.priority ?? text.noRecord)],
      [text.criterion, escapeHtml(finding.requirement_id ?? finding.requirement_ids?.join(", ") ?? text.noRecord)],
      [text.location, escapeHtml(finding.location ?? text.noRecord)],
      [text.change, escapeHtml(finding.proposed_change ?? finding.remediation ?? text.noRecord)],
      [text.verification, escapeHtml(finding.verification ?? text.noRecord)]
    ])}</article>`;
  }).join("\n");
}

function fullSections(presentation, text) {
  const sections = [];
  sections.push(`<section id="overview"><h2>${escapeHtml(text.overview)}</h2><p><strong>${escapeHtml(text.overall)}:</strong> ${escapeHtml(presentation.messages.outcomes[presentation.overall_outcome] ?? presentation.overall_outcome)}</p><p><strong>${escapeHtml(text.profileCount)}:</strong> ${escapeHtml(presentation.rows.length)}</p>${countsTable(presentation, text)}</section>`);
  sections.push(`<section id="legend"><h2>${escapeHtml(text.legend)}</h2><ul><li><strong>${escapeHtml(presentation.messages.sources.human_review)}:</strong> ${escapeHtml(presentation.messages.text.provenanceHuman)}</li><li><strong>${escapeHtml(presentation.messages.sources.screening)}:</strong> ${escapeHtml(presentation.messages.text.provenanceScreening)}</li><li><strong>${escapeHtml(presentation.messages.sources.not_run)}:</strong> ${escapeHtml(presentation.messages.text.provenanceNotRun)}</li></ul>${presentation.has_screening_projection ? `<p class="notice">${escapeHtml(presentation.messages.text.screeningLegend)}</p>` : ""}</section>`);
  sections.push(`<section id="claim"><h2>${escapeHtml(text.claim)}</h2>${definitionList([
    [text.requestedTier, `<code>${escapeHtml(presentation.claim.requested_tier)}</code>`],
    [text.maximumTier, `<code>${escapeHtml(presentation.claim.maximum_tier)}</code>`],
    [text.fixedWording, escapeHtml(presentation.claim.wording)],
    [text.reasons, escapeHtml(presentation.claim.reasons?.join("; ") || text.noRecord)]
  ])}<p>${escapeHtml(presentation.messages.text.formalBoundary)}</p></section>`);
  sections.push(`<section id="target"><h2>${escapeHtml(text.target)}</h2>${definitionList([
    [text.targetName, escapeHtml(presentation.target?.name ?? text.noRecord)],
    [text.version, escapeHtml(presentation.target?.version_or_commit ?? text.noRecord)],
    [text.references, list(presentation.target?.urls_or_files, text.noRecord)],
    [text.profile, escapeHtml(presentation.profile?.id ?? text.noRecord)],
    [text.date, escapeHtml(presentation.evaluated_at ?? text.noRecord)],
    [text.evaluator, escapeHtml(presentation.evaluator ?? text.noRecord)]
  ])}</section>`);
  sections.push(`<section id="findings"><h2>${escapeHtml(text.findings)}</h2>${findingsSection(presentation, text)}</section>`);
  sections.push(`<section id="criteria"><h2>${escapeHtml(text.criteria)}</h2>${presentation.profile?.id === "jp-public-web" ? `<p class="notice"><strong>${escapeHtml(text.parsingTitle)}:</strong> ${escapeHtml(text.parsingNote)}</p>` : ""}${(presentation.groups ?? []).map((group) => `<section id="criteria-${escapeAttribute(slug(group.id))}"><h3>${escapeHtml(`${group.label} (${group.expected_count})`)}</h3>${criterionTable(group, presentation, text)}</section>`).join("\n")}</section>`);
  sections.push(`<section id="scope"><h2>${escapeHtml(text.scope)}</h2>${definitionList([
    [text.included, list(presentation.scope?.included, text.noRecord)],
    [text.excluded, list(presentation.scope?.excluded, text.noRecord)],
    [text.processes, list(presentation.scope?.complete_processes, text.noRecord)],
    [text.thirdParty, list(presentation.scope?.third_party_content, text.noRecord)],
    [text.fullPages, escapeHtml(presentation.scope?.full_pages_reviewed ? text.yes : text.no)],
    [text.os, list(presentation.environment?.os, text.noRecord)],
    [text.browsers, list(presentation.environment?.browsers, text.noRecord)],
    [text.assistive, list(presentation.environment?.assistive_technologies, text.noRecord)],
    [text.inputModes, list(presentation.environment?.input_modes, text.noRecord)]
  ])}</section>`);
  const prov = provenanceCounts(presentation);
  sections.push(`<section id="coverage"><h2>${escapeHtml(text.coverage)}</h2>${groupCountsTable(presentation, text)}${definitionList([
    [presentation.messages.sources.human_review, escapeHtml(prov.human_review)],
    [presentation.messages.sources.screening, escapeHtml(prov.screening)],
    [presentation.messages.sources.not_run, escapeHtml(prov.not_run)],
    [presentation.messages.fields.evidenceLevel, escapeHtml(presentation.evidence_level)]
  ])}</section>`);
  sections.push(`<section id="limitations"><h2>${escapeHtml(text.limitations)}</h2>${presentation.limitations?.length ? `<ul>${presentation.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p>${escapeHtml(text.noLimitations)}</p>`}</section>`);
  return sections;
}

function summarySections(presentation, text, appendixHref) {
  const actionable = (presentation.rows ?? []).filter((row) => row.source_kind === "screening" || (row.source_kind === "human_review" && ["fail", "cant_tell"].includes(row.outcome)));
  const human = (presentation.rows ?? []).filter((row) => row.source_kind === "human_review");
  const prov = provenanceCounts(presentation);
  const sections = [
    `<section id="overview"><h2>${escapeHtml(text.summary)}</h2><p><strong>${escapeHtml(text.overall)}:</strong> ${escapeHtml(presentation.messages.outcomes[presentation.overall_outcome] ?? presentation.overall_outcome)}</p><p><strong>${escapeHtml(presentation.messages.fields.evidenceLevel)}:</strong> ${escapeHtml(presentation.evidence_level)}</p><p><strong>${escapeHtml(text.targetName)}:</strong> ${escapeHtml(presentation.target?.name ?? text.noRecord)}</p></section>`,
    `<section id="key-findings"><h2>${escapeHtml(text.keyFindings)}</h2>${actionable.length ? compactCriterionTable(actionable, presentation, text, "key-findings-table", text.keyFindings) : `<p>${escapeHtml(text.noActionable)}</p>`}${findingsSection(presentation, text)}</section>`,
    `<section id="human-reviewed"><h2>${escapeHtml(text.humanReviewed)}</h2>${human.length ? compactCriterionTable(human, presentation, text, "human-reviewed-table", text.humanReviewed) : `<p>${escapeHtml(text.noRecord)}</p>`}</section>`,
    `<section id="group-counts"><h2>${escapeHtml(text.groups)}</h2>${groupCountsTable(presentation, text)}</section>`,
    `<section id="provenance"><h2>${escapeHtml(text.provenance)}</h2>${definitionList([[presentation.messages.sources.human_review, escapeHtml(prov.human_review)], [presentation.messages.sources.screening, escapeHtml(prov.screening)], [presentation.messages.sources.not_run, escapeHtml(prov.not_run)]])}</section>`,
    `<section id="claim"><h2>${escapeHtml(text.claim)}</h2>${definitionList([[text.requestedTier, `<code>${escapeHtml(presentation.claim.requested_tier)}</code>`], [text.maximumTier, `<code>${escapeHtml(presentation.claim.maximum_tier)}</code>`], [text.fixedWording, escapeHtml(presentation.claim.wording)], [text.reasons, escapeHtml(presentation.claim.reasons?.join("; ") || text.noRecord)]])}</section>`,
    `<section id="scope"><h2>${escapeHtml(text.scope)}</h2>${definitionList([[text.included, list(presentation.scope?.included, text.noRecord)], [text.limitations, escapeHtml(presentation.limitations?.join("; ") || text.noRecord)]])}</section>`
  ];
  if (appendixHref) sections.push(`<section id="appendix"><h2>${escapeHtml(text.appendix)}</h2><p><a href="${escapeAttribute(appendixHref)}">${escapeHtml(text.appendixLink)}</a></p></section>`);
  return sections;
}

function tocEntries(detail, presentation, text, appendixHref) {
  if (detail === "summary") {
    const entries = [
      ["overview", text.summary], ["key-findings", text.keyFindings], ["human-reviewed", text.humanReviewed],
      ["group-counts", text.groups], ["provenance", text.provenance], ["claim", text.claim], ["scope", text.scope]
    ];
    if (appendixHref) entries.push(["appendix", text.appendix]);
    return entries;
  }
  return [["overview", text.overview], ["legend", text.legend], ["claim", text.claim], ["target", text.target], ["findings", text.findings], ["criteria", text.criteria], ["scope", text.scope], ["coverage", text.coverage], ["limitations", text.limitations]];
}

export function renderReportHtml(presentation, { detail = "full", appendixHref = null } = {}) {
  if (!["summary", "full"].includes(detail)) throw new Error("HTML report detail must be summary or full.");
  const text = localeText(presentation.locale);
  const toc = tocEntries(detail, presentation, text, appendixHref);
  const sections = detail === "summary" ? summarySections(presentation, text, appendixHref) : fullSections(presentation, text);
  const publicationNotice = presentation.publication?.notice ?? presentation.messages.text.reportNotice;
  return [
    "<!doctype html>",
    `<html lang="${escapeAttribute(presentation.locale)}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<title>${escapeHtml(presentation.title)}</title>`,
    `<style>${css()}</style>`,
    "</head>",
    "<body>",
    `<a class="skip-link" href="#main-content">${escapeHtml(text.skip)}</a>`,
    `<header><h1>${escapeHtml(presentation.title)}</h1><p class="notice">${escapeHtml(publicationNotice)}</p><p>${escapeHtml(presentation.messages.text.reportNotice)}</p></header>`,
    `<nav aria-label="${escapeAttribute(text.navigation)}"><h2>${escapeHtml(text.contents)}</h2><ol>${toc.map(([id, label]) => `<li><a href="#${escapeAttribute(id)}">${escapeHtml(label)}</a></li>`).join("")}</ol></nav>`,
    '<main id="main-content" tabindex="-1">',
    ...sections,
    "</main>",
    `<footer><p>${escapeHtml(text.formatBoundary)}</p><p>${escapeHtml(presentation.messages.text.formalBoundary)}</p></footer>`,
    "</body>",
    "</html>",
    ""
  ].join("\n");
}
