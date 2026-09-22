import { lookupRequirement } from "../show-requirement.mjs";
import { isCalendarDate, isRfc3339DateTime, compareInstants } from "./date-time.mjs";

export const worksheetHeader = ["項目キー", "確認基準", "入力区分", "項目", "値", "記入案内"];
export const outcomes = ["pass", "fail", "not_applicable", "not_tested", "cant_tell"];
export const evidenceTypes = ["manual_observation", "browser_inspection", "keyboard_test", "assistive_technology_test", "document_structure_inspection", "screenshot", "log", "report", "other"];
export const worksheetLimit = 8 * 1024 * 1024;
const editable = "入力";
const fixed = "固定";
const maxRows = 12000;
const maxCell = 32767;

export function worksheetItems(run, queue, envelopesById) {
  const recorded = new Set([...envelopesById.values()].flatMap(({ envelope }) => envelope.artifact_type === "declared-human-review"
    ? envelope.payload.reviews.map((review) => review.requirement_id) : []));
  const items = queue.payload.items.filter((item) => !recorded.has(item.requirement_id));
  if (!items.length) throw new Error("This queue has no unsubmitted requirements. Existing reviews are immutable; use a new run for a correction.");
  return items;
}

export function createWorksheetRows({ run, runSha256, queue, queueSha256, items, skillRoot }) {
  const rows = [worksheetHeader];
  const add = (key, section, label, value = "", help = "", input = false) => rows.push([key, section, input ? editable : fixed, label, value, help]);
  add("context.version", "共通", "ワークシート形式", "1.0.0");
  add("context.run", "共通", "run ID", run.run_id);
  add("context.run_sha256", "共通", "run SHA-256", runSha256);
  add("context.queue", "共通", "キューID", queue.artifact_id);
  add("context.queue_sha256", "共通", "キュー SHA-256", queueSha256);
  add("context.profile", "共通", "プロファイル", run.profile.id);
  add("context.instructions", "共通", "入力方法", "入力区分が「入力」の行の「値」だけ記入する。判定が空欄の基準は未提出。1ファイルにつき確認者は1人。",
    "固定欄・行数・項目キーを変更しない。日時はタイムゾーン付き文字列。数式は使用不可。このファイルには非公開の対象情報を含む。");
  add("reviewer.name", "確認者", "氏名", "", "実際に確認した人の氏名。本人確認は別工程。", true);
  add("reviewer.date", "確認者", "確認日", "", "YYYY-MM-DD。実際の確認日。", true);
  add("reviewer.declaration", "確認者", "確認の申告", "", "誰が何を確認したか、範囲と制約を自分の言葉で記入する。", true);
  for (const item of items) {
    const id = item.requirement_id;
    const lookup = lookupRequirement(run.profile.id, id, skillRoot, "ja");
    const section = `${id}: ${lookup.criterion.display_title}`;
    const row = (key, label, value, help, input) => add(`${id}.${key}`, section, label, value, help, input);
    row("title", "基準名", lookup.criterion.display_title);
    row("targets", "対象箇所と状態", item.target_locations.map((target) => `${target.target_ref}\n${target.location}\n${target.required_state}`).join("\n\n"));
    row("reason", "確認理由", `${item.reason}\n${item.priority}: ${item.priority_reason}`);
    row("procedure", "確認手順", lookup.procedure_binding.human_actions.map((action, index) => `${index + 1}. ${action}`).join("\n"),
      `${item.procedure_availability}: ${item.procedure_ref ?? item.generic_method_ref}`);
    row("sources", "一次資料", item.official_sources.join("\n"));
    row("cant_tell", "判断できない条件", lookup.procedure_binding.cant_tell_conditions.join("\n"));
    row("required_evidence", "必要な証拠の種類", item.required_evidence_types.join("\n"), "not_tested は未実施の理由を manual_observation に記録する。実施していない検査結果は作らない。");
    row("outcome", "判定", "", "pass=適合 / fail=不適合 / not_applicable=非該当 / not_tested=未実施 / cant_tell=判断不能。空欄は未提出。", true);
    row("rationale", "判定理由", "", "対象固有の理由と確認範囲を記入する。", true);
    for (const [key, label, help] of [
      ["priority", "不適合の優先度", "fail の場合のみ P0 / P1 / P2 を選択する。"],
      ["location", "不適合の箇所", "fail の場合のみ、対象URL・要素・状態を具体的に記入する。"],
      ["affected_users", "影響を受ける利用者", "fail の場合のみ、1行に1項目。"],
      ["observation", "不適合の内容", "fail の場合のみ、実際の挙動と期待する挙動を記入する。"]
    ]) row(`finding.${key}`, label, "", help, true);
    const types = [...new Set(["manual_observation", ...item.required_evidence_types])];
    for (const [index, type] of [...types, "", ""].entries()) {
      row(`evidence.${index}.type`, `証拠${index + 1}・種類`, type, type ? "この種類の確認記録を以下に入力する。不要な任意欄はすべて空欄にする。" : `追加証拠（任意）: ${evidenceTypes.join(" / ")}`, !type);
      row(`evidence.${index}.location`, `証拠${index + 1}・対象箇所`, "", "対象URL・要素・状態。実際に確認した対象を記入する。", true);
      row(`evidence.${index}.observation`, `証拠${index + 1}・確認内容`, "", "観測結果、方法、使用環境を記入する。未実施の場合はその理由。", true);
      row(`evidence.${index}.captured_at`, `証拠${index + 1}・記録日時`, "", "例: 2026-09-19T10:30:00+09:00。Excelでも文字列のまま入力する。", true);
    }
  }
  validateGrid(rows);
  return rows;
}

