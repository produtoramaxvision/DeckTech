# ADR-0003: Binary `.lnk` parsing in Node vs COM (`WScript.Shell`)

- Status: Accepted (revised after round-2 review — see "Round-2 revision" below)
- Date: 2026-09-17
- Requirement: PROOF-03 (`.maxvision/REQUIREMENTS.md` Fase 0), gates PLAT-10
- Supersedes: nothing. First measurement of unvalidated assumption U5
  (`.maxvision/research/SUMMARY.md:646`).

## Round-2 revision (this document)

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

## Measured result (this machine, 2026-09-17, re-run after all 10 fixes)

Scope: every `.lnk` under `%ProgramData%\Microsoft\Windows\Start Menu\Programs`
and `%APPDATA%\Microsoft\Windows\Start Menu\Programs` (machine + user),
**182 files**. Directory enumeration: `dirErrors: []` — zero permission or
other non-`ENOENT` errors this run, all subtrees read cleanly.

Command run: `node measure/windows/proof-03-lnk-benchmark.mjs`. Verbatim
timing block from that run:

```
--- Timing: cold (n=1, first pass; Node parser ran BEFORE COM, so COM was not measured on a cold OS file cache in this harness) ---
COM loop-only (cold): 182 shortcuts, 260.6 ms total, 1.43 ms/shortcut
COM wall incl. PowerShell startup + COM instantiation (cold): 666.1 ms total
Node binary parser (cold): 182 shortcuts, 25.66 ms total, 0.1410 ms/shortcut
Speedup (cold, COM loop-only / Node parser): 10.2x

--- Timing: warm (n=5, after 1 discarded warmup iteration -- warmup changes the profile, do not compare a cold number against a warm one) ---
Node parser: median 19.02 ms, min 16.78, max 22.58, stddev 2.15 -- raw: [19.02, 16.78, 17.60, 21.07, 22.58]
COM loop-only: median 273.1 ms, min 230.5, max 325.6, stddev 41.3 -- raw: [230.5, 231.1, 325.6, 273.1, 320.4]
Speedup (median of per-iteration COM/Node ratios): median 13.8x, min 12.1x, max 18.5x
Node parser warm median, per-shortcut: 0.1045 ms/shortcut
```

Reading this honestly: the Node parser is consistently faster than COM by
roughly an order of magnitude, both cold (10.2x) and warm (median 13.8x,
range 12.1x–18.5x across 5 iterations). It is NOT a stable "8.0x" or any
other single two-significant-figure number — that was round 1's mistake
(n=1, no variance reported). Several re-runs performed during this
revision (while iterating on the fixes and re-verifying them) produced
cold speedups in the 9.5x–10.2x range and warm medians in the 12.2x–13.8x
range, each with a different min/max spread (the committed
`proof-03-results.json` reflects exactly ONE of those runs, printed above,
and is the only one this document's numbers are drawn from) — the range
itself, not a single figure from any one run, is the honest claim.
COM's own loop-only time varies by roughly 40% across warm iterations
(230.5–325.6 ms this run) on a machine with other software running
concurrently (Blender, Adobe Creative Cloud apps, etc. were present in this
session — see the process list implied by `.maxvision/research/
WINDOWS-STACK.md`), which is itself evidence for why n=1 was insufficient.
Warming does not make COM consistently faster than its cold figure here
(median 273.1 ms warm vs. 260.6 ms cold) — the file-cache-warmth
explanation round 1 offered for why COM might read fast was not borne out
by repetition. This is stated as a hypothesis, not a measured conclusion:
COM's variance is plausibly dominated by PowerShell process / COM
instantiation jitter rather than file-cache state, but that specific cause
was not isolated or investigated further here, and no figure in this
document depends on it being true.

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
ADR's own speedup claims (10.2x cold, 12.1x–18.5x warm) are computed against
this run's OWN COM measurement (182 shortcuts, both paths, same process, same
machine, same moment) — not against the 149 baseline — specifically to avoid
building a claim on top of that unreconciled number. If a reader wants the
number anyway: the benchmark itself now prints and persists
(`thisRun.warm.nodeParserMsPerItemMedian`) the warm-median Node parser
per-shortcut time — `0.1045 ms/shortcut` this run — instead of requiring
hand arithmetic in this document (round 1 was rejected in part for an
ADR-only figure, "174", that no script printed; this document does not
repeat that mistake with a different number). Dividing the original 16.07
ms/shortcut baseline by that printed figure gives ~154x, but that ratio
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

**Zero mismatches, zero secondary-only matches, not full coverage.** 170 of
the 178 shortcuts where COM produced a non-empty `TargetPath` were matched
at the `exact` tier by the parser's actual (primary) output — no
case-insensitive, realpath, or secondary-candidate fallback was ever
needed on this machine's shortcut set. The other 8 of those 178 are not
mismatches (the parser never produced a *wrong* answer): they are the
IDList-only gap documented in the next section, where the parser correctly
returns no candidate instead of guessing. "Zero mismatches" and "resolves
the same 170-of-178 shortcuts COM resolves, with an honest gap on the
remaining 8" are both true, measured claims; "identical coverage" is not.

### The 8 shortcuts the parser does not resolve (of 12 IDList-only total)

12 shortcuts on this machine are IDList-only (`HasLinkTargetIDList` set,
`HasLinkInfo` not set — no environment-variable block either). Resolving
them requires shell namespace lookup (`SHGetPathFromIDList`/`IShellFolder`),
which COM has access to and a pure binary reader does not, by construction
(documented as limitation 1 in `lnk-parser.mjs`'s module header). 8 of the
12 have a non-empty COM `TargetPath` — the honest coverage gap
(`idListOnlyGapCount: 8`, derived from `comparisonTier === 'parser-empty'
&& category.idListOnly`, not merely from an empty candidate list — round-2
minor finding 8):

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
`parser-empty` row is accounted for by `idListOnly`; none of the 8/12 above
are silently mislabeled or hiding a different root cause.

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
UWP/Store shell-item `.lnk` would carry in its `LinkTargetIDList`. This
run:

```
"AppsFolder" byte-pattern found in: 0/182 .lnk files
"!App" (AUMID suffix) byte-pattern found in: 0/182 .lnk files
```

Zero hits, consistent with the known fact that real Start Menu tiles for
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
2. A roughly-order-of-magnitude speedup over COM, measured with warmup and
   repetition: 10.2x cold (n=1), median 13.8x warm (n=5, range 12.1x–18.5x)
   — the committed run. Other re-runs during this revision landed cold
   9.5x–10.2x and warm median 12.2x–13.8x, each with its own min-max
   spread — consistent order of magnitude, not a reproducible
   two-significant-figure constant.
   Not a single two-significant-figure number, and NOT compared against the
   research doc's 149/2395ms baseline as a validated ratio (see "The
   149-vs-182 denominator" above) — only against this run's own COM
   measurement, same machine, same moment, same process.
3. A well-defined, honestly-scoped gap (IDList-only shortcuts with a
   non-empty COM target, 8/182 ≈ 4.4% of this machine's set) with an
   unambiguous signal when it occurs (`resolvedTargetPath: null`,
   `category.idListOnly: true`) rather than a silently wrong answer.

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
machine, dominated by the 6 PowerShell process spawns).
