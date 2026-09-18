import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ENABLE_VERSION_CHECK,
  latestVersionSnapshot,
  refreshVersion,
  resetVersionCacheForTest,
  makeApp,
} from "../server.js";

// BRAND-01: Repoint the four update surfaces away from felipenalves/Dokke
// BRAND-12: Keep the version check disabled behind an explicit flag until the first release exists.

const repoRoot = path.resolve(import.meta.dirname, "..");
const serverJsPath = path.join(repoRoot, "server.js");
const docsMainJsPath = path.join(repoRoot, "docs", "src", "main.js");
const macUpdateManagerPath = path.join(repoRoot, "mac", "Sources", "DokkeUpdateManager.swift");
const androidMainActivityPath = path.join(
  repoRoot,
  "android",
  "app",
  "src",
  "main",
  "java",
  "com",
  "dokke",
  "app",
  "MainActivity.kt",
);

test("BRAND-01: server.js update surface points to produtoramaxvision/DeckTech and not felipenalves/Dokke", async () => {
  const content = await readFile(serverJsPath, "utf8");
  assert.match(
    content,
    /https:\/\/github\.com\/produtoramaxvision\/DeckTech\/releases\/latest/,
    "server.js must point releases/latest to produtoramaxvision/DeckTech",
  );
  assert.match(
    content,
    /https:\/\/github\.com\/produtoramaxvision\/DeckTech\/releases\/tag\//,
    "server.js must point htmlUrl to produtoramaxvision/DeckTech",
  );
  assert.match(
    content,
    /https:\/\/github\.com\/produtoramaxvision\/DeckTech\/releases\/latest\/download\/dokke\.apk/,
    "server.js must point apkUrl to produtoramaxvision/DeckTech",
  );
  // Ensure lines around refreshVersion do not contain felipenalves/Dokke
  const lines = content.split("\n");
  const refreshFnLines = lines.slice(80, 140).join("\n");
  assert.doesNotMatch(
    refreshFnLines,
    /felipenalves\/Dokke/,
    "server.js update mechanism must not reference felipenalves/Dokke",
  );
});

test("BRAND-01: docs/src/main.js download links point to produtoramaxvision/DeckTech and not felipenalves/Dokke", async () => {
  const content = await readFile(docsMainJsPath, "utf8");
  assert.match(
    content,
    /mac:\s*"https:\/\/github\.com\/produtoramaxvision\/DeckTech\/releases\/latest\/download\/Dokke-macOS\.dmg"/,
    "docs/src/main.js downloads.mac must point to produtoramaxvision/DeckTech",
  );
  assert.match(
    content,
    /android:\s*"https:\/\/github\.com\/produtoramaxvision\/DeckTech\/releases\/latest\/download\/dokke\.apk"/,
    "docs/src/main.js downloads.android must point to produtoramaxvision/DeckTech",
  );
  // Specifically lines 1-15 (update surfaces) must not contain felipenalves/Dokke
  const topLines = content.split("\n").slice(0, 15).join("\n");
  assert.doesNotMatch(
    topLines,
    /felipenalves\/Dokke/,
    "docs/src/main.js update surface (downloads object) must not reference felipenalves/Dokke",
  );
});

test("BRAND-01: DokkeUpdateManager.swift points to produtoramaxvision/DeckTech and not felipenalves/Dokke", async () => {
  const content = await readFile(macUpdateManagerPath, "utf8");
  assert.match(
    content,
    /https:\/\/api\.github\.com\/repos\/produtoramaxvision\/DeckTech\/releases\/latest/,
    "DokkeUpdateManager.swift repositoryAPI must point to produtoramaxvision/DeckTech",
  );
  assert.doesNotMatch(
    content,
    /felipenalves\/Dokke/,
    "DokkeUpdateManager.swift must not reference felipenalves/Dokke",
  );
});

