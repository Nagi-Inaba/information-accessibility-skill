import { isIP } from "node:net";

// Single source of truth for "is this address or host non-public?". The browser/HTTP network guards and both
// public-report redactors must agree, so none of them keeps a private copy of these rules. Unknown, malformed
// and special-use space fails closed.

export function normalizeIpLiteral(value) {
  return String(value)
    .trim()
    .replace(/^\[|\]$/gu, "")
    .replace(/%.+$/u, "")
    .toLowerCase();
}

export function isPrivateIpv4(address) {
  const parts = String(address).split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return true;
  const octets = parts.map(Number);
  if (octets.some((value) => value > 255)) return true;
  const [a, b, c] = octets;
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function mappedIpv4FromIpv6(address) {
  const lower = normalizeIpLiteral(address);
  if (!lower.startsWith("::ffff:")) return null;
  const dottedMatch = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(lower);
  if (dottedMatch) return dottedMatch[1];
  if (!lower.startsWith("::ffff:")) return null;
  const tail = lower.slice("::ffff:".length).split(":");
  if (tail.length !== 2 || tail.some((part) => !/^[a-f0-9]{1,4}$/u.test(part))) return null;
  const high = Number.parseInt(tail[0], 16);
  const low = Number.parseInt(tail[1], 16);
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

// True for an IPv4/IPv6 literal outside globally routable unicast space. Anything else returns false;
// use isNonPublicHostname when the input may be a DNS name.
export function isPrivateAddress(value) {
  let address = normalizeIpLiteral(value);
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family !== 6) return false;
  address = new URL(`http://[${address}]/`).hostname.slice(1, -1);

  const mapped = mappedIpv4FromIpv6(address);
  if (mapped) return isPrivateIpv4(mapped);

  if (address === "::" || address === "::1") return true;
  const firstGroup = Number.parseInt(address.split(":")[0] || "0", 16);
  // Fail closed outside globally routable unicast, including site-local,
  // discard-only, NAT64 and other special-use prefixes.
  if ((firstGroup & 0xe000) !== 0x2000) return true;
  if (firstGroup === 0x2001 && Number.parseInt(address.split(":")[1] || "0", 16) < 0x200) return true;
  if (firstGroup === 0x3fff && Number.parseInt(address.split(":")[1] || "0", 16) < 0x1000) return true;
  if ((firstGroup & 0xffc0) === 0xfe80) return true;
  if ((firstGroup & 0xfe00) === 0xfc00) return true;
  if ((firstGroup & 0xff00) === 0xff00) return true;
  if (address.startsWith("2001:db8:") || address === "2001:db8::") return true;
  if (address.startsWith("2001:0:") || address === "2001::") return true;
  if (address.startsWith("2002:")) return true;
  return false;
}

export function isExplicitLoopback(hostname) {
  const normalized = normalizeIpLiteral(hostname);
  return normalized === "localhost"
    || normalized === "localhost.localdomain"
    || normalized === "::1"
    || (isIP(normalized) === 4 && normalized.startsWith("127."));
}

const reservedHostnameSuffixes = [
  "local",
  "lan",
  "internal",
  "localhost",
  "invalid",
  "test",
  "example",
  "corp",
  "localdomain",
  "home.arpa"
];

export function hasReservedHostnameSuffix(hostname) {
  const normalized = String(hostname).toLowerCase().replace(/\.$/u, "");
  return reservedHostnameSuffixes.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`));
}

// True when a URL hostname must not appear in public output: non-global IP literals, single-label names,
// and names under suffixes reserved for local or documentation use.
export function isNonPublicHostname(hostname) {
  const normalized = normalizeIpLiteral(hostname).replace(/\.$/u, "");
  if (isIP(normalized)) return isPrivateAddress(normalized);
  return normalized === "localhost" || !normalized.includes(".") || hasReservedHostnameSuffix(normalized);
}
