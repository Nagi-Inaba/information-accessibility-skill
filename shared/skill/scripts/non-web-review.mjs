#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { isCalendarDate } from "./lib/date-time.mjs";
import { validateJsonSchema } from "./lib/json-schema.mjs";

const skillRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const perspectives = ["find", "receive", "understand", "participate", "continue"];
const japanesePerspectives = { find: "見つける", receive: "受け取る", understand: "理解する", participate: "参加する", continue: "続ける" };
const questions = {
  "document-slide": {
    ja: ["資料の最新版と目的を見つけられるか", "本文を利用できる形式で受け取れるか", "見出し・読み順・図の意味が分かるか", "質問や代替形式を依頼できるか", "後から要点と更新を確認できるか"],
    en: ["Can readers find the current version and purpose?", "Can readers receive the content in a usable format?", "Are headings, reading order, and figures understandable?", "Can readers ask questions or request another format?", "Can readers revisit the summary and updates?"]
  },
  "media-content": {
    ja: ["動画・音声の目的と版を見つけられるか", "字幕・文字起こしなど必要な形式を受け取れるか", "発話者・重要な映像・用語を理解できるか", "再生を操作し質問や支援を依頼できるか", "訂正済み字幕やアーカイブへ戻れるか"],
    en: ["Can users find the media purpose and version?", "Are captions and transcripts available where needed?", "Are speakers, meaningful visuals, and terms understandable?", "Can users control playback and ask for support?", "Can users return to corrected captions or an archive?"]
  },
  "event-community": {
    ja: ["日時・場所・参加条件を見つけられるか", "会場・配信・資料・支援を利用できるか", "進行・発言・共有資料が分かるか", "質問や支援依頼をして参加できるか", "記録・次の行動・再参加方法を確認できるか"],
    en: ["Can participants find the time, place, and entry conditions?", "Can they use the venue, stream, materials, and support?", "Are the agenda, speech, and shared material understandable?", "Can they ask questions and request support?", "Can they find records, next steps, and re-entry paths?"]
  },
  "participation-workflow": {
    ja: ["参加の入口と条件を見つけられるか", "必要な情報と支援を受け取れるか", "手順・役割・期限を理解できるか", "申請・相談・参加を完了できるか", "結果・変更・次の機会を確認できるか"],
    en: ["Can users find the entry point and conditions?", "Can they receive needed information and support?", "Are steps, roles, and deadlines understandable?", "Can they complete participation or request help?", "Can they find outcomes, changes, and future opportunities?"]
  }
};

