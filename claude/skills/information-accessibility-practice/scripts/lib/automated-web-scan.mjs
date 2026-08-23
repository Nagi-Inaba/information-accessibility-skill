import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectWebEvidence,
  settlePage,
  WebInspectionError,
  withWebInspectionSession
} from "../capture-web-evidence.mjs";
import { validateJsonSchema } from "./json-schema.mjs";

const LIMITS = { text: 2_000, contextItems: 100, contextNodes: 20, frameEntries: 50, contextBytes: 512 * 1024 };
const VERSIONS = { axe: "4.13.0", playwright: "1.62.1" };
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const RENDERING = {
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce"
};
const IMPACT_PRIORITY = new Map([["critical", 0], ["serious", 1], ["moderate", 2], ["minor", 3], [null, 4]]);
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);

export class AutomatedWebScanError extends Error {
  constructor(message, { exitCode = 4, code = "AUTOMATED_SCAN_ERROR", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AutomatedWebScanError";
    this.exitCode = exitCode;
    this.code = code;
  }
}

function error(message, exitCode, code, cause) {
  return new AutomatedWebScanError(message, { exitCode, code, cause });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
}

function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "withheld-invalid-url";
  }
}

export function truncateCodePoints(value, limit = LIMITS.text) {
  const points = Array.from(String(value ?? ""));
  return { value: points.slice(0, limit).join(""), truncated: points.length > limit };
}

export function successCriterionFromAxeTag(tag) {
  const match = /^wcag([1-4])([1-9])([0-9]+)$/u.exec(String(tag));
  return match ? `${match[1]}.${match[2]}.${Number(match[3])}` : null;
}

export function normalizeOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw error("Origin must be a valid absolute URL.", 2, "INVALID_ORIGIN", cause);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw error("Origin must use http or https.", 2, "INVALID_ORIGIN_PROTOCOL");
  if (url.username || url.password) throw error("Origin must not contain credentials.", 2, "ORIGIN_CREDENTIALS_DENIED");
  if (url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    throw error("Origin must not contain path, query, or fragment data.", 2, "ORIGIN_NOT_BARE");
  }
  if (url.hostname.endsWith(".")) throw error("Trailing-dot hostnames are not accepted.", 2, "TRAILING_DOT_ORIGIN");
  if (url.hostname.includes("*")) throw error("Wildcard origins are not accepted.", 2, "WILDCARD_ORIGIN");
  return url.origin;
}

export function profileRequirementMap(profileId, registry, catalog) {
  const profile = registry.profiles?.find((entry) => entry.id === profileId);
  if (!profile || profile.implementation_status !== "active" || profile.assessment_configuration?.active !== true) {
    throw error(`Profile is unknown or inactive: ${profileId}`, 2, "PROFILE_INACTIVE");
  }
  const map = new Map();
  for (const key of profile.assessment_configuration.catalog_keys ?? []) {
    for (const item of catalog.catalogs?.[key] ?? []) {
      map.set(item.success_criterion, [...new Set([...(map.get(item.success_criterion) ?? []), item.id])].sort());
    }
  }
  return map;
}

function criterionIds(tags, profileMap) {
  const ids = new Set();
  for (const tag of tags ?? []) {
    const criterion = successCriterionFromAxeTag(tag);
    for (const id of criterion ? (profileMap.get(criterion) ?? []) : []) ids.add(id);
  }
  return [...ids].sort();
}

