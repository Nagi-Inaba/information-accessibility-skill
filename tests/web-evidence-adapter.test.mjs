import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHostResolverRules,
  isPrivateAddress,
  parseTargetUrl,
  sanitizeNetworkUrl,
  sha256
} from "../codex/skills/information-accessibility-practice/scripts/capture-web-evidence.mjs";

test("web adapter rejects unsafe target URL forms", () => {
  assert.throws(() => parseTargetUrl("file:///tmp/test.html"), /http or https/u);
  assert.throws(() => parseTargetUrl("https://user:secret@example.com/"), /credentials/u);
  assert.throws(() => parseTargetUrl("http://localhost:3000/"), /allow-localhost/u);
  assert.equal(parseTargetUrl("http://localhost:3000/", { allowLocalhost: true }).origin, "http://localhost:3000");
});

test("private, mapped, reserved, and loopback address ranges are identified", () => {
  for (const value of [
    "127.0.0.1",
    "10.1.2.3",
    "100.64.1.2",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.2.3",
    "198.18.0.1",
    "203.0.113.4",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "fe80::1",
    "fc00::1",
    "fd00::1",
    "2001:db8::1",
    "2002:7f00:1::"
  ]) {
    assert.equal(isPrivateAddress(value), true, value);
  }
  for (const value of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "2001:4860:4860::8888"]) {
    assert.equal(isPrivateAddress(value), false, value);
  }
});

test("host resolver rules pin allowed hostnames and deny all unlisted names", () => {
  const rules = buildHostResolverRules([
    { hostname: "example.com", address: "93.184.216.34", family: 4 },
    { hostname: "cdn.example.com", address: "2001:4860:4860::8888", family: 6 },
    { hostname: "127.0.0.1", address: "127.0.0.1", family: 4 }
  ]);
  assert.match(rules, /MAP example\.com 93\.184\.216\.34/u);
  assert.match(rules, /MAP cdn\.example\.com \[2001:4860:4860::8888\]/u);
  assert.match(rules, /EXCLUDE 127\.0\.0\.1/u);
  assert.match(rules, /MAP \* ~NOTFOUND$/u);
});

test("network log URLs omit credentials, query strings, and fragments", () => {
  assert.equal(
    sanitizeNetworkUrl("https://user:secret@example.com/path?token=secret#state"),
    "https://example.com/path"
  );
});

test("evidence hashes are deterministic SHA-256 values", () => {
  assert.equal(sha256("hello"), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});
