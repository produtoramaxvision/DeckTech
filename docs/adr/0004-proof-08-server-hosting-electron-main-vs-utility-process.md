# ADR-0004: Hosting server.js — `utilityProcess.fork` vs the Electron main process

- Status: Accepted
- Date: 2026-09-17 (round-1), revised 2026-09-17 (round-2), revised
  2026-09-18 (round-3 — see below)
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

> **Round-3 revision note.** A rigorous review rejected the round-2 version on
> 9 findings (2 major, 7 minor). The two major findings both concerned
> the probe hiding evidence rather than a wrong headline number: (1) Approach
> A's IDLE cells fork the real `server.js`, which also calls
> `startDiscovery(3001)` — a UDP bind that failed with `EADDRINUSE` in every
> single idle rep on this machine (an unrelated ambient process holds the
> port), and the probe's own summarizers structurally could not show this,
> because the `notable` event allowlist excluded `server-stdout`/
> `server-stderr` and the idle summary never printed log events at all; (2)
> the central "Electron shows a modal dialog, not a silent hang" claim for
> B-default rested on a one-off, uncommitted PowerShell probe with no
> reproduce path in the Appendix. Both are fixed by changing what the probe
> *prints*, not what it measures — the reviewer's own note that "the headline
> number is unaffected" for finding #1 holds. The other 7 findings (stderr-
> capture count arithmetic, an unstable propagation-time band presented as a
> bound, no CLI argument validation, a named constant three call sites
> ignored, an unbounded wait loop, an off-by-one median, and a residual
> run-order position effect) are all fixed in code and disclosed below.
> **Self-found while smoke-testing this round's own fixes (not one of the 9,
> disclosed the same way round-2's isPidAlive-retry fix was):** a Windows
> pid-reuse bug — `processTree()`/`isPidAlive()` trusted a bare pid match,
> and this machine's 800+ concurrent process churn let an unrelated process
> grab a just-exited Electron main pid before the post-crash snapshot ran,
> once observed live producing a bogus non-empty `bash.exe`/`conhost.exe`
> tree for what should have read "process gone". Fixed (verify the root
> node's own process name, not just its pid) **before** the round-3 battery
> below was run, so every number in §4/§5 already reflects the fix. The full
> battery was re-run again from this round's code (same command,
> `--reps 8 --crash-reps 3`) — **every number in §4 and §5 is from that
> re-run**, not carried over from round-2's figures, which is also why some
> of them (e.g. the idle-RSS delta, the crash-stderr capture rate) differ
> from round-2's own numbers without either round being wrong: this is a
> live, load-sensitive machine, and both rounds say so.

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
  **Round-3 additions:** `windowsForPids()` (every titled Win32 window owned
  by a set of pids, via the new `enum-windows.ps1`) and `discoveryBindOwner()`
  (the actual `OwningProcess` of a UDP port, via `Get-NetUDPEndpoint` — §4's
  discovery-bind evidence). Also round-3: both `processTree()` and
  `isPidAlive()` now verify the root/queried pid's **process name**, not just
  its numeric value, against what was spawned — see §6's pid-reuse entry.
- `enum-windows.ps1` (round-3, new) — a committed PowerShell script
  (EnumWindows/GetWindowThreadProcessId/GetClassName/GetWindowText/
  IsWindowVisible via `Add-Type` P/Invoke) that dumps every titled Win32
  window on the desktop session; `windowsForPids()` filters it to the pids a
  caller cares about. This is what makes §5's "Electron shows a modal
  dialog" claim reproducible from a committed script (round-2's version of
  this evidence rested on an uncommitted one-off probe — round-3 finding #2).
- `main-utility.mjs` — **Approach A.** Electron main process that, once
  ready, redirects its own `userData` path via `app.setPath('userData', ...)`
  (isolation fix, §6), opens a `BrowserWindow`, and calls
  `utilityProcess.fork(serverPath, ...)` where `serverPath` is the real,
  unmodified `server.js`, relying on its own bottom-of-file bootstrap guard
  (`import.meta.url === pathToFileURL(process.argv[1]).href`) exactly as
  `node server.js` would. **This is also what makes the IDLE cell of
  Approach A call `startDiscovery(3001)` — see §4's asymmetry disclosure.**
- `main-inprocess.mjs` — **Approach B.** Electron main process that, once
  ready, redirects its own `userData` path the same way, opens a
  `BrowserWindow`, dynamically `import()`s the real `server.js`, and calls
  its exported `startServer({ port })` directly — same process as the
  window. Supports an `PROOF08_INSTALL_UNCAUGHT_HANDLER` flag (§5).
- `server-entry-crash.mjs` — a thin wrapper used **only** for the crash
  sub-test of Approach A (see §5 for why a wrapper was needed instead of the
  originally-planned `--import` preload). Also supports
  `PROOF08_INSTALL_UNCAUGHT_HANDLER` (§5). Calls `startServer()` only —
  **the crash sub-test of Approach A does NOT call `startDiscovery`**, so
  the asymmetry disclosed in §4 is confined to the idle cells and does not
  touch §5's crash comparison (round-3 finding #1's scoping clarification).
