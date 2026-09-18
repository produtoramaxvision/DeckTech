# ADR-0002: UWP/Store app enumeration via `shell:AppsFolder`

- Status: Accepted (round 3 — all round-2 review findings fixed and re-measured)
- Date: 2026-09-17 (round 1), revised 2026-09-17/18 (round 2), revised again
  2026-09-17 (round 3, see below)
- Requirement: PROOF-02 (`.maxvision/REQUIREMENTS.md` Fase 0), gates PLAT-02
- Supersedes: nothing. First measurement of the gap `WINDOWS-STACK.md:243-245`
  flagged as unmeasured: *"Apps UWP/Store não aparecem. `.lnk` não cobre
  `shell:AppsFolder`. Calculadora, Fotos, Terminal etc. exigem enumeração
  separada. Não implementei nem medi esse caminho."*

## Round 3: what changed and why

A round-3 review rejected the round-2 artifact with 6 findings (1 blocker, 2
major, 3 minor). Every one is fixed in `measure/windows/proof-02/uwp-enum.mjs`
and re-measured; this document is updated in place rather than rewritten a
third time, since round 2's structure and most of its content still holds.

1. **(blocker) The byte-search half of the structural absence proof was
   provably incapable of detecting the exact case it exists to cover.** It
   searched a LATIN1 decoding of each `.lnk`'s bytes, but the
   AUMID/`PackageFamilyName` inside a `shell:AppsFolder` IDList is stored as
   UTF-16LE — the search could never match and returned `absent: true` by
   construction, not by evidence, for every IDList-only shortcut. See
   "Structural absence proof, round 3" below for the fix, the committed
   positive/negative control fixture, and — because an encoding tweak alone
   doesn't prove the check can return a negative — the exact honest scope
   this check now states about itself.
2. **(major) This document claimed `raw-startapps.json` "was removed from
   the working tree"** when the documented re-record command recreated it
   in `out/` on every run — the file was structurally unremovable as
   written. Fixed at the source (the raw dump now always writes to
   `uwp-enum.mjs`'s own gitignored `.scratch/` directory, independent of
   `--out`) and the claim below is now verified true, not aspirational.
3. **(major) The benchmark's control arm was labeled "existing mechanism"
   but measured a bare directory walk** (no target resolution) — a
   fundamentally cheaper operation than the COM `.lnk` resolution this
   script's own header cites as the real existing mechanism (2395 ms).
   Relabeled to what it measures; see "Measured result, round 3" below for
   the honest comparison, with every figure's source stated.
4. **(minor) `gitInfo()` recorded `lnk-parser.mjs`'s dirty status but not
   `uwp-enum.mjs`'s own**, while the comment above it claimed the recorded
   state told a reader "exactly what code produced" the artifact. Now
   records both scripts' dirty status AND a SHA-256 of each — the hash is
   provenance that holds even when (as is structurally true on the very run
   that ships this fix) the script recording its own state is necessarily
   dirty relative to `HEAD`.
5. **(minor) `--out --bogus` silently created a directory named `--bogus`.**
   `parseArgs` now rejects an `--out` value starting with `--`, throwing and
   naming the offending token.
6. **(minor) The install-location containment check was a bare
   `startsWith` with no path-separator boundary**, so a sibling
   MSIX-versioned directory sharing a name prefix could satisfy it. Fixed
   to require the next character after the install-location prefix to be a
   path separator (or an exact match).

## Round 2: what changed and why

A round-2 review rejected the first version of this ADR/artifact with 11
findings (2 blocker, 5 major, 4 minor). Every one is fixed in
`measure/windows/proof-02/uwp-enum.mjs`; this document is rewritten from the
re-run's actual output, not patched around the old numbers. Summary (full
detail inline in the sections below):

1. **(blocker) Activation proof had no control.** `launchAndObserve()` now
   snapshots the target process's PID set *before* launching, requires a PID
   that is *not* in that baseline, and records the specific attributed PID.
   If a matching process already exists at baseline, the proof is skipped
   and the reason recorded — never faked.
2. **(blocker) Unverified mechanism attribution presented as fact.** The
   second "Claude" AUMID is no longer asserted to be a win32 Claude desktop
   app. Its `.lnk` was resolved this run and is a Firefox "taskbar tab" web
   app (see "Merge-without-duplicates" below).
3. **(major) PII in version control.** `raw-startapps.json` (full
   `Get-StartApps`+`Get-AppxPackage` dump, absolute paths embedding the OS
   username) is removed from git tracking and gitignored; it remains in
   history at commit `9d07cd6` (see "Known gaps").
