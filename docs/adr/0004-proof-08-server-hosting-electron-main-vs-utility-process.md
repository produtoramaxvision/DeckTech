# ADR-0004: Hosting server.js — `utilityProcess.fork` vs the Electron main process

- Status: Accepted
- Date: 2026-09-17 (round-1), revised 2026-09-17 (round-2 — see below)
- Requirement: PROOF-08 (`.maxvision/REQUIREMENTS.md` Fase 0), decides D15,
  informs SHELL-01/SHELL-02/SHELL-03 (Fase 5)
- Supersedes: nothing. Closes the gap `WINDOWS-STACK.md` §9 left open — that
  document compared `utilityProcess` against `child_process` and against the
  Tauri sidecar, but never against hosting the server directly in Electron's
  main process (which is already Node).
- Machine: Windows 11 Pro 22631, x64 (this machine)

> **Round-2 revision note.** A rigorous review rejected the round-1 version of
> this ADR on 9 findings (2 blocker, 4 major, 3 minor) — chiefly: the
> committed probe couldn't actually be run (a Windows PowerShell JSON bug
> killed the whole battery on any machine with 100+ processes, i.e. this one),
> the crash-behavior conclusion conflated "in-process hosting" with "Electron's
> documented default main-process error dialog", the isolation claim in the
> Appendix was false (Electron's own profile leaked into the real
> `%APPDATA%`), the A-then-B run order let one arm always inherit the other's
> warm GPU/shader cache, and the published cold-start delta was smaller than
> its own within-arm spread. All 9 are fixed below, in the probe code and in
> this text, and the full battery was re-run from the corrected code —
> **every number in §4 and §5 is from that re-run**, not carried over. The
> decision (ship `utilityProcess.fork`) is unchanged; §5 and §8.1's reasoning
> for it are rewritten. See §6 and the inline "ROUND-2 FIX" comments in
> `measure/windows/proof-08/*.mjs` for the mechanism of each fix.

> Evidence convention: every number and behavior below is `[MEASURED]` — produced
> by running the probes in `measure/windows/proof-08/` on this machine — or
> `[DOC]` (Electron/Node documentation, fetched via context7, not memory).
> Nothing here is asserted without having been run and its output read.

## 1. Context

`WINDOWS-STACK.md` measured the Node server (`node server.js`) alone at
**68.6–71.2 MB working set** (isolated process, `APPDATA` redirected, PORT
overridden) and called that "the floor". An in-process design removes that
entire process — but D15 explicitly requires this decided by measurement,
not preference, and the research never built the in-process side to compare
against.

There is also a structural tension the task asked to be weighed explicitly:
**SHELL-03** requires the host to *adopt* an already-running external
`server.js` (semantic-version match, not `ServerManager.swift`'s exact-string
bug). Adoption is, by construction, a separate-process concern — there is no
"in-process" way to adopt a server that is already running as its own OS
process. So even if hosting were moved in-process for the *embedded* case,
the shell still needs full separate-process supervision (health polling,
port-conflict handling, crash detection) for the *adopted* case. The
question this ADR answers is whether the measured savings from an in-process
embedded server justify maintaining **two** hosting models instead of one.

## 2. What was built

All under `measure/windows/proof-08/`, none of it touching production code
(`server.js` is imported/forked, never edited):

- `lib.mjs` — shared probe helpers: isolated `%APPDATA%` per run, HTTP
  polling for `/health` 200, and a Windows process-tree snapshot via
  `Get-CimInstance Win32_Process` (pid/parent-pid/name/working-set/command
  line), with each process's Chromium role (`browser (main)`, `gpu-process`,
  `utility (network.mojom.NetworkService)`, `utility (Node — our forked
  server.js)`, `renderer`) derived from its `--type=`/`--utility-sub-type=`
  command-line flags. Includes retries on an empty snapshot AND on a thrown
  parse error — see §6, "measurement bugs found along the way", for why the
  latter was necessary (round-2, blocker). **CommandLine is base64-encoded on
  the PowerShell side and decoded in JS**, never round-tripped as free-form
  text through Windows PowerShell 5.1's `ConvertTo-Json` — also §6.
- `main-utility.mjs` — **Approach A.** Electron main process that, once
  ready, redirects its own `userData` path via `app.setPath('userData', ...)`
  (isolation fix, §6), opens a `BrowserWindow`, and calls
  `utilityProcess.fork(serverPath, ...)` where `serverPath` is the real,
  unmodified `server.js`, relying on its own bottom-of-file bootstrap guard
  (`import.meta.url === pathToFileURL(process.argv[1]).href`) exactly as
  `node server.js` would.
- `main-inprocess.mjs` — **Approach B.** Electron main process that, once
  ready, redirects its own `userData` path the same way, opens a
  `BrowserWindow`, dynamically `import()`s the real `server.js`, and calls
  its exported `startServer({ port })` directly — same process as the
  window. Supports an `PROOF08_INSTALL_UNCAUGHT_HANDLER` flag (§5).
