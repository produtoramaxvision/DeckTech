# ADR-0003: Binary `.lnk` parsing in Node vs COM (`WScript.Shell`)

- Status: Accepted (revised through round 8 — see "Revision history" below)
- Date: 2026-09-17
- Requirement: PROOF-03 (`.maxvision/REQUIREMENTS.md` Fase 0), gates PLAT-10
- Supersedes: nothing. First measurement of unvalidated assumption U5
  (`.maxvision/research/SUMMARY.md:646`).

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
  resolution loop only. **This is a claim about MECHANISM, not about the
  RESULT**: the same code path (`WScript.Shell.CreateShortcut(path).
  TargetPath`, timed by an internal `Stopwatch` around the loop only) is
  used, which is what makes a per-item comparison methodologically
  meaningful at all — it does NOT mean this script's own measured
  per-item rate matches the original baseline's. It does not: round-4
  blocker finding 1 found the two disagree by roughly an order of
  magnitude (see "The COM baseline: two separate open questions" below).
  Round-3's version of this sentence asserted the comparison was
  "comparable, per-item, to the 2395 ms/149 baseline" without qualifying
  which sense of "comparable" it meant, and the document never actually
  performed that per-item comparison anywhere else in 699 lines — this
  revision performs it (see "Measured result") and states the result
  plainly instead of leaving the claim to imply agreement it does not
  demonstrate.
- `measure/windows/proof-03-lnk-benchmark.mjs` — orchestrates both, runs a
  cold pass plus 5 warm timed passes, does a tiered (exact →
  case-insensitive → `fs.realpathSync.native` filesystem identity)
  item-by-item comparison against the parser's PRIMARY output, and
  prints/records the result.

## Measured result (this machine, 2026-09-17, re-run after all round-4 fixes)

Scope: every `.lnk` under `%ProgramData%\Microsoft\Windows\Start Menu\Programs`
and `%APPDATA%\Microsoft\Windows\Start Menu\Programs` (machine + user),
**182 files**. Directory enumeration: `dirErrors: []` — zero permission,
reparse-point, or other non-`ENOENT` errors this run, all subtrees read
cleanly (this is now ALSO the reparse-point-aware enumeration —
round-4 major finding 3 — live-verified in both states with a real NTFS
junction; see "Round-4 revision" item 3 in the "Revision history"
appendix below for the verbatim
with-junction output, which is deliberately not this section's canonical
run).

Command run: `node measure/windows/proof-03-lnk-benchmark.mjs`. Verbatim
timing block from the run this section's numbers are drawn from (exit code
0):

```
--- Timing: iteration 0 (n=1, first pass; NOT a fair cold-vs-warm comparison -- see note below) ---
Baseline (research, prior run, different file count AND -- see below -- a total that does not reproduce via the same COM mechanism on this machine; see docs/adr/0003 round-4 finding 1): 149 shortcuts, 2395 ms total, 16.07 ms/shortcut
COM loop-only (iteration 0): 182 shortcuts, 346.5 ms total, 1.90 ms/shortcut
COM wall incl. PowerShell startup + COM instantiation (iteration 0): 827.0 ms total
Node binary parser (iteration 0): 182 shortcuts, 35.05 ms total, 0.1926 ms/shortcut
NOTE: no speedup ratio is printed for iteration 0. [...] See docs/adr/0003, round-3 fix 1.

--- Timing: warm (n=5, after 1 discarded warmup iteration -- warmup changes the profile, do not compare a cold number against a warm one) ---
Node parser: median 42.63 ms, min 37.72, max 43.94, stddev 2.26 -- raw: [37.72, 42.63, 43.94, 43.07, 40.26]
COM loop-only: median 499.0 ms, min 339.4, max 567.1, stddev 81.9 -- raw: [339.4, 550.8, 451.4, 499.0, 567.1]
Speedup (median of per-iteration COM/Node ratios): median 11.6x, min 9.0x, max 14.1x
Node parser warm median, per-shortcut: 0.2343 ms/shortcut
COM warm median, per-shortcut: 2.7416 ms/shortcut
NOTE (round-4 blocker finding 1): the research baseline's per-item rate is 16.07 ms/shortcut (2395 ms / 149 shortcuts). This run's COM warm median is 2.74 ms/shortcut over 182 shortcuts, the SAME WScript.Shell mechanism -- a 5.9x difference NOT explained by the file-count difference (a larger denominator here would raise COM's TOTAL time, not cut its PER-ITEM rate). The baseline total does not reproduce on this machine; see docs/adr/0003 round-4 finding 1 for the absolute-magnitude implication for PLAT-10.
```

(The iteration-0 `NOTE` line is elided above — its full text is unchanged
from round 3 and is quoted in full in the "Revision history" appendix
below; the JSON at
`thisRun.iteration0.note` carries it verbatim. This is the run whose
`proof-03-results.json` is the one committed alongside this document —
the census-derivation hardening applied after the first draft of this
round-4 revision, described in "Round-4 revision" item 4's note on
`extraDataTruncated`, required one more re-run to keep the committed JSON
and this document's quoted numbers in sync; the agreement table, category
census, and every non-timing figure are unchanged from every other run
this round — see the table below.)

Reading this honestly, in the order this round's findings apply:

