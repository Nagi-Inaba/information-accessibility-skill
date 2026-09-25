import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { attestationDigest, parseAttestationJson } from "./attestation-canonical.mjs";
import { validateJsonSchema } from "./json-schema.mjs";

const defaultSkillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const schema = JSON.parse(fs.readFileSync(new URL("../../references/third-party-sources.schema.json", import.meta.url), "utf8"));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const json = file => structuredClone(parseAttestationJson(fs.readFileSync(file)));
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const requiredResourceSources = {
  "references/criteria-catalog.json": ["WCAG-2.2", "WAIC-JIS-CHECKLIST-2020-12", "DIGITAL-AGENCY-JP-PROFILE"],
  "references/standards-registry.json": ["WCAG-2.2", "WAIC-JIS-CHECKLIST-2020-12", "DIGITAL-AGENCY-JP-PROFILE", "REFERENCE-ONLY-W3C-WAIC"],
  "references/aria-review-rules.json": ["WAI-ARIA-1.2", "HTML-ARIA-2026-04-15"],
  "references/criterion-procedures.json": ["WCAG-2.2", "REFERENCE-ONLY-W3C-WAIC"],
  "references/common-web-failure-patterns.json": ["MIC-MICHECKER-FAQ", "ECLIPSE-ACTF-MANUALS", "WCAG-2.2", "WAI-ARIA-1.2"]
};
const markdown = value => String(value).replace(/([\\`*_{}\[\]()!|<>])/gu, "\\$1").replace(/[\r\n]/gu, " ");
function safeUrl(value) {
  const url = new URL(value);
  requireValue(url.protocol === "https:" && !url.username && !url.password && !/[<>"\s()]/u.test(value), "Source provenance needs an unambiguous public HTTPS URL.");
}

export function validateSourceProvenance(manifest) {
  const errors = validateJsonSchema(manifest, schema);
  requireValue(errors.length === 0, `Invalid source provenance:\n- ${errors.join("\n- ")}`);
  const sourceIds = new Set(manifest.sources.map(source => source.id)), licenseIds = new Set(manifest.licenses.map(license => license.id));
  requireValue(sourceIds.size === manifest.sources.length && licenseIds.size === manifest.licenses.length, "Duplicate source or license identity.");
  requireValue(new Set(manifest.resource_bindings.map(binding => binding.path)).size === manifest.resource_bindings.length, "Duplicate resource binding.");
  for (const [resource, expectedSources] of Object.entries(requiredResourceSources)) {
    const binding = manifest.resource_bindings.find(item => item.path === resource);
    requireValue(binding && expectedSources.every(id => binding.source_ids.includes(id)), `Required source binding missing: ${resource}`);
  }
  for (const id of requiredResourceSources["references/criteria-catalog.json"]) {
    const source = manifest.sources.find(item => item.id === id);
    requireValue(source?.report_notice === true && source.terms_status === "primary_source_checked", `Catalog source requires report attribution and reviewed terms: ${id}`);
  }
  for (const license of manifest.licenses) {
    safeUrl(license.url);
    requireValue(Boolean(license.archived_file) === Boolean(license.sha256), "Archived terms require both a file and its exact SHA-256.");
  }
  for (const source of manifest.sources) {
    safeUrl(source.url); safeUrl(source.version_url);
    if (source.terms_evidence_url) safeUrl(source.terms_evidence_url);
    if (source.terms_status === "primary_source_checked") {
      requireValue(licenseIds.has(source.terms_id) && source.terms_evidence_url, `Checked source ${source.id} needs exact terms and evidence.`);
    } else requireValue(source.terms_id === null && source.terms_evidence_url === null && !source.report_notice, "Unreviewed source terms cannot imply MIT or approved generated attribution.");
  }
  for (const binding of manifest.resource_bindings) requireValue(binding.source_ids.every(id => sourceIds.has(id)), "Resource binding names an unknown source.");
  return true;
}

export function loadSourceProvenance(skillRoot = defaultSkillRoot) {
  const manifest = json(path.join(skillRoot, "references/third-party-sources.json"));
  validateSourceProvenance(manifest);
  return manifest;
}

export function verifySourceProvenance({ skillRoot = defaultSkillRoot, manifest = loadSourceProvenance(skillRoot) } = {}) {
  validateSourceProvenance(manifest);
  for (const binding of manifest.resource_bindings) {
    const resource = json(path.join(skillRoot, binding.path));
    requireValue(attestationDigest(resource) === binding.canonical_sha256, `Source/provenance review required for changed resource: ${binding.path}`);
  }
  for (const license of manifest.licenses.filter(item => item.archived_file)) {
    requireValue(hash(fs.readFileSync(path.join(skillRoot, license.archived_file))) === license.sha256, `Archived license changed: ${license.id}`);
  }
  const catalog = json(path.join(skillRoot, "references/criteria-catalog.json"));
  for (const source of catalog.sources) {
    const registered = manifest.sources.find(item => item.id === source.id);
    requireValue(registered?.url === source.url && registered.reviewed_source_sha256 === source.source_sha256 && registered.terms_status === "primary_source_checked", `Catalog source/license review required: ${source.id}`);
    requireValue(registered.report_notice === true, `Catalog source requires report attribution: ${source.id}`);
    requireValue(manifest.resource_bindings.find(item => item.path === "references/criteria-catalog.json").source_ids.includes(source.id), `Catalog source binding missing: ${source.id}`);
  }
  return { status: "PASS", source_count: manifest.sources.length, legal_review_status: manifest.legal_review_status };
}

export function thirdPartyNoticeMarkdown(manifest = loadSourceProvenance()) {
  validateSourceProvenance(manifest);
  const lines = ["# Third-Party Notices and Source Provenance", "",
    "このnoticeは配布スキル内の`references/third-party-sources.json`から生成しています。原作者・出典・利用条件・加工範囲を保持して再配布してください。", "",
    "MIT Licenseは本プロジェクトの独自コードと独自文書に適用します。第三者の規格、翻訳、名称、メタデータ、研究用原本をMITへ再許諾するものではありません。対象サイトの証拠や利用者の記録にもMITやCC BY-SAを一律に適用しません。", "",
    `公式の利用条件表示を確認した日: ${manifest.checked_on}。法的レビュー: **未実施**。これは商用利用・再配布の適法性や権利処理の完了を保証しません。混合データの翻案・継承範囲など判断が必要な場合は、具体的な配布物と利用方法を示して専門家へ確認してください。`, ""];
  for (const source of manifest.sources) {
    const license = manifest.licenses.find(item => item.id === source.terms_id);
    lines.push(`## ${markdown(source.name)}`, "", `- 出典: [${markdown(source.publisher)}](${source.url})`,
      `- 版・状態: [${markdown(source.version)}](${source.version_url})`, `- 保存する項目: ${source.imported_fields.map(markdown).join("、")}`,
      `- 利用条件: ${license ? `[${markdown(license.name)}](${license.url})` : "未確認。参照リンクの存在を転載許諾と扱わない。"}`,
      ...(source.terms_evidence_url ? [`- 条件表示の確認元: [原資料の表示](${source.terms_evidence_url})`] : []),
      ...(license?.archived_file ? [`- 利用条件全文の同梱先: \`<skill-root>/${license.archived_file}\``] : []),
      `- 帰属表示: ${markdown(source.attribution)}`, `- 加工: ${markdown(source.modification_notice)}`,
      `- 再配布: ${markdown(source.redistribution_notes)}`, `- 法的レビュー: 未実施。確認日: ${source.checked_on}`,
      ...(source.derivative_notice ? ["", source.derivative_notice] : []), "");
  }
  lines.push("## 生成物と更新時の扱い", "",
    "- 配布カタログはこのnotice、機械可読台帳、同梱した利用条件全文と組で保管・配布します。既存カタログの内容やrunのresource hashはnotice追加のために変更しません。",
    "- 新しいカタログ候補には`.sources.json`を同時に作成します。候補のハッシュと出典hash、notice、`pending_source_license_review`を記録し、更新した資料の条件を自動承認しません。",
    "- Markdown／HTMLレポートには、使用するカタログ資料の出典・利用条件・帰属・加工表示を引き継ぎます。summaryと付録でもnoticeを省略しません。",
    "- JSONのassessmentやその他のcandidateを単体で移送する際も、このnoticeと機械可読台帳を添付します。コピーした第三者資料を独自の監査結果として表示しないでください。",
    "- source refreshや項目追加では、原資料の版・利用条件・必要な表示・加工の有無・継承範囲・未確認事項を再確認して台帳を更新します。`build-criteria-catalog.mjs --check`は台帳のresource/source hashとnoticeがずれていれば失敗します。",
    "- 未確認の利用条件をMITで埋めず、必要な権利確認ができない資料はID・リンク・独自分類だけへ保存範囲を縮めます。", "");
  return lines.join("\n");
}

