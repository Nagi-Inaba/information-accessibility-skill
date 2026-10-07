// Public-report text sanitizer: withholds local paths, non-public hosts, branch names and machine identifiers
// from report strings. Pure string functions; no file or network access.
import { hasReservedHostnameSuffix, isNonPublicHostname, isPrivateAddress, isPrivateIpv4 } from "./network-address.mjs";
import { isIP } from "node:net";

const publicWithheldLabel = "Withheld from public report";

function isLocalPathLike(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return /\bfile:(?:\/{0,2})/iu.test(normalized)
    || /[A-Za-z]:[\\/]/u.test(normalized)
    || /\\\\[^\s\\]/u.test(normalized)
    || /^\/\//u.test(normalized)
    || /[^:]\/\/[^\/\s]/u.test(normalized)
    || /(?:^|[^A-Za-z0-9])\/(?!\/)[^\s]/u.test(normalized)
    || /(?:^|[^A-Za-z0-9])(?:~[\\/]|\.{1,2}[\\/])/u.test(normalized);
}

function isMachineSpecificEnvironmentValue(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  const ipv4Tokens = normalized.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu) ?? [];
  const ipv6Tokens = normalized.match(/(?<![A-Za-z0-9_:-])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![A-Za-z0-9_:-])/gu) ?? [];
  const hostnameTokens = normalized.match(/\b[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}\.)+[A-Za-z0-9-]{1,63}\b/gu) ?? [];
  const contextualHostname = /\b(?:(?:Windows(?:\s+\d+(?:\.\d+)*)?|macOS(?:\s+\d+(?:\.\d+)*)?|Linux(?:\s+\d+(?:\.\d+)*)?|Android(?:\s+\d+(?:\.\d+)*)?|iOS(?:\s+\d+(?:\.\d+)*)?)\s+on\s+[A-Za-z0-9][A-Za-z0-9.-]*|(?:hostname|host|machine|device)\s*[:=]\s*[A-Za-z0-9][A-Za-z0-9.-]*|hostname\s+is\s+[A-Za-z0-9][A-Za-z0-9.-]*)\b/iu;
  const identifierIsHostname = [...normalized.matchAll(/\b(?:host|machine|device)\s+is\s+([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)\b/giu)]
    .some((match) => /[0-9.-]/u.test(match[1]));
  return /\blocalhost\b/iu.test(normalized)
    || hostnameTokens.some((token) => hasReservedHostnameSuffix(token))
    || ipv4Tokens.some((token) => isPrivateIpv4(token))
    || ipv6Tokens.some((token) => isIP(token) === 6 && isPrivateAddress(token))
    || contextualHostname.test(normalized)
    || identifierIsHostname
    || /\b(?:DESKTOP|LAPTOP)-[A-Za-z0-9-]+\b/iu.test(normalized)
    || /\b[A-Za-z0-9][A-Za-z0-9._-]*-(?:PC|MAC|LAPTOP|DESKTOP|WS[0-9A-Z-]{2,})\b/iu.test(normalized)
    || /\b(?:WIN|MAC|HOST)-[A-Za-z0-9-]{3,}\b/iu.test(normalized)
    || /\b[A-Za-z0-9][A-Za-z0-9_-]*\.(?:local|lan)\b/iu.test(normalized);
}

function isBranchLikeVersion(value) {
  return typeof value === "string" && /[\\/]/u.test(value.trim());
}

export function publicUrlOrFile(value) {
  const normalized = value.trim();
  if (normalized === publicWithheldLabel) return normalized;
  if (!/^https?:\/\//iu.test(normalized)) return publicWithheldLabel;
  const afterInitialScheme = normalized.replace(/^https?:\/\//iu, "");
  if (/https?:\/\//iu.test(afterInitialScheme)) return publicWithheldLabel;
  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)
        || parsed.username
        || parsed.password
        || parsed.search
        || parsed.hash
        || isNonPublicHostname(parsed.hostname)) {
      return publicWithheldLabel;
    }
    return normalized;
  } catch {
    return publicWithheldLabel;
  }
}

// Extend this allowlist only for stable public semantic sequences that use slash as prose, not paths.
const publicSafeSlashSequences = new Set([
  "Node.js/PDF.js",
  "WCAG/JIS/EN",
  "pass/fail/unknown",
  "input/output/error"
]);