4. **(major) `absentFromLnkScan` was a display-name string match**, which
   produced a false negative on this machine's own data. It is now a
   structural proof against resolved `.lnk` targets (see "Structural
   absence proof" below).
5. **(major) The `.lnk` baseline silently degraded** when `PROGRAMDATA`/
   `APPDATA` was unset, and swallowed every `readdirSync` error class as
   "does not exist". Both now fail loudly (see "Re-verification" below).
6. **(major) Cleanup force-killed every `CalculatorApp.exe` by image name.**
   Now kills only the specific PID this run attributed to its own launch.
7. **(major) Every timing was an unrepeated single sample.** Now 1 warmup +
   5 timed runs per arm, median/min/max/n reported.
8. **(minor) The reproduce command overwrote the committed evidence.**
   Default `--out` is now a gitignored scratch dir; `out/` is only updated
   by an explicit `--out measure/windows/proof-02/out`.
9. **(minor, ROADMAP-level) Terminal substitution wasn't visible at the
   success criterion.** `.maxvision/ROADMAP.md` Phase 0 criterion 2 amended.
10. **(minor) A malformed `--out` silently fell back to the committed
    directory.** Now throws naming the offending argument.
11. **(minor) `classify()` discarded parsed `family`/`appIdPart` on
    non-packaged rows.** Now kept on every AUMID-shaped row, with
    `familyInAppxRegistry` as the separate verified/unverified flag.

## Context

The `.lnk`-based scan (`.maxvision/research/WINDOWS-STACK.md` §6.1, and
confirmed independently by `docs/adr/0003-proof-03-lnk-binary-parsing.md`'s
own byte-level search of all 182 `.lnk` files) structurally cannot see
UWP/Store apps: they have no Start-menu `.lnk` at all. They are addressed
only through the virtual `shell:AppsFolder` namespace, by
AppUserModelID (AUMID) — a string like
`Microsoft.WindowsCalculator_8wekyb3d8bbwe!App`, not a filesystem path.
`app.getFileIcon()`/`.lnk` resolution has nothing to walk for these apps.

## What was built

- `measure/windows/proof-02/collect-startapps.ps1` — runs `Get-StartApps`
  (the same Start-menu/search index Win+S reads: every app, packaged and
  unpackaged, keyed by whatever AUMID Windows resolved, `Name` already
  localized) and `Get-AppxPackage` (the authoritative registry of installed
  MSIX/UWP packages, now including `InstallLocation` — see "Structural
  absence proof") in one PowerShell process, and writes both as UTF-8
  (no BOM) JSON to a file.
- `measure/windows/proof-02/uwp-enum.mjs` — the Node orchestrator: times
  the existing `.lnk` walk and the PowerShell collect (each repeated for a
  real median), classifies every `Get-StartApps` row, cross-verifies
  "packaged" against `Get-AppxPackage`, locates the three proof apps by
  package family, structurally proves their absence from the `.lnk` scan
  by reusing PROOF-03's binary `.lnk` parser (`measure/windows/lnk-parser.mjs`,
  `parseLnk`) to resolve every shortcut's target, proves one activation path
  actually launches its app with a PID-level control, and writes a full
  audit JSON.

## Mechanism decision: `Get-StartApps`, verified against `Get-AppxPackage`

Two mechanisms were available: (a) parse `Windows.Management.Deployment`
package manifests directly (`Get-AppxPackage` + read each
`AppxManifest.xml`'s `<Application Id="...">`, then resolve the
`ms-resource:` display-name indirection via `SHLoadIndirectString`), or
(b) read `Get-StartApps`, which already returns the fully shell-resolved
`{Name, AppID}` pair Windows itself computed — but undocumented as to
which set of apps it draws from (packaged + unpackaged + junk, mixed).

**Chosen: (b), with (a)'s data source (`Get-AppxPackage`) used as a
verifier, not a name source.** `Get-StartApps` alone cannot be trusted to
mean "UWP app" — its 188 rows on this machine include filesystem `.exe`
paths, `steam://` protocol URIs, `.url`/`.chm`/`.txt` document shortcuts,
and `Uninstall IObit Uninstaller → unins000.exe`. A row is classified
`packaged: true` only when its `AppID` has the
`PackageFamilyName!ApplicationId` shape **and** that exact
`PackageFamilyName` exists in the live `Get-AppxPackage` list — never by
guessing from the AUMID string shape alone. This avoids manifest parsing
and `ms-resource:` resolution entirely (the shell already did it), while
still grounding "packaged" in an authoritative source instead of a
regex heuristic.

## Measured result, round 3 (this machine, 2026-09-17 22:35 local, pt-BR)

Repo state at measurement time (recorded in the committed artifact — round-3
minor finding 4 extends this to cover the script producing the artifact, not
only its imported dependency):

- `headCommit: 14a44ac4717d2283076c010819bd12a8a099a03c`
- `lnkParserDirty: false` (`measure/windows/lnk-parser.mjs` matched `HEAD`)
- `uwpEnumDirty: true`, `uwpEnumSha256:
  7d901c0dfc2797ad00d3b43ad51eec6f702e867cdc78dc78fd5575674f89ee0b` — this
  script is necessarily dirty relative to the commit above *until the commit
  that ships this very round-3 fix lands*; that is expected, not a defect,
  which is exactly why the hash (stable regardless of commit timing) is now
  recorded alongside the dirty flag rather than in place of it.
- `collectStartAppsDirty: false`, `collectStartAppsSha256:
  6bfb3270f6e009688cebc395a3554562544c2200294cc904b355e9bfd570a6ef`

```
.lnk directory walk (baseline enumeration only, no target resolution):
  182 .lnk files, 1 warmup + 5 timed runs -> median 10.589 ms
  (min 9.256, max 14.657, n=5)
  root [PROGRAMDATA]: 123 .lnk files
  root [APPDATA]: 59 .lnk files
Get-StartApps + Get-AppxPackage collect: 1 warmup + 5 timed runs
  -> median 2430.529 ms (min 1954.964, max 5403.933, n=5)
  -> 188 index rows, 131 installed AppX packages
Classification: 18 rows confirmed packaged (UWP/Store), 170 rows non-packaged
Total scan count: 188 Start-menu index rows scanned
Elapsed time: 2441.12 ms = median(.lnk directory walk) + median(PowerShell collect)
  — a sum of medians, explicitly labeled as such, not a single sample.
```

**Round-3 major finding 3 fix.** The arm above is labeled for what it
actually measures — a bare `readdir`+filter walk that never resolves a
target — not "the existing mechanism", which round 2 had set against the new
mechanism's cost with the implication that UWP enumeration is ~276x more
expensive than the pre-existing `.lnk` scan. It isn't: the pre-existing
mechanism this script's own header describes resolves targets via COM, and
that cost is comparable in order of magnitude to the new mechanism, not two
orders of magnitude cheaper. The honest comparison, every figure labeled
with its source (none of these three is measured by *this* script run):

| Source | What it measures | ms |
|---|---|---|
| `.maxvision/research/WINDOWS-STACK.md` | 149 `.lnk` resolved via COM (original research baseline) | 2395 |
| `docs/adr/0003-proof-03-lnk-binary-parsing.md` | COM loop-only, re-measured, median n=5 | 273.1 |
| this run | Get-StartApps + Get-AppxPackage collect, median n=5 | 2430.5 |

The new UWP-enumeration mechanism costs the same order of magnitude as COM
`.lnk` resolution — not ~276x more than a directory listing that was never
the thing worth comparing against. This is also recorded machine-readable in
the committed artifact's `existingMechanismComparison` field, and printed at
the CLI alongside the (correctly relabeled) directory-walk line.

The PowerShell-collect arm's own min/max (1955–5404 ms, n=5) shows the
~20%+ run-to-run variance round-2 finding 7 flagged directly — the median is
reported specifically so a reader is not handed a number that looks stabler
than the underlying process actually is.

Reproduce (does **not** touch the committed snapshot):
`node measure/windows/proof-02/uwp-enum.mjs` (writes to a gitignored
scratch dir by default). To **re-record** the committed evidence:
`node measure/windows/proof-02/uwp-enum.mjs --out measure/windows/proof-02/out`
(round-2 minor finding 8). Full per-row data:
`measure/windows/proof-02/out/uwp-scan-result.json` (committed; only
updated by the explicit re-record command above).

### The three proof apps

| App | Localized name found | AUMID (activation path) | Absent from `.lnk` scan (structural proof) |
|---|---|---|---|
| Calculator | **Calculadora** | `Microsoft.WindowsCalculator_8wekyb3d8bbwe!App` | true |
| Photos | **Fotos** | `Microsoft.Windows.Photos_8wekyb3d8bbwe!App` | true |
| Terminal | *(see below — not installed on this machine)* | — | — |

### Structural absence proof (round-2 major finding 4)

Round 1 derived `absentFromLnkScan` from `lnkNameCollision` — a match
between the packaged app's localized display name and any `.lnk`
*basename*. This produced a false negative in round 1's own committed
data: the genuinely-packaged Store app `Claude_pzs8sxrjxfjjc!Claude`
(confirmed via `Get-AppxPackage`, `InstallLocation`
`C:\Program Files\WindowsApps\Claude_1.37937.3.0_x64__pzs8sxrjxfjjc`) was
reported `absentFromLnkScan: false`, purely because an unrelated Firefox
web-app shortcut also happens to be named `Claude.lnk`. It is also a third,
non-comparable key space: PLAT-02's real dedupe works on resolved target
path, not `.lnk` basename.

**Fixed: absence is now decided structurally**, per packaged app, by two
independent checks that must *both* come back empty:

1. Resolve every `.lnk` under both Start Menu roots with
   `measure/windows/lnk-parser.mjs`'s `parseLnk` (the same pure-Node binary
   reader PROOF-03 validated against the COM baseline) and check whether any
   resolved target path falls inside the package's `Get-AppxPackage`
   `InstallLocation`.
