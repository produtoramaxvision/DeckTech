# PROOF-04 — Exclusion rule for uninstaller entries in the Windows app scan

**Status:** Accepted
**Date:** 2026-09-17
**Machine:** Windows 11 Pro 22631, x64 (this machine)
**Requirement:** `PROOF-04` (`.maxvision/REQUIREMENTS.md`), Phase 0 success criterion 4
(`.maxvision/ROADMAP.md`)

**Round 4 (this revision).** A rigorous review rejected round 3 on three
findings, all addressed here:

1. **[major] Anchoring (`^`/`$`) and case-insensitivity (`/i`) — the two
   mechanisms `UNINSTALLER_BASENAME_PATTERNS`'s own header and
   `isUninstallerEntry`'s own JSDoc name as load-bearing — were untested on
   every single regex in the module.** Dropping `^` and `$` from all four
   basename patterns individually, and dropping `/i` from those same four
   patterns plus `MSIEXEC_BASENAME`, all left the round-3, 14-test suite
   green (11 surviving mutants, measured by the reviewer). Worse, the
   ADR's headline false-positive fixture (CrystalIdea's "Uninstall
   Tool.exe") does not discriminate anchored from unanchored matching at
   all, because the substring `"uninstall.exe"` never appears contiguously
   in it — the central precision/recall argument in §3 was defended by a
   fixture that would also pass under the unanchored design §3 argues
   against. **Fixed:** 4 new fixtures in
   `test/windows-uninstaller-rule.test.mjs` (18 tests total, up from 14) —
   see §9.1's corrected sentence and the new §9.1b for the full,
   scripted re-run of every anchor/case mutation the finding named, plus
   two more (`^`-only and `$`-only, not just the combined `^`+`$` drop the
   reviewer tested) and two `/i` sites the reviewer's own required-fix list
   did not name (`EXACT_UNINSTALL_NAME`, the `.exe` guard clause) — all 18
   mutations killed, verified below, not claimed.
2. **[major] `resolveAppList`/`dedupeByTarget` threw a bare `TypeError` on
   a null/empty `target`** — an input shape `isUninstallerEntry`'s own
   JSDoc documents as valid and a green test already pinned at the
   predicate level (`isUninstallerEntry({target: null}) === false`), but
   which `partitionUninstallers` then hands straight to `dedupeByTarget`,
   which called `entry.target.toLowerCase()` unconditionally. Not
   reachable through `scan-apps.mjs` today (it pre-filters non-string
   targets before calling `resolveAppList`), but a live crash risk in the
   exact module this ADR's own §2 names as the one Phase 3's win32
   `apps.js` provider will import directly — which will not necessarily
   have that same pre-filter. **Fixed:** `dedupeByTarget` now passes an
   unkeyable `target` (null, undefined, missing field, or `""`) through
   untouched — one row per such entry, never collapsed against another
   unkeyable entry or a keyed one — documented in `dedupe-target.mjs`'s
   header and pinned by five new tests in the new
   `test/windows-dedupe-target.test.mjs` (also closing a second,
   independent gap the same finding measured: removing `.toLowerCase()`
   from the case-insensitive-NTFS-key logic left the round-3 suite green
   too — see §9.6). `resolve-app-list.mjs`'s and `uninstaller-rule.mjs`'s
   JSDoc were cross-checked and updated to state the same contract for
   this input shape, so the three modules cannot drift apart silently
   again.
3. **[minor] Three source-line citations, in files edited by round 3
   itself, pointed at the wrong lines** — `measure/windows/scan-apps.mjs`
   cited `uninstaller-rule.mjs:36,107` (twice) for the win32 `basename()`
   call, actually at line 110 at the time; `test/windows-uninstaller-rule.test.mjs`
   cited a win32 import at "(line 19)", actually at line 36; and cited
   `uninstaller-rule.mjs:95` for a conjunction, actually at line 115. A
   comment edit anywhere above any of these shifts every line number below
   it, which is exactly what produced the drift. **Fixed:** all three
   citations now name the symbol (`isUninstallerEntry`'s `basename()`
   call, the module's own top-of-file win32 import, the `.exe`-guard
   conjunction inside `isUninstallerEntry`) instead of a line number, per
   the reviewer's own suggested alternative — a citation that does not rot
   as these heavily-commented files keep growing.

**Round 3.** A rigorous review rejected round 2 on four
findings, all addressed here:

