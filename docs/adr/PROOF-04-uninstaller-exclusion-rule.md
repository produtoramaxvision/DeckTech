# PROOF-04 — Exclusion rule for uninstaller entries in the Windows app scan

**Status:** Accepted
**Date:** 2026-09-17
**Machine:** Windows 11 Pro 22631, x64 (this machine)
**Requirement:** `PROOF-04` (`.maxvision/REQUIREMENTS.md`), Phase 0 success criterion 4
(`.maxvision/ROADMAP.md`)

**Round 2 (this revision).** A rigorous review rejected round 1 on four
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
machine). Full verbatim output (round-2 version of the probe — see §5 and
§6.1 below for what changed since round 1's run):

```
=== PROOF-04 — real scan on this machine ===
.lnk found (Start Menu, machine + user):     182
Start Menu subdirectories that could not be enumerated: 0
resolved to a non-empty target path:         178 (4 unresolved)
  of which, target basename ends in .exe:    150
unique after dedupe by target path:          148  [BEFORE exclusion rule, all resolved targets]
unique after dedupe, .exe targets only:      123  [for comparison against WINDOWS-STACK.md §6.1's 149/122, which counted .exe resolutions]
unique after uninstaller-exclusion rule:     138  [AFTER exclusion rule, applied to the all-targets set above]
entries removed by the exclusion rule:       10

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

**Round-1 defect, fixed here.** Round 1 of this ADR claimed the whole-function
mutation below covers "every exclusion path the rule implements (basename
patterns, the exact-name exception, the msiexec exception)." That was false
at clause granularity: `isUninstallerEntry`'s exact-name exception is a
two-clause conjunction —
`EXACT_UNINSTALL_NAME.test(name) && /\.exe$/i.test(base)`
(`measure/windows/lib/uninstaller-rule.mjs:95`) — and every round-1 fixture
for that path already had a `.exe` target, so deleting the `.exe` guard
clause left the suite fully green. A whole-function mutation (`return false`
as the first line) cannot detect a single clause going missing inside a
still-partially-working function; it only proves the function isn't a no-op.
Fixed two ways: (1) a new fixture,
`isUninstallerEntry({ name: "Uninstall", target: "...\\Uninstall.txt" })`
expected `false`, pins the `.exe` guard on its own (`test/windows-uninstaller-
rule.test.mjs`, "o guard '.exe' da exceção de nome exato é uma cláusula
própria"); (2) coverage below is now reported **per clause**, each one
mutated and re-run individually, instead of inferred from test names.

Baseline: `node --test test/windows-uninstaller-rule.test.mjs` against the
unmodified rule — `ℹ tests 13`, `ℹ pass 13`, `ℹ fail 0`.

Each row below is a single clause of `isUninstallerEntry` (or the whole
function, last row), neutered in isolation, suite re-run against the
identical, unmodified 13-test file, then reverted (`git checkout --`) and
the baseline re-confirmed green before moving to the next row. Every
mutation and its exact result was observed directly, not inferred:

| # | Clause mutated | Mutation | Result | Failing test(s) |
|---|---|---|---|---|
| 1 | `UNINSTALLER_BASENAME_PATTERNS[0]` | `/^unins\d*\.exe$/i` → never matches | 10 pass / 3 fail | the DJI real-finding test, the Inno-Setup-variants test, `partitionUninstallers`'s test |
| 2 | `UNINSTALLER_BASENAME_PATTERNS[1]` | `/^uninst\d*\.exe$/i` → never matches | 12 pass / 1 fail | "exclui outros nomes de binário dedicados a desinstalação" |
| 3 | `UNINSTALLER_BASENAME_PATTERNS[2]` | `/^uninstall\.exe$/i` → never matches | 12 pass / 1 fail | "exclui outros nomes de binário dedicados a desinstalação" |
| 4 | `UNINSTALLER_BASENAME_PATTERNS[3]` | `/^uninstaller\.exe$/i` → never matches | 12 pass / 1 fail | "exclui outros nomes de binário dedicados a desinstalação" |
| 5 | `EXACT_UNINSTALL_NAME` | `/^uninstall$/i` weakened to substring `/uninstall/i` | 9 pass / 4 fail | both false-positive-avoided tests, the exact-match-not-substring test, `partitionUninstallers`'s test |
| 6 | `.exe` guard on the exact-name exception | `EXACT_UNINSTALL_NAME.test(name) && /\.exe$/i.test(base)` → `EXACT_UNINSTALL_NAME.test(name)` (the exact round-2-review mutation, reproduced: `git diff -U0` shows the identical one-line change the reviewer pasted) | 12 pass / 1 fail | the new "o guard '.exe' da exceção de nome exato é uma cláusula própria" test — **this is the gap round 2 found; it is closed** |
| 7 | `MSIEXEC_BASENAME` | `/^msiexec\.exe$/i` → never matches | 12 pass / 1 fail | "exclui achado real de máquina: msiexec.exe /x {GUID} ..." |
| 8 | `MSI_UNINSTALL_ARG` | `/(^|\s)\/(x|uninstall)\b/i` → never matches | 12 pass / 1 fail | "exclui achado real de máquina: msiexec.exe /x {GUID} ..." |
| 9 | input guard | `if (!entry \|\| typeof entry.target !== "string" \|\| entry.target === "") { return false; }` → `if (false) { return false; }` | 12 pass / 1 fail | "atalho não resolvido (target vazio/null) nunca é excluído por esta regra" |
| 10 | name derivation | `entry.name.trim()` → `entry.name` (drop `.trim()`) | 12 pass / 1 fail | "o match exato de nome 'Uninstall' não vira substring ..." (the padded-whitespace fixture) |
| 11 | whole function | early `return false;` as the first line (rule effectively deleted) | 6 pass / 7 fail | every "exclui ..." test, plus `partitionUninstallers`'s test |

Rows 9–10 were not in the round-2 review's own list but were added on
self-review here: `isUninstallerEntry` contains two more clauses besides the
6 decision-branches in rows 1–8 (the input guard that short-circuits on a
missing/empty target, and the `typeof`+`trim()` that derives `name` before
it feeds `EXACT_UNINSTALL_NAME`), and the mutation table is only a true
per-clause proof if every clause the function contains is a row — leaving
either of these two out would have repeated the exact "coverage claimed but
not verified per-clause" pattern round 2 rejected round 1 for. Both have a
test that fails when neutered alone.

Row 11's 7 failing tests, for the record (unchanged in substance from round
1, now correctly described as "the whole-function proof," not "every
clause"):

```
✖ exclui o achado real: Uninstall DJI Assistant 2 -> unins000.exe
✖ exclui variantes numeradas do Inno Setup, incluindo caminho com espaço
✖ exclui outros nomes de binário dedicados a desinstalação
✖ exclui achado real de máquina: shortcut nomeado exatamente 'Uninstall' para plugin OBS (atkAudio)
✖ o match exato de nome 'Uninstall' não vira substring: 'Uninstall Tool' e 'UninstallGuard Pro' continuam protegidos
✖ exclui achado real de máquina: msiexec.exe /x {GUID} (Uninstall Go, Uninstall Node.js)
✖ partitionUninstallers separa a lista real medida: 1 excluído de 4, nomeado
```

The row-11 mutation's remaining 6 passes are the "must NOT exclude"
false-positive guards (including the new row-6 fixture, which also expects
`false` and so passes vacuously under a function that always returns
`false`) — exactly the shape rule zero warns about ("a test that passes
either way proves nothing"). This is precisely why coverage is now reported
per clause (rows 1–10): a test that only passes vacuously under the
whole-function mutation can still be the one pinning clause behavior a
narrower, single-clause mutation would otherwise miss — as row 6
demonstrates directly.

**All 10 clauses (rows 1–10) have at least one test that fails when that
clause alone is neutered, and the whole-function fallback (row 11) still
fails independently.** Every mutation was reverted with `git checkout --`
immediately after its result was recorded, and the baseline (`13`/`13`/`0`)
was re-confirmed after every single revert before the next mutation began; no
neutered version was ever committed.

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