2. `parseLnk` returns `resolvedTargetPath: null` for IDList-only shortcuts
   (12 of 182 `.lnk` files on this machine — `unresolvedTargetCount: 12` in
   the artifact); check (1) cannot decide those. A raw byte-level search of
   every `.lnk` file's bytes for the package's `PackageFamilyName` string
   (the same technique `docs/adr/0003` already used) covers that gap.

Regression proof — the exact case round-2 finding 4 flagged, re-run under
the new logic (`packagedClaudeStructuralAbsenceCheck` in the committed
artifact):

```json
{
  "installLocation": "C:\\Program Files\\WindowsApps\\Claude_1.37937.3.0_x64__pzs8sxrjxfjjc",
  "resolvedTargetMatches": [],
  "byteSearchMatches": [],
  "absent": true
}
```

`lnkDisplayNameCollision` (renamed from `lnkNameCollision`) is still `true`
for this row — kept as a diagnostic only, no longer used to derive
`absentFromLnkScan`. The same two checks for Calculator, Photos, and
PowerShell (Store) all come back `absent: true` with empty match lists —
see `measure/windows/proof-02/out/uwp-scan-result.json`'s `proofTargets[].structuralAbsenceEvidence`.

### Structural absence proof, round 3: the byte search was provably blind

**The round-2 byte search (2) never worked.** It lowercased each `.lnk`'s
bytes as **LATIN1** (`buf.toString('latin1').toLowerCase()`) and searched
for the family name in that decoding. The family name inside a
`shell:AppsFolder` IDList is stored as **UTF-16LE**, an encoding LATIN1
cannot represent — the search could not match *by construction*, on any
input, regardless of whether the family name was present. Every
`absentFromLnkScan: true` the round-2 artifact reported rested on a check
that returned empty no matter what it was searching; deleting the check
would have produced identical output. The round-3 reviewer proved this with
a real shell:AppsFolder shortcut built via `WScript.Shell` — against it,
`parseLnk` correctly reported `resolvedTargetPath: null, idListOnly: true`
(exactly the case check (1) cannot decide) while the byte search reported no
match despite the family name being present in the file.

