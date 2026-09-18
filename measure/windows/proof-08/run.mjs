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
// ROUND-3 note (see docs/adr/0004-...md §4 "asymmetry disclosure" and §6):
// the IDLE cells of Approach A fork the real, unmodified server.js, which
// runs its own bottom-of-file bootstrap guard — that guard ALSO calls
// startDiscovery(3001), a UDP bind that can fail with EADDRINUSE depending
// on ambient machine state (an unrelated process already holding the port).
// Approach B's idle cell calls only startServer(); it never attempts this
// bind. This run.mjs now (a) prints every server-stdout/server-stderr event
// verbatim per idle rep instead of filtering them out, and (b) records, per
// idle rep of Approach A, whether the discovery socket's actual OS-level
// owner (via Get-NetUDPEndpoint) is our own forked child — see
// lib.mjs's discoveryBindOwner(). The CRASH cells of Approach A do not fork
// server.js directly (they fork server-entry-crash.mjs, which calls
// startServer() only, same as Approach B) — so this asymmetry is confined
// to the idle/RSS/cold-start cells; it does not touch the crash comparison
// §5's decision rests on.
//
// Usage: node measure/windows/proof-08/run.mjs [--reps N] [--crash-reps N]
import { spawn, execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { isolatedAppData, waitForHttp200, processTree, sumRss, mb, fmtTree, isPidAlive, discoveryBindOwner } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

// ROUND-3 FIX (minor finding #5): the old flag() parser did `Number(args[i+1])`
// with no validation — a malformed value (e.g. --reps abc) becomes NaN,
// every downstream loop `for (let i = 0; i < NaN; i++)` silently runs ZERO
// times, and the script still prints a complete-looking report full of
// "n=0" sections and exits 0. A benchmark that silently measures nothing
// must fail loudly instead. Reject non-finite, non-integer or non-positive
// values, name the flag and the exact value received, and exit non-zero
// BEFORE any Electron process is spawned.
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const raw = args[i + 1];
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    console.error(`FATAL: invalid --${name} value: ${JSON.stringify(raw)} — expected a positive integer.`);
    process.exit(1);
  }
  return n;
};
const IDLE_REPS = flag("reps", 3);
const CRASH_REPS = flag("crash-reps", 2);
const BASE_PORT = 15900;
const DISCOVERY_PORT = 3001; // matches server.js's own DISCOVERY_PORT (server.js:169)
let portCounter = 0;
const nextPort = () => BASE_PORT + portCounter++;

// ROUND-2 FIX (minor #9): named, explicit sample points instead of an
// unnamed `delayMs === 3000 ? 3000 : 5000` ternary that silently re-derived
// the sleep duration from the label. Each sample's ACTUAL elapsed-since-ready
// time (which includes drift from the previous sample's own CIM round trip)
// is now recorded alongside the nominal target, and the wait before each
// sample is computed from that actual drift, not a hardcoded constant.
//
// ROUND-3 FIX (minor finding #6): the constant itself was unused by the
// three call sites that actually read a sample back out — they all
// hardcoded the literal 8000. Editing IDLE_SAMPLE_POINTS_MS therefore
// silently produced an empty report instead of an error. REPORTED_SAMPLE_MS
// is now derived from the constant and used at every read site; a
// successful (non-health-failed) rep missing that sample point throws
// instead of being filtered to nothing (see summarize()).
const IDLE_SAMPLE_POINTS_MS = [3000, 8000];
const REPORTED_SAMPLE_MS = IDLE_SAMPLE_POINTS_MS.at(-1);

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

// ROUND-3 FIX (minor finding #9): the interleaving round-2 added still ran a
// FIXED inner order (utility, inprocess) every rep — B always ran second,
// always inheriting whatever the OS just finished tearing down for A. This
// alternates the inner order by rep index so each arm runs first exactly
// half the time, and the realized order is recorded per rep (armPosition)
// so the residual position effect on cold start can be reported as a
// number (see summarize()) instead of argued away.
function armOrder(repIndex) {
  return repIndex % 2 === 0 ? ["utility", "inprocess"] : ["inprocess", "utility"];
}

function concurrentProcessCount() {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_Process | Measure-Object).Count"],
      (err, stdout) => resolve(err ? null : Number(String(stdout).trim()))
    );
  });
}