- `server-entry-crash.mjs` — a thin wrapper used **only** for the crash
  sub-test of Approach A (see §5 for why a wrapper was needed instead of the
  originally-planned `--import` preload). Also supports
  `PROOF08_INSTALL_UNCAUGHT_HANDLER` (§5).
- `run.mjs` — the runnable probe: boots both approaches, **interleaved**
  (round-2 fix — A, B, A, B, ... per rep index, not all-A-then-all-B; see
  §6), several repetitions each, and prints cold start (with spread, not just
  median), idle RSS (whole tree, not one number, with actual elapsed-since-
  ready recorded per sample), and crash behavior in **two** handler-policy
  configurations. `node measure/windows/proof-08/run.mjs [--reps N]
  [--crash-reps N]`.
- `crash-timeline.mjs` — a finer-grained companion probe (300 ms resolution)
  used to build the timeline evidence in §5. Takes an optional
  `--matched-handler` flag.

Electron version: **44.4.1** — the same version `WINDOWS-STACK.md` already
measured with, so this ADR's numbers are comparable to it. Its bundled
runtime, read from `process.versions` inside the main process rather than
assumed: **Node 24.21.0, V8 15.2.124.19-electron.0, Chromium 152.0.7977.78**
(re-verified independently for round-2, same output).

## 3. ESM in the Electron main process — what context7 says, and one thing it doesn't warn about

`server.js` is ESM (`"type": "module"`). Per Electron's own docs
(`electron/electron`, `docs/tutorial/esm.md`, fetched via context7):

- ESM in the main process has used **Node's own ESM loader since
  Electron 28.0.0** — no special handling needed for a `.mjs` main file or a
  `"type": "module"` main file.
- The one documented caveat: **"you must use `await` generously before the
  app's `ready` event"** — a *dynamic* `import()` at the top level is not
  awaited by Electron itself, so code inside it can run after `ready` fires
  if you don't `await` it yourself.

**What the docs don't say, and what this probe found empirically:** a
top-level `await app.whenReady()` in a `.mjs` main script **hangs forever**
on this machine/Electron 44.4.1 — `app.on('ready', ...)` never fires either,
confirmed with a two-line minimal repro:

```js
import { app } from "electron";
console.error("before"); // prints
await app.whenReady();   // never resolves — process hangs indefinitely
console.error("after");  // never prints
```

The `.then()` form of the exact same call resolves immediately and normally.
This is a real, reproducible cost of "ESM in the main process" that the
tutorial's caveat doesn't cover, and it forced `main-inprocess.mjs` (Approach
B) to use `app.whenReady().then(async () => { ... })` instead of top-level
await, same as `main-utility.mjs` already did. Anyone shipping DeckTech's
shell as ESM needs this workaround from day one — it is not a
Fase-5-only detail.

## 4. Cold start and idle RSS — measured, 8 repetitions each, interleaved

Method: `node measure/windows/proof-08/run.mjs --reps 8 --crash-reps 3`.
**Round-2 change:** reps for A and B are now **interleaved** (A, B, A, B, ...
by rep index) rather than run all-A-then-all-B, and each rep gets its own
isolated Electron `userData` directory (§6) — so no rep, in either arm, ever
inherits another rep's or another arm's warm GPU/shader cache. This directly
closes the round-2 finding that the published cold-start delta was an
artifact of a fixed run order over a shared, persistent cache. Each rep is a
fresh `electron <main-file>.mjs` process, isolated `%APPDATA%`/`userData`,
its own port. Cold start = wall-clock time from `child_process.spawn` to the
first HTTP 200 on `/health`. Idle RSS = whole process tree rooted at the main
process; the nominal sample point is t+8s after `/health` first answered,
and the **actual** elapsed time (which includes the previous sample's own
`Get-CimInstance` round-trip) is recorded per sample — see `run.mjs`'s
`IDLE_SAMPLE_POINTS_MS` — and ranged 8.8s–10.4s across the 16 idle reps of
this run, never nominal-exact, which is why it's reported as a range below
rather than a single "8s" label.

### Cold start (launch → first `/health` 200)

| | reps (ms) | min | median | max | spread |
|---|---|---|---|---|---|
| A) `utilityProcess.fork` | 792, 546, 629, 523, 640, 560, 999, 728 | 523 ms | **640 ms** | 999 ms | 476 ms |
| B) in-process | 404, 461, 340, 405, 598, 444, 584, 294 | 294 ms | **444 ms** | 598 ms | 304 ms |

**Median delta: 196 ms (B faster).** This does **not** support a directional
claim at this n: 196 ms is smaller than A's own within-arm spread (476 ms)
and smaller than B's own spread (304 ms) — i.e. the run-to-run noise inside
either arm is larger than the difference between arms. This reverses round-1's
"~50 ms at the median" claim, which was measured under a fixed A-then-B order
with a shared warm cache (round-2 finding: that number was both an order
artifact and, independently, smaller than the round-1 data's own spread —
115 ms and 159 ms within-arm at n=3 — without the ADR saying so). **Cold
start is not a reproducible factor in this decision** and §8 no longer cites
it as one.

