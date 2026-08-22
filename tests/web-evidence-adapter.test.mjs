import assert from "node:assert/strict";
import test from "node:test";
import {
  isPrivateAddress,
  parseTargetUrl,
  sha256
} from "../codex/skills/information-accessibility-practice/scripts/capture-web-evidence.mjs";

test("web adapter rejects unsafe target URL forms", () => {
  assert.throws(() => parseTargetUrl("file:///tmp/test.html"), /http or https/u);
  assert.throws(() => parseTargetUrl("https://user:secret@example.com/"), /credentials/u);
  assert.throws(() => parseTargetUrl("http://localhost:3000/"), /allow-localhost/u);
  assert.equal(parseTargetUrl("http://localhost:3000/", { allowLocalhost: true }).origin, "http://localhost:3000");
});

test("private and loopback IP ranges are identified", () => {
  for (const value of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.2.3", "::1", "fe80::1", "fc00::1", "fd00::1"]) {
    assert.equal(isPrivateAddress(value), true, value);
  }
  for (const value of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "2001:4860:4860::8888"]) {
    assert.equal(isPrivateAddress(value), false, value);
  }
});

test("evidence hashes are deterministic SHA-256 values", () => {
  assert.equal(sha256("hello"), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});