function hasUnsafeSlashToken(value) {
  const slashTokens = value.match(/\S*[\\/]\S*/gu) ?? [];
  const leadingWrappers = new Set(["(", "[", "{", "\"", "'", "“", "‘"]);
  const trailingWrappersAndPunctuation = new Set([")", "]", "}", "\"", "'", "”", "’", ".", ",", ";", ":", "!", "?"]);
  return slashTokens.some((token) => {
    let start = 0;
    let end = token.length;
    while (start < end && leadingWrappers.has(token[start])) start += 1;
    while (end > start && trailingWrappersAndPunctuation.has(token[end - 1])) end -= 1;
    return !publicSafeSlashSequences.has(token.slice(start, end));
  });
}

function hasBranchReference(value) {
  const knownBranchNames = new Set(["main", "master", "develop", "dev", "trunk", "head"]);
  const isBranchIdentifier = (token) => knownBranchNames.has(token.toLowerCase()) || /[0-9._\\/-]/u.test(token);
  const explicitLabel = value.match(/\bbranch\s*[:=]\s*([A-Za-z0-9](?:[A-Za-z0-9._\\/-]*[A-Za-z0-9])?)\b/iu);
  const gitBranch = value.match(/\bgit\s+branch\s+([A-Za-z0-9](?:[A-Za-z0-9._\\/-]*[A-Za-z0-9])?)\b/iu);
  const prefixBranches = value.matchAll(/\bbranch\s+([A-Za-z0-9](?:[A-Za-z0-9._\\/-]*[A-Za-z0-9])?)\b/giu);
  const suffixBranches = value.matchAll(/\b([A-Za-z0-9](?:[A-Za-z0-9._\\/-]*[A-Za-z0-9])?)\s+branch\b(?!\s+offices?\b)/giu);
  return Boolean(explicitLabel || gitBranch)
    || [...prefixBranches].some((match) => isBranchIdentifier(match[1]))
    || [...suffixBranches].some((match) => isBranchIdentifier(match[1]));
}

function sanitizePublicString(value) {
  const normalized = value.trim();
  if (normalized === publicWithheldLabel) return normalized;
  const httpPattern = /\bhttps?:\/\/\S+/giu;
  const httpUrls = [...normalized.matchAll(httpPattern)].map((match) => match[0]);
  if (httpUrls.some((httpUrl) => publicUrlOrFile(httpUrl) === publicWithheldLabel)) return publicWithheldLabel;
  const textWithoutHttpUrls = normalized.replace(httpPattern, " ");
  if (/\bhttps?:/iu.test(textWithoutHttpUrls)
      || isLocalPathLike(textWithoutHttpUrls)
      || hasUnsafeSlashToken(textWithoutHttpUrls)
      || hasBranchReference(textWithoutHttpUrls)
      || isMachineSpecificEnvironmentValue(textWithoutHttpUrls)) {
    return publicWithheldLabel;
  }
  return normalized;
}

function sanitizePublicVersion(value) {
  const normalized = value.trim();
  if (normalized === publicWithheldLabel) return normalized;
  if (sanitizePublicString(normalized) === publicWithheldLabel
      || /^(?:main|master|develop|dev|trunk|HEAD)$/iu.test(normalized)
      || /[\\/]/u.test(normalized)) {
    return publicWithheldLabel;
  }
  const semanticVersion = /^v?\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u;
  const releaseNumber = /^(?:release|rel)[-_]v?\d+(?:[._-]\d+){0,3}$/iu;
  const calendarDate = /^\d{4}[-.]\d{2}[-.]\d{2}$/u;
  const commitHash = /^[a-f0-9]{7,64}$/iu;
  return [semanticVersion, releaseNumber, calendarDate, commitHash].some((pattern) => pattern.test(normalized))
    ? normalized
    : publicWithheldLabel;
}

export function sanitizePublicModelStrings(value, pathParts = []) {
  if (typeof value === "string") {
    if (pathParts[0] === "target" && pathParts[1] === "urls_or_files") return publicUrlOrFile(value);
    if (pathParts[0] === "target" && pathParts[1] === "version_or_commit") return sanitizePublicVersion(value);
    return sanitizePublicString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizePublicModelStrings(item, [...pathParts, index]));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key, sanitizePublicModelStrings(item, [...pathParts, key])]));
  }
  return value;
}

export function publicLocation(value) {
  return sanitizePublicString(value);
}

export function publicText(value, { branchLike = false, environment = false } = {}) {
  const sanitized = sanitizePublicString(value);
  if (sanitized === publicWithheldLabel
      || (branchLike && isBranchLikeVersion(sanitized))
      || (environment && isMachineSpecificEnvironmentValue(sanitized))) return publicWithheldLabel;
  return sanitized;
}