- `run.mjs` — the runnable probe: boots both approaches, **alternating the
  inner order by rep index** (round-3 refinement of round-2's interleaving —
  rep 0 runs A-then-B, rep 1 runs B-then-A, etc., with the realized order
  recorded per rep — see §6), several repetitions each, and prints cold
  start (with spread and a by-position split), idle RSS (whole tree, not one
  number, with actual elapsed-since-ready recorded per sample, **plus every
  `server-stdout`/`server-stderr` event verbatim and the discovery-socket
  bind outcome per rep** — round-3), and crash behavior in **two**
  handler-policy configurations (**with the heartbeat's own age printed
  alongside it** — round-3). Validates `--reps`/`--crash-reps` and fails
  loudly, non-zero, on a bad flag or on zero usable reps (round-3).
  `node measure/windows/proof-08/run.mjs [--reps N] [--crash-reps N]`.
- `crash-timeline.mjs` — a finer-grained companion probe used to build the
  timeline evidence in §5. Takes an optional `--matched-handler` flag.
  **Round-3:** reuses `lib.mjs`'s `waitForHttp200` (30 s deadline, kills the
  child and exits non-zero on timeout, instead of hanging forever — finding
  #7) and folds independent Win32 window enumeration into every poll
  iteration, printing the real, actual (not nominal) elapsed time per
  iteration alongside it (finding #3).

Electron version: **44.4.1** — the same version `WINDOWS-STACK.md` already
measured with, so this ADR's numbers are comparable to it. Its bundled
runtime, read from `process.versions` inside the main process rather than
assumed: **Node 24.21.0, V8 15.2.124.19-electron.0, Chromium 152.0.7977.78**
(re-verified independently for round-2, same output; passively
re-confirmed for round-3 — every A-arm crash rep's captured stderr in §5.1
below independently prints `Node.js v24.21.0` in its own stack trace).

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

## 4. Cold start and idle RSS — measured, 8 repetitions each, order-alternated

Method: `node measure/windows/proof-08/run.mjs --reps 8 --crash-reps 3`, run
fresh for round-3 (790 concurrent OS processes on this machine at the start
of this run, per `Get-CimInstance Win32_Process | Measure-Object`, printed by
`run.mjs` itself). **Round-3 change:** the inner per-rep order now
**alternates** (rep 0: utility, inprocess; rep 1: inprocess, utility; ...)
instead of round-2's fixed A-then-B order every rep, and each rep's realized
position (`first`/`second`) is recorded and reported as a measured split
below — this **reduces**, but (being a fixed alternation rather than a
randomization) does not fully eliminate, a residual run-order position
effect; round-2's text claiming this "directly closes" the ordering finding
is corrected to "reduces" here. Each rep still gets its own isolated
Electron `userData` directory (§6, unchanged from round-2), so no rep, in
either arm, inherits another rep's or another arm's warm GPU/shader cache
regardless of position. Cold start = wall-clock time from
`child_process.spawn` to the first HTTP 200 on `/health`. Idle RSS = whole
process tree rooted at the main process; the nominal sample point is t+8s
after `/health` first answered (`REPORTED_SAMPLE_MS`, round-3: now actually
derived from — not merely labeled by — the `IDLE_SAMPLE_POINTS_MS` constant
at every read site, §6 finding #6), and the **actual** elapsed time is
recorded per sample, ranging 8.8s–9.9s across the 16 idle reps of this run.
**Median, throughout this ADR, is the actual median** (the two middle values
averaged at even n) — round-2's `stats()` took the upper-middle order
statistic unlabeled; fixed in code, §6 finding #8.

### Cold start (launch → first `/health` 200)

| | reps (ms) | min | median | max | spread |
|---|---|---|---|---|---|
| A) `utilityProcess.fork` | 401, 812, 381, 376, 509, 902, 651, 610 | 376 ms | **560 ms** | 902 ms | 526 ms |
| B) in-process | 296, 393, 340, 360, 412, 413, 465, 338 | 296 ms | **377 ms** | 465 ms | 169 ms |

**Median delta: 183 ms (B faster).** This does **not** support a directional
claim at this n: 183 ms is smaller than A's own within-arm spread (526 ms) —
i.e. the run-to-run noise inside arm A alone is larger than the difference
between arms. `run.mjs` flags this automatically (`FLAG: median delta ... is
SMALLER than at least one arm's own spread`). **Cold start is not a
reproducible factor in this decision** and §8 does not cite it as one — this
conclusion is unchanged from round-2, on freshly re-measured round-3 numbers.

**Position-effect split (round-3 addition, answering finding #9 directly
instead of arguing it away):**

| | ran FIRST (n=4) median | ran SECOND (n=4) median |
|---|---|---|
| A) `utilityProcess.fork` | 455 ms | 711 ms |
| B) in-process | 377 ms | 376 ms |

Arm A still shows a real gap between running first vs. second (455 ms vs.
711 ms) — consistent with a residual position effect the alternation
*reduces* (each arm now runs second only half the time, not always) rather
than *eliminates*. Arm B shows essentially none (377 ms vs. 376 ms). This is
additional evidence, not a new conclusion: cold start already carries no
weight in §8's decision regardless of which arm the position effect favors.

### Idle RSS — whole process tree, nominal t+8s (actual 8.8s–9.9s) after ready

