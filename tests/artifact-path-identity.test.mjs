import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { artifactPathKey, pathKey, samePath } from "../codex/skills/information-accessibility-practice/scripts/lib/safe-file-io.mjs";

for (const platform of ["darwin", "win32", "linux"]) {
  test(`artifact path identity ${platform === "linux" ? "preserves" : "folds"} case on ${platform}`, () => {
    const upper = artifactPathKey("artifacts/Report.json", platform);
    const lower = artifactPathKey("artifacts/report.json", platform);
    if (platform === "linux") assert.notEqual(upper, lower);
    else assert.equal(upper, lower);
    assert.equal(upper, artifactPathKey(path.resolve("artifacts/Report.json"), platform));
  });
}

test("artifact path identity defaults to the current platform", () => {
  assert.equal(artifactPathKey("artifacts/Report.json"), artifactPathKey("artifacts/Report.json", process.platform));
});

test("path safety comparisons preserve case on darwin", () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    Object.defineProperty(process, "platform", { value: "darwin" });
    assert.notEqual(pathKey("artifacts/Report.json"), pathKey("artifacts/report.json"));
    assert.equal(samePath("artifacts/Report.json", "artifacts/report.json"), false);
    assert.equal(samePath("artifacts/Report.json", path.resolve("artifacts/Report.json")), true);
    assert.equal(artifactPathKey("artifacts/Report.json"), artifactPathKey("artifacts/report.json"));
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
});
