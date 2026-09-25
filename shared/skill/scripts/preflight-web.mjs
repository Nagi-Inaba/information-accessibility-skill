import path from "node:path";
import { pathToFileURL } from "node:url";
import { preflightWeb, validateRequiredCapabilities } from "./lib/web-capabilities.mjs";
import { normalizeRuntimeLocale, runtimeLocaleFromEnvironment } from "./lib/runtime-locale.mjs";

export function parsePreflightArgs(argv) {
  const options = { format: "text", locale: runtimeLocaleFromEnvironment("en") };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!["--format", "--locale", "--browser-channel", "--require"].includes(flag) || seen.has(flag)) throw new Error(`Unknown or duplicate argument: ${flag}`);
    seen.add(flag);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (flag === "--format") options.format = value;
    if (flag === "--locale") options.locale = value;
    if (flag === "--browser-channel") options.browserChannel = value;
    if (flag === "--require") options.required = validateRequiredCapabilities(value.split(","));
  }
  if (!["text", "json"].includes(options.format)) throw new Error("--format must be text or json");
  if (options.browserChannel !== undefined && options.browserChannel !== "chrome") throw new Error("--browser-channel accepts only chrome.");
  options.locale = normalizeRuntimeLocale(options.locale, "en");
  return options;
}

export function renderPreflightText(report, locale = "en") {
  const ja = locale === "ja";
  const nextJa = {
    browser_dom: "対応するブラウザ環境を導入し、対象の描画後DOMを確認してください。",
    accessibility_tree: "AXツリーを取得できる環境で、対象のrole・name・関係を確認してください。",
    keyboard_input: "対象で合意済みのキーボード操作を行い、フォーカスと状態変化を記録してください。",
    responsive_viewport: "合意した画面幅で対象を確認し、人によるリフロー検査を行ってください。",
    screen_reader_runtime: "人によるスクリーンリーダー実機確認を行い、OS・ブラウザ・支援技術の版と結果を記録してください。",
    network_fetch: "通信制御の動作を確認し、明示したorigin・権限の範囲で対象への接続を確認してください。"
  };
  return [
    `${ja ? "Web検査環境の事前確認" : "Web capability preflight"}: ${report.status}`,
    ja ? "固定fixtureの動作確認です。対象の検査完了や規格適合を示しません。" : "Fixed-fixture probe only; this is not completed target inspection or conformance evidence.",
    ...report.capabilities.map((item) => `${item.id}: ${item.status} (${item.reason})${item.status === "available" ? "" : `\n  ${ja ? "未確認・次のテスト" : "Unconfirmed; next test"}: ${ja ? nextJa[item.id] : item.next_test}`}`),
    `${ja ? "必要機能の不足" : "Missing required"}: ${report.missing_required.join(", ") || (ja ? "なし" : "none")}`
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try { options = parsePreflightArgs(argv); }
  catch (error) { process.stderr.write(`${error.message}\n`); return 2; }
  const report = await preflightWeb(options);
  process.stdout.write(`${options.format === "json" ? JSON.stringify(report, null, 2) : renderPreflightText(report, options.locale)}\n`);
  return report.status === "ready" ? 0 : 4;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = await main(); }
  catch { process.stderr.write("Web preflight could not finish; target checks remain unconfirmed.\n"); process.exitCode = 4; }
}
