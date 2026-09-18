# ADR-0004: Hosting server.js — `utilityProcess.fork` vs the Electron main process

- Status: Accepted
- Date: 2026-09-17
- Requirement: PROOF-08 (`.maxvision/REQUIREMENTS.md` Fase 0), decides D15,
  informs SHELL-01/SHELL-02/SHELL-03 (Fase 5)
- Supersedes: nothing. Closes the gap `WINDOWS-STACK.md` §9 left open — that
  document compared `utilityProcess` against `child_process` and against the
  Tauri sidecar, but never against hosting the server directly in Electron's
  main process (which is already Node).
- Machine: Windows 11 Pro 22631, x64 (this machine)

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
  command-line flags. Includes one bounded retry on an empty snapshot — see
  §6, "a measurement bug found along the way".
- `main-utility.mjs` — **Approach A.** Electron main process that, once
  ready, opens a `BrowserWindow` and calls
  `utilityProcess.fork(serverPath, ...)` where `serverPath` is the real,
  unmodified `server.js`, relying on its own bottom-of-file bootstrap guard
  (`import.meta.url === pathToFileURL(process.argv[1]).href`) exactly as
  `node server.js` would.
- `main-inprocess.mjs` — **Approach B.** Electron main process that, once
  ready, opens a `BrowserWindow`, dynamically `import()`s the real
  `server.js`, and calls its exported `startServer({ port })` directly —
  same process as the window.
- `server-entry-crash.mjs` — a thin wrapper used **only** for the crash
  sub-test of Approach A (see §5 for why a wrapper was needed instead of the
  originally-planned `--import` preload).
- `run.mjs` — the runnable probe: boots both approaches, several repetitions
  each, and prints cold start, idle RSS (whole tree, not one number), and
  crash behavior. `node measure/windows/proof-08/run.mjs [--reps N]
  [--crash-reps N]`.
- `crash-timeline.mjs` — a finer-grained companion probe (300 ms resolution)
  used to build the timeline evidence in §5.

Electron version: **44.4.1** — the same version `WINDOWS-STACK.md` already
measured with, so this ADR's numbers are comparable to it. Its bundled
runtime, read from `process.versions` inside the main process rather than
assumed: **Node 24.21.0, V8 15.2.124.19-electron.0, Chromium 152.0.7977.78.**

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

## 4. Cold start and idle RSS — measured, 3 repetitions each

Method: `node measure/windows/proof-08/run.mjs` (default: 3 idle reps + 2
crash reps per approach). Each rep is a fresh `electron <main-file>.mjs`
process, isolated `%APPDATA%`, its own port. Cold start = wall-clock time
from `child_process.spawn` to the first HTTP 200 on `/health`. Idle RSS =
whole process tree rooted at the main process, snapshotted 8 s after
`/health` first answered.

### Cold start (launch → first `/health` 200)

| | rep 1 | rep 2 | rep 3 | min | median | max |
|---|---|---|---|---|---|---|
| A) `utilityProcess.fork` | 457 ms | 342 ms | 391 ms | 342 ms | **391 ms** | 457 ms |
| B) in-process | 333 ms | 492 ms | 338 ms | 333 ms | **338 ms** | 492 ms |

B is faster by roughly 50 ms at the median — it skips the fork/spawn of a
second process. Including the 2 crash reps of each (n=5, same machine, same
run) doesn't change the picture: A medians ~391 ms, B medians ~347 ms.

### Idle RSS — whole process tree, t+8 s after ready

| | rep 1 | rep 2 | rep 3 | min | median | max |
|---|---|---|---|---|---|---|
| A) `utilityProcess.fork` | 332.4 MB | 328.2 MB | 328.4 MB | 328.2 MB | **328.4 MB** | 332.4 MB |
| B) in-process | 277.9 MB | 271.8 MB | 272.0 MB | 271.8 MB | **272.0 MB** | 277.9 MB |

**Delta: ~56 MB**, i.e. what moving the server in-process actually saves —
not the 68.6–71.2 MB "floor" reported for the standalone `node server.js`
process, because the in-process host still pays the extra JS heap/Node
overhead where it now lives (main's own working set is ~93 MB in Approach B
vs ~80 MB in Approach A — see the trees below).

Full tree, one representative rep per approach, role of every process shown
(via `--type=`/`--utility-sub-type=`, not guessed from name):