export function reportSourceNotices(locale = "ja") {
  const manifest = loadSourceProvenance();
  const english = locale === "en";
  return { heading: english ? "Third-party metadata attribution" : "規格メタデータの出典と利用条件",
    boundary: english
      ? "Original project code is MIT; third-party metadata retains its source terms. This notice does not license audit evidence or certify legal clearance. Preserve source attribution, changes and applicable terms when redistributing."
      : "独自コードはMITですが、第三者メタデータには原資料の利用条件が残ります。この表示は監査証拠の利用許諾や法的確認の完了を意味しません。再配布時も出典・加工表示・適用条件を保持してください。",
    entries: manifest.sources.filter(source => source.report_notice).map(source => ({ ...source, terms: manifest.licenses.find(license => license.id === source.terms_id) })) };
}

export function renderSourceNoticesMarkdown(locale = "ja") {
  const notice = reportSourceNotices(locale);
  return [`## ${notice.heading}`, "", notice.boundary, "", ...notice.entries.flatMap(source => [
    `- [${markdown(source.name)}](${source.url}) — ${markdown(source.attribution)} [${markdown(source.terms.name)}](${source.terms.url})`,
    `  ${markdown(source.modification_notice)}`,
    `  ${markdown(source.redistribution_notes)}`,
    ...(source.derivative_notice ? [`  ${source.derivative_notice}`] : [])
  ]), ""].join("\n");
}

export function catalogCandidateProvenance(catalog, bytes, manifest = loadSourceProvenance()) {
  validateSourceProvenance(manifest);
  return { schema_version: "1.0.0", status: "pending_source_license_review", catalog_sha256: hash(bytes),
    catalog_sources: structuredClone(catalog.sources), previous_terms_checked_on: manifest.checked_on,
    third_party_relicensed_as_mit: false, legal_review_status: "not_legally_reviewed",
    notice: thirdPartyNoticeMarkdown(manifest), source_provenance: structuredClone(manifest),
    required_review: ["Review each new source version and terms before adopting candidate metadata.", "Update exact source/resource hashes, attribution and modifications; regenerate notices; run offline checks."] };
}