| | reps (MB) | min | median | max | spread |
|---|---|---|---|---|---|
| A) `utilityProcess.fork` | 333.7, 333.3, 336.1, 338.8, 333.7, 332.4, 333.4, 335.9 | 332.4 MB | **333.7 MB** | 338.8 MB | 6.4 MB |
| B) in-process | 277.6, 277.2, 280.1, 277.1, 276.6, 278.2, 280.0, 277.2 | 276.6 MB | **277.4 MB** | 280.1 MB | 3.5 MB |

**Delta: 56.3 MB** (median), i.e. what moving the server in-process actually
saves — not the 68.6–71.2 MB "floor" reported for the standalone
`node server.js` process, because the in-process host still pays the extra
JS heap/Node overhead where it now lives (main's own working set is ~94 MB in
Approach B vs ~82 MB in Approach A — see the trees below). Unlike cold start,
**this delta is far outside both arms' spreads (6.4 MB and 3.5 MB) and
reproduces cleanly across all 8 order-alternated reps** — it is a
reproducible, directional finding. (Round-2 reported 57.3 MB/8.4 MB/7.5 MB
for the same comparison; the difference from this round's 56.3/6.4/3.5 is a
fresh run on a live, load-sensitive machine plus this round's median fix —
not a correction of round-2's number, which was itself a genuine measurement
of its own run.)

Full tree, one representative rep per approach (rep 8, the last of this
run), role of every process shown (via `--type=`/`--utility-sub-type=`, not
guessed from name):

```
A) utilityProcess.fork:
electron.exe [browser (main)] (pid 25848) — 81.9 MB WS
  electron.exe [gpu-process] (pid 45912) — 81.5 MB WS
  electron.exe [utility (network.mojom.NetworkService)] (pid 46900) — 39.6 MB WS
  electron.exe [renderer] (pid 16576) — 63.9 MB WS
  electron.exe [utility (Node — our forked server.js)] (pid 49376) — 69.0 MB WS

B) in-process (imported into main):
electron.exe [browser (main)] (pid 43028) — 94.4 MB WS   <- vs A's main ~82 MB
  electron.exe [gpu-process] (pid 516) — 81.8 MB WS
  electron.exe [utility (network.mojom.NetworkService)] (pid 36684) — 39.8 MB WS
  electron.exe [renderer] (pid 51068) — 61.3 MB WS
                                        (no 5th process — this is the whole saving)
```

Everything Chromium spins up regardless (gpu-process ~81–82 MB, network
utility ~40 MB, renderer ~61–64 MB) is identical between the two approaches
within measurement noise, as expected: neither approach touches how Electron
itself boots.

### 4.1 What actually differs, corrected — the asymmetry round-3 disclosed