function identitySelector(selector) {
  return String(selector)
    .replace(/:nth-(?:child|of-type)\(\s*\d+\s*\)/giu, ":nth-(*)")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeNode(node) {
  const html = truncateCodePoints(node.html);
  const failure = truncateCodePoints(node.failureSummary);
  const targets = (node.target ?? []).map(String).sort();
  return {
    targets,
    identity_targets: targets.map(identitySelector),
    html: html.value,
    html_truncated: html.truncated,
    failure_summary: failure.value,
    failure_summary_truncated: failure.truncated
  };
}

function normalizeRule(rule, kind, source, frame, engine, profileMap) {
  const profileIds = criterionIds(rule.tags, profileMap);
  const nodes = (rule.nodes ?? []).map(normalizeNode);
  const grouped = new Map();
  for (const node of nodes.length ? nodes : [{
    targets: [], identity_targets: [], html: "", html_truncated: false,
    failure_summary: "", failure_summary_truncated: false
  }]) {
    const identity = canonicalJson({
      engine,
      rule_id: rule.id,
      frame_path: frame.path,
      frame_url: sanitizeUrl(frame.url),
      targets: node.identity_targets,
      failure_summary: node.failure_summary,
      impact: rule.impact ?? null
    });
    const key = sha256(identity);
    grouped.set(key, [...(grouped.get(key) ?? []), node]);
  }
  return [...grouped].map(([dedupKey, groupedNodes]) => ({
    dedup_key: dedupKey,
    kind,
    source,
    rule_id: rule.id,
    impact: rule.impact ?? null,
    help: String(rule.help ?? ""),
    help_url: rule.helpUrl ?? null,
    tags: [...new Set(rule.tags ?? [])].sort(),
    criterion_relation: "reference_only",
    profile_requirement_ids: profileIds,
    occurrence_count: groupedNodes.length,
    frame: { path: frame.path, url: sanitizeUrl(frame.url) },
    nodes: groupedNodes.map(({ identity_targets: _ignored, ...node }) => node)
  }));
}

function ruleSummary(rule) {
  return {
    rule_id: rule.id,
    impact: rule.impact ?? null,
    help: String(rule.help ?? ""),
    help_url: rule.helpUrl ?? null,
    tags: [...new Set(rule.tags ?? [])].sort()
  };
}

function itemOrder(left, right) {
  return left.rule_id.localeCompare(right.rule_id, "en") || left.dedup_key.localeCompare(right.dedup_key, "en");
}

function sortItems(items) {
  return [...items].sort(itemOrder);
}

export function normalizeAxeResults({ axeResults, profileMap, frame, engine }) {
  const result = { machine_violations: [], review_candidates: [], unmapped_findings: [] };
  for (const rule of axeResults.violations ?? []) {
    for (const item of normalizeRule(rule, "machine_violation", "axe-core", frame, engine, profileMap)) {
      if (item.profile_requirement_ids.length) result.machine_violations.push(item);
      else result.unmapped_findings.push({ ...item, kind: "unmapped_finding" });
    }
  }
  for (const rule of axeResults.incomplete ?? []) {
    result.review_candidates.push(...normalizeRule(rule, "review_candidate", "axe-core", frame, engine, profileMap));
  }
  return {
    machine_violations: sortItems(result.machine_violations),
    review_candidates: sortItems(result.review_candidates),
    unmapped_findings: sortItems(result.unmapped_findings),
    machine_passes: (axeResults.passes ?? []).map(ruleSummary).sort((a, b) => a.rule_id.localeCompare(b.rule_id, "en")),
    inapplicable: (axeResults.inapplicable ?? []).map(ruleSummary).sort((a, b) => a.rule_id.localeCompare(b.rule_id, "en"))
  };
}

function contextPriority(item) {
  if (item.source === "axe-frame-error") return 0;
  if (item.source === "internal-reflow-probe") return 1;
  if (item.kind === "machine_violation") return 2 + (IMPACT_PRIORITY.get(item.impact ?? null) ?? 4);
  return 10 + (IMPACT_PRIORITY.get(item.impact ?? null) ?? 4);
}

function compactItem(item) {
  return {
    ...item,
    nodes: (item.nodes ?? []).slice(0, LIMITS.contextNodes),
    nodes_truncated: (item.nodes?.length ?? 0) > LIMITS.contextNodes
  };
}

function compactFrameCoverage(coverage) {
  const entries = (coverage.entries ?? []).slice(0, LIMITS.frameEntries);
  return {
    coverage_status: coverage.coverage_status,
    attempted: coverage.attempted,
    succeeded: coverage.succeeded,
    failed: coverage.failed,
    skipped: coverage.skipped,
    entries,
    entries_truncated: (coverage.entries?.length ?? 0) > entries.length,
    omitted_entries: Math.max(0, (coverage.entries?.length ?? 0) - entries.length)
  };
}

export function buildAutomatedScanContext(scan, sourceScanSha256) {
  const all = [...(scan.machine_violations ?? []), ...(scan.review_candidates ?? [])]
    .sort((a, b) => contextPriority(a) - contextPriority(b) || itemOrder(a, b));
  const included = all.slice(0, LIMITS.contextItems);
  const omitted = all.slice(LIMITS.contextItems);
  const context = {
    schema_version: "1.0.0",
    kind: "automated-web-scan-context",
    stability: "experimental",
    source_scan_sha256: sourceScanSha256,
    target: {
      requested_url: sanitizeUrl(scan.target.requested_url),
      final_url: sanitizeUrl(scan.target.final_url),
      http_status: scan.target.http_status,
      dom_sha256: scan.target.dom_sha256,
      ax_tree_sha256: scan.target.ax_tree_sha256
    },
    environment: scan.environment,
    frame_coverage: compactFrameCoverage(scan.frame_coverage),
    policy_summary: {
      dns_binding: scan.policy.dns_binding,
      blocked_request_count: scan.policy.blocked_request_count,
      blocked_requests_truncated: scan.policy.blocked_requests_truncated,
      blocked_channel_count: scan.policy.blocked_channel_count,
      blocked_channels_truncated: scan.policy.blocked_channels_truncated,
      active_channels_blocked: scan.policy.blocked_channels
    },
    summary: scan.summary,
    items: included.map(compactItem),
    focus_summary: {
      steps: scan.evidence?.focus_path?.length ?? 0,
      active_element: scan.evidence?.active_element ?? null
    },
    reflow_summary: scan.evidence?.reflow ?? null,
    truncation: {
      truncated: omitted.length > 0 || included.some((item) => (item.nodes?.length ?? 0) > LIMITS.contextNodes),
      omitted_items: omitted.length,
      omitted_nodes: omitted.reduce((n, item) => n + (item.nodes?.length ?? 0), 0)
        + included.reduce((n, item) => n + Math.max(0, (item.nodes?.length ?? 0) - LIMITS.contextNodes), 0),
      omitted_by_class: {
        machine_violations: omitted.filter((item) => item.kind === "machine_violation").length,
        review_candidates: omitted.filter((item) => item.kind === "review_candidate").length
      },
      reason: omitted.length > 0 || included.some((item) => (item.nodes?.length ?? 0) > LIMITS.contextNodes)
        ? "context_limit" : "none"
    }
  };
  while (Buffer.byteLength(JSON.stringify(context), "utf8") > LIMITS.contextBytes && context.items.length) {
    const removed = context.items.pop();
    context.truncation.truncated = true;
    context.truncation.omitted_items += 1;
    context.truncation.omitted_nodes += removed.nodes?.length ?? 0;
    context.truncation.omitted_by_class[removed.kind === "machine_violation" ? "machine_violations" : "review_candidates"] += 1;
    context.truncation.reason = "context_limit";
  }
  if (Buffer.byteLength(JSON.stringify(context), "utf8") > LIMITS.contextBytes) {
    throw error("Compact scan context exceeds the 512 KiB limit even without item details.", 5, "CONTEXT_SIZE_LIMIT");
  }
  return context;
}

export function scanSha256(scan) {
  return sha256(canonicalJson(scan));
}

function packageVersion(name) {
  return readJson(require.resolve(`${name}/package.json`)).version;
}

async function loadAxe() {
  let imported;
  try {
    imported = await import("axe-core");
  } catch (cause) {
    throw error(`axe-core is not installed. Install axe-core@${VERSIONS.axe} and retry.`, 4, "AXE_MISSING", cause);
  }
  const version = packageVersion("axe-core");
  if (version !== VERSIONS.axe) throw error(`Unsupported axe-core version ${version}; expected ${VERSIONS.axe}.`, 4, "AXE_VERSION_UNSUPPORTED");
  return { axe: imported.default ?? imported, version };
}

function assertPlaywrightVersion() {
  let version;
  try {
    version = packageVersion("playwright");
  } catch (cause) {
    throw error(`Playwright is not installed. Install playwright@${VERSIONS.playwright} and Chromium, then retry.`, 4, "PLAYWRIGHT_MISSING", cause);
  }
  if (version !== VERSIONS.playwright) {
    throw error(`Unsupported Playwright version ${version}; expected ${VERSIONS.playwright}.`, 4, "PLAYWRIGHT_VERSION_UNSUPPORTED");
  }
  return version;
}

function framePath(frame, frames) {
  const indexes = [];
  for (let current = frame; current; current = current.parentFrame()) indexes.unshift(frames.indexOf(current));
  return indexes.join(".");
}

async function runAxeInFrame(frame, source) {
  return frame.evaluate(async (axeSource) => {
    Function(axeSource)();
    return globalThis.axe.run(document, { resultTypes: ["violations", "incomplete", "passes", "inapplicable"] });
  }, source);
}

function mergeNormalized(target, value) {
  for (const key of ["machine_violations", "review_candidates", "unmapped_findings", "machine_passes", "inapplicable"]) {
    target[key].push(...value[key]);
  }
}

function uniqueRuleSummaries(items) {
  const byId = new Map();
  for (const item of items) if (!byId.has(item.rule_id)) byId.set(item.rule_id, item);
  return [...byId.values()].sort((a, b) => a.rule_id.localeCompare(b.rule_id, "en"));
}

async function reflowProbe(page, width, primaryViewport, profileMap) {
  await page.setViewportSize({ width, height: primaryViewport.height });
  try {
    await settlePage(page);
    const measured = await page.evaluate(() => {
      const candidates = [];
      for (const element of document.querySelectorAll("body *")) {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || (rect.right <= innerWidth + 1 && rect.left >= -1)) continue;
        let explicitScroller = false;
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const parentStyle = getComputedStyle(parent);
          if (["auto", "scroll"].includes(parentStyle.overflowX) && parent.scrollWidth > parent.clientWidth) {
            explicitScroller = true;
            break;
          }
        }
        if (!explicitScroller) {
          candidates.push({
            selector: element.id ? `#${CSS.escape(element.id)}` : element.tagName.toLowerCase(),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width)
          });
        }
        if (candidates.length >= 50) break;
      }
      return {
        document_scroll_width: document.documentElement.scrollWidth,
        document_client_width: document.documentElement.clientWidth,
        candidates
      };
    });
    return {
      captured_at: new Date().toISOString(),
      viewport: { width, height: primaryViewport.height },
      ...measured,
      profile_requirement_ids: profileMap.get("1.4.10") ?? []
    };
  } finally {
    await page.setViewportSize(primaryViewport);
    await settlePage(page);
  }
}