### Idle RSS — whole process tree, nominal t+8s (actual 8.8s–10.4s) after ready

| | reps (MB) | min | median | max | spread |
|---|---|---|---|---|---|
| A) `utilityProcess.fork` | 333.4, 335.9, 336.0, 327.6, 334.0, 332.5, 331.2, 329.8 | 327.6 MB | **333.4 MB** | 336.0 MB | 8.4 MB |
| B) in-process | 277.6, 276.5, 280.1, 275.3, 275.3, 272.6, 276.1, 275.6 | 272.6 MB | **276.1 MB** | 280.1 MB | 7.5 MB |

**Delta: 57.3 MB** (median), i.e. what moving the server in-process actually
saves — not the 68.6–71.2 MB "floor" reported for the standalone
`node server.js` process, because the in-process host still pays the extra
JS heap/Node overhead where it now lives (main's own working set is ~93 MB in
Approach B vs ~80 MB in Approach A — see the trees below). Unlike cold start,
**this delta is far outside both arms' spreads (8.4 MB and 7.5 MB) and
reproduces cleanly across all 8 interleaved reps** — it is a reproducible,
directional finding.

Full tree, one representative rep per approach (rep 8, the last of the
interleaved run), role of every process shown (via
`--type=`/`--utility-sub-type=`, not guessed from name):

```
A) utilityProcess.fork:
electron.exe [browser (main)] (pid 44960) — 80.3 MB WS
  electron.exe [gpu-process] (pid 28664) — 81.7 MB WS
  electron.exe [utility (network.mojom.NetworkService)] (pid 46516) — 39.7 MB WS
  electron.exe [renderer] (pid 12992) — 61.5 MB WS
  electron.exe [utility (Node — our forked server.js)] (pid 31772) — 66.5 MB WS

B) in-process (imported into main):
electron.exe [browser (main)] (pid 49880) — 93.2 MB WS   <- vs A's main ~80 MB
  electron.exe [gpu-process] (pid 35640) — 81.8 MB WS
  electron.exe [utility (network.mojom.NetworkService)] (pid 35528) — 39.8 MB WS
  electron.exe [renderer] (pid 51576) — 60.8 MB WS
                                        (no 5th process — this is the whole saving)
```

Everything Chromium spins up regardless (gpu-process ~81–82 MB, network
utility ~40 MB, renderer ~59–65 MB) is identical between the two approaches
within measurement noise, as expected: neither approach touches how Electron
itself boots. The entire difference is the server's own footprint (measured
at 66.0–71.7 MB across this run's 8 reps as its own utility process — see
§4.1, extracted from `raw-results.json`, not eyeballed from one rep) versus
that same code folded into main's heap.

### 4.1 Cross-check against `WINDOWS-STACK.md` (round-2 correction)

The forked-server-child working set across all 8 idle reps of this run
(from `raw-results.json`, not the single representative tree printed above):
66.1, 71.5, 71.2, 66.0, 71.7, 69.2, 68.9, 66.5 MB — **range 66.0–71.7 MB**,
against `WINDOWS-STACK.md`'s standalone-process floor of **68.6–71.2 MB**
(`.maxvision/research/WINDOWS-STACK.md:45`, measured with standalone Node
v25.5.0). Round-1 called this "two independent measurements, two different
methodologies, same number" — that overstated it on two counts: **(a) both
figures are the same methodology** (an isolated OS process running
`server.js`, `APPDATA` redirected, `PORT` overridden), on two different Node
runtimes (standalone Node v25.5.0 vs. Electron-bundled Node 24.21.0, see §3),
not two different methodologies; **(b) it is not "the same number"** — this
run's 8-rep range (66.0–71.7 MB) both dips below and rises above
WINDOWS-STACK.md's range (68.6–71.2 MB) rather than landing inside it. The
honest statement: one methodology, two Node runtimes, two overlapping-but-not-
identical ranges — consistent with "the server's own footprint is roughly
similar whichever runtime hosts it", not with "agrees to within 3% of a
single figure".

## 5. Crash behavior — what actually happens, timestamped, in two handler configurations