1. **[blocker] `basename` was imported from host-dispatched `node:path`,
   not `node:path/win32`.** The rule module's own header claimed "no
   platform calls" while calling `basename()` — a platform call — and the
   test file's header claimed the suite "runs on any OS" without that being
   true: on a POSIX host, `node:path`'s `basename` dispatches to
   `path.posix.basename`, which does not split on `\`, so every
   backslash-only Windows-path fixture stops matching. This repo's own
   `.github/workflows/test.yml` runs `npm test` (`node --test`, all of
   `test/`) on `ubuntu-latest`, so the gap was live. **Fixed:**
   `measure/windows/lib/uninstaller-rule.mjs:36` now imports from
   `node:path/win32` explicitly — a module whose behavior does not vary by
   host OS, verified directly (`node:path/win32`'s `basename()` on
   `"C:\\Program Files\\Some App\\unins000.exe"` returns `"unins000.exe"`
   regardless of host, vs. `node:path/posix`'s `basename()` returning the
   whole string unchanged). Both module and test headers were rewritten to
   state this accurately instead of the false "no platform calls"/"any OS"
   claims. A new fixture ("pina a semântica win32 do path...") pins the
   coupling directly, importing both `node:path/win32` and
   `node:path/posix` and asserting they diverge for the fixture's input
   before asserting the rule's own behavior — see §9 for the reproduction
   of the original defect against a simulated-POSIX copy of the module
   (14 tests / 8 pass / 6 fail) and confirmation the fixed module is immune
   to that same simulation, by construction: it no longer depends on host
   dispatch at all. **Scope note, stated plainly:** this fix makes *this
   suite* host-OS-independent. It does not by itself confirm `npm test`
   (all of `test/`, 30+ files) is green on `ubuntu-latest` — no WSL/Linux
   Node was available on this machine to check that broader claim, and it
   is out of this ADR's scope (PROOF-04 only).
2. **[major] `dedupeByTarget` ran before `partitionUninstallers`,**
   silently discarding the `arguments` of every shortcut but the first
   walked at a shared target — starving the msiexec branch (decided purely
   on `arguments`) for any target with 2+ shortcuts whose args differ. The
   two real msiexec entries on this machine survived only because they sit
   at different paths (System32 vs SysWOW64) — luck, not design. **Fixed:**
   see §4c below — the pipeline now partitions on `resolved` (every
   individual shortcut) first, then dedupes the `kept` survivors, via the
   new `measure/windows/lib/resolve-app-list.mjs`. PLAT-02's "dedupe por
   target path" requirement is preserved for the final list; only its
   position in the pipeline moved. A new test file,
   `test/windows-dedupe-order.test.mjs`, pins this in **both** shortcut
   walk orders so neither passes by the accident of directory-walk order
   that let round 2 through.
3. **[minor]** The Inno Setup basename pattern is narrower than the
   ROADMAP's `unins*.exe` glob — documented explicitly in §3, with a
   measured (not reasoned) check added to `scan-apps.mjs`'s own output
   confirming no basename on this machine falls in that gap today.
4. **[minor]** A prior PROOF-04 commit's trailer used the wrong
   co-author line. See "Commit trailer note" at the end of this document —
   this revision's own commit carries the required trailer; fixing the
   **prior, already-buried** commit safely was blocked by a live
   concurrent writer on this branch at the time of this round, and is
   recorded rather than forced — see that note for the evidence.

**Round 2.** A rigorous review rejected round 1 on four
findings, all addressed here: (1) the exact-name exception's `.exe` guard
clause had zero test coverage, fixed with a pinning fixture plus per-clause
(not whole-function) mutation proof in §9 — extended, on self-review, to two
more clauses the review didn't name (the input guard, the name-trim) so the
table covers every clause the function contains, not only the ones the
reviewer happened to test; (2) §6's reconciliation of this probe's counts
against `WINDOWS-STACK.md` §6.1 asserted an unmeasured and wrong mechanism,
misattributed the source section, and gave a false reason for not validating
further — replaced with the actual measured reconciliation in §6.1 below;
(3) `scan-apps.mjs` swallowed every shortcut-resolution error and
enumeration failure silently — fixed, see §6's unresolved-shortcut reasons
and directory-error count, both verified to actually fire against a forced
failure, not just present in the code; (4) the probe hardcoded Start Menu
paths and hand-rolled backslash regexes instead of
`[Environment]::GetFolderPath` and `path.basename()` — fixed, see §5 and
§6.1 (including the two wrong `GetFolderPath` enum values tried first and
rejected on measurement before the correct ones were adopted, and a
basename-vs-full-path regex narrowing caught and corrected in the same pass,
see §5).

> Evidence convention: every number below is `[MEASURED]` (produced by running
> `node measure/windows/scan-apps.mjs` on this machine, full output in
> §"Real scan — before/after") or `[REASONED]` (a design decision, not a
> measurement). Nothing here is asserted without having been run.

## 1. Problem

The real scan of this machine (`.maxvision/research/WINDOWS-STACK.md` §6.1)
produced 122 "unique" apps after deduping `.lnk` shortcuts by resolved target
path — but one of them was garbage:

```
Uninstall DJI Assistant 2  ->  unins000.exe
```

Deduping by target path does not remove it: it is a distinct target from every
real app, so nothing collapses it. A separate exclusion rule is required.

## 2. Decision

Match the shortcut's **resolved target basename** against a narrow, exact-match
allowlist of uninstaller-binary names, plus two narrowly-scoped exceptions
(display name, and `msiexec.exe` arguments) found necessary by running the
rule against this machine's real data. The rule and its test live in:

- `measure/windows/lib/uninstaller-rule.mjs` — the predicate (`isUninstallerEntry`)
  and a small partition helper (`partitionUninstallers`), pure functions, no I/O.
- `test/windows-uninstaller-rule.test.mjs` — 13 `node:test` cases.
- `measure/windows/scan-apps.mjs` — the Phase 0 probe that runs the real scan
  and applies the rule, printing before/after counts and every excluded entry.

**Scope note.** Per the task's rule 3, `apps.js` (production code) is
untouched — Phase 0 builds proof, not the shipping provider. Phase 3
(`PLAT-02`, the future Windows `listInstalledApps` provider) is the intended
consumer of `measure/windows/lib/uninstaller-rule.mjs`; nothing here is
throwaway.

## 3. Why basename, not display name — the precision/recall tradeoff

**Chosen: precision-favoring.** The rule keys on the resolved **target's**
basename (an installer framework's own naming convention — `unins000.exe`,
`uninst.exe`, …), which is a name space uninstaller binaries occupy almost
exclusively. It deliberately does **not** match by substring on the
shortcut's **display name** containing "uninstall".

The concrete reason: a substring rule on the display name would drop a real,
shipping product. **CrystalIdea's "Uninstall Tool"** ships its own executable
literally named `Uninstall Tool.exe` — a general-purpose third-party
uninstaller utility, sold as an app in its own right. A shortcut named
"Uninstall Tool" pointing at `Uninstall Tool.exe` is not leftover install
debris; it is the entire product. A rule that excludes "anything containing
uninstall" removes it. The basename-exact-match rule here does not, because
`Uninstall Tool.exe` is not an exact match for any pattern in
`UNINSTALLER_BASENAME_PATTERNS` (`/^unins\d*\.exe$/i`, `/^uninst\d*\.exe$/i`,
`/^uninstall\.exe$/i`, `/^uninstaller\.exe$/i` — all anchored, whole-basename).

This machine's own data makes the same point without a hypothetical: it has
**IObit Uninstaller**, a real installed app whose entire purpose is
uninstalling other software `[MEASURED]`:

```
[KEPT]      IObit Uninstaller            -> ...\IObit Uninstaller\IObitUninstaler.exe
[EXCLUDED]  Uninstall IObit Uninstaller  -> ...\IObit Uninstaller\unins000.exe
```

Both shortcuts have "uninstall" in the name. Only the second is actually
debris — the tool's own auto-generated uninstall entry — and only the second
is removed. This is the rule working as designed, confirmed by measurement,
not assumption.

**Cost of this choice, stated plainly:** the rule accepts a **recall gap**. An
uninstaller binary named something the allowlist does not recognize (e.g. a
bespoke installer framework's `Remove Foo.exe`) survives the filter. That is
the deliberate tradeoff: false negatives (some debris survives) over false
positives (a real app disappears from the user's dock picker). Given the
product surface — a dock the user manually curates, not an automated cleanup
tool — a surviving junk entry costs the user one ignored picker row; a missing
real app costs them a broken workflow. Precision wins.

**Round-3 finding 3, addressed explicitly here (documentation only, per the
review's own required fix — no code change):** `UNINSTALLER_BASENAME_PATTERNS`
is deliberately **narrower**, as a set, than the ROADMAP's own success
criterion glob (`unins*.exe`, `.maxvision/ROADMAP.md`'s Phase 0 wording).
Concretely: `/^unins\d*\.exe$/i` (the Inno Setup pattern alone) would miss a
basename like `uninsHelper.exe` or `unins_old.exe` — both match the
ROADMAP's `unins*.exe` glob but not this one pattern. This is the same
precision-over-recall tradeoff as the rest of this section, applied to the
pattern list specifically: the basename patterns cover every concrete case
this machine's real data has shown so far, not the full space the glob
describes. This is not a silent gap — `measure/windows/scan-apps.mjs`'s
independent sanity check (§6, "any AFTER entry whose target basename
matches `unins*.exe`?") is deliberately **broader** than the rule's own
patterns and is applied to `kept` (i.e., to the whole rule's verdict, not
just the basename-pattern clause), so a future basename in the gap surfaces
there as a visible `FAIL`, not a silently-passing rule.

Checked directly, not left as a documentation-only claim: comparing the
broad glob against the *union* of `UNINSTALLER_BASENAME_PATTERNS`
specifically (not just the whole rule) does find one basename in that
narrower gap on this machine today — `Uninstall atkAudio Plugin.exe`
(`/^unins.*\.exe$/i.test("Uninstall atkAudio Plugin.exe")` is `true`;
`/^unins\d*\.exe$/i`, `/^uninst\d*\.exe$/i`, `/^uninstall\.exe$/i`,
`/^uninstaller\.exe$/i` are all `false` against it — verified with `node -e`,
not asserted). This is exactly why §4a's exact-name exception exists: it is
what actually catches that entry, not a basename pattern, and it is why
this section states the tradeoff as a *pattern-list* limitation rather than
a whole-rule one — the whole rule's own verdict is `PASS — none` (§6). No
separate runtime diagnostic for this narrower, patterns-only comparison was
kept in `scan-apps.mjs`: an earlier draft added one, and it printed a
`NOTE` line at the tail of the probe's own output for this exact,
already-explained, non-issue — a shape indistinguishable at a glance from
an unresolved finding. Removed in favor of stating the fact here, once,
where it has room for the explanation it needs. **The regex is not widened
speculatively** — per rule zero, that only happens when a real observed
case demands it.

## 4. Two rule extensions, both required by what this machine's real data showed

Both were added only after the basename-only rule left real garbage in the
`AFTER` list on the first run — not spec'd in advance, added because the
measurement showed they were needed (rule zero: validate before asserting).

### 4a. Exact display-name match on the bare word "Uninstall"

First run's `AFTER` list still contained:

```
Uninstall  ->  C:\ProgramData\obs-studio\plugins\Uninstall atkAudio Plugin.exe
```

An OBS Studio plugin's leftover uninstaller. Its target's basename
(`Uninstall atkAudio Plugin.exe`) carries the plugin's product name, so it
matches none of the basename patterns. But its shortcut's **display name** is
exactly, and only, the word `Uninstall` — nothing else attached.

This is added as a second, narrow condition: `entry.name.trim()` case-insensitively
equal to `"uninstall"` (not "contains"), combined with the target ending in
`.exe`. This is safe against the false positive in §3 precisely because it is
equality, not substring: `"Uninstall Tool"` and `"UninstallGuard Pro"` both
fail an exact-equality check against `"uninstall"` — no legitimate product is
plausibly named literally just "Uninstall". Verified in the test suite
(`o match exato de nome 'Uninstall' não vira substring...`).

**Known residual gap, stated rather than hidden:** this exact-name check is
English-only. `"Desinstalar o MPC-HC"` (Portuguese, seen on this machine) is
already caught by the basename rule (`unins000.exe`), so it did not force a
localized bare-word check — but a hypothetical shortcut named exactly
`"Desinstalar"` with a non-`unins*` target would not be caught. Not built,
because no entry on this machine required it — building it speculatively
would be exactly the un-grounded gap this task warned against.

### 4b. `msiexec.exe` with an uninstall verb in its arguments

The task explicitly asked to check this direction. This machine's data has it
`[MEASURED]`:

```
Uninstall Go        -> C:\Windows\System32\msiexec.exe  args="/x {5370C587-5FA3-4F85-8287-6483B693690C}"
Uninstall Node.js    -> C:\Windows\SysWOW64\msiexec.exe  args="/x {34499F1F-2970-4D10-9161-55FB08B9FE2D}"
```

`msiexec.exe` is a generic MSI engine shared by installs, repairs, *and*
uninstalls — unlike `unins000.exe`, whose name only ever means "uninstall",
`msiexec.exe`'s name says nothing about intent. Excluding it by basename alone
would drop legitimate apps launched via `msiexec /i ...` shortcuts. The rule
therefore inspects `entry.arguments` and only excludes when it carries the MSI
uninstall verb `/x` or its long form `/uninstall` (`/(^|\s)\/(x|uninstall)\b/i`)
— never `/i`, `/package`, `/fa`, `/j`, or a bare/empty argument string, all of
which are install/repair/advertise verbs and are left alone (tested explicitly
in "FALSO POSITIVO evitado: msiexec.exe sem verbo de desinstalação").

Both real `msiexec.exe` shortcuts on this machine carry `/x`, are confirmed
uninstall entries (Go and Node.js's own MSI uninstallers), and are excluded.

**Checked, not assumed:** both real entries happen to write `/x {GUID}` with a
space before the brace. `msiexec /x{GUID}` (no space) is equally valid MSI
syntax and was not present on this machine, so it would have been a silent
gap if left untested. It is not — the regex uses a `\b` word boundary after
the verb rather than requiring trailing whitespace, and
`isUninstallerEntry({ target: "...msiexec.exe", arguments: "/x{GUID}" })` is
asserted `true` in the test suite (§9's re-run below reflects this version of
the rule).

### 4c. Pipeline order: the exclusion rule must run BEFORE dedupe-by-target (round-3 finding 2)

§4b's msiexec analysis decides purely on `entry.arguments` — but the probe's
pipeline, until this round, ran `dedupeByTarget(resolved)` **before**
`partitionUninstallers(deduped)`. `dedupeByTarget` keys only on
`entry.target.toLowerCase()` and keeps the **first** shortcut the directory
walk visits for a given target, discarding every sibling's `arguments`
entirely. The msiexec branch is therefore fed a set from which the one
field it needs has already been thrown away for every target with 2+
shortcuts.

**Why this was not caught by this machine's real scan before:** the two
real msiexec entries here (`Uninstall Go`, `Uninstall Node.js`) happen to
resolve to *different* paths (`System32\msiexec.exe` vs
`SysWOW64\msiexec.exe`), so neither collapsed the other. That is an
accident of which architecture-specific `msiexec.exe` each shortcut
targets, not evidence the ordering was safe. The failure mode this leaves
open, stated concretely: two MSI shortcuts at the **same** `msiexec.exe`
path, one `/i {GUID}` (a legitimate install/repair shortcut) and one
`/x {GUID}` (its own uninstall entry). Whichever the directory walk visits
first wins the target under the old order — if it's the `/x` shortcut, its
arguments get applied to the survivor and the legitimate `/i` shortcut is
gone from the list before the rule ever saw its own arguments. This is
precisely the false-positive class §3 is built to prevent, reached through
a different door (dedupe, not the rule's own logic).

**Fixed:** the exclusion rule now runs on `resolved` — every individual
shortcut, each with its own `arguments` — **before** any dedupe, via the new
`measure/windows/lib/resolve-app-list.mjs#resolveAppList()`. Only the
`kept` survivors are then deduped by target. This still satisfies PLAT-02's
locked "dedupe por target path" requirement for the final app list
(`.maxvision/REQUIREMENTS.md:56`) — `dedupeByTarget`'s own semantics are
byte-for-byte unchanged (extracted, not rewritten, into
`measure/windows/lib/dedupe-target.mjs`) — only *when* it runs relative to
the rule moved. `excluded` is intentionally left un-deduped in the new
pipeline: collapsing it would hide exactly the kind of duplicate-shortcut
interaction this fix exists to stop discarding silently.

