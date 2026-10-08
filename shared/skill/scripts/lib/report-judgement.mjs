// Report judgement vocabulary shared by the Markdown renderers and the run-backed report model.
export const outcomes = ["pass", "fail", "not_applicable", "not_tested", "cant_tell"];

export const outcomeLabels = {
  pass: "適合",
  fail: "不適合",
  not_tested: "未確認",
  cant_tell: "要確認"
};

export function reportJudgementForOutcome(outcome) {
  return outcomeLabels[outcome] ?? null;
}

export function overallReportJudgement(counts = {}) {
  const recorded = outcomes.reduce((total, outcome) => total + count(counts, outcome), 0);
  if (recorded === 0) return "未確認";
  if (count(counts, "fail") > 0) return "不適合";
  if (count(counts, "cant_tell") > 0) return "要確認";
  if (count(counts, "not_tested") > 0) return "未確認";
  return "適合";
}

export function count(counts, outcome) {
  return counts?.[outcome] ?? 0;
}

export function resultRationale(result) {
  if (result.outcome === "not_tested" && /^Not yet evaluated\./u.test(result.notes ?? "")) {
    return "この検査では確認していません。";
  }
  return result.notes || result.evidence?.map((item) => `${item.location}: ${item.observation}`).join("; ") || "根拠の記録なし";
}