> **Round-2 correction (blocker #2).** Round-1 measured "the default" for
> both arms and called Approach B's result "a silent, undiagnosable hang" —
> `stderr: EMPTY`, `diagnostic produced: no — silent`. That was a
> **misdiagnosis**. Electron's main process installs its own default
> `uncaughtException` handler that opens a blocking `dialog.showErrorBox`
> modal — the round-1 probe's `crash-timeline.mjs` never checked for a native
> window, only OS-process-alive/`/health`/heartbeat, so it never saw the
> dialog and reported "no diagnostic" for a state that in fact showed one, on
> screen, the whole time. Verified for this round via context7 against
> Electron's own source (`electron/electron`, `lib/browser/init.ts`):
>
> ```typescript
> // Don't quit on fatal error.
> process.on('uncaughtException', function (error) {
>   // Do nothing if the user has a custom uncaught exception handler.
>   if (process.listenerCount('uncaughtException') > 1) { return; }
>   // Show error in GUI.
>   import('electron/main').then(({ dialog }) => {
>     const stack = error.stack ? error.stack : `${error.name}: ${error.message}`;
>     dialog.showErrorBox('A JavaScript error occurred in the main process', 'Uncaught Exception:\n' + stack);
>   });
> });
> ```
>
> And confirmed empirically for **this machine** by enumerating the Win32
> windows owned by the main process pid (`EnumWindows`/`GetClassNameW` via a
> small PowerShell probe, not committed — one-off verification) while running
> Approach B's default-handler crash: at t≈1.3s only
> `class=Chrome_WidgetWin_1 title=Electron` (the app's own window) exists;
> from t≈2.6s onward (right after the 3s crash timer) a SECOND window
> appears and persists: **`class=#32770 title=Error visible=True`** —
> `#32770` is the Win32 predefined dialog-box class. (The title read `Error`
> on this run rather than the full documented string above it — Windows
> often truncates a `MB_ICONERROR` box's title bar to the icon-implied word;
> reporting what was observed, the mechanism is unambiguous either way.) The
> dialog IS the diagnostic; it just goes to a modal window instead of stderr,
> and it blocks the JS thread while open — which explains every other round-1
> observation (frozen heartbeat, no exit, no stderr) as **one mechanism**,
> not four independent mysteries.
>
> §5's method below now runs the crash in **two configurations** per arm:
> **default** (no handler this probe installs — Node's own default for A's
> forked child; Electron's dialog default for B's main process — this is
> what round-1 measured, kept for comparison) and **matched** (an identical,
> explicit `process.on('uncaughtException', e => { console.error(e.stack);
> process.exit(1); })` installed in whichever process actually takes the
> throw in each arm — server-entry-crash.mjs for A, main-inprocess.mjs for
> B). This is the controlled comparison round-1 was missing: round-1's A
> landed in a plain Node utility process (default: print + exit) while B
> landed in Electron's GUI-owning process (default: modal, no exit) —
> different confounds attributed entirely to "hosting location".

Method: after `/health` first answers 200, an exception is thrown from a
`setTimeout` callback 3 s later. `run.mjs --crash-reps 3` ran 3 reps of each
of the 4 combinations below (A/B × default/matched), interleaved with the
idle reps as described in §4.

### 5.1 Default handler policy (n=3 reps each, all 3 identical in shape per arm)

**A) `utilityProcess.fork`:** every rep — forked child exits(code 1) within
~3.2–3.4s of ready (`server-exit` event), main process alive the whole
observation window, window still exists, `/health` would answer
`ECONNREFUSED` once the child is gone. Example log excerpt (rep 1):
`{"event":"crash-scheduled","afterMs":3000,"target":"utility-child"}` →
`{"event":"server-exit","code":1,"mainStillAlive":true,"windowStillExists":true}`
→ (9s later) `{"event":"quitting",...}`. `electron exit: code=0` (our own
scheduled `app.quit()`, not the crash) in all 3 reps. **Correction made while
verifying this section (found by checking `raw-results.json` directly, not
trusting the printed summary):** none of these 3 reps' JSON logs contain a
`server-stderr` event with the literal stack-trace text, despite `code=1`
firing reliably every time — `main-utility.mjs`'s `child.stderr.on("data",
...)` forwarding of the forked child's output is itself racy under this
session's load (the `exit` event can fire, and `run.mjs` can read the log
file, before the last `data` event for stderr is delivered — confirmed
present in only 2 of 7 total A-arm crash reps run this round, both
matched-handler; see §5.2). What IS reliably true, independent of that
capture race: `code=1` matches Node's own documented default
`uncaughtException` exit code exactly, and a standalone check on this
machine (`node -e "setTimeout(()=>{throw new Error('x')},50)"`) confirms
Node's default prints the full stack to stderr and exits 1 — so the
diagnostic is real, but this probe's own literal-text capture of it is
unreliable and should not be read as "0 stack traces observed this round".

**B) in-process:** every rep — `mainAliveAfterCrash: true`, `electron exit:
code=null signal=SIGTERM` (our watchdog force-killed it; it never exited on
its own), process tree still fully present (main + gpu + network + renderer,
~275–278 MB total) at the post-crash snapshot ~9–9.5s after ready. Re-run
independently this round with `crash-timeline.mjs inprocess` (300ms
resolution, not the coarser before/after snapshot `run.mjs` takes) to verify
the "frozen heartbeat" / "`/health` TIMEOUT" specifics, since the round-2
battery's own crash summary only captures one heartbeat sample, not a
series: heartbeat ticks normally through t+2316ms, then **freezes at its
t+3617ms-tick content (`hb.t: ...4786`) for every subsequent poll through
t+63333ms** (40+ polls, 60+ real seconds under this session's load) while
`/health` answers `TIMEOUT` continuously from t+3617ms onward — confirming
round-1's finding stands under round-2's own fresh data, not just carried
over. `stderr tail:` for this run was empty, consistent with the mechanism
in the box above (the dialog is the diagnostic; stderr genuinely gets
nothing).

### 5.2 Matched handler policy — same explicit handler in both arms (n=3 reps each)

**A) `utilityProcess.fork`:** unchanged from 5.1 — `mainAliveAfterCrash:
true`, `electron exit: code=0` (self-scheduled quit) in all 3 reps.
Installing the handler in `server-entry-crash.mjs` produced the same
observable outcome (`code=1` child exit, main/window survive) as 5.1's
default; **2 of these 3 reps' logs do contain the literal `server-stderr`
text** (the 3rd hit the same capture race as 5.1) — e.g. rep 1:
`Error: PROOF-08 injected crash: simulated unhandled error in server process
(utility, via entry wrapper)\n    at Timeout._onTimeout
(...server-entry-crash.mjs:50:11)`. This is the same exit code and survival
outcome as the default, not a byte-for-byte stderr comparison (not
performed).

**B) in-process:** **`mainAliveAfterCrash: false` in all 3 reps** —
`electron exit: code=1`, post-crash process tree **empty** (root process
gone, all 4 processes including the window's own renderer/gpu/network
children terminated together). Log confirms the handler fired:
`{"event":"main-uncaught-exception-handled","message":"PROOF-08 injected
crash...","stack":"Error: ...\n    at Timeout._onTimeout
(.../main-inprocess.mjs:137:13)\n..."}`. Real propagation time, computed from
`raw-results.json`'s own event timestamps (not estimated): crash fires at
t+3000ms as scheduled, the handler observes it 2–5ms later, and
`exitInfo.at` follows the handler by **90–118ms** across the 3 reps — so the
process is fully gone roughly 3.1s after ready, not the ~10s figure below.
The ~10.0–10.8s `postCrashElapsedMs` reported per rep is when `run.mjs`
*takes its post-crash snapshot* (crash at 3s + the probe's own fixed ~5–7s
settle wait before snapshotting, not "time for the process to actually
exit") — the snapshot simply finds an already-empty tree, since the process
exited ~7s earlier than the snapshot was taken.

**The matched-handler comparison changes the diagnosis, not the decision.**
With the same handler policy, B's crash goes from "silent, undiagnosable
hang" to "loud, diagnosed, self-terminating" — one line of code away, exactly
as Electron's own default already does for a process without a GUI. But it
surfaces the asymmetry that **does** survive the correction: **A's forked
child dying never touches the window — it is architecturally a different OS
process — while B's `process.exit(1)` inside the handler takes the window
down with it every time**, because in Approach B the crash handler, the
server, and the `BrowserWindow` are the same process by construction. An
always-on tray app that wants "the server died, restart it, keep the window
up so the user sees a reconnecting state" gets that for free from Approach
A's process boundary and cannot get it from Approach B's matched handler
without *also* building a supervisor to relaunch the whole Electron process
— which is strictly more machinery than Approach A needs. (`main-utility.mjs`
also installs its own top-level `process.on('uncaughtException')` — logging
only, no `process.exit()` — as a third, deliberately different policy: if
the *main* process itself ever throws in Approach A, today it would log and
keep running rather than crash or hang; that path is untested by this crash
injection, which targets the forked child, and is noted here as a gap for
Fase 5 rather than measured.)

**One thing that had to be built to get here:** the original plan injected
the crash into the *forked* server process via
`execArgv: ["--import", "<crash-injector.mjs>"]` passed to
`utilityProcess.fork`. That preload **never loads** — confirmed with a
load-time `console.error` marker in the injector that never printed while
the forked `server.js` kept answering `/health` 200 for 19+ seconds straight,
the "scheduled" crash completely inert. `utilityProcess.fork` does not honor
an injected `--import`/`--require` the way plain Node `child_process.fork`
does. The crash sub-test for Approach A therefore forks
`server-entry-crash.mjs` instead — a thin wrapper that calls the real,
unmodified `startServer` export from `server.js` and then throws — while the
idle/cold-start sub-test above still forks `server.js` directly. This is
itself a finding worth carrying into Fase 5: **`utilityProcess.fork`'s
`execArgv` is not a general Node CLI-flag channel**, so any Fase-5 debugging
hook that assumes `--inspect` or `--import` will reach the forked server
needs to be verified the same way, not assumed.

The four behaviors, side by side:

| | main process survives | window survives | server signals down cleanly | diagnostic produced | self-terminates |
|---|---|---|---|---|---|
| A, default | **yes** | **yes** | yes — `ECONNREFUSED` once child gone | `code=1` matches Node's documented default exactly; literal stderr text captured in this probe's own log 0/4 A-arm reps this round (a probe capture race, not absence — see §5.1) | yes — child exits(1) in ~0ms |
| A, matched | **yes** | **yes** | yes — `ECONNREFUSED` once child gone | same as default; literal stderr text captured 2/3 reps (§5.2) | yes — child exits(1) in ~0ms |
| B, default | technically, but frozen | frozen, unresponsive | no — `TIMEOUT`, indistinguishable from "slow" | **yes — a modal dialog** (not stderr — confirmed empty; round-1 mischaracterized the dialog itself as absent) | **no — needs external kill** |
| B, matched | **no — whole process exits** | **no — dies with it** | yes — connection refused once process is gone | yes — full stack trace to stderr, captured in log for all 3 reps | **yes — process exits(1)** ~90–118ms after the handler runs, but takes the window with it |

## 6. Measurement bugs found along the way (disclosed, not hidden)

**Round-1 bug — quit-margin race.** The first full battery run reported
`idle RSS = 0.0 MB` / an empty tree for roughly 30% of the t+8s idle
snapshots, for **both** approaches — plainly wrong given every other snapshot
at the same point in the same reps was consistent within 2 MB. Root cause,
found by comparing the always-correct t+3s snapshot against the
sometimes-wrong t+8s one: the probe's own `QUIT_AFTER_MS` (originally
9000 ms, scheduled from the main process's internal `app-ready` clock, which
starts a few hundred ms before our external `/health`-poll clock) left too
little margin ahead of the t+8000 ms external snapshot once a
`Get-CimInstance Win32_Process` query — slow on this machine, which runs
100+ unrelated `node.exe` processes from other concurrent sessions — took
its own several hundred ms. The snapshot occasionally landed mid-quit. Fixed
by widening the idle-rep quit margin to 13000 ms (a ~5 s cushion past the
t+8000 check).

**Round-2 bug — WinPS 5.1 `ConvertTo-Json` control-character corruption
(blocker).** A rigorous review found that the committed round-1 probe
**could not be run at all** on this machine: `Get-CimInstance Win32_Process`
piped through `Select-Object ...,CommandLine | ConvertTo-Json -Compress`
does not reliably escape every control character when a process's own
`CommandLine` contains one — it emits the raw byte inside the JSON string
literal, producing invalid JSON. With 100+ concurrent processes on this box,
some process's command line containing a stray control character is a
when-not-if, and it killed `JSON.parse()` on the very first snapshot,
propagating past the round-1 retry (which only handled an *empty* result,
not a *thrown* one) and aborting the whole battery. Reproduced: `node
measure/windows/proof-08/run.mjs --reps 1 --crash-reps 0` on the pre-fix code
→ `SyntaxError: Bad control character in string literal in JSON` at
`lib.mjs:73`, 5/5 direct `processTree()` calls. **Fix:** `CommandLine` is now
base64-encoded on the PowerShell side (`[Convert]::ToBase64String(...)`) —
Base64 cannot contain a raw control character by construction — and decoded
in JS before role derivation; `processTree()`'s retry loop now also catches
a *thrown* error from the snapshot, not just an empty result. Verified 5/5
clean runs post-fix (see the reproduce commands in the Appendix), then the
full battery in §4/§5 ran to completion without incident.

**Round-2 bug — swallowed heartbeat/close errors (major).** `writeHeartbeat()`
in both `main-utility.mjs` and `main-inprocess.mjs`, and the `close()` call
in `main-inprocess.mjs`'s quit handler, ended in a bare `catch {}`. A
swallowed heartbeat-write failure (e.g. `EBUSY`/`EPERM` while
`crash-timeline.mjs`'s poll loop reads the same file) would have been
byte-identical, from the outside, to "the JS event loop is dead" — exactly
the signal §5.1 leans on to diagnose B-default's hang. Fixed: both now
append a distinct `heartbeat-write-failed` event (with `err.code`) to the
JSON-lines log instead of doing nothing, `close()`'s catch logs a
`server-close-failed` event, and `crash-timeline.mjs`'s heartbeat-file read
now reports a distinct `hbReadError` instead of a bare `hb=null`. **None of
these fired during the §4/§5 battery** — grepped for
`heartbeat-write-failed|server-close-failed` across the full run log: zero
matches — so this round's heartbeat/close data was not itself masking a
failure, but the ambiguity is now structurally closed rather than merely
absent this run.

**Round-2 bug — found during THIS round's own verification, not in the
reviewer's findings — `isPidAlive()` had no retry at all.** While
re-verifying the Appendix's reproduce commands after the fixes above (on
this machine at 791 concurrent OS processes — checked with
`Get-CimInstance Win32_Process | Measure-Object`, not estimated), `node
measure/windows/proof-08/crash-timeline.mjs inprocess --matched-handler` —
one of the commands this ADR's own Appendix tells a reader to run — **threw
an uncaught `Error: Command failed: powershell.exe ...`** after 36 clean
poll iterations, discarding the whole timeline it had already collected.
This was not the JSON bug (already fixed) — it was a genuine nonzero-exit
`Get-CimInstance` failure, twice in a row, plausible only under this
machine's real concurrent load. Root cause: `isPidAlive()` called
`snapshotAllProcesses()` directly with **zero retries**, unlike
`processTree()`. Fixed: `isPidAlive()` now retries up to 3 times with the
same backoff as `processTree()` (whose own default was also raised from 1 to
3, for the same load-induced reason); `crash-timeline.mjs`'s poll loop and
trailing tree dump additionally degrade to a labeled "unavailable" entry
rather than crashing if a residual failure survives the retries. Re-ran the
exact failing command 1/1 clean after the fix, plus 3/3 direct
`processTree()`/`isPidAlive()` calls, plus a full `--reps 1 --crash-reps 1`
smoke battery — all clean. This is disclosed here rather than silently
folded into "the fix" because it demonstrates the same class of bug (an
unretried PowerShell call on a heavily-loaded machine) can hide in more than
one call site, and a reviewer re-running this ADR's own Appendix commands
should not have to discover that themselves.

**Not a bug, but a capture-reliability gap worth disclosing — found while
verifying §5's own claims against `raw-results.json` rather than trusting
the printed summary.** `main-utility.mjs`'s forwarding of the forked child's
stderr (`child.stderr.on("data", ...)` → a `server-stderr` JSON-log event)
did not fire in 4 of 7 Approach-A crash reps run this round (all 3 §5.1
default reps, 1 of 3 §5.2 matched reps, plus a dedicated post-fix
`crash-timeline.mjs utility` re-run) — the child's `exit` event, and
`run.mjs`'s subsequent read of the log file, can both happen before the last
`stderr` `data` event is delivered, under this session's load. `code=1`
(the reliable signal, via the `exit` event) fired every single time; only
the literal stack-trace *text* capture is intermittent. §5.1/§5.2 and the
comparison table are corrected to state this precisely — "diagnostic
produced" for A now cites the exit code plus an independently-verified fact
about Node's default behavior, not an assumed-always-captured stack trace.
Not fixed in code this round (it doesn't affect any measured number that
feeds §8's decision — exit code, `mainAlive`, and window survival are all
captured via non-racy channels), but flagged for Fase 5: any real
supervisor built on this ADR's signal (§9, `child.on('exit', code)`) should
not additionally depend on literal stderr text from a forked
`utilityProcess` being reliably captured.

## 7. Weighing against SHELL-03

An in-process embedded server does **not** reduce the work SHELL-03 already
requires. Adopting an already-running external `server.js` is a
separate-process concern by definition — there is no in-process way to
"adopt" a process that isn't yours. Under Approach A, the embedded case and
the adopted case share the same mental model and most of the same
supervision code: "a server reachable at `127.0.0.1:<port>`, health-polled,
whose lifecycle I may or may not own." Under Approach B, they would be two
genuinely different code paths — an HTTP client for the adopted case, plus
the entirely separate in-process-import machinery this ADR just built for
the embedded case — maintained side by side. Moving the embedded server
in-process trades one clean unified model for a small RAM saving plus a
second, structurally unrelated hosting mode to keep working forever.

## 8. Decision

**Ship `utilityProcess.fork` (Approach A).** Unchanged from round-1 — the
round-2 corrections change *why*, not *which*. The measured ~57 MB saving
from hosting in-process does not justify:

1. **A crash-isolation guarantee that is structural in A and only
   discipline-dependent in B — the round-2-corrected version of this
   argument.** Round-1 called B's crash "a silent, undiagnosable hang" and
   treated that as disqualifying on its own. §5 shows that framing was
   wrong: B's *default* hang is Electron's own documented main-process error
   dialog (`lib/browser/init.ts`), not an absence of diagnostics, and
   installing the exact one-line handler Electron itself recommends
   (`process.on('uncaughtException', ...)`) makes B exit as cleanly as A
   does. **What survives the correction:** Approach A's crash isolation is a
   property of the OS process boundary — the forked child can die in any way
   at all, handled or not, and the main process and `BrowserWindow` are
   structurally untouched, because they are a different process. Approach
   B's crash isolation is a property of *whether someone remembered to
   install the handler* — miss it (Electron's literal default), and you get
   the frozen-dialog state; install it, and `process.exit(1)` **takes the
   window down with the server**, because in B the crash handler, the
   server, and the window share one process by construction (§5.2, matched
   handler: `mainAliveAfterCrash: false` in all 3 reps, process tree empty).
   An always-on tray app that wants "server died, keep the window up,
   reconnect" gets that for free from A's process boundary; B cannot offer
   it without a second layer of supervision (relaunching the whole Electron
   process) that A never needs. This is a smaller, more precise claim than
   round-1's "silent hang, disqualifying" — but it still favors A, on a
   mechanism this round actually verified rather than misdiagnosed.
2. **Maintaining two hosting models instead of one**, when SHELL-03 already
   forces separate-process handling to exist regardless (§7). Untouched by
   the round-2 corrections.
3. ~~A cold-start cost~~ **Retracted.** Round-1 cited "~50 ms at the median"
   as reason (3). §4 shows that number was an artifact of a fixed run order
   over a shared warm cache; the round-2 interleaved, cold-cache-per-rep
   remeasurement puts the median delta (196 ms) *inside* both arms' own
   within-apparatus spread (476 ms / 304 ms) — not a reproducible
   directional claim at n=8. Cold start plays **no role** in this decision;
   reasons (1) and (2) carry it on their own, which they already did in
   round-1 (round-1's own text called reason (1) alone "disqualifying").

D15 is resolved: `utilityProcess.fork`, pointing at the real, unmodified
`server.js`, matching Approach A of this ADR.

## 9. Consequences for Fase 5 (SHELL-01/SHELL-02)

- `SHELL-01`'s "server lifecycle via `utilityProcess.fork`" is now backed by
  a measured crash story, not just the API's own recommendation in
  Electron's docs.
- `SHELL-02` ("health events for the UI") can reuse this ADR's signal:
  `child.on('exit', code)` with `code !== 0` is a clean, reliable "server is
  down" event for Approach A — no polling or timeout heuristics needed. Do
  **not** rely on the *absence* of Electron's own default handler working
  this way for the main process itself: §5 shows Electron's default for an
  uncaught exception in a GUI-owning process is a blocking dialog, not an
  exit, so a future in-process or hybrid design would need its own explicit
  `process.on('uncaughtException')` to get an exit signal at all — and even
  with one installed, that exit takes the window down with it (§5.2, §8.1).
- Do not reuse `execArgv` on `utilityProcess.fork` as a debugging/injection
  channel without verifying it lands — §5 showed it silently does not for
  `--import`.
- The ESM top-level-await hang in §3 must be documented in the real shell's
  main-process entry point (a code comment pointing here is the minimum) so
  a future refactor doesn't reintroduce it.
- **Round-2 addition:** if Fase 5 ever needs Electron's own `userData` path
  isolated (test fixtures, a `--profile` flag, CI), use `app.setPath('userData',
  ...)` synchronously before `app.whenReady()` — see §6/Appendix. Mutating
  `process.env.APPDATA` at runtime does **not** achieve this; Chromium
  resolves the path natively before the JS module runs.
- **Round-2 addition:** a Windows process-tree/command-line probe must never
  round-trip free-form `CommandLine` text through Windows PowerShell 5.1's
  `ConvertTo-Json` directly — base64-encode it on the PowerShell side first
  (§6). This will recur in any future Fase-5 tooling that shells out to
  `Get-CimInstance`/`Get-Process` for diagnostics.

## Appendix — reproduce this

```sh
pnpm install   # electron@44.4.1 already committed as a devDependency in package.json
node measure/windows/proof-08/run.mjs --reps 8 --crash-reps 3   # full battery this ADR's §4/§5 numbers come from
node measure/windows/proof-08/run.mjs --reps 1 --crash-reps 1   # quick smoke run
node measure/windows/proof-08/crash-timeline.mjs utility                    # 300ms-resolution timeline, A, default handler
node measure/windows/proof-08/crash-timeline.mjs inprocess                  # same, B, default handler
node measure/windows/proof-08/crash-timeline.mjs inprocess --matched-handler  # same, B, matched handler (§5.2)
```

**Isolation (round-2 corrected — see §6 blocker/major fixes).** Every rep
gets a fresh temp root (`isolatedAppData()` in `lib.mjs`), split into two
subdirectories: `server-appdata/` (server.js's own `%APPDATA%`-equivalent
storage, via `process.env.APPDATA` for Approach B / the forked child's `env`
for Approach A) and `electron-userdata/` (Electron's own profile — GPU/shader
caches, Local/Session Storage, Preferences — via `app.setPath('userData',
...)` called synchronously before `app.whenReady()`, identically in both
`main-utility.mjs` and `main-inprocess.mjs`). Verified for this round, both
arms, with a `find <real %APPDATA%\Roaming\Electron> -newer <marker file
touched immediately before the run>`: **zero matches in both arms** — the
real profile is genuinely untouched, and the same artifact set round-1's
reviewer found leaking into it (`blob_storage/`, `GPUCache/`,
`DawnGraphiteCache/`, `DawnWebGPUCache/`, `Local Storage/`, `Session
Storage/`, `Cache/`, `Code Cache/`) now lands inside the isolated
`electron-userdata/` directory instead, confirmed by listing it directly.
Round-1's Appendix claimed this without the `app.setPath` call that actually
does it — that was the bug; this text and the code now match.

**Rule 5 (Windows path with a space).** Re-verified against the fixed code,
not carried over: booted Approach A with
`PROOF08_APPDATA="C:\Users\...\Temp\decktech proof08 space test"` (a literal
space in the directory name) — `/health` answered 200, clean exit code 0,
and `electron-userdata/`/`server-appdata/Dokke/` were created correctly
inside the space-containing path. `path.join` throughout; no hardcoded
separator.

All probes are self-contained: genuinely isolated `%APPDATA%`/`userData` per
run (verified above, not just claimed), unique ports per rep, and a hard
watchdog kill so a hung run (expected for Approach B's default-handler crash
reps, by design — see §5.1) cannot leave the terminal blocked.