**Pinned with a test that does not depend on this machine's luck:**
`test/windows-dedupe-order.test.mjs` constructs two synthetic shortcuts at
the identical `msiexec.exe` path — one `/i`, one `/x` — and asserts the
legitimate `/i` shortcut survives in **both** possible directory-walk
orders (`/i` first, and `/x` first — the order that would have broken the
old pipeline). A third test in the same file directly demonstrates the old
bug using the extracted `dedupeByTarget` primitive alone, as a permanent
record: deduping the two-shortcut fixture BEFORE any rule sees it collapses
to one entry, and that entry carries the `/x` shortcut's arguments when
`/x` is walked first — the `/i` shortcut's own arguments are gone before
any rule runs. See §9 for the full re-run.

**Re-run against this machine's real data:** applying the fixed order to
this machine's actual 178 resolved shortcuts produces the **same** kept/
excluded counts as before (138 kept, 10 excluded) — see §6's refreshed
output. That is expected and reported plainly, not adjusted to look more
dramatic than it is: this machine genuinely has no two shortcuts sharing an
msiexec (or any other) target with differing arguments today (verified —
§6's new "msiexec.exe targets" block still shows exactly 2 hits, at 2
distinct paths). The fix closes a real correctness gap in the pipeline's
design without this machine's data being able to demonstrate the gap
firing; the synthetic test above is what demonstrates it.

## 5. Windows path handling (rule 5)

The rule and its tests use `path.basename`, never a hand-rolled string split
on `\`, and the test suite includes a fixture with a space in the directory
name (`C:\Program Files\Some App\unins000.exe`) plus real machine paths that
contain spaces and parentheses (`DJI Assistant 2 (Consumer Drones Series)`).

**Round-2 fix:** `measure/windows/scan-apps.mjs` itself did not hold this
standard consistently — its two diagnostic regexes (the msiexec-hit filter
and the `unins*.exe` sanity check) matched `(^|\\)pattern$` against the full
target path by hand instead of calling `basename()` first, the exact
inconsistency this section claims does not exist. Both now call
`node:path`'s `basename()` before matching, same as the rule module. The
probe's Start Menu directories were also switched from a hardcoded
`Join-Path` to `[Environment]::GetFolderPath`, so Group Policy Start Menu
redirection is honored — see §6 for the two wrong enum values tried first and
rejected on measurement, and the correct ones verified against this machine.

**Self-caught regression while doing this fix:** the first draft of the
`unins*.exe` sanity check's basename version used `/^unins[^.]*\.exe$/i` —
translating the old check's "no backslash" character class to "no dot"
looked equivalent but narrowed it: `[^.]*` rejects any dot before the final
`.exe`, so a basename like `unins.v2.exe` (still `unins*.exe` by the
ROADMAP's own glob, still no backslash) would stop matching, silently
weakening the very sanity check that proves the ROADMAP success criterion.
Checked before it shipped: `/(^|\\)unins[^\\]*\.exe$/i` on the full path
matches `unins.v2.exe`; `/^unins.*\.exe$/i` on the basename matches it too
(and still rejects `notunins.exe`) — `.*`, not `[^.]*`, is the faithful
translation. Fixed to `/^unins.*\.exe$/i` before commit.

## 6. Real scan — before/after (this machine, 2026-09-17)

Command: `node measure/windows/scan-apps.mjs` (Windows 11 Pro 22631, this
machine). Full verbatim output (round-3 version of the probe — see §4c and
§5 for the pipeline-order and path-semantics fixes since round 2's run).

**Re-run fresh for round 4** (not carried forward from round 3's run):
round 4 did not change scan-apps.mjs's scan logic (only two source-line
citations in its comments, finding 3) or `isUninstallerEntry`'s matching
behavior (only test coverage, finding 1) or `resolveAppList`'s composition
(only `dedupeByTarget`'s handling of a `target` shape scan-apps.mjs itself
never produces, since its own line-141 filter already excludes non-string
targets before calling `resolveAppList` — finding 2), so the same 138/10
counts were expected and confirmed, not assumed:

```
=== PROOF-04 — real scan on this machine ===
.lnk found (Start Menu, machine + user):     182
Start Menu subdirectories that could not be enumerated: 0
resolved to a non-empty target path:         178 (4 unresolved)
  of which, target basename ends in .exe:    150