export function validateGrid(rows) {
  if (!Array.isArray(rows) || rows.length > maxRows) throw new Error("Worksheet row limit exceeded.");
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== worksheetHeader.length || row.some((cell) => typeof cell !== "string" || cell.length > maxCell || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(cell))) {
      throw new Error("Worksheet must contain six text columns with bounded, valid text cells.");
    }
  }
}

export function worksheetAnswers(rows, expected) {
  validateGrid(rows);
  if (rows.length !== expected.length) throw new Error("Worksheet rows were added or removed. Export a new worksheet from the current run.");
  const answers = new Map();
  for (let index = 0; index < expected.length; index++) {
    for (let col = 0; col < worksheetHeader.length; col++) {
      if (index > 0 && expected[index][2] === editable && col === 4) continue;
      if (rows[index][col] !== expected[index][col]) throw new Error(`Worksheet fixed field changed or stale context at row ${index + 1}, column ${col + 1}. Export from the supplied current run and queue.`);
    }
    if (index) answers.set(expected[index][0], rows[index][4].trim());
  }
  return answers;
}

function utcDateTime(value, now) {
  if (!isRfc3339DateTime(value)) throw new Error(`Evidence timestamp must be a valid RFC 3339 date-time with time zone: ${value}`);
  if (compareInstants(value, now) > 0) throw new Error("Evidence timestamp cannot be later than artifact creation.");
  const fraction = /\.(\d+)(?=[Zz+-])/u.exec(value)?.[1];
  const base = new Date(value.replace(/\.\d+(?=[Zz+-])/u, "")).toISOString().slice(0, -5);
  const result = `${base}${fraction ? `.${fraction}` : ""}Z`;
  if (!isRfc3339DateTime(result)) throw new Error("Evidence timestamp is outside the supported UTC year range.");
  return result;
}

export function reviewFromWorksheet({ rows, expected, items, artifactId, now }) {
  const answers = worksheetAnswers(rows, expected);
  const required = (key) => { const value = answers.get(key); if (!value) throw new Error(`Required worksheet answer is empty: ${key}`); return value; };
  const reviewDate = required("reviewer.date");
  if (!isCalendarDate(reviewDate)) throw new Error("Review date must be a valid YYYY-MM-DD calendar date.");
  const reviews = [];
  for (const item of items) {
    const id = item.requirement_id;
    const get = (field) => answers.get(`${id}.${field}`) ?? "";
    const outcome = get("outcome");
    const edited = expected.some((row) => row[0].startsWith(`${id}.`) && row[2] === editable && answers.get(row[0]));
    if (!outcome) {
      if (edited) throw new Error(`Partially filled criterion has no outcome: ${id}. Clear all its input fields to leave it unsubmitted.`);
      continue;
    }
    if (!outcomes.includes(outcome)) throw new Error(`Invalid outcome for ${id}: ${outcome}`);
    const review = { requirement_id: id, procedure_availability: item.procedure_availability, criterion_procedure_ref: item.procedure_ref,
      generic_method_ref: item.generic_method_ref, official_sources: [...item.official_sources], profile_outcome: outcome,
      rationale: required(`${id}.rationale`), target_specific_evidence: [] };
    const evidenceCount = new Set(["manual_observation", ...item.required_evidence_types]).size + 2;
    for (let index = 0; index < evidenceCount; index++) {
      const prefix = `evidence.${index}`;
      const type = get(`${prefix}.type`);
      const fields = ["location", "observation", "captured_at"];
      const supplied = fields.some((key) => get(`${prefix}.${key}`)) || (index >= evidenceCount - 2 && type);
      if (!supplied) continue;
      if (!evidenceTypes.includes(type)) throw new Error(`Invalid evidence type for ${id}: ${type}`);
      const evidence = { type };
      for (const field of fields) evidence[field] = required(`${id}.${prefix}.${field}`);
      evidence.captured_at = utcDateTime(evidence.captured_at, now);
      review.target_specific_evidence.push(evidence);
    }
    const needed = outcome === "not_tested" ? ["manual_observation"] : item.required_evidence_types;
    if (outcome === "not_tested" && review.target_specific_evidence.some((evidence) => evidence.type !== "manual_observation")) throw new Error(`not_tested accepts only a manual_observation non-performance note: ${id}. Clear the other evidence fields.`);
    for (const type of needed) if (!review.target_specific_evidence.some((evidence) => evidence.type === type)) throw new Error(`Missing required evidence type ${type} for ${id}.`);
    if (!review.target_specific_evidence.length) throw new Error(`At least one explicit human record is required for ${id}.`);
    const findingFields = ["priority", "location", "affected_users", "observation"];
    if (outcome === "fail") {
      const finding = { id: `${artifactId}:F:${id}` };
      for (const field of findingFields) finding[field] = required(`${id}.finding.${field}`);
      if (!["P0", "P1", "P2"].includes(finding.priority)) throw new Error(`Invalid finding priority for ${id}.`);
      finding.affected_users = finding.affected_users.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
      if (!finding.affected_users.length || new Set(finding.affected_users).size !== finding.affected_users.length) throw new Error(`Affected users must be nonempty and unique for ${id}.`);
      review.finding = finding;
    } else if (findingFields.some((field) => get(`finding.${field}`))) throw new Error(`Finding fields are only allowed for fail: ${id}`);
    reviews.push(review);
  }
  if (!reviews.length) throw new Error("Worksheet has no submitted reviews.");
  return { schema_version: "2.0.0", declaration: required("reviewer.declaration"), reviewer_name: required("reviewer.name"),
    review_date: reviewDate, identity_authenticated: false, reviews };
}