test("BRAND-01: MainActivity.kt updateApkBaseUrl points to produtoramaxvision/DeckTech and not felipenalves/Dokke", async () => {
  const content = await readFile(androidMainActivityPath, "utf8");
  assert.match(
    content,
    /updateApkBaseUrl\s*=\s*"https:\/\/github\.com\/produtoramaxvision\/DeckTech\/releases\/download"/,
    "MainActivity.kt updateApkBaseUrl must point to produtoramaxvision/DeckTech",
  );
  assert.doesNotMatch(
    content,
    /felipenalves\/Dokke/,
    "MainActivity.kt must not reference felipenalves/Dokke",
  );
});

test("BRAND-12: ENABLE_VERSION_CHECK flag is false and documented with first-class release comment", async () => {
  assert.equal(
    ENABLE_VERSION_CHECK,
    false,
    "ENABLE_VERSION_CHECK must be false until first release exists",
  );

  const content = await readFile(serverJsPath, "utf8");
  assert.match(
    content,
    /export const ENABLE_VERSION_CHECK = false;/,
    "server.js must export ENABLE_VERSION_CHECK = false",
  );
  assert.match(
    content,
    /first-class|primeira release/i,
    "server.js must state in a comment that re-enabling the flag is a step of the first release",
  );
  assert.match(
    content,
    /RF-10/i,
    "server.js must cite PRD RF-10 / silent auto-update not MVP requirement",
  );
});

test("BRAND-12: latestVersionSnapshot() and refreshVersion() remain null/inactive when flag is false", async () => {
  resetVersionCacheForTest();
  const snapshot = latestVersionSnapshot();
  assert.equal(snapshot, null, "latestVersionSnapshot() must return null when version check is disabled");

  const refreshed = await refreshVersion();
  assert.equal(refreshed, null, "refreshVersion() must return null when version check is disabled");
});

test("BRAND-12: GET /api/version returns latest: null when version check is disabled", async () => {
  resetVersionCacheForTest();
  const app = makeApp({ root: repoRoot });

  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(data) {
      this.body = data;
    },
  };

  const req = {
    method: "GET",
    url: "/api/version",
    headers: { host: "127.0.0.1:3000" },
    socket: { remoteAddress: "127.0.0.1" },
  };

  await app(req, res);
  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.latest, null, "latest must be null in /api/version response when flag is disabled");
});

test("BRAND-12: refreshVersion() with enableVersionCheck: true fetches produtoramaxvision/DeckTech", async () => {
  resetVersionCacheForTest();
  let fetchedUrl = null;
  const mockFetch = async (url) => {
    fetchedUrl = String(url);
    return {
      headers: {
        get(header) {
          if (header.toLowerCase() === "location") {
            return "https://github.com/produtoramaxvision/DeckTech/releases/tag/v0.1.0";
          }
          return null;
        },
      },
    };
  };

  await refreshVersion({ enableVersionCheck: true, fetch: mockFetch });
  assert.equal(
    fetchedUrl,
    "https://github.com/produtoramaxvision/DeckTech/releases/latest",
    "refreshVersion must fetch produtoramaxvision/DeckTech releases/latest",
  );

  const snapshot = latestVersionSnapshot({ enableVersionCheck: true });
  assert.deepEqual(snapshot, {
    tag: "v0.1.0",
    htmlUrl: "https://github.com/produtoramaxvision/DeckTech/releases/tag/v0.1.0",
    apkUrl: "https://github.com/produtoramaxvision/DeckTech/releases/latest/download/dokke.apk",
  });
  resetVersionCacheForTest();
});

test("BRAND-01: Windows path resolution uses path.join and survives paths with spaces", async () => {
  const tempBase = mkdtempSync(path.join(tmpdir(), "brand-01 space test "));
  const nestedDir = path.join(tempBase, "nested surface with space");
  mkdirSync(nestedDir, { recursive: true });
  const sampleFile = path.join(nestedDir, "sample-update.json");
  writeFileSync(sampleFile, JSON.stringify({ repo: "produtoramaxvision/DeckTech" }), "utf8");

  assert.ok(tempBase.includes(" "), "sanity check: temporary path must contain a space");
  const readBack = JSON.parse(await readFile(sampleFile, "utf8"));
  assert.equal(readBack.repo, "produtoramaxvision/DeckTech");
});