```
A) utilityProcess.fork:
electron.exe [browser (main)] (pid 26760) — 80.4 MB WS
  electron.exe [gpu-process] (pid 3728) — 81.1 MB WS
  electron.exe [utility (network.mojom.NetworkService)] (pid 40524) — 39.7 MB WS
  electron.exe [renderer] (pid 37624) — 58.3 MB WS
  electron.exe [utility (Node — our forked server.js)] (pid 45276) — 68.9 MB WS
                                                                      ^^^^^^^^
        68.9 MB — matches WINDOWS-STACK.md's standalone-process floor
        (68.6–71.2 MB) to within 3%. Two independent measurements,
        two different methodologies, same number. That agreement is
        itself part of the evidence this ADR is built on.

B) in-process (imported into main):
electron.exe [browser (main)] (pid 25804) — 92.9 MB WS   <- +12.5 MB vs A's main
  electron.exe [gpu-process] (pid 42240) — 81.2 MB WS
  electron.exe [utility (network.mojom.NetworkService)] (pid 29704) — 39.6 MB WS
  electron.exe [renderer] (pid 37864) — 58.2 MB WS
                                        (no 5th process — this is the whole saving)
```

Everything Chromium spins up regardless (gpu-process ~81 MB, network utility
~40 MB, renderer ~58 MB — ~180 MB total) is identical between the two
approaches, as expected: neither approach touches how Electron itself boots.
The entire difference is the server's own footprint (~69 MB as its own
process) versus that same code folded into main's heap (~+13 MB to main
instead).

## 5. Crash behavior — what actually happens, timestamped

Method: after `/health` first answers 200, an **unhandled** exception is
thrown from a `setTimeout` callback 3 s later — deliberately with **no**
`try/catch` and **no** `process.on('uncaughtException')` handler in either
approach's own code, so what gets measured is Electron/Node's *default*
behavior, not behavior this probe chose to install. `crash-timeline.mjs`
polls every 300 ms: whether the main OS process still exists
(`Get-CimInstance`, not `process.kill(pid,0)` alone), whether `/health`
still answers, and the last-written heartbeat (a plain `setInterval` in the
same JS realm, 200 ms period).

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

### A) `utilityProcess.fork` — timeline (n=2 reps, identical shape)

```
t+0ms     /health 200, server running normally
t+3190ms  /health -> ERR:ECONNREFUSED        (the child just exited)
t+3190ms  the forked child's stderr, piped through main-utility.mjs and
          captured verbatim in its JSON-lines log as a "server-stderr" event:
          Error: PROOF-08 injected crash: simulated unhandled error in
          server process (utility, via entry wrapper)
              at Timeout._onTimeout (...server-entry-crash.mjs:33:11)
          Node.js v24.21.0
t+3190ms  main-utility.mjs log: {"event":"server-exit","code":1,
          "mainStillAlive":true,"windowStillExists":true}
t+3190ms..+9000ms   main OS process alive the whole time (osAlive=true every
          300ms poll); window still exists and is still visible
t+9000ms  our own scheduled app.quit() ends the rep cleanly
```

**Node's default `uncaughtException` handling ran exactly as documented:**
stack trace to stderr, process exits with code 1. Electron's main process
and `BrowserWindow` are a completely separate OS process and were
**unaffected** — confirmed alive and the window confirmed still existing at
every 300 ms poll for the full 9-second observation window, both reps.

### B) in-process — timeline (n=2 reps, identical shape; full 300 ms-resolution log kept)

```
t+0ms      /health 200, server running normally
t+1920ms   heartbeat still ticking normally (last tick before the crash)
t+2950ms   /health -> TIMEOUT (not refused — the process is still there,
           just not answering)
t+2950ms..+70833ms (full observation window this rep ran, 23x longer than A's 3s):
             - osAlive = true THE ENTIRE TIME, every single poll (main pid +
               all 3 children still present in Get-CimInstance)
             - health = TIMEOUT, unbroken, every single ~1.8s poll, 34 in a row
             - heartbeat file: FROZEN at its t+1920ms-tick content — zero
               further writes from a setInterval(fn, 200ms) that should
               have ticked ~340 more times if the JS event loop were alive
             - stderr: EMPTY — no stack trace, no diagnostic of any kind
             - electron exit event: NEVER fires; the OS process had to be
               force-killed externally (child.kill()) to end the rep
```

