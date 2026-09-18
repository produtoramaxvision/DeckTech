# ADR-0003: Binary `.lnk` parsing in Node vs COM (`WScript.Shell`)

- Status: Accepted (revised after round-2 AND round-3 review — see "Round-3
  revision" below, then "Round-2 revision")
- Date: 2026-09-17
- Requirement: PROOF-03 (`.maxvision/REQUIREMENTS.md` Fase 0), gates PLAT-10
- Supersedes: nothing. First measurement of unvalidated assumption U5
  (`.maxvision/research/SUMMARY.md:646`).

## Round-3 revision (this document)

A rigorous reviewer rejected the round-2 version of this ADR and the
benchmark behind it. Eight findings, one blocker, two major. All eight are
fixed; every number below is from a re-run executed after the fix, not
carried over from round 2. What changed, in order of severity:

1. **[blocker, fixed]** The round-2 ADR's "cold" speedup (10.2x, claimed
   range 9.5x–10.2x) does not reproduce on a genuinely first-touch run. The
   reviewer ran the benchmark twice: on the FIRST run this session (nothing
   had touched the 182 `.lnk` files beforehand — a real cold cache), COM
   loop-only measured 310.2 ms and Node measured 140.72 ms, a 2.2x speedup.
   On the immediately following run (cache now warm from the first), COM
   measured 420.4 ms and Node measured 33.74 ms, a 12.5x speedup — Node's
   number moved 4.2x faster while COM's moved 1.35x in the OPPOSITE
   direction. Both iteration-0s are fresh Node processes (V8/JIT state
   controlled for), so the OS file cache is the only variable that explains
   a swing that size. The root cause is structural, stated plainly in the
   script's own header (this document's round-2 text, quoted by the
   reviewer): iteration 0 runs the Node parser FIRST, so Node absorbs every
   file's first-touch disk read, and COM then reads a cache Node just
   warmed — biased against COM, not a fair comparison, which is why a
   "cold" ratio derived from it can land anywhere from 2.2x to 12.5x
   depending on how warm the cache already was before the run started.
   **Fixed by taking the reviewer's option (b):** the speedup ratio is no
   longer computed or printed for iteration 0 at all — not in the console,
   not in the JSON (`thisRun.cold` / `speedupComLoopOverNode` is gone,
   replaced by `thisRun.iteration0` with comLoopOnlyMs/comWallMs/
   nodeParserMs only, no ratio field). The console header and the JSON
   `note` field both now state the mechanism explicitly: "NOT a fair
   cold-vs-warm comparison ... Node absorbs every file's first-touch disk
   read and COM then reads a cache Node just warmed." The WARM claim is
   untouched by this fix and still stands — it reproduced against the
   reviewer's own measurements (see "Measured result" below).
2. **[major, fixed]** `scanForUwpMarkers` swallowed every file-read error
   with a bare `catch { continue; }` while the console and this ADR still
   printed the hit count over a `/182` denominator — an unreadable file
   would be invisible and the denominator would be a lie, the same defect
   class round-2 major finding 5 fixed in `walkLnkFiles` but left
   unfixed in this sibling function. `scanForUwpMarkers` now records every
   read failure into `unreadable`/`unreadableRows` (path + error code +
   message), returns `scanned` (files ACTUALLY read, i.e. `files.length -
   unreadable`), and the console prints hit counts against `scanned`, not
   `files.length`, plus an explicit `WARNING` line when `unreadable > 0` —
   the same treatment `dirErrors` already gets. This run: `unreadable: 0`,
   `scanned: 182` (see "UWP/Store shell-item marker scan" below) — now
   something the report can state because it was actually checked, not
   assumed from an unconditional denominator.