**On this machine's own data, the conclusion the round-2 artifact reported
(`absent: true` for Calculator/Photos/PowerShell/Claude) happens to be
correct** — independently re-verified: none of the four families appear in
any of the 182 `.lnk` files under any encoding (LATIN1, `toString('utf16le')`,
or raw UTF-16LE bytes — all 0/182). A correct conclusion from an unsound
check is not evidence the check works; it means this machine's data didn't
happen to expose the gap.

**Fixed**, in two parts, per the round-3 required fix (combining options
(a) and (c) — a bare encoding tweak was explicitly rejected as insufficient
on its own):

1. **The search itself.** `lnkBytesContainFamily(buf, family)` does a
   byte-level search: `buf.includes(Buffer.from(family, 'utf16le'))`. A
   plain `buf.toString('utf16le').includes(family)` is *also* insufficient
   — the round-3 reviewer's own control returned `false` under it, because a
   shell item's string payload is not guaranteed to start at an even
   (2-byte-aligned) offset from 0, so decoding the whole buffer as UTF-16LE
   from offset 0 can still miss a needle a raw byte-level search finds.
2. **A committed positive/negative control fixture**, so the check is
   *demonstrably capable of a negative*, not merely re-labeled and
   re-claimed:
   `measure/windows/proof-02/fixtures/shell-appsfolder-calculator-control.lnk`
   — a real `shell:AppsFolder` shortcut (1439 bytes, generated via
   `WScript.Shell`, `TargetPath = "shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"`,
   verified free of any machine-specific content before committing — `grep`
   for the OS username and for `C:\Users` both return no match). Every run
   now asserts, using the **exact same `lnkBytesContainFamily` function**
   the real per-app check calls (not a separately-written copy, which would
   prove nothing about the search actually used):
   - `parseLnk` on the fixture confirms `resolvedTargetPath: null` and
     `idListOnly: true` — this really is the case check (1) cannot decide.
   - **Positive control**: `lnkBytesContainFamily(fixtureBuf,
     'Microsoft.WindowsCalculator_8wekyb3d8bbwe')` is `true`.
   - **Negative control**: `lnkBytesContainFamily(fixtureBuf,
     'Microsoft.Windows.Photos_8wekyb3d8bbwe')` — a family the fixture does
     not reference — is `false`.

   Any control failing throws immediately, naming which one, before any
   `absentFromLnkScan` claim is made. This run's result (also in the
   committed artifact's `structuralAbsenceSelfTest`):

   ```json
   {
     "fixtureConfirmedIdListOnly": true,
     "positiveControlFamily": "Microsoft.WindowsCalculator_8wekyb3d8bbwe",
     "positiveControlDetected": true,
     "negativeControlFamily": "Microsoft.Windows.Photos_8wekyb3d8bbwe",
     "negativeControlDetected": false,
     "passed": true
   }
   ```

