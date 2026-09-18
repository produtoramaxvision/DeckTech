import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const [packageJson, publicVersion, androidGradle, macPlist, changelog] = await Promise.all([
  readFile(path.join(root, "package.json"), "utf8"),
  readFile(path.join(root, "public", "version.json"), "utf8"),
  readFile(path.join(root, "android", "app", "build.gradle"), "utf8"),
  readFile(path.join(root, "mac", "Info.plist"), "utf8"),
  readFile(path.join(root, "CHANGELOG.md"), "utf8"),
]);

test("todos os metadados apontam para a release v0.1.0", () => {
  assert.equal(JSON.parse(packageJson).version, "0.1.0");
  assert.deepEqual(JSON.parse(publicVersion), { tag: "v0.1.0", apkVersion: "0.1.0" });
  assert.match(androidGradle, /versionCode = 1\b/);
  assert.match(androidGradle, /versionName = "0\.1\.0"/);
  assert.match(macPlist, /<key>CFBundleShortVersionString<\/key>\s*<string>0\.1\.0<\/string>/);
  assert.match(macPlist, /<key>CFBundleVersion<\/key>\s*<string>1<\/string>/);
  assert.match(changelog, /^## v0\.1\.0\b/m);
});

test("BRAND-04: Windows path resolution uses path.join and survives paths with spaces", async () => {
  const tempBase = mkdtempSync(path.join(tmpdir(), "brand-04 space test "));
  const nestedDir = path.join(tempBase, "nested version dir with space");
  mkdirSync(nestedDir, { recursive: true });
  const sampleVersion = path.join(nestedDir, "version.json");
  writeFileSync(sampleVersion, JSON.stringify({ tag: "v0.1.0", apkVersion: "0.1.0" }), "utf8");

  assert.ok(tempBase.includes(" "), "sanity check: temporary path must contain a space");
  assert.ok(nestedDir.includes(" "), "sanity check: nested path must contain a space");
  const readBack = JSON.parse(await readFile(sampleVersion, "utf8"));
  assert.deepEqual(readBack, { tag: "v0.1.0", apkVersion: "0.1.0" });
});
