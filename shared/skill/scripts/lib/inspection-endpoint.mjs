import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { normalizeIpLiteral, isPrivateAddress, isExplicitLoopback } from "./network-address.mjs";

export class WebInspectionError extends Error {
  constructor(message, { exitCode = 3, code = "WEB_INSPECTION_ERROR", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "WebInspectionError";
    this.exitCode = exitCode;
    this.code = code;
  }
}

export function sanitizeNetworkUrl(value) {
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

export function parseTargetUrl(value, { allowLocalhost = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new WebInspectionError("Target URL is invalid.", { exitCode: 2, code: "INVALID_TARGET_URL", cause });
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new WebInspectionError("Target URL must use http or https.", { exitCode: 3, code: "UNSAFE_TARGET_PROTOCOL" });
  }
  if (url.username || url.password) {
    throw new WebInspectionError("Target URL must not contain credentials.", { exitCode: 3, code: "TARGET_CREDENTIALS_DENIED" });
  }
  if (!allowLocalhost && isExplicitLoopback(url.hostname)) {
    throw new WebInspectionError("Localhost targets require --allow-localhost.", { exitCode: 3, code: "LOCALHOST_DENIED" });
  }
  return url;
}

export async function resolveInspectionEndpoint(url, { allowLocalhost = false } = {}) {
  const hostname = normalizeIpLiteral(url.hostname);
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname) && !(allowLocalhost && isExplicitLoopback(hostname))) {
      throw new WebInspectionError("Private, loopback, link-local, or reserved target addresses are denied by default.", {
        exitCode: 3,
        code: "PRIVATE_ADDRESS_DENIED"
      });
    }
    return { hostname, address: hostname, family: isIP(hostname) };
  }

  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch (cause) {
    throw new WebInspectionError("Target hostname did not resolve.", { exitCode: 3, code: "DNS_RESOLUTION_FAILED", cause });
  }
  if (!records.length) {
    throw new WebInspectionError("Target hostname did not resolve.", { exitCode: 3, code: "DNS_RESOLUTION_FAILED" });
  }
  if (records.some((record) => isPrivateAddress(record.address))) {
    const loopbackOnly = records.every((record) => isExplicitLoopback(record.address));
    if (!(allowLocalhost && isExplicitLoopback(hostname) && loopbackOnly)) {
      throw new WebInspectionError("Target hostname resolves to a private, loopback, link-local, or reserved address.", {
        exitCode: 3,
        code: "PRIVATE_DNS_RESULT_DENIED"
      });
    }
  }
  const preferred = records.find((record) => record.family === 4) ?? records[0];
  return { hostname, address: normalizeIpLiteral(preferred.address), family: preferred.family };
}

export function buildHostResolverRules(endpoints) {
  const maps = [];
  const exclusions = [];
  for (const endpoint of endpoints) {
    if (isIP(endpoint.hostname)) {
      exclusions.push(`EXCLUDE ${endpoint.hostname}`);
      continue;
    }
    const address = endpoint.family === 6 ? `[${endpoint.address}]` : endpoint.address;
    maps.push(`MAP ${endpoint.hostname} ${address}`);
  }
  return [...maps, ...exclusions, "MAP * ~NOTFOUND"].join(", ");
}
