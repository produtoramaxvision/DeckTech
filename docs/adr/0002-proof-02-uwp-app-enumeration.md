# ADR-0002: UWP/Store app enumeration via `shell:AppsFolder`

- Status: Accepted
- Date: 2026-09-17
- Requirement: PROOF-02 (`.maxvision/REQUIREMENTS.md` Fase 0), gates PLAT-02
- Supersedes: nothing. First measurement of the gap `WINDOWS-STACK.md:243-245`
  flagged as unmeasured: *"Apps UWP/Store não aparecem. `.lnk` não cobre
  `shell:AppsFolder`. Calculadora, Fotos, Terminal etc. exigem enumeração
  separada. Não implementei nem medi esse caminho."*

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
  MSIX/UWP packages) in one PowerShell process, and writes both as UTF-8
  (no BOM) JSON to a file. Written to a **file**, not captured from stdout,
  because piping PowerShell's console-encoded output through
  `child_process` risks mangling accented pt-BR display names
  (`Configurações`, `Legendas ao vivo`) — this was designed around, not
  discovered as a bug afterward.
- `measure/windows/proof-02/uwp-enum.mjs` — the Node orchestrator: times
  the existing `.lnk` walk, times the PowerShell collect, classifies every
  `Get-StartApps` row, cross-verifies "packaged" against
  `Get-AppxPackage`, locates the three proof apps by package family,
  proves one activation path actually launches its app, and writes a full
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

## Measured result (this machine, 2026-09-17, pt-BR)

```
.lnk scan (existing mechanism): 182 .lnk files in 8.1 ms
Get-StartApps + Get-AppxPackage collect: 866.2 ms -> 188 index rows, 131 installed AppX packages
Classification: 18 rows confirmed packaged (UWP/Store), 170 rows non-packaged
Total scan count: 188 Start-menu index rows scanned
Elapsed time: 874.3 ms total (.lnk walk 8.1 ms + PowerShell collect 866.2 ms)
```

Reproduce: `node measure/windows/proof-02/uwp-enum.mjs`. Full per-row data:
`measure/windows/proof-02/out/uwp-scan-result.json` (regenerated on each run).

### The three proof apps

| App | Localized name found | AUMID (activation path) | Absent from `.lnk` scan |
|---|---|---|---|
| Calculator | **Calculadora** | `Microsoft.WindowsCalculator_8wekyb3d8bbwe!App` | yes |
| Photos | **Fotos** | `Microsoft.Windows.Photos_8wekyb3d8bbwe!App` | yes |
| Terminal | *(see below — not installed on this machine)* | — | — |

Activation proof (not just printed — launched and observed): running
`explorer.exe shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App`
spawned `CalculatorApp.exe` (confirmed via `tasklist.exe` poll,
`Get-Process CalculatorApp` cross-checked manually), then the process was
closed (`taskkill.exe /IM CalculatorApp.exe /F`). `explorer.exe` itself
returns a non-zero exit code for `shell:` URIs even on success — the
launch is judged by the process appearing, not by that exit code.

### Windows Terminal is genuinely not installed on this machine

Verified three independent ways before writing this ADR, all empty/negative:

```
Get-AppxPackage -Name "*Terminal*"                      -> no output
where.exe wt.exe                                        -> "não foi possível localizar"
winget list --id Microsoft.WindowsTerminal               -> "Nenhum pacote instalado foi encontrado"
```

Windows 11 22631 does not guarantee Windows Terminal inbox on every build —
this machine's build lacks it (or it was removed). Per rule 1 ("never claim
a result you did not observe"), this is reported as a fact rather than
worked around by installing software solely to make a proof pass.

**Substitute proof app: PowerShell (Store-packaged), `Microsoft.PowerShell`.**
Confirmed installed (`Get-AppxPackage -Name "*PowerShell*"` →
`PackageFamilyName: Microsoft.PowerShell_8wekyb3d8bbwe`), confirmed
absent from the `.lnk` scan (the machine's `.lnk`-based PowerShell entries
are "PowerShell 7 (x64)", "Windows PowerShell", "Windows PowerShell (x86)",
"Windows PowerShell ISE" — all distinct, non-Store installs with their own
`.lnk` files; the Store-packaged "PowerShell" has none), same
`PackageFamilyName!ApplicationId` AUMID shape as Calculator and Photos:

```
Microsoft.PowerShell_8wekyb3d8bbwe!App
```

This exercises the identical code path (packaged classification →
`Get-AppxPackage` verification → `shell:AppsFolder` activation) that
Terminal would have; it substitutes the specific app instance, not the
mechanism being proven.

