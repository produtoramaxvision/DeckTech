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
// asserting a cadence it does not run at.
//
// ROUND-4 FIX (major finding #4). Round-3's fix above was incomplete: it
// disclosed the ACTUAL PER-ITERATION cadence, but every row was still
// labeled with `now = Date.now() - t0` computed at the TOP of the loop,
// before any of that iteration's ~1.5-2.5s of PowerShell round-trips ran —
// so a row's printed timestamp could be up to ~2.5s EARLIER than the data
// in that same row was actually sampled. Reproduced live: the round-4
// reviewer's run showed a row labeled `t+2502ms` already containing
// `{"title":"Error",...}` for a crash injected at ~t+3.3s — the dialog
// cannot have existed at t+2502ms; that row's window-enumeration data was
// actually read ~2.4s after the row's own label, i.e. AFTER the crash. Also
// disclosed here, not just fixed: the loop header `for (let elapsed = 0;
// elapsed <= 11000; elapsed += 300)` reads as an 11-second poll at 300ms
// steps but the increment is nominal only — the real budget is 37
// iterations at the ~1.5-2.5s actual cadence above, i.e. roughly 55-95s
// wall clock, not 11s (the round-4 reviewer's run's last sample landed at
// t+51014ms; an earlier round's ADR draft cited t+85800ms for the same
// nominal 37-iteration loop).
//
// Fix: every probe below (processTree, httpStatus, heartbeat read,
// windowsForPids) now stamps its OWN wall-clock time immediately before it
// runs, and every one of those per-probe timestamps is printed on the row —
// not just a single iteration-start label that only the first probe's data
// could honestly be attributed to. The loop variable is renamed from
// `elapsed` (which claimed to BE elapsed wall time) to a plain iteration
// index, with the real ~55-95s budget named instead of implied.
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

// ROUND-4 FIX (major finding #4): honest name and honest budget. This is
// NOT an 11-second, 300ms-cadence poll — see the file header comment. It is
// SAMPLE_COUNT iterations, each costing roughly the CIM + EnumWindows round
// trips below (~1.5-2.5s measured on this machine), for a real wall-clock
// budget of roughly SAMPLE_COUNT * that, i.e. ~55-95s, printed below so a
// reader never has to infer it from the loop header.
const SAMPLE_COUNT = 37; // unchanged iteration count from round-3 (11000/300 + 1)
console.log(`[driver] polling ${SAMPLE_COUNT} iterations; real cadence is ~1.5-2.5s/iteration (PowerShell round trips dominate) -> expect roughly ${(SAMPLE_COUNT * 1.5).toFixed(0)}-${(SAMPLE_COUNT * 2.5).toFixed(0)}s wall clock, not the ~11s a naive reading of a nominal "300ms step" would suggest.`);
for (let i = 0; i < SAMPLE_COUNT; i++) {
  // ROUND-4 FIX (major finding #4): each probe below stamps its OWN
  // wall-clock time immediately before it runs and that per-probe timestamp
  // is what gets printed for it — no single iteration-start label is used
  // to caption data that was actually read up to ~2.5s later. `iterStartMs`
  // is kept only as the row's sort key / iteration marker, explicitly
  // labeled as such, never as "when this row's data was sampled".
  const iterStartMs = Date.now() - t0;
  const iterWallStart = Date.now();
  // processTree already retries 3x internally and guards against pid reuse
  // and pid recycling (lib.mjs); if it STILL throws (sustained PowerShell
  // failure under load), report this one sample as unavailable and keep
  // polling rather than losing the rest of the timeline — one bad sample
  // must not erase the surrounding 30+ good ones.
  const processTreeAtMs = Date.now() - t0;
  let alive;
  let childPids = [];
  try {
    const tree = await processTree(mainPid, { notBeforeMs: t0 });
    alive = tree.length > 0;
    childPids = tree.map((p) => p.pid);
  } catch (e) {
    alive = `ERROR:${e.message}`;
  }
  const httpStatusAtMs = Date.now() - t0;
  const status = await httpStatus();
  // ROUND-2 FIX (major #6): a swallowed read failure here (e.g. reading mid-
  // write, or file gone) previously looked identical to "hb=null because the
  // event loop is dead" in the printed timeline. Surface which case it is.
  const heartbeatReadAtMs = Date.now() - t0;
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
  //
  // ROUND-4 FIX (major finding #4): windowsAtMs is the timestamp that
  // actually matters for §5's causal-timing claim — it is when the window
  // data below was actually sampled, not when the iteration started. Any
  // reader deriving "the dialog appeared at t+Xms" MUST use this timestamp,
  // not iterStartMs.
  const windowsAtMs = Date.now() - t0;
  let windows = [];
  let winError = null;
  try {
    windows = await windowsForPids(childPids.length ? childPids : [mainPid]);
  } catch (e) {
    winError = e?.message || String(e);
  }
  const iterWallMs = Date.now() - iterWallStart;
  console.log(
    `iter ${i + 1}/${SAMPLE_COUNT} (iterStart t+${iterStartMs}ms, iter took ${iterWallMs}ms)  ` +
    `osAlive[sampled t+${processTreeAtMs}ms]=${alive}  health[sampled t+${httpStatusAtMs}ms]=${status}  ` +
    `hb[sampled t+${heartbeatReadAtMs}ms]=${JSON.stringify(hb)}${hb ? ` (age ${hbAgeMs}ms, LAST-KNOWN-GOOD not necessarily current)` : ""}${hbReadError ? `  hbReadError=${hbReadError}` : ""}  ` +
    `windows[sampled t+${windowsAtMs}ms]=${JSON.stringify(windows)}${winError ? `  winError=${winError}` : ""}`
  );
}

// Trailing diagnostics only, after the load-bearing poll loop above has
// already printed. Best-effort: a transient failure here (observed live
// under this machine's heavy concurrent load — see lib.mjs's retries bump)
// must not discard everything already printed by crashing the script
// uncaught.
try {
  const finalTree = await processTree(mainPid, { notBeforeMs: t0 });
  console.log("\nfinal tree:", JSON.stringify(finalTree, null, 2));
} catch (e) {
  console.log(`\nfinal tree: (unavailable — processTree failed after retries: ${e.message})`);
}
console.log("\nfull log:\n" + readFileSync(logFile, "utf8"));
console.log("\nstderr tail:\n" + stderrBuf.slice(-3000));

try { child.kill(); } catch {}
process.exit(0);