> **Round-3 correction (major finding #1).** Round-2's text here said "the
> entire difference is the server's own footprint ... versus that same code
> folded into main's heap" — **that is not accurate.** Approach A's idle
> cell forks the real `server.js` directly, which runs its own bottom-of-file
> bootstrap guard (`server.js:1079-1088`): `startServer().then(({port}) => {
> console.log(...); startDiscovery(DISCOVERY_PORT, {portHint: port}).unref();
> })`. Approach B's idle cell calls `startServer({port})` only
> (`main-inprocess.mjs:117-118`) — it never touches `startDiscovery`. So "A"
> in the idle/RSS cells does strictly more than "B": one `startServer()` call
> (shared), plus one attempted UDP bind on port 3001, plus one `console.log`.
> Round-2 never printed this because `run.mjs`'s `notable` event allowlist
> (used only for crash summaries) excluded `server-stdout`/`server-stderr`
> outright, and the idle summary never printed log events at all — an
> allowlist can only show events the probe itself anticipated. Fixed in
> round-3: every idle rep now prints its `server-stdout`/`server-stderr`
> events verbatim (no allowlist, no regex filter), and the actual bind
> outcome is checked positively via `Get-NetUDPEndpoint`'s `OwningProcess`
> (not by scraping stdout for a "bound" success line — `startDiscovery` never
> emits one; it only logs on its own bind **error**, `server.js:212`).
>
> **What this round's fresh 8-rep battery shows, in full:** all 8 of 8
> Approach-A idle reps printed the identical stdout pair `Dokke ouvindo em
> http://127.0.0.1:<port>` followed by `[discover] erro: bind EADDRINUSE
> 0.0.0.0:3001`, and `Get-NetUDPEndpoint -LocalPort 3001` confirmed, in all 8
> reps, that port 3001 is owned by pid **45020** — an unrelated ambient
> `node.exe` process already running on this machine, not our forked server
> child (whose own pid was checked and differed in every rep: 37960, 9352,
> 24716, 46660, 46352, 39740, 49488, 49376). This is **machine-state
> dependent**, not a property of the code: on a machine where nothing else
> holds UDP 3001, Approach A's idle cell would additionally hold a live
> discovery socket. Both are disclosed as `boundToUs=false` for all 8 reps
> below, exactly as observed — no rep in this battery shows the alternative.
>
> | rep | A: server-stdout | UDP 3001 owner | bound to our child? |
> |---|---|---|---|
> | 1–8 | `Dokke ouvindo em ...` + `[discover] erro: bind EADDRINUSE 0.0.0.0:3001` | pid 45020 (ambient, unrelated) | **no**, all 8/8 |
>
> **The corrected claim:** A's additional footprint from this — one attempted
> `dgram` bind that fails fast, plus one `console.log` — is real but
> **unquantified**, not zero and not (on this machine, this run) meaningfully
> nonzero either; a failed `dgram.bind()` allocates a socket handle briefly
> before the OS rejects it, on the order of bytes to low-KB, invisible at
> this measurement's MB resolution. It is not "the entire difference [is]
> the server's own footprint … versus that same code folded into main's
> heap" — it is that same code, **plus a discovery-bind attempt whose
> success is ambient-machine-dependent**, folded into main's heap. This does
> not change §4's 56.3 MB delta (which is driven by the forked server
> process's own working set existing as a fifth OS process at all, not by
> whether its UDP socket happened to bind) or §8's decision.
>
> **Crash reps are unaffected.** Approach A's crash sub-test forks
> `server-entry-crash.mjs`, which calls `startServer()` only — same as
> Approach B — so §5's crash comparison is code-path matched between arms
> and this asymmetry does not reach it (see §2's per-file notes and §5.1).

### 4.2 Cross-check against `WINDOWS-STACK.md` (round-2 correction, round-3 re-measured)

The forked-server-child working set across all 8 idle reps of this run
(from `raw-results.json`, not the single representative tree printed above):
69.4, 69.5, 71.0, 69.3, 69.0, 68.4, 69.8, 69.0 MB — **range 68.4–71.0 MB,
median 69.35 MB**, against `WINDOWS-STACK.md`'s standalone-process floor of
**68.6–71.2 MB**
(`.maxvision/research/WINDOWS-STACK.md:45`, measured with standalone Node
v25.5.0). This round's range dips 0.2 MB below the standalone floor's low
end (68.4 vs. 68.6) and stays under its high end (71.0 vs. 71.2) — unlike
round-2's own re-measurement, whose range (66.0–71.7 MB) both dipped below
and rose above. Both are correct readings of their own runs: this is one
methodology (an isolated OS process running `server.js`, `APPDATA`
redirected, `PORT` overridden) applied to two different Node runtimes
(standalone Node v25.5.0 vs. Electron-bundled Node 24.21.0, see §3) on a
machine whose ambient load varies run to run — "the server's own footprint
is roughly similar whichever runtime hosts it, within a few MB," not "agrees
to within 3% of a single figure."

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
> small PowerShell probe) while running Approach B's default-handler crash:
> at t≈1.3s only `class=Chrome_WidgetWin_1 title=Electron` (the app's own
> window) exists; from t≈2.6s onward (right after the 3s crash timer) a
> SECOND window appears and persists: **`class=#32770 title=Error
> visible=True`** — `#32770` is the Win32 predefined dialog-box class. (The
> title read `Error` on this run rather than the full documented string
> above it — Windows often truncates a `MB_ICONERROR` box's title bar to the
> icon-implied word; reporting what was observed, the mechanism is
> unambiguous either way.) The dialog IS the diagnostic; it just goes to a
> modal window instead of stderr, and it blocks the JS thread while open —
> which explains every other round-1 observation (frozen heartbeat, no exit,
> no stderr) as **one mechanism**, not four independent mysteries.
>
> **Round-3 correction (major finding #2): this evidence is now committed
> and reproducible, not a one-off.** Round-2's ADR called the window probe
> above "not committed — one-off verification" — a reader had no way to
> reproduce the central claim of this section. `enum-windows.ps1` (§2) is
> that exact EnumWindows/GetClassNameW/GetWindowText/IsWindowVisible probe,
> committed, and `crash-timeline.mjs` now calls it every poll iteration
> (`lib.mjs`'s `windowsForPids()`) for the main pid and every child pid its
> own process-tree snapshot found that iteration, printed next to the
> heartbeat **with the heartbeat's own age** (`hbAgeMs`, so a frozen
> last-known-good value can never be read as current — the same fix applied
> to `run.mjs`'s crash summary below). Re-running `node
> measure/windows/proof-08/crash-timeline.mjs inprocess` fresh for round-3
> reproduces the box above from the committed script itself: `windows=`
> shows only `{"title":"Electron",...,"class":"Chrome_WidgetWin_1",...}` at
> t+362ms and t+2142ms, and from **t+3659ms onward** (right after the 3s
> crash timer) a second entry appears and persists through the end of the
> observation window (t+85800ms, the last sample this run's ~2.3–2.8s actual
> per-iteration cadence reached — see below):
> `{"title":"Error","pid":31428,"class":"#32770","visible":true}` — the
> identical dialog, from the identical committed script, independent of any
> reviewer's own environment. The heartbeat over the same window: last live
> tick at t+2142ms (`hb.t` age 184ms), then frozen at that exact `hb.t` value
> from t+3659ms (age 2325ms) through t+85800ms (age 84348ms) while `/health`
> answers `TIMEOUT` throughout — confirming the freeze independently again,
> this time with the age making "how stale" explicit at every sample instead
> of implicit.
>
> **Actual poll cadence, disclosed rather than assumed (finding #3).**
> `EnumWindows` recompiles its `Add-Type` P/Invoke shim on every
> `powershell.exe` invocation — measured standalone on this machine (`time
> powershell.exe -NoProfile -NonInteractive -File enum-windows.ps1`):
> ~0.8–1.1s per call. Combined with the pre-existing `processTree()` call the
> same loop iteration makes, the round-3 `inprocess` (default-handler) run
> above shows **actual per-iteration elapsed of ~1.5–2.8s**, not the nominal
> 300ms a bare reading of "poll loop" suggests — `crash-timeline.mjs` now
> prints this per iteration (`iter took <n>ms`) instead of asserting a
> cadence it does not run at. This is ample resolution for a crash injected
> at a known t+3000ms: the state change is visible within one or two
> iterations of the crash either way.
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
of the 4 combinations below (A/B × default/matched), order-alternated with
the idle reps as described in §4, from the same round-3 battery.

### 5.1 Default handler policy (n=3 reps each, all 3 identical in shape per arm)

**A) `utilityProcess.fork`:** every rep — forked child exits(code 1) within
~3.17–3.20s of ready (`server-exit` event, computed from `raw-results.json`'s
own `server-exit` minus `crash-scheduled` timestamps: 3199ms, 3173ms,
3203ms), main process alive the whole observation window, window still
exists, `/health` would answer `ECONNREFUSED` once the child is gone.
Example log excerpt (rep 1):
`{"event":"crash-scheduled","afterMs":3000,"target":"utility-child"}` →
`{"event":"server-exit","code":1,"mainStillAlive":true,"windowStillExists":true}`
→ (9s later) `{"event":"quitting",...}`. `electron exit: code=0` (our own
scheduled `app.quit()`, not the crash) in all 3 reps.

**Round-3 re-measurement of the stderr-capture race (finding #3, denominator
corrected).** Round-2 reported the literal `server-stderr` stack-trace text
captured in "only 2 of 7 total A-arm crash reps" while also saying, three
lines later, "4 of 7" were not captured — an internal contradiction (2+5≠7
either way it's sliced) compounded by mixing 3 battery reps with 1
standalone `crash-timeline.mjs` re-run into one denominator without saying
so. Round-3 fixes this by reporting **only this round's own fresh
`raw-results.json`, battery reps only** (3 default + 3 matched = 6 total
A-arm crash reps; any standalone `crash-timeline.mjs` run is reported
separately, never folded into this count): **this round's battery captured
the literal `server-stderr` text in all 3 of 3 default-handler reps AND all
3 of 3 matched-handler reps — 6 of 6.** This is a *different* count from
round-2's (2 of 7), and that difference is itself the expected behavior of
an intermittent race, not a contradiction: `main-utility.mjs`'s
`child.stderr.on("data", ...)` forwarding races the child's `exit` event and
`run.mjs`'s subsequent log-file read under this machine's variable
concurrent load (790 processes at this round's run start vs. an unrecorded
figure at round-2's), so different runs legitimately capture different
fractions. The underlying race **is not fixed in code** this round (it was
not one of the round-3 findings requiring a code fix, only a counting/
disclosure one) — a future run could see gaps again. What is reliably true
regardless of the race: `code=1` matches Node's own documented default
`uncaughtException` exit code exactly, and a standalone check on this
machine (`node -e "setTimeout(()=>{throw new Error('x')},50)"`) confirms
Node's default prints the full stack to stderr and exits 1.

**B) in-process:** every rep — `mainAliveAfterCrash: true`, `electron exit:
code=null signal=SIGTERM` (our watchdog force-killed it; it never exited on
its own), process tree still fully present (main + gpu + network + renderer,
~279–301 MB total) at the post-crash snapshot ~8.9–9.1s after ready.
Re-verified independently this round, from the **committed**
`crash-timeline.mjs inprocess` (no longer "a small PowerShell probe, not
committed" — see the box above): heartbeat ticks normally through t+2142ms,
then **freezes at that exact tick's content for every subsequent poll
through t+85800ms** (the last sample this run's iteration cadence reached)
while `/health` answers `TIMEOUT` continuously from t+3659ms onward, and the
independently-enumerated window set shows the `#32770`/`Error` dialog
appearing at the same t+3659ms sample and persisting throughout — confirming
round-1's and round-2's finding stands under round-3's own fresh, committed,
reproducible data. `stderr tail:` for this run was empty, consistent with
the mechanism in the box above (the dialog is the diagnostic; stderr
genuinely gets nothing).

### 5.2 Matched handler policy — same explicit handler in both arms (n=3 reps each)

**A) `utilityProcess.fork`:** unchanged from 5.1 — `mainAliveAfterCrash:
true`, `electron exit: code=0` (self-scheduled quit) in all 3 reps.
Installing the handler in `server-entry-crash.mjs` produced the same
observable outcome (`code=1` child exit, main/window survive) as 5.1's
default; **all 3 of these 3 reps' logs contain the literal `server-stderr`
text** this round (see 5.1's corrected count — 6/6 combined) — e.g. rep 1:
`Error: PROOF-08 injected crash: simulated unhandled error in server process
(utility, via entry wrapper)\n    at Timeout._onTimeout
(...server-entry-crash.mjs:50:11)`. This is the same exit code and survival
outcome as the default, not a byte-for-byte stderr comparison (not
performed).

**B) in-process:** **`mainAliveAfterCrash: false` in all 3 reps** —
`electron exit: code=1`, post-crash process tree **empty** (root process
gone, all 4 processes including the window's own renderer/gpu/network
children terminated together — verified with round-3's pid-reuse guard in
place, §6, so this "empty" reading is not at risk of a reused pid
misreporting a stale non-empty tree as this round's evidence). Log confirms
the handler fired: `{"event":"main-uncaught-exception-handled","message":
"PROOF-08 injected crash...","stack":"Error: ...\n    at Timeout._onTimeout
(.../main-inprocess.mjs:137:13)\n..."}`. Real propagation time, computed from
`raw-results.json`'s own event timestamps (not estimated): crash fires at
t+3000ms as scheduled, the handler observes it 2–5ms later, and
`exitInfo.at` follows the handler by **224ms, 108ms, 195ms** across the 3
reps.

**Round-3 correction (finding #4): this is stated as approximate, not a
tight bound.** Round-2 published "90–118ms across the 3 reps" as if it were
a stable, reproducible band; a round-3 reviewer's own independent
reproduction got 119/136/122ms — all at or above round-2's stated upper
bound — and this round's own fresh measurement (224/108/195ms) spans a
*different* 116ms-wide range again. All three sets (round-2's, the
reviewer's, this round's) agree the propagation is **on the order of
100–200ms, never anywhere near the ~1s originally estimated in round-1** —
that substantive correction holds — but no specific band is stable at n=3.
Honest statement: **~100–220ms at n=3, on a machine running 790 concurrent
OS processes at this round's measurement** (`Get-CimInstance Win32_Process |
Measure-Object`, printed by `run.mjs` itself, not estimated) — a
load-dependent range, not a bound, reported with its n and its load context
rather than raised until it looks stable. The process is fully gone roughly
3.1–3.2s after ready either way, not the ~10s figure below. The ~11.9–12.3s
`postCrashElapsedMs` reported per rep is when `run.mjs` *takes its
post-crash snapshot* (crash at 3s + the probe's own fixed settle wait before
snapshotting, not "time for the process to actually exit") — the snapshot
simply finds an already-empty tree, since the process exited ~9s earlier
than the snapshot was taken.

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
| A, default | **yes** | **yes** | yes — `ECONNREFUSED` once child gone | `code=1` matches Node's documented default exactly; literal stderr text captured in this probe's own log **3/3 default reps** this round's battery (see §5.1 for the denominator correction and why this differs from round-2's 2/7) | yes — child exits(1) in ~3.2s |
| A, matched | **yes** | **yes** | yes — `ECONNREFUSED` once child gone | same as default; literal stderr text captured **3/3 reps** this round's battery (§5.2) — **6/6 total across both A-arm configs this round** | yes — child exits(1) in ~3.2s |
| B, default | technically, but frozen | frozen (independently re-confirmed via committed `enum-windows.ps1`, §5's box — `windowExists` in the heartbeat itself is last-known-good, age-labeled, not trusted alone) | no — `TIMEOUT`, indistinguishable from "slow" | **yes — a modal dialog**, `class=#32770 title=Error`, reproduced from the committed probe (not stderr — confirmed empty; round-1 mischaracterized the dialog itself as absent) | **no — needs external kill** |
| B, matched | **no — whole process exits** | **no — dies with it** (post-crash tree empty, verified pid-reuse-safe — §6) | yes — connection refused once process is gone | yes — full stack trace to stderr, captured in log for all 3 reps | **yes — process exits(1)** ~100–220ms at n=3 (approximate, load-dependent — §5.2) after the handler runs, but takes the window with it |

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
races the child's `exit` event and `run.mjs`'s subsequent read of the log
file under this machine's variable concurrent load — the exit can fire, and
the log can be read, before the last `stderr` `data` event is delivered.
`code=1` (the reliable signal, via the `exit` event) has fired every single
time in every round of this ADR; only the literal stack-trace *text*
capture is intermittent by nature. **Round-3 superseding note (finding #3):
this round's own fresh battery happened to capture the text in 6 of 6
Approach-A crash reps (§5.1)** — a different count from round-2's reported
2 of 7, and from a round-3 reviewer's own reproduction, neither of which
this correction disputes: an intermittent race legitimately produces
different counts on different runs of a live, variably-loaded machine. What
round-3 fixed was not the race itself (still present in code, still not
required to be fixed — it affects no number §8's decision uses) but the
**reporting** of it: round-2's ADR text gave two mutually contradictory
counts for the same quantity in different places (§5.1 said "4 of 7 not
captured", the comparison table cell said "0/4", neither matched "2 of 7
captured" stated a third place) and silently mixed a 3-rep battery
denominator with a 1-rep standalone `crash-timeline.mjs` re-run in one
table cell. Round-3's rule going forward: **report only the current
battery's own `raw-results.json`, state the denominator's composition
explicitly, and never fold a standalone `crash-timeline.mjs` run into a
battery count** — applied throughout §5.1/§5.2/the comparison table above.
Flagged for Fase 5, unchanged: any real supervisor built on this ADR's
signal (§9, `child.on('exit', code)`) should not additionally depend on
literal stderr text from a forked `utilityProcess` being reliably captured.

**Round-3 bug — CLI argument validation (minor finding #5).** `run.mjs`'s
flag parser did `Number(args[i+1])` with no validation: `node run.mjs --reps
abc --crash-reps 0` produced `NaN`/`0`, every downstream loop ran zero
times, and the script printed a complete-looking report full of `n=0`
sections and exited 0 — a benchmark that silently measures nothing and
reports success. Reproduced pre-fix: `node measure/windows/proof-08/run.mjs
--reps abc --crash-reps 0` → prints the full header, `n=0` everywhere, exits
0. **Fix:** a bad `--reps`/`--crash-reps` value (non-finite, non-integer, or
≤0) is now rejected before any Electron process spawns, naming the flag and
the exact value received, exit code 1. Verified post-fix: `node
measure/windows/proof-08/run.mjs --reps abc --crash-reps 0` →
`FATAL: invalid --reps value: "abc" — expected a positive integer.`, exit 1
(the second flag is never even reached). `summarize()` additionally now
separates health-check-failed reps from successful ones explicitly (printed,
not silently dropped) and fails the whole run loudly (`process.exitCode =
1`) if an arm produces zero usable reps, rather than printing an empty
`n=0` section and exiting 0.

**Round-3 bug — the idle sample-point constant wasn't actually used (minor
finding #6).** `IDLE_SAMPLE_POINTS_MS = [3000, 8000]` was defined
specifically to remove an unnamed magic number, but the three call sites
that read a sample back out (`run.mjs`'s two summary loops) all hardcoded
the literal `8000` directly, independent of the constant. Editing the
constant (e.g. to end in `10000`) would have silently produced an empty
idle report at those three sites instead of an error. **Fix:**
`REPORTED_SAMPLE_MS = IDLE_SAMPLE_POINTS_MS.at(-1)` is now derived once and
used at every read site; a successful (non-health-failed) rep that is
missing that sample point throws an explicit error naming the rep and port,
instead of being silently filtered out of the average.

**Round-3 bug — `stats()`'s "median" was the upper-middle order statistic,
not a median (minor finding #8).** `sorted[Math.floor(n/2)]` at even n (every
n reported in this ADR is 8) returns the 5th of 8 values, not the average of
the two middle values — a real median. This mislabeled every "median" figure
in round-1 and round-2 (immaterial to any conclusion, since no decision in
§8 hinges on the exact figure, but the label meant something other than what
it said in the one document whose entire claim is measurement precision).
**Fix:** `median()` now averages the two middle values at even n; every
"median" in this ADR (round-3 onward) is an actual median.

**Round-3 refinement — residual run-order position effect (minor finding
#9).** Round-2's fix (interleaving A/B per rep) removed the fixed
all-A-then-all-B order but kept a fixed *inner* order every rep — arm B
always ran second, always inheriting whatever the OS had just finished
tearing down for arm A. Round-2's text claimed this "directly closes" the
ordering finding; it reduces it, it does not close it. **Fix:** the inner
order now alternates by rep index (rep 0: A,B; rep 1: B,A; ...), and each
rep's realized position is recorded and reported as a measured split (§4)
rather than argued away. §4's position-effect table shows the residual
effect is real for arm A (455ms first vs. 711ms second) and negligible for
arm B (377ms vs. 376ms) — consistent with "reduced, not eliminated."

**Round-3 bug — self-found during this round's own smoke-testing, not one
of the reviewer's 9 findings (same discipline as round-2's isPidAlive-retry
entry above).** `processTree()`/`isPidAlive()` trusted a bare pid match with
no check that the process at that pid was still the one this probe spawned.
Windows recycles pids aggressively under this machine's 800+ concurrent
process churn; **reproduced live** while smoke-testing this round's other
fixes: a B-matched crash rep's post-crash `processTree()` call returned a
non-empty tree rooted at the just-exited Electron main pid — except that
tree was `bash.exe -> conhost.exe/bash.exe/python3.exe`, an unrelated shell
process that had grabbed the pid in the seconds between the process exiting
and the snapshot running, not our Electron process at all. Trusting the pid
alone would have printed "process tree after crash: (non-empty)" for what
is actually the correct "gone" case — directly threatening §5.2's central
"process tree empty, root process gone" evidence on whichever rep got
unlucky, in either this round's battery or round-2's original one
(retroactively unverifiable for round-2, since its raw process names per
node were not re-inspected for this check). **Fix:** both functions now
verify the queried pid's own process **name** — always `"electron.exe"`,
since both `run.mjs` and `crash-timeline.mjs` only ever `spawn(electronPath,
...)` — before trusting a pid match; a pid match with a name mismatch is
treated identically to "not found." Re-ran the exact failing smoke scenario
after the fix: the same B-matched crash rep now correctly reports
`process tree after crash (0.0 MB total ...) (empty — root process gone)`.
This fix landed **before** the round-3 battery in §4/§5 was run, so every
number above already reflects it — none of round-3's own numbers are at
risk from this bug, but round-2's §5.2 "process tree empty" claims cannot
be retroactively re-verified against it and are trusted on the strength of
round-2's own disclosed methodology, not re-checked here.

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
round-2 and round-3 corrections change *why* and *how precisely*, not
*which*. The measured ~56 MB saving from hosting in-process (§4: 56.3 MB
median this round, 57.3 MB round-2 — both real measurements of their own
live-machine runs, not a discrepancy to resolve) does not justify:

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
   over a shared warm cache; the round-3 order-alternated remeasurement puts
   the median delta (183 ms) *inside* arm A's own within-apparatus spread
   (526 ms) — not a reproducible directional claim at n=8, same conclusion
   as round-2's interleaved remeasurement (196 ms inside 476 ms/304 ms), on
   freshly re-measured numbers. Cold start plays **no role** in this
   decision; reasons (1) and (2) carry it on their own, which they already
   did in round-1 (round-1's own text called reason (1) alone
   "disqualifying").

**Round-3 addition: does the discovery-bind asymmetry (§4.1) change this?
No — stated plainly, not left implicit.** §4.1 disclosed that Approach A's
idle cell additionally attempts a UDP bind on port 3001 (machine-state
dependent whether it succeeds) that Approach B's idle cell never attempts.
This does not change the decision for two independent reasons: **(a)** the
56.3 MB delta this ADR's decision rests on is driven by the forked server
process existing as a fifth OS process at all — its own ~69 MB working set
— not by whether that process's UDP socket happened to bind; a failed
`dgram.bind()` costs bytes to low-KB, invisible at this measurement's
resolution, so even a maximally unfavorable reading (A's socket always
fails, always costing nothing; B never attempts one) leaves the 56.3 MB
figure unchanged. **(b)** the crash comparison in §5, which reasons (1) and
(2) above actually rest the decision on, is unaffected by this asymmetry at
all — Approach A's crash sub-test forks `server-entry-crash.mjs`, which
calls `startServer()` only, matching Approach B's `startServer()`-only crash
path exactly (§2, §4.1's box). The asymmetry is real, was under-disclosed in
round-2, and is now disclosed precisely — but it is a fact about the idle/
RSS measurement's fidelity to "real `server.js`, unmodified", not a fact
that moves either measured number this decision is made on.

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
- **Round-3 addition:** a Windows process-tree probe (or any pid-liveness
  check) must never trust a bare pid match — verify the process **name**
  too, or a recycled pid under real concurrent load reports an unrelated
  process as "our process, still alive" (§6). This applies directly to
  `SHELL-02`'s health-event design: if Fase 5 ever polls process state by
  pid (rather than relying purely on `child.on('exit', code)`, which does
  not have this failure mode), it needs the same name check.
- **Round-3 addition:** `startDiscovery(3001)`'s UDP bind is machine-state
  dependent — on this development machine an unrelated ambient process
  (pid 45020) held the port across every rep of this round's battery. Fase
  5's real shell will run on end-user machines where this is far less
  likely, but the discovery-socket bind failure path (`sock.on("error", ...)`,
  `server.js:212`) should be treated as a live, expected failure mode to
  handle gracefully (log and continue, which it already does), not an edge
  case — this ADR's own measurement machine hit it 8/8 times.
- **Round-3 addition:** a positive-evidence check (e.g. `Get-NetUDPEndpoint`'s
  `OwningProcess` for a socket bind, or `EnumWindows` for a GUI dialog) is
  worth the extra PowerShell round-trip over inferring state from log text
  alone — `startDiscovery` never logs a success line, so "no error seen" and
  "actually bound" are not the same claim without checking the OS directly
  (§4.1, §6).

## Appendix — reproduce this

```sh
pnpm install   # electron@44.4.1 already committed as a devDependency in package.json
node measure/windows/proof-08/run.mjs --reps 8 --crash-reps 3   # full battery this ADR's §4/§5 numbers come from
node measure/windows/proof-08/run.mjs --reps 1 --crash-reps 1   # quick smoke run
node measure/windows/proof-08/crash-timeline.mjs utility                    # timeline, A, default handler
node measure/windows/proof-08/crash-timeline.mjs inprocess                  # timeline, B, default handler — §5's window/dialog box
node measure/windows/proof-08/crash-timeline.mjs inprocess --matched-handler  # same, B, matched handler (§5.2)

# Round-3 additions:
node measure/windows/proof-08/run.mjs --reps abc --crash-reps 0   # arg validation — exits 1, prints nothing else (§6 finding #5)
time powershell.exe -NoProfile -NonInteractive -File measure/windows/proof-08/enum-windows.ps1  # standalone: the committed window-enum probe §5's box relies on (~0.8-1.1s per call on this machine)
```

`crash-timeline.mjs`'s per-iteration cadence is now printed inline (`iter
took <n>ms`) rather than assumed at 300ms — see §5's box for why (finding
#3: `EnumWindows` recompiles its `Add-Type` shim every invocation).

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

**Pid-reuse guard (round-3, §6).** Re-ran the exact scenario that first
surfaced the bug — a `--reps 1 --crash-reps 1` smoke battery, B-matched
crash rep — twice: once against the pre-fix code (reproduced the bogus
`bash.exe`/`conhost.exe`/`python3.exe` tree attributed to the exited
Electron main pid) and once post-fix (correctly reports `process tree after
crash (0.0 MB total ...) (empty — root process gone)`). The fix
(`expectedRootName`/`expectedName` checks in `processTree()`/`isPidAlive()`,
default `"electron.exe"`) landed before the §4/§5 battery ran.

All probes are self-contained: genuinely isolated `%APPDATA%`/`userData` per
run (verified above, not just claimed), unique ports per rep, and a hard
watchdog kill so a hung run (expected for Approach B's default-handler crash
reps, by design — see §5.1) cannot leave the terminal blocked.