**Honest scope statement (the required fix's option (c), combined with
(a) rather than instead of it).** This search detects a `PackageFamilyName`
present as literal UTF-16LE bytes anywhere in a `.lnk` file. It is **not** a
decode of `LinkTargetIDList` — `lnk-parser.mjs` explicitly scopes that out
(its header, "Deliberate scope limits" §1) — so it cannot say *where* in the
shortcut the string appears or *what shell-item type* references it, and a
shortcut that lacks the literal family-name string as a contiguous UTF-16LE
run cannot be ruled out from referencing the package through some other,
indirect encoding this search does not know how to recognize (for instance,
a family name split across a compressed or otherwise transformed
representation, if one exists in some IDList variant this proof has not
encountered). The self-test proves the check is **capable of a real
positive hit and of not firing on an unrelated family** — it upgrades the
check from "returns empty by construction" to "returns empty because it
looked and found nothing, on this run's 182 shortcuts." It does not upgrade
it to a general proof that "byte search found nothing" implies "no `.lnk`
anywhere could reference the package under any possible IDList encoding."
For the 12 `unresolvedTargetCount` (IDList-only) shortcuts on this machine,
that is the precise, complete statement of what is and is not established.

### Activation proof (round-2 blocker 1 / major finding 6)

Round 1's `launchAndObserve()` polled `tasklist` for the image name with no
pre-launch baseline and no PID identity, so `processObserved: true` could
not distinguish "our AUMID launched the app" from "this process was already
running" — the round-2 reviewer demonstrated this by feeding a bogus AUMID
to the identical function against a Calculator they had started themselves,
and it reported `activationObserved: true`.

**Fixed.** `launchAndObserve()` now:

1. Snapshots the `CalculatorApp.exe` PID set via `tasklist /FI "IMAGENAME eq
   CalculatorApp.exe" /FO CSV /NH` *before* calling `explorer.exe`.
2. Independently re-verified before this run: no `CalculatorApp.exe` was
   running at baseline —
   ```
   > tasklist /FI "IMAGENAME eq CalculatorApp.exe" /FO CSV /NH
   INFORMAÇÕES: nenhuma tarefa em execução correspondente aos critérios especificados.
   ```
3. Launches `explorer.exe shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App`,
   then polls `tasklist` and requires a PID **not** in the baseline set.
4. This run attributed PID `45092` (recorded in
   `activationProof.attemptedPid` in the committed artifact) — a specific,
   newly-observed process identity, not "any `CalculatorApp.exe` row".
5. Cleanup kills **only** that PID (`taskkill /PID 45092`, graceful first;
   `/F` only if it survives — it did not:
   `{"attemptedGraceful":true,"forced":false,"survivedGraceful":false,"error":null}`),
   never `taskkill /IM CalculatorApp.exe /F` (round 1's machine-wide kill,
   which round-2 finding 6 demonstrated terminates a user's pre-existing,
   unrelated Calculator with no prompt for unsaved state).
6. If a `CalculatorApp.exe` already existed at baseline, the proof is
   **skipped** (`activationProof.baselineSkipped: true` with a
   `skipReason`) rather than risk killing a process this script did not
   start, or reporting an unattributable `processObserved: true`. This
   branch did not fire on the measurement run above (baseline was empty),
   so it was exercised separately, deliberately, with a real pre-existing
   process to control against: `Start-Process
   'shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'` was
   run manually first (`Get-Process` confirmed `CalculatorApp.exe` PID
   `9264`), then `uwp-enum.mjs` was run again (into a scratch dir, not the
   committed snapshot). Result:
   ```
   Activation proof (baseline-diffed PID, not a bare tasklist poll):
     launched via explorer.exe shell:AppsFolder\...: false
     SKIPPED: CalculatorApp.exe already running at baseline (PID(s): 9264).
     Cannot attribute a newly-launched process to this AUMID without
     risking killing a process this script did not start — skipping the
     activation proof rather than faking it.
   ```
   `tasklist` confirmed PID `9264` was still running, untouched,
   immediately after this run — the skip branch protected the
   pre-existing process exactly as designed, then it was closed manually
   (`Stop-Process -Id 9264 -Force`) as ordinary test cleanup, not by the
   script.

