#!/usr/bin/env node
// PROOF-08 — runnable probe. Boots the REAL server.js two ways inside a real
// Electron app (electron 44.4.1, matching the version already measured in
// .maxvision/research/WINDOWS-STACK.md):
//   A) utilityProcess.fork(serverPath, ...)          — main-utility.mjs
//   B) server.js imported and started in main process — main-inprocess.mjs
//
// For each approach it runs several repetitions and reports, from real
// observation (never assumed):
//   - cold start: wall-clock time from process spawn to the first HTTP 200 on /health
//   - idle RSS of every process in the tree, snapshotted twice per rep (t+3s, t+8s)
//   - crash behavior, in TWO handler-policy configurations (ROUND-2, finding #2):
//       "default"  — no process.on('uncaughtException') anywhere probe code
//                    controls; whatever Node/Electron do out of the box in
//                    whichever process actually takes the throw.
//       "matched"  — an explicit, identical process.on('uncaughtException')
//                    handler (stack to stderr, exit 1) installed in whichever
//                    process actually takes the throw in each arm, so the
//                    comparison isn't confounded by "which default a
//                    utility process gets vs. which default a GUI main
//                    process gets".
//
// Usage: node measure/windows/proof-08/run.mjs [--reps N] [--crash-reps N]
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { isolatedAppData, waitForHttp200, processTree, sumRss, mb, fmtTree, isPidAlive } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const IDLE_REPS = flag("reps", 3);
const CRASH_REPS = flag("crash-reps", 2);
const BASE_PORT = 15900;
let portCounter = 0;
const nextPort = () => BASE_PORT + portCounter++;

// ROUND-2 FIX (minor #9): named, explicit sample points instead of an
// unnamed `delayMs === 3000 ? 3000 : 5000` ternary that silently re-derived
// the sleep duration from the label. Each sample's ACTUAL elapsed-since-ready
// time (which includes drift from the previous sample's own CIM round trip)
// is now recorded alongside the nominal target, and the wait before each
// sample is computed from that actual drift, not a hardcoded constant.
const IDLE_SAMPLE_POINTS_MS = [3000, 8000];

const runsScratch = mkdtempSync(join(tmpdir(), "decktech-proof08-run-"));

function readJsonLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
}