**This is not a clean crash — it is a silent hang.** The uncaught exception
did not print anything, did not exit the process, and did not leave the app
in a state where Electron's own crash reporting or a supervisor's "process
exited, restart it" logic could ever fire, because from the OS's point of
view the process **never exits**. Task Manager would show DeckTech "Running"
indefinitely — full ~272–301 MB resident, doing nothing, the window frozen
mid-frame — with no crash report and no automatic recovery path. The only
way out is an external kill (Task Manager "End task", or a
watchdog process outside DeckTech entirely).

The two behaviors, side by side:

| | main process survives | window survives | server signals down cleanly | diagnostic produced | self-terminates |
|---|---|---|---|---|---|
| A) `utilityProcess.fork` | **yes** | **yes** | yes — `ECONNREFUSED` | yes — full stack trace to stderr | yes — child exits(1) in ~0ms |
| B) in-process | technically, but frozen | frozen, unresponsive | no — `TIMEOUT`, indistinguishable from "slow" | **no — silent** | **no — needs external kill** |

## 6. A measurement bug found along the way (disclosed, not hidden)

The first full battery run reported `idle RSS = 0.0 MB` / an empty tree for
roughly 30% of the t+8s idle snapshots, for **both** approaches — plainly
wrong given every other snapshot at the same point in the same reps was
consistent within 2 MB. Root cause, found by comparing the always-correct
t+3s snapshot against the sometimes-wrong t+8s one: the probe's own
`QUIT_AFTER_MS` (originally 9000 ms, scheduled from the main process's
internal `app-ready` clock, which starts a few hundred ms before our
external `/health`-poll clock) left too little margin ahead of the t+8000 ms
external snapshot once a `Get-CimInstance Win32_Process` query — slow on
this machine, which runs 100+ unrelated `node.exe` processes from other
concurrent sessions — took its own several hundred ms. The snapshot
occasionally landed mid-quit. Fixed two ways, both now in `lib.mjs`/`run.mjs`:
widened the idle-rep quit margin to 13000 ms (a ~5 s cushion past the t+8000
check), and gave `processTree()` one bounded retry on an empty result before
trusting it. Reran the full battery after the fix — the numbers in §4 are
from that clean run, and the 0.0 MB anomaly did not recur.

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

**Ship `utilityProcess.fork` (Approach A).** The measured ~56 MB saving from
hosting in-process does not justify:

1. **A materially worse crash story.** A silent, undiagnosable, self-
   perpetuating hang that requires an external kill is a worse failure mode
   for an always-on desktop tray app than a clean, loud, immediately-visible
   child-process crash the main process and window survive untouched. This
   alone would be disqualifying even if the RAM numbers were reversed.
2. **Maintaining two hosting models instead of one**, when SHELL-03 already
   forces separate-process handling to exist regardless (§7).
3. A cold-start cost that is real but small (~50 ms at the median) — nowhere
   near enough to offset (1) and (2).

D15 is resolved: `utilityProcess.fork`, pointing at the real, unmodified
`server.js`, matching Approach A of this ADR.

## 9. Consequences for Fase 5 (SHELL-01/SHELL-02)

- `SHELL-01`'s "server lifecycle via `utilityProcess.fork`" is now backed by
  a measured crash story, not just the API's own recommendation in
  Electron's docs.
- `SHELL-02` ("health events for the UI") can reuse this ADR's signal:
  `child.on('exit', code)` with `code !== 0` (or, per §5, `code === 1` from
  Node's default `uncaughtException` handler) is a clean, reliable "server
  is down" event — no polling or timeout heuristics needed to detect a
  crash, unlike what an in-process design would have required.
- Do not reuse `execArgv` on `utilityProcess.fork` as a debugging/injection
  channel without verifying it lands — §5 showed it silently does not for
  `--import`.
- The ESM top-level-await hang in §3 must be documented in the real shell's
  main-process entry point (a code comment pointing here is the minimum) so
  a future refactor doesn't reintroduce it.

## Appendix — reproduce this

```sh
npm install --save-dev electron@44.4.1   # already committed in package.json
node measure/windows/proof-08/run.mjs                       # full battery (3 idle + 2 crash reps/approach)
node measure/windows/proof-08/run.mjs --reps 1 --crash-reps 1   # quick smoke run
node measure/windows/proof-08/crash-timeline.mjs utility        # 300ms-resolution crash timeline, Approach A
node measure/windows/proof-08/crash-timeline.mjs inprocess      # same, Approach B
```

All probes are self-contained: isolated `%APPDATA%` per run (never touches
the real user profile), unique ports per rep, and a hard watchdog kill so a
hung run (expected for Approach B's crash reps, by design — see §5) cannot
leave the terminal blocked.