const readJson = (file) => JSON.parse(fs.readFileSync(path.resolve(file), "utf8").replace(/^\uFEFF/u, ""));
const present = (value) => typeof value === "string" && value.trim().length > 0;
const clean = (value) => String(value).replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;")
  .replace(/[\r\n]+/gu, " ").replace(/([\\`*_{}\[\]()#+.!|])/gu, "\\$1");

export function validateNonWebReview(record, schema = readJson(path.join(skillRoot, "references/non-web-review.schema.json"))) {
  const errors = validateJsonSchema(record, schema);
  if (errors.length) return errors;
  if (record.review_date !== null && !isCalendarDate(record.review_date)) errors.push("$.review_date must be a real calendar date");
  const ids = record.checks.map((item) => item.id);
  if (new Set(ids).size !== ids.length) errors.push("$.checks contains duplicate IDs");
  for (const perspective of perspectives) {
    if (!record.checks.some((item) => item.perspective === perspective)) errors.push(`$.checks needs a ${perspective} perspective`);
  }
  for (const check of record.checks) {
    const location = `$.checks[${check.id}]`;
    if (check.outcome === "not_tested") {
      if (check.reviewer_id !== null || check.observation !== null || check.evidence_refs.length
        || check.improvement !== null || check.retest_method !== null) errors.push(`${location} not_tested must remain empty`);
      continue;
    }
    if (!record.review_date || !present(check.reviewer_id) || !present(check.observation)) {
      errors.push(`${location} needs review_date, reviewer_id, and observation`);
    }
    if (["issue", "no_issue_observed"].includes(check.outcome) && check.evidence_refs.length === 0) {
      errors.push(`${location} needs saved evidence_refs`);
    }
    if (check.outcome === "issue" && (!present(check.improvement) || !present(check.retest_method))) {
      errors.push(`${location} issue needs improvement and retest_method`);
    }
  }
  return errors;
}

export function initNonWebReview({ kind, id, name, version, scope, locale = "ja" }) {
  if (!questions[kind]) throw new Error(`--kind must be one of ${Object.keys(questions).join(", ")}`);
  if (!["ja", "en"].includes(locale)) throw new Error("--locale must be ja or en");
  const record = {
    schema_version: "1.0.0",
    claim_boundary: "participation_review_only",
    target: { id, kind, name, version, scope },
    review_date: null,
    checks: perspectives.map((perspective, index) => ({
      id: perspective,
      perspective,
      question: questions[kind][locale][index],
      outcome: "not_tested",
      observation: null,
      reviewer_id: null,
      evidence_refs: [],
      improvement: null,
      retest_method: null
    }))
  };
  const errors = validateNonWebReview(record);
  if (errors.length) throw new Error(errors.join("\n"));
  return record;
}

function validatedRecord(file) {
  const record = readJson(file);
  const errors = validateNonWebReview(record);
  if (errors.length) throw new Error(`Invalid non-Web review:\n${errors.join("\n")}`);
  return record;
}

function reportMarkdown(record, locale) {
  const ja = locale === "ja";
  const lines = [
    ja ? "# 非Web参加レビュー" : "# Non-Web participation review",
    "",
    ja ? "規格適合の判定ではありません。確認者IDは申告値で、本人確認はしていません。" : "This is not a standards conformance assessment. Reviewer IDs are declared, not authenticated.",
    "",
    `- ${ja ? "対象" : "Target"}: ${clean(record.target.name)} (${clean(record.target.kind)})`,
    `- ${ja ? "識別子・版" : "ID and version"}: ${clean(record.target.id)} / ${clean(record.target.version)}`,
    `- ${ja ? "範囲" : "Scope"}: ${clean(record.target.scope)}`,
    `- ${ja ? "確認日" : "Review date"}: ${record.review_date ?? (ja ? "未実施" : "not reviewed")}`,
    `- ${ja ? "課題／未実施" : "Issues / not tested"}: ${record.checks.filter((item) => item.outcome === "issue").length} / ${record.checks.filter((item) => item.outcome === "not_tested").length}`,
    ""
  ];
  for (const check of record.checks) {
    lines.push(`## ${ja ? japanesePerspectives[check.perspective] : check.perspective} [${check.id}]: ${clean(check.question)}`, "",
      `- ${ja ? "結果" : "Outcome"}: ${check.outcome}`,
      `- ${ja ? "観測" : "Observation"}: ${check.observation ? clean(check.observation) : "—"}`,
      `- ${ja ? "確認者ID" : "Reviewer ID"}: ${check.reviewer_id ?? "—"}`,
      `- ${ja ? "保存済み根拠" : "Saved evidence"}: ${check.evidence_refs.length ? check.evidence_refs.map(clean).join(", ") : "—"}`,
      `- ${ja ? "改善案" : "Improvement"}: ${check.improvement ? clean(check.improvement) : "—"}`,
      `- ${ja ? "再確認方法" : "Retest method"}: ${check.retest_method ? clean(check.retest_method) : "—"}`,
      "");
  }
  return lines.join("\n");
}

export function compareNonWebReviews(before, after) {
  if (before.target.id !== after.target.id || before.target.kind !== after.target.kind
    || before.target.scope !== after.target.scope) {
    throw new Error("Reviews must refer to the same target ID, kind, and scope");
  }
  const oldChecks = new Map(before.checks.map((item) => [item.id, item]));
  const newChecks = new Map(after.checks.map((item) => [item.id, item]));
  const changes = [...new Set([...oldChecks.keys(), ...newChecks.keys()])].map((id) => {
    const previous = oldChecks.get(id);
    const current = newChecks.get(id);
    if (previous && current && previous.perspective !== current.perspective) {
      throw new Error(`Check ${id} changed perspective`);
    }
    return {
      id,
      perspective: current?.perspective ?? previous.perspective,
      before: previous?.outcome ?? null,
      after: current?.outcome ?? null,
      change: !previous ? "added" : !current ? "removed"
        : isDeepStrictEqual(previous, current) ? "unchanged" : "changed"
    };
  });
  return {
    claim_boundary: "participation_review_only",
    target_id: after.target.id,
    before_version: before.target.version,
    after_version: after.target.version,
    changes,
    limitation: "Compares declared review outcomes only; it does not verify source artifacts or prove remediation."
  };
}