function readHeartbeat(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

/**
 * Runs one Electron process for the given approach and returns measured facts.
 * @param {"utility"|"inprocess"} approach
 * @param {{crashAfterMs?: number, installHandler?: boolean}} opts
 */
async function runOnce(approach, { crashAfterMs = 0, installHandler = false } = {}) {
  const mainFile = approach === "utility" ? join(here, "main-utility.mjs") : join(here, "main-inprocess.mjs");
  const port = nextPort();
  // Fresh isolated dir PER REP (not just per approach) — this is also what
  // makes finding #4/#5's shared-warm-cache bias impossible now that
  // main-utility.mjs/main-inprocess.mjs redirect Electron's own userData
  // (GPU/shader caches included) into a subdirectory of this same per-rep
  // dir via app.setPath('userData', ...). Every rep, both arms, starts cold.
  const appDataDir = isolatedAppData(`${approach}-${port}`);
  const logFile = join(runsScratch, `${approach}-${port}.log.jsonl`);
  const heartbeatFile = join(runsScratch, `${approach}-${port}.heartbeat.json`);
  writeFileSync(logFile, "");

  // Fires this many ms after server-ready, inside the main process itself.
  // Idle reps observe at t+8000ms externally; the internal clock the main
  // process schedules its own quit against runs a few hundred ms ahead of
  // that (it starts at app-ready, before our external health poll can even
  // see the port open), and a `Get-CimInstance` snapshot can itself take
  // several hundred ms under this machine's concurrent process load — so a
  // quit at +9000 left too little margin and occasionally raced the t+8000
  // snapshot (observed: empty/partial tree in ~30% of idle reps). +13000
  // gives a safe ~5s cushion. Crash reps need margin past their own
  // observation window (crashAfterMs + 6000, see below) instead.
  const quitAfterMs = crashAfterMs ? crashAfterMs + 9000 : 13000;
  const env = {
    ...process.env,
    PROOF08_PORT: String(port),
    PROOF08_APPDATA: appDataDir,
    PROOF08_LOG_FILE: logFile,
    PROOF08_HEARTBEAT_FILE: heartbeatFile,
    PROOF08_QUIT_AFTER_MS: String(quitAfterMs),
    PROOF08_INSTALL_UNCAUGHT_HANDLER: installHandler ? "1" : "",
  };
  if (crashAfterMs) env.PROOF08_CRASH_AFTER_MS = String(crashAfterMs);

  const spawnTs = Date.now();
  const child = spawn(electronPath, [mainFile], { env, stdio: ["ignore", "pipe", "pipe"] });
  const mainPid = child.pid;
  let stdoutBuf = "";
  let stderrBuf = "";
  child.stdout.on("data", (d) => { stdoutBuf += d.toString("utf8"); });
  child.stderr.on("data", (d) => { stderrBuf += d.toString("utf8"); });

  let exitInfo = null;
  const exited = new Promise((resolve) => {
    child.on("exit", (code, signal) => { exitInfo = { code, signal, at: Date.now() }; resolve(); });
  });

  let coldStartMs = null;
  let healthError = null;
  let readyTs = null;
  try {
    await waitForHttp200(port, { timeoutMs: 25000 });
    readyTs = Date.now();
    coldStartMs = readyTs - spawnTs;
  } catch (e) {
    healthError = e.message;
  }

  const result = {
    approach,
    port,
    mainPid,
    coldStartMs,
    healthError,
    idle: [],
    crash: null,
    exitInfo: null,
    stderrTail: null,
  };

  if (!healthError && !crashAfterMs) {
    // Sample points (t+3s, t+8s after health-200) to show stability, same
    // methodology as WINDOWS-STACK.md's own RSS measurements. Only taken on
    // non-crash reps: a crash rep must not spend 8s here first, or the
    // crash — scheduled relative to the main process's OWN server-ready
    // timestamp, just a few ms after ours — has already happened (and
    // possibly already been cleaned up by QUIT_AFTER_MS) by the time we'd
    // get around to observing it. Found the hard way: an earlier version of
    // this script did exactly that and reported a bogus "main process died"
    // for approach A that was actually just a mistimed observation window.
    for (const pointMs of IDLE_SAMPLE_POINTS_MS) {
      const waitMs = Math.max(0, pointMs - (Date.now() - readyTs));
      await new Promise((r) => setTimeout(r, waitMs));
      const tree = await processTree(mainPid);
      const actualElapsedMs = Date.now() - readyTs;
      result.idle.push({ atMsAfterReady: pointMs, actualElapsedMs, tree, totalMB: mb(sumRss(tree)) });
    }
  }

  if (!healthError && crashAfterMs) {
    // Observe shortly before the crash (for a like-for-like idle reading)
    // and generously after it, so the process has had time to either exit
    // cleanly (approach A / matched-handler B) or reveal that it hasn't
    // (default-behavior B). Waits are computed from actual elapsed-since-
    // ready, same fix as the idle sampler above.
    const preWaitMs = Math.max(0, (crashAfterMs - 1000) - (Date.now() - readyTs));
    await new Promise((r) => setTimeout(r, preWaitMs));
    const preCrashTree = await processTree(mainPid);
    const preCrashElapsedMs = Date.now() - readyTs;
    const postWaitMs = Math.max(0, (crashAfterMs + 5000) - (Date.now() - readyTs));
    await new Promise((r) => setTimeout(r, postWaitMs));
    const postCrashTree = await processTree(mainPid);
    const postCrashElapsedMs = Date.now() - readyTs;
    const mainAlive = await isPidAlive(mainPid);
    const heartbeat = readHeartbeat(heartbeatFile);
    result.crash = {
      crashAfterMs,
      installHandler,
      preCrashElapsedMs,
      postCrashElapsedMs,
      preCrashTotalMB: mb(sumRss(preCrashTree)),
      mainAlive,
      heartbeat,
      postCrashTree,
      postCrashTotalMB: mb(sumRss(postCrashTree)),
    };
  }

  // Let the main process quit itself (QUIT_AFTER_MS), die from the crash, or
  // (matched-handler reps) exit itself immediately on the injected throw;
  // hard-kill as a watchdog if it doesn't exit on its own within 20s of this
  // point (default-behavior in-process crash reps are EXPECTED to hit this —
  // that non-self-terminating hang is itself the finding, see ADR §5).
  const watchdog = setTimeout(() => { try { child.kill(); } catch {} }, 20000);
  await exited;
  clearTimeout(watchdog);
  result.exitInfo = exitInfo;
  result.stderrTail = stderrBuf.slice(-2000);
  result.logEvents = readJsonLines(logFile);
  return result;
}

function fmtMs(ms) { return ms === null ? "N/A" : `${ms.toFixed(0)} ms`; }

function stats(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
    spread: sorted[sorted.length - 1] - sorted[0],
  };
}

