// Shared .lnk -> TargetPath resolver, extracted from scripts/list-apps.mjs
// (round-3 review, finding 2) so the encoding-correct implementation exists
// in exactly ONE place — list-apps.mjs and scripts/verify-lnk-encoding.mjs
// (the non-ASCII regression case) both call this, instead of each carrying
// its own copy that can drift out of sync and re-introduce the same bug.
//
// Resolves every given .lnk path to its WScript.Shell TargetPath, in a
// single PowerShell process reusing one COM WScript.Shell object (matches
// the method measured in .maxvision/research/WINDOWS-STACK.md: 149 resolved
// in 2395 ms). Paths are passed via a temp JSON file, not argv, so spaces
// and special characters in paths never touch shell quoting.
//
// CRITICAL: the input JSON is written by Node as UTF-8 with NO BOM, and
// Windows PowerShell 5.1's `Get-Content -Raw` decodes with the ANSI system
// codepage by default, NOT UTF-8 — reading it without `-Encoding UTF8`
// mangles any non-ASCII byte in a .lnk path before WScript.Shell ever opens
// it, so the path it tries to open does not exist on disk and TargetPath
// comes back empty. This was round-3 finding 2 (BLOCKER): it silently
// dropped every non-ASCII .lnk on a non-en-US locale. `-Encoding UTF8`
// below is the fix; scripts/verify-lnk-encoding.mjs is the regression case.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

function buildPsScript(inputFile, outputFile) {
  return `
$ErrorActionPreference = 'Stop'
$lnkList = Get-Content -Raw -Encoding UTF8 -Path '${inputFile.replace(/'/g, "''")}' | ConvertFrom-Json
$wsh = New-Object -ComObject WScript.Shell
$results = @()
foreach ($lnk in $lnkList) {
  $name = [System.IO.Path]::GetFileNameWithoutExtension($lnk)
  try {
    $sc = $wsh.CreateShortcut($lnk)
    $target = $sc.TargetPath
    if ([string]::IsNullOrEmpty($target)) {
      $results += [PSCustomObject]@{ lnk = $lnk; target = $null; name = $name; resolveError = 'WScript.Shell CreateShortcut(...).TargetPath returned an empty string for this .lnk' }
    } else {
      $results += [PSCustomObject]@{ lnk = $lnk; target = $target; name = $name; resolveError = $null }
    }
  } catch {
    $results += [PSCustomObject]@{ lnk = $lnk; target = $null; name = $name; resolveError = $_.Exception.Message }
  }
}
$results | ConvertTo-Json -Depth 3 | Out-File -FilePath '${outputFile.replace(/'/g, "''")}' -Encoding utf8
`;
}

/**
 * Resolves an array of .lnk file paths to their WScript.Shell TargetPath,
 * in one shared PowerShell/COM process.
 *
 * @param {string[]} lnkPaths
 * @param {{tmpDir: string}} opts - scratch directory for the input/output JSON hop
 * @returns {{rows: Array<{lnk: string, name: string, target: string|null, resolveError: string|null}>, resolveMs: number}}
 */
export function resolveLnkTargets(lnkPaths, { tmpDir }) {
  mkdirSync(tmpDir, { recursive: true });
  const inputFile = path.join(tmpDir, "lnk-input.json");
  const resultFile = path.join(tmpDir, "lnk-resolved.json");
  writeFileSync(inputFile, JSON.stringify(lnkPaths), "utf8");

  const psScript = buildPsScript(inputFile, resultFile);
  const t0 = performance.now();
  const psResult = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psScript], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const resolveMs = performance.now() - t0;

  if (psResult.status !== 0) {
    throw new Error(`lnk resolution PowerShell process failed (exit ${psResult.status}): ${psResult.stderr}`);
  }

  let resultText = readFileSync(resultFile, "utf8");
  if (resultText.charCodeAt(0) === 0xfeff) resultText = resultText.slice(1); // strip UTF-8 BOM from PowerShell Out-File
  const raw = JSON.parse(resultText);
  const rows = Array.isArray(raw) ? raw : [raw];
  return { rows, resolveMs };
}
