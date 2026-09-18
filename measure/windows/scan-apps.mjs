#!/usr/bin/env node
// PROOF-04 probe — the real Start Menu scan on this machine, with the
// uninstaller-exclusion rule applied, before/after counts printed so the
// count difference (and every excluded entry) is visible.
//
// Method DIFFERS from the one measured in .maxvision/research/WINDOWS-STACK.md
// §6.1: that section walked %ProgramData%\...\Start Menu\Programs and
// %APPDATA%\...\Start Menu\Programs for *.lnk and resolved each via a
// per-shortcut COM WScript.Shell loop, timed individually (~16 ms/shortcut,
// 2395 ms for 149). This script resolves inside a single batched PowerShell
// process and counts every entry whose resolved target is a non-empty
// string — not "resolved to an .exe" the way §6.1's 149 figure implicitly
// was. Round-2 finding 2 of this ADR's review measured the resulting gap
// directly (see docs/adr/PROOF-04-uninstaller-exclusion-rule.md §6); this
// script now also prints "resolved & .exe" and "dedupe (.exe-only)" columns
// so that reconciliation is visible in the probe's own output, not only in
// the ADR prose.
//
// Round-2 finding 3: every shortcut-resolution failure is now recorded with
// its exception message (not silently discarded), a legitimately-empty
// target is reported separately from a thrown exception, and a directory
// PowerShell could not enumerate is counted and surfaced rather than
// silently shrinking the totals.
//
// Round-2 finding 4: Start Menu\Programs directories are resolved via
// [Environment]::GetFolderPath('CommonPrograms'/'Programs') — the CSIDL_
// COMMON_PROGRAMS / CSIDL_PROGRAMS shell folders, which honor Group Policy
// Start Menu redirection — instead of a hardcoded Join-Path. Checked, not
// assumed: 'CommonStartMenu'/'StartMenu' were tried first and are the WRONG
// enum values (they resolve to the Start Menu ROOT, one level above
// \Programs, and over-count by the shortcuts that live directly in that
// root); 'CommonPrograms'/'Programs' were verified against this machine to
// resolve to the exact same paths the previous hardcoded Join-Path used
// (123/59 .lnk, matching exactly) before being adopted here. Every basename
// check on this file also uses node:path's basename() instead of a
// hand-rolled backslash regex — matching the standard the rule module
// itself holds (measure/windows/lib/uninstaller-rule.mjs:19,90).
//
// Usage: node measure/windows/scan-apps.mjs
// Requires Windows (uses PowerShell + WScript.Shell COM). Writes its
// generated PowerShell helper to a temp file and cleans it up.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, extname } from "node:path";
import { partitionUninstallers } from "./lib/uninstaller-rule.mjs";

if (process.platform !== "win32") {
  console.error("scan-apps.mjs requires Windows (win32). Current platform:", process.platform);
  process.exit(1);
}

// PowerShell 5.1 is targeted (Windows PowerShell), matching the icon
// measurement in the same research doc, for consistency across probes.
//
// No blanket `$ErrorActionPreference = 'SilentlyContinue'`: enumeration
// failures are captured per-call via -ErrorVariable (accumulated with the
// `+` prefix) instead of being discarded process-wide, and a shortcut whose
// COM resolution throws has its exception message recorded on the entry
// instead of an empty `catch {}`.
const PS_SCRIPT = `
$dirs = @(
  [Environment]::GetFolderPath('CommonPrograms'),
  [Environment]::GetFolderPath('Programs')
)
$shell = New-Object -ComObject WScript.Shell
$results = New-Object System.Collections.Generic.List[object]
$dirErrors = @()
foreach ($dir in $dirs) {
  if (Test-Path -LiteralPath $dir) {
    Get-ChildItem -LiteralPath $dir -Filter *.lnk -Recurse -File -ErrorAction SilentlyContinue -ErrorVariable +dirErrors | ForEach-Object {
      $lnkPath = $_.FullName
      $target = $null
      $arguments = $null
      $resolveError = $null
      try {
        $sc = $shell.CreateShortcut($lnkPath)
        $target = $sc.TargetPath
        $arguments = $sc.Arguments
      } catch {
        $resolveError = $_.Exception.Message
      }
      $results.Add([PSCustomObject]@{
        name = $_.BaseName
        lnk = $lnkPath
        target = $target
        arguments = $arguments
        resolveError = $resolveError
      })
    }
  }
}
[PSCustomObject]@{
  dirErrorCount = $dirErrors.Count
  entries = $results
} | ConvertTo-Json -Depth 4 -Compress
`;

const workDir = mkdtempSync(join(tmpdir(), "decktech-proof04-"));
const scriptPath = join(workDir, "scan.ps1");
writeFileSync(scriptPath, PS_SCRIPT, "utf8");