function summarize(label, reps) {
  const cold = reps.map((r) => r.coldStartMs).filter((x) => x !== null);
  const idle8 = reps.map((r) => r.idle.find((i) => i.atMsAfterReady === 8000)?.totalMB).filter((x) => x !== undefined);
  const idle8Elapsed = reps.map((r) => r.idle.find((i) => i.atMsAfterReady === 8000)?.actualElapsedMs).filter((x) => x !== undefined);
  console.log(`\n=== ${label} ===`);
  console.log(`cold start (launch -> first /health 200), n=${cold.length}:`);
  cold.forEach((c, i) => console.log(`  rep ${i + 1}: ${fmtMs(c)}`));
  const coldStats = stats(cold);
  if (coldStats) {
    console.log(`  min=${fmtMs(coldStats.min)} median=${fmtMs(coldStats.median)} max=${fmtMs(coldStats.max)} spread=${fmtMs(coldStats.spread)}`);
  }
  console.log(`idle RSS (whole process tree, nominal t+8s after ready — see actual elapsed below), n=${idle8.length}:`);
  idle8.forEach((v, i) => console.log(`  rep ${i + 1}: ${v.toFixed(1)} MB (actual elapsed: ${idle8Elapsed[i]} ms)`));
  const idleStats = stats(idle8);
  if (idleStats) {
    console.log(`  min=${idleStats.min.toFixed(1)} MB median=${idleStats.median.toFixed(1)} MB max=${idleStats.max.toFixed(1)} MB spread=${idleStats.spread.toFixed(1)} MB`);
  }
  console.log(`\nfull process tree, last idle rep, nominal t+8s:`);
  const lastTree = reps[reps.length - 1]?.idle.find((i) => i.atMsAfterReady === 8000)?.tree;
  if (lastTree) console.log(fmtTree(lastTree));
  return { coldStats, idleStats };
}

function summarizeCrash(label, reps) {
  console.log(`\n=== ${label} — crash behavior ===`);
  reps.forEach((r, i) => {
    const c = r.crash;
    console.log(`rep ${i + 1}:`);
    if (!c) { console.log("  (no crash data — health check failed before crash phase)"); return; }
    console.log(`  handler policy: ${c.installHandler ? "matched (explicit process.on('uncaughtException') installed)" : "default (no handler installed by this probe)"}`);
    console.log(`  main process (pid ${r.mainPid}) alive after injected crash: ${c.mainAlive}`);
    console.log(`  heartbeat at/after crash: ${JSON.stringify(c.heartbeat)}`);
    console.log(`  process tree after crash (${c.postCrashTotalMB.toFixed(1)} MB total, actual elapsed ${c.postCrashElapsedMs} ms since ready):`);
    console.log(c.postCrashTree.length ? fmtTree(c.postCrashTree).replace(/^/gm, "    ") : "    (empty — root process gone)");
    console.log(`  electron exit: code=${r.exitInfo?.code} signal=${r.exitInfo?.signal}`);
    const notable = r.logEvents.filter((e) =>
      ["crash-scheduled", "server-exit", "main-uncaught-exception", "main-uncaught-exception-handled", "heartbeat-write-failed", "server-close-failed", "quitting", "window-all-closed"].includes(e.event)
    );
    console.log(`  notable log events: ${JSON.stringify(notable)}`);
  });
}