/**
 * Runs one Electron process for the given approach and returns measured facts.
 * @param {"utility"|"inprocess"} approach
 * @param {{crashAfterMs?: number, installHandler?: boolean, armPosition?: "first"|"second"}} opts
 */
async function runOnce(approach, { crashAfterMs = 0, installHandler = false, armPosition = null } = {}) {
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
    armPosition,
    coldStartMs,
    healthError,
    idle: [],
    crash: null,
    exitInfo: null,
    stderrTail: null,
    discovery: { attempted: false },
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
      const tree = await processTree(mainPid, { notBeforeMs: spawnTs });
      const actualElapsedMs = Date.now() - readyTs;
      result.idle.push({ atMsAfterReady: pointMs, actualElapsedMs, tree, totalMB: mb(sumRss(tree)) });
    }

    // ROUND-3 FIX (major finding #1c): positive discovery-bind evidence,
    // Approach A idle cell only (the only cell that forks server.js
    // directly and hits its startDiscovery(3001) call — see the file
    // header). Checked via Get-NetUDPEndpoint's actual OwningProcess, never
    // by scraping stdout for a "bound" success line startDiscovery never
    // emits (it only logs on ITS OWN bind error — server.js:212, ROUND-4 FIX
    // minor finding #8: this previously cited server.js:210, which is the
    // discovery REPLY log, not the bind-error handler).
    if (approach === "utility") {
      const lastTree = result.idle[result.idle.length - 1]?.tree || [];
      const serverChild = lastTree.find((p) => /Node — our forked server\.js/.test(p.role));
      if (serverChild) {
        try {
          const ownerPid = await discoveryBindOwner(DISCOVERY_PORT);
          result.discovery = {
            attempted: true,
            expectedPid: serverChild.pid,
            ownerPid,
            boundToUs: ownerPid === serverChild.pid,
          };
        } catch (e) {
          result.discovery = { attempted: true, expectedPid: serverChild.pid, error: e.message };
        }
      } else {
        result.discovery = { attempted: true, expectedPid: null, note: "forked server child not found in last idle tree snapshot" };
      }
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
    const preCrashTree = await processTree(mainPid, { notBeforeMs: spawnTs });
    const preCrashElapsedMs = Date.now() - readyTs;
    const postWaitMs = Math.max(0, (crashAfterMs + 5000) - (Date.now() - readyTs));
    await new Promise((r) => setTimeout(r, postWaitMs));
    const postCrashTree = await processTree(mainPid, { notBeforeMs: spawnTs });
    const postCrashElapsedMs = Date.now() - readyTs;
    const mainAlive = await isPidAlive(mainPid, { notBeforeMs: spawnTs });
    const heartbeat = readHeartbeat(heartbeatFile);
    const heartbeatSnapshotAt = Date.now();
    result.crash = {
      crashAfterMs,
      installHandler,
      preCrashElapsedMs,
      postCrashElapsedMs,
      preCrashTotalMB: mb(sumRss(preCrashTree)),
      mainAlive,
      heartbeat,
      heartbeatSnapshotAt,
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

// ROUND-3 FIX (minor finding #8): sorted[floor(n/2)] is the UPPER-MIDDLE
// order statistic at even n, not the median — it silently mislabeled every
// figure in this ADR (every reported n was 8). Average the two middle
// values at even n like an actual median.
function median(sorted) {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stats(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0],
    median: median(sorted),
    max: sorted[sorted.length - 1],
    spread: sorted[sorted.length - 1] - sorted[0],
  };
}

// ROUND-4 FIX (blocker finding #1, required-fix item 2): this FLAG existed
// ONLY for cold start (originally at the bottom of main(), below). The
// round-4 reviewer's central complaint is that idle RSS — the ADR's actual
// load-bearing number — never got the same treatment, so a contaminated
// battery (one arm's spread blown out by an adopted unrelated process) could
// publish a clean-looking delta/spread pair with nothing printed to flag it.
// Lifted into a shared helper and now applied to BOTH cold start and idle
// RSS, so neither metric can publish a "the delta is far outside both arms'
// spreads" claim the run's own numbers don't support.
function deltaVsSpread(title, unit, statsA, statsB, fmt) {
  if (!statsA || !statsB) return;
  const delta = Math.abs(statsA.median - statsB.median);
  const maxSpread = Math.max(statsA.spread, statsB.spread);
  console.log(`\n=== ${title}: delta vs. within-arm spread ===`);
  console.log(`median delta A vs B: ${fmt(delta)} ${unit}`);
  console.log(`A spread: ${fmt(statsA.spread)} ${unit} | B spread: ${fmt(statsB.spread)} ${unit}`);
  if (delta < maxSpread) {
    console.log(`FLAG: median delta (${fmt(delta)} ${unit}) is SMALLER than at least one arm's own spread (${fmt(maxSpread)} ${unit}) — not a reproducible directional claim at this n.`);
  } else {
    console.log(`Median delta exceeds both arms' spread — directionally supported at this n.`);
  }
}

function summarize(label, reps) {
  console.log(`\n=== ${label} ===`);

  // ROUND-3 FIX (minor finding #5, second half): a rep that never answered
  // /health is a FAILED rep, not a legitimate zero-length idle array — it
  // must be counted and shown, not silently excluded with no trace.
  const failedReps = reps.filter((r) => r.healthError);
  const okReps = reps.filter((r) => !r.healthError);
  if (failedReps.length) {
    console.log(`HEALTH-CHECK FAILURES: ${failedReps.length}/${reps.length} reps never answered /health 200 (excluded from stats below, listed here so they are never silently dropped):`);
    failedReps.forEach((r) => console.log(`  port ${r.port}: ${r.healthError}`));
  }
  if (okReps.length === 0) {
    console.log(`FATAL: 0/${reps.length} reps produced usable data for "${label}" — this is a failed run, not an empty one. No stats below.`);
    return { coldStats: null, idleStats: null, hadFailure: true };
  }

  const cold = okReps.map((r) => r.coldStartMs);
  // A successful (health-200) rep missing its reported idle sample is a
  // sampler bug, not a legitimate empty result — throw rather than filter
  // it away into an artificially-smaller n (round-2 pattern this round's
  // review flagged as recurring, finding #6).
  const idleSamples = okReps.map((r) => {
    const sample = r.idle.find((i) => i.atMsAfterReady === REPORTED_SAMPLE_MS);
    if (!sample) {
      throw new Error(`${label}: rep on port ${r.port} passed its health check but has no idle sample at ${REPORTED_SAMPLE_MS}ms — this is a sampler bug, not a legitimate empty result.`);
    }
    return sample;
  });
  const idle = idleSamples.map((s) => s.totalMB);
  const idleElapsed = idleSamples.map((s) => s.actualElapsedMs);

  console.log(`cold start (launch -> first /health 200), n=${cold.length}:`);
  okReps.forEach((r, i) => console.log(`  rep ${i + 1} [ran ${r.armPosition ?? "n/a"} this rep]: ${fmtMs(r.coldStartMs)}`));
  const coldStats = stats(cold);
  if (coldStats) {
    console.log(`  min=${fmtMs(coldStats.min)} median=${fmtMs(coldStats.median)} max=${fmtMs(coldStats.max)} spread=${fmtMs(coldStats.spread)}`);
  }
  // ROUND-3 addition (finding #9 follow-up): with the inner order now
  // alternating, the residual position effect ("running second, right
  // after the other arm's teardown") is a measured split, not an argued-
  // away bias.
  const firstPos = okReps.filter((r) => r.armPosition === "first").map((r) => r.coldStartMs);
  const secondPos = okReps.filter((r) => r.armPosition === "second").map((r) => r.coldStartMs);
  if (firstPos.length && secondPos.length) {
    const fs = stats(firstPos), ss = stats(secondPos);
    console.log(`  cold start split by arm position: ran FIRST n=${fs.n} median=${fmtMs(fs.median)} | ran SECOND n=${ss.n} median=${fmtMs(ss.median)}`);
  }

  console.log(`idle RSS (whole process tree, nominal t+${REPORTED_SAMPLE_MS}ms after ready — see actual elapsed below), n=${idle.length}:`);
  idle.forEach((v, i) => console.log(`  rep ${i + 1}: ${v.toFixed(1)} MB (actual elapsed: ${idleElapsed[i]} ms)`));
  const idleStats = stats(idle);
  if (idleStats) {
    console.log(`  min=${idleStats.min.toFixed(1)} MB median=${idleStats.median.toFixed(1)} MB max=${idleStats.max.toFixed(1)} MB spread=${idleStats.spread.toFixed(1)} MB`);
  }

  // ROUND-3 FIX (major finding #1a): print server-stdout/server-stderr
  // verbatim for every rep — not gated behind an allowlist or an
  // error-shaped regex. An allowlist can only show events the probe itself
  // anticipated, which is exactly how round-2's EADDRINUSE discovery-bind
  // failure went unreported (the old `notable` filter in summarizeCrash
  // excluded server-stdout/server-stderr outright, and this idle path never
  // printed logEvents at all).
  console.log(`server stdout/stderr, verbatim, per rep:`);
  okReps.forEach((r, i) => {
    const lines = r.logEvents.filter((e) => e.event === "server-stdout" || e.event === "server-stderr");
    if (!lines.length) { console.log(`  rep ${i + 1}: (no server-stdout/server-stderr events captured)`); return; }
    lines.forEach((l) => console.log(`  rep ${i + 1} [${l.event}]: ${l.line}`));
  });

  // ROUND-3 FIX (major finding #1c): discovery-socket bind outcome, printed
  // for every rep including "attempted=false" ones, so a reader can tell
  // "this cell never calls startDiscovery" from "not recorded".
  console.log(`discovery-socket (UDP ${DISCOVERY_PORT}) bind outcome per rep:`);
  okReps.forEach((r, i) => {
    const d = r.discovery;
    if (!d?.attempted) { console.log(`  rep ${i + 1}: attempted=false`); return; }
    if (d.error) { console.log(`  rep ${i + 1}: attempted=true expectedPid=${d.expectedPid} ownerCheckError=${d.error}`); return; }
    console.log(`  rep ${i + 1}: attempted=true expectedPid(our forked server child)=${d.expectedPid} actualOwnerPid=${d.ownerPid} boundToUs=${d.boundToUs}`);
  });

  console.log(`\nfull process tree, last idle rep, nominal t+${REPORTED_SAMPLE_MS}ms:`);
  const lastTree = okReps[okReps.length - 1]?.idle.find((i) => i.atMsAfterReady === REPORTED_SAMPLE_MS)?.tree;
  if (lastTree) console.log(fmtTree(lastTree));
  return { coldStats, idleStats, hadFailure: false };
}

function summarizeCrash(label, reps) {
  console.log(`\n=== ${label} — crash behavior ===`);
  reps.forEach((r, i) => {
    const c = r.crash;
    console.log(`rep ${i + 1} [ran ${r.armPosition ?? "n/a"} this rep]:`);
    if (!c) { console.log("  (no crash data — health check failed before crash phase)"); return; }
    console.log(`  handler policy: ${c.installHandler ? "matched (explicit process.on('uncaughtException') installed)" : "default (no handler installed by this probe)"}`);
    console.log(`  main process (pid ${r.mainPid}) alive after injected crash: ${c.mainAlive}`);
    // ROUND-3 FIX (major finding #2, this file's own instance of it): the
    // heartbeat is the exact event-loop-liveness signal whose death §5.1's
    // "frozen heartbeat" finding is about. Printing its content with no age
    // lets a stale last-known-good value read as current — the identical
    // defect flagged separately for crash-timeline.mjs. hbAgeMs makes
    // staleness visible instead of implicit.
    const hbAgeMs = c.heartbeat ? (c.heartbeatSnapshotAt - c.heartbeat.t) : null;
    console.log(`  heartbeat (LAST-KNOWN-GOOD, not necessarily current — age ${hbAgeMs === null ? "N/A" : hbAgeMs + " ms"} at snapshot time): ${JSON.stringify(c.heartbeat)}`);
    console.log(`  discovery-socket bind (UDP ${DISCOVERY_PORT}): attempted=${r.discovery?.attempted ?? false}`);
    console.log(`  process tree after crash (${c.postCrashTotalMB.toFixed(1)} MB total, actual elapsed ${c.postCrashElapsedMs} ms since ready):`);
    console.log(c.postCrashTree.length ? fmtTree(c.postCrashTree).replace(/^/gm, "    ") : "    (empty — root process gone)");
    console.log(`  electron exit: code=${r.exitInfo?.code} signal=${r.exitInfo?.signal}`);
    // ROUND-3 FIX (major finding #1a, crash-side): print ALL log events —
    // there are only a handful per crash rep, so a curated allowlist buys
    // nothing but the risk of hiding an event shape nobody anticipated when
    // the list was written (exactly what happened to server-stdout/
    // server-stderr in the idle path).
    console.log(`  all log events: ${JSON.stringify(r.logEvents)}`);
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
  const concurrentProcs = await concurrentProcessCount();
  console.log(`concurrent OS processes at run start (Get-CimInstance Win32_Process | Measure-Object): ${concurrentProcs ?? "unavailable"}`);
  console.log(`arm order: ALTERNATING per rep index — rep 0 runs (utility, inprocess), rep 1 runs
(inprocess, utility), etc. This reduces, but as a fixed inner-loop-per-rep
alternation rather than a full randomization, does not perfectly randomize,
the round-2 finding that one arm always ran second and inherited the other's
just-finished teardown. Each rep's realized order is recorded (armPosition)
and reported as a measured split in the summaries below. Each rep also gets
its own isolated Electron userData dir (app.setPath), so no rep inherits a
warm GPU/shader cache from a previous rep or a previous arm regardless of
position.`);

  const results = {
    meta: { concurrentProcessCountAtStart: concurrentProcs, idleReps: IDLE_REPS, crashReps: CRASH_REPS },
    utility: { idle: [], crashDefault: [], crashMatched: [] },
    inprocess: { idle: [], crashDefault: [], crashMatched: [] },
  };

  for (let i = 0; i < IDLE_REPS; i++) {
    const order = armOrder(i);
    for (let pos = 0; pos < order.length; pos++) {
      const approach = order[pos];
      const armPosition = pos === 0 ? "first" : "second";
      console.log(`\n[run] ${approach} idle rep ${i + 1}/${IDLE_REPS} (position: ${armPosition}) ...`);
      const r = await runOnce(approach, { armPosition });
      results[approach].idle.push(r);
      console.log(`[run] ${approach} idle rep ${i + 1}: coldStart=${fmtMs(r.coldStartMs)} healthError=${r.healthError}`);
    }
  }

  for (let i = 0; i < CRASH_REPS; i++) {
    const order = armOrder(i);
    for (let pos = 0; pos < order.length; pos++) {
      const approach = order[pos];
      const armPosition = pos === 0 ? "first" : "second";
      console.log(`\n[run] ${approach} crash(default) rep ${i + 1}/${CRASH_REPS} (position: ${armPosition}) ...`);
      const r = await runOnce(approach, { crashAfterMs: 3000, installHandler: false, armPosition });
      results[approach].crashDefault.push(r);
      console.log(`[run] ${approach} crash(default) rep ${i + 1}: mainAliveAfterCrash=${r.crash?.mainAlive} exitCode=${r.exitInfo?.code} signal=${r.exitInfo?.signal}`);
    }
  }

  for (let i = 0; i < CRASH_REPS; i++) {
    const order = armOrder(i);
    for (let pos = 0; pos < order.length; pos++) {
      const approach = order[pos];
      const armPosition = pos === 0 ? "first" : "second";
      console.log(`\n[run] ${approach} crash(matched-handler) rep ${i + 1}/${CRASH_REPS} (position: ${armPosition}) ...`);
      const r = await runOnce(approach, { crashAfterMs: 3000, installHandler: true, armPosition });
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

  // ROUND-3 FIX (minor finding #5, second half): a summarize() that hit 0
  // usable reps must fail the whole run loudly, not just print "n=0" and
  // exit 0 like nothing happened.
  if (statsA.hadFailure || statsB.hadFailure) {
    console.error(`\nFATAL: one or both idle arms produced zero usable reps (A: ${statsA.hadFailure ? "FAILED" : "ok"}, B: ${statsB.hadFailure ? "FAILED" : "ok"}).`);
    process.exitCode = 1;
  }

  deltaVsSpread("cold start", "ms", statsA?.coldStats, statsB?.coldStats, (v) => v.toFixed(0));
  // ROUND-4 FIX (blocker finding #1): idle RSS now gets the identical
  // delta-vs-spread FLAG cold start already had — see deltaVsSpread's
  // header comment above.
  deltaVsSpread("idle RSS (whole process tree)", "MB", statsA?.idleStats, statsB?.idleStats, (v) => v.toFixed(1));

  writeFileSync(join(runsScratch, "raw-results.json"), JSON.stringify(results, null, 2));
  console.log(`\nraw JSON results: ${join(runsScratch, "raw-results.json")}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