## Locale handling (pt-BR)

**Identity is the AUMID's `PackageFamilyName`, which is locale-invariant.
The display name is opaque and never matched on.** `Microsoft.Windows.
Photos_8wekyb3d8bbwe` is the same string in every UI language; what
`Get-StartApps` returns as `Name` for it on this machine is "Fotos", not
"Photos", because the shell resolved the package manifest's
`ms-resource:` reference against the pt-BR UI culture (`Get-Culture` in
`collect-startapps.ps1`'s output confirms `pt-BR`). The enumerator selects
its three proof rows by `PackageFamilyName` (`PROOF_FAMILIES` in
`uwp-enum.mjs`) and only *displays* whatever localized `Name` comes back —
it never searches for "Calculator" or "Photos" as strings. A scan that
matched on the English display name would find zero of the three apps on
this machine, which is exactly the failure mode this requirement calls out.

## Merge-without-duplicates: the real case found on this machine

**Decision: only the `packaged: true` subset of `Get-StartApps` is a new
source of apps. The `packaged: false` subset is discarded entirely at this
layer** — those rows are non-packaged (win32) apps that the `.lnk`-based
scan (PROOF-03/PLAT-02) already discovers independently by walking the
Start Menu directories and resolving each shortcut's target path. Unioning
`Get-StartApps`'s unpackaged rows with the `.lnk` scan's results would
double-count them under two different, non-comparable keys (an AUMID has
no filesystem target to dedupe against a resolved `.exe` path).

This is not a theoretical risk — a real duplicate-shaped case exists on
this machine right now, under the display name **"Claude"**:

```
1) aumid=Claude_pzs8sxrjxfjjc!Claude                 packaged=true
   (confirmed: Get-AppxPackage has family "Claude_pzs8sxrjxfjjc")
2) aumid=1bbf47ca-ae3c-4c7c-accd-4ac80b81cc1f        packaged=false
   (no "!" in the AppID -> classified unpackaged; also absent from
   Get-AppxPackage; matches a real Claude.lnk under
   %APPDATA%\...\Start Menu\Programs\Aplicativos ...\Claude.lnk)
```

These are **two different installed products that happen to share a
display name** — a Store-packaged "Claude" app and the separately
installed win32 Claude desktop app (its AUMID has the shape
electron-builder assigns for Windows toast notifications on non-MSIX
installs). Collapsing by display name would have wrongly merged two real,
distinct, independently-launchable apps into one dock tile. The merge key
this ADR settles on — packaged apps keyed by `PackageFamilyName!AppId`
from `Get-StartApps` (verified), unpackaged apps keyed by the `.lnk`
scan's normalized target path, and the two pools never cross — keeps both
"Claude" entries correctly separate, and never risks colliding a packaged
app with an unpackaged one, because a resolved `.exe` path and an AUMID
occupy disjoint string spaces (a target path is never a valid AUMID and
vice versa; no normalization step could accidentally equate them).

**Implication for PLAT-02**: the final app list is
`lnkScanResults ∪ packagedUwpApps`, deduped independently within each side
(existing target-path dedupe for the `.lnk` side; `PackageFamilyName!AppId`
is already unique per installed package on the UWP side — MSIX permits at
most one instance of a given family per user), never across sides.

## Known gaps, stated honestly

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
- **PowerShell process-spawn cost** (866 ms) dominates the total. This is
  a single `Get-StartApps`+`Get-AppxPackage` call per scan, comparable in
  shape to the pre-existing COM-based `.lnk` resolution cost (2395 ms
  baseline / 267.9-615 ms this-run in ADR-0003) — not benchmarked against
  a non-PowerShell alternative (e.g. a native N-API binding to
  `IPackageManager`) because no such alternative was in scope for this
  requirement; flagged for PLAT-02 to revisit only if the combined
  Phase-3 scan latency proves it matters.

## Decision

**Ship `Get-StartApps` + `Get-AppxPackage` cross-verification as the UWP
enumeration mechanism for PLAT-02.** Evidence: it found both apps proven
present on this machine (Calculator, Photos) plus the Store-packaged
PowerShell substitute for the third, by locale-invariant package family
rather than display-name matching; it correctly reports Windows Terminal's
genuine absence rather than a false positive; it identified a real
same-display-name duplicate risk ("Claude") and the merge rule that avoids
it; and it costs under 1 second, well within the ~5.3 s icon-extraction
budget PROOF-01/ADR (icon bench) already established as this scan's
dominant cost.