// Prefix potentially active spreadsheet text, including literal apostrophes,
// reversibly. CSV is transport text; never interpret formulas on import.
const protectCsv = (value) => /^[\s]*[=+\-@']/u.test(value) || /^[\t\r\n]/u.test(value) ? `'${value}` : value;
const unprotectCsv = (value) => value.startsWith("'") && protectCsv(value.slice(1)) === value ? value.slice(1) : value;
export function encodeCsv(rows) {
  validateGrid(rows);
  return `\uFEFF${rows.map((row) => row.map((cell) => `"${protectCsv(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n")}\r\n`;
}
export function decodeCsv(text) {
  const source = text.replace(/^\uFEFF/u, "");
  const rows = []; let row = [], cell = "", quoted = false, closed = false;
  const field = () => { row.push(unprotectCsv(cell)); cell = ""; closed = false; };
  const record = () => { field(); rows.push(row); row = []; if (rows.length > maxRows) throw new Error("Worksheet row limit exceeded."); };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += char;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === ",") field();
    else if (char === "\n" || char === "\r") { if (char === "\r" && source[i + 1] === "\n") i++; record(); }
    else if (closed || char === '"') throw new Error("Malformed CSV quoting.");
    else cell += char;
    if (cell.length > maxCell + 1 || row.length > 6) throw new Error("Worksheet cell or column limit exceeded.");
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  if (cell || row.length || closed) record();
  validateGrid(rows); return rows;
}

const escapeMarkdown = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll("|", "&#124;").replaceAll("\\", "&#92;").replaceAll("`", "&#96;").replaceAll("*", "&#42;").replaceAll("_", "&#95;")
  .replaceAll("[", "&#91;").replaceAll("]", "&#93;").replaceAll("\r", "&#13;").replaceAll("\n", "<br>");
const unescapeMarkdown = (value) => value.replaceAll("<br>", "\n").replace(/&(amp|lt|gt|#124|#92|#96|#42|#95|#91|#93|#13);/gu,
  (match, name) => ({ amp: "&", lt: "<", gt: ">", "#124": "|", "#92": "\\", "#96": "`", "#42": "*", "#95": "_", "#91": "[", "#93": "]", "#13": "\r" })[name]);
export function encodeMarkdown(rows) {
  validateGrid(rows);
  return rows.map((row, index) => `| ${row.map(escapeMarkdown).join(" | ")} |${index === 0 ? "\n| --- | --- | --- | --- | --- | --- |" : ""}`).join("\n") + "\n";
}
export function decodeMarkdown(text) {
  const lines = text.replace(/^\uFEFF/u, "").replace(/\r\n/gu, "\n").trimEnd().split("\n");
  if (lines[1] !== "| --- | --- | --- | --- | --- | --- |") throw new Error("Worksheet Markdown table header is invalid.");
  lines.splice(1, 1);
  const rows = lines.map((line) => {
    if (!line.startsWith("| ") || !line.endsWith(" |")) throw new Error("Malformed Markdown worksheet row.");
    return line.slice(2, -2).split(" | ").map(unescapeMarkdown);
  });
  validateGrid(rows); return rows;
}
