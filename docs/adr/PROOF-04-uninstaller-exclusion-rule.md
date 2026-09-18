# PROOF-04 — Exclusion rule for uninstaller entries in the Windows app scan

**Status:** Accepted
**Date:** 2026-09-17
**Machine:** Windows 11 Pro 22631, x64 (this machine)
**Requirement:** `PROOF-04` (`.maxvision/REQUIREMENTS.md`), Phase 0 success criterion 4
(`.maxvision/ROADMAP.md`)

> Evidence convention: every number below is `[MEASURED]` (produced by running
> `node measure/windows/scan-apps.mjs` on this machine, full output in
> §"Real scan — before/after") or `[REASONED]` (a design decision, not a
> measurement). Nothing here is asserted without having been run.

## 1. Problem

The real scan of this machine (`.maxvision/research/WINDOWS-STACK.md` §6.1,
Apêndice A) produced 122 "unique" apps after deduping `.lnk` shortcuts by
resolved target path — but one of them was garbage:

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
- `test/windows-uninstaller-rule.test.mjs` — 12 `node:test` cases.
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

## 6. Real scan — before/after (this machine, 2026-09-17)

Command: `node measure/windows/scan-apps.mjs` (Windows 11 Pro 22631, this
machine). Full verbatim output:

```
=== PROOF-04 — real scan on this machine ===
.lnk found (Start Menu, machine + user):    182
resolved to a target path:                  178 (4 unresolved)
unique after dedupe by target path:          148  [BEFORE exclusion rule]
unique after uninstaller-exclusion rule:     138  [AFTER exclusion rule]
entries removed by the exclusion rule:       10

--- entries removed (name -> target) ---
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

**Not validated: why this run's counts (`148`/`138`) differ from
`WINDOWS-STACK.md`'s (`182`/`122`).** The `.lnk` total matches exactly (182
both times), but this run resolves 178 of them to a target path, against the
149 recorded in `WINDOWS-STACK.md` — 29 more, same machine, same day. That
resolved-count gap, not "more software installed," is almost certainly the
real source of the downstream 148-vs-122 dedupe difference, since the same
182 shortcuts can't gain new resolvable targets on their own. The likely
mechanism is that the two runs resolve shortcuts through different code paths
— `WINDOWS-STACK.md`'s Apéndice A describes a per-shortcut COM resolution
loop, timed individually at ~16 ms each (2395 ms / 149), while
`scan-apps.mjs` resolves inside a single batched PowerShell process and
`ConvertTo-Json`-serializes every entry including any whose `TargetPath`
came back empty — so this run's `try/catch` may retain shortcuts (e.g.
non-`.exe` targets, or ones whose resolution failed differently) that the
earlier script's error handling dropped. **This is reasoning about a
plausible mechanism, not a measurement** — the earlier script was not
preserved in the repo (per its own Apéndice A, its artifacts live in a
session-scoped scratchpad path this session cannot read), so the exact cause
cannot be confirmed by re-running it side by side. What is confirmed: this
run's own pipeline is internally consistent (182 found → 178 resolved → 148
deduped → 138 after exclusion, all printed together, all reproducible by
re-running `scan-apps.mjs`), and the `10` entries this rule removes are
counted within this run's own numbers, independent of how the earlier
document arrived at 122.

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

Ran `node --test test/windows-uninstaller-rule.test.mjs` against the real rule
— `ℹ tests 12`, `ℹ pass 12`, `ℹ fail 0` — then temporarily inserted an early
`return false;` as the first line of `isUninstallerEntry` (rule effectively
deleted; the code after it is unreachable) and re-ran the identical, unmodified
suite:

```
ℹ tests 12
ℹ pass 5
ℹ fail 7
✖ failing tests:
✖ exclui o achado real: Uninstall DJI Assistant 2 -> unins000.exe
✖ exclui variantes numeradas do Inno Setup, incluindo caminho com espaço
✖ exclui outros nomes de binário dedicados a desinstalação
✖ exclui achado real de máquina: shortcut nomeado exatamente 'Uninstall' para plugin OBS (atkAudio)
✖ o match exato de nome 'Uninstall' não vira substring: 'Uninstall Tool' e 'UninstallGuard Pro' continuam protegidos
✖ exclui achado real de máquina: msiexec.exe /x {GUID} (Uninstall Go, Uninstall Node.js)
✖ partitionUninstallers separa a lista real medida: 1 excluído de 4, nomeado
```

7 of 12 tests fail (`AssertionError [ERR_ASSERTION]: false !== true`, or the
count-based assertions in `partitionUninstallers`'s test), covering every
exclusion path the rule implements (basename patterns, the exact-name
exception, the msiexec exception). The 5 that still pass are the "must NOT
exclude" false-positive guards, which hold vacuously once nothing is ever
excluded — exactly the shape rule zero warns about ("a test that passes either
way proves nothing"), which is why this suite pairs every exclusion assertion
with a kept-entry assertion rather than relying on the vacuous ones alone. The
temporary edit was then removed and the suite re-verified green
(`tests 12 / pass 12 / fail 0`) before anything was staged; the neutered
version itself was never committed, so there is no artifact for it beyond the
pasted output above — that output is the evidence, not a pointer to one.

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
