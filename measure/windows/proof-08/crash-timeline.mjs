#!/usr/bin/env node
// PROOF-08 — fine-grained crash-behavior probe. Boots ONE approach, injects
// the same crash run.mjs's crash reps use (unhandled throw 3s after the
// server is ready), and polls at 300ms resolution for the next ~12s so the
// exact moment things change is visible, not just a before/after snapshot:
//   - osAlive: is the main OS process (and, transitively, its children) present
//   - health: /health HTTP status (200, TIMEOUT, or a connection error code)
//   - hb: last-written heartbeat file content (written every 200ms by the
//     main process while its JS event loop is alive)
//
// Usage: node measure/windows/proof-08/crash-timeline.mjs <utility|inprocess> [--matched-handler]
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import http from "node:http";
import electronPath from "electron";
import { processTree, isPidAlive } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const approach = process.argv[2];
const installHandler = process.argv.includes("--matched-handler");
if (approach !== "utility" && approach !== "inprocess") {
  console.error("usage: node crash-timeline.mjs <utility|inprocess> [--matched-handler]");
  process.exit(2);
}
const mainFile = join(here, approach === "utility" ? "main-utility.mjs" : "main-inprocess.mjs");
const port = 15800 + (Date.now() % 100); // avoid colliding with a concurrent run
const appData = mkdtempSync(join(tmpdir(), "decktech-crashtimeline-"));
const logFile = join(appData, "log.jsonl");
const hbFile = join(appData, "hb.json");
writeFileSync(logFile, "");

function httpStatus() {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 800 }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on("timeout", () => { req.destroy(); resolve("TIMEOUT"); });
    req.on("error", (e) => resolve("ERR:" + e.code));
  });
}

const env = {
  ...process.env,
  PROOF08_PORT: String(port),
  PROOF08_APPDATA: appData,
  PROOF08_LOG_FILE: logFile,
  PROOF08_HEARTBEAT_FILE: hbFile,
  PROOF08_CRASH_AFTER_MS: "3000",
  PROOF08_QUIT_AFTER_MS: "20000",
  PROOF08_INSTALL_UNCAUGHT_HANDLER: installHandler ? "1" : "",
};

const t0 = Date.now();
const child = spawn(electronPath, [mainFile], { env, stdio: ["ignore", "pipe", "pipe"] });
const mainPid = child.pid;
let stderrBuf = "";
child.stderr.on("data", (d) => { stderrBuf += d.toString("utf8"); });
child.on("exit", (code, signal) => console.log(`\n[driver] child exited code=${code} signal=${signal} at t+${Date.now() - t0}ms`));

while (true) {
  const s = await httpStatus();
  if (s === 200) break;
  await new Promise((r) => setTimeout(r, 50));
}
console.log(`[driver] health 200 at t+${Date.now() - t0}ms (approach=${approach}, mainPid=${mainPid})`);

for (let elapsed = 0; elapsed <= 11000; elapsed += 300) {
  await new Promise((r) => setTimeout(r, 300));
  const now = Date.now() - t0;
  // isPidAlive already retries 3x internally (lib.mjs); if it STILL throws
  // (sustained PowerShell failure under load), report this one sample as
  // unavailable and keep polling rather than losing the rest of the
  // timeline — one bad sample must not erase the surrounding 30+ good ones.
  let alive;
  try { alive = await isPidAlive(mainPid); } catch (e) { alive = `ERROR:${e.message}`; }
  const status = await httpStatus();
  // ROUND-2 FIX (major #6): a swallowed read failure here (e.g. reading mid-
  // write, or file gone) previously looked identical to "hb=null because the
  // event loop is dead" in the printed timeline. Surface which case it is.
  let hb = null;
  let hbReadError = null;
  try { hb = existsSync(hbFile) ? JSON.parse(readFileSync(hbFile, "utf8")) : null; }
  catch (e) { hbReadError = e?.code || e?.message || String(e); }
  console.log(`t+${now}ms  osAlive=${alive}  health=${status}  hb=${JSON.stringify(hb)}${hbReadError ? `  hbReadError=${hbReadError}` : ""}`);
}

// Trailing diagnostics only, after the load-bearing 300ms-resolution poll
// loop above has already printed. Best-effort: a transient failure here
// (observed live under this machine's heavy concurrent load — see lib.mjs's
// retries bump) must not discard everything already printed by crashing the
// script uncaught.
try {
  const finalTree = await processTree(mainPid);
  console.log("\nfinal tree:", JSON.stringify(finalTree, null, 2));
} catch (e) {
  console.log(`\nfinal tree: (unavailable — processTree failed after retries: ${e.message})`);
}
console.log("\nfull log:\n" + readFileSync(logFile, "utf8"));
console.log("\nstderr tail:\n" + stderrBuf.slice(-3000));

try { child.kill(); } catch {}
process.exit(0);
