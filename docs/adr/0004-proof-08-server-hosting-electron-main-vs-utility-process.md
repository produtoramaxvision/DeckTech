# ADR-0004: Hosting server.js — `utilityProcess.fork` vs the Electron main process

- Status: Accepted
- Date: 2026-09-17 (round-1), revised 2026-09-17 (round-2), revised
  2026-09-18 (round-3 — see below), revised 2026-09-18 (round-4 — see below),
  revised 2026-09-18 (round-5 — see below), revised 2026-09-18
  (round-6 — see below), revised 2026-09-18 (round-7 — see below)
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

> **Round-4 revision note.** A rigorous review rejected the round-3 version on
> 8 findings (1 blocker, 3 major, 4 minor). The blocker: `processTreeOnce()`'s
> pid-reuse guard (round-3) validated only the tree's **root** by name —
> every descendant was admitted on `ParentProcessId` alone, and Windows'
> aggressive pid recycling under this machine's process churn let a
> completely unrelated, long-dead-parent process (`RiotClientServices.exe`
> in the reviewer's reproduction) get silently adopted into a measured tree,
> corrupting the round-3 idle-RSS delta into noise once included. Fixed with
> the canonical Windows ppid-staleness guard: every process's own
> `CreationDate` is now recorded, and a tree walk refuses any candidate
> child created *before* the node it claims as parent — proof the claimed
> relationship is stale, not real. Two of the three major findings were
> falsified/corrected mechanism claims, not measurement gaps: (1) round-2's
> attributed cause for its original `JSON.parse` failure — PowerShell 5.1
> `ConvertTo-Json` failing to escape control characters — is directly
> disproved on this machine (5/5 clean replays, 32/32 control characters
> correctly escaped); the failure was real, the mechanism was never
> isolated. (2) The actual encoding defect — `enum-windows.ps1` round-tripping
> raw window titles through this machine's non-UTF-8 console output encoding
> (cp850) — corrupted a real OS window title (`"Alternância de Tarefas"` →
> `"Altern?ncia de Tarefas"`) live on this machine, demonstrated without a
> synthetic input; fixed by base64-encoding titles the same way `CommandLine`
> already was. The third major finding: `crash-timeline.mjs` labeled each
> poll row with the time its iteration *started*, not when its
> window-enumeration data was actually sampled (up to ~2.5s later) —
> §5's "t+3659ms onward" causal-timing claim was read off mislabeled rows
> and is retracted, replaced with honestly-bounded timing from re-timestamped
> code. The four minor findings (a role-labeling function that camouflaged
> non-Electron processes as "browser (main)", a pid-reuse guard that could
> not distinguish our own process from another instance of the same
> executable, two source-comment line citations, and a matched-handler
> propagation-time band restated as a fifth non-overlapping range rather
> than republished as a stable number) are all fixed/restated below. **The
> full battery (`--reps 8 --crash-reps 3`) was re-run from this round's
> fixed code — every number in §4 and §5 is from that re-run**, scanned
> directly for the contamination pattern that broke round-3 (zero found
> across 28 measured trees) — not carried over. The decision is unchanged;
> §4's delta is, if anything, cleaner than round-3's invalidated figure
> (58.8 MB against 4.6 MB/2.9 MB spreads, both tighter than round-3's own
> now-retracted 6.4 MB/3.5 MB). See §6 and the inline "ROUND-4 FIX" comments
> in `measure/windows/proof-08/*.mjs`/`.ps1` for the mechanism of each fix.

> **Round-5 revision note.** A rigorous review rejected the round-4 version
> on 3 findings (1 blocker, 1 major, 1 minor), all in the crash-timeline
> probe and its window-enumeration dependency — **§4 (idle RSS, cold start)
> is untouched by any of the three and was not re-run.** The blocker:
> round-4's own headline fix for its own finding #4 (mislabeled
> crash-timeline timestamps) was incomplete, and round-4's own code comment
> asserting the fix was complete was false — every probe was still stamped
> *before* its `await`, so a label could still precede the true read by up
> to the ~1s+ the underlying PowerShell round trip takes; a round-5
> reviewer reproduced the exact impossible-ordering signature (a window
> sample reporting the crash dialog 275ms *before* the independently-
> computed crash time) that round-4 itself was rejected for, on round-4's
> supposedly-fixed code. Fixed by stamping both a pre-call and a
> post-return timestamp per probe and deriving any causal-timing interval
> only from the edge each stamp can actually prove (pre-call of the last
> absent sample as the lower bound, post-return of the first present sample
> as the upper bound) — see §5's box and §6's finding-#1 entry for the
> re-derived numbers, from a fresh `crash-timeline.mjs inprocess` run. The
> major: `enum-windows.ps1`'s `GetClassName` P/Invoke import had no
> `CharSet`, silently binding the ANSI entry point (`GetClassNameA`) on a
> file whose own header, and this ADR, asserted three times it calls
> `GetClassNameW` — a defect the round-4 base64 fix (which protects only
> the console output pipe, not the P/Invoke marshaling boundary) could not
> reach. Proven on an identically-declared `GetWindowText` pair (not on
> `GetClassName` directly — Win32 class names are ASCII in practice, which
> is why nothing measured here was actually corrupted); fixed by declaring
> the import `CharSet=CharSet.Unicode, EntryPoint="GetClassNameW"`
> explicitly. The minor: the Appendix's round-4 "decode and confirm"
> repro line was a bare `enum-windows.ps1` invocation that prints raw
> base64 and decodes nothing — a reader could not confirm the round-trip
> claim from the Appendix alone; fixed with a new committed script,
> `decode-windows.mjs`, that decodes through `lib.mjs`'s real
> `enumAllWindows()` (the same path every real caller uses). The decision
> is unchanged. See §5, §6 and the inline "ROUND-5 FIX" comments in
> `measure/windows/proof-08/*.mjs`/`.ps1` for the mechanism of each fix.

