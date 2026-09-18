#!/usr/bin/env node
// PROOF-04 probe — the real Start Menu scan on this machine, with the
// uninstaller-exclusion rule applied, before/after counts printed so the
// count difference (and every excluded entry) is visible.
//
// Method matches the one already measured in
// .maxvision/research/WINDOWS-STACK.md §6.1 (Apêndice A): walk
// %ProgramData%\...\Start Menu\Programs and %APPDATA%\...\Start Menu\Programs
// for *.lnk, resolve each via COM WScript.Shell, dedupe by normalized target
// path. This script adds the exclusion-rule step (`partitionUninstallers`)
// on top of that already-measured pipeline; it does not re-measure the
// enumeration/resolution timings.
//
// Usage: node measure/windows/scan-apps.mjs
// Requires Windows (uses PowerShell + WScript.Shell COM). Writes its
// generated PowerShell helper to a temp file and cleans it up.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { partitionUninstallers } from "./lib/uninstaller-rule.mjs";

if (process.platform !== "win32") {
  console.error("scan-apps.mjs requires Windows (win32). Current platform:", process.platform);
  process.exit(1);
}

// PowerShell 5.1 is targeted (Windows PowerShell), matching the icon
// measurement in the same research doc, for consistency across probes.
const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$dirs = @(
  (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs'),
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs')
)
$shell = New-Object -ComObject WScript.Shell
$results = New-Object System.Collections.Generic.List[object]
foreach ($dir in $dirs) {
  if (Test-Path -LiteralPath $dir) {
    Get-ChildItem -LiteralPath $dir -Filter *.lnk -Recurse -File | ForEach-Object {
      $lnkPath = $_.FullName
      $target = $null
      $arguments = $null
      try {
        $sc = $shell.CreateShortcut($lnkPath)
        $target = $sc.TargetPath
        $arguments = $sc.Arguments
      } catch {}
      $results.Add([PSCustomObject]@{
        name = $_.BaseName
        lnk = $lnkPath
        target = $target
        arguments = $arguments
      })
    }
  }
}
$results | ConvertTo-Json -Depth 3 -Compress
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

let parsed = JSON.parse(raw);
if (!Array.isArray(parsed)) parsed = [parsed]; // ConvertTo-Json collapses a 1-item array

const totalLnk = parsed.length;
const resolved = parsed.filter((e) => typeof e.target === "string" && e.target !== "");
const unresolved = totalLnk - resolved.length;

// Dedupe by normalized target path (case-insensitive on Windows; NTFS is
// case-preserving but not case-sensitive by default).
const byTarget = new Map();
for (const entry of resolved) {
  const key = entry.target.toLowerCase();
  if (!byTarget.has(key)) byTarget.set(key, entry);
}
const deduped = [...byTarget.values()];

const { kept, excluded } = partitionUninstallers(deduped);

// Diagnostic, independent of the exclusion rule's own msiexec handling:
// every shortcut that resolves to msiexec.exe at all, uninstaller or not,
// shown with its arguments so the /x-vs-/i distinction the rule relies on
// is visible and auditable here, not just inside the rule.
const msiexecHits = deduped.filter((e) => /(^|\\)msiexec\.exe$/i.test(e.target));

console.log("=== PROOF-04 — real scan on this machine ===");
console.log(`.lnk found (Start Menu, machine + user):    ${totalLnk}`);
console.log(`resolved to a target path:                  ${resolved.length} (${unresolved} unresolved)`);
console.log(`unique after dedupe by target path:          ${deduped.length}  [BEFORE exclusion rule]`);
console.log(`unique after uninstaller-exclusion rule:     ${kept.length}  [AFTER exclusion rule]`);
console.log(`entries removed by the exclusion rule:       ${excluded.length}`);
console.log("");
console.log("--- entries removed (name -> target) ---");
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
const leftover = kept.filter((e) => /(^|\\)unins[^\\]*\.exe$/i.test(e.target));
console.log(leftover.length === 0 ? "PASS — none" : `FAIL — ${leftover.length} left: ${JSON.stringify(leftover)}`);