3. **[major, addressed by deletion]** This ADR previously stated as flat
   fact that "warming does not make COM consistently faster than its cold
   figure" (round-2 text: 273.1 ms warm vs. 260.6 ms cold), using it to
   retire round 1's file-cache explanation. That rested on a single
   two-point comparison whose SIGN FLIPS between the reviewer's two re-runs
   — cold 310.2 ms / warm median 441.8 ms (cold faster, same direction as
   round 2's claim) on the first re-run, then cold 420.4 ms / warm median
   321.8 ms (cold SLOWER, opposite direction) on the second. A directional
   claim that flips between two consecutive runs is not a measured
   conclusion at n=1 (or n=2). The sentence is deleted outright rather than
   softened: neither "warming helps COM" nor "warming doesn't help COM" is
   supported by this benchmark, and this document no longer asserts either.
   The corrected fact, kept: COM's own loop-only time varies substantially
   run to run — the reviewer measured a ~40% swing within a single warm
   run, and the cold-vs-warm ORDERING itself is not stable across runs —
   which is itself the reason this document does not derive a causal claim
   from it, in either direction.
4. **[minor, fixed]** The ANSI half of the round-2 blocker-1 fix (env-
   expanded-ansi ranked ahead of env-raw-ansi) was untested — every env-var
   test built its buffer via `buildEnvBlock`, which always populates
   `targetUnicode`, so `lnk-parser.mjs`'s `if (envBlock.targetUnicode)`
   branch always won and the ANSI `else if` branch (previously lines
   486–487) never executed in the suite. A new test
   (`test/windows-lnk-parser.test.mjs`) builds a full-size (`0x314`)
   `EnvironmentVariableDataBlock` whose Unicode field is left all-`NUL`
   (so `readNulTerminatedUtf16` returns `''`, which is falsy, forcing the
   ANSI branch) and asserts `candidates[0].source === 'env-expanded-ansi'`
   with the expanded value. Verified the same way round 2's own mutation
   test was verified: the two `push()` calls at lines 486–487 were swapped,
   the suite re-run, and exactly this one new test failed (see "Verifying
   the round-3 ANSI fix" below); the swap was then reverted and the full
   suite re-confirmed green.
5. **[minor, fixed]** The benchmark exited 0 on the two conditions it
   itself printed as `WARNING`/"investigate": a non-empty `dirErrors`
   (scanned set under-counted) and `unexpectedParserEmptyGapCount > 0` (a
   parser-empty row with no accepted-gap explanation) did not move
   `process.exitCode`, which stayed 1 only for mismatches and secondary-
   only matches — a half-fix of round-2 finding 5, since re-running the
   script (this ADR's own "Reproducing this measurement" instructions) used
   exit code as the pass signal without those two conditions actually
   gating it. Fixed: exit code is now decided once, after every `RESULT`
   branch prints, from `mismatches.length > 0 || secondaryOnlyMatches.length
   > 0 || dirErrors.length > 0 || unexpectedParserEmptyGapCount > 0`.
   `idListOnlyGapCount` (the accepted, honestly-scoped 8/182 coverage gap)
   is deliberately NOT one of these conditions — gating on it would make
   exit 1 the permanent normal state for a clean run on this machine's own
   shortcut set, not a signal that something regressed.
6. **[minor, fixed]** `realpathOrNull` collapsed every failure mode into
   `null`, making a genuine `EACCES`/`EPERM` on a real target
   indistinguishable from "the path does not exist" in the realpath
   comparison tier. No live impact on this machine (the realpath tier count
   is 0 in every committed run), but on a machine where a target sits
   behind a permission boundary this would silently downgrade a resolvable
   comparison to "mismatch" with no signal as to why. Fixed:
   `realpathOrNull` now returns `{value, errorCode}`, returning `null`
   silently only for `ENOENT`/`ENOTDIR` and recording every other code.
   `compareTiered` accumulates every non-null `errorCode` it encounters
   into a `realpathErrors` array on its return value (the existing tests
   only asserted `.tier`/`.matchedVia`/`.secondaryMatchTier`, so this
   additive field is not a breaking change), the benchmark attaches it to
   the row (`row.realpathErrors`, `null` when empty) and prints an
   aggregate `WARNING` when any row hit one. This run: 0 realpath errors
   (see `proof-03-results.json`'s top-level `realpathErrors: []`).
7. **[minor, fixed]** `category.idListOnly` (`HasLinkTargetIDList &&
   !HasLinkInfo`) did not account for `ForceNoLinkInfo`, so a shortcut
   whose `LinkInfo` is present but spec-mandated-ignored, with no env
   block, would produce zero candidates while still reading `idListOnly:
   false` — landing in `unexpectedParserEmptyGapCount` (an "investigate"
   bucket) instead of the accepted coverage gap, even though the parser's
   behavior (abstain, don't guess) is identical to the true IDList-only
   case. Not hypothetical on this machine: `forceNoLinkInfoCount` is 38,
   it just happens that all 38 carry an env block supplying a candidate —
   remove the env block from any one of them and the round-2 classification
   would have been wrong. **Fixed by introducing a separate category field
   rather than redefining `idListOnly`** (the reviewer's second suggested
   option): `category.noUsablePathSource` is now derived directly from
   `candidates.length === 0` (qualified by `HasLinkTargetIDList`) — the
   SAME array the candidate builder produces — so it cannot drift from what
   the parser actually resolved, by construction, not by keeping two
   predicates in sync by hand. The benchmark's gap classification
   (`idListOnlyGapCount`/`unexpectedParserEmptyGapCount`) now filters on
   `category.noUsablePathSource`, not `category.idListOnly`.
   `category.idListOnly` itself is kept, unchanged, as the narrower
   structural predicate this document's shortcut list and category table
   already name it by. A new synthetic test builds the exact drift shape
   (`HasLinkTargetIDList` + `HasLinkInfo` + `ForceNoLinkInfo` + no env
   block) and asserts `category.idListOnly === false` while
   `category.noUsablePathSource === true`. On this machine's real data the
   two fields are identical (12 and 12 — see "Category coverage" below):
   this is a classification-robustness fix, not a finding that this
   machine's numbers were wrong.
8. **[minor, no code change — process fix]** Commit `1fa06ae` (a round-2
   fix commit) used a bare `git commit -m` with no pathspec, which swept in
   a concurrent session's already-staged deletion of a file outside the
   PROOF-03 set (`measure/windows/proof-02/out/raw-startapps.json`), and
   the commit message did not mention it. The deletion itself was
   substantively defensible (machine-specific data a concurrent session's
   `.gitignore` rule excludes) but undisclosed in the message. Nothing to
   revert — the fix is procedural: this round's commit stages the PROOF-03
   paths explicitly (`git commit -- <paths>`, never a bare `-m` against the
   shared index), since concurrent sessions are known to be writing to this
   working tree.

## Round-2 revision

A rigorous reviewer rejected the round-1 version of this ADR and the
benchmark behind it. Ten findings, two of them blockers. All ten are fixed;
every number below is from a re-run executed after the fix, not carried
over from round 1. What changed, in order of severity:

1. **[blocker, fixed]** The benchmark's comparator scanned the parser's
   *entire* candidate list for a match and reported "exact" if ANY
   candidate matched — not the candidate the parser actually resolves a
   shortcut to (`candidates[0]`/`resolvedTargetPath`). Combined with a
   priority bug in `lnk-parser.mjs` that ranked the raw, unexpanded
   `%VAR%` string ahead of the expanded path for environment-variable
   shortcuts, this made the round-1 headline ("170 exact, 0 mismatches")
   identical to what a benchmark with the resolution feature deleted would
   print — verified by the reviewer with a literal mutation test. Fixed in
   two parts, both required: (a) `lnk-parser.mjs` now ranks
   `env-expanded`/`env-expanded-ansi` ahead of `env-raw`/`env-raw-ansi`, so
   `resolvedTargetPath` is the expanded, usable path; (b) `compareTiered()`
   in the benchmark now checks the PRIMARY candidate first, and demotes a
   match found only elsewhere in the list to a new, separately-counted tier
   (`matched-only-via-secondary-candidate`) instead of folding it into
   `exact`. A guard against this exact defect class is now committed as an
   automated test (`test/windows-lnk-parser.test.mjs`) plus a runtime
   invariant assertion in the benchmark itself
   (`resolvedTargetPath === candidates[0].value`, or it throws). The
   reviewer's own mutation (`resolvedTargetPath = null`) was re-run against
   the fixed suite: it now fails loudly (see "Verifying the fix" below).
2. **[blocker, fixed]** Timing was a single unrepeated run with no warmup,
   and the ADR's own headline COM figure (267.9 ms) did not reproduce
   across the reviewer's four re-runs (237.0–255.2 ms, all below the
   claimed figure). The benchmark now runs one discarded warmup iteration
   followed by 5 timed iterations, reports median/min/max/stddev for the
   Node parser, COM loop-only, and the derived speedup, and persists every
   raw iteration in `proof-03-results.json`. The original cold-cache
   ordering (Node parser before COM) is kept for iteration 0, reported
   separately as "cold, n=1" — it is explicitly NOT averaged into the warm
   statistics, and the two are never compared to each other as if they
   were the same measurement.
3. **[major, fixed]** The round-1 ADR asserted "174-of-178 shortcuts" in
   two places while its own table, two lines above, said 170. 174 matched
   no quantity the benchmark actually produces (170 exact + 8 gap = 178,
   not 174). This revision uses only measured quantities, no arithmetic
   reconstruction.
4. **[major, fixed]** `parseLnk` abandoned its own `{valid:false,
   rejectReason}` contract after the header check and threw an unqualified
   `RangeError` on a truncated or corrupt `.lnk`, which the benchmark then
   mislabeled as an I/O ("read error") rather than a parse failure. Every
   multi-byte read past the header is now bounds-checked (`need()` /
   `LnkBoundsError` in `lnk-parser.mjs`) and returns a structured
   `{valid:false, rejectReason}` naming the structure and offset. The
   benchmark now runs `readFileSync` and `parseLnk` in separate `try`
   blocks with separate, distinctly-named census buckets (`ioError` /
   `invalidFile` / `parserException`). Covered by three new unit tests
   using synthetically truncated/corrupted buffers (not a machine-specific
   file), including the reviewer's own repro shape (`IDListSize` claiming
   far more bytes than the file has).
5. **[major, fixed]** `walkLnkFiles` swallowed every `readdir` error —
   including `EACCES`/`EPERM`, not just `ENOENT` — as "directory absent",
   so a permission-denied subtree would have silently shrunk the scanned
   set while the console still printed a confident file count. It now
   distinguishes `ENOENT` (genuinely swallowed, comment now accurate) from
   any other error code (recorded into `dirErrors`, printed as a `WARNING`
   line, and included in the JSON report). This run: `dirErrors: []` (see
   "Measured result" below) — zero warnings, all 182 files enumerated
   cleanly on this machine, now something the report can actually state
   instead of assume.
6. **[major, addressed, not "fixed" — see below]** The round-1 ADR asserted
   a specific, invented reading of the 149-vs-182 discrepancy between the
   original research baseline and this measurement's 182-file
   enumeration, presented as established fact. This revision does not
   repeat that reconstruction — see "The 149-vs-182 denominator: still
   unreconciled" below.
7. **[minor, fixed]** The console printed the IDList-only census count
   immediately followed by an unconditional note explaining why a *zero*
   count there is expected — even in the actual run, where the count is
   12, not zero. The note is now conditional on the count, and the
   UWP/Store-marker claim ("zero `AppsFolder`/`!App` hits") is now backed
   by a real, reproducible scan committed to the benchmark script
   (`scanForUwpMarkers`) instead of being asserted in prose with no
   artifact behind it (see finding 6 below in the original review, and
   "UWP/Store shell-item marker scan" below).
8. **[minor, fixed]** `idListOnlyGapCount` was assigned from the
   `'parser-empty'` tier without checking *why* a row landed there — any
   future non-IDList-only cause would have been silently absorbed into a
   gap count the ADR already blessed as "expected." It is now derived by
   filtering rows on `comparisonTier === 'parser-empty' && category.
  idListOnly`, with any `parser-empty` row that is NOT `idListOnly`
   counted and printed separately as `unexpectedParserEmptyGapCount`
   (measured: 0, see below).
9. **[minor, fixed]** The committed report recorded no `LinkFlags`, so the
   ADR's claim that "none tripped `ForceNoLinkInfo`" could not be verified
   by a re-run. Every row now carries the full parsed `flags` object, and
   the report/console carry an explicit `ForceNoLinkInfo`-tripped counter
   — measured this run: **38** (see below; the round-1 claim of zero was
   also wrong on the actual data, not just unverifiable).
10. **[minor, fixed]** `expandEnvVars` rebuilt a case-folded map of the
    entire process environment on every call, inside the loop being timed.
    It is now a lazily-initialized, per-process singleton.
    `blockSignaturesSeen` (computed, then discarded) is now returned as
    `extraDataBlockSignatures` and persisted per row instead of being dead
    code.

## Context

`.maxvision/research/WINDOWS-STACK.md` measured resolving 149 `.lnk` shortcuts
to their target `.exe` via COM (`WScript.Shell.CreateShortcut(path).TargetPath`)
at 2395 ms total, ~16 ms/shortcut, and flagged reading the `.lnk` binary
format directly in Node as a plausible but explicitly unvalidated
optimization (U5): "Vale ler `.lnk` binário direto em Node (sem COM) para
matar os 16 ms/atalho. Não validei essa otimização."

A binary reader is only worth shipping if it produces the **same** target
list as COM. A parser that is faster and silently wrong on even a few
shortcuts is a regression, not an optimization — a user whose shortcut
resolves to the wrong `.exe`, or to nothing, notices immediately.

## What was built

- `measure/windows/lnk-parser.mjs` — a pure-Node, zero-dependency reader of
  the [MS-SHLLINK] binary format (ShellLinkHeader, LinkFlags, LinkInfo,
  CommonNetworkRelativeLink, StringData, and the EnvironmentVariableDataBlock
  extra-data block), built directly from the Microsoft Open Specifications
  pages (fetched 2026-09-17, protocol revision 10.0, not from memory/recall).
  Every read past the fixed header is now bounds-checked (round-2 fix 4).
- `measure/windows/lnk-com-resolve.ps1` — the COM baseline resolver, using
  the same `WScript.Shell` mechanism as the original measurement, with one
  COM object reused across the loop and an internal `Stopwatch` around the
  resolution loop only (comparable, per-item, to the 2395 ms/149 baseline).
- `measure/windows/proof-03-lnk-benchmark.mjs` — orchestrates both, runs a
  cold pass plus 5 warm timed passes, does a tiered (exact →
  case-insensitive → `fs.realpathSync.native` filesystem identity)
  item-by-item comparison against the parser's PRIMARY output, and
  prints/records the result.

## Measured result (this machine, 2026-09-17, re-run after all round-3 fixes)

Scope: every `.lnk` under `%ProgramData%\Microsoft\Windows\Start Menu\Programs`
and `%APPDATA%\Microsoft\Windows\Start Menu\Programs` (machine + user),
**182 files**. Directory enumeration: `dirErrors: []` — zero permission or
other non-`ENOENT` errors this run, all subtrees read cleanly.

Command run: `node measure/windows/proof-03-lnk-benchmark.mjs`. Verbatim
timing block from that run (exit code 0):

```
--- Timing: iteration 0 (n=1, first pass; NOT a fair cold-vs-warm comparison -- see note below) ---
COM loop-only (iteration 0): 182 shortcuts, 449.9 ms total, 2.47 ms/shortcut
COM wall incl. PowerShell startup + COM instantiation (iteration 0): 908.2 ms total
Node binary parser (iteration 0): 182 shortcuts, 54.61 ms total, 0.3000 ms/shortcut
NOTE: no speedup ratio is printed for iteration 0. The Node parser runs BEFORE COM in this iteration, so Node absorbs every file's first-touch disk read and COM then reads a cache Node just warmed -- structurally biased toward Node, not a like-for-like comparison. A genuinely first-touch run on this machine produced speedups ranging 2.2x-12.5x across two attempts, moving in opposite directions for Node vs COM between runs. Only the warm figures below (n=5, cache already stable) are used as a speedup claim. See docs/adr/0003, round-3 fix 1.

--- Timing: warm (n=5, after 1 discarded warmup iteration -- warmup changes the profile, do not compare a cold number against a warm one) ---
Node parser: median 20.69 ms, min 18.88, max 24.25, stddev 1.94 -- raw: [21.58, 24.25, 18.88, 20.69, 19.18]
COM loop-only: median 310.2 ms, min 281.1, max 395.8, stddev 41.3 -- raw: [395.8, 281.1, 310.2, 285.6, 316.1]
Speedup (median of per-iteration COM/Node ratios): median 16.4x, min 11.6x, max 18.3x
Node parser warm median, per-shortcut: 0.1137 ms/shortcut
```

Reading this honestly: **no speedup figure is claimed for iteration 0.**
Round-3 blocker 1 found that number is an artifact of which method happens
to run first in a given iteration, not a property of either method — a
genuinely first-touch run on this machine (nothing had touched the 182
files beforehand) produced a 2.2x speedup, and the immediately following
run (cache now warm) produced 12.5x, with COM's own loop-only time moving
in the OPPOSITE direction between those two runs from Node's. The
previously-claimed "10.2x cold" and "9.5x–10.2x cold range" are deleted
from this document, not merely softened — they do not describe a stable
property of the two methods being compared.

The **warm** claim is the one this document stands behind, stated as a span
across the four independent n=5 measurements that exist, not as any single
run's min/max: **the warm-median speedup clusters in the 12.3x–17.0x
range** across round 2's committed run (median 13.8x), the round-3
reviewer's own two re-runs (medians 17.0x and 12.3x), and this round's
committed run (median 16.4x). At the level of individual iterations
(not medians), the observed spread across all four runs' 20 total warm
iterations is wider — as low as 9.8x (reviewer's second re-run) and as high
as 18.5x (round 2's committed run) — reported here as an OBSERVED spread of
individual data points, not as a claimed range the way the deleted cold
figure was: this run's own 5 iterations landed 11.6x–18.3x, which is a
proper subset of that wider spread, not the whole of it. Do not quote this
run's min/max as if it bounded the phenomenon; four separate n=5 samples
already show it does not (round 2's own min, 12.1x, sits BELOW this run's
median, and its own max, 18.5x, sits above this run's max). The honest
claim is the four-median cluster above, roughly consistent to within a
factor of 1.4 (12.3x to 17.0x), not a reproducible two-significant-figure
constant — the same honest framing round 2 used for the (now-deleted) cold
claim, applied here to the quantity (a span of medians across runs) that
this benchmark actually supports making a claim about.

COM's own loop-only time varies substantially run to run and within a
single warm run — 281.1–395.8 ms this run's 5 warm iterations, a ~40% swing
the reviewer independently confirmed on their own re-runs, on a machine
with other software running concurrently (Blender, Adobe Creative Cloud
apps, etc. — see the process list implied by
`.maxvision/research/WINDOWS-STACK.md`). **This document does NOT assert
whether warming makes COM faster, slower, or has no effect.** Round 2's
version of this section claimed warming did not help COM, from a single
two-point comparison; round-3 blocker 3 found that comparison's direction
flips between the reviewer's own two re-runs (cold faster on one, cold
slower on the other), so neither direction is a measured conclusion at the
sample size this benchmark provides. What the data DOES support, stated
without a directional claim: COM's variance is large enough, and unstable
enough in sign across runs, that this benchmark cannot isolate its cause
(file-cache state, PowerShell/COM instantiation jitter, background system
load, or some combination) — and no figure in this document depends on
having isolated it.

Full per-shortcut data, all raw timing iterations, and the full flags
object per row: `measure/windows/proof-03-results.json` (regenerated by
re-running the benchmark script).

### The 149-vs-182 denominator: still unreconciled

`.maxvision/research/WINDOWS-STACK.md:51` reads "**149 resolvidos** em 2395
ms"; `:235-236` repeats "2395 ms para 149". Taken literally, "149
resolvidos" (149 *resolved*) reads at least as naturally as "149 of some
larger enumerated set succeeded" as it does "a pre-filtered input set of
149". This document enumerates 182 `.lnk` files and gets a non-empty
`TargetPath` from COM for 178 of them — neither 149 nor obviously "182 minus
a stated filter."

This ADR does not attempt to reconstruct which reading is correct. A
sibling investigation already tried and explicitly failed to close this gap
under the same conditions: `docs/adr/PROOF-04-uninstaller-exclusion-rule.md`
§6 measured 178-of-182 resolved on this same machine, on the same day, via
a *different* script (`measure/windows/scan-apps.mjs`), and states plainly
that the original 149-producing script "was not preserved in the repo... a
session-scoped scratchpad path this session cannot read," so "the exact
cause cannot be confirmed by re-running it side by side." That conclusion
holds here too, for the same reason: there is nothing in this repository to
re-run against 2395/149 to settle whether it is a filtered subset or a
different success count on a differently-scoped or differently-measured
pass.

**Every figure in this document that divides by 149 is therefore explicitly
flagged as resting on an unreconciled denominator, not a validated one:**
`16.07 ms/shortcut` (`2395/149`) is the research doc's own number, restated
here for context, not re-derived or extended into a speedup claim. This
ADR's speedup claim (a 12.3x–17.0x span of warm medians across four
independent n=5 runs, this run's own median being 16.4x; no cold/
iteration-0 ratio is claimed at all — round-3 blocker 1) is computed
against each run's OWN COM measurement (182 shortcuts, both paths, same
process, same machine, same moment) — not against the 149 baseline —
specifically to avoid building a claim on top of that unreconciled number.
If a reader wants the number
anyway: the benchmark itself now prints and persists
(`thisRun.warm.nodeParserMsPerItemMedian`) the warm-median Node parser
per-shortcut time — `0.1137 ms/shortcut` this run — instead of requiring
hand arithmetic in this document (round 1 was rejected in part for an
ADR-only figure, "174", that no script printed; this document does not
repeat that mistake with a different number). Dividing the original 16.07
ms/shortcut baseline by that printed figure gives ~141.4x, but that ratio
inherits every ambiguity in the 149 denominator above and is not asserted
as a validated speedup.

### Agreement (against the parser's PRIMARY output — what it actually resolves to)

| Tier | Count |
|---|---|
| Exact string match (primary candidate) | **170** |
| Case-insensitive match (primary) | 0 |
| Same file on disk (`realpath`) match (primary) | 0 |
| **Matched only via a secondary/diagnostic candidate** | **0** |
| **Mismatch (no candidate matches at all)** | **0** |
| COM returned empty string | 4 |
| COM returned no result | 0 |
| Parser produced no candidate, COM had a non-empty one | 8 |

**Verifying the fix (round-2 blocker 1's specific defect):** the reviewer's
evidence was `matchedVia = {linkinfo-local: 135, env-expanded: 35}` derived
from the round-1 JSON where the 170 "exact" rows did not all have
`parserResolvedTargetPath === comTargetPath`. This run's `matchedVia`
breakdown of the 170 `exact` rows, computed directly from
`proof-03-results.json`:

```
{ 'linkinfo-local': 135, 'env-expanded': 35 }
```

135 + 35 = 170 exactly, and `matched-only-via-secondary-candidate` is 0.
That is the discriminating check: if the priority-order fix in
`lnk-parser.mjs` (env-expanded before env-raw) and the comparator fix in
`proof-03-lnk-benchmark.mjs` (check the primary candidate, demote the rest)
were only cosmetic, this number would not come out to exactly the
reviewer's own `135 + 35` decomposition with zero secondary-only matches.
It does.

**The mutation test the reviewer specified, actually run:** `sed` was used
to replace `measure/windows/lnk-parser.mjs`'s `resolvedTargetPath`
assignment with `null` (deleting the resolution feature, matching the
reviewer's `lnk-parser.mjs:384` mutation exactly), and
`test/windows-lnk-parser.test.mjs` was re-run:

```
✖ resolvedTargetPath for an env-var shortcut is the EXPANDED form, not the raw %VAR% string (2.7946ms)
  AssertionError [ERR_ASSERTION]: resolvedTargetPath must be the EXPANDED path (round-2 blocker 1) ...
  actual: null
  expected: 'C:\\Fake\\Expanded\\Dir\\sub\\app.exe'
ℹ tests 7
ℹ pass 6
ℹ fail 1
```

The guard fails exactly as required. The mutation was then reverted and the
full suite re-confirmed green (7/7) before this ADR was written.

**Verifying the round-3 ANSI fix (finding 4):** `lnk-parser.mjs`'s ANSI
branch (the `push()` calls at what were then lines 486–487) was untested by
every existing test, which all populate `targetUnicode` and so never reach
that branch. A new test builds a full-size `EnvironmentVariableDataBlock`
with an all-`NUL` Unicode field (forcing the ANSI branch) and asserts
`candidates[0].source === 'env-expanded-ansi'`. The two `push()` calls were
then swapped (`env-raw-ansi` first, matching the exact defect shape
blocker 1 fixed in the Unicode branch) and the suite re-run:

```
✖ resolvedTargetPath for an env-var shortcut falls back to the ANSI form when the Unicode field is empty (all-NUL) -- round-3 minor finding 4 (2.5355ms)
  AssertionError [ERR_ASSERTION]: the ANSI branch (lnk-parser.mjs:486-487) must produce the PRIMARY candidate when TargetUnicode is empty -- if this reads "env-raw-ansi", the two push() calls were swapped back
  + actual - expected
  + 'env-raw-ansi'
  - 'env-expanded-ansi'
ℹ tests 9
ℹ pass 8
ℹ fail 1
```

Exactly the one new test fails, exactly as required. The swap was reverted
and the full suite re-confirmed green (9/9) before this ADR was written.

**Zero mismatches, zero secondary-only matches, not full coverage.** 170 of
the 178 shortcuts where COM produced a non-empty `TargetPath` were matched
at the `exact` tier by the parser's actual (primary) output — no
case-insensitive, realpath, or secondary-candidate fallback was ever
needed on this machine's shortcut set. The other 8 of those 178 are not
mismatches (the parser never produced a *wrong* answer): they are the
no-usable-target-path-source gap documented in the next section, where the
parser correctly returns no candidate instead of guessing. "Zero
mismatches" and "resolves
the same 170-of-178 shortcuts COM resolves, with an honest gap on the
remaining 8" are both true, measured claims; "identical coverage" is not.

### The 8 shortcuts the parser does not resolve (of 12 with no usable target-path source)

12 shortcuts on this machine are IDList-only (`HasLinkTargetIDList` set,
`HasLinkInfo` not set — no environment-variable block either). Resolving
them requires shell namespace lookup (`SHGetPathFromIDList`/`IShellFolder`),
which COM has access to and a pure binary reader does not, by construction
(documented as limitation 1 in `lnk-parser.mjs`'s module header). 8 of the
12 have a non-empty COM `TargetPath` — the honest coverage gap
(`idListOnlyGapCount: 8`, derived from `comparisonTier === 'parser-empty'
&& category.noUsablePathSource`, not merely from an empty candidate list —
round-2 minor finding 8, reclassified onto `noUsablePathSource` instead of
`idListOnly` by round-3 minor finding 7 — see the "Round-3 revision"
section above for why the two fields can disagree and why classification
now uses the drift-proof one; on THIS machine's data
`categoryCensus.noUsablePathSource === categoryCensus.idListOnly === 12`,
so the fix changes nothing about the numbers below, only how they would be
computed on a machine where a `ForceNoLinkInfo`-with-no-env-block shortcut
exists):

- `HandBrake\Uninstall.lnk` → COM: `C:\Program Files\HandBrake\uninst.exe`
- `MobaXterm\MobaDiff.lnk`, `MobaXterm\MobaTextEditor.lnk` → COM:
  `C:\Program Files (x86)\Mobatek\MobaXterm\MobaRTE.exe`
- `Riot Games\League of Legends.lnk`, `Riot Games\Riot Client.lnk` → COM:
  `D:\Riot Games\Riot Client\RiotClientServices.exe`
- `Topaz Video AI\Topaz Video AI.lnk` → COM:
  `C:\Windows\Installer\{CCF2E3E7-821A-45F5-80FC-9E7243753D39}\mainapp.exe`
  (this is also the one MSI-advertised shortcut found — it is IDList-only
  *and* Darwin-tagged)
- `Windows Kits\...\Windows Software Development Kit.lnk` → COM:
  `C:\Windows\explorer.exe`
- `Google Cloud SDK\Google Cloud SDK Shell.lnk` → COM:
  `C:\Windows\system32\cmd.exe`

The other 4 IDList-only shortcuts (`MobaXterm\Visit MobaXterm Website.lnk`,
`File Explorer.lnk`, `Control Panel.lnk`, `Run.lnk`) got an **empty**
`TargetPath` from COM too — virtual-shell-item shortcuts with no real
filesystem target either way, so there is nothing for either method to
disagree about. `unexpectedParserEmptyGapCount: 0` this run — every
`parser-empty` row is accounted for by `noUsablePathSource`; none of the
8/12 above are silently mislabeled or hiding a different root cause. This
condition also now gates the script's exit code directly (round-3 minor
finding 5): a future run where it is nonzero exits 1, not 0.

None of these 12 is a mismatch: the parser correctly reports "no candidate"
rather than fabricating a wrong path.

## Category coverage (task requirement: test what exists, report zeros honestly)

| Category | Found on this machine | Parser handles it |
|---|---|---|
| Environment-variable targets (`HasExpString`) | **42** | Yes — all 42 matched COM exactly on the parser's PRIMARY output: 35 via `env-expanded` (LinkInfo absent or `ForceNoLinkInfo`-forced-off) and 7 via `linkinfo-local` (LinkInfo present and usable, so it outranked the env block per spec priority) — 42/42, 0 mismatches, 0 secondary-only matches |
| UNC path targets (`CommonNetworkRelativeLink`) | **0** | Implemented (`CommonNetworkRelativeLink` parsing, `\\server\share` reconstruction) but **not exercised** — no UNC-targeted shortcut exists in this Start Menu. Not claimed as validated. |
| MSI-advertised shortcuts (`HasDarwinID`/`DarwinDataBlock`) | **1** (Topaz Video AI) | Detected (`category.msiAdvertised: true`) but **not resolved** — by design (documented limitation 2). Resolving it needs the Windows Installer API (`MsiGetShortcutTarget`), not a binary read. This is also one of the 8 IDList-only gaps above. |
| UWP/Store app shortcuts | **0** `.lnk` files carry a UWP/Store marker | Real, reproducible finding — see next section, not the correct-by-assumption prose round 1 asserted with no committed artifact behind it. |

The env-var category is the one this task named as needing the most care
(raw vs. expanded). All 42 instances matched COM's `TargetPath` exactly on
the parser's PRIMARY output. **`ForceNoLinkInfo` was checked and honored —
and it was NOT a zero-count edge case on this machine, contrary to the
round-1 ADR's claim.** Measured this run: `forceNoLinkInfoCount: 38` (of
which 35 are the env-var shortcuts whose LinkInfo, though present, MUST be
ignored per spec — exactly why their primary candidate correctly falls
through to `env-expanded` rather than `linkinfo-local`). Round 1's precise
claim, scoped to the env-var category, was "in every one of the 42 [env-var]
cases... none tripped `ForceNoLinkInfo`" — and 35 of those same 42 rows do
trip it. Round 1's env-var-scoped claim was therefore not merely
unverifiable (the reviewer's finding) but measurably false on this
machine's own data, once the field existed to check it against (round-2
minor finding 9). This document does not extend that correction beyond its
original scope: it is the 42-env-var-shortcut claim that was wrong, not a
claim about the other 140 shortcuts, which round 1 never made a
ForceNoLinkInfo assertion about.

### UWP/Store shell-item marker scan (real, reproducible — round-2 minor finding 7)

`measure/windows/proof-03-lnk-benchmark.mjs`'s `scanForUwpMarkers()` reads
every `.lnk`'s raw bytes and searches both the UTF-16LE and Latin-1
decodings for the `AppsFolder` and `!App` (AUMID suffix) byte patterns a
UWP/Store shell-item `.lnk` would carry in its `LinkTargetIDList`. Every
read failure is now recorded (`unreadable`/`unreadableRows`), and the
denominator printed is the count actually read (`scanned`), not
`files.length` — round-3 major finding 2: the round-2 version's bare
`catch { continue; }` meant an unreadable file would vanish from both the
numerator and the denominator, so a shrunken scan could print a clean
`0/182` with nothing in the artifact to reveal it. This run:

```
"AppsFolder" byte-pattern found in: 0/182 .lnk files actually read (0 unreadable, 182 enumerated)
"!App" (AUMID suffix) byte-pattern found in: 0/182 .lnk files actually read (0 unreadable, 182 enumerated)
```

Zero unreadable files this run — the denominator is genuinely 182, not
merely assumed to be. Zero hits, consistent with the known fact that real
Start Menu tiles for
UWP/Store apps (Calculator, Photos, Terminal, etc.) are not `.lnk` files at
all — they resolve through `shell:AppsFolder`, PROOF-02's scope, not
PROOF-03's. This is now backed by `uwpMarkerScan` in
`proof-03-results.json`, regenerated on every re-run, not an assertion in
prose with nothing behind it.

This is a genuinely separate claim from the IDList-only census (12
shortcuts, not zero): IDList-only shortcuts on this machine are ordinary
desktop-app shortcuts whose author happened to store target info only in
the shell namespace ID list (HandBrake's uninstaller, MobaXterm's
sub-tools, Riot Games launchers, the Windows SDK's Explorer-relaunch
shortcut, Google Cloud SDK's shell launcher, and 4 virtual System items) —
none of them are UWP/Store apps, and none of the 182 files carry a UWP
marker. Round 1 conflated "the UWP marker scan found zero" (true) with "the
IDList-only census should be zero" (false) by printing them next to each
other with a single unconditional sentence; this revision states each as
its own, correctly-labeled finding.

## Decision

**Ship the binary reader as the primary mechanism for PLAT-10.** The
re-measured evidence, all of it now backed by a comparator that checks the
parser's PRIMARY (actually-returned) output, not merely something the
parser produced somewhere in a candidate list:

1. Zero mismatches and zero secondary-only matches across 182 real
   shortcuts on this machine, at the strictest (exact string) comparison
   tier, checked against the parser's actual returned value — verified by
   the discriminating `135 + 35 = 170` decomposition and a real mutation
   test (see "Verifying the fix" above).
2. A warm-state speedup over COM, measured with warmup and repetition
   across FOUR independent n=5 runs, claimed as the span of their medians,
   not any single run's min/max: **12.3x–17.0x** (round-2 committed 13.8x;
   round-3 reviewer's two re-runs 17.0x and 12.3x; round-3's own committed
   run 16.4x). Individual iterations across those four runs' 20 total warm
   samples ranged more widely, 9.8x–18.5x (observed spread of data points,
   not a claimed bound — this run's own 5 iterations, 11.6x–18.3x, are a
   subset of that wider spread, and quoting only this run's bounds as "the"
   range would repeat the exact defect shape blocker 1 was rejected for:
   round-2's own min, 12.1x, sits below this run's median). Consistent to
   within a factor of ~1.4 across four independent measurements, not a
   reproducible two-significant-figure constant, and NOT compared against
   the research doc's 149/2395ms baseline as a validated ratio (see "The
   149-vs-182 denominator" above) — only against each run's own COM
   measurement, same machine, same moment, same process. **No cold/
   first-touch speedup is claimed at all** — round-3 blocker 1 found the
   previously-claimed 9.5x–10.2x cold range does not reproduce on a
   genuinely first-touch run (measured 2.2x and 12.5x across two attempts,
   moving in opposite directions for Node vs COM), so that number is
   deleted from this decision rather than restated with different bounds.
3. A well-defined, honestly-scoped gap (shortcuts with no usable
   target-path source and a non-empty COM target, 8/182 ≈ 4.4% of this
   machine's set) with an unambiguous signal when it occurs
   (`resolvedTargetPath: null`, `category.noUsablePathSource: true`)
   rather than a silently wrong answer.

**PLAT-10 must keep a COM (or `IShellLinkW`) fallback for the IDList-only
case**, not replace COM outright. When `lnk-parser.mjs` returns no
candidate, PLAT-02/PLAT-10's app enumerator should fall back to COM
resolution for that one shortcut (an 8/182 ≈ 4.4% fallback rate on this
machine). This ADR does not itself implement that fallback — it is a
decision record for PROOF-03, consumed by PLAT-10 (Fase 3).

**Not validated, flagged for PLAT-10 to re-check if it matters there:**
UNC-targeted shortcuts and MSI-advertised shortcut *resolution* (detection
works; resolution does not and is not attempted). Both are present in the
codebase as documented, deliberate gaps, not silent ones. The 149-vs-182
denominator question above is also unresolved and should not be treated as
closed by this document.

## Reproducing this measurement

```
node measure/windows/proof-03-lnk-benchmark.mjs
node --test test/windows-lnk-parser.test.mjs
```

Requires Windows (COM `WScript.Shell` is Windows-only) and PowerShell on
`PATH`. The benchmark regenerates `measure/windows/proof-03-results.json`,
including raw per-iteration timing, the full per-row `parserFlags` object,
and the UWP-marker scan. It runs 1 discarded warmup iteration plus 5 timed
iterations (both Node parser and COM), so a re-run takes roughly 6x the
single-pass time reported in round 1 (a handful of seconds on this
machine, dominated by the 6 PowerShell process spawns). `node --test`
should report 9 tests, 9 pass, 0 fail (round 2 added 7, round 3 added 2
more — the ANSI-branch and `noUsablePathSource` guards).

**Exit code is a real pass/fail signal, not merely mismatches/secondary-
only matches (round-3 minor finding 5).** The benchmark exits 1 if ANY of:
a mismatch, a secondary-only match, a non-empty `dirErrors` (the scanned
Start Menu set was under-counted by a permission or other non-`ENOENT`
readdir error), or `unexpectedParserEmptyGapCount > 0` (a parser-empty row
not accounted for by the accepted `noUsablePathSource` gap). It exits 0
only when none of those hold — `idListOnlyGapCount`/`noUsablePathSource`
being nonzero (the accepted 8/182 gap) does NOT fail the run; gating on it
would make exit 1 the permanent normal state here. This run: exit code 0.
