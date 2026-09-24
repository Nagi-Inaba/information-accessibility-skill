import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const sources = [
  { id: "WCAG-2.2", url: "https://www.w3.org/TR/WCAG22/" },
  { id: "WCAG-2.2-ERRATA", url: "https://www.w3.org/WAI/WCAG22/errata/" },
  { id: "WCAG-2.2-UNDERSTANDING", url: "https://www.w3.org/WAI/WCAG22/Understanding/intro" },
  { id: "WCAG-2.2-TECHNIQUES", url: "https://www.w3.org/WAI/WCAG22/Techniques/" },
  { id: "ACT-RULES", url: "https://www.w3.org/WAI/standards-guidelines/act/rules/" },
  { id: "WAIC-JIS-CHECKLIST-2020-12", url: "https://waic.jp/docs/jis2016/test-guidelines/202012/gcl_example.html" },
  { id: "WAIC-JIS-UNDERSTANDING", url: "https://waic.jp/docs/jis2016/understanding/201604/" },
  { id: "DIGITAL-AGENCY-JP-PROFILE", url: "https://www.digital.go.jp/accessibility-statement" },
  { id: "WAI-ARIA-1.2", url: "https://www.w3.org/TR/wai-aria-1.2/" }
];
const allowedHosts = new Set(["www.w3.org", "waic.jp", "www.digital.go.jp"]);
const maxBytes = 4 * 1024 * 1024;

function safeUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname) || parsed.username || parsed.password) {
    throw new Error(`Unexpected source URL: ${value}`);
  }
  return parsed;
}

async function inspectSource(source, fetchImpl) {
  let url = source.url;
  const redirects = [];
  for (let hop = 0; hop <= 3; hop += 1) {
    safeUrl(url);
    const response = await fetchImpl(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: { "user-agent": "information-accessibility-skill-source-monitor/1.0" }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || hop === 3) throw new Error("Redirect missing a location or exceeded three hops");
      url = safeUrl(new URL(location, url).href).href;
      redirects.push({ status: response.status, url });
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
    return {
      id: source.id, url: source.url, final_url: url, redirects,
      http_status: response.status, etag: response.headers.get("etag"),
      last_modified: response.headers.get("last-modified"), bytes: size,
      sha256: crypto.createHash("sha256").update(Buffer.concat(chunks)).digest("hex")
    };
  }
  throw new Error("Redirect limit exceeded");
}

export async function monitorSources(entries, baseline, fetchImpl = fetch) {
  return Promise.all(entries.map(async (source) => {
    const previous = baseline[source.id];
    try {
      const result = await inspectSource(source, fetchImpl);
      const changes = [];
      if (!previous) changes.push("unbaselined");
      else {
        if (result.sha256 !== previous.sha256) changes.push("content_changed");
        if (result.final_url !== previous.final_url) changes.push("redirect_changed");
      }
      return { ...result, baseline_sha256: previous?.sha256 ?? null, changes };
    } catch (error) {
      return { id: source.id, url: source.url, baseline_sha256: previous?.sha256 ?? null,
        changes: ["unavailable"], error: error.message };
    }
  }));
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

async function main() {
  const outputArg = argument("--output-dir");
  if (!outputArg) throw new Error("--output-dir is required");
  const outputDir = path.resolve(outputArg);
  for (const name of ["report.json", "review.md"]) {
    if (fs.existsSync(path.join(outputDir, name))) throw new Error(`Refusing to overwrite ${name}`);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const baseline = JSON.parse(fs.readFileSync(path.join(root, "scripts", "source-monitor-baseline.json"), "utf8"));
  const results = await monitorSources(sources, baseline);
  const report = { observed_at: new Date().toISOString(), review_status: "human_review_required_for_changes",
    sources: results };
  const lines = ["# 公式資料の監視候補", "", `確認時刻: ${report.observed_at}`, "",
    "内容変更・転送先変更・取得失敗は人手確認の候補です。hashの差だけで規格変更とは判断しません。", "",
    "| 資料 | 状態 | 現在のURL | SHA-256 |", "| --- | --- | --- | --- |",
    ...results.map((item) => `| ${item.id} | ${item.changes.join(", ") || "unchanged"} | ${item.final_url ?? item.url} | ${item.sha256 ?? "取得失敗"} |`),
    "", "正本の更新と last_verified_at の記録は、差分・出典条件・影響を確認した後に行ってください。", ""];
  fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  fs.writeFileSync(path.join(outputDir, "review.md"), lines.join("\n"), { flag: "wx" });
  console.log(JSON.stringify({ output_dir: outputDir, changed: results.filter((item) => item.changes.length).map((item) => item.id) }));
  if (results.some((item) => item.changes.length)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
