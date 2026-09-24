import crypto from "node:crypto";

// RFC 8785 / ECMAScript primitive serialization with locale-independent UTF-16
// property ordering. Unlike canonical-json.mjs, this is a signature protocol;
// the existing artifact hash representation is intentionally not changed.
export function canonicalAttestationJson(value) {
  const ancestors = new Set();
  let nodes = 0;
  const string = (value) => {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("Attestation JSON contains an unpaired surrogate.");
      } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error("Attestation JSON contains an unpaired surrogate.");
    }
    return JSON.stringify(value);
  };
  const visit = (item, depth = 0) => {
    if (++nodes > 100_000 || depth > 64) throw new Error("Attestation JSON exceeds structural limits.");
    if (item === null || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "string") return string(item);
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("Attestation JSON requires finite numbers.");
      return JSON.stringify(item);
    }
    if (typeof item !== "object" || ancestors.has(item)) throw new Error("Attestation JSON must contain acyclic JSON values.");
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error("Attestation JSON requires plain objects.");
    if (Object.getOwnPropertySymbols(item).length) throw new Error("Attestation JSON cannot contain symbol properties.");
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Object.values(descriptors).some((entry) => entry.get || entry.set)) throw new Error("Attestation JSON cannot contain accessors.");
    ancestors.add(item);
    let serialized;
    if (Array.isArray(item)) {
      if (Object.getOwnPropertyNames(item).length !== item.length + 1 || Object.keys(item).length !== item.length
          || !Object.keys(item).every((key, i) => key === String(i))) throw new Error("Attestation JSON requires dense arrays without extra properties.");
      serialized = `[${item.map((value) => visit(value, depth + 1)).join(",")}]`;
    } else {
      if (Object.values(descriptors).some((entry) => !entry.enumerable)) throw new Error("Attestation JSON cannot contain hidden properties.");
      serialized = `{${Object.keys(item).sort().map((key) => `${string(key)}:${visit(item[key], depth + 1)}`).join(",")}}`;
    }
    ancestors.delete(item);
    return serialized;
  };
  const text = visit(value);
  if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error("Attestation JSON exceeds eight MiB.");
  return text;
}

export const attestationDigest = (value) => crypto.createHash("sha256").update(canonicalAttestationJson(value), "utf8").digest("hex");

// Reject duplicate keys before JSON.parse can discard an earlier value. This
// parser is deliberately used at the external signature/trust boundary only.
export function parseAttestationJson(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length > 8 * 1024 * 1024) throw new Error("Attestation input exceeds eight MiB.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  let offset = 0, nodes = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/u.test(text[offset] ?? "") && offset < text.length) offset++; };
  const token = () => {
    const start = offset++;
    while (offset < text.length) {
      if (text[offset] === "\\") { offset += 2; continue; }
      if (text[offset++] === '"') return JSON.parse(text.slice(start, offset));
    }
    throw new Error("Unterminated JSON string.");
  };
  const value = (depth = 0) => {
    if (++nodes > 100_000 || depth > 64) throw new Error("Attestation input exceeds structural limits.");
    whitespace();
    const c = text[offset];
    if (c === '"') return token();
    if (c === "{" || c === "[") {
      const object = c === "{", result = object ? Object.create(null) : [], seen = new Set(), close = object ? "}" : "]";
      offset++; whitespace();
      if (text[offset] === close) { offset++; return result; }
      while (offset < text.length) {
        whitespace();
        let key;
        if (object) {
          if (text[offset] !== '"') throw new Error("Expected a JSON property name.");
          key = token();
          if (seen.has(key)) throw new Error("Duplicate JSON property in attestation input.");
          seen.add(key); whitespace();
          if (text[offset++] !== ":") throw new Error("Expected a JSON colon.");
        }
        const child = value(depth + 1);
        if (object) result[key] = child; else result.push(child);
        whitespace();
        if (text[offset] === close) { offset++; return result; }
        if (text[offset++] !== ",") throw new Error("Expected a JSON comma.");
      }
      throw new Error("Unterminated JSON container.");
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u.exec(text.slice(offset));
    if (!match) throw new Error("Invalid JSON value.");
    offset += match[0].length;
    return JSON.parse(match[0]);
  };
  const result = value(); whitespace();
  if (offset !== text.length) throw new Error("Trailing data in attestation input.");
  canonicalAttestationJson(result);
  return result;
}