async function main() {
  console.log(`Electron: ${await (async () => {
    const { execFileSync } = await import("node:child_process");
    return execFileSync(electronPath, ["--version"]).toString().trim();
  })()}`);
  console.log(`Node (this driver): ${process.version}`);
  console.log(`server.js: ${join(here, "..", "..", "..", "server.js")}`);
  console.log(`repetitions: idle=${IDLE_REPS} crash(default)=${CRASH_REPS} crash(matched-handler)=${CRASH_REPS}`);
  console.log(`arm order: INTERLEAVED per rep index (utility, inprocess, utility, inprocess, ...) — fixes the fixed
A-then-B ordering bias round-2 review flagged. Each rep also gets its own isolated
Electron userData dir (app.setPath), so no rep inherits a warm GPU/shader cache
from a previous rep or a previous arm.`);

  const results = {
    utility: { idle: [], crashDefault: [], crashMatched: [] },
    inprocess: { idle: [], crashDefault: [], crashMatched: [] },
  };

  for (let i = 0; i < IDLE_REPS; i++) {
    for (const approach of ["utility", "inprocess"]) {
      console.log(`\n[run] ${approach} idle rep ${i + 1}/${IDLE_REPS} (interleaved) ...`);
      const r = await runOnce(approach, {});
      results[approach].idle.push(r);
      console.log(`[run] ${approach} idle rep ${i + 1}: coldStart=${fmtMs(r.coldStartMs)} healthError=${r.healthError}`);
    }
  }

  for (let i = 0; i < CRASH_REPS; i++) {
    for (const approach of ["utility", "inprocess"]) {
      console.log(`\n[run] ${approach} crash(default) rep ${i + 1}/${CRASH_REPS} (interleaved) ...`);
      const r = await runOnce(approach, { crashAfterMs: 3000, installHandler: false });
      results[approach].crashDefault.push(r);
      console.log(`[run] ${approach} crash(default) rep ${i + 1}: mainAliveAfterCrash=${r.crash?.mainAlive} exitCode=${r.exitInfo?.code} signal=${r.exitInfo?.signal}`);
    }
  }

  for (let i = 0; i < CRASH_REPS; i++) {
    for (const approach of ["utility", "inprocess"]) {
      console.log(`\n[run] ${approach} crash(matched-handler) rep ${i + 1}/${CRASH_REPS} (interleaved) ...`);
      const r = await runOnce(approach, { crashAfterMs: 3000, installHandler: true });
      results[approach].crashMatched.push(r);
      console.log(`[run] ${approach} crash(matched-handler) rep ${i + 1}: mainAliveAfterCrash=${r.crash?.mainAlive} exitCode=${r.exitInfo?.code} signal=${r.exitInfo?.signal}`);
    }
  }

  const statsA = summarize("A) utilityProcess.fork", results.utility.idle);
  const statsB = summarize("B) in-process (imported into main)", results.inprocess.idle);
  summarizeCrash("A) utilityProcess.fork — DEFAULT handler policy", results.utility.crashDefault);
  summarizeCrash("B) in-process — DEFAULT handler policy", results.inprocess.crashDefault);
  summarizeCrash("A) utilityProcess.fork — MATCHED handler policy", results.utility.crashMatched);
  summarizeCrash("B) in-process — MATCHED handler policy", results.inprocess.crashMatched);

  if (statsA?.coldStats && statsB?.coldStats) {
    const delta = Math.abs(statsA.coldStats.median - statsB.coldStats.median);
    const maxSpread = Math.max(statsA.coldStats.spread, statsB.coldStats.spread);
    console.log(`\n=== cold-start delta vs. within-arm spread ===`);
    console.log(`median delta A vs B: ${delta.toFixed(0)} ms`);
    console.log(`A spread: ${statsA.coldStats.spread.toFixed(0)} ms | B spread: ${statsB.coldStats.spread.toFixed(0)} ms`);
    if (delta < maxSpread) {
      console.log(`FLAG: median delta (${delta.toFixed(0)} ms) is SMALLER than at least one arm's own spread (${maxSpread.toFixed(0)} ms) — not a reproducible directional claim at this n.`);
    } else {
      console.log(`Median delta exceeds both arms' spread — directionally supported at this n.`);
    }
  }

  writeFileSync(join(runsScratch, "raw-results.json"), JSON.stringify(results, null, 2));
  console.log(`\nraw JSON results: ${join(runsScratch, "raw-results.json")}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
