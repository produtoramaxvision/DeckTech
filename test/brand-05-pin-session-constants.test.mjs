import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PIN_FILE, SESSION_FILE, pinFilePath } from "../auth.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const serverJsPath = path.join(repoRoot, "server.js");

test("BRAND-05: auth.js exports PIN_FILE and SESSION_FILE with expected filenames", () => {
  assert.equal(PIN_FILE, ".j5-pin", "PIN_FILE must remain .j5-pin (do not rename on disk)");
  assert.equal(SESSION_FILE, "j5-sessions.json", "SESSION_FILE must remain j5-sessions.json (do not rename on disk)");
});

test("BRAND-05: server.js imports PIN_FILE and SESSION_FILE from ./auth.js", async () => {
  const content = await readFile(serverJsPath, "utf8");
  assert.match(
    content,
    /import\s*\{[^}]*\bPIN_FILE\b[^}]*\}\s*from\s*["']\.\/auth\.js["']/,
    "server.js must import PIN_FILE from ./auth.js",
  );
  assert.match(
    content,
    /import\s*\{[^}]*\bSESSION_FILE\b[^}]*\}\s*from\s*["']\.\/auth\.js["']/,
    "server.js must import SESSION_FILE from ./auth.js",
  );
});

test("BRAND-05: server.js does not duplicate \".j5-pin\" or \"j5-sessions.json\" as string literals", async () => {
  const content = await readFile(serverJsPath, "utf8");
  assert.doesNotMatch(
    content,
    /"\.j5-pin"/,
    'server.js must not contain literal ".j5-pin"',
  );
  assert.doesNotMatch(
    content,
    /"j5-sessions\.json"/,
    'server.js must not contain literal "j5-sessions.json"',
  );
});

test("BRAND-05: Windows path resolution uses path.join and survives paths with spaces", async () => {
  const tempBase = mkdtempSync(path.join(tmpdir(), "brand-05 space test "));
  const nestedDir = path.join(tempBase, "nested data dir with space");
  mkdirSync(nestedDir, { recursive: true });

  const pinPath = path.join(nestedDir, PIN_FILE);
  const sessionPath = path.join(nestedDir, SESSION_FILE);

  assert.ok(tempBase.includes(" "), "sanity check: temporary path must contain a space");
  assert.ok(nestedDir.includes(" "), "sanity check: nested path must contain a space");
  assert.equal(pinFilePath(nestedDir), pinPath, "pinFilePath must join root and PIN_FILE with path.join");

  writeFileSync(pinPath, "1234\n", "utf8");
  writeFileSync(sessionPath, JSON.stringify({ sessions: [] }), "utf8");

  assert.ok(existsSync(pinPath), "PIN_FILE must exist at joined path with space");
  assert.ok(existsSync(sessionPath), "SESSION_FILE must exist at joined path with space");

  const pinContent = await readFile(pinPath, "utf8");
  assert.equal(pinContent.trim(), "1234");
});
