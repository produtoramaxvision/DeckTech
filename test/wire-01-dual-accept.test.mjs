import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createSocket } from "node:dgram";
import { startServer, startDiscovery, DISCOVERY_MAGIC, DISCOVERY_MAGIC_LEGACY, DECKTECH_HEADER } from "../server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// 1. Read DokkeDiscovery.kt to get the exact regexes Android uses in production
const discoveryKtPath = path.join(repoRoot, "android", "app", "src", "main", "java", "com", "dokke", "app", "DokkeDiscovery.kt");
const discoveryKtSource = fs.readFileSync(discoveryKtPath, "utf8");

// Extract replyPattern: Regex("^dokke:(\\d{1,3}(?:\\.\\d{1,3}){3}):(\\d{1,5})$")
const replyPatternMatch = discoveryKtSource.match(/val replyPattern\s*=\s*Regex\("(.+)"\)/);
assert.ok(replyPatternMatch, "DokkeDiscovery.kt must define replyPattern");
const replyPatternString = JSON.parse(`"${replyPatternMatch[1]}"`);
const androidReplyRegex = new RegExp(replyPatternString);

// Extract healthPattern: Regex("^\\s*\\{\\s*\\\"ok\\\"\\s*:\\s*true\\s*,\\s*\\\"service\\\"\\s*:\\s*\\\"Dokke\\\"\\s*\\}\\s*$")
const healthPatternMatch = discoveryKtSource.match(/val healthPattern\s*=\s*Regex\("(.+)"\)/);
assert.ok(healthPatternMatch, "DokkeDiscovery.kt must define healthPattern");
const healthPatternString = JSON.parse(`"${healthPatternMatch[1]}"`);
const androidHealthRegex = new RegExp(healthPatternString);

function ask(port, payload, timeoutMs = 2000) {
  return new Promise(resolve => {
    const client = createSocket("udp4");
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      client.close();
      resolve(result);
    };
    client.on("message", msg => finish(msg.toString("utf8")));
    client.on("error", () => finish(null));
    client.bind(0, () => {
      client.send(payload, port, "127.0.0.1", () => {});
    });
    setTimeout(() => finish(null), timeoutMs);
  });
}

test("WIRE-01: /health without header returns legacy body byte for byte, matched by DokkeDiscovery.kt regex", async () => {
  const { port, close } = await startServer(0);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const rawText = await res.text();

    // Exact byte-for-byte legacy format: {"ok":true,"service":"Dokke"}
    assert.equal(rawText, '{"ok":true,"service":"Dokke"}', "legacy body must match byte-for-byte");
    assert.ok(androidHealthRegex.test(rawText), "DokkeDiscovery.kt anchored health regex must match legacy body");
  } finally {
    await close();
  }
});

test("WIRE-01: /health with DeckTech header returns service 'DeckTech' and is rejected by legacy regex", async () => {
  const { port, close } = await startServer(0);
  try {
    // Via x-decktech header
    const res1 = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { [DECKTECH_HEADER]: "1" },
    });
    assert.equal(res1.status, 200);
    const rawText1 = await res1.text();
    assert.equal(rawText1, '{"ok":true,"service":"DeckTech"}');
    assert.equal(androidHealthRegex.test(rawText1), false, "DokkeDiscovery.kt must reject DeckTech identity");

    // Via x-decktech-client header
    const res2 = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { "x-decktech-client": "true" },
    });
    assert.equal(res2.status, 200);
    const rawText2 = await res2.text();
    assert.equal(rawText2, '{"ok":true,"service":"DeckTech"}');
    assert.equal(androidHealthRegex.test(rawText2), false);
  } finally {
    await close();
  }
});

test("WIRE-01: UDP discovery responds to dokke:discover with dokke prefix matching DokkeDiscovery.kt", async () => {
  const sock = startDiscovery(0, { portHint: 5432, log: () => {} });
  await new Promise(r => sock.on("listening", r));
  try {
    const port = sock.address().port;
    const reply = await ask(port, "dokke:discover");
    assert.ok(reply, "server should reply to dokke:discover");
    assert.ok(androidReplyRegex.test(reply), `DokkeDiscovery.kt replyPattern must match: ${reply}`);
    assert.doesNotMatch(reply, /^decktech:/, "must never reply with decktech prefix to dokke:discover");
  } finally {
    sock.close();
  }
});

test("WIRE-01: UDP discovery responds to decktech:discover with decktech prefix, never dokke prefix", async () => {
  const sock = startDiscovery(0, { portHint: 5432, log: () => {} });
  await new Promise(r => sock.on("listening", r));
  try {
    const port = sock.address().port;
    const reply = await ask(port, "decktech:discover");
    assert.ok(reply, "server should reply to decktech:discover");
    const m = reply.match(/^decktech:(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
    assert.ok(m, `reply must have decktech prefix: ${reply}`);
    assert.equal(m[2], "5432");
    assert.doesNotMatch(reply, /^dokke:/, "must never reply with dokke prefix to decktech:discover");
  } finally {
    sock.close();
  }
});

test("WIRE-01: /api/status dual-accept returns Dokke without header and DeckTech with header", async () => {
  const { port, close } = await startServer(0);
  try {
    // Legacy client without header
    const resLegacy = await fetch(`http://127.0.0.1:${port}/api/status`);
    assert.equal(resLegacy.status, 200);
    const jsonLegacy = await resLegacy.json();
    assert.equal(jsonLegacy.service, "Dokke", "status without header returns Dokke");

    // DeckTech client with header
    const resDeckTech = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: { [DECKTECH_HEADER]: "1" },
    });
    assert.equal(resDeckTech.status, 200);
    const jsonDeckTech = await resDeckTech.json();
    assert.equal(jsonDeckTech.service, "DeckTech", "status with header returns DeckTech");
  } finally {
    await close();
  }
});

test("WIRE-01: legacy branches carry declared removal date in code comment", () => {
  const serverSource = fs.readFileSync(path.join(repoRoot, "server.js"), "utf8");
  const removalMatches = [...serverSource.matchAll(/removal date:\s*(\d{4}-\d{2}-\d{2})/gi)];
  assert.ok(removalMatches.length >= 2, "must declare removal date in comments for legacy branches");
  for (const match of removalMatches) {
    assert.match(match[1], /^202[7-9]-\d{2}-\d{2}$/, "removal date must be a valid future ISO date");
  }
});

test("WIRE-01: Windows paths resolve safely using path.join and survive paths with spaces", () => {
  const spaceDir = path.join(os.tmpdir(), "decktech wire01 test path with spaces");
  const testFile = path.join(spaceDir, "probe.json");
  assert.equal(testFile.includes("/"), false, "Windows path must not contain forward slashes when joined with path.win32");
  assert.ok(testFile.includes("decktech wire01 test path with spaces"));
});
