# ADR-0002: UWP/Store app enumeration via `shell:AppsFolder`

- Status: Accepted (round 2 — all round-1 review findings fixed and re-measured)
- Date: 2026-09-17 (round 1), revised 2026-09-17/18 (round 2, see below)
- Requirement: PROOF-02 (`.maxvision/REQUIREMENTS.md` Fase 0), gates PLAT-02
- Supersedes: nothing. First measurement of the gap `WINDOWS-STACK.md:243-245`
  flagged as unmeasured: *"Apps UWP/Store não aparecem. `.lnk` não cobre
  `shell:AppsFolder`. Calculadora, Fotos, Terminal etc. exigem enumeração
  separada. Não implementei nem medi esse caminho."*

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

## Measured result (this machine, 2026-09-18 01:04 UTC, pt-BR)

Repo state at measurement time (recorded in the committed artifact, since
`lnk-parser.mjs` is co-owned by PROOF-03 and could carry uncommitted
changes): `headCommit: 7819df63d0ebb6f5d818d0a4853f06faec36d66b`,
`lnkParserDirty: false` — `lnk-parser.mjs` matched HEAD at measurement time.

```
.lnk scan (existing mechanism): 182 .lnk files, 1 warmup + 5 timed runs
  -> median 6.191 ms (min 5.497, max 7.684, n=5)
  root [PROGRAMDATA]: 123 .lnk files
  root [APPDATA]: 59 .lnk files
Get-StartApps + Get-AppxPackage collect: 1 warmup + 5 timed runs
  -> median 1710.47 ms (min 1433.837, max 3084.836, n=5)
  -> 188 index rows, 131 installed AppX packages
Classification: 18 rows confirmed packaged (UWP/Store), 170 rows non-packaged
Total scan count: 188 Start-menu index rows scanned
Elapsed time: 1716.66 ms = median(.lnk walk) + median(PowerShell collect)
  — a sum of medians, explicitly labeled as such, not a single sample.
```

The PowerShell-collect arm's own min/max (1433.8–3084.8 ms, n=5) shows the
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
   branch did not fire on this measurement run (baseline was empty); the
   code path exists and is exercised by
   `measure/windows/proof-02/uwp-enum.mjs`'s `launchAndObserve()` early
   return, unit-testable independently of a live launch.

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

- **`raw-startapps.json` is not committed and was removed from the working
  tree** (round-2 major finding 3). It is a personal-machine software
  inventory — all 188 `Get-StartApps` rows and 131 `Get-AppxPackage` rows
  verbatim, including drive-path AppIDs and rows embedding the OS username
  (e.g. utorrent, a Python install under `AppData\Local\Programs`, `D:\Adobe\...`
  titles) — and every number this ADR cites is already carried by the
  derived, redacted `uwp-scan-result.json`. `.gitignore` now excludes
  `measure/windows/proof-02/**/raw-startapps.json` going forward. **It is
  not scrubbed from history**: it remains readable in this repository at
  commit `9d07cd6`. Rewriting that history was out of scope for this fix
  (it would rewrite shared branch history); if that residual exposure is
  unacceptable, it needs an explicit history-rewrite decision, which this
  ADR does not make unilaterally.
- **`uwp-scan-result.json` itself is redacted before being written**: every
  path field (`lnkBaseline.roots[].dir`, `structuralAbsenceEvidence.*`,
  `duplicateCaseEvidence.lnkFilesNamedClaude[].file`, `outDir`) has the
  current user's home directory replaced with the literal
  `%USERPROFILE%` before serialization — verified this run:
  `grep -c "MaxVision" measure/windows/proof-02/out/uwp-scan-result.json` → `0`.
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
- **PowerShell process-spawn cost** (median 1710 ms this round, up from
  round 1's single 866 ms sample — the repeated measurement in round 2
  makes the earlier number's optimism visible rather than hiding it)
  dominates the total. This is a single `Get-StartApps`+`Get-AppxPackage`
  call per scan, comparable in shape to the pre-existing COM-based `.lnk`
  resolution cost (2395 ms baseline / 267.9–615 ms this-run in ADR-0003) —
  not benchmarked against a non-PowerShell alternative (e.g. a native N-API
  binding to `IPackageManager`) because no such alternative was in scope
  for this requirement; flagged for PLAT-02 to revisit only if the combined
  Phase-3 scan latency proves it matters.
- **`.lnk`-target resolution cost** (`lnkTargetResolveMs: 22.3` this run) is
  new plumbing this round adds for the structural absence proof. It is
  reported as a single sample, explicitly labeled diagnostic-only — it is
  not the ".lnk scan (existing mechanism)" arm the success criterion asks
  to be timed, and is cheap enough (182 shortcuts, pure JS, no COM/process
  spawn) that repeating it for a median was not judged worth the added
  script complexity; flagged here rather than silently presented as
  rigorously measured.

## Decision

**Ship `Get-StartApps` + `Get-AppxPackage` cross-verification as the UWP
enumeration mechanism for PLAT-02.** Evidence: it found both apps proven
present on this machine (Calculator, Photos) plus the Store-packaged
PowerShell substitute for the third, by locale-invariant package family
rather than display-name matching; it correctly reports Windows Terminal's
genuine absence rather than a false positive; its "absent from the `.lnk`
scan" claim is now a structural proof against resolved `.lnk` targets
rather than a display-name match (and that fix demonstrably corrects a real
false negative on this machine's own data); its activation proof is
PID-attributed against a pre-launch baseline, with cleanup scoped to that
one PID; it identified a real same-display-name duplicate risk ("Claude")
and — now correctly characterized — the merge rule that avoids it; and it
costs under 2 seconds (median), well within the ~5.3 s icon-extraction
budget PROOF-01/ADR (icon bench) already established as this scan's
dominant cost.