function parseArgs(argv) {
  const [command, ...args] = argv;
  if (command === "--help" || !command) return { help: true };
  if (!["init", "validate", "report", "compare"].includes(command)) throw new Error("Command must be init, validate, report, or compare");
  const options = { command, locale: "ja", format: "markdown" };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!["--kind", "--id", "--name", "--version", "--scope", "--input", "--before", "--after", "--output", "--locale", "--format"].includes(flag)
      || seen.has(flag) || !value || value.startsWith("--")) throw new Error(`Invalid or duplicate argument: ${flag}`);
    seen.add(flag);
    options[flag.slice(2)] = value;
  }
  if (!["ja", "en"].includes(options.locale)) throw new Error("--locale must be ja or en");
  if (!["json", "markdown"].includes(options.format)) throw new Error("--format must be json or markdown");
  const required = {
    init: ["kind", "id", "name", "version", "scope", "output"],
    validate: ["input"],
    report: ["input", "output"],
    compare: ["before", "after", "output"]
  };
  const allowed = {
    init: ["kind", "id", "name", "version", "scope", "output", "locale"],
    validate: ["input", "locale"],
    report: ["input", "output", "locale"],
    compare: ["before", "after", "output", "format", "locale"]
  };
  for (const name of seen) if (!allowed[command].includes(name.slice(2))) throw new Error(`${name} is not used by ${command}`);
  for (const name of required[command]) if (!options[name]) throw new Error(`--${name} is required for ${command}`);
  return options;
}

function usage() {
  return [
    "Usage:",
    "  accessibility-audit non-web-review init --kind <document-slide|media-content|event-community|participation-workflow> --id <id> --name <name> --version <version> --scope <scope> --output <new.json> [--locale ja|en]",
    "  accessibility-audit non-web-review validate --input <review.json>",
    "  accessibility-audit non-web-review report --input <review.json> --output <new.md> [--locale ja|en]",
    "  accessibility-audit non-web-review compare --before <review.json> --after <review.json> --output <new.md|json> [--format markdown|json] [--locale ja|en]",
    "Records and reports are private participation reviews, not WCAG/JIS or other conformance results."
  ].join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (options.command === "validate") {
    validatedRecord(options.input);
    process.stdout.write('{"valid":true}\n');
    return 0;
  }
  let output;
  if (options.command === "init") {
    output = JSON.stringify(initNonWebReview(options), null, 2) + "\n";
  } else if (options.command === "report") {
    output = reportMarkdown(validatedRecord(options.input), options.locale) + "\n";
  } else {
    const comparison = compareNonWebReviews(validatedRecord(options.before), validatedRecord(options.after));
    const ja = options.locale === "ja";
    output = options.format === "json" ? JSON.stringify(comparison, null, 2) + "\n"
      : [ja ? "# 非Web参加レビューの前後比較" : "# Non-Web participation review comparison", "",
        `- ${ja ? "対象" : "Target"}: ${clean(comparison.target_id)}`,
        `- ${ja ? "版" : "Versions"}: ${clean(comparison.before_version)} → ${clean(comparison.after_version)}`,
        "", ...comparison.changes.map((item) => `- ${clean(item.id)} (${ja ? japanesePerspectives[item.perspective] : item.perspective}): ${item.before ?? "—"} → ${item.after ?? "—"} [${item.change}]`),
        "", ja ? "申告された結果の比較です。元資料の実体や改善の成立は検証しません。" : comparison.limitation, ""].join("\n");
  }
  fs.writeFileSync(path.resolve(options.output), output, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${path.resolve(options.output)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
