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
//   - crash behavior: what happens to the window/app/server when the process
//     hosting the server hits an unhandled, uncaught exception
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
 * @param {{crashAfterMs?: number}} opts
 */
async function runOnce(approach, { crashAfterMs = 0 } = {}) {
  const mainFile = approach === "utility" ? join(here, "main-utility.mjs") : join(here, "main-inprocess.mjs");
  const port = nextPort();
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
  try {
    await waitForHttp200(port, { timeoutMs: 25000 });
    coldStartMs = Date.now() - spawnTs;
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
    // Two idle snapshots (t+3s, t+8s after health-200) to show stability, same
    // methodology as WINDOWS-STACK.md's own RSS measurements. Only taken on
    // non-crash reps: a crash rep must not spend 8s here first, or the
    // crash — scheduled relative to the main process's OWN server-ready
    // timestamp, just a few ms after ours — has already happened (and
    // possibly already been cleaned up by QUIT_AFTER_MS) by the time we'd
    // get around to observing it. Found the hard way: an earlier version of
    // this script did exactly that and reported a bogus "main process died"
    // for approach A that was actually just a mistimed observation window.
    for (const delayMs of [3000, 8000]) {
      await new Promise((r) => setTimeout(r, delayMs === 3000 ? 3000 : 5000)); // 3s then +5s = 8s
      const tree = await processTree(mainPid);
      result.idle.push({ atMsAfterReady: delayMs, tree, totalMB: mb(sumRss(tree)) });
    }
  }

  if (!healthError && crashAfterMs) {
    // Observe shortly before the crash (for a like-for-like idle reading)
    // and generously after it, so the process has had time to either exit
    // cleanly (approach A) or reveal that it hasn't (approach B).
    await new Promise((r) => setTimeout(r, Math.max(0, crashAfterMs - 1000)));
    const preCrashTree = await processTree(mainPid);
    await new Promise((r) => setTimeout(r, 1000 + 5000)); // past the crash instant, then settle
    const postCrashTree = await processTree(mainPid);
    const mainAlive = await isPidAlive(mainPid);
    const heartbeat = readHeartbeat(heartbeatFile);
    result.crash = {
      crashAfterMs,
      preCrashTotalMB: mb(sumRss(preCrashTree)),
      mainAlive,
      heartbeat,
      postCrashTree,
      postCrashTotalMB: mb(sumRss(postCrashTree)),
    };
  }

  // Let the main process quit itself (QUIT_AFTER_MS) or die from the crash;
  // hard-kill as a watchdog if it doesn't exit on its own.
  const watchdog = setTimeout(() => { try { child.kill(); } catch {} }, 15000);
  await exited;
  clearTimeout(watchdog);
  result.exitInfo = exitInfo;
  result.stderrTail = stderrBuf.slice(-2000);
  result.logEvents = readJsonLines(logFile);
  return result;
}

function fmtMs(ms) { return ms === null ? "N/A" : `${ms.toFixed(0)} ms`; }

function summarize(label, reps) {
  const cold = reps.map((r) => r.coldStartMs).filter((x) => x !== null);
  const idle8 = reps.map((r) => r.idle.find((i) => i.atMsAfterReady === 8000)?.totalMB).filter((x) => x !== undefined);
  console.log(`\n=== ${label} ===`);
  console.log(`cold start (launch -> first /health 200), n=${cold.length}:`);
  cold.forEach((c, i) => console.log(`  rep ${i + 1}: ${fmtMs(c)}`));
  if (cold.length) {
    const sorted = [...cold].sort((a, b) => a - b);
    console.log(`  min=${fmtMs(sorted[0])} median=${fmtMs(sorted[Math.floor(sorted.length / 2)])} max=${fmtMs(sorted[sorted.length - 1])}`);
  }
  console.log(`idle RSS (whole process tree, t+8s after ready), n=${idle8.length}:`);
  idle8.forEach((v, i) => console.log(`  rep ${i + 1}: ${v.toFixed(1)} MB`));
  if (idle8.length) {
    const sorted = [...idle8].sort((a, b) => a - b);
    console.log(`  min=${sorted[0].toFixed(1)} MB median=${sorted[Math.floor(sorted.length / 2)].toFixed(1)} MB max=${sorted[sorted.length - 1].toFixed(1)} MB`);
  }
  console.log(`\nfull process tree, last idle rep, t+8s:`);
  const lastTree = reps[reps.length - 1]?.idle.find((i) => i.atMsAfterReady === 8000)?.tree;
  if (lastTree) console.log(fmtTree(lastTree));
}

function summarizeCrash(label, reps) {
  console.log(`\n=== ${label} — crash behavior ===`);
  reps.forEach((r, i) => {
    const c = r.crash;
    console.log(`rep ${i + 1}:`);
    if (!c) { console.log("  (no crash data — health check failed before crash phase)"); return; }
    console.log(`  main process (pid ${r.mainPid}) alive after injected crash: ${c.mainAlive}`);
    console.log(`  heartbeat at/after crash: ${JSON.stringify(c.heartbeat)}`);
    console.log(`  process tree after crash (${c.postCrashTotalMB.toFixed(1)} MB total):`);
    console.log(c.postCrashTree.length ? fmtTree(c.postCrashTree).replace(/^/gm, "    ") : "    (empty — root process gone)");
    console.log(`  electron exit: code=${r.exitInfo?.code} signal=${r.exitInfo?.signal}`);
    const notable = r.logEvents.filter((e) =>
      ["crash-scheduled", "server-exit", "main-uncaught-exception", "quitting", "window-all-closed"].includes(e.event)
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
  console.log(`repetitions: idle=${IDLE_REPS} crash=${CRASH_REPS}`);

  const results = { utility: { idle: [], crash: [] }, inprocess: { idle: [], crash: [] } };

  for (const approach of ["utility", "inprocess"]) {
    for (let i = 0; i < IDLE_REPS; i++) {
      console.log(`\n[run] ${approach} idle rep ${i + 1}/${IDLE_REPS} ...`);
      const r = await runOnce(approach, {});
      results[approach].idle.push(r);
      console.log(`[run] ${approach} idle rep ${i + 1}: coldStart=${fmtMs(r.coldStartMs)} healthError=${r.healthError}`);
    }
    for (let i = 0; i < CRASH_REPS; i++) {
      console.log(`\n[run] ${approach} crash rep ${i + 1}/${CRASH_REPS} ...`);
      const r = await runOnce(approach, { crashAfterMs: 3000 });
      results[approach].crash.push(r);
      console.log(`[run] ${approach} crash rep ${i + 1}: coldStart=${fmtMs(r.coldStartMs)} mainAliveAfterCrash=${r.crash?.mainAlive}`);
    }
  }

  summarize("A) utilityProcess.fork", results.utility.idle);
  summarize("B) in-process (imported into main)", results.inprocess.idle);
  summarizeCrash("A) utilityProcess.fork", results.utility.crash);
  summarizeCrash("B) in-process (imported into main)", results.inprocess.crash);

  writeFileSync(join(runsScratch, "raw-results.json"), JSON.stringify(results, null, 2));
  console.log(`\nraw JSON results: ${join(runsScratch, "raw-results.json")}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