**The research baseline does not reproduce on this machine — stated
plainly, not filed under a denominator question (round-4 blocker finding
1).** The original measurement (`.maxvision/research/WINDOWS-STACK.md`)
recorded 2395 ms total for 149 shortcuts via `WScript.Shell`, 16.07
ms/shortcut. This document's own benchmark, using the literal SAME
mechanism (one `WScript.Shell` COM object, reused across the loop, timed
by an internal `Stopwatch` around the resolution loop only — see "What was
built" above), measures COM's warm-median per-item rate at **2.74
ms/shortcut** this canonical run — roughly **5.9x lower** than the
baseline claims, over MORE files (182, not fewer) — and every OTHER run
executed this round measured an even larger gap (see the table below,
5.9x–11.1x across all five). A larger file count would raise COM's
TOTAL time; it cannot explain a lower PER-ITEM rate, so this is not a
denominator artifact — the numerator itself does not reproduce. This is
not a one-off: all FIVE warm n=5 runs executed this round (the canonical
one quoted above plus four corroborating runs, one of them executed
before a small post-review hardening of the census-derivation code
described in "Round-4 revision" item 4, none of them changing the
agreement/category numbers — only timing) show the same
order-of-magnitude gap:

| Run | COM warm median (182 shortcuts) | COM ms/shortcut | Baseline ms/shortcut ÷ this run's | Node warm median | Speedup (median of ratios) |
|---|---|---|---|---|---|
| Canonical (this section's verbatim quote, matches committed JSON) | 499.0 ms | 2.74 | 5.9x | 42.63 ms | 11.6x (9.0x–14.1x) |
| Corroborating run A | 282.4 ms | 1.55 | 10.4x | 28.95 ms | 9.7x (8.8x–11.1x) |
| Corroborating run B | 263.5 ms | 1.45 | 11.1x | 29.32 ms | 8.8x (7.7x–10.3x) |
| Corroborating run C | 266.9 ms | 1.47 | 11.0x | 28.86 ms | 9.2x (8.5x–16.0x) |
| Corroborating run D | 324.1 ms | 1.78 | 9.0x | 36.72 ms | 9.3x (7.0x–12.1x) |
| Round-6 reviewer verification, run 1 (second-hand — the round-6 reviewer's own re-run, reported verbatim in the finding that rejected round 5; COM/Node medians individually not reported, only the per-iteration ratios and the median) | not reported | not reported | not reported | not reported | 9.306x (7.7x–10.7x) |
| Round-6 reviewer verification, run 2 (second-hand, same source; COM/Node medians reported verbatim as "258.3" / "30.73" in the finding) | 258.3 ms | 1.42 | 11.3x | 30.73 ms | 8.3x (7.0x–10.0x) |
| Round-6 worker verification, run 1 (first-party — this document's own re-run on this machine, fixing the round-5 rejection; `node measure/windows/proof-03-lnk-benchmark.mjs`, verbatim stdout quoted below) | 313.8 ms | 1.72 | 9.3x | 36.46 ms | 8.6x (6.7x–11.0x) |
| Round-6 worker verification, run 2 (first-party, same source, run immediately after run 1) | 269.8 ms | 1.48 | 10.8x | 35.73 ms | 8.6x (6.2x–10.8x) |

**Round-6 worker verification — verbatim, both runs (round-6 major finding
1):** neither run was committed as its own artifact — both were run to
produce this table, then `measure/windows/proof-03-results.json` was
restored to the canonical `6932c45` state with `git checkout --` so the
committed artifact stays the one the "Reproducing this measurement"
section documents; the correctness numbers below (identical in both runs)
confirm nothing about the parser's OUTPUT changed between them, only
timing.

Run 1:
```
--- Timing: warm (n=5, after 1 discarded warmup iteration) ---
Node parser: median 36.46 ms, min 29.16, max 41.54, stddev 3.95 -- raw: [35.71, 36.50, 29.16, 36.46, 41.54]
COM loop-only: median 313.8 ms, min 271.4, max 332.1, stddev 23.9 -- raw: [332.1, 313.8, 321.3, 271.4, 279.3]
Speedup (median of per-iteration COM/Node ratios): median 8.6x, min 6.7x, max 11.0x
Node parser warm median, per-shortcut: 0.2003 ms/shortcut
COM warm median, per-shortcut: 1.7240 ms/shortcut
```
Agreement: 170 exact / 0 case-insensitive / 0 realpath / 0 secondary-only /
0 mismatch / 8 no-usable-target-path-source gap — bit-identical to the
canonical `6932c45` run and to round-4/5's four corroborating runs.

Run 2 (immediately after run 1, same process invocation pattern):
```
--- Timing: warm (n=5, after 1 discarded warmup iteration) ---
Node parser: median 35.73 ms, min 28.18, max 40.57, stddev 4.91 -- raw: [40.57, 28.18, 30.13, 39.38, 35.73]
COM loop-only: median 269.8 ms, min 253.1, max 338.4, stddev 34.9 -- raw: [253.1, 263.0, 325.3, 338.4, 269.8]
Speedup (median of per-iteration COM/Node ratios): median 8.6x, min 6.2x, max 10.8x
Node parser warm median, per-shortcut: 0.1963 ms/shortcut
COM warm median, per-shortcut: 1.4824 ms/shortcut
```
Agreement: identical to run 1 — 170/0/0/0/0/8, 42 env-var, 12 IDList-only,
1 MSI-advertised, 0 UNC, 0 UWP-marker hits.

**Corrected in round 5 (round-5 blocker finding 1):** only the Canonical
row above is committed to this repository — `git show
6932c45:measure/windows/proof-03-results.json` reproduces it exactly.
The four "Corroborating run A–D" rows are real, first-party
measurements from this same session but were never committed as their
own artifacts (the committed `proof-03-results.json` holds one run per
commit, and each corroborating run was superseded by the next before
any of them was committed — see "Round-5 revision" finding 1 in the
"Revision history" appendix below);
they are this-session, not second-hand, but also not independently
reproducible by a third party from this repository the way the
Canonical row is. No re-measurement of the original 149-shortcut run is
attempted or possible: as established in round 2/3, that script "was
not preserved in the repo" (see "The COM baseline: two separate open
questions" below, which replaces the old "149-vs-182 denominator"
section and keeps that finding, unreconciled, as its OWN, separate
question from this one).

**Provenance of the round-5 four-run committed set (historical —
corrected in round 5, round-5 blocker finding 1; superseded as this
document's speedup range by the round-7 canonical statement below — see
"Measured result" → "Ratio evidence — canonical statement" — and
retained here only as the reproducibility record for which specific runs
are independently git-verifiable, round-8 blocker finding 1):** the
warm-median speedup observed across the FOUR
independent n=5 runs that are actually committed to this repository and
independently reproducible right now by anyone via `git show
<sha>:measure/windows/proof-03-results.json` spans **11.6x–16.4x**:
`6932c45` (this round's canonical run, median 11.586x, n=5 range
9.0x–14.1x), `7819df6` (round 2's first committed run, median 13.191x,
n=5 range 12.4x–15.4x — cited in the provenance audit above but not
previously quoted in this section, round-5 major finding 2), `1fa06ae`
(round 2's second, final committed run, median 13.770x, n=5 range
12.1x–18.5x), and `14a44ac` (round 3's committed run, median 16.428x,
n=5 range 11.6x–18.3x). The factor between this four-run set's own
extremes is **1.42x** (16.428 ÷ 11.586) — close to round 3's retracted
"~1.4" claim, arrived at independently here from the correctly-scoped
repo-verifiable set, not by re-asserting that claim. At the iteration
level (not medians), these four runs' 20 warm iterations span
**9.0x–18.5x** (min from `6932c45`, max from `1fa06ae`).

Separately — and explicitly NOT part of the headline, because neither
cluster is independently reproducible from this repository — two more
clusters of real measurements exist: (1) this round's own four
"Corroborating run A–D" (table above; medians 9.7x, 8.8x, 9.2x, 9.3x;
iteration-level span 7.0x–16.0x, the 7.0x from run D's own min and the
16.0x from run C's single high outlier, `raw: [248.1, 266.9, 278.0,
259.8, 412.7]` ms for COM, driven by one slow 412.7 ms iteration — the
ratio is real but not typical for that run, see its own median 9.2x) —
first-party, this-session, but never committed as their own artifact,
so a third party cannot reproduce them from this repository; and (2)
the round-3 reviewer's own two re-runs (medians 17.0x and 12.3x) —
second-hand, reported in that round's review findings, run on the
reviewer's own machine/session, likewise not reproducible from anything
committed here. Combining all three clusters gave, as of round 5, an
overall observed range of **8.8x–17.0x across ten n=5 samples**
(historical — this ten-sample tally is itself superseded by the
twenty-sample round-7 canonical statement in "Measured result" → "Ratio
evidence — canonical statement" below, the same way the four-run span
above is; round-8 blocker finding 1) (four repo-verifiable,
four uncommitted first-party, two second-hand) — consistent with round
3's retracted "12.3x–17.0x" bound at its upper end, but this document
does not restate round 3's "~1.4" factor as a property of that combined
ten-sample set: the factor across all ten known medians is 1.93x (17.0
÷ 8.8), or 1.87x restricted to the eight first-party (committed +
uncommitted) medians (16.428 ÷ 8.8) — both wider than the 1.42x above,
because both include clusters that figure deliberately excludes. In
both cases the 8.8x/17.0x table/reviewer figures carry only the
one-decimal precision they were originally reported at (the uncommitted
cluster's own raw JSON no longer exists to re-derive a finer figure
from), so 1.93x/1.87x should be read at that same precision, not as
five-decimal-accurate as the 1.42x computed from two committed runs'
full-precision medians.
**What is unchanged from round 3: no cold/first-touch speedup is
claimed at all** — the previously deleted 9.5x–10.2x cold range stays
deleted, for the same reason (round-3 blocker 1, unaffected by anything
in round 4 or 5).

**Round 6 found the committed-only 11.6x–16.4x span was not a predictive
interval** (round-6 major finding 1): round 5 had narrowed the headline
floor to 11.6x by selecting on whether a run happened to be committed — a
provenance label, not a measurement-validity criterion — and told PLAT-10
to plan against that narrowed span specifically. Two independently-run
re-measurements during round 6 (reviewer medians 9.306x/8.3x, worker
medians 8.6x/8.6x) landed below 11.6x, falsifying it as planning guidance.
Round 6's fix widened the stated range to the full fourteen-run
distribution (8.3x–17.0x median-level, 6.2x–18.5x iteration-level) and
published THAT as the new floor instead.

**Round 7 finding (round-7 blocker finding 1): that fix reproduced the
same defect at a different number, and the defect is structural, not
numeric.** `min(observed samples)`, published as both a range endpoint and
a design floor, is monotonically non-increasing in N by construction —
every additional run can only lower it or leave it unchanged, never raise
it. Round 6's own "6.2x" floor (the document's then-stated lowest-ever
iteration speedup — see the "Round-6 revision" entry in "Revision
history" below for its own verbatim wording) was itself broken by three
fresh confirmation runs of the committed benchmark
executed on this machine for round 7 (`node
measure/windows/proof-03-lnk-benchmark.mjs`, run three times,
`proof-03-results.json` restored via `git checkout --` after each and
verified byte-identical to `HEAD` via `git hash-object` before
committing): warm-median speedups of **7.80x, 9.60x, 10.16x**, and
per-iteration ratios spanning **6.18x–13.13x** — a new low, 6.18x, below
round 6's own just-published 6.2x floor. This is not a correction to
6.2x; it is the identical failure mode recurring one round after the
document last "fixed" it, exactly as this round's reviewer predicted it
would ("every future reviewer breaks it").

**Ratio evidence — canonical statement (this is the ONE place this
document states the aggregate, consolidated Node-vs-COM speedup
conclusion — round-8 blocker finding 1: this is a narrower claim than
"every ratio range in the file," and deliberately so, on two axes. First
metric: the separate COM-vs-third-party-baseline per-item rate gap is a
different number entirely (5.9x–11.1x as first measured, widened to
5.9x–11.3x by name in the paragraph beginning "The research baseline does
not reproduce on this machine," at the top of "Measured result," once
round 6's second run's 11.3x gap is folded in — that same paragraph's own
"5.9x–11.1x across all five" is the pre-widening figure, scoped to its
own five specific runs and superseded later in that same paragraph by the
widening — then referenced again in "The COM baseline" below) and is
untouched by this parenthetical. Second, an aggregate range in the file
that is not this paragraph's own is either (a) inside "Revision history"
below, an appendix of past-round entries that are historical by
construction, (b) one specific run's own reported result — a table row,
the round-6 history entry, scoped inline prose ("this round's" five runs
at "Measured result"'s opening), or the per-run medians in "Round-8
worker verification" below, none of them generalized into a
document-wide claim, (c) one of the two round-5-era paragraphs in this
section — "Provenance of the round-5 four-run committed set" and the
"Combining all three clusters" sentence just above — which now say, at
the point of statement, that they are superseded by this paragraph, (d)
the "Round 6 found..." and "Round 7 finding..." narrative paragraphs
immediately above this one, which each state a prior round's number and,
in that same paragraph or the next, that the following round found it
broken — narrating what happened, not asserting a current bound — or (e)
a site citing THIS paragraph's own aggregate range WITH attribution back
to it, not asserting a second, independent claim: "Decision" item 3 and
"The COM baseline" → "This ADR's speedup claim" both do this):** across
TWENTY-THREE n=5 warm runs
measured for this ADR through round 8 (four committed + four uncommitted
first-party round 5, two second-hand round 3, two second-hand round 6,
two first-party round 6, three second-hand round 7 — the reviewer's own
re-runs that rejected round 6's ADR, quoted in the "Round-7 revision"
entry above — three first-party round 7 and three first-party round 8,
each round's own worker, this section's table above plus the three
round-7 and three round-8 worker runs just described), the binary reader
has been faster than COM in every
individual warm iteration FOR WHICH per-iteration data is recoverable
(roughly 35 of the roughly 115 total iterations across all twenty-three
runs — see below for why the rest are not recoverable; the membership of
this 35 changed this round: round 7's three worker runs, previously
counted here, are removed — round-8 major finding 2 established their
raw per-iteration values were never quoted or committed anywhere, only
their medians and an iteration-level min/max; round 8's three worker
runs, with raw values quoted in full in "Round-8 worker verification"
below, take their place, so the count is unchanged at 35 but the specific
runs behind it are not), and faster at the
run-median level in all twenty-three runs without exception (every reported
median exceeds 1.0x). Among the iterations with recoverable data, the
factor has ranged from **as low as ~5.7x to as high as ~18x** at the
individual-iteration level (5.7x from this round's own reviewer's third
re-run of the round-6-committed benchmark, reported in the finding that
rejected round 6's ADR — see the "Round-7 revision" entry above for the
full quote; 18.5x from `1fa06ae`'s committed max), with run-medians
observed **roughly 7.8x–17x**. These figures are reported as **a sample
range observed to date, not a bound**: a pooled percentile over the full
iteration set was considered and rejected for this document, because
most of the second-hand rows (the round-3, round-6, and round-7 reviewer
runs) report only a median and a min/max, not the per-iteration raw
values a defensible percentile needs — and round 7's own three worker
runs turn out to be in the same position (round-8 major finding 2: only
a median and an iteration-level min/max were ever recorded for them,
never the five individual raw values per run) — only the four committed
JSONs plus round 8's three worker runs (~35 of the ~115 iterations) have
recoverable raw per-iteration data, and computing a percentile over
35-of-115 and presenting it as "the" pooled floor would
be a new, narrower-sounding overclaim of the same shape this finding
exists to stop. The honest statement is the one above: an observed
range, expected to widen
(specifically downward) as more runs accumulate, with **no** "lowest
ever", "no lower than", or "floor" language attached to any specific
number, because the very next run — on this machine or anyone else's —
can and, on this document's own eight-round track record, reliably does
move that number. **PLAT-10 must not plan capacity or set an SLA against
any ratio figure in this document.** For a planning input that does NOT
have this defect, see the absolute-saving band immediately below, which
is the number "Decision" leads with.

**Absolute magnitude — the figure that has NOT moved (round-4 blocker
finding 1; the figure round 6 already found survives fresh sampling,
confirmed again in rounds 7 and 8):** across the four repo-verifiable committed
runs, the binary reader saves COM-median minus Node-median per full
182-shortcut Start Menu scan: 226.5 ms (`7819df6`), 254.1 ms (`1fa06ae`),
289.5 ms (`14a44ac`), 456.3 ms (`6932c45`, canonical) — **roughly a
quarter to half a second per full scan on this machine (0.23–0.46 s)** —
not the ~2.4 s the research baseline's 16 ms/shortcut premise would
suggest for a similarly-sized set (that premise does not reproduce on
this machine at all; see "The COM baseline" below). This is arithmetic on
each committed run's own `warm.nodeParserMs.median` and
`warm.comLoopOnlyMs.median` fields, already present in the committed
JSON, not a new measurement. Eleven further samples, none committed, all
land inside this same 226.5–456.3 ms band without moving either edge: the
four uncommitted, first-party "Corroborating run A–D" figures from this
document's round-4/5 measurement session (253.5 ms, 234.2 ms, 238.0 ms,
287.4 ms), round 6's reviewer's two runs (278.6 ms, 227.6 ms — the latter
grazes but does not fall below the observed 226.5 ms lower edge,
compared at full millisecond precision rather than the rounded "0.23
s"), round 6's
worker's two runs (277.34 ms, 234.07 ms), and round 7's three fresh
confirmation runs — 241.65 ms, 236.26 ms, 254.47 ms, arithmetic on
277.0546 − 35.407, 264.8426 − 28.5819, 286.4326 − 31.9648
(round-8 major finding 2: those six COM/Node medians were typed directly
into round 7's revision of this paragraph and were never quoted verbatim
or committed as their own artifact anywhere in this repository — `git
log --all -S"277.0546"` and the same for each sibling number return only
this document's own text, introduced by `eb260d5`; unlike every other row
in this list, no third party can independently confirm them. They are
first-party but, like the "Corroborating run A–D" cluster above, not
independently reproducible from anything committed here, and this
revision corrects the dangling "computed from this section's three
round-7 runs above" cross-reference that used to imply otherwise — there
was no "above" to compute from. They still count toward the band because
the document has no reason to doubt three numbers this document's own
prior round typed down, only to independently verify them; a reader who
wants that independent verification should use the round-8 runs below
instead). Fifteen samples across seven review rounds (through round 7),
zero of them outside 0.23–0.46 s.

**Round-8 worker verification — three fresh runs, fully verbatim
(round-8 major finding 2's fix: independently reproducible confirmation
data for the slot the round-7 numbers above cannot provide):** run on
this machine on 2026-09-18, `node measure/windows/proof-03-lnk-benchmark.mjs`,
three times in sequence; `measure/windows/proof-03-results.json` restored
via `git checkout --` after each run and confirmed byte-identical to
`HEAD` (`8d88e16051939adefcfc855cc732386e36407ea7` via `git hash-object`)
before the next run and again after the third.

Run 1:
```
--- Timing: warm (n=5, after 1 discarded warmup iteration) ---
Node parser: median 25.67 ms, min 24.19, max 29.13, stddev 1.86 -- raw: [25.67, 25.04, 29.13, 28.00, 24.19]
COM loop-only: median 257.2 ms, min 248.2, max 290.3, stddev 14.5 -- raw: [261.3, 257.2, 290.3, 248.2, 255.3]
Speedup (median of per-iteration COM/Node ratios): median 10.2x, min 8.9x, max 10.6x
Node parser warm median, per-shortcut: 0.1410 ms/shortcut
COM warm median, per-shortcut: 1.4130 ms/shortcut
```
COM-median minus Node-median: 257.2 − 25.67 = **231.53 ms**. Agreement:
170 exact / 0 case-insensitive / 0 realpath / 0 secondary-only / 0
mismatch / 8 no-usable-target-path-source gap, 42 env-var, 12
IDList-only, 1 MSI-advertised, 0 UNC — bit-identical to the canonical
`6932c45` run.

Run 2 (immediately after run 1):
```
--- Timing: warm (n=5, after 1 discarded warmup iteration) ---
Node parser: median 28.63 ms, min 26.65, max 29.34, stddev 1.11 -- raw: [26.70, 26.65, 29.34, 28.63, 28.72]
COM loop-only: median 263.8 ms, min 247.8, max 326.4, stddev 28.0 -- raw: [247.8, 263.8, 326.4, 261.2, 291.8]
Speedup (median of per-iteration COM/Node ratios): median 9.9x, min 9.1x, max 11.1x
Node parser warm median, per-shortcut: 0.1573 ms/shortcut
COM warm median, per-shortcut: 1.4493 ms/shortcut
```
COM-median minus Node-median: 263.8 − 28.63 = **235.17 ms**. Agreement:
identical to run 1 (170/0/0/0/0/8, 42/12/1/0).

Run 3 (immediately after run 2):
```
--- Timing: warm (n=5, after 1 discarded warmup iteration) ---
Node parser: median 29.55 ms, min 24.15, max 34.18, stddev 3.52 -- raw: [29.55, 33.09, 29.14, 34.18, 24.15]
COM loop-only: median 268.4 ms, min 264.6, max 274.1, stddev 3.9 -- raw: [274.0, 264.6, 268.4, 266.6, 274.1]
Speedup (median of per-iteration COM/Node ratios): median 9.2x, min 7.8x, max 11.3x
Node parser warm median, per-shortcut: 0.1624 ms/shortcut
COM warm median, per-shortcut: 1.4745 ms/shortcut
```
COM-median minus Node-median: 268.4 − 29.55 = **238.85 ms**. Agreement:
identical to runs 1 and 2 (170/0/0/0/0/8, 42/12/1/0).

All three savings (231.53 ms, 235.17 ms, 238.85 ms) land inside the
existing 226.5–456.3 ms band without moving either edge, and all three
speedup medians (10.2x, 9.9x, 9.2x, iteration range 7.8x–11.3x) land
inside the existing 7.8x–17x / 5.7x–18x ranges from "Ratio evidence —
canonical statement" above without moving either edge there either — this
round adds confirmation, not a revision, to both figures. **Eighteen
samples across eight review rounds, zero of them outside 0.23–0.46 s.**
This band, not any ratio figure, is what "Decision" motivates PLAT-10
with.

COM's own loop-only time varies substantially both run to run and within a
single warm run. Within-run: this round's canonical run's 5 warm
iterations spanned 339.4–567.1 ms, a 67.1% swing; corroborating run C
spanned 248.1–412.7 ms, a 66.3% swing — both measured BY THIS DOCUMENT,
consistent with round 2's own committed run (230.5–325.6 ms, 41.3% swing)
and round 3's own committed run (281.1–395.8 ms, 40.8% swing), NOT
attributed to the reviewer, who did not report per-iteration warm min/max
in their findings (round-4 major finding 2 fixes the one remaining
sentence in this document that had misattributed this class of
measurement — see "Round-4 revision" item 2 in the "Revision history"
appendix below). Run to run: the
round-3 reviewer's own two re-runs measured COM warm MEDIANS of 441.8 ms
and 321.8 ms — second-hand, not reproducible from this repo — a ~120 ms
difference between two back-to-back re-runs on the same machine, on top of
whatever intra-run variance each of those runs also had; this round's own
five runs (one committed — the canonical `6932c45` run — plus four
uncommitted first-party corroborating runs, round-5 blocker finding 1)
add FIVE more data points to that same picture (COM
warm medians 499.0 ms, 282.4 ms, 263.5 ms, 266.9 ms, 324.1 ms — a ~235 ms
spread of their own, wider than either reviewer pair or either prior
round's single committed run). Other software was running concurrently on
this machine across all of this round's runs (Blender, Adobe Creative
Cloud apps, etc. — see the process list implied by
`.maxvision/research/WINDOWS-STACK.md`). **This document still does NOT
assert whether warming makes COM faster, slower, or has no effect** —
round-3 blocker 3's finding (the two-point comparison's direction flips
between re-runs) is unchanged by anything in round 4. What the data DOES
support, stated without a directional claim: COM's variance is large
enough, and unstable enough in sign and magnitude across runs — now
including a 5.9x–11.3x gap against a THIRD-PARTY prior measurement (the
research baseline — widened from 5.9x–11.1x in round 6, once the round-6
reviewer's second run's 11.3x per-item gap is included), not just
run-to-run variance within this document's
own history — that this benchmark cannot isolate its cause (file-cache
state, PowerShell/COM instantiation jitter, background system load,
machine
differences between the original 2026 research measurement and this
round's runs, or some combination) — and no figure in this document
depends on having isolated it.

Full per-shortcut data, all raw timing iterations, the full flags object
per row, and the new `baseline` comparison fields
(`comWarmMsPerItemMedianThisRun`,
`baselineMsPerItemDividedByThisRunComWarmMsPerItem`,
`baselineTotalReproducedOnThisMachine: false`):
`measure/windows/proof-03-results.json` (regenerated by re-running the
benchmark script; the committed file reflects the canonical run quoted
above).

### The COM baseline: two separate open questions (round-4 major finding 1 retitles this section)

Round 3 filed the entire baseline discrepancy under a single heading, "The
149-vs-182 denominator," which can only ever explain a FILE-COUNT
question. It cannot explain the 5.9x–11.3x per-item rate gap established
above, which is a NUMERATOR question — COM's own measured cost per
shortcut, independent of how many shortcuts are in the set. This document
now separates the two explicitly:

**(A) The file-count (denominator) question — still unreconciled, unchanged
by round 4.** `.maxvision/research/WINDOWS-STACK.md:51` reads "**149
resolvidos** em 2395 ms"; `:235-236` repeats "2395 ms para 149". Taken
literally, "149 resolvidos" (149 *resolved*) reads at least as naturally as
"149 of some larger enumerated set succeeded" as it does "a pre-filtered
input set of 149". This document enumerates 182 `.lnk` files and gets a
non-empty `TargetPath` from COM for 178 of them — neither 149 nor obviously
"182 minus a stated filter."

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
pass. Round-4 does not attempt this reconstruction either — the reviewer's
required fix for round-4 blocker 1 explicitly said not to demand a
re-measurement of the 149 run, since the script simply is not here to
re-run.

**(B) The per-item rate (numerator) question — NEW this round, and this is
the one round 3 mislabeled as (A).** Independent of which file-count
reading is correct, `16.07 ms/shortcut` (`2395 ms ÷ 149`) does not match
what the SAME `WScript.Shell` mechanism measures on this machine today:
this round's five runs (one committed, four uncommitted first-party —
round-5 blocker finding 1) measured COM warm-median per-item rates
of 2.74, 1.55, 1.45, 1.47, and 1.78 ms/shortcut — all roughly an order of
magnitude below the baseline's rate, over a LARGER file count, which is
the opposite of what a denominator effect could produce (see "Measured
result" above for the full comparison table and the reasoning). This
document treats (A) and (B) as genuinely separate open questions: (A)
could theoretically still explain part of the picture (perhaps the
original 149 run measured a differently-composed or smaller set), but (A)
cannot explain (B) by itself, because (B) is a rate disagreement, not a
count disagreement.

**Every figure in this document that divides by 149 is therefore explicitly
flagged as resting on an unreconciled denominator, not a validated one —
and, separately and additionally, as comparing against a total that this
round establishes does not reproduce on this machine via the same
mechanism (B, above):** `16.07 ms/shortcut` (`2395/149`) is the research
doc's own number, restated here for context, not re-derived or extended
into a speedup claim. This document's speedup claim is stated exactly
once, canonically, in "Measured result" → "Ratio evidence — canonical
statement" above (roughly 7.8x–17x at the run-median level across twenty
n=5 runs; no cold/iteration-0 ratio is claimed at all — round-3 blocker
1; round-8 blocker finding 1 removed the 11.6x–16.4x / 8.8x–17.0x figures
this paragraph used to restate here, since both are the same round-5-era
numbers already marked superseded where they are actually stated, in
"Measured result" above). That claim is computed
against each run's OWN
COM measurement (182 shortcuts, both paths, same process, same machine,
same moment) — not against the 149 baseline — specifically to avoid
building a claim on top of either the unreconciled denominator (A) or the
non-reproducing numerator (B). If a reader wants the baseline-relative
number anyway: the benchmark itself now prints and persists
(`thisRun.warm.nodeParserMsPerItemMedian`,
`baseline.comWarmMsPerItemMedianThisRun`,
`baseline.baselineMsPerItemDividedByThisRunComWarmMsPerItem`) the warm
per-shortcut figures directly, instead of requiring hand arithmetic in
this document (round 1 was rejected in part for an ADR-only figure,
"174", that no script printed; this document does not repeat that mistake
with a different number). This round's canonical run: Node warm median
0.2343 ms/shortcut, COM warm median 2.7416 ms/shortcut. Dividing the
original 16.07 ms/shortcut baseline by the Node figure gives ~68.6x
(round 3's equivalent calculation, against a faster Node run that round,
gave ~141.4x) — but this ratio inherits every ambiguity in the 149
denominator (A) above AND the now-established non-reproduction of the
149-run's total (B), and is not asserted as a validated speedup; it is
printed only because a reader might otherwise reconstruct it by hand
against an unreconciled number, which is the exact mistake round 1 made.

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
section in the "Revision history" appendix below for why the two fields
can disagree and why classification
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
| UNC path targets (`CommonNetworkRelativeLink`) | **0** | Implemented (`CommonNetworkRelativeLink` parsing, `\\server\share` reconstruction, both the ANSI and Unicode `NetNameOffset` forks) and, as of round 7, unit- and mutation-tested against two synthetic fixtures — but **not exercised against a real file**: no UNC-targeted shortcut exists in this Start Menu. Not claimed as validated against COM's own UNC resolution. |
| MSI-advertised shortcuts (`HasDarwinID`/`DarwinDataBlock`) | **1** (Topaz Video AI) | Detected (`category.msiAdvertised: true`) but **not resolved** — by design (documented limitation 2). Resolving it needs the Windows Installer API (`MsiGetShortcutTarget`), not a binary read. This is also one of the 8 IDList-only gaps above. |
| UWP/Store app shortcuts | **0** `.lnk` files carry a UWP/Store marker | Real, reproducible finding — see next section, not the correct-by-assumption prose round 1 asserted with no committed artifact behind it. |
| Truncated/corrupt `ExtraData` block (round-4 minor finding 4) | **0** | Detected (`extraDataTruncated` on the parse result, `categoryCensus.extraDataTruncated` in the report) and, if it occurred, unconditionally routed into `unexpectedParserEmptyGapCount` (gates the exit code) — **not exercised on this machine**: none of the 182 real `.lnk` files here have a corrupt `ExtraData` block. Covered instead by a synthetic unit test (a hand-built buffer whose block claims 0x314 bytes with only 20 present) and a mutation-test that confirms the guard actually fails when the fix is reverted — see "Round-4 revision" item 4 in the "Revision history" appendix below. |

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
2. **The ABSOLUTE time saved, which is what PLAT-10 should plan around
   (round-4 blocker finding 1; canonicalized in round 7 — round-7 blocker
   finding 1):** the binary reader saves **0.23–0.46 s per full
   182-shortcut Start Menu scan** on this machine, not the ~2.4 s the
   research baseline's 16 ms/shortcut premise would suggest for a
   similarly-sized set. Eighteen independent samples across all eight
   review rounds land inside this exact band and none has moved either
   edge — see "Measured result" → "Absolute magnitude" above for the full
   sample list and arithmetic. This is the number this Decision leads
   with, specifically because — unlike the ratio in item 3 below — it has
   not required revision in four consecutive rounds.
3. **The ratio (ancillary context, not a planning floor — round-7 blocker
   finding 1):** across twenty-three n=5 runs measured for this ADR over
   eight review rounds, the binary reader has been faster than COM in every
   iteration for which raw per-iteration data survives and faster at the
   run-median level in all twenty-three runs without exception, by a factor
   observed so far to span roughly 5.7x–18x at the single-iteration level
   and roughly 7.8x–17x at the run-median level (full accounting,
   including which rows lack recoverable data and why, in "Measured
   result" above). **This document does not, and after this round
   will not again, publish a minimum from this distribution as a design
   floor:** rounds 5 and 6 each did exactly that (11.6x, then 6.2x/8.3x),
   and both were falsified by the next round's fresh measurement —
   including round 7's own three confirmation runs, one of which
   (6.18x) landed below round 6's just-published floor; round 8's three
   confirmation runs (7.8x–11.3x, medians 10.2x/9.9x/9.2x) did not move
   either extreme. See "Measured
   result" → "Ratio evidence — canonical statement" above for the full
   reasoning, including why a pooled percentile was considered and
   rejected. **PLAT-10 must not plan capacity or set an SLA against any
   number in this paragraph** — use item 2 above instead.
4. A well-defined, honestly-scoped gap (shortcuts with no usable
   target-path source and a non-empty COM target, 8/182 ≈ 4.4% of this
   machine's set) with an unambiguous signal when it occurs
   (`resolvedTargetPath: null`, `category.noUsablePathSource: true`)
   rather than a silently wrong answer — now ALSO covering the
   truncated-`ExtraData` case (round-4 minor finding 4): a corrupt file is
   no longer indistinguishable from an honest coverage gap, even though
   this machine's real data does not exercise that path.
5. A reparse-point-aware directory walk (round-4 major finding 3),
   live-verified with a real NTFS junction in both states on this machine:
   a redirected-profile Start Menu subtree is now reported as a visible
   `WARNING`/`dirErrors` entry and gates the exit code, instead of
   silently shrinking the scanned set with no signal.

**PLAT-10 must keep a COM (or `IShellLinkW`) fallback for the IDList-only
case**, not replace COM outright. When `lnk-parser.mjs` returns no
candidate, PLAT-02/PLAT-10's app enumerator should fall back to COM
resolution for that one shortcut (an 8/182 ≈ 4.4% fallback rate on this
machine). This ADR does not itself implement that fallback — it is a
decision record for PROOF-03, consumed by PLAT-10 (Fase 3).

**Not validated against a real shortcut, flagged for PLAT-10 to re-check
if it matters there:** UNC-targeted shortcut resolution IS implemented
(`parseCommonNetworkRelativeLink`, both its ANSI and Unicode-offset
branches) and, as of round 7, is unit- and mutation-tested against two
synthetic fixtures (round-7 major finding 2) — but no UNC-targeted
`.lnk` exists on this machine's Start Menu, so it has never been checked
against COM's own resolution of a real one; "Category coverage" corrects
an earlier drift where this paragraph read "resolution does not and is
not attempted" (true only of the separate MSI-advertised case below,
never true of UNC — the code already resolved it, just untested).
MSI-advertised shortcut *resolution* is the case where detection works
but resolution genuinely does not and is not attempted (documented
limitation 2, by design — it needs the Windows Installer API, not a
binary read). Both remain present in the codebase as documented,
deliberate gaps, not silent ones. The file-count
(149-vs-182) denominator question above is also still unresolved and
should not be treated as closed by this document — nor should the
SEPARATE finding that the baseline's own total does not reproduce on this
machine (round-4 blocker finding 1) be read as resolving the denominator
question; they are independent open items, per "The COM baseline: two
separate open questions" above.

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
should report 13 tests, 13 pass, 0 fail (round 2 added 7, round 3 added 2
more — the ANSI-branch and `noUsablePathSource` guards — round 4 added 2
more — the `extraDataTruncated` guard and the stale-`expandEnvVars`-cache
regression guard — round 7 added 2 more — the two `CommonNetworkRelativeLink`
/ UNC fixtures, round-7 major finding 2 — and widened an existing fixture's
expansion target to include a space, round-7 minor finding 3, without
adding a test for it).

**Exit code is a real pass/fail signal, not merely mismatches/secondary-
only matches (round-3 minor finding 5).** The benchmark exits 1 if ANY of:
a mismatch, a secondary-only match, a non-empty `dirErrors` (the scanned
Start Menu set was under-counted by a permission, reparse-point-skip —
round-4 major finding 3 added `SKIPPED_REPARSE_POINT` as a `dirErrors`
code, live-verified with a real junction, see "Round-4 revision" item 3
in the "Revision history" appendix below — or other non-`ENOENT` readdir error), or
`unexpectedParserEmptyGapCount > 0` (a parser-empty row not accounted for
by the accepted `noUsablePathSource` gap, OR a row whose `ExtraData` block
was truncated/corrupt regardless of its `noUsablePathSource` value —
round-4 minor finding 4). It exits 0 only when none of those hold —
`idListOnlyGapCount`/`noUsablePathSource` being nonzero (the accepted
8/182 gap) does NOT fail the run; gating on it would make exit 1 the
permanent normal state here. This run: exit code 0. (A separate, real
junction created and removed while preparing this revision produced exit
1 while present and exit 0 once removed — see "Round-4 revision" item 3
in the "Revision history" appendix below for the verbatim output of both
states; that verification run is
deliberately NOT the canonical run this section's numbers are drawn from.)

## Revision history

### Round-8 revision

A rigorous reviewer rejected the round-7 version of this ADR on three
findings.

1. **[blocker, fixed]** Round 7's own fix for round 6's rejection —
   consolidating the ratio into one canonical statement — was itself
   incomplete: two round-5-era paragraphs in "Measured result" (the
   four-run "11.6x–16.4x" paragraph and the ten-sample "8.8x–17.0x"
   paragraph, both above the canonical statement) and one sentence in
   "The COM baseline" → "This ADR's speedup claim" kept restating those
   same superseded ranges in the present tense, with no marker at the
   point of statement — the exact defect the round-6 history entry had
   already been marked to avoid, left unmarked at three other sites.
   Fixed: the two "Measured result" paragraphs are retitled and marked,
   at the point of statement, as historical provenance superseded by the
   canonical statement below them (their specific git-verifiable numbers
   are kept, since they document which individual runs are independently
   reproducible — that provenance record has its own value distinct from
   the ratio headline); "This ADR's speedup claim" is rewritten to strip
   the duplicated numeric ranges entirely and point at the canonical
   statement instead, per the finding's second offered option. The
   canonical statement's own "this is the ONE place this document states
   it" parenthetical is rewritten to name every remaining ratio-range
   site in the file and say why each is historical, rather than merely
   asserting uniqueness — see that parenthetical itself for the full,
   current accounting (a different metric excluded by name, a distinct
   "attributed citation of this paragraph" case for "Decision" item 3 and
   the two other sites that cite these exact figures WITH attribution,
   and four categories — appendix, per-run row, the two superseded
   round-5 paragraphs, the two narrated-as-broken round-6/7 paragraphs —
   for everything else). A first draft of this accounting claimed
   "instead of restating it" for the three attributed-citation sites,
   which was false — they DO restate the figures, just with attribution,
   which is not the defect this finding addresses; caught on self-review
   before this commit and corrected to say so explicitly, along with
   line 114's pre-round-6-widening figure, which the first draft's
   category list did not actually cover, and the round-8 worker
   verification block's own per-run medians, which are genuinely NEW
   numbers (their first appearance in the document), not restatements of
   anything — placed under the same "one specific run's own result"
   category as every other per-run row, not under the attributed-citation
   case, which is reserved for sites restating the canonical paragraph's
   own aggregate range. `grep -n "x–[0-9]"` was re-run against the
   corrected revision; every hit traces to a named case. (These two
   corrections were caught by an independent review of commit `d4daa7d`,
   which already carried this finding's marking/pointer changes but
   stated the parenthetical's coverage claim too strongly; this commit
   corrects the parenthetical itself, not merely this appendix entry's
   description of it.)
2. **[major, fixed]** The three round-7 "fresh confirmation" COM/Node
   medians behind three of the fifteen samples in the 0.23–0.46 s
   absolute-saving band (277.0546/35.407, 264.8426/28.5819,
   286.4326/31.9648) were never quoted verbatim or committed as their
   own artifact anywhere in this repository — `git log --all -S` for
   each of the six numbers returns only this document's own prose,
   introduced directly by `eb260d5` — while the paragraph citing them
   said they were computed "from this section's three round-7 runs
   above," a cross-reference to data that does not exist anywhere in the
   document. Fixed: that dangling cross-reference is removed and the
   round-7 numbers are explicitly labeled by their actual evidentiary
   class — first-party but, like the "Corroborating run A–D" cluster, not
   independently reproducible from anything committed here — and this
   round's own worker re-ran the committed benchmark three more times
   (`node measure/windows/proof-03-lnk-benchmark.mjs`, verbatim stdout
   quoted in "Measured result" → "Round-8 worker verification";
   `proof-03-results.json` restored via `git checkout --` after each run
   and confirmed byte-identical to `HEAD` via `git hash-object` before
   the next run and again after the third) to add three genuinely
   citable samples: 231.53 ms, 235.17 ms, 238.85 ms, all inside the
   existing 226.5–456.3 ms band, bringing the total to eighteen samples
   across eight review rounds. The same three runs' speedup medians
   (10.2x, 9.9x, 9.2x; iteration range 7.8x–11.3x) also land inside the
   existing ratio ranges without moving either edge, confirming rather
   than revising the canonical statement. An independent review of commit
   `d4daa7d` (which added this section but left the canonical statement's
   own run count untouched) caught that these three new n=5 warm runs
   qualify under that statement's own inclusion criteria and would have
   left it stale in the identical shape this round's finding 1 fixes
   elsewhere. This commit corrects it: the canonical statement, its
   recoverable-iteration count, and "Decision" item 3 all now read
   twenty-three n=5 runs / eight review rounds. The recoverable-iteration
   count itself is corrected a second way in the same pass: round 7's
   three worker runs, which `d4daa7d`'s canonical statement counted as
   contributing recoverable raw data, turn out not to — this finding's
   own `git log --all -S` audit established only their medians and an
   iteration-level min/max were ever recorded, never the five raw values
   per run — so they are removed from that count and round 8's three
   runs, whose raw values ARE quoted in full below, take their place;
   the count stays 35-of-115 (up from 35-of-100, since the denominator
   grew) but its membership changed.
3. **[minor, fixed]** "Decision" item 3 pointed to "Measured result"
   → "Ratio evidence — canonical statement" with "below," but that
   subsection is inside "Measured result," which precedes "Decision" in
   this document — the correct word is "above," matching item 2's
   correct cross-reference two lines earlier. Fixed: the word changed;
   no other cross-reference in "Decision" was affected.

`node --test test/windows-lnk-parser.test.mjs`: unaffected by this round
— no test or library file changed, per task rule 3 (round 8 touched only
`docs/adr/0003-proof-03-lnk-binary-parsing.md`).

### Round-7 revision

**Extended, not superseded, by the Round-8 revision above:** round 7
introduced the canonical-statement structure ("Measured result" → "Ratio
evidence — canonical statement") this document still uses, and that
structural design is unchanged. Round 8 found it incompletely applied —
two more sites restating the old numbers without a marker, and one
evidentiary gap in the absolute-saving band — and completed it; round 7's
own measurements described below were not found wrong by round 8, only
the consolidation's coverage.

A rigorous reviewer rejected the round-6 version of this ADR on three
findings.

1. **[blocker, fixed]** Round 6's own fix for round 5's rejection
   (narrowing the floor to 11.6x, then falsified) reproduced the identical
   defect at different numbers: it published `min(observed samples)` —
   6.2x at the iteration level, 8.3x at the median level — as both a range
   endpoint and PLAT-10's design floor. That quantity is monotonically
   non-increasing in N by construction, so it was guaranteed to be broken
   by the next fresh sample, and it was broken TWICE in the reviewer's own
   three re-runs of the committed benchmark: run 2's warm median printed
   8.2x, below the document's then-stated 8.3x median-level floor, and
   run 3's warm median printed 9.0x but its iteration-level min printed
   5.7x (exact value read from the regenerated `proof-03-results.json`
   before it was restored: `thisRun.warm.speedupComLoopOverNode.min =
   5.724901984188925`), below the document's then-stated 6.2x
   iteration-level floor. (Run 1: median 9.4x, min 7.4x, max 10.5x — no
   violation.) The reviewer restored the working tree with `git checkout
   -- measure/windows/proof-03-results.json` and confirmed it
   byte-identical to `HEAD` via `git hash-object`. Fixed with the two
   changes the finding specified: (a) this document stops publishing any sample
   minimum as a floor — "Measured result" now carries ONE canonical
   ratio statement (a new "Ratio evidence — canonical statement"
   subsection) that reports the observed range as a range observed to
   date, explicitly not a bound, and explains why a pooled percentile
   over the full iteration set was considered and rejected (most
   second-hand rows report only a median and min/max, not per-iteration
   raw values, so a percentile over the ~35-of-~100 iterations with
   recoverable raw data would be a new, narrower-sounding overclaim of
   the same shape). This round's own worker independently re-ran the
   committed benchmark three times (not transcribing the reviewer's
   number) and got warm medians of 7.80x/9.60x/10.16x with an
   iteration-level min of 6.18x — again below round 6's just-published
   6.2x floor, cited in the new canonical statement as living
   confirmation of why no minimum is published as a floor anymore. (b)
   The four sites that previously restated the floor independently —
   the corroborating-run table's caption, "Measured result"'s "Corrected
   in round 6" analysis, "Decision" items 2–3, and this "Revision
   history" section's own round-6 entry (preserved below, unedited, as a
   historical record of what round 6 did and why it was itself
   insufficient — its "roughly 6x/8x" planning floor is superseded by
   this entry, not retroactively rewritten) — are folded into that one
   canonical statement: "Decision" and the table caption now point to it
   instead of restating it. "Decision" is reordered so item 2 (the
   absolute-saving band, which the reviewer noted is the one figure that
   has survived four rounds of fresh sampling without moving) leads, and
   the ratio moves to item 3, explicitly marked ancillary context with
   an instruction that PLAT-10 must not plan capacity against it.
2. **[major, fixed]** `CommonNetworkRelativeLink` — the UNC resolution
   path, including the ANSI-vs-Unicode `NetNameOffset` fork at
   `lnk-parser.mjs:262` — shipped as the primary mechanism for UNC
   shortcuts with zero test coverage: no real sample on this machine (the
   Start Menu has none) and, until this round, no synthetic fixture,
   despite this file already hand-building synthetic fixtures for two
   other real-file-unreachable branches (the all-NUL-Unicode ANSI
   env-var fallback, the truncated `ExtraData` block). Fixed: two
   fixtures added to `test/windows-lnk-parser.test.mjs` — one with
   `NetNameOffset == 0x14` (exercises the ANSI-only fork), one with
   `NetNameOffset == 0x1c` (exercises the Unicode-offset fork), the
   latter carrying a deliberately-wrong ANSI `NetName` value so the
   assertion discriminates whether the Unicode fork actually executed,
   not merely whether some candidate was produced. Both assert the
   reconstructed primary candidate is `\\server\share\sub\app.exe`.
   Mutation-tested per this document's own established standard: `sed`
   flipped the `netNameUnicode ?? netName` precedence at
   `lnk-parser.mjs:341` to `netName ?? netNameUnicode` — the Unicode-fork
   fixture failed (`actual: '\\server\WRONG-ANSI\sub\app.exe'`, `expected:
   '\\server\share\sub\app.exe'`), the ANSI-only fixture stayed green,
   exactly discriminating the mutation; separately, `sed` dropped the
   `+ suffix` concatenation (`resolvedUnc = netFull;`) and BOTH fixtures
   failed. Both mutations were reverted (`git checkout --
   measure/windows/lnk-parser.mjs`) and the full suite re-confirmed green
   (13/13) after each. `node --test` before/after: 13/13 clean;
   mutation 1: 12 pass / 1 fail (the Unicode fixture only); mutation 2:
   11 pass / 2 fail (both UNC fixtures). "Category coverage" and the
   "Not validated" paragraph under "Decision" are corrected to say UNC
   resolution IS implemented and now unit/mutation-tested, just not
   exercised against a real file — replacing a pre-existing drift where
   the latter paragraph read "resolution does not and is not attempted"
   for UNC, which was only ever true of the separate MSI-advertised case.
3. **[minor, fixed]** No synthetic fixture in `test/windows-lnk-parser.test.mjs`
   used a path containing a space, despite task rule 5 naming that
   explicitly (the real-machine benchmark does exercise spaces — 93 of
   182 rows in the committed `proof-03-results.json` have one in the COM
   target — but that coverage does not travel to a machine whose Start
   Menu differs). Fixed: the Unicode env-var expansion fixture's
   expansion target changed from `C:\Fake\Expanded\Dir` to
   `C:\Fake\Program Files\Dir` (both assertion sites updated); this is
   the fixture the finding named as the right one, since `%VAR%`
   expansion into a spaced path is where a naive split/quote/trim bug
   would surface. No new test was added, per the finding's own required
   fix. `node --test` test count sentence in "Reproducing this
   measurement" updated from 11 to 13 (the two round-7 UNC tests, not
   this fixture edit, account for the increase) to keep it accurate.

### Round-6 revision

**Superseded by the Round-7 revision above.** This entry records what
round 6 did and why round 7 found it insufficient; its statements about
what "Decision," "Measured result," and the Status line currently say
describe the round-6 document, not this one (in particular: "Decision" no
longer tells PLAT-10 to plan against a full-distribution floor, the
Status line no longer reads "through round 6", and "the new floor is...
min 6.2x" below was itself falsified by this round's own fresh
measurement — see the Round-7 entry above). The floor figures this entry
quotes (6.2x, 8.3x, "roughly 6x/8x") are retained verbatim as the
historical record of the defect round 7 corrected, not as current
guidance — see "Measured result" → "Ratio evidence — canonical
statement" for what currently applies.

A rigorous reviewer rejected the round-5 version of this ADR on three
findings.

1. **[major, fixed]** Round 5 narrowed the headline speedup floor to
   11.6x by selecting the four committed runs out of ten known samples —
   a provenance criterion (did the JSON get committed), not a measurement-
   validity one — and then told PLAT-10 in "Decision" to plan against that
   narrowed 11.6x–16.4x span specifically instead of the wider,
   already-disclosed 8.8x–17.0x range. The reviewer ran the committed
   benchmark twice on their own machine and landed at warm-median
   speedups of 9.306202555722711x and 8.3x — neither reaching the 11.6x
   floor — and reported the same effect on the derived per-item figure
   (their run 2 printed an 11.3x gap, outside the document's then-stated
   5.9x–11.1x band) and on absolute savings (their run 2 saved 227.6 ms,
   which the reviewer read as grazing the document's rounded "0.23 s"
   statement of the floor). Fixed: this round's own worker independently
   re-ran the same committed benchmark twice more (not transcribing the
   reviewer's numbers — see "Measured result" → the "Round-6 worker
   verification" table rows and verbatim stdout) and got warm medians of
   8.6x and 8.6x, also below 11.6x. With two more independently-executed
   n=5 clusters now on record, "Measured result" adds a "Corrected in
   round 6" analysis: the full first-party-and-second-hand distribution
   across all FOURTEEN n=5 warm runs measured for this ADR (four
   committed, four uncommitted first-party round 5, two second-hand round
   3, two second-hand round 6, two first-party round 6) spans **8.3x–17.0x**
   at the median level (down from round 5's 8.8x floor) and **6.2x–18.5x**
   at the individual-iteration level (down from round 5's 7.0x floor —
   the new floor is this round's own worker run 2, min 6.2x). "Decision"
   is rewritten to tell PLAT-10 to plan against this full-distribution
   floor (roughly 6x single-scan, roughly 8x run-median), with the
   committed cluster's 11.6x–16.4x kept in the document as a
   reproducibility anchor, not restated as a planning bound. The per-item
   gap sentences are widened from 5.9x–11.1x to 5.9x–11.3x to include the
   reviewer's run-2 figure. The absolute-saving band is NOT widened —
   the reviewer's 227.6 ms and this round's worker's 227.6–278.6 ms range
   of four new samples all land inside the existing 226.5–456.3 ms
   (0.23–0.46 s) band once compared against the exact millisecond floor
   rather than its one-decimal rounding; "Measured result" now says so
   explicitly instead of leaving the "grazing" characterization
   unaddressed.
2. **[major, fixed]** Both round-5 commits (`b0371c7`, `f85bfb5`) carried
   the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
   instead of the task's required `Co-Authored-By: Claude Opus 5 (1M
   context) <noreply@anthropic.com>`. Fixed by resetting to the parent
   commit (`349a3fd`, untouched — it belongs to a different PROOF and is
   out of this task's scope) and recommitting the same content with the
   correct trailer; verified with `git log -2 --format='%h|%(trailers:
   key=Co-Authored-By,valueonly)'` before this round's own commits were
   made. See this round's commit history for the corrected SHAs.
3. **[major, fixed]** 532 of 1227 lines (43%) sat above `## Context`,
   forcing a PLAT-10 implementer to read four rounds of reviewer-rejection
   narrative before reaching what the document is for, and the Status
   line actively routed readers there first. Fixed: this document is
   reordered to Context → What was built → Measured result → Category
   coverage → Decision → Reproducing this measurement → this "Revision
   history" section (rounds 2 through 6, newest first, every word
   preserved). Every in-document cross-reference that said "below" when
   pointing into what is now this appendix, or "above" when pointing out
   of it toward the operative sections, was corrected for the new
   ordering; no other wording in the round-2 through round-5 narratives
   was changed. The Status line now reads exactly `Accepted (revised
   through round 6 — see "Revision history" below)` and nothing more.


### Round-5 revision (round 5 — superseded by round 6 above)

A rigorous reviewer rejected the round-4 version of this ADR on two
findings, both about mislabeling commits already in this repository —
no re-measurement was needed or performed for either fix:

1. **[blocker, fixed]** The "8.8x–16.4x" headline speedup span was
   twice asserted (at what were then lines 583/600 and 976–983) to come
   from "SEVEN independent... repo-verifiable n=5 runs" or "this round's
   five committed runs." Neither framing survives `git log --format=%h
   -- measure/windows/proof-03-results.json` (six commits total:
   `6932c45`, `14a44ac`, `1fa06ae`, `7819df6`, `9d61338`, `7630634`)
   cross-checked with `git show <sha>:measure/windows/
   proof-03-results.json` on each: only FOUR of those six carry a
   `warm.n === 5` block — `6932c45` (median 11.586x), `7819df6` (median
   13.191x), `1fa06ae` (median 13.770x), `14a44ac` (median 16.428x); the
   other two (`9d61338`, `7630634`) are single-run, pre-warm-block
   commits (see finding 2). This round's own "Corroborating run A–D"
   (this document's "Measured result" table) were never committed as
   their own artifacts — `49af228`'s own commit message documents that
   a post-commit smoke-test run silently overwrote
   `proof-03-results.json` with a different run's numbers before it was
   `git restore`d back to the canonical (`6932c45`) run, and nothing in
   this repository's history or working tree contains A–D's raw JSON.
   And `7819df6` — a genuinely committed n=5 run — was never once cited
   in the "Measured result" or "Decision" sections, despite the
   provenance-audit sentence in "Round-4 revision" item 2 naming it as a
   commit that revision inspected. Fixed: the headline everywhere in
   this document is now **11.6x–16.4x, across the FOUR repo-verifiable
   committed n=5 runs** `6932c45`, `7819df6`, `1fa06ae`, `14a44ac` (each
   independently reproducible right now via `git show
   <sha>:measure/windows/proof-03-results.json`); the "Corroborating run
   A–D" cluster is relabeled everywhere as **first-party, this-session,
   NOT committed** — real, but not independently verifiable by a third
   party from this repository — and quoted separately, never folded
   into the repo-verifiable count. Every dependent figure is corrected
   to match: the factor across the four committed medians' own extremes
   is **1.42x** (16.428 ÷ 11.586), not the 1.86x/1.93x figures computed
   against the uncommitted cluster (those remain, correctly scoped, as
   separate wider-range numbers); the absolute per-scan saving
   (COM-median minus Node-median) recomputed across the same four
   committed runs is still **0.23–0.46 s** (226.5 ms `7819df6`, 254.1 ms
   `1fa06ae`, 289.5 ms `14a44ac`, 456.3 ms `6932c45` — arithmetic on
   `warm.nodeParserMs.median`/`warm.comLoopOnlyMs.median`, already
   present in each committed JSON, not a new run), so the Decision's
   absolute-saving claim now rests on the identical four-run,
   fully-repo-verifiable set as the ratio, rather than partly on the
   uncommitted cluster it previously depended on; and every "seven" /
   "nine" sample-count reference is corrected to "four repo-verifiable"
   (the headline) or "ten total across three provenance classes" (four
   repo-verifiable + four uncommitted first-party + two second-hand
   reviewer-reported — up from round 4's miscounted nine, now that
   `7819df6` is counted). See "Measured result" and "Decision" below for
   every corrected occurrence.
2. **[major, fixed]** The provenance-audit sentence in "Round-4
   revision" item 2 named six commits as "every commit that touched the
   results file": `7819df6`, `1fa06ae`, `49af228`, `ceac0c1`,
   `a1ec19b`, `14a44ac`. Three of those (`49af228`, `ceac0c1`,
   `a1ec19b`) are docs-only commits — `git show --stat <sha> --
   measure/windows/proof-03-results.json` returns nothing for each,
   confirming they never touched that path — while two commits that DID
   touch it, `9d61338` and `7630634`, were left off the list entirely.
   Fixed: that sentence now names the six commits `git log` actually
   returns for this path, states separately that `49af228`, `ceac0c1`
   and `a1ec19b` are docs-only commits inspected for prose changes to
   this ADR (not run data), and notes that `9d61338` and `7630634`
   predate this document's warm-n=5 harness and carry single-run (not
   n=5) timings — 7.61x (`9d61338`) and 7.99x (`7630634`, the original
   `feat` commit) — so a reader who follows the audit instruction and
   inspects all six commits does not land on two unexplained numbers
   below every range this document states.

### Round-4 revision

A rigorous reviewer rejected the round-3 version of this ADR and the
benchmark behind it. One blocker, two major, two minor. All five are
fixed; every number below the "Measured result" heading is from a re-run
executed after every fix in this section, not carried over from round 3.
What changed, in order of severity:

1. **[blocker, fixed]** This document never stated, anywhere in 699 lines,
   that the research baseline's headline total (2395 ms / 149 shortcuts,
   16.07 ms/shortcut) does not reproduce on this machine via the SAME
   `WScript.Shell` COM mechanism — it filed the entire discrepancy under a
   section titled "The 149-vs-182 denominator," which can explain a
   *file-count* difference but cannot explain a `>>5x` gap in the
   *per-item rate itself* (a larger denominator raises COM's TOTAL time;
   it does not cut its per-item rate). Fixed: the "Measured result"
   section now states this plainly, in the same voice used for the
   deleted round-3 cold-ratio claim — see "The COM baseline: two separate
   open questions" below, which replaces and rescopes the old
   "149-vs-182 denominator" section into (A) the file-count question,
   still unreconciled, and (B) a NEW, separate finding: the baseline's
   TOTAL/per-item rate itself does not reproduce here, independent of
   file count. The benchmark script (`proof-03-lnk-benchmark.mjs`) now
   also prints this comparison explicitly at runtime (it did not before)
   and persists it in the JSON report's `baseline` object
   (`baselineTotalReproducedOnThisMachine: false`,
   `comWarmMsPerItemMedianThisRun`,
   `baselineMsPerItemDividedByThisRunComWarmMsPerItem`). The Decision
   section now carries the ABSOLUTE magnitude next to the ratio: the
   binary reader saves roughly a QUARTER TO HALF A SECOND per full
   182-shortcut scan on this machine (measured 0.23–0.46 s across five
   warm n=5 runs this round), not the ~2.4 s the 16 ms/shortcut premise
   would imply for a similarly-sized set — so PLAT-10 does not inherit a
   motivation that is off by an order of magnitude even at this range's
   own high end. See "Measured result" and "Decision" below for the
   actual figures.
2. **[major, fixed]** This document attributed a ~40% intra-run COM swing
   to the reviewer at one point (old text, near the top of the round-3
   section) while a correction 280 lines later, in the same file,
   attributed the SAME finding to this document's own measurements —
   commit `a1ec19b` had fixed only the second occurrence, not the first.
   Fixed: the first occurrence now matches the second (this document
   measured the 40.8% and 41.3% swings; the round-3 reviewer's own
   findings reported only cold and warm-MEDIAN figures, not per-iteration
   warm min/max). Beyond that one sentence, every number in this document
   attributed to "the reviewer" was audited against this repo's git
   history while preparing this revision (`git show <sha>:measure/windows/
   proof-03-results.json` for every commit that actually touches the
   results file, per `git log --format=%h -- measure/windows/
   proof-03-results.json`: `6932c45`, `14a44ac`, `1fa06ae`, `7819df6`,
   `9d61338`, `7630634` — corrected in round 5, see "Round-5 revision"
   finding 2 above; `49af228`, `ceac0c1` and `a1ec19b` are docs-only
   commits that touched this ADR's prose and never that JSON — `git show
   --stat <sha> -- measure/windows/proof-03-results.json` returns
   nothing for each — and do not belong in this list. Of the six that do
   touch it, `9d61338` and `7630634` predate this document's warm-n=5
   harness and carry single-run timings — 7.61x and 7.99x respectively,
   both below every range this document states). That
   audit found the four numbers underpinning the "12.3x–17.0x" headline
   split cleanly into two provenance classes, and this document now labels
   them as such everywhere they appear (not narrowed, not re-ordered — see
   "Measured result" below): **round-2's committed run (median 13.8x,
   n=5 range 12.1x–18.5x) and round-3's committed run (median 16.4x,
   n=5 range 11.6x–18.3x) are independently verifiable RIGHT NOW, by
   anyone, via `git show 1fa06ae:measure/windows/proof-03-results.json`
   and `git show 14a44ac:measure/windows/proof-03-results.json`
   respectively** — re-confirmed while writing this section (1fa06ae:
   median 13.770173159657258, range 12.123749020515275–18.49846907184285;
   14a44ac: median 16.428420846332717, range
   11.591146595843833–18.340596866935094; both match this document's
   prose to the stated precision). **The round-3 reviewer's own two
   re-runs (medians 17.0x and 12.3x) and every cold/first-touch figure
   attributed to the reviewer (2.2x, 12.5x, 310.2 ms, 420.4 ms, 140.72 ms,
   33.74 ms, warm-median COM figures 441.8 ms and 321.8 ms, and the
   observed-spread extremum 9.8x) are second-hand: reported in that
   round's review findings, run on the reviewer's own machine/session, and
   NOT reproducible from anything committed in this repository** — no
   commit in this repo's history contains a results JSON matching those
   numbers. This document does not repeat the round-3 mistake of treating
   all four numbers behind "12.3x–17.0x" as equally verifiable; two are,
   two are not, and this revision says so at every occurrence, not just
   once.
3. **[major, fixed]** `walkLnkFiles` silently dropped any junctioned Start
   Menu subtree — a directory entry that is a reparse point
   (`entry.isSymbolicLink()` true on Windows for both symlinks and NTFS
   junctions) is neither `isDirectory()` nor `isFile()`, so it fell
   through both branches: not descended into, not recorded in
   `dirErrors`, no `WARNING` line, `process.exitCode` still 0. This is
   exactly the shape folder redirection uses (roaming profiles, OneDrive
   Known Folder Move, GPO redirection of `%APPDATA%`/`%LOCALAPPDATA%`), so
   a redirected-profile machine would have silently under-counted its Start
   Menu while the report printed a confident, clean-looking file count.
   **Fixed and live-verified on this machine**, both directions:
   `walkLnkFiles` now records a symlink/junction entry into `dirErrors`
   with a distinct code, `SKIPPED_REPARSE_POINT`, which reaches both the
   `WARNING` line and the exit-code gate — the same treatment any other
   under-count already gets. It is deliberately NOT followed (no
   realpath loop-guard needed as a result): a reparse point can point
   outside either scanned root or form a cycle, and this benchmark's job
   is to report what it did NOT scan, honestly, not to silently widen its
   own scope. Verified with a real NTFS junction, not just synthetically:
   `mklink /J` created
   `%APPDATA%\...\Start Menu\Programs\DecktechTestJunction` pointing at
   `%ProgramData%\...\Start Menu\Programs\Git` (4 real `.lnk` files behind
   it). With the junction present: `Enumerated 182 .lnk files` (unchanged
   — the junction subtree was never walked, so it added nothing silently
   either way), `WARNING: 1 directory enumeration error(s)` printing
   `...DecktechTestJunction -- SKIPPED_REPARSE_POINT: entry is a
   symlink/junction (reparse point); not followed, not descended into`,
   and `process.exitCode` **1**. With the junction removed immediately
   after: `Enumerated 182 .lnk files`, no `WARNING`, exit **0** — the
   clean state returns exactly. Both runs' verbatim output are what
   established this; see "Measured result" below for the canonical
   (no-junction) run this ADR's numbers are drawn from.
4. **[minor, fixed]** `parseExtraData` silently stopped on a truncated or
   size-lying `ExtraData` block, degrading a corrupt file into the same
   `envBlock: null` shape a genuinely clean IDList-only shortcut produces
   — which the benchmark then classified into `noUsablePathSource`, the
   ONE bucket the exit-code gate deliberately does not fail on (it is the
   accepted, honest coverage gap). A corrupt file was thereby
   indistinguishable from a shortcut the parser honestly abstains on.
   Fixed: `parseExtraData` now distinguishes a legitimate `TerminalBlock`
   (`BlockSize < 4`, the spec's own end-of-list marker — sets nothing
   extra) from a block whose self-reported `BlockSize` does not fit the
   remaining buffer (truncation or a lying size field — sets `truncated:
   {offset, claimedBlockSize, bufLength}`). Surfaced on `parseLnk`'s
   return value as `extraDataTruncated` (`null` when not truncated). The
   benchmark now routes any row with a non-null `extraDataTruncated` into
   `unexpectedParserEmptyGapCount` UNCONDITIONALLY — even one that also
   happens to satisfy `category.noUsablePathSource` — so it always gates
   the exit code, and prints a dedicated `WARNING` line
   (`categoryCensus.extraDataTruncated`) regardless of whether the row was
   `parser-empty` at all (a row can have a truncated `ExtraData` block
   AND still resolve via `LinkInfo`, in which case it is not a coverage
   gap but must still be visible). Covered by a new synthetic test (a
   buffer whose `ExtraData` block claims the full `0x314`-byte
   `EnvironmentVariableDataBlock` size but has only 20 bytes actually
   present) asserting `extraDataTruncated.offset`,
   `.claimedBlockSize`, and `.bufLength` are all set correctly. Verified
   by mutation exactly as this document's own established standard
   requires: the `truncated = {...}` assignment was commented out, the
   suite re-run, and exactly the one new test failed
   (`AssertionError: extraDataTruncated must be set (non-null)...`); the
   mutation was reverted and the full suite re-confirmed green (see
   "Verifying the round-4 fixes" below). **Not triggered on this
   machine's real data**: `categoryCensus.extraDataTruncated: 0` this
   run — none of this machine's 182 real `.lnk` files have a corrupt
   `ExtraData` block, so this fix changes nothing about this machine's
   reported numbers, only what a future corrupt file on a different
   machine would be classified as.
5. **[minor, fixed]** `expandEnvVars`'s module-level key cache (introduced
   by round-2 minor finding 10a as a performance fix) was populated once,
   on whichever call happened first, and never refreshed for the rest of
   the process's life — so a call made before the environment was fully
   populated (dotenv running late, a long-lived server still finishing
   startup, `PATH` being extended after launch) would permanently and
   SILENTLY lock in an incomplete keyset, and every later
   `%ProgramFiles%\...`-shaped shortcut would resolve to the raw,
   unexpanded `%VAR%` literal with no error — the exact output shape
   round-2 blocker 1 was rejected for producing, reached again through a
   different door. **Fixed by dropping the cache entirely**, per the
   reviewer's first suggested option, after measuring rather than
   assuming the round-2 concern it was originally added for: the map is
   now rebuilt fresh on every `expandEnvVars` call. Measured cost on this
   machine's real data (182 files, 42 of them env-var shortcuts, each
   triggering at most one rebuild): the warm Node-parser median moved from
   round-3's committed 20.69 ms to this round's five runs' 28.86–42.63 ms
   — an increase, but one that includes ALL round-4 changes together (the
   new `isSymbolicLink()` check per directory entry, the `ExtraData`
   truncation bookkeeping, AND the cache removal), not the cache removal
   in isolation, and it is still under 250 microseconds per shortcut
   end-to-end (0.16–0.23 ms/shortcut warm median this round vs round-3's
   0.11 ms/shortcut) — "ample headroom," exactly as the reviewer
   predicted, not a regression that changes this ADR's speedup conclusion
   (see "Measured result" below: COM's own warm time still dwarfs Node's
   by close to an order of magnitude every run this round). Covered by a
   new regression test that calls `expandEnvVars` once BEFORE a variable
   is set (must fall through to the raw string, same as any genuinely
   unknown `%VAR%`) and once AFTER (must expand) — the exact shape that
   would fail if the cache ever returns. Verified by mutation: a
   module-level cache was reintroduced (`let __mutationCache = null;` /
   populate-once-return-cached), the suite re-run, and exactly the new
   test failed, reproducing the precise failure mode this fix prevents
   (`actual: '%DECKTECH_TEST_LNK_VAR_LATE%\\x'`, `expected:
   'C:\\Late\\Value\\x'`); the mutation was reverted and the full suite
   re-confirmed green.

**Verifying the round-4 fixes:** `node --test test/windows-lnk-parser.test.mjs`
reports 11 tests, 11 pass, 0 fail (round 2 added 7, round 3 added 2, round
4 adds 2 more — the `extraDataTruncated` guard and the stale-cache
regression guard). Both new tests were confirmed to fail under their
respective mutation before being confirmed green after revert, the same
mutation-testing standard round 2's and round 3's fixes were held to.

### Round-3 revision

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
   run to run — round-2's own committed run (`git show
   1fa06ae:measure/windows/proof-03-results.json`: COM warm 230.5–325.6 ms,
   a 41.3% swing) and round-3's own committed run (`git show
   14a44ac:measure/windows/proof-03-results.json`: COM warm 281.1–395.8 ms,
   a 40.8% swing) BOTH measured a ~40% swing WITHIN a single warm run —
   two DIFFERENT committed runs from two DIFFERENT rounds of this document,
   re-confirmed against git history while preparing this round-4 revision,
   not "this document's own two committed runs" as an earlier draft of
   this sentence read (round-4 major finding 2 fixes this sentence to
   match the correction already present 280 lines later in round 2's own
   revision section: the reviewer's findings reported only cold and
   warm-MEDIAN figures, never per-iteration warm min/max, so a within-run
   swing was never something the reviewer could have reported in the
   first place), and the cold-vs-warm ORDERING itself is not stable across
   runs — which is itself the reason this document does not derive a
   causal claim from it, in either direction.
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

### Round-2 revision

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