> **Round-6 revision note.** A rigorous review rejected the round-5 version
> on 4 findings (1 blocker, 2 major, 1 minor), all fixed below with no
> re-litigation of anything that already passed. The blocker: round-5's §5
> box claimed "full output archived in this round's commit" for the run
> behind `t0=1789707326699`, but no such artifact exists anywhere in the
> tracked tree or in either commit that touched this ADR that round
> (verified: `git show --stat` on `d26e2d4` and `f265787`, neither adds a
> log file; `grep -rl "1789707326699" .` outside `.git` matches only this
> ADR's prose) — a false provenance claim in the section that exists to
> prevent false provenance claims, contradicting this file's own
> convention below. It cannot be repaired after the fact by inventing an
> artifact for a number nobody captured; fixed by retracting that run and
> capturing three fresh runs of the identical command this round with
> `... | tee`, committed as
> `measure/windows/proof-08/crash-timeline-inprocess-run{1,2,3}.txt` — see
> §5's round-6 correction for the table derived from them. The two majors:
> (a) §5 published one run's dialog-arrival interval while this round's own
> rejection record quotes two further, differently-aligned runs (one
> landing the dialog in iteration 2 instead of 3) that were never
> published — fixed by publishing all three fresh archived runs side by
> side (all land in iteration 3, cross-validating the interval *rule*
> under one alignment) and citing the two iteration-2 runs from the
> rejection record explicitly as prose-only, unarchived, and available for
> a future round to re-capture rather than silently omitted; (b) round-5's
> work landed on `homolog` as `f265787`, whose commit message
> ("fix(proof-08): close round-5 rejection of crash-timeline evidence")
> describes only proof-08 work but whose diff also carries an entire
> unrelated proof-03 round-10 fix, orphaning that work's own commit
> (`cf04f16`, unreachable from `homolog` — `git merge-base --is-ancestor
> cf04f16 homolog` exits 1 — but still resolvable as a commit object) —
> fixed by recording the misattribution here and in ADR-0003's own
> revision history (not by rebasing or amending, which is what produced
> the problem) and pinning the orphaned commit against garbage collection
> with `git update-ref refs/orphaned/proof-03-round-10 cf04f16`, plus
> escalating to a human maintainer who can decide whether to clean
> `homolog`'s history; **this worker did not cause the misattribution and
> made no further history-rewriting operation to try to fix it.** The
> minor: `enum-windows.ps1`'s round-5 header argued against
> `CharSet.Auto`'s "OS-dependent resolution" while leaving `GetWindowText`
> — the import that actually reads window titles, which round-4's own fix
> demonstrated carry non-ASCII text on this machine — on that exact
> declaration; fixed by declaring `GetWindowText` explicitly
> (`CharSet=CharSet.Unicode, EntryPoint="GetWindowTextW"`), matching
> `GetClassName`, and re-verified with a fresh
> `node measure/windows/proof-08/decode-windows.mjs` run this round: `301
> windows enumerated; 13 with a non-ASCII title or class`, sample
> `{"pid":9508,"class":"XamlExplorerHostIslandWindow","title":"Alternância
> de Tarefas","visible":false}` — non-ASCII titles still round-trip intact
> after the explicit declaration (output archived at
> `measure/windows/proof-08/decode-windows-round6.txt`). The decision is
> unchanged. See §5's round-6 correction, §6's round-6 addendum and the
> inline "ROUND-6 FIX" comment in `enum-windows.ps1` for the mechanism of
> each fix.

> **Round-7 revision note.** A rigorous review rejected the round-6 version
> on 3 findings (1 blocker, 1 major, 1 minor), all fixed below with no
> re-litigation of anything that already passed. The blocker: round-6's
> commit fixed §6's copy of the retracted `t0=1789707326699` quadruple
> (adding its "Round-6 addendum" marker) but left §5.1's copy of the exact
> same four figures untouched, still presented as this round's standing
> evidence for decision reason (1) in §8 — fixed by re-deriving §5.1's
> paragraph in place from the already-archived
> `crash-timeline-inprocess-run1.txt` (no new run needed; run1 was
> captured in round 6 and simply never cited by §5.1) and adding a
> "Round-7 correction" box naming every figure that changed and why. The
> major: §5's cross-alignment claim ("the five runs now on record ...
> reproduces across at least two distinct iteration alignments") rested on
> two runs round-6 itself flagged as prose-only and unarchived, while
> asserting a future round would have to re-capture one — fixed by
> capturing `crash-timeline-inprocess-run4.txt` this round (landed the
> dialog in iteration 2 on the first attempt), adding it to §5's table,
> and moving the cross-alignment claim onto that committed artifact
> instead of the two unarchived runs. The minor: the Appendix had a block
> per round through round-5 but none for round-6, so a reader following it
> alone would not learn that `crash-timeline-inprocess-run{1,2,3}.txt` and
> the `enum-windows.ps1` `CharSet=Unicode`/`GetWindowTextW` fix are
> round-6's canonical artifacts — fixed by adding the missing "Round-6
> additions" block (and a "Round-7 additions" block for `run4`). The
> decision is unchanged. See §5.1's round-7 correction, §5's round-7 fix
> and the Appendix for the mechanism of each fix.

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

> **Round-4 note: every number in this section is from a fresh re-run, not
> carried over from round-3.** Round-3's idle-RSS table (6.4 MB / 3.5 MB
> spreads, "reproduces cleanly across all 8 reps") was invalidated by
> blocker finding #1 — a stale-ppid process contaminated 2 of that round's
> 41 measured trees (§6). The fix (a `CreationDate`-based ppid-staleness
> guard validating every descendant, not just the root) landed **before**
> this round's battery below was run, and this battery's own raw trees were
> scanned for any surviving `non-Electron (...)`-labeled entry (finding
> #6's visible safety net): **zero found across all 28 measured trees**.
> This section republishes §4's table, spreads and delta claim from that
> clean run.

Method: `node measure/windows/proof-08/run.mjs --reps 8 --crash-reps 3`, run
fresh for round-4 (793 concurrent OS processes on this machine at the start
of this run, per `Get-CimInstance Win32_Process | Measure-Object`, printed by
`run.mjs` itself). The inner per-rep order **alternates** (rep 0: utility,
inprocess; rep 1: inprocess, utility; ...), round-3's fix for a residual
run-order position effect — this **reduces**, but (being a fixed alternation
rather than a randomization) does not fully eliminate it. Each rep still
gets its own isolated Electron `userData` directory (§6), so no rep, in
either arm, inherits another rep's or another arm's warm GPU/shader cache
regardless of position. Cold start = wall-clock time from
`child_process.spawn` to the first HTTP 200 on `/health`. Idle RSS = whole
process tree rooted at the main process, validated by the round-4
ppid-staleness guard (§6, finding #1) so a stale/recycled pid cannot be
summed into it; the nominal sample point is t+8s after `/health` first
answered (`REPORTED_SAMPLE_MS`), and the **actual** elapsed time is recorded
per sample, ranging 8.8s–9.4s across the 16 idle reps of this run.
**Median, throughout this ADR, is the actual median** (the two middle values
averaged at even n). **Round-4 addition:** the delta-vs-spread FLAG that
already covered cold start now covers idle RSS too (§6, finding #1's
required fix #2) — printed by `run.mjs` itself, not asserted in prose.

### Cold start (launch → first `/health` 200)

| | reps (ms) | min | median | max | spread |
|---|---|---|---|---|---|
| A) `utilityProcess.fork` | 568, 436, 473, 525, 420, 371, 428, 403 | 371 ms | **432 ms** | 568 ms | 197 ms |
| B) in-process | 381, 356, 359, 300, 350, 353, 360, 395 | 300 ms | **358 ms** | 395 ms | 95 ms |

**Median delta: 75 ms (B faster).** This does **not** support a directional
claim at this n: `run.mjs` flags it automatically — `FLAG: median delta
(75 ms) is SMALLER than at least one arm's own spread (197 ms) — not a
reproducible directional claim at this n`. **Cold start is not a
reproducible factor in this decision** and §8 does not cite it as one — this
conclusion is unchanged across all four rounds, on freshly re-measured
round-4 numbers, at a noticeably *tighter* spread than round-3's (197 ms/
95 ms vs. round-3's 526 ms/169 ms) that still does not flip the FLAG.

**Position-effect split:**

| | ran FIRST (n=4) median | ran SECOND (n=4) median |
|---|---|---|
| A) `utilityProcess.fork` | 451 ms | 420 ms |
| B) in-process | 355 ms | 360 ms |

Both arms show essentially no position effect this round (A: 451 ms vs.
420 ms; B: 355 ms vs. 360 ms) — unlike round-3, where arm A showed a real
455 ms/711 ms gap. This is additional evidence that the effect is
real-but-load-dependent, not a new conclusion: cold start already carries no
weight in §8's decision regardless.

### Idle RSS — whole process tree, nominal t+8s (actual 8.8s–9.4s) after ready

| | reps (MB) | min | median | max | spread |
|---|---|---|---|---|---|
| A) `utilityProcess.fork` | 336.3, 336.5, 335.7, 336.3, 336.5, 336.9, 332.3, 336.5 | 332.3 MB | **336.4 MB** | 336.9 MB | 4.6 MB |
| B) in-process | 278.6, 277.8, 277.1, 277.6, 277.6, 280.1, 277.3, 277.2 | 277.1 MB | **277.6 MB** | 280.1 MB | 2.9 MB |

