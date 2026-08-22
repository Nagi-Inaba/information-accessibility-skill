const messages = Object.freeze({
  ja: {
    documentTitle: "情報アクセシビリティ検査レポート",
    skip: "本文へ移動",
    nav: "レポート内目次",
    summary: "要約",
    target: "検査対象",
    checks: "達成基準別の判定",
    findings: "改善事項",
    limitations: "制約",
    requirement: "達成基準・検査項目",
    outcome: "判定",
    rationale: "根拠・未確認事項",
    priority: "優先度",
    location: "箇所",
    issue: "問題",
    remediation: "改善案",
    noFindings: "改善項目の記録はありません。",
    noLimitations: "追加の制約は記録されていません。",
    reportNotice: "記載した対象・版・範囲・環境・証拠を超える適合表明ではありません。",
    outcomes: { pass: "適合", fail: "不適合", not_applicable: "適用対象外", not_tested: "未確認", cant_tell: "要確認" }
  },
  en: {
    documentTitle: "Information Accessibility Audit Report",
    skip: "Skip to main content",
    nav: "Report contents",
    summary: "Summary",
    target: "Audit target",
    checks: "Requirement results",
    findings: "Improvements",
    limitations: "Limitations",
    requirement: "Requirement or check",
    outcome: "Outcome",
    rationale: "Rationale or remaining question",
    priority: "Priority",
    location: "Location",
    issue: "Issue",
    remediation: "Proposed improvement",
    noFindings: "No improvement items were recorded.",
    noLimitations: "No additional limitations were recorded.",
    reportNotice: "This is not a conformance claim beyond the recorded target, version, scope, environment, and evidence.",
    outcomes: { pass: "Pass", fail: "Fail", not_applicable: "Not applicable", not_tested: "Not tested", cant_tell: "Cannot tell" }
  }
});

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function list(items, emptyText) {
  if (!items?.length) return `<p>${escapeHtml(emptyText)}</p>`;
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function targetLinks(values = []) {
  if (!values.length) return "";
  return `<ul>${values.map((value) => {
    const href = safeHttpUrl(value);
    return href ? `<li><a href="${escapeHtml(href)}">${escapeHtml(value)}</a></li>` : `<li>${escapeHtml(value)}</li>`;
  }).join("")}</ul>`;
}

function statusLabel(outcome, locale) {
  return messages[locale].outcomes[outcome] ?? String(outcome ?? "");
}

export function renderAccessibleHtmlReport(model, { locale = "ja" } = {}) {
  if (!Object.hasOwn(messages, locale)) throw new Error("locale must be ja or en");
  const text = messages[locale];
  const checks = model?.checks ?? [];
  const findings = model?.findings ?? [];
  const limitations = model?.limitations ?? [];
  const title = model?.title ?? text.documentTitle;
  const target = model?.target ?? {};
  const overallOutcome = model?.overall_outcome ?? "not_tested";

  const checkRows = checks.length
    ? checks.map((item) => `<tr><th scope="row">${escapeHtml(item.requirement_id)}</th><td><span class="status" data-outcome="${escapeHtml(item.outcome)}">${escapeHtml(statusLabel(item.outcome, locale))}</span></td><td>${escapeHtml(item.rationale ?? "")}</td></tr>`).join("")
    : `<tr><td colspan="3">${escapeHtml(statusLabel("not_tested", locale))}</td></tr>`;
  const findingRows = findings.length
    ? findings.map((item) => `<tr><td>${escapeHtml(item.priority ?? "")}</td><th scope="row">${escapeHtml(item.id ?? item.requirement_id ?? "")}</th><td>${escapeHtml(item.location ?? "")}</td><td>${escapeHtml(item.issue ?? item.observation ?? "")}</td><td>${escapeHtml(item.remediation ?? item.proposed_change ?? "")}</td></tr>`).join("")
    : `<tr><td colspan="5">${escapeHtml(text.noFindings)}</td></tr>`;

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;line-height:1.6;max-width:80rem;margin:0 auto;padding:1rem} .skip-link{position:absolute;left:-10000px;top:auto} .skip-link:focus{left:1rem;top:1rem;padding:.5rem;outline:3px solid currentColor} nav ul{display:flex;flex-wrap:wrap;gap:1rem;padding-left:1.2rem} section{margin-block:2rem} table{border-collapse:collapse;width:100%} th,td{border:1px solid currentColor;padding:.5rem;text-align:left;vertical-align:top} :focus-visible{outline:3px solid currentColor;outline-offset:3px} .status{font-weight:700}
</style>
</head>
<body>
<a class="skip-link" href="#main">${escapeHtml(text.skip)}</a>
<header>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(text.reportNotice)}</p>
</header>
<nav aria-label="${escapeHtml(text.nav)}"><ul>
<li><a href="#summary">${escapeHtml(text.summary)}</a></li>
<li><a href="#target">${escapeHtml(text.target)}</a></li>
<li><a href="#checks">${escapeHtml(text.checks)}</a></li>
<li><a href="#findings">${escapeHtml(text.findings)}</a></li>
<li><a href="#limitations">${escapeHtml(text.limitations)}</a></li>
</ul></nav>
<main id="main" tabindex="-1">
<section id="summary" aria-labelledby="summary-heading">
<h2 id="summary-heading">${escapeHtml(text.summary)}</h2>
<p><strong>${escapeHtml(text.outcome)}:</strong> <span class="status" data-outcome="${escapeHtml(overallOutcome)}">${escapeHtml(statusLabel(overallOutcome, locale))}</span></p>
<p><strong>Profile:</strong> ${escapeHtml(model?.profile?.display_name ?? model?.profile?.id ?? "")}</p>
<p><strong>Evidence level:</strong> ${escapeHtml(model?.evidence_level ?? "")}</p>
</section>
<section id="target" aria-labelledby="target-heading">
<h2 id="target-heading">${escapeHtml(text.target)}</h2>
<dl><dt>Name</dt><dd>${escapeHtml(target.name ?? "")}</dd><dt>Version</dt><dd>${escapeHtml(target.version_or_commit ?? "")}</dd></dl>
${targetLinks(target.urls_or_files ?? [])}
</section>
<section id="checks" aria-labelledby="checks-heading">
<h2 id="checks-heading">${escapeHtml(text.checks)}</h2>
<table><caption>${escapeHtml(text.checks)}</caption><thead><tr><th scope="col">${escapeHtml(text.requirement)}</th><th scope="col">${escapeHtml(text.outcome)}</th><th scope="col">${escapeHtml(text.rationale)}</th></tr></thead><tbody>${checkRows}</tbody></table>
</section>
<section id="findings" aria-labelledby="findings-heading">
<h2 id="findings-heading">${escapeHtml(text.findings)}</h2>
<table><caption>${escapeHtml(text.findings)}</caption><thead><tr><th scope="col">${escapeHtml(text.priority)}</th><th scope="col">ID</th><th scope="col">${escapeHtml(text.location)}</th><th scope="col">${escapeHtml(text.issue)}</th><th scope="col">${escapeHtml(text.remediation)}</th></tr></thead><tbody>${findingRows}</tbody></table>
</section>
<section id="limitations" aria-labelledby="limitations-heading"><h2 id="limitations-heading">${escapeHtml(text.limitations)}</h2>${list(limitations, text.noLimitations)}</section>
</main>
</body>
</html>
`;
}