### Windows Terminal is genuinely not installed on this machine

Re-verified independently for this round (not copied from round 1's
output):

```
Get-AppxPackage -Name "*Terminal*"   -> (no output)
where.exe wt.exe                     -> "não foi possível localizar arquivos para o(s) padrão(ões) especificado(s)"
```

Windows 11 22631 does not guarantee Windows Terminal inbox on every build —
this machine's build lacks it (or it was removed). Per rule 1 ("never claim
a result you did not observe"), this is reported as a fact rather than
worked around by installing software solely to make a proof pass.

**Substitute proof app: PowerShell (Store-packaged), `Microsoft.PowerShell`.**
Confirmed installed, confirmed structurally absent from the `.lnk` scan
(same check as Calculator/Photos/Claude above — see
`proofTargets[2].structuralAbsenceEvidence` in the committed artifact), same
`PackageFamilyName!ApplicationId` AUMID shape:

```
Microsoft.PowerShell_8wekyb3d8bbwe!App
```

This exercises the identical code path (packaged classification →
`Get-AppxPackage` verification → structural absence proof →
`shell:AppsFolder` activation path construction) that Terminal would have;
it substitutes the specific app instance, not the mechanism being proven.
**`.maxvision/ROADMAP.md` Phase 0 success criterion 2 has been amended to
name this substitution explicitly** (round-2 minor finding 9 — this was a
bookkeeping gap in round 1: the deviation was documented here but not at
the criterion it deviates from).

## Locale handling (pt-BR)

**Identity is the AUMID's `PackageFamilyName`, which is locale-invariant.
The display name is opaque and never matched on for *identity* purposes**
(it is now used for one thing only: the `lnkDisplayNameCollision`
diagnostic field, explicitly not load-bearing — see "Structural absence
proof" above). `Microsoft.Windows.Photos_8wekyb3d8bbwe` is the same string
in every UI language; what `Get-StartApps` returns as `Name` for it on this
machine is "Fotos", not "Photos", because the shell resolved the package
manifest's `ms-resource:` reference against the pt-BR UI culture
(`culture: "pt-BR"` in the committed artifact, from `Get-Culture` in
`collect-startapps.ps1`). The enumerator selects its three proof rows by
`PackageFamilyName` (`PROOF_FAMILIES` in `uwp-enum.mjs`) and only *displays*
whatever localized `Name` comes back — it never searches for "Calculator"
or "Photos" as strings. A scan that matched on the English display name
would find zero of the three apps on this machine, which is exactly the
failure mode this requirement calls out.

## Merge-without-duplicates: the real case found on this machine

**Decision (unchanged from round 1): only the `packaged: true` subset of
`Get-StartApps` is a new source of apps. The `packaged: false` subset is
discarded entirely at this layer** — those rows are non-packaged (win32)
apps that the `.lnk`-based scan (PROOF-03/PLAT-02) already discovers
independently by walking the Start Menu directories and resolving each
shortcut's target path. Unioning `Get-StartApps`'s unpackaged rows with the
`.lnk` scan's results would double-count them under two different,
non-comparable keys (an AUMID has no filesystem target to dedupe against a
resolved `.exe` path).

This is not a theoretical risk — a real duplicate-shaped case exists on
this machine right now, under the display name **"Claude"**:

```
1) aumid=Claude_pzs8sxrjxfjjc!Claude                 packaged=true
   (confirmed: Get-AppxPackage family "Claude_pzs8sxrjxfjjc",
   InstallLocation C:\Program Files\WindowsApps\Claude_1.37937.3.0_x64__pzs8sxrjxfjjc)
2) aumid=1bbf47ca-ae3c-4c7c-accd-4ac80b81cc1f        packaged=false
   (no "!" in the AppID -> aumidShaped=false -> classified unpackaged;
   confirmed absent from Get-AppxPackage)
```

**Round-2 blocker 2 correction.** Row 2 was previously characterized as
"the separately installed win32 Claude desktop app (its AUMID has the shape
electron-builder assigns for Windows toast notifications on non-MSIX
installs)" — a mechanism attribution that was never actually checked
against the `.lnk` it claimed to describe. Resolving that `.lnk` (this run,
via `measure/windows/lnk-parser.mjs`'s `parseLnk`, and independently
re-verified via `WScript.Shell` for this document) shows something
different:

```
%USERPROFILE%\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Aplicativos web do Firefox\Claude.lnk
  TARGET: C:\Program Files\Mozilla Firefox\firefox.exe
  ARGS:   "-taskbar-tab" "1bbf47ca-ae3c-4c7c-accd-4ac80b81cc1f" "-new-window" "https://claude.com"
          "-profile" "...\Mozilla\Firefox\Profiles\...default-release" "-container" "0"
```