let raw;
try {
  raw = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const payload = JSON.parse(raw);
const dirErrorCount = payload.dirErrorCount ?? 0;
let entries = payload.entries ?? [];
if (!Array.isArray(entries)) entries = [entries]; // ConvertTo-Json collapses a 1-item array

const totalLnk = entries.length;
const resolved = entries.filter((e) => typeof e.target === "string" && e.target !== "");
const unresolvedEntries = entries.filter((e) => !(typeof e.target === "string" && e.target !== ""));

// Same basename() the rule module uses (uninstaller-rule.mjs:19,90) — never
// a hand-rolled backslash split (round-2 finding 4).
const isExeTarget = (target) => extname(basename(target)).toLowerCase() === ".exe";
const resolvedExe = resolved.filter((e) => isExeTarget(e.target));

// Dedupe by normalized target path (case-insensitive on Windows; NTFS is
// case-preserving but not case-sensitive by default).
function dedupeByTarget(list) {
  const byTarget = new Map();
  for (const entry of list) {
    const key = entry.target.toLowerCase();
    if (!byTarget.has(key)) byTarget.set(key, entry);
  }
  return [...byTarget.values()];
}
const deduped = dedupeByTarget(resolved);
const dedupedExeOnly = dedupeByTarget(resolvedExe);

const { kept, excluded } = partitionUninstallers(deduped);

// Diagnostic, independent of the exclusion rule's own msiexec handling:
// every shortcut that resolves to msiexec.exe at all, uninstaller or not,
// shown with its arguments so the /x-vs-/i distinction the rule relies on
// is visible and auditable here, not just inside the rule.
const msiexecHits = deduped.filter((e) => basename(e.target).toLowerCase() === "msiexec.exe");

console.log("=== PROOF-04 — real scan on this machine ===");
console.log(`.lnk found (Start Menu, machine + user):     ${totalLnk}`);
console.log(`Start Menu subdirectories that could not be enumerated: ${dirErrorCount}`);
console.log(`resolved to a non-empty target path:         ${resolved.length} (${unresolvedEntries.length} unresolved)`);
console.log(`  of which, target basename ends in .exe:    ${resolvedExe.length}`);
console.log(`unique after dedupe by target path:          ${deduped.length}  [BEFORE exclusion rule, all resolved targets]`);
console.log(`unique after dedupe, .exe targets only:      ${dedupedExeOnly.length}  [for comparison against WINDOWS-STACK.md §6.1's 149/122, which counted .exe resolutions]`);
console.log(`unique after uninstaller-exclusion rule:     ${kept.length}  [AFTER exclusion rule, applied to the all-targets set above]`);
console.log(`entries removed by the exclusion rule:       ${excluded.length}`);
console.log("");
console.log("--- unresolved shortcuts (name -> reason) ---");
if (unresolvedEntries.length === 0) {
  console.log("(none)");
} else {
  for (const e of unresolvedEntries) {
    const reason = e.resolveError ? `com-threw: ${e.resolveError}` : "target-empty";
    console.log(`  ${e.name}  ->  ${reason}`);
  }
}
console.log("");
console.log("--- entries removed by the exclusion rule (name -> target) ---");
if (excluded.length === 0) {
  console.log("(none)");
} else {
  for (const e of excluded) {
    console.log(`  ${e.name}  ->  ${e.target}`);
  }
}
console.log("");
console.log("--- msiexec.exe targets found on this machine, with the verb that decided their fate ---");
if (msiexecHits.length === 0) {
  console.log("(none found on this machine — no msiexec-based entry exists to worry about)");
} else {
  for (const e of msiexecHits) {
    const verdict = excluded.includes(e) ? "EXCLUDED (uninstall verb)" : "KEPT (not an uninstall verb)";
    console.log(`  ${e.name}  ->  ${e.target}  args="${e.arguments ?? ""}"  [${verdict}]`);
  }
}
console.log("");
console.log("--- sanity check: any AFTER entry whose target basename matches unins*.exe? ---");
// [^.]* would be a real narrowing vs the old (^|\\)unins[^\\]*\.exe$ check —
// it would miss a basename like "unins.v2.exe" (a dot between "unins" and
// ".exe", still within-basename, no backslash) that the old check on the
// full path caught. `.*` on the basename matches the old semantics exactly
// (verified: both match "unins.v2.exe" and "unins000.exe", neither matches
// "notunins.exe").
const leftover = kept.filter((e) => /^unins.*\.exe$/i.test(basename(e.target)));
console.log(leftover.length === 0 ? "PASS — none" : `FAIL — ${leftover.length} left: ${JSON.stringify(leftover)}`);