unique after dedupe by target path (diagnostic, BEFORE the exclusion rule sees anything): 148
unique after dedupe, .exe targets only:      123  [for comparison against WINDOWS-STACK.md §6.1's 149/122, which counted .exe resolutions]
kept after exclusion rule + dedupe (rule-then-dedupe order — see round-3 finding 2): 138
entries removed by the exclusion rule (per shortcut, not deduped): 10

--- unresolved shortcuts (name -> reason) ---
  Visit MobaXterm Website  ->  target-empty
  File Explorer  ->  target-empty
  Control Panel  ->  target-empty
  Run  ->  target-empty

--- entries removed by the exclusion rule (name -> target) ---
  Uninstall  ->  C:\ProgramData\obs-studio\plugins\Uninstall atkAudio Plugin.exe
  Uninstall DJI Assistant 2 (Consumer Drones Series)  ->  C:\Program Files (x86)\DJI Product\DJI Assistant 2 (Consumer Drones Series)\unins000.exe
  Uninstall DJI Assistant 2 (DJI FPV series)  ->  C:\Program Files (x86)\DJI Product\DJI Assistant 2 (DJI FPV series)\unins000.exe
  Uninstall Go  ->  C:\Windows\System32\msiexec.exe
  Uninstall  ->  C:\Program Files\HandBrake\uninst.exe
  Uninstall IObit Uninstaller  ->  C:\Program Files (x86)\IObit\IObit Uninstaller\unins000.exe
  Desinstalar o MPC-HC  ->  C:\Program Files\MPC-HC\unins000.exe
  Uninstall Node.js  ->  C:\Windows\SysWOW64\msiexec.exe
  Uninstall REVision Effections  ->  C:\ProgramData\REVisionEffects\AEX\unins000.exe
  Uninstall Betaflight Configurator  ->  C:\Users\MaxVision\AppData\Local\Programs\Betaflight\Betaflight-Configurator\unins000.exe

--- msiexec.exe targets found on this machine, with the verb that decided their fate ---
  Uninstall Go  ->  C:\Windows\System32\msiexec.exe  args="/x {5370C587-5FA3-4F85-8287-6483B693690C}"  [EXCLUDED (uninstall verb)]
  Uninstall Node.js  ->  C:\Windows\SysWOW64\msiexec.exe  args="/x {34499F1F-2970-4D10-9161-55FB08B9FE2D}"  [EXCLUDED (uninstall verb)]

--- sanity check: any AFTER entry whose target basename matches unins*.exe? ---
PASS — none
```

**Same kept/excluded counts as round 2 (138/10), confirmed not silently
adjusted:** §4c's pipeline-order fix changes *how* the rule is applied
(partition before dedupe, not after), not this machine's actual data — no
two shortcuts on this machine currently share a target with differing
arguments, so the fix has no observable effect on this run's counts. The
`msiexec.exe targets` block still shows exactly 2 hits at 2 distinct paths,
confirming that directly. The fix is real and tested (§4c, §9) even though
this machine's data cannot demonstrate it firing.

**Finding 3's evidence lives in §3, not in this probe's output.** An
earlier draft of this fix added a second, narrower runtime diagnostic here
(basename patterns' union vs. the ROADMAP glob) — dropped: on this
machine it printed a `NOTE` line for `Uninstall atkAudio Plugin.exe`, a
basename that is correctly excluded by the whole rule (§4a's exact-name
exception, see the "entries removed" list above) but not by a basename
pattern specifically. That distinction needs the explanation §3 now gives
it; a bare `NOTE` at the tail of this probe's output does not, and reads
indistinguishably from an unresolved finding at a glance. The check that
belongs in this probe's own output is the one already above it (broader
than the rule's patterns, applied to the whole rule's verdict) — it is
`PASS`, and that is the number Phase 3 should watch.

The four unresolved shortcuts are now individually named with a reason
instead of a bare aggregate count (round-2 finding 3): all four say
`target-empty` (COM resolved successfully but the shortcut's own
`TargetPath` is legitimately empty — `Visit MobaXterm Website` is a URL
shortcut, `File Explorer` / `Control Panel` / `Run` are CLSID/system
shortcuts with no file target). None says `com-threw`, meaning nothing was
silently swallowed on this run — but the mechanism to report a thrown
exception distinctly (rather than folding it into the same empty-target
bucket a `catch {}` used to produce) now exists for the run where one does
occur. `Start Menu subdirectories that could not be enumerated: 0` confirms
no ACL-denied directory silently shrank the count either.

**Both new error paths verified to actually fire, not just present in the
code** — the same defect shape (an untested clause) that got round 1
rejected, checked here so it isn't repeated in the fix:

- `resolveError`: a standalone `New-Object -ComObject WScript.Shell` /
  `CreateShortcut(...)` call against a path that is not a `.lnk`/`.url`
  forces the real exception, `try/catch` around it, `$_.Exception.Message`
  printed. Observed: `O nome do caminho do atalho deve terminar com .lnk ou
  .url.` (this machine's PowerShell locale is pt-BR) — a real COM exception
  message reaches the field, not a placeholder.
- `dirErrorCount`: a standalone test directory with `icacls.exe /deny
  "$env:USERNAME:(RX)"` on a subfolder, scanned with the identical
  `Get-ChildItem -LiteralPath ... -Recurse -File -ErrorAction
  SilentlyContinue -ErrorVariable +dirErrors` call this probe uses. Observed:
  `dirErrors.Count = 1`, message `O acesso ao caminho '...\denied' foi
  negado.` — the counter increments on a real access-denied directory, not
  only in theory.

### 6.1 Reconciling this run's counts against `WINDOWS-STACK.md`'s 149/122 — measured, not guessed

Round 1 of this ADR asserted a "likely mechanism" for why this probe's
counts didn't match `WINDOWS-STACK.md` §6.1's recorded `149`
resolved-shortcuts / `122` deduped-apps. That paragraph was wrong on three
separate points, caught by round-2 review, and is replaced here with what is
actually measured.

**What was wrong:**

1. It attributed the `149`, "a per-shortcut COM resolution loop, timed
   individually at ~16 ms each," to Apêndice A. Apêndice A
   (`.maxvision/research/WINDOWS-STACK.md:543-591`) contains no `.lnk` scan
   command at all — checked directly, not assumed
   (`grep -ni "apendice\|apêndice\|appendix" WINDOWS-STACK.md` matches only
   the two heading lines, `## Apêndice A — reprodução` and
   `## Apêndice B — alternativas descartadas`; a full read of lines 543-591
   confirms Apêndice A's code blocks cover `node.exe` size, WebView2, Mica,
   the idle-server measurement, icon benchmarks and Playwright — no `.lnk`
   scan). The `149` figure and its
   `~16 ms/shortcut` timing are in §6.1
   (`.maxvision/research/WINDOWS-STACK.md:51,236`), already correctly cited
   for the `122` figure two paragraphs earlier — the misattribution was
   internal to that one paragraph. Fixed in §1 and here: every reference in
   this ADR to the earlier measurement now cites §6.1 only.
2. It reasoned that `scan-apps.mjs`'s `try/catch` "may retain shortcuts ...
   that the earlier script's error handling dropped" — implying the earlier
   script's `149` was itself a resolved-shortcut count that this probe's
   178 exceeds because this probe retains more failures. That is
   contradicted by a sibling artifact already committed in this repo:
   `measure/windows/proof-03-results.json` (`PROOF-03`, the COM-vs-binary-
   parser validation run on this same machine) records
   `agreement.comSuccess: 178` and `agreement.tierCounts["com-empty"]: 4`
   against the identical 182-shortcut Start Menu tree. `178` is independent
   corroboration that COM resolution on this machine succeeds for 178 of
   182 shortcuts today, not 149 — so `149` was never a "COM resolved to a
   target path" count to begin with.
3. It gave as the reason the earlier script's counts couldn't be
   reconciled that its artifacts "live in a session-scoped scratchpad path
   this session cannot read." False, checked directly: that exact path
   (`.../scratchpad/etest/`) is this session's own scratchpad and was
   listed successfully (`ls` succeeded, contents include `iconbench.js`,
   `icon3.js`, `mica.png`, `pwtest.mjs` — the §6.2/§4.1/§7 artifacts, not a
   `.lnk` scan script). The script that produced `149` genuinely is not
   preserved anywhere in the repo or the scratchpad — that conclusion
   survives — but "cannot read the directory" was not the reason, and
   stating it as the reason was itself an unvalidated claim.