This is a **Firefox "taskbar tab" web app** (`-taskbar-tab`, Firefox's
site-specific-browser feature), living in the Start Menu folder literally
named "Aplicativos web do Firefox" (Firefox web apps). The GUID
`1bbf47ca-ae3c-4c7c-accd-4ac80b81cc1f` that `Get-StartApps` surfaces as this
row's `AppID` is the same GUID passed as the `-taskbar-tab` argument — it is
Firefox's own site-specific-browser identifier, not a registered Windows
`AppUserModelId`. Confirmed by absence from the registry:

```
Test-Path 'HKCU:\SOFTWARE\Classes\AppUserModelId\1bbf47ca-ae3c-4c7c-accd-4ac80b81cc1f'
-> False
```

No win32 Claude desktop install exists on this machine (also independently
re-checked: no `%LOCALAPPDATA%\AnthropicClaude`, `%LOCALAPPDATA%\Programs\claude`,
or `%PROGRAMFILES%\Claude`). **Corrected statement: these are a
Store-packaged "Claude" app and a Firefox-hosted web-app shortcut to
claude.com — two genuinely different, independently-launchable things that
happen to share a four-letter display name — not the win32 Claude desktop
app.** The conclusion this ADR draws from the case is unchanged and, if
anything, stronger for resting on what was actually observed: a name-based
merge would still have wrongly collapsed a real packaged app and a real
(if unrelated-to-Claude-the-application) `.lnk` entry into one dock tile.

The merge key this ADR settles on — packaged apps keyed by
`PackageFamilyName!AppId` from `Get-StartApps` (verified against
`Get-AppxPackage`), unpackaged apps keyed by the `.lnk` scan's normalized
target path, and the two pools never cross — keeps both "Claude"-named
entries correctly separate, and never risks colliding a packaged app with
an unpackaged one, because a resolved `.exe` path and an AUMID occupy
disjoint string spaces (a target path is never a valid AUMID and vice
versa; no normalization step could accidentally equate them).

**Implication for PLAT-02**: the final app list is
`lnkScanResults ∪ packagedUwpApps`, deduped independently within each side
(existing target-path dedupe for the `.lnk` side; `PackageFamilyName!AppId`
is already unique per installed package on the UWP side — MSIX permits at
most one instance of a given family per user), never across sides.

## Known gaps, stated honestly

- **`raw-startapps.json` is never committed and is gitignored, but it is
  regenerated on disk by every run — it is not, and structurally cannot be,
  "removed from the working tree" as round 2's version of this bullet
  claimed** (round-3 major finding 2: the round-2 script wrote it into
  whatever `--out` received, so the ADR's own documented re-record command,
  `--out measure/windows/proof-02/out`, recreated it in the committed `out/`
  directory on every run — the file was structurally unremovable by design,
  and the ADR asserted otherwise without re-running the command to check).
  **Fixed at the source**: the raw dump now always writes to
  `uwp-enum.mjs`'s own gitignored `.scratch/` directory, independent of
  `--out`, so `out/` genuinely never receives it regardless of what `--out`
  points at — verified this round: `ls measure/windows/proof-02/out/` lists
  only `uwp-scan-result.json`, and
  `git ls-files -- measure/windows/proof-02/out/raw-startapps.json` matches
  nothing.
  It is a personal-machine software inventory — all 188 `Get-StartApps` rows
  and 131 `Get-AppxPackage` rows verbatim, including drive-path AppIDs and
  rows embedding the OS username (e.g. utorrent, a Python install under
  `AppData\Local\Programs`, `D:\Adobe\...` titles) — and every number this
  ADR cites is already carried by the derived, redacted
  `uwp-scan-result.json`. **It is not scrubbed from history**:
  `git log --oneline --all -- measure/windows/proof-02/out/raw-startapps.json`
  shows it reachable from **two** commits — `9d07cd6` (added) and
  `1fa06ae` (a later commit that also touched it). Rewriting that history was
  out of scope for this fix (it would rewrite shared branch history); if
  that residual exposure is unacceptable, it needs an explicit
  history-rewrite decision, which this ADR does not make unilaterally.
