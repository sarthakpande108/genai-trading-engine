import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function isIgnored(path) {
  const result = spawnSync(
    "git",
    ["check-ignore", "--no-index", "--quiet", path],
    { cwd: repositoryRoot },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  assert.ok(
    result.status === 0 || result.status === 1,
    result.stderr?.toString() || `git check-ignore failed for ${path}`,
  );
  return result.status === 0;
}

test("legacy root broker config is ignored", () => {
  assert.equal(isIgnored("config.js"), true);
});

test("local environment files are ignored but the example remains trackable", () => {
  assert.equal(isIgnored(".env"), true);
  assert.equal(isIgnored(".env.example"), false);
});