**What is actually measured, on this run:**

`WINDOWS-STACK.md` §6.1's `149`/`122` almost certainly counted **resolved
`.exe` targets**, not every non-empty `TargetPath` — `scan-apps.mjs` counts
the latter by default. Testing that hypothesis directly against this run's
own data (no re-run of the lost script required, because the hypothesis is
checkable from what this run already measured):

| Metric | This run (all targets) | This run (`.exe` targets only) | `WINDOWS-STACK.md` §6.1 |
|---|---|---|---|
| Resolved | 178 | **150** | 149 |
| Deduped/unique | 148 | **123** | 122 |

Both `.exe`-only numbers are exactly **one more** than the recorded figures
(`150` vs `149`, `123` vs `122`) — the same delta, on both an absolute count
and a count downstream of it, under the single hypothesis that the earlier
script counted `.exe` resolutions and this one (when restricted to `.exe`
targets, now printed by the probe itself — see the "of which, target
basename ends in .exe" and "unique after dedupe, .exe targets only" lines
above) is comparing apples to apples. **The `+1` itself is not confirmed
further** — one additional `.exe`-resolving shortcut existing today that
didn't when §6.1 was measured is plausible (this machine has had software
installed/removed since), but no specific shortcut was identified as "the"
new one, and the lost script means a byte-for-byte re-run is not possible.
Stated as what it is: a measured, exact, two-for-two reconciliation of the
count *shape*, with the residual `1` left honestly unconfirmed rather than
explained away.

This also resolves the `182 → 178` part on its own terms: `178` is now
corroborated twice, independently, on this machine — once by this probe's
own COM loop, once by PROOF-03's separately-written COM baseline
(`comSuccess: 178`) — so `178` is the number to trust for "how many of these
182 shortcuts does COM resolve a `TargetPath` for on this machine today,"
and `149` was answering a narrower question (resolved to an `.exe`
specifically) that this probe now also answers, and answers consistently.

## 7. Every entry removed, judged individually (self-review, not left for the reviewer)

| Name | Target | Verdict |
|---|---|---|
| Uninstall | `...\obs-studio\plugins\Uninstall atkAudio Plugin.exe` | Correct — OBS plugin's own leftover uninstaller |
| Uninstall DJI Assistant 2 (Consumer Drones Series) | `...\unins000.exe` | Correct — the exact garbage this task was filed for |
| Uninstall DJI Assistant 2 (DJI FPV series) | `...\unins000.exe` | Correct — second DJI product on this machine, same pattern |
| Uninstall Go | `msiexec.exe /x {GUID}` | Correct — Go's own MSI uninstall entry |
| Uninstall | `...\HandBrake\uninst.exe` | Correct — HandBrake's uninstaller |
| Uninstall IObit Uninstaller | `...\IObit Uninstaller\unins000.exe` | Correct — see §3; the app itself (`IObitUninstaler.exe`) is confirmed **kept**, only its own uninstall entry is removed |
| Desinstalar o MPC-HC | `...\MPC-HC\unins000.exe` | Correct — MPC-HC's uninstaller (Portuguese-localized shortcut name, caught by target basename regardless of language) |
| Uninstall Node.js | `msiexec.exe /x {GUID}` | Correct — Node.js's own MSI uninstall entry |
| Uninstall REVision Effections | `...\REVisionEffects\AEX\unins000.exe` | Correct — After Effects plug-in uninstaller |
| Uninstall Betaflight Configurator | `...\Betaflight-Configurator\unins000.exe` | Correct — Betaflight's uninstaller |