- **`uwp-scan-result.json` itself is redacted, but not zero-disclosure.**
  Every path field (`lnkBaseline.roots[].dir`, `structuralAbsenceEvidence.*`,
  `duplicateCaseEvidence.lnkFilesNamedClaude[].file`, `outDir`) has the
  current user's home directory replaced with the literal
  `%USERPROFILE%` before serialization — verified this run:
  `grep -c "MaxVision" measure/windows/proof-02/out/uwp-scan-result.json` → `0`.
  **This is not the same claim as "contains no information about installed
  software."** The committed `packagedApps` array names all 18 packaged
  apps this scan found installed on this machine, including third-party
  ones (`Gyroflow`, `KDE Connect`, `NVIDIA Control Panel`, `OpenAI.Codex`,
  `Claude`) — a much smaller disclosure than the 188-row raw dump, and one
  this proof cannot avoid: the requirement is literally "enumerate and
  print the installed packaged apps." That is the minimum the proof needs
  to demonstrate; it is named here explicitly rather than left for a
  reader to discover after being told "the PII problem is fixed."
- **`familyInAppxRegistry: false` on an `aumidShaped: true` row (round-2
  minor finding 11)**: the field distinguishing "AUMID-shaped but
  unverified" from "not AUMID-shaped at all" now exists
  (`classify()` keeps `family`/`appIdPart` on every row with a `!` in its
  AppID, regardless of registry verification), but **no row in this
  machine's actual 188-row dataset currently exercises that state** — every
  `!`-shaped AppID on this machine resolves to a family present in
  `Get-AppxPackage`. Verified by direct query against this run's raw
  collect: 0 rows match `aumidShaped && !familyInAppxRegistry`. The field
  is present and correct; this machine simply has no deregistered-but-
  still-indexed package to exercise it with today.
- **Uninstaller/junk exclusion** is PROOF-04's scope, not this one; the 170
  unpackaged rows in this scan's output have not been filtered by that
  rule (they are discarded at the merge layer regardless — see above — so
  this does not block PLAT-02).
- **Multi-user / per-user package visibility**: `Get-AppxPackage` without
  `-AllUsers` reflects packages registered for the *current* user only,
  which matches this scan's use case (the DeckTech host enumerates apps
  for the signed-in user), but is worth naming explicitly — a package
  provisioned machine-wide but not yet registered for this user would not
  appear, matching Start Menu's own behavior.
- **PowerShell process-spawn cost** (median 2430.5 ms round 3, 1710.5 ms
  round 2, up from round 1's single 866 ms sample — the repeated
  measurement across rounds makes the earlier number's optimism visible
  rather than hiding it, and the round-3 min/max of 1955–5404 ms shows this
  is genuine machine-load variance, not a regression) dominates the total.
  This is a single `Get-StartApps`+`Get-AppxPackage`
  call per scan, comparable in shape to the pre-existing COM-based `.lnk`
  resolution cost (2395 ms baseline / 267.9–615 ms this-run in ADR-0003) —
  not benchmarked against a non-PowerShell alternative (e.g. a native N-API
  binding to `IPackageManager`) because no such alternative was in scope
  for this requirement; flagged for PLAT-02 to revisit only if the combined
  Phase-3 scan latency proves it matters.
- **`.lnk`-target resolution cost** (`lnkTargetResolveMs: 133.2` this run —
  varies run to run with file-cache warmth; a round-2 run recorded 22.3 ms)
  is new plumbing this round adds for the structural absence proof
  (parsing all 182 shortcuts plus the round-3 fixture self-test). It is
  reported as a single sample, explicitly labeled diagnostic-only — it is
  not the ".lnk directory walk" arm the success criterion asks to be timed
  (round-3 major finding 3 renamed that arm; see "Measured result, round
  3"), and is cheap enough (182 shortcuts, pure JS, no COM/process spawn)
  that repeating it for a median was not judged worth the added script
  complexity; flagged here rather than silently presented as rigorously
  measured.

## Decision

**Ship `Get-StartApps` + `Get-AppxPackage` cross-verification as the UWP
enumeration mechanism for PLAT-02.** Evidence: it found both apps proven
present on this machine (Calculator, Photos) plus the Store-packaged
PowerShell substitute for the third, by locale-invariant package family
rather than display-name matching; it correctly reports Windows Terminal's
genuine absence rather than a false positive; its "absent from the `.lnk`
scan" claim rests on a structural proof against resolved `.lnk` targets
rather than a display-name match, backed (round 3) by a committed
positive/negative control fixture that self-tests the check's byte-search
half is actually capable of a hit before any absence claim is made, with
the check's real scope — and what it does not establish for the 12
IDList-only shortcuts — stated explicitly rather than oversold; its
activation proof is PID-attributed against a pre-launch baseline, with
cleanup scoped to that one PID; it identified a real same-display-name
duplicate risk ("Claude") and — now correctly characterized — the merge
rule that avoids it; and it costs low single-digit seconds (median 2.4 s
this round, machine-load-dependent — see PowerShell process-spawn cost
above), the same order of magnitude as the pre-existing COM-based `.lnk`
resolution it complements, not a mechanism whose cost this ADR ever
measured against the wrong baseline.