function validate(value, file, label) {
  const errors = [];
  validateJsonSchema(value, readJson(file), "$", errors);
  if (errors.length) throw error(`${label} schema validation failed:\n- ${errors.join("\n- ")}`, 5, "SCAN_SCHEMA_INVALID");
}

function coverageStatus({ attempted, succeeded, failed, skipped }) {
  if (!attempted || !succeeded) return "none";
  return failed || skipped ? "partial" : "complete";
}

export async function runAutomatedWebScan(options) {
  const registry = readJson(path.join(skillRoot, "references", "standards-registry.json"));
  const catalog = readJson(path.join(skillRoot, "references", "criteria-catalog.json"));
  const profileMap = profileRequirementMap(options.profile, registry, catalog);
  const playwrightVersion = assertPlaywrightVersion();
  const { axe, version: axeVersion } = await loadAxe();
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const inspectionOptions = {
    ...options,
    allowedMethods: new Set(["GET", "HEAD"]),
    acceptDownloads: false,
    blockActiveNetworkChannels: true,
    blockServiceWorkers: true,
    guardFocusNavigation: true,
    includeBlockReasons: true,
    includeNetworkPolicyDetails: true,
    pinResolvedHosts: true,
    revalidateRequests: true,
    renderingProfile: RENDERING,
    settleBeforeInspection: true
  };

  try {
    return await withWebInspectionSession(inspectionOptions, async (session) => {
      const aggregate = { machine_violations: [], review_candidates: [], unmapped_findings: [], machine_passes: [], inapplicable: [] };
      const entries = [];
      const rawResults = [];
      const frames = session.page.frames();
      for (const frame of frames) {
        const descriptor = { url: frame.url(), path: framePath(frame, frames) };
        try {
          const result = await runAxeInFrame(frame, axe.source);
          rawResults.push({ frame: descriptor, result });
          mergeNormalized(aggregate, normalizeAxeResults({
            axeResults: result,
            profileMap,
            frame: descriptor,
            engine: { name: "axe-core", version: axeVersion }
          }));
          entries.push({ frame_path: descriptor.path, url: sanitizeUrl(descriptor.url), status: "succeeded", reason: null });
        } catch (caught) {
          const reason = truncateCodePoints(caught instanceof Error ? caught.message : String(caught), 500).value;
          entries.push({ frame_path: descriptor.path, url: sanitizeUrl(descriptor.url), status: "failed", reason });
          aggregate.review_candidates.push({
            dedup_key: sha256(`frame-error:${descriptor.path}:${sanitizeUrl(descriptor.url)}:${reason}`),
            kind: "review_candidate",
            source: "axe-frame-error",
            rule_id: "frame-scan",
            impact: null,
            help: "Frame could not be scanned automatically",
            help_url: null,
            tags: [],
            criterion_relation: "reference_only",
            profile_requirement_ids: [],
            occurrence_count: 1,
            frame: { path: descriptor.path, url: sanitizeUrl(descriptor.url) },
            nodes: []
          });
        }
      }

      const evidence = await collectWebEvidence(session, inspectionOptions);
      const reflow = await reflowProbe(session.page, options.reflowWidth ?? 320, viewport, profileMap);
      if (reflow.candidates.length) {
        aggregate.review_candidates.push({
          dedup_key: sha256(canonicalJson({ rule: "reflow-overflow", candidates: reflow.candidates })),
          kind: "review_candidate",
          source: "internal-reflow-probe",
          rule_id: "reflow-overflow",
          impact: null,
          help: "Horizontal overflow detected at the 320 CSS-pixel proxy viewport",
          help_url: null,
          tags: ["wcag1410"],
          criterion_relation: "reference_only",
          profile_requirement_ids: reflow.profile_requirement_ids,
          occurrence_count: reflow.candidates.length,
          frame: { path: "0", url: sanitizeUrl(session.finalUrl.href) },
          nodes: []
        });
      }

      aggregate.machine_violations = sortItems(aggregate.machine_violations);
      aggregate.review_candidates = sortItems(aggregate.review_candidates);
      aggregate.unmapped_findings = sortItems(aggregate.unmapped_findings);
      aggregate.machine_passes = uniqueRuleSummaries(aggregate.machine_passes);
      aggregate.inapplicable = uniqueRuleSummaries(aggregate.inapplicable);

      const frameCoverage = {
        attempted: entries.length,
        succeeded: entries.filter((entry) => entry.status === "succeeded").length,
        failed: entries.filter((entry) => entry.status === "failed").length,
        skipped: entries.filter((entry) => entry.status === "skipped").length,
        entries
      };
      frameCoverage.coverage_status = coverageStatus(frameCoverage);
      const scan = {
        schema_version: "1.0.0",
        kind: "automated-web-scan",
        scan_status: "complete",
        captured_at: new Date().toISOString(),
        profile: { id: options.profile, registry_version: registry.schema_version },
        target: evidence.target,
        environment: {
          ...evidence.environment,
          scanner: { name: "axe-core", version: axeVersion },
          playwright_version: playwrightVersion
        },
        frame_coverage: frameCoverage,
        policy: {
          allowed_origins: evidence.network.allowed_origins,
          blocked_request_count: evidence.network.blocked_request_count,
          blocked_requests_truncated: evidence.network.blocked_requests_truncated,
          blocked_channels: evidence.network.blocked_channels,
          blocked_channel_count: evidence.network.blocked_channel_count,
          blocked_channels_truncated: evidence.network.blocked_channels_truncated,
          dns_binding: evidence.network.dns_binding,
          pinned_endpoints: evidence.network.pinned_endpoints,
          reflow_width: options.reflowWidth ?? 320
        },
        summary: {
          machine_violations: aggregate.machine_violations.length,
          review_candidates: aggregate.review_candidates.length,
          unmapped_findings: aggregate.unmapped_findings.length,
          machine_pass_rules: aggregate.machine_passes.length,
          inapplicable_rules: aggregate.inapplicable.length
        },
        machine_violations: aggregate.machine_violations,
        review_candidates: aggregate.review_candidates,
        unmapped_findings: aggregate.unmapped_findings,
        machine_passes: aggregate.machine_passes,
        inapplicable: aggregate.inapplicable,
        evidence: {
          ...evidence.evidence,
          reflow,
          blocked_requests: evidence.network.blocked_requests
        },
        raw_result_sha256: sha256(canonicalJson(rawResults)),
        interpretation: "Automated scan results are machine observations and do not by themselves determine formal WCAG conformance."
      };
      validate(scan, path.join(skillRoot, "references", "automated-web-scan.schema.json"), "Automated scan");
      const context = buildAutomatedScanContext(scan, scanSha256(scan));
      validate(context, path.join(skillRoot, "references", "automated-web-scan-context.schema.json"), "Automated scan context");
      return { scan, context };
    });
  } catch (caught) {
    if (caught instanceof AutomatedWebScanError || caught instanceof WebInspectionError) throw caught;
    throw error(caught instanceof Error ? caught.message : String(caught), 4, "SCAN_RUNTIME_FAILURE", caught instanceof Error ? caught : undefined);
  }
}