**All 10 removed entries are genuine uninstaller debris. None is a legitimate,
launchable application.** Nothing that should have stayed was removed, verified
by cross-checking every "contains uninstall" entry on this machine
individually (§3's IObit table) rather than trusting the aggregate count.

## 8. Known residual gap (self-reported)

An uninstaller binary that is neither in `UNINSTALLER_BASENAME_PATTERNS`, nor
shortcut-named exactly "Uninstall", nor `msiexec.exe` with an uninstall verb,
will survive the filter. None exists on this machine today (§6/§7 show zero
false negatives on the current data), but the rule is not exhaustive by
construction — see §3's stated tradeoff. If Phase 3 (`PLAT-02`) encounters a
new pattern on a different machine, extend
`UNINSTALLER_BASENAME_PATTERNS`/`EXACT_UNINSTALL_NAME`/`MSI_UNINSTALL_ARG` the
same way this ADR's rule 4 extensions were added: only after a real scan shows
the gap, never speculatively.

## 9. Test discrimination proof

**Round-1 defect, fixed in round 2, re-verified here.** Round 1 of this ADR
claimed the whole-function mutation below covers "every exclusion path the
rule implements." That was false at clause granularity: the exact-name
exception is a two-clause conjunction and every round-1 fixture for that
path already had a `.exe` target, so deleting the `.exe` guard clause left
the suite green. Round 2 fixed this with a pinning fixture and a per-clause
mutation table (not whole-function only).

**Round-3 trap, avoided here.** §9's mutation table is stated against "the
identical, unmodified N-test file" with exact pass/fail splits. Round 3
added a new fixture to `test/windows-uninstaller-rule.test.mjs` (the win32
path-semantics pin) and a whole new file,
`test/windows-dedupe-order.test.mjs` (§4c). Both invalidate every row of
round 2's table by changing the baseline test count. **Every mutation below
was re-run against the current files, not hand-adjusted from round 2's
numbers** — see the exact script and raw output this table transcribes at
the end of this section.

**Round-4 trap, avoided the same way.** Round 4 added 4 fixtures to
`test/windows-uninstaller-rule.test.mjs` (14 → 18 tests, §9.1b) and a whole
new file, `test/windows-dedupe-target.test.mjs` (5 tests, §9.5), which
again invalidate every row's baseline test-count if hand-carried forward
instead of re-measured. §9.1's original round-3 table (14-test baseline) is
left as-is below as a historical record of what it actually proved at that
point — it is not re-run against 18 tests, because doing so would not
change any of its own pass/fail splits (none of the round-4 fixtures touch
the clauses rows 1–11 mutate) and would only obscure which round produced
which number. §9.1b, §9.5 and the combined 28-test run at the end of §9.5
are the round-4-current numbers; §9.1's `14`/`14`/`0` baseline references
below describe round 3's file as it stood then, not this file today.

### 9.1 `isUninstallerEntry` clauses (`test/windows-uninstaller-rule.test.mjs`)

Baseline: `node --test test/windows-uninstaller-rule.test.mjs` against the
unmodified rule — `ℹ tests 14`, `ℹ pass 14`, `ℹ fail 0` (13 round-2 tests +
1 new win32-pin fixture, §9.3).

Each row is a single clause of `isUninstallerEntry` (or the whole function,
row 11), neutered in isolation via a scripted search-and-replace (not
hand-edited, so every mutation is reproducible), suite re-run against the
identical, unmodified 14-test file, then reverted and the baseline
re-confirmed green before the next mutation:

| # | Clause mutated | Mutation | Result | Failing test(s) |
|---|---|---|---|---|
| 1 | `UNINSTALLER_BASENAME_PATTERNS[0]` | `/^unins\d*\.exe$/i` → never matches | 10 pass / 4 fail | the DJI real-finding test, **the new win32-pin test (§9.3 — it also exercises this same pattern)**, the Inno-Setup-variants test, `partitionUninstallers`'s test |
| 2 | `UNINSTALLER_BASENAME_PATTERNS[1]` | `/^uninst\d*\.exe$/i` → never matches | 13 pass / 1 fail | "exclui outros nomes de binário dedicados a desinstalação" |
| 3 | `UNINSTALLER_BASENAME_PATTERNS[2]` | `/^uninstall\.exe$/i` → never matches | 13 pass / 1 fail | "exclui outros nomes de binário dedicados a desinstalação" |
| 4 | `UNINSTALLER_BASENAME_PATTERNS[3]` | `/^uninstaller\.exe$/i` → never matches | 13 pass / 1 fail | "exclui outros nomes de binário dedicados a desinstalação" |
| 5 | `EXACT_UNINSTALL_NAME` | `/^uninstall$/i` weakened to substring `/uninstall/i` | 10 pass / 4 fail | both false-positive-avoided tests, the exact-match-not-substring test, `partitionUninstallers`'s test |
| 6 | `.exe` guard on the exact-name exception | `EXACT_UNINSTALL_NAME.test(name) && /\.exe$/i.test(base)` → `EXACT_UNINSTALL_NAME.test(name)` (the exact round-2-review mutation) | 13 pass / 1 fail | "o guard '.exe' da exceção de nome exato é uma cláusula própria" — the gap round 2 found stays closed |
| 7 | `MSIEXEC_BASENAME` | `/^msiexec\.exe$/i` → never matches | 13 pass / 1 fail | "exclui achado real de máquina: msiexec.exe /x {GUID} ..." |
| 8 | `MSI_UNINSTALL_ARG` | `/(^|\s)\/(x|uninstall)\b/i` → never matches | 13 pass / 1 fail | "exclui achado real de máquina: msiexec.exe /x {GUID} ..." |
| 9 | input guard | `if (!entry \|\| typeof entry.target !== "string" \|\| entry.target === "") {...}` → `if (false) {...}` | 13 pass / 1 fail | "atalho não resolvido (target vazio/null) nunca é excluído por esta regra" |
| 10 | name derivation | `entry.name.trim()` → `entry.name` (drop `.trim()`) | 13 pass / 1 fail | "o match exato de nome 'Uninstall' não vira substring ..." (the padded-whitespace fixture) |
| 11 | whole function | early `return false;` as the first line (rule effectively deleted) | 6 pass / 8 fail | every "exclui ..." test (now including the win32-pin fixture), plus `partitionUninstallers`'s test |

Row 11's 8 failing tests, for the record:

```
✖ exclui o achado real: Uninstall DJI Assistant 2 -> unins000.exe
✖ pina a semântica win32 do path: basename() do módulo deve usar node:path/win32, não node:path host-dispatched
✖ exclui variantes numeradas do Inno Setup, incluindo caminho com espaço
✖ exclui outros nomes de binário dedicados a desinstalação
✖ exclui achado real de máquina: shortcut nomeado exatamente 'Uninstall' para plugin OBS (atkAudio)
✖ o match exato de nome 'Uninstall' não vira substring: 'Uninstall Tool' e 'UninstallGuard Pro' continuam protegidos
✖ exclui achado real de máquina: msiexec.exe /x {GUID} (Uninstall Go, Uninstall Node.js)
✖ partitionUninstallers separa a lista real medida: 1 excluído de 4, nomeado
```

**All 10 clauses (rows 1–10) have at least one test that fails when that
clause alone is neutered, and the whole-function fallback (row 11) still
fails independently.** Every mutation was reverted immediately after its
result was recorded, and the baseline (`14`/`14`/`0`) was re-confirmed
after every single revert; no neutered version was ever committed (see
`git status` / `git diff` after the run — clean, and confirmed again with a
fresh `node --test` pass at the very end of the script).

**Round-4 correction, stated precisely because the original phrasing was
overclaiming exactly the way round 1's "every exclusion path" claim was
(§9's own opening paragraph):** "that clause alone is neutered" above means
one specific, whole-clause deletion or negation per row — it does **not**
mean every way that clause could be individually weakened. Concretely, row
1 neuters `UNINSTALLER_BASENAME_PATTERNS[0]` by making it never match
anything; it says nothing about a *narrower* mutation of the same clause,
such as dropping only its `^`/`$` anchors or only its `/i` flag while
leaving the rest of the pattern intact. Round-4 review measured directly
that those narrower mutations were **not** covered by this table: dropping
`^`/`$` from all four basename patterns, and dropping `/i` from those same
four patterns plus `MSIEXEC_BASENAME`, all left this exact 14-test file
green. §9.1b below is the corrected, finer-grained coverage for those two
specific mechanisms (anchoring, case-insensitivity) on every regex in the
module that has them — it does not replace this table, which still
correctly proves each clause's *existence* matters; §9.1b proves each
clause's *anchoring and casing*, specifically, also matters.

### 9.1b Anchoring (`^`/`$`) and case-insensitivity (`/i`) — round-4 finding 1

Baseline: `node --test test/windows-uninstaller-rule.test.mjs` against the
unmodified rule, current 18-test file (14 round-3 tests + 4 new fixtures
added this round) — `ℹ tests 18`, `ℹ pass 18`, `ℹ fail 0`.

Every fixture below was checked with `node -e` against both the real
(anchored, case-insensitive) pattern and its specific mutant before being
committed, confirming each one is a clean, single-pattern discriminator
(matches its own target pattern's mutant and no other pattern, anchored or
not) — not asserted from the pattern shape, run directly. All 18
mutations below were applied one at a time with a scripted, literal-string
replace (not hand-edited — `MSYS_NO_PATHCONV=1 node
<scratchpad>/mutate.mjs "<old>" "<new>"`, restoring the clean file first
and after every mutation), re-run against the identical, unmodified
18-test file, then reverted and the baseline re-confirmed green before the
next mutation — raw `node --test` output for every row, not summarized:

**Group 1 — drop BOTH `^` and `$` (reproduces the reviewer's own A-unins /
A-uninst / A-uninstall / A-uninstaller mutations, all 4 of which SURVIVED
the round-3 suite):**

| Pattern | Mutation | Result | Failing test(s) |
|---|---|---|---|
| `UNINSTALLER_BASENAME_PATTERNS[0]` (`unins`) | `/^unins\d*\.exe$/i` → `/unins\d*\.exe/i` | 16 pass / 2 fail | ANCORAGEM (prefixo), ANCORAGEM (sufixo) |
| `[1]` (`uninst`) | `/^uninst\d*\.exe$/i` → `/uninst\d*\.exe/i` | 16 pass / 2 fail | ANCORAGEM (prefixo), ANCORAGEM (sufixo) |
| `[2]` (`uninstall`) | `/^uninstall\.exe$/i` → `/uninstall\.exe/i` | 16 pass / 2 fail | ANCORAGEM (prefixo), ANCORAGEM (sufixo) |
| `[3]` (`uninstaller`) | `/^uninstaller\.exe$/i` → `/uninstaller\.exe/i` | 16 pass / 2 fail | ANCORAGEM (prefixo), ANCORAGEM (sufixo) |

All 4/4 now caught (round 3: 4/4 survived, per the reviewer's own
measurement).

**Group 2 — drop `$` only (`^` kept). Self-caught gap: the reviewer's own
three named fixtures (`AppUninstall.exe`, `SmartUninstaller.exe`,
`MyUninst.exe`) do NOT discriminate this mutation on their own — checked
directly with `node -e` before writing the suffix fixtures, not assumed —
because they are all still anchored at the start on a prefix that isn't
the pattern's own word, so a `$`-only-dropped pattern never matches them
either:**

| Pattern | Mutation | Result | Failing test(s) |
|---|---|---|---|
| `[0]` | `/^unins\d*\.exe$/i` → `/^unins\d*\.exe/i` | 17 pass / 1 fail | ANCORAGEM (sufixo) |
| `[1]` | `/^uninst\d*\.exe$/i` → `/^uninst\d*\.exe/i` | 17 pass / 1 fail | ANCORAGEM (sufixo) |
| `[2]` | `/^uninstall\.exe$/i` → `/^uninstall\.exe/i` | 17 pass / 1 fail | ANCORAGEM (sufixo) |
| `[3]` | `/^uninstaller\.exe$/i` → `/^uninstaller\.exe/i` | 17 pass / 1 fail | ANCORAGEM (sufixo) |

**Group 3 — drop `^` only (`$` kept), for completeness (not explicitly
named in the reviewer's required-fix list, but the same clause-granularity
gap the round-4 self-correction above warns against leaving half-closed):**

| Pattern | Mutation | Result | Failing test(s) |
|---|---|---|---|
| `[0]` | `/^unins\d*\.exe$/i` → `/unins\d*\.exe$/i` | 17 pass / 1 fail | ANCORAGEM (prefixo) |
| `[1]` | `/^uninst\d*\.exe$/i` → `/uninst\d*\.exe$/i` | 17 pass / 1 fail | ANCORAGEM (prefixo) |
| `[2]` | `/^uninstall\.exe$/i` → `/uninstall\.exe$/i` | 17 pass / 1 fail | ANCORAGEM (prefixo) |
| `[3]` | `/^uninstaller\.exe$/i` → `/uninstaller\.exe$/i` | 17 pass / 1 fail | ANCORAGEM (prefixo) |

**Group 4 — drop `/i` (the reviewer's required-fix list: all four
basename patterns plus `MSIEXEC_BASENAME`, 5/5 of which SURVIVED round
3):**

| Pattern | Mutation | Result | Failing test(s) |
|---|---|---|---|
| `[0]` | `/^unins\d*\.exe$/i` → `/^unins\d*\.exe$/` | 17 pass / 1 fail | CASE-INSENSITIVITY (maiúsculas) |
| `[1]` | `/^uninst\d*\.exe$/i` → `/^uninst\d*\.exe$/` | 17 pass / 1 fail | CASE-INSENSITIVITY (maiúsculas) |
| `[2]` | `/^uninstall\.exe$/i` → `/^uninstall\.exe$/` | 17 pass / 1 fail | CASE-INSENSITIVITY (maiúsculas) |
| `[3]` | `/^uninstaller\.exe$/i` → `/^uninstaller\.exe$/` | 17 pass / 1 fail | CASE-INSENSITIVITY (maiúsculas) |
| `MSIEXEC_BASENAME` | `/^msiexec\.exe$/i` → `/^msiexec\.exe$/` | 17 pass / 1 fail | CASE-INSENSITIVITY (maiúsculas) |

All 5/5 now caught (round 3: 5/5 survived).

**Group 5 — drop `/i`, the two sites NOT in the reviewer's required-fix
list, closed anyway (round-4 self-review — leaving them would be the exact
"closed one instance, declared the table complete" pattern this same
finding calls out one level up):**

| Site | Mutation | Result | Failing test(s) |
|---|---|---|---|
| `EXACT_UNINSTALL_NAME` | `/^uninstall$/i` → `/^uninstall$/` | 15 pass / 3 fail | "exclui achado real de máquina: shortcut nomeado exatamente 'Uninstall'...", "o match exato de nome 'Uninstall' não vira substring...", CASE-INSENSITIVITY (os dois /i não cobertos) |
| `.exe` guard (`/\.exe$/i.test(base)` inside `isUninstallerEntry`) | → `/\.exe$/.test(base)` | 17 pass / 1 fail | CASE-INSENSITIVITY (os dois /i não cobertos) |
| `MSI_UNINSTALL_ARG` | `/(^|\s)\/(x\|uninstall)\b/i` → without `/i` | 17 pass / 1 fail | CASE-INSENSITIVITY (os dois /i não cobertos) |

**18/18 mutations killed, 0 survivors, across both required and
self-discovered rows.** Baseline (`18`/`18`/`0`) re-confirmed after every
single mutation was reverted, and once more at the end of the scripted
run — no neutered version was ever committed.

### 9.2 Reproducing round-3 finding 1's exact defect (the import, not a clause)

The `basename` import isn't a clause of `isUninstallerEntry`, so it isn't a
row in §9.1's table — and it **cannot** be demonstrated by the same
"revert the import, rerun on this machine" technique, because this machine
*is* win32: `node:path` already dispatches to `node:path/win32` here, so
reverting the import to plain `node:path` on this Windows box changes
nothing observable. This is exactly the shape of gap round 3 found (an
untested clause is one thing; an untestable-on-this-host clause is another)
— demonstrated here the same way the reviewer's own evidence did: a
temporary copy of the module with `basename` imported from
`node:path/posix` instead (standing in for what `node:path` resolves to on
a genuine POSIX host), the **current, unmodified** 14-test file run against
it unchanged:

```
ℹ tests 14
ℹ pass 8
ℹ fail 6
✖ exclui o achado real: Uninstall DJI Assistant 2 -> unins000.exe
✖ pina a semântica win32 do path: basename() do módulo deve usar node:path/win32, não node:path host-dispatched
✖ exclui variantes numeradas do Inno Setup, incluindo caminho com espaço
✖ exclui outros nomes de binário dedicados a desinstalação
✖ exclui achado real de máquina: msiexec.exe /x {GUID} (Uninstall Go, Uninstall Node.js)
✖ partitionUninstallers separa a lista real medida: 1 excluído de 4, nomeado
```

6 failures (round 3's reviewer measured 5 against the round-2, 13-test
file; the 6th here is the new win32-pin fixture itself, added specifically
to fail under this exact condition). The **fixed** module (importing from
`node:path/win32`, `measure/windows/lib/uninstaller-rule.mjs:36`) cannot be
subjected to this *same simulate-by-swapping-the-import* technique to show
the opposite, because there is no longer an import to swap out from under
it — its immunity is structural (a static import of a module whose
behavior never varies by host OS). That does not mean no test covers it:
§9.3's fixture is exactly a per-run test that pins this coupling, by a
different mechanism (asserting win32/posix divergence directly, then
asserting the rule's behavior) than the "neuter and rerun" technique rows
1–11 and this section use. The two are complementary, not contradictory:
this section shows the historical defect reproduced and closed; §9.3 is
the regression guard that fails again if the import ever reverts.

### 9.3 The win32-pin fixture, standing on its own

"pina a semântica win32 do path..." (`test/windows-uninstaller-rule.test.mjs`)
first asserts `win32Basename(target) !== posixBasename(target)` for its own
fixture — a sanity check on the fixture, not the rule, so it cannot pass
vacuously if a future edit accidentally picks an input both semantics agree
on. Only then does it assert `isUninstallerEntry(...)` — closing exactly
the gap §9.2 measured.

**Round-4 honesty note (folded into finding 1's evidence, not itself a
required fix):** the reviewer additionally measured that swapping
`node:path/win32` back to plain `node:path` (mutation "M13") on THIS
machine — win32 itself — leaves the suite green, because `node:path`
already dispatches to `node:path/win32` semantics on a win32 host. That is
not a gap in the test; it is a gap in what can be observed on any host
this ADR's work has actually run on. §9.2 above already discloses this
honestly (the "cannot be subjected to this same simulate-by-swapping...
technique" paragraph) and does not claim otherwise. What round-4 adds,
stated precisely rather than left implicit: `.github/workflows/test.yml`
targets `ubuntu-latest`, the one host where this mutation genuinely would
be observable — but its trigger is `on: workflow_dispatch` only (checked
directly, `.github/workflows/test.yml:3-4`), not `push`/`pull_request`, so
it never runs automatically and was not run as part of this round either.
The accurate statement is: **this regression guard exists, is killable
only on a POSIX host, and the one CI job that could exercise it
automatically is configured to require a manual trigger it has not
received.** No code or workflow change is made here for this — outside
PROOF-04's scope, and speculatively adding automatic triggers to a shared
CI file is exactly the kind of unrequested change rule 3 warns against —
but the gap is named plainly rather than left to be inferred from §9.2's
more oblique phrasing.

### 9.4 Pipeline-order clauses (`test/windows-dedupe-order.test.mjs`, §4c)

This is a separate module (`measure/windows/lib/resolve-app-list.mjs`), not
a clause of `isUninstallerEntry`, so its own suite is reported separately
rather than folded into §9.1's table (folding it in would conflate two
different functions' coverage).

Baseline: `node --test test/windows-dedupe-order.test.mjs` — `ℹ tests 5`,
`ℹ pass 5`, `ℹ fail 0`.

| # | Mutation | Result | Failing test(s) |
|---|---|---|---|
| 1 | `resolveAppList` reverted to dedupe-then-partition (`dedupeByTarget(resolved)` then `partitionUninstallers(deduped)` — the round-2 order) | 2 pass / 3 fail | both order-pinning tests, **and** "excluded list is NOT deduped..." |

Measured directly (not estimated): reverting the composition order and
re-running the identical, unmodified test file gives `ℹ tests 5`, `ℹ pass 2`,
`ℹ fail 3`, failing exactly:

```
✖ resolveAppList: install-shortcut-walked-first — the uninstall sibling is still excluded on its own arguments, not silently dropped by dedupe
✖ resolveAppList: uninstall-shortcut-walked-first (the failure-triggering order) — the /i shortcut still survives
✖ resolveAppList: excluded list is NOT deduped — two distinct uninstaller shortcuts at the same target are both reported
```

**Both order-pinning tests fail under the reverted order, not just one** —
this is a stronger result than "the bug only shows up in the unlucky walk
order" would suggest. Under dedupe-first, whichever shortcut is walked
first survives dedupe **alone**; the other is discarded before
`partitionUninstallers` ever runs, so `excluded` is empty in both walk
orders (not "sometimes 1, sometimes 0") — the test that expects `kept`
to contain exactly the `/i` shortcut also fails whenever `/x` is walked
first, because dedupe kept the `/x` entry instead and `partitionUninstallers`
correctly excludes it, but then `kept.length` is `0`, not `1`. The third
failure (excluded-not-deduped) fails under the old order by construction,
because dedupe already collapsed the two-shortcut fixture to one entry
before partition ever saw two things to exclude.

This single mutation is sufficient: `resolveAppList` has exactly one
behavior worth mutating for this fix (the composition order of
`partitionUninstallers` and `dedupeByTarget`, both of which already have
their own full coverage — `partitionUninstallers` via §9.1,
`dedupeByTarget` via its own module header and the "regression guard" test
that exercises it directly). The regression-guard and not-deduped/
distinct-targets tests in the same file are not separately mutated because
they call `dedupeByTarget` directly — **round-4 correction:** at the time
this paragraph was written (round 3), that coverage claim rested on
§9.1's `kept` behavior plus `dedupeByTarget`'s own five-line
implementation being simple enough to read correctly by inspection. Round
4 measured that inspection wrong: the case-insensitive-key mutation (M27,
§9.5 below) survived this exact suite. `dedupeByTarget` now has its own
dedicated suite (`test/windows-dedupe-target.test.mjs`, §9.5) instead of
relying on indirect coverage through this file. The mutation in this
section was reverted immediately after its own measurement and the
baseline (`5`/`5`/`0`) re-confirmed.

### 9.5 `dedupeByTarget`'s own suite (`test/windows-dedupe-target.test.mjs`) — round-4 findings 1 (M27) and 2

Previously exercised only indirectly (this file's own fixtures, plus the
live probe run) — round-3 review measured that indirect coverage missed a
real mutant (M27: removing `.toLowerCase()` from the case-insensitive key
left the round-3 suite at `19`/`19` green) and round-4's finding 2 added a
real crash (`entry.target.toLowerCase()` on a null/undefined/missing
`target`, an input shape two sibling modules' own JSDoc document as
valid). Both are now covered directly, by a dedicated 5-test file.

Baseline: `node --test test/windows-dedupe-target.test.mjs` — `ℹ tests 5`,
`ℹ pass 5`, `ℹ fail 0`.

**M27, re-run against the current, dedicated suite (not the indirect one
that let it survive in round 3):**

```
$ node -e '<mutate: const key = entry.target.toLowerCase(); -> const key = entry.target;>'
$ node --test test/windows-dedupe-target.test.mjs test/windows-dedupe-order.test.mjs
✖ duas entradas cujo target difere só em CAIXA colapsam em 1 (NTFS é case-insensitive) — pina .toLowerCase()
✖ entradas sem target e entradas com target se misturam corretamente, mantendo a ordem original
ℹ tests 10
ℹ pass 8
ℹ fail 2
```

M27 killed (round 3: survived, 19/19 green with the pre-round-4 suite).

**Finding 2's crash guard, mutated by removing the unkeyable-target branch
entirely (reverting to the round-3 implementation that threw):**

```
$ node -e '<mutate: remove the `if (typeof entry.target !== "string" || entry.target === "") { result.push(entry); continue; }` branch>'
$ node --test test/windows-dedupe-target.test.mjs
✖ target: null — não pode ser chaveado, passa intocado (não lança, não é deduplicado contra nada)
✖ target: '' (string vazia) — mesmo tratamento de null, não colapsa duas entradas distintas
✖ campo target ausente — mesmo tratamento, não lança
✖ entradas sem target e entradas com target se misturam corretamente, mantendo a ordem original
ℹ tests 5
ℹ pass 1
ℹ fail 4
```

4/5 tests fail (the fifth, the case-only-differs test, does not touch an
unkeyable target and is unaffected by this specific mutation, as
expected). Both mutations reverted immediately after measurement and the
baseline (`5`/`5`/`0` for this file) re-confirmed, together with
`test/windows-uninstaller-rule.test.mjs`'s own 18-test baseline and
`test/windows-dedupe-order.test.mjs`'s 5-test baseline, in a single
combined run across all three PROOF-04 test files:

```
$ node --test test/windows-uninstaller-rule.test.mjs test/windows-dedupe-order.test.mjs test/windows-dedupe-target.test.mjs
ℹ tests 28
ℹ pass 28
ℹ fail 0
```

## 10. Alternatives considered

- **Match on the shortcut's parent-folder name against the target's own
  install directory ("self-referential" heuristic).** More general, would
  also catch novel binary names. Rejected for this pass: harder to reason
  about precisely, no counterexample on this machine required it, and it
  reintroduces exactly the ambiguity §3 avoids (what counts as
  "self-referential" is itself fuzzy). Left as a documented option if a
  future machine's data demands it.
- **Registry-based enumeration (`Uninstall` key under
  `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`) instead of
  Start Menu shortcuts.** Would sidestep this whole problem — every entry
  there already *is* an uninstaller record, not a discovered app. Not used
  because PROOF-02/PROOF-03's job is enumerating **launchable** apps (Start
  Menu shortcuts, `shell:AppsFolder`), a different data source with a
  different purpose; conflating the two would change what RF-03 discovers.

## 11. Commit trailer note (round-3 finding 4)

Round-3 review found commit `1763d51`'s trailer read
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`, not the required
`Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

**Not amended in this round, and the reason is stated plainly rather than
silently skipped:** `1763d51` is no longer `HEAD` — 7 commits from an
unrelated PROOF (PROOF-01/02/03 icon-bench work) landed on top of it before
this round started. `git commit --amend` cannot reach a non-tip commit, and
rewriting a buried commit's message non-interactively (`git filter-branch
--msg-filter`, scoped by SHA so only `1763d51` itself is touched) was the
planned fix — but checked immediately before attempting it, this
repository's working tree showed **live, uncommitted changes from another
session**, not this one:

```
$ git status --short | grep -v '^??'
 M docs/adr/PROOF-04-uninstaller-exclusion-rule.md         <- this round's own edit
 M measure/windows/lib/uninstaller-rule.mjs                <- this round's own edit
 M measure/windows/scan-apps.mjs                           <- this round's own edit
 M test/windows-uninstaller-rule.test.mjs                  <- this round's own edit
 M measure/windows/icon-bench/addon-icon/icon_addon.cc     <- NOT this round's work
 M measure/windows/icon-bench/data/apps.json               <- NOT this round's work
 M measure/windows/icon-bench/lib/koffi-icon.mjs           <- NOT this round's work
 M measure/windows/icon-bench/lib/pwsh-pool.mjs            <- NOT this round's work
 M measure/windows/icon-bench/pwsh/worker.ps1              <- NOT this round's work
 M measure/windows/icon-bench/results.json                 <- NOT this round's work
 M measure/windows/icon-bench/scripts/bench.mjs            <- NOT this round's work
 M measure/windows/icon-bench/scripts/list-apps.mjs        <- NOT this round's work
 M measure/windows/lnk-parser.mjs                          <- NOT this round's work
 M measure/windows/proof-03-lnk-benchmark.mjs              <- NOT this round's work
 M test/windows-lnk-parser.test.mjs                        <- NOT this round's work
```

None of the "NOT this round's work" files were touched by this session —
this session's only edits this round are the four files this ADR describes
plus the two new `measure/windows/lib/*.mjs` files and the new test file.
`git log -1` also moved once mid-session, from `49af228` to `9299641`
(both PROOF-01/02/03 commits, both outside this ADR's scope), confirming
another agent is actively committing to this exact branch right now, not
just leaving a stale dirty file behind.

**`git filter-branch` (or any non-`-i` rewrite of `1763d51..HEAD`) was not
run.** Rewriting the branch's history while a second session holds
uncommitted work on the same branch risks orphaning or corrupting that
session's in-progress commit the moment it lands — a real, observed risk
here, not a hypothetical one, given the mid-session `HEAD` movement already
seen. This is a scope/safety fact about the current repository state, not
a disagreement with the finding: the trailer on `1763d51` genuinely is
wrong and should be fixed once this branch has no concurrent writer.

**What is compliant right now:** this round's own commit (containing every
fix in this document) carries the trailer the task's non-negotiable rule 4
and this session's attribution reminder both require —
`Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` — set
correctly on first commit, not requiring a later amend. `1763d51` and any
other historically-mistrailered PROOF-04 commit remain as they are,
un-rewritten, until the branch is confirmed to have no other active writer.