**Delta: 58.8 MB** (median), i.e. what moving the server in-process actually
saves — not the 68.6–71.2 MB "floor" reported for the standalone
`node server.js` process, because the in-process host still pays the extra
JS heap/Node overhead where it now lives (main's own working set is ~94.7 MB
in Approach B vs ~81.6 MB in Approach A — see the trees below). **This
delta exceeds both arms' spreads (4.6 MB and 2.9 MB)** — `run.mjs`'s own
FLAG (now applied to idle RSS, not just cold start — see the round-4 note
above) prints `Median delta exceeds both arms' spread — directionally
supported at this n` rather than a bare prose assertion. This is a
reproducible, directional finding, on a battery whose 28 measured trees
were scanned for contamination and found clean. (Round-2 reported
57.3 MB/8.4 MB/7.5 MB, round-3 reported an invalidated 56.3 MB/6.4 MB/
3.5 MB — the difference from this round's clean 58.8/4.6/2.9 is a fresh run
on a live, load-sensitive machine, not a further correction beyond
round-3's figures already being retracted above.)

Full tree, one representative rep per approach (rep 8, the last of this
run), role of every process shown (via `--type=`/`--utility-sub-type=`, not
guessed from name, and every non-`electron.exe` name would print as
`non-Electron (<name>)` rather than being camouflaged — round-4, finding
#6 — had any appeared; none did):

```
A) utilityProcess.fork:
electron.exe [browser (main)] (pid 45152) — 81.6 MB WS
  electron.exe [gpu-process] (pid 11776) — 82.2 MB WS
  electron.exe [utility (network.mojom.NetworkService)] (pid 42872) — 39.7 MB WS
  electron.exe [renderer] (pid 17216) — 63.9 MB WS
  electron.exe [utility (Node — our forked server.js)] (pid 34432) — 69.1 MB WS

B) in-process (imported into main):
electron.exe [browser (main)] (pid 27812) — 94.7 MB WS   <- vs A's main ~81.6 MB
  electron.exe [gpu-process] (pid 39668) — 81.6 MB WS
  electron.exe [utility (network.mojom.NetworkService)] (pid 28336) — 39.6 MB WS
  electron.exe [renderer] (pid 49756) — 61.4 MB WS
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
> **What this round's fresh 8-rep battery shows, in full (round-4
> re-measurement — same pattern as round-3, freshly confirmed, not carried
> over):** all 8 of 8 Approach-A idle reps printed the identical stdout pair
> `Dokke ouvindo em http://127.0.0.1:<port>` followed by `[discover] erro:
> bind EADDRINUSE 0.0.0.0:3001`, and `Get-NetUDPEndpoint -LocalPort 3001`
> confirmed, in all 8 reps, that port 3001 is owned by pid **45020** — the
> same unrelated ambient `node.exe` process as round-3 (still running on
> this machine at this round's measurement, confirmed separately: process
> start time 10:54:44, this round's run at 01:17), not our forked server
> child (whose own pid was checked and differed in every rep: 27268, 45916,
> 32856, 37464, 26100, 31364, 26928, 34432). This is **machine-state
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
> not change §4's 58.8 MB delta (which is driven by the forked server
> process's own working set existing as a fifth OS process at all, not by
> whether its UDP socket happened to bind) or §8's decision.
>
> **Crash reps are unaffected.** Approach A's crash sub-test forks
> `server-entry-crash.mjs`, which calls `startServer()` only — same as
> Approach B — so §5's crash comparison is code-path matched between arms
> and this asymmetry does not reach it (see §2's per-file notes and §5.1).

### 4.2 Cross-check against `WINDOWS-STACK.md` (round-2 correction, re-measured round-3, re-measured again round-4)

The forked-server-child working set across all 8 idle reps of this round's
run (from `raw-results.json`, not the single representative tree printed
above): 69.2, 71.2, 71.4, 71.7, 71.7, 69.6, 66.6, 69.1 MB — **range
66.6–71.7 MB, median 70.4 MB**, against `WINDOWS-STACK.md`'s standalone-
process floor of **68.6–71.2 MB** (`.maxvision/research/WINDOWS-STACK.md:45`,
measured with standalone Node v25.5.0). This round's range dips below the
standalone floor's low end (66.6 vs. 68.6) **and** rises above its high end
(71.7 vs. 71.2) — the same both-directions pattern round-2's own
re-measurement showed (66.0–71.7 MB), not round-3's one-directional dip
(68.4–71.0 MB). All three are correct readings of their own runs: this is
one methodology (an isolated OS process running `server.js`, `APPDATA`
redirected, `PORT` overridden) applied to two different Node runtimes
(standalone Node v25.5.0 vs. Electron-bundled Node 24.21.0, see §3) on a
machine whose ambient load varies run to run — "the server's own footprint
is roughly similar whichever runtime hosts it, within a few MB," not "agrees
to within 3% of a single figure," and three independent rounds now show
three different (overlapping) ranges around that same floor.

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
> to `run.mjs`'s crash summary below).
>
> **Round-4 correction (major finding #4): round-3's own timestamps here
> were mislabeled, and are replaced, not annotated.** Round-3's
> `crash-timeline.mjs` stamped every poll row with the time at the *start*
> of that loop iteration, but the window-enumeration data actually ran
> *last* in the same iteration (after `processTree()`'s retries and
> `httpStatus()`) — up to ~2.5s later than the row's own label. The
> "t+3659ms onward" / "t+85800ms" figures below were read off those
> mislabeled rows and are **retracted, not merely re-derived** — see §6's
> round-4 bug entry for the reproduction that caught this (a reviewer's row
> labeled t+2502ms already contained the dialog, for a crash that could not
> have fired before ~t+3.3s). `crash-timeline.mjs` now stamps each probe's
> own wall-clock time immediately before it runs, and prints that per-probe
> time, not a single iteration-start label.
>
> Re-running `node measure/windows/proof-08/crash-timeline.mjs inprocess`
> fresh from the fixed code for this round reproduces the box above from
> the committed script itself, with honestly-bounded timing instead of
> false precision: health 200 at t+371ms; the crash fires at approximately
> **t+3372ms** (computed from the main process's own `server-ready`/
> `crash-scheduled` log timestamps against the driver's `t0`, not
> estimated). The window-enumeration sample at **t+1495ms** shows only
> `{"title":"Electron",...,"class":"Chrome_WidgetWin_1",...}`; the *next*
> sample, at **t+4358ms**, already shows a second entry:
> `{"title":"Error","class":"#32770","visible":true}` — the identical
> dialog, from the identical committed script. Given this round's real
> sampling resolution (~2.5–3s between consecutive window-enumeration
> samples, itself disclosed rather than assumed — see below), the honest
> claim is **the dialog first appears somewhere in (t+1495ms, t+4358ms] —
> consistent with, and bounded around, the ~t+3372ms crash** — not a false
> single-millisecond timestamp. ~~The heartbeat over the same window: last
> live tick recorded at the sample taken t+1495ms (age 32ms at that
> sample), then frozen at that same `hb.t` value at every subsequent sample
> through the end of the run (age growing past 94s by the final sample)
> while `/health` answers `TIMEOUT` from the first post-crash sample
> onward — confirming the freeze independently again, on freshly-timed,
> correctly-labeled data.~~
>
> **Round-5 correction (blocker finding #1): the paragraph above is
> retracted, not merely re-derived — round-4's own "fix" was itself still a
> pre-call label.** Round-4 moved `windowsAtMs` to be stamped immediately
> *before* `windowsForPids()`'s `await`, and its own header comment claimed
> this "is when the window data below was actually sampled, not when the
> iteration started" — but `windowsForPids()` still takes up to ~1s+ (the
> `EnumWindows` `Add-Type` recompile plus retries — see `lib.mjs`), so the
> label could still precede the true read by that much. A round-5 reviewer
> reproduced the identical impossible-ordering signature this exact defect
> shape produces: their clean run's row `windows[sampled t+3038ms]` already
> contained the `#32770`/`Error` dialog for a crash independently computed
> (from that same run's own `server-ready` log + `PROOF08_CRASH_AFTER_MS`)
> to fire at t+3313ms — a label 275ms *before* the crash that created what
> it reports. The t+1495ms/t+4358ms figures above have the same defect and
> are retracted for the same reason round-4 retracted round-3's
> t+3659ms/t+85800ms figures.
>
> **Fix (round-5).** `crash-timeline.mjs` now stamps each probe with BOTH a
> pre-call and a post-return timestamp and prints `[read in (t+A ms,
> t+B ms]]` — an interval bounding the unknown true read instant, not a
> single point. A dialog-arrival interval is derived across two consecutive
> rows using only the edges each row can actually prove: the **pre-call**
> timestamp of the **last dialog-absent** sample (a provable lower bound —
> the read that found no dialog cannot have happened before its own
> pre-call stamp) and the **post-return** timestamp of the **first
> dialog-present** sample (a provable upper bound — the call had returned,
> so the dialog existed, by that stamp). Using the post-return stamp of the
> *absent* sample as the lower bound (what a naive reading of "use the
> later, more-certain edge" would suggest) is NOT valid: that read could
> have completed anywhere in its own `(pre, post]` window, including right
> after `pre`, so its `post` time is not a bound on when the dialog was
> still absent — only its `pre` time is.
>
> **Round-6 correction (blocker finding #1): the "Re-run post-fix" run this
> box used to publish (`t0=1789707326699`, health 200 at t+291ms, dialog
> interval `(t+2777ms, t+6006ms]`) is retracted, not re-derived, for a
> provenance reason distinct from round-5's — its stdout was never captured
> to a file, so the round-5 text's own "full output archived in this
> round's commit" claim was false: no such artifact exists in either
> `d26e2d4` or `f265787` (`git show --stat` on both; neither touches
> anything under `measure/windows/proof-08/` besides the `.mjs`/`.ps1`
> sources), and `t0=1789707326699` appears nowhere in the tracked tree
> except this prose (`grep -rl "1789707326699" .` outside `.git` matches
> only this file). The derivation shown for it was correct on its own
> terms — the defect is that the run behind it is unverifiable, which is
> exactly what line 146's evidence convention forbids. It cannot be
> recovered after the fact; a number can only be archived by capturing it
> at run time.
>
> **Fix (round-6).** Three fresh runs of the identical, unmodified command
> were captured this round with `... | tee`, so raw stdout is committed
> and reproducible by any reader, not just re-derived in prose:
> `measure/windows/proof-08/crash-timeline-inprocess-run{1,2,3}.txt`. All
> three used the same interval rule from the fix above; none required any
> code change. `t0` is cross-derived from two independent heartbeat rows
> in each run and both derivations agree exactly within that run (shown in
> full in each log's `iter 1`/`iter 2` rows):
>
> | run (archived log) | `t0` (abs, cross-derived x2) | computed crash (rel.) | last dialog-absent | first dialog-present | interval | check | dialog first seen |
> |---|---|---|---|---|---|---|---|
> | run1 | 1789708709886 | t+3364ms | iter2 `(t+2968, t+3761]` | iter3 `(t+5590, t+6372]` | `(t+2968ms, t+6372ms]` | 6372≥3364>2968 ✓ | iter 3 |
> | run2 | 1789708829914 | t+3306ms | iter2 `(t+2760, t+3517]` | iter3 `(t+5148, t+5866]` | `(t+2760ms, t+5866ms]` | 5866≥3306>2760 ✓ | iter 3 |
> | run3 | 1789708939541 | t+3302ms | iter2 `(t+2873, t+3645]` | iter3 `(t+5410, t+6261]` | `(t+2873ms, t+6261ms]` | 6261≥3302>2873 ✓ | iter 3 |
> | run4 | 1789709970610 | t+3294ms | iter1 `(t+1407, t+2257]` | iter2 `(t+3136, t+4027]` | `(t+1407ms, t+4027ms]` | 4027≥3294>1407 ✓ | iter 2 |
>
> **Round-7 addition:** the `run4` row was not captured in round 6 — this
> box's own "Fix (round-6)" sentence above describes only run1-run3. run4
> is listed in this same table (rather than a separate one) so all four
> archived runs read together in one place; see the round-7 fix below for
> how and why it was captured.
>
> Runs 1–3 land the dialog in iteration 3 and pass the
> discriminating check — they cross-validate the **derivation rule**
> (pre-call lower bound / post-return upper bound), not just repeat one
> number. Per that rule, this round's honest headline claim is **the
> dialog first appears somewhere in an interval bounded around t+3.3s**,
> illustrated concretely by run1: `(t+2968ms, t+6372ms]`.
>
> **Round-6 correction (major finding #2, superseded — see round-7 fix
> below): a differently-aligned run exists and is not archived here — say
> so plainly instead of hiding it.** Round-6's own rejection record (the
> finding-#2 evidence quoted to that round's worker) reported two further
> runs that were NOT among runs 1–3 (the only ones archived at that time)
> and whose raw stdout that worker did not hold, so they could not be
> committed as artifacts that round: (a) a round-5 worker's own run, `t0=1789707708364`, crash
> computed at t+3264ms, interval `(t+1480ms, t+3977ms]`, dialog first seen
> in iteration 2; and (b) the round-6 reviewer's own independent run,
> `server-ready 1789708223276` + 3000ms ⇒ crash t+3310ms, `t0`
> cross-derived twice to `1789708222966`, interval
> `windows[read in (t+1605ms, t+2667ms]]` (last absent) to
> `windows[read in (t+4432ms, t+5397ms]]` (first present) ⇒
> `(t+1605ms, t+5397ms]`, check `5397≥3310>1605` ✓, dialog in iteration 2.
> Both were cited from that round's rejection text only, not independently
> re-run by that round's worker, and were recorded as **prose only — no
> committed log backed them**. Round-6 asserted a future round would have
> to re-run and `tee` one fresh; that assertion is why round-7's reviewer
> rejected this paragraph as it stood: an iteration-2-aligned run is
> not rare (obtained on the first attempt — see the round-7 fix
> immediately below).
>
> **Round-7 fix (major finding #2).** Ran the identical, unmodified
> command once — `node measure/windows/proof-08/crash-timeline.mjs
> inprocess`, captured with `| tee` the same way runs 1–3 were — and it
> landed the dialog in iteration 2 on the first attempt:
> `measure/windows/proof-08/crash-timeline-inprocess-run4.txt` (row `run4`
> in the table above). `t0` is cross-derived from the `iter 1` and `iter 2`
> heartbeat rows and both agree exactly: `1789709971862 + 155 − 1407 =
> 1789709970610` and `1789709973551 + 195 − 3136 = 1789709970610`.
> `server-ready`(1789709970904) + `afterMs`(3000) ⇒ crash at
> `1789709973904` abs, **t+3294ms** relative to that `t0`. Last
> dialog-absent is `windows[read in (t+1407ms, t+2257ms]]` (iter 1, no
> `#32770`); first dialog-present is
> `windows[read in (t+3136ms, t+4027ms]]` (iter 2, `#32770`/`Error`
> present) — interval `(t+1407ms, t+4027ms]`, discriminating check
> `4027≥3294>1407` ✓. Heartbeat: last live tick `hb.t=1789709973551`
> (rel t+2941ms, age 195ms) then frozen at `hb.t=1789709973761`
> (rel t+3151ms) from iter 3 onward — Δ143ms before the computed crash
> (t+3294ms), inside the sub-200ms band runs 2 and 3 also show. `/health`
> answers `TIMEOUT` from iter 3 onward with `osAlive=true` through
> iteration 37 at t+92624ms; 37/37 iterations, exit 0, `stderr tail:`
> empty — every field of the pattern the three iter-3-aligned runs show,
> reproduced under the other alignment. **Four runs are now archived and
> committed** (not "three archived + two cited in prose"): the *rule*
> (pre-call lower bound / post-return upper bound, applied per-run) — not
> merely one interval — reproduces across two distinct iteration
> alignments, iter 2 (run4) and iter 3 (runs 1–3), which is the
> cross-validation the interval-rule fix above was meant to survive. The
> round-6 paragraph above is left for the historical record of what that
> round asserted still needed doing; it is superseded by this one, which
> supplies the committed artifact instead of citing an unarchived run.
>
> **Discriminating check**, applied to all four archived runs (see table):
> every run's upper bound is ≥ its own computed crash time and its lower
> bound is < it — no impossible ordering in any of the four.
>
> **Heartbeat freeze**, checked per archived run (not asserted once and
> assumed to generalize): run2 and run3 both show the last live tick
> freezing **before** the computed crash, by a margin under the 200ms
> write interval (run2: frozen tick t+3157ms, crash t+3306ms, Δ149ms;
> run3: frozen tick t+3154ms, crash t+3302ms, Δ148ms; run4: frozen tick
> t+3151ms, crash t+3294ms, Δ143ms) — consistent with "the event loop
> stopped ticking just before the throw". run1 does not show this cleanly:
> its frozen tick (t+3372ms) lands 8ms *after* its own computed crash time
> (t+3364ms) — within the timer-scheduling jitter between two
> independently-scheduled async timers (the 200ms heartbeat writer and the
> crash `setTimeout`), not a violation, but also not forced into a
> "before" narrative it does not cleanly support. What carries forward
> unambiguously across all four archived runs, and across round-1 through
> round-7: the heartbeat freezes at (or within jitter of)
> the crash and stays frozen, `/health` answers `TIMEOUT` from the first
> post-crash sample onward, and the OS process stays alive throughout —
> the freeze **observation** survives; only the single-run precision of
> "how many ms before" does not generalize cleanly to every run and is
> reported per-run above instead of averaged into a false single figure.
>
> **Actual poll cadence, disclosed rather than assumed (finding #3).**
> `EnumWindows` recompiles its `Add-Type` P/Invoke shim on every
> `powershell.exe` invocation — measured standalone on this machine (`time
> powershell.exe -NoProfile -NonInteractive -File enum-windows.ps1`):
> ~0.8–1.1s per call. Combined with the pre-existing `processTree()` call the
> same loop iteration makes, this round's `inprocess` (default-handler) run
> above shows **actual per-iteration elapsed of ~2.2–3.2s**, not the nominal
> 300ms a bare reading of "poll loop" suggests, and not an 11-second
> observation window either — 37 iterations at that cadence is a real
> **~55–95s** wall-clock run, printed once at the start (round-4 fix,
> finding #4) rather than left for a reader to infer from a misleading loop
> step. This is still ample resolution for a crash injected at a known
> t+3000ms: the state change is visible within one or two samples of the
> crash either way, now correctly labeled with the time it was actually
> observed rather than the time the enclosing iteration began.
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
the idle reps as described in §4, from this round's fresh battery (round-4
— see §4's note; the process-tree numbers below all benefit from the same
ppid-staleness guard).

### 5.1 Default handler policy (n=3 reps each, all 3 identical in shape per arm)

**A) `utilityProcess.fork`:** every rep — forked child exits(code 1) within
~3.17–3.22s of ready (`server-exit` event, computed from `raw-results.json`'s
own `server-exit` minus `crash-scheduled` timestamps this round: 3173ms,
3212ms, 3200ms), main process alive the whole observation window, window
still exists, `/health` would answer `ECONNREFUSED` once the child is gone.
Example log excerpt (rep 1):
`{"event":"crash-scheduled","afterMs":3000,"target":"utility-child"}` →
`{"event":"server-exit","code":1,"mainStillAlive":true,"windowStillExists":true}`
→ (9s later) `{"event":"quitting",...}`. `electron exit: code=0` (our own
scheduled `app.quit()`, not the crash) in all 3 reps.

**The stderr-capture race (finding #3, round-3), re-measured this round —
a fourth data point, not a fixed number.** Round-2 reported 2/7 (with an
internal denominator contradiction, corrected in round-3); round-3's own
fresh battery captured the literal `server-stderr` text in 6 of 6 A-arm
crash reps (3 default + 3 matched). **This round's fresh battery captured
it in 3 of 6** — default-handler reps 1 and 2 show no `server-stderr` log
event (only `code=1` via the `exit` event, which fired every time, every
round), rep 3 does; matched-handler reps 1 and 3 show it, rep 2 does not
(checked directly against `raw-results.json`'s `logEvents`, not inferred).
This is a *third* distinct count from the same intermittent race (round-2:
2/7 with the arithmetic issue noted above; round-3: 6/6; round-4: 3/6) —
exactly the behavior an unfixed, load-dependent race under a live machine's
variable concurrent process count is expected to produce, not a
contradiction to resolve. `main-utility.mjs`'s `child.stderr.on("data",
...)` forwarding still races the child's `exit` event and `run.mjs`'s
subsequent log-file read; **not fixed in code** (round-4's required fixes
did not include this one — see the task's 8 findings). What is reliably
true regardless of the race, across all four rounds without exception:
`code=1` matches Node's own documented default `uncaughtException` exit
code exactly, and a standalone check on this machine
(`node -e "setTimeout(()=>{throw new Error('x')},50)"`) confirms Node's
default prints the full stack to stderr and exits 1.

**B) in-process:** every rep — `mainAliveAfterCrash: true`, `electron exit:
code=null signal=SIGTERM` (our watchdog force-killed it; it never exited on
its own), process tree still fully present (main + gpu + network + renderer,
~279.6–301.4 MB total) at the post-crash snapshot ~8.9–9.1s after ready —
checked against the round-4 ppid-staleness guard (§6, finding #1), which
validates every process in the tree, not just the root, so this "still
fully present" reading is not at risk from the specific stale/recycled-ppid
contamination pattern finding #1 identified (a child whose recorded parent
predates it) — it is not a blanket guarantee against every possible
contamination shape, e.g. a child with no queryable `CreationDate` at all
is admitted on the pid/parent match alone, same as round-3.
Re-verified from the **committed, archived**
`measure/windows/proof-08/crash-timeline-inprocess-run1.txt` (the
"Fix (round-6)" box above, round-6 blocker finding #1 — three fresh runs
of `crash-timeline.mjs inprocess` were captured with `| tee` and committed
in round 6; this paragraph, corrected in round 7, now cites run1 of those
three by name instead of re-deriving prose from an unarchived run):
heartbeat ticks normally through the sample carrying
`hb.t=1789708712846`, read in `(t+2960ms, t+2968ms]` (rel t+2960ms, age
8ms at read time), then **freezes at that exact tick's content for every
subsequent sample through the end of the run** — the last live value is
overwritten by nothing further; the frozen `hb.t=1789708713258` (rel
t+3372ms) is what every later sample reads, through the last row printed,
iter 37/37, `windows[read in (t+91640ms, t+92596ms]]`, i.e. a run of
**~92.6s**, inside the ~56–93s budget the loop itself printed at the start
(finding #3, below) — while `/health` answers `TIMEOUT` from the first
post-crash sample onward, and the independently-enumerated window set shows
the `#32770`/`Error` dialog already present in the sample read in
`(t+5590ms, t+6372ms]` (absent in the prior sample, read in
`(t+2968ms, t+3761ms]`) and persisting throughout — confirming the freeze
**observation** (heartbeat frozen, `/health` TIMEOUT, process still alive)
stands under round-6's committed, archived, interval-timestamped data.
This is the qualitative finding, separable from the numeric timing labels
retracted in earlier rounds — round-3's and round-4's *when-it-appeared*
figures for this same observation never carried forward; only
interval-bounded figures read from a committed log do. `stderr tail:` for
run1 was empty, consistent with the mechanism in the box above (the dialog
is the diagnostic; stderr genuinely gets nothing).

> **Round-7 correction (blocker finding #1).** The paragraph above, as it
> stood through round-6, quoted the quadruple `t0=1789707326699` /
> `(t+2776ms, t+2777ms]` / `(t+5080ms, t+6006ms]` / `(t+2777ms, t+3519ms]`
> / iter37 `(t+91742ms, t+92582ms]` — the exact run the "Round-6
> correction (blocker finding #1)" / "Fix (round-6)" box earlier in this
> section retracts as "never captured to a committed artifact ... cannot
> be recovered after the fact". None of those five figures exists in any
> committed file under `measure/` or `test/`
> (`grep -rl "2776\|6006\|91742\|92582\|1789707329411" measure/ test/`
> returns no match), and they do not match any of the three runs that box
> actually archived — run1's own iter37 window is
> `(t+91640ms, t+92596ms]`, not `(t+91742ms, t+92582ms]`. This paragraph
> is corrected in place, not merely flagged: every quantity above is now
> read directly from `measure/windows/proof-08/crash-timeline-inprocess-run1.txt`
> and cited inline, exactly as this box shows. A stranger reading §5.1
> alone, without cross-checking the earlier box, now sees only figures
> that exist in a committed artifact.

### 5.2 Matched handler policy — same explicit handler in both arms (n=3 reps each)

**A) `utilityProcess.fork`:** unchanged from 5.1 — `mainAliveAfterCrash:
true`, `electron exit: code=0` (self-scheduled quit) in all 3 reps.
Installing the handler in `server-entry-crash.mjs` produced the same
observable outcome (`code=1` child exit, main/window survive) as 5.1's
default; **2 of these 3 reps' logs contain the literal `server-stderr`
text** this round (rep 1 and rep 3; see 5.1's corrected count — 3/6
combined this round) — e.g. rep 1: `Error: PROOF-08 injected crash:
simulated unhandled error in server process (utility, via entry wrapper)\n
at Timeout._onTimeout (...server-entry-crash.mjs:50:11)`. This is the same
exit code and survival outcome as the default, not a byte-for-byte stderr
comparison (not performed).

**B) in-process:** **`mainAliveAfterCrash: false` in all 3 reps** —
`electron exit: code=1`, post-crash process tree **empty** (root process
gone, all 4 processes including the window's own renderer/gpu/network
children terminated together — checked with the round-4 `CreationDate`-based
ppid-staleness guard in place, §6, which additionally verifies every
*descendant* a tree walk would otherwise admit, not just the root; a
name-only root check, as round-3's guard was, reduces but — per round-4
finding #7, corrected here from round-3's overstated "is not at risk" —
does not eliminate the risk of a reused pid misreporting a stale non-empty
tree, since it cannot distinguish our `electron.exe` from any other
`electron.exe` on the machine. The round-4 guard additionally requires
`CreatedMs >= notBeforeMs` (the caller's own recorded spawn time), which
**narrows** that residual risk to the specific remaining case of another
`electron.exe` — or a concurrent `proof-08` run — that happens to start
*after* our own spawn and lands on the recycled pid; it does not eliminate
the risk category outright).
Log confirms
the handler fired: `{"event":"main-uncaught-exception-handled","message":
"PROOF-08 injected crash...","stack":"Error: ...\n    at Timeout._onTimeout
(.../main-inprocess.mjs:137:13)\n..."}`. Real propagation time, computed from
`raw-results.json`'s own event timestamps (not estimated): crash fires at
t+3000ms as scheduled, the handler observes it 2–5ms later, and
`exitInfo.at` follows the handler by **108ms, 133ms, 112ms** across this
round's 3 reps.

**Round-3 correction (finding #4), reinforced by round-4 (minor finding
#5): stop publishing a numeric band at n=3 at all.** Round-2 published
"90–118ms" as a stable band; round-3 corrected that to an approximate
"~100–220ms" range after a reviewer's own reproduction (119/136/122ms) and
round-3's own measurement (224/108/195ms) both fell outside round-2's
stated band. **Round-4's own reviewer's reproduction (143ms/94ms/95ms) and
this round's fresh measurement (108ms/133ms/112ms) are two more
non-overlapping ranges** — five independent measurements now
(round-2: 90–118; a round-3 reviewer: 119/136/122; round-3's own battery:
224/108/195; a round-4 reviewer: 143/94/95; this round: 108/133/112), and
no two of the five agree on a band. Per round-4's required fix, this ADR
now states the **substantive finding only, with raw values and load
context, and no numeric band**: propagation from the handler observing the
crash to the process actually exiting is **on the order of 100ms**, never
anywhere near round-1's original ~1s estimate — confirmed a fifth time, on
this round's own fresh 108/133/112ms reps at 793 concurrent OS processes
(`Get-CimInstance Win32_Process | Measure-Object`, printed by `run.mjs`
itself, not estimated). The process is fully gone roughly 3.1–3.2s after
ready either way, not the ~12s figure below. The ~12.4–13.3s
`postCrashElapsedMs` reported per rep (this round: 12383ms, 12421ms,
13333ms) is when `run.mjs` *takes its post-crash snapshot* (crash at 3s +
the probe's own fixed settle wait before snapshotting, not "time for the
process to actually exit") — the snapshot simply finds an already-empty
tree, since the process exited ~9s earlier than the snapshot was taken.

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
| A, default | **yes** | **yes** | yes — `ECONNREFUSED` once child gone | `code=1` matches Node's documented default exactly; literal stderr text captured in this probe's own log **1/3 default reps** this round's battery (see §5.1 for the running denominator across all four rounds: 2/7, 6/6, now 1/3) | yes — child exits(1) in ~3.2s |
| A, matched | **yes** | **yes** | yes — `ECONNREFUSED` once child gone | same as default; literal stderr text captured **2/3 reps** this round's battery (§5.2) — **3/6 total across both A-arm configs this round** | yes — child exits(1) in ~3.2s |
| B, default | technically, but frozen | frozen (independently re-confirmed via committed `enum-windows.ps1`, §5's box — `windowExists` in the heartbeat itself is last-known-good, age-labeled, not trusted alone) | no — `TIMEOUT`, indistinguishable from "slow" | **yes — a modal dialog**, `class=#32770 title=Error`, reproduced from the committed probe (not stderr — confirmed empty; round-1 mischaracterized the dialog itself as absent) | **no — needs external kill** |
| B, matched | **no — whole process exits** | **no — dies with it** (post-crash tree empty, verified with round-4's `CreationDate`-based ppid-staleness guard, §6) | yes — connection refused once process is gone | yes — full stack trace to stderr, captured in log for all 3 reps | **yes — process exits(1)**, on the order of 100ms (five independent measurements across four rounds, no stable band — §5.2) after the handler runs, but takes the window with it |

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

**Round-2 bug — a `JSON.parse` failure on the round-1 probe (blocker).** A
rigorous review found that the committed round-1 probe **could not be run at
all** on this machine: `Get-CimInstance Win32_Process` piped through
`Select-Object ...,CommandLine | ConvertTo-Json -Compress` produced output
`JSON.parse` rejected, aborting the whole battery on the very first
snapshot (propagating past the round-1 retry, which only handled an *empty*
result, not a *thrown* one). Round-2 attributed this, as measured fact, to
Windows PowerShell 5.1's `ConvertTo-Json` failing to escape control
characters inside `CommandLine`.
>
> **Round-4 correction (major finding #2): that attributed mechanism is
> FALSIFIED.** A round-4 reviewer disproved it directly and this was
> independently reproduced for this round, on this same machine (PSVersion
> 5.1.22621.6133): feeding all 32 control characters 0x00–0x1F through
> `ConvertTo-Json -Compress`, via both a hashtable and a `PSCustomObject`,
> produces every one correctly escaped as `\u00xx` — zero raw control
> characters in the output, `JSON.parse` OK. The exact pre-fix command was
> also replayed five times under 797–813 concurrent processes on this
> machine: 5/5 `JSON.parse` OK, `rawCtrlChars=0` every time. **A
> `JSON.parse` failure WAS genuinely observed in round 2 — that is not in
> dispute — but its mechanism was never actually isolated; the
> control-character explanation was a plausible guess that turned out to be
> wrong**, and §9's forward-looking rule built on it (below) is downgraded
> accordingly. The base64 encoding this bug motivated is kept anyway, for
> the reason that turned out to be the real one: see the enum-windows.ps1
> finding two entries below, and `lib.mjs`'s own comment on
> `snapshotAllProcesses()`.
>
Reproduced (round-2, the original observation): `node
measure/windows/proof-08/run.mjs --reps 1 --crash-reps 0` on the pre-fix code
→ `SyntaxError: Bad control character in string literal in JSON` at
`lib.mjs:73`, 5/5 direct `processTree()` calls. **Fix (kept, re-justified in
round 4):** `CommandLine` is base64-encoded on the PowerShell side
(`[Convert]::ToBase64String(...)`) — base64 is pure ASCII by construction,
immune to a console output-encoding mismatch regardless of what actually
caused round-2's failure — and decoded in JS before role derivation;
`processTree()`'s retry loop now also catches
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
**reporting** of it: round-2's ADR text gave two counts of the same
quantity that did not reconcile — §5.1 said the text was "present in only 2
of 7 total A-arm crash reps" (implying 5 of 7 *not* captured), while §6
separately said the forwarding "did not fire in 4 of 7" — 4 and 5 are not
the same number for the same denominator, and exactly one was wrong.
Separately (a distinct, non-arithmetic defect, not a third conflicting
count): the comparison-table cell reported "0/4 A-arm reps", silently
mixing a 3-rep battery denominator with a 1-rep standalone
`crash-timeline.mjs` re-run into one undisclosed composite. Round-3's rule
going forward: **report only the current
battery's own `raw-results.json`, state the denominator's composition
explicitly, and never fold a standalone `crash-timeline.mjs` run into a
battery count** — applied throughout §5.1/§5.2/the comparison table above.
Flagged for Fase 5, unchanged: any real supervisor built on this ADR's
signal (§9, `child.on('exit', code)`) should not additionally depend on
literal stderr text from a forked `utilityProcess` being reliably captured.
**Round-4 addendum:** this round's own fresh battery captured the text in
3 of 6 A-arm crash reps (§5.1) — a *third* distinct count, reinforcing
rather than contradicting the "intermittent race, no stable fraction"
finding; the Fase-5 guidance above is unchanged by it.

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

**Round-3 bug — `crash-timeline.mjs`'s health-wait had no deadline (minor
finding #7).** `while (true) { const s = await httpStatus(); if (s === 200)
break; ... }` had no deadline, attempt counter or failure path — a port
collision or any `startServer` failure left the script (and an orphan
`electron.exe`) hanging forever, with no diagnostic. **Fix:** reuses
`lib.mjs`'s `waitForHttp200` (30s deadline); on timeout the child is killed,
captured stderr is printed, and the script exits non-zero naming the
approach, port and elapsed time. **Verified the failure path actually
executes** (not just code-reviewed) with a throwaway script (not committed)
that pre-occupies a fixed port so `main-inprocess.mjs`'s `startServer()`
fails with `EADDRINUSE` — a realistic "server never bound" case, not an
artificially-hung process: `waitForHttp200(PORT, {timeoutMs: 3000})` threw
`timeout waiting for HTTP 200 on /health at 127.0.0.1:25757` as expected;
the same `child.kill()` call `crash-timeline.mjs`'s catch block uses
terminated the Electron process cleanly (`child exited code=null
signal=SIGTERM`); and a `tasklist /FI "PID eq <pid>"` check 1.5s after the
kill confirmed **no orphan process survived** — the specific risk the
finding named ("an orphan electron.exe").

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

**Round-4 bug — the process-tree walker adopts unrelated OS processes via a
stale `ParentProcessId` (blocker finding #1).** Round-3's pid-reuse guard
(directly above) validated only the tree's **root** — every descendant was
admitted on `ParentProcessId` alone, unchecked. Windows does not clear a
process's recorded `ParentProcessId` when that parent dies, and recycles
pids aggressively under this machine's process churn, so an orphaned
process whose stale `ParentProcessId` happens to collide with one of our
live pids gets silently summed into "idle RSS, whole process tree." A
round-4 reviewer reproduced this against the round-3 battery's own
published command: `RiotClientServices.exe` (pid 18248, created a day
before the run, real parent long dead) got adopted into an Approach-A idle
tree because its stale `ParentProcessId` matched that run's Electron main
pid — corrupting one rep's idle-RSS reading by +64.5 MB (2 of 41 measured
trees affected, systematic scan) and collapsing the round-3 A-vs-B idle-RSS
delta into noise once included (delta 57.8 MB fell *inside* A's own
74.3 MB spread). The round-3 `chromiumRole()` helper compounded this: with
no `--type=` flag, it labeled the contaminating process `browser (main)` —
actively camouflaging a foreign process as an Electron one (finding #6,
below).
>
> **Fix — the canonical Windows ppid-staleness guard.** `snapshotAllProcesses()`
> now records each process's own `CreationDate` (converted to a Unix-ms
> integer PowerShell-side, since `ConvertTo-Json`'s native `/Date(...)/`
> wire format is awkward to parse reliably). A real parent-child
> relationship requires the parent to have been created at or before the
> child — a process cannot be spawned by one that does not yet exist. During
> the tree walk, any candidate child whose `CreatedMs` is strictly earlier
> than the node being walked into it from is refused (excluded from the
> tree, and — correctly — from further recursion under it) rather than
> summed into the total. A child with unknown `CreatedMs` (a handful of
> protected/system processes this account cannot query) is *not* refused on
> that basis alone — only a positive creation-time inversion counts as
> proof of staleness, so the guard only ever narrows what is admitted, never
> widens it past what round-3's guard already admitted.
>
> **Verified deterministically on this machine, not just probabilistically
> (waiting for contamination to recur).** A standalone scan of every live
> process on this machine (789 total) at the time this round's fixes landed
> found **2 processes whose recorded `ParentProcessId` points at a process
> created *after* them** — the exact stale/recycled-ppid signature this
> guard exists to catch (plus 17 more whose recorded parent has no live
> process at all, the milder case already caught by a plain "parent not
> found" check). One example: pid 21456 (`pwsh.exe`, created
> 2026-09-17T09:36:18.377Z) records `ParentProcessId=39212`, but pid 39212
> is currently `conhost.exe`, created 2026-09-17T10:07:35.112Z — over 31
> minutes **after** the `pwsh.exe` it supposedly parented. If either of
> these two processes ever ends up recorded as a child of one of our live
> pids, the new guard refuses it; round-3's guard would have admitted it
> silently, exactly as it admitted `RiotClientServices.exe` in the
> reviewer's reproduction.
>
> **Exercised against the shipped code directly, not just reasoned about.**
> Calling this round's actual exported `processTree(39212, {
> expectedRootName: "conhost.exe" })` from `lib.mjs` on this live machine —
> `conhost.exe` (pid 39212) *is* a real process with `pwsh.exe` (pid 21456)
> recorded as its child by `ParentProcessId` — returns a tree containing
> **only pid 39212**; pid 21456 is refused, exactly as the guard is
> designed to do. Before this round's fix, the same call would have
> returned both (round-3's guard only checked the root's name, and 39212 is
> genuinely named `conhost.exe`, so it would have passed). Separately, the
> guard's null-handling was unit-tested against its own predicate
> (`parentCreatedMs != null && nodeCreatedMs != null && nodeCreatedMs <
> parentCreatedMs`, copied verbatim from `lib.mjs`) across 6 cases — a
> stale child is refused, a normal child is admitted, and every
> null/tie combination is admitted (not refused on missing data alone,
> exactly as designed) — all 6 pass.
>
> The full §4/§5 battery was re-run from this fixed code (below); the round-3
> figures this finding invalidated (the 6.4/3.5 MB idle-RSS spreads and the
> "reproduces cleanly across all 8 reps" sentence) are **not** carried
> forward — §4 below is this round's fresh numbers only.

**Round-4 bug — `enum-windows.ps1` corrupts any non-ASCII window title on
this locale (major finding #3).** `enum-windows.ps1` put the raw
`GetWindowText`/`GetClassName` result straight into the emitted object,
piped through `ConvertTo-Json -Compress` with no encoding control on
stdout. `[Console]::OutputEncoding` on this machine is `ibm850`/cp850
(confirmed: `[Console]::OutputEncoding.WebName` → `"ibm850"`), not UTF-8,
while `lib.mjs`'s `execFile` call decodes stdout as UTF-8 — any non-ASCII
byte PowerShell wrote out was silently mis-decoded on the Node side.
Demonstrated live on this machine **without a synthetic input**: a real OS
window title, `"Alternância de Tarefas"` (Windows 11 pt-BR Task Switching,
owned by `explorer.exe`'s system tray host), came back through the pre-fix
pipe as `"Altern�ncia de Tarefas"` — captured directly from
`enum-windows.ps1`'s own pre-fix output on this run. `CommandLine` escaped
this only by accident (its base64 output is pure ASCII by construction —
see the round-2 entry above, now correctly re-attributed to this same
encoding-mismatch class of bug). This is squarely a "Windows assumption
that would fail on a machine with a different locale": §5's window evidence
below is read off window *titles* (`"title":"Error"`), and on a non-pt-BR
Windows install a localized Electron crash dialog title (`"Erro"`,
`"Fehler"`, `"Erreur"`) — or any accented title at all — would come back
mangled the same way.
>
> **Fix.** `enum-windows.ps1` now base64-encodes `Title`/`Class` exactly as
> `lib.mjs`'s `CommandLine` handling already did (`titleB64`/`classB64`),
> and `lib.mjs`'s `enumAllWindows()` decodes both before any caller sees
> them. **Verified through the real caller path, not a manual decode**:
> `lib.mjs`'s exported `windowsForPids([9508])` (the exact function
> `crash-timeline.mjs` calls every poll iteration) returns
> `"Alternância de Tarefas"`, `"100% concluído"` and `"Stingers –
> Explorador de Arquivos"` intact, every accent preserved, for the same
> live desktop windows.

**Round-5 disclosure — the base64 fix above closed the cp850 console pipe,
but a separate encoding leak in the same file, at the P/Invoke boundary
itself, was still open (major finding #2).** `GetClassName` in
`enum-windows.ps1`'s `Add-Type` block was declared with no `CharSet`, so
.NET's P/Invoke default (`CharSet.Ansi`) applied and the import bound to
`GetClassNameA`, not `GetClassNameW` — while this file's own header, the
§5 box above, and §6's finding-#3 citation itself all asserted three times
that this script calls `GetClassNameW`. `GetWindowText` right next to it
was already correctly declared `CharSet=CharSet.Auto` (→ `GetWindowTextW`
on this NT-based OS); `GetClassName` had no such declaration. This loss
happens marshaling the Win32 API result into this process, **before** the
base64 encoding above ever sees the string — so the finding-#3 fix
(immune console output encoding) cannot reach it; the two are different
defects in the same file. Proven with an identically-shaped pair (an
undeclared-`CharSet` `GetWindowText` import vs. the file's own correctly-
declared `CharSet=Auto` one, both called live against the same windows):
`ANSI-decl = "? DeckTech análise e otimização do Dokke"` vs.
`UNICODE-decl = "◑ DeckTech análise e otimização do Dokke"`. This is an
inference for `GetClassName` specifically, not a direct reproduction on
that exact function — Win32 class names are ASCII by convention in
practice (`#32770`, `Chrome_WidgetWin_1`, …), which is why no measurement
in this ADR was actually corrupted; the risk was latent, not realized.
**Fix.** `[DllImport("user32.dll", CharSet=CharSet.Unicode,
EntryPoint="GetClassNameW")]`, explicitly targeting the W entry point
rather than relying on `CharSet.Auto`'s OS-dependent resolution. Re-run of
`enum-windows.ps1` standalone still exits 0 and enumerates windows
normally; `#32770` and `Chrome_WidgetWin_1` (the classes §5's evidence
depends on, both ASCII) still come back intact, confirming the fix did not
regress the existing evidence.

**Round-4 bug — `crash-timeline.mjs` labeled each poll row with the
iteration-*start* time while the row's actual data was sampled up to ~2.5s
later (major finding #4).** `now = Date.now() - t0` was computed at the top
of each loop iteration, but the window-enumeration call
(`windowsForPids()`, the data §5's causal-timing claim rests on) ran *last*
in that same iteration, after `processTree()`'s up-to-3 retries and
`httpStatus()` — so a row's printed timestamp could be up to ~2.5s earlier
than the data in that row was actually sampled. A round-4 reviewer's
reproduction showed a row labeled `t+2502ms` already containing the crash
dialog (`{"title":"Error",...}`) for a crash that could not have fired
before ~t+3.3s — read literally, that row implies the dialog preceded the
crash. Separately disclosed (not a bug, a mislabeled budget): the loop
header `for (let elapsed = 0; elapsed <= 11000; elapsed += 300)` reads as an
11-second poll at a 300ms step, but the real run is 37 iterations at the
~1.5–2.8s actual per-iteration cadence (§5's box already disclosed the
*cadence*, round-3 finding #3) — a real wall-clock budget of roughly
55–95s, not 11s.
>
> **Fix.** Every probe in the loop (`processTree`, `httpStatus`, the
> heartbeat file read, `windowsForPids`) now stamps its own wall-clock time
> immediately before it runs, and that per-probe timestamp — not a single
> iteration-start label — is what gets printed next to that probe's data.
> The loop variable is renamed from `elapsed` (which claimed to *be*
> elapsed wall time) to a plain iteration index (`i`, out of a named
> `SAMPLE_COUNT`), with the real ~55–95s budget printed once at the start
> of the run instead of implied by a misleading step size.
>
> **Re-run post-fix** (`node measure/windows/proof-08/crash-timeline.mjs
> inprocess`, this round, fresh): health 200 at t+371ms; crash scheduled for
> ready+3000ms (internal main-process clock), which converts to
> approximately **t+3372ms** on the driver's own clock (computed from the
> main process's own `server-ready`/`crash-scheduled` log timestamps against
> the driver's `t0`, not estimated). ~~The window-enumeration sample at
> t+1495ms shows only the app's own window (class=Chrome_WidgetWin_1
> title=Electron); the next sample, at t+4358ms, shows the #32770 Error
> dialog already present. This round's honest claim, given the real
> sampling resolution: the dialog first appears between t+1495ms and
> t+4358ms — consistent with, and bounded around, the ~t+3372ms crash, not
> pinned to a false-precision single millisecond the way round-3's
> "t+3659ms onward" figure implied. §5's box below is corrected to this
> bounded claim.~~

**Round-5 bug — round-4's fix above was itself still a pre-call label, and
round-4's own comment asserting otherwise was false (blocker finding #1).**
Round-4 moved each probe's timestamp to `Date.now() - t0` taken
*immediately before* that probe's `await`, and `crash-timeline.mjs`'s
header comment claimed this timestamp "is when the window data below was
actually sampled, not when the iteration started" — but the call itself
(EnumWindows' `Add-Type` recompile plus retries) takes up to ~1s+, so a
pre-call label can still precede the true read by that much. A round-5
reviewer reproduced the exact impossible-ordering signature this defect
shape produces — on the "fixed" round-4 code: their clean run's row
`windows[sampled t+3038ms]` already contained the `#32770`/`Error` dialog
for a crash independently computed (from that run's own `server-ready` log
+ `PROOF08_CRASH_AFTER_MS`) to fire at t+3313ms — a label 275ms *before*
the crash it reports, the identical defect shape round-4 was rejected for.
The t+1495ms/t+4358ms figures struck through above have the same defect
and are retracted, not re-derived, for the same reason.

> **Fix.** Every probe now stamps BOTH a pre-call (`*PreMs`) and a
> post-return (`*PostMs`) timestamp, printed as `[read in (t+A ms,
> t+B ms]]`. A causal-timing claim across two rows now uses only the edge
> each row can actually prove: the pre-call time of the last dialog-absent
> sample (the true read cannot have happened before its own pre-call stamp)
> as the lower bound, and the post-return time of the first dialog-present
> sample (the call had returned, so the dialog already existed) as the
> upper bound. The post-return time of the *absent* sample is explicitly
> NOT used as a lower bound — that read could have completed anywhere in
> its own `(pre, post]` window, so its `post` proves nothing about when the
> dialog was still absent.
>
> **Re-run post-fix** (`node measure/windows/proof-08/crash-timeline.mjs
> inprocess`, this round, fresh): health 200 at **t+291ms**. `t0` is
> cross-derived from two independent heartbeat rows in this same run
> (`hb.t + hbAgeMs − hbPostMs`) and both agree: `t0 = 1789707326699` (abs
> Unix-ms). The crash fires at `server-ready`(1789707326965) +
> `crash-scheduled.afterMs`(3000) = 1789707329965 abs, i.e. **t+3266ms**
> relative to that `t0` — both figures read from this run's own log, not
> estimated. The last dialog-absent window sample is
> `windows[read in (t+2777ms, t+3519ms]]` (only the app's own window); the
> first dialog-present sample is `windows[read in (t+5080ms, t+6006ms]]`
> (the `#32770`/`Error` dialog now present). Per the fixed interval rule,
> the honest claim is **the dialog first appeared somewhere in
> (t+2777ms, t+6006ms]** — consistent with, and bounded around, the
> independently-computed t+3266ms crash. **Discriminating check:** the
> upper bound (6006ms) is ≥ the computed crash time (3266ms) and the lower
> bound (2777ms) is < it — no impossible ordering, unlike the pre-fix
> reproduction above. §5's box is corrected to this bounded claim.
>
> **Round-6 addendum.** This paragraph is left as written for the
> historical record of what round-5 claimed, but the run it describes
> (`t0=1789707326699`) was never captured to a committed artifact despite
> round-5's own text asserting it was — see §5's round-6 correction for
> the retraction and the archived runs
> (`crash-timeline-inprocess-run{1,2,3}.txt`, joined by `run4` in round 7)
> that replace it as this ADR's canonical evidence for the dialog-arrival
> interval.

**Round-4 bug — `chromiumRole()` labeled any process without a `--type=`
flag `"browser (main)"`, including non-Electron processes (minor finding
#6).** This is what let the contaminating process in finding #1's
reproduction print as `RiotClientServices.exe [browser (main)]
pid=18248` inside the tree — a reader scanning `fmtTree()` output for an
anomaly was actively told an unrelated third-party process *was* an
Electron browser process. **Fix:** `chromiumRole()` now takes the
process's own `name` and returns `"non-Electron (<name>)"` for anything
that is not `electron.exe`, regardless of its command line — a labeling
safety net alongside (not instead of) finding #1's `CreationDate` guard,
which is what actually keeps a stale-ppid process out of the tree in the
first place.

**Round-4 bug — the pid-reuse guard compared process *name* only, so it
cannot tell our `electron.exe` apart from any other `electron.exe` on the
machine (minor finding #7).** §5.2's original text claimed the B-matched
empty-tree reading "is not at risk of a reused pid misreporting a stale
non-empty tree" — overstated: any other Electron-based app, or a
concurrent `proof-08` run, recycling that exact pid onto its own
`electron.exe` would defeat a name-only check entirely. **Fix:**
`processTree()`/`isPidAlive()` now additionally accept a `notBeforeMs`
option — the caller's own `Date.now()` timestamp recorded just before it
spawned the process — and refuse a pid match whose `CreatedMs` predates
that spawn, regardless of name. `run.mjs` and `crash-timeline.mjs` now pass
their own recorded spawn timestamp at every call site. §5.2's "is not at
risk" language is corrected below to state the residual risk accurately
rather than deny it.

**Round-4 correction — two source-comment line citations disagreed with
the ADR (minor finding #8).** `run.mjs`'s comment on the discovery-bind
check cited server.js's reply-log line (210) instead of its bind-error
handler (212); `lib.mjs`'s comment on the same check gave `startDiscovery`'s
span as `server.js:202-212` where the function is actually `202-215`.
Verified directly against `server.js` for this round (`grep -n
"startDiscovery|\[discover\]|^}" server.js`): the function opens at line
202 and closes at line 215; the reply log is line 210; the bind-error
handler — what the comment is actually about — is line 212. This ADR's own
citations (§4.1, §9) already had it right; only the two source comments
were corrected to match.

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
round-2, round-3 and round-4 corrections change *why* and *how precisely*,
not *which*. The measured ~59 MB saving from hosting in-process (§4: 58.8 MB
median this round, from a battery verified free of the process-tree
contamination that invalidated round-3's own 56.3 MB figure — see §6,
blocker finding #1; 57.3 MB round-2, uncontaminated but from an earlier
round-2 pid-reuse-guard-free codebase — all real measurements of their own
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
   over a shared warm cache; the order-alternated remeasurement puts the
   median delta consistently *inside* arm A's own within-apparatus spread
   every round it has been checked — round-3: 183 ms inside 526 ms;
   round-2: 196 ms inside 476 ms/304 ms; **this round: 75 ms inside 197 ms**
   — not a reproducible directional claim at n=8 in any of the three, on
   freshly re-measured numbers each time. Cold start plays **no role** in
   this decision; reasons (1) and (2) carry it on their own, which they
   already did in round-1 (round-1's own text called reason (1) alone
   "disqualifying").

**Round-3 addition: does the discovery-bind asymmetry (§4.1) change this?
No — stated plainly, not left implicit.** §4.1 disclosed that Approach A's
idle cell additionally attempts a UDP bind on port 3001 (machine-state
dependent whether it succeeds) that Approach B's idle cell never attempts.
This does not change the decision for two independent reasons: **(a)** the
58.8 MB delta this ADR's decision rests on is driven by the forked server
process existing as a fifth OS process at all — its own ~70 MB working set
— not by whether that process's UDP socket happened to bind; a failed
`dgram.bind()` costs bytes to low-KB, invisible at this measurement's
resolution, so even a maximally unfavorable reading (A's socket always
fails, always costing nothing; B never attempts one) leaves the 58.8 MB
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
- **Round-2 addition, downgraded in round-4 (§6, major finding #2 — the
  mechanism, not the recommendation, was wrong).** A Windows process-tree/
  command-line probe should still avoid round-tripping free-form text
  through Windows PowerShell 5.1's `ConvertTo-Json` and Node's UTF-8 stdout
  decoding — base64-encode it on the PowerShell side first (§6) — but this
  is a **defensive recommendation about console output encoding**, not the
  control-character-escaping bug round-2 originally attributed it to
  (disproved directly: PS 5.1's `ConvertTo-Json` correctly escapes every
  control character 0x00–0x1F on this machine, 5/5 clean runs). The actual
  failure mode this recurs as: `[Console]::OutputEncoding` on a Windows box
  can be a non-UTF-8 code page (cp850/`ibm850` on this machine) while Node
  decodes `execFile` stdout as UTF-8 — any non-ASCII text PowerShell writes
  (an accented window title, a non-ASCII path in a command line) gets
  silently mis-decoded. Base64 sidesteps this regardless of code page,
  which is the actual reason to keep using it (§6, round-4 `enum-windows.ps1`
  finding).
- **Round-3 addition:** a Windows process-tree probe (or any pid-liveness
  check) must never trust a bare pid match — verify the process **name**
  too, or a recycled pid under real concurrent load reports an unrelated
  process as "our process, still alive" (§6). This applies directly to
  `SHELL-02`'s health-event design: if Fase 5 ever polls process state by
  pid (rather than relying purely on `child.on('exit', code)`, which does
  not have this failure mode), it needs the same name check.
- **Round-4 addition, supersedes/extends the round-3 name check above (§6,
  blocker finding #1 and minor finding #7).** A name check on the root pid
  alone is not enough: (a) Windows does not clear a process's recorded
  `ParentProcessId` when the real parent dies, so a full **process-tree
  walk** (not just a single pid-liveness check) must validate every
  descendant's own `CreationDate` against the node it claims as parent —
  a child created *before* its claimed parent is a stale/recycled ppid, not
  a real descendant, and must be excluded, not summed into a total; and
  (b) a name-only check cannot distinguish our own process from another
  instance of the same executable (another Electron app, a concurrent run
  of the same tool) recycling the same pid — compare `CreationDate` against
  the caller's own recorded spawn timestamp too. Any future Fase-5 tooling
  that walks a process tree by `ParentProcessId` (not just checks one pid)
  needs both checks, not just the name check round-3 added.
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

# Round-4 additions:
node measure/windows/proof-08/crash-timeline.mjs inprocess   # re-timestamped per-probe sampling (§6, finding #4) — every probe's own sample time is now printed, not one iteration-start label
powershell.exe -NoProfile -NonInteractive -File measure/windows/proof-08/enum-windows.ps1  # standalone: prints raw titleB64/classB64 JSON — does NOT decode (round-5 finding #3: this line alone cannot confirm the accented round-trip)

# Round-5 additions:
node measure/windows/proof-08/decode-windows.mjs   # ACTUALLY decodes titleB64/classB64 via lib.mjs's real enumAllWindows() (the same decode path windowsForPids()/crash-timeline.mjs use) and confirms an accented window title round-trips intact — closes §6 finding #3: the round-4 line above prints undecoded base64 and confirms nothing by itself. Prints every window plus a non-ASCII title/class count (honestly 0 if none are open right now).
node measure/windows/proof-08/crash-timeline.mjs inprocess   # re-run needed after both round-5 fixes (interval timestamps, finding #1; GetClassNameW charset, finding #2) — §5's box and §6's finding-#4/#1 entries are re-derived from this exact re-run, not carried over

# Round-6 additions:
node measure/windows/proof-08/crash-timeline.mjs inprocess 2>&1 | tee measure/windows/proof-08/crash-timeline-inprocess-run1.txt   # captures raw stdout to a committed .txt (NOT .log — the repo root .gitignore's blanket `*.log` rule would silently drop it; see .gitignore:3) — repeated 3x this round for run1/run2/run3, closing round-6 blocker finding #1 (the round-5 "Re-run post-fix" run was never actually archived despite the prose claiming it was)
powershell.exe -NoProfile -NonInteractive -File measure/windows/proof-08/enum-windows.ps1   # standalone: CharSet=Unicode/GetWindowTextW fix applied to GetWindowText this round (round-6's minor finding, matching GetClassName's round-5 major-finding-#2 fix) so accented/non-ASCII titles decode correctly instead of mangling under the platform-default ANSI marshal
node measure/windows/proof-08/decode-windows.mjs   # post-CharSet-fix verification re-run; output archived at measure/windows/proof-08/decode-windows-round6.txt

# Round-7 additions:
node measure/windows/proof-08/crash-timeline.mjs inprocess 2>&1 | tee measure/windows/proof-08/crash-timeline-inprocess-run4.txt   # same capture method as run1-3; landed the dialog in iteration 2 on the first attempt (round-7 major finding #2 — closes the round-6 gap where an iteration-2-aligned run was only ever cited in prose, never archived), added to §5's cross-alignment table as run4
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
default `"electron.exe"`) landed before the round-3 §4/§5 battery ran.

**Ppid-staleness guard (round-4, §6, blocker finding #1 and minor finding
#7).** Round-3's guard above was root-only; round-4 added a `CreationDate`-
based check for every node in the tree walk (a child created before its
claimed parent is refused) plus a `notBeforeMs` check on the root (refuses
a pid whose own creation predates the caller's recorded spawn time — closes
the "another `electron.exe` on the machine" gap round-3's name-only check
left open). **Verified deterministically, not just by waiting for
contamination to recur**: a standalone scan of this machine's 789 live
processes at fix time found 2 with the exact stale/recycled-`ParentProcessId`
signature the guard exists to catch (one example: `pwsh.exe` pid 21456,
created 2026-09-17T09:36:18Z, records parent pid 39212 — which is currently
`conhost.exe`, created over 31 minutes *later*). The fix landed before this
round's §4/§5 battery ran; that battery's own 28 measured trees were
additionally scanned directly for any `non-Electron (...)`-labeled entry
(the round-4 visible safety net, finding #6) and found clean.

All probes are self-contained: genuinely isolated `%APPDATA%`/`userData` per
run (verified above, not just claimed), unique ports per rep, and a hard
watchdog kill so a hung run (expected for Approach B's default-handler crash
reps, by design — see §5.1) cannot leave the terminal blocked.
