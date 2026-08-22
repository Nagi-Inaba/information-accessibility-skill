const messages = Object.freeze({
  ja: Object.freeze({
    "outcome.pass": "適合",
    "outcome.fail": "不適合",
    "outcome.not_applicable": "適用対象外",
    "outcome.not_tested": "未確認",
    "outcome.cant_tell": "要確認",
    "evidence.external_human_review": "外部人手レビュー",
    "evidence.ai_screening": "AIスクリーニング",
    "evidence.not_performed": "未実施",
    "heading.summary": "要約",
    "heading.scope": "対象範囲と検査環境",
    "heading.findings": "改善事項",
    coverage: "記録範囲: {recorded}/{expected}"
  }),
  en: Object.freeze({
    "outcome.pass": "Pass",
    "outcome.fail": "Fail",
    "outcome.not_applicable": "Not applicable",
    "outcome.not_tested": "Not tested",
    "outcome.cant_tell": "Cannot tell",
    "evidence.external_human_review": "External human review",
    "evidence.ai_screening": "AI screening",
    "evidence.not_performed": "Not performed",
    "heading.summary": "Summary",
    "heading.scope": "Scope and test environment",
    "heading.findings": "Improvements",
    coverage: "Coverage: {recorded}/{expected}"
  })
});

export const supportedLocales = Object.freeze(Object.keys(messages));

export function normalizeLocale(locale = "en") {
  if (typeof locale !== "string" || !locale.trim()) throw new Error("locale must be a non-empty string");
  const normalized = locale.trim().toLowerCase().split("-")[0];
  if (!supportedLocales.includes(normalized)) {
    throw new Error(`Supported locales: ${supportedLocales.join(", ")}`);
  }
  return normalized;
}

export function translate(key, locale = "en", values = {}) {
  const normalized = normalizeLocale(locale);
  const template = messages[normalized][key];
  if (typeof template !== "string") throw new Error(`Unknown locale key: ${key}`);
  return template.replace(/\{([a-z_]+)\}/gu, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}

export function localizeOutcome(outcome, locale = "en") {
  const key = `outcome.${outcome}`;
  return Object.hasOwn(messages[normalizeLocale(locale)], key) ? translate(key, locale) : outcome;
}
