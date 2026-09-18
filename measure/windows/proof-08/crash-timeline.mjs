#!/usr/bin/env node
// PROOF-08 — fine-grained crash-behavior probe. Boots ONE approach, injects
// the same crash run.mjs's crash reps use (unhandled throw 3s after the
// server is ready), and polls for the next ~12s so the exact moment things
// change is visible, not just a before/after snapshot:
//   - osAlive: is the main OS process (and, transitively, its children) present
//   - health: /health HTTP status (200, TIMEOUT, or a connection error code)
//   - hb: last-written heartbeat file content (written every 200ms by the
//     main process while its JS event loop is alive), with its own age so a
//     frozen last-known-good value can never be read as a current one
//   - win: every titled Win32 window owned by the main process pid or any of
//     its child pids (EnumWindows/GetClassNameW/IsWindowVisible via
//     enum-windows.ps1) — this is what makes ADR §5's "Electron's default
//     uncaughtException handler opens a modal dialog, it doesn't hang
//     silently" claim reproducible from this committed script, instead of
//     resting on "a small PowerShell probe, not committed — one-off
//     verification" (round-2 ADR §5 box).
//
// ROUND-3 FIX (major finding #7): the health-wait loop used to be
// `while (true) { ... }` with no deadline, no attempt counter and no
// failure path — a port collision or any startServer failure left this
// script (and an orphan electron.exe) hanging forever. Now reuses
// lib.mjs's waitForHttp200 (30s deadline); on timeout it kills the child,
// prints whatever stderr was captured, and exits non-zero naming the
// approach, port and elapsed time.
//
// ROUND-3 FIX (major finding #3, disclosed not just fixed): EnumWindows
// recompiles its Add-Type P/Invoke shim on every `powershell.exe`
// invocation. Measured on this machine (`time powershell.exe -NoProfile
// -NonInteractive -File enum-windows.ps1`): ~0.8-1.1s per call. Combined
// with the pre-existing processTree() call this loop also makes every
// iteration, the ACTUAL poll cadence is close to ~1.5-2s, not the nominal
// 300ms a naive reading of "poll loop" might suggest. This script records
// and prints the actual elapsed time per iteration (same actual-vs-nominal
// pattern run.mjs's IDLE_SAMPLE_POINTS_MS already uses) rather than
// asserting a cadence it does not run at. ~1-2s resolution over an 11s
// observation window, for a crash injected at a known t+3000ms, is still
// ample to see which side of the crash a state change happened on.
//
// Usage: node measure/windows/proof-08/crash-timeline.mjs <utility|inprocess> [--matched-handler]
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import http from "node:http";
import electronPath from "electron";
import { processTree, waitForHttp200, windowsForPids } from "./lib.mjs";

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

try {
  await waitForHttp200(port, { timeoutMs: 30000 });
} catch (e) {
  const elapsedMs = Date.now() - t0;
  console.error(`FATAL: approach=${approach} port=${port} never answered /health 200 after ${elapsedMs}ms — ${e.message}`);
  console.error(`stderr captured so far:\n${stderrBuf.slice(-3000)}`);
  try { child.kill(); } catch {}
  process.exit(1);
}
console.log(`[driver] health 200 at t+${Date.now() - t0}ms (approach=${approach}, mainPid=${mainPid})`);

for (let elapsed = 0; elapsed <= 11000; elapsed += 300) {
  const iterStart = Date.now();
  const now = Date.now() - t0;
  // processTree already retries 3x internally and guards against pid reuse
  // (lib.mjs); if it STILL throws (sustained PowerShell failure under
  // load), report this one sample as unavailable and keep polling rather
  // than losing the rest of the timeline — one bad sample must not erase
  // the surrounding 30+ good ones.
  let alive;
  let childPids = [];
  try {
    const tree = await processTree(mainPid);
    alive = tree.length > 0;
    childPids = tree.map((p) => p.pid);
  } catch (e) {
    alive = `ERROR:${e.message}`;
  }
  const status = await httpStatus();
  // ROUND-2 FIX (major #6): a swallowed read failure here (e.g. reading mid-
  // write, or file gone) previously looked identical to "hb=null because the
  // event loop is dead" in the printed timeline. Surface which case it is.
  let hb = null;
  let hbReadError = null;
  try { hb = existsSync(hbFile) ? JSON.parse(readFileSync(hbFile, "utf8")) : null; }
  catch (e) { hbReadError = e?.code || e?.message || String(e); }
  const hbAgeMs = hb ? (Date.now() - hb.t) : null;
  // ROUND-3 FIX (major finding #2): independent Win32 window enumeration,
  // folded into the committed poll loop instead of a one-off uncommitted
  // probe. Enumerates for the main pid AND every child pid this iteration's
  // process-tree snapshot found (the dialog belongs to whichever process
  // actually threw — in Approach A that could in principle be the forked
  // child, not main).
  let windows = [];
  let winError = null;
  try {
    windows = await windowsForPids(childPids.length ? childPids : [mainPid]);
  } catch (e) {
    winError = e?.message || String(e);
  }
  const iterElapsedMs = Date.now() - iterStart;
  console.log(
    `t+${now}ms (iter took ${iterElapsedMs}ms)  osAlive=${alive}  health=${status}  ` +
    `hb=${JSON.stringify(hb)}${hb ? ` (age ${hbAgeMs}ms, LAST-KNOWN-GOOD not necessarily current)` : ""}${hbReadError ? `  hbReadError=${hbReadError}` : ""}  ` +
    `windows=${JSON.stringify(windows)}${winError ? `  winError=${winError}` : ""}`
  );
}

// Trailing diagnostics only, after the load-bearing poll loop above has
// already printed. Best-effort: a transient failure here (observed live
// under this machine's heavy concurrent load — see lib.mjs's retries bump)
// must not discard everything already printed by crashing the script
// uncaught.
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
