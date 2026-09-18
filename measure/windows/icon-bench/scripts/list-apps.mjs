// PROOF-01 support script: builds the real app list all three icon-extraction
// candidates benchmark against, so the denominator is identical across candidates.
//
// Source of the app list (stated explicitly, per the task's requirement):
//   Start Menu .lnk enumeration under
//     %ProgramData%\Microsoft\Windows\Start Menu\Programs  (machine-wide)
//     %APPDATA%\Microsoft\Windows\Start Menu\Programs      (per-user)
//   Each .lnk is resolved to its target executable via a single PowerShell
//   process holding one COM WScript.Shell object (matches the method already
//   measured in .maxvision/research/WINDOWS-STACK.md: 149 resolved in 2395 ms).
//   Results are deduped by normalized (uppercased, resolved) target path, and
//   entries whose target file name matches an uninstaller pattern
//   (unins*.exe, uninstall*.exe) are dropped, per the same "unins000.exe" junk
//   finding recorded in the research doc.
//
//   This is a deliberately informal, benchmark-local filter — it exists only
//   so this script's app set reads as "real launchable apps" for a bridge
//   benchmark, not as the production exclusion rule. It is known to miss
//   cases (e.g. "uninst.exe", "IObitUninstaler.exe") that a real rule must
//   catch. PROOF-04 owns the actual, carefully-derived rule — see
//   measure/windows/lib/uninstaller-rule.mjs and
//   docs/adr/PROOF-04-uninstaller-exclusion-rule.md — which is not imported
//   here on purpose: it is a different task's in-flight work, and PROOF-01's
//   conclusion does not depend on its exact behavior (a handful of leftover
//   uninstaller binaries in the icon-extraction app set does not change
//   which bridge wins, since all three candidates see the same list either
//   way).
//
// Output: measure/windows/icon-bench/data/apps.json

import { spawnSync } from "node:child_process";
import { readdirSync, statSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "data");
const outFile = path.join(outDir, "apps.json");

function walkLnk(root) {
  const found = [];
  if (!existsSync(root)) return found;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && full.toLowerCase().endsWith(".lnk")) {
        found.push(full);
      }
    }
  }
  return found;
}

const machineRoot = path.join(
  process.env.ProgramData || "C:\\ProgramData",
  "Microsoft", "Windows", "Start Menu", "Programs"
);
const userRoot = path.join(
  process.env.APPDATA || "C:\\Users\\Default\\AppData\\Roaming",
  "Microsoft", "Windows", "Start Menu", "Programs"
);

const t0 = performance.now();
const lnkFiles = [...walkLnk(machineRoot), ...walkLnk(userRoot)];
const enumMs = performance.now() - t0;

console.log(`[list-apps] enumerated ${lnkFiles.length} .lnk files in ${enumMs.toFixed(1)} ms`);
console.log(`[list-apps] roots: ${machineRoot} ; ${userRoot}`);

if (lnkFiles.length === 0) {
  console.error("[list-apps] no .lnk files found — cannot build app list");
  process.exit(1);
}

// Resolve all .lnk -> TargetPath in a single PowerShell process (one COM
// WScript.Shell instance reused across the loop), matching the method
// WINDOWS-STACK.md measured. Paths are passed via a temp JSON file, not argv,
// so spaces and special characters in paths never touch shell quoting.
const tmpDir = path.join(__dirname, "..", ".tmp");
mkdirSync(tmpDir, { recursive: true });
const inputFile = path.join(tmpDir, "lnk-input.json");
const resultFile = path.join(tmpDir, "lnk-resolved.json");
writeFileSync(inputFile, JSON.stringify(lnkFiles), "utf8");

// Round-2 review fix (finding 6): the previous version set
// $ErrorActionPreference = 'SilentlyContinue' for the WHOLE script, which
// makes even TERMINATING errors inside the per-item try/catch below
// non-terminating — they get swallowed instead of hitting the catch block,
// so a resolution failure produced neither a target nor a recorded reason.
// Fixed: 'Stop' so the per-item try/catch (already present) actually fires,
// and $resolveError distinguishes "threw" from "resolved to an empty
// TargetPath" (the latter does NOT throw — WScript.Shell returns "" for a
// .lnk that points at a URL or a virtual shell folder, e.g. "This PC",
// rather than a file path; confirmed by making the failure mode explicit
// below instead of silently treating an empty string the same as a real
// path).
//
// Also renamed $input -> $lnkList: $input is a PowerShell AUTOMATIC
// VARIABLE (the pipeline input enumerator), so assigning it clobbers
// pipeline machinery in a way that "worked" here only by accident.
const psScript = `
$ErrorActionPreference = 'Stop'
$lnkList = Get-Content -Raw -Path '${inputFile.replace(/'/g, "''")}' | ConvertFrom-Json
$wsh = New-Object -ComObject WScript.Shell
$results = @()
foreach ($lnk in $lnkList) {
  $name = [System.IO.Path]::GetFileNameWithoutExtension($lnk)
  try {
    $sc = $wsh.CreateShortcut($lnk)
    $target = $sc.TargetPath
    if ([string]::IsNullOrEmpty($target)) {
      $results += [PSCustomObject]@{ lnk = $lnk; target = $null; name = $name; resolveError = 'TargetPath resolved to empty string (shortcut targets a URL, a virtual shell folder, or is broken)' }
    } else {
      $results += [PSCustomObject]@{ lnk = $lnk; target = $target; name = $name; resolveError = $null }
    }
  } catch {
    $results += [PSCustomObject]@{ lnk = $lnk; target = $null; name = $name; resolveError = $_.Exception.Message }
  }
}
$results | ConvertTo-Json -Depth 3 | Out-File -FilePath '${resultFile.replace(/'/g, "''")}' -Encoding utf8
`;

const t1 = performance.now();
const psResult = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psScript], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const resolveMs = performance.now() - t1;

if (psResult.status !== 0) {
  console.error("[list-apps] PowerShell resolution failed");
  console.error(psResult.stderr);
  process.exit(1);
}

console.log(`[list-apps] resolved ${lnkFiles.length} .lnk targets via single PowerShell/WScript.Shell process in ${resolveMs.toFixed(1)} ms (${(resolveMs / lnkFiles.length).toFixed(2)} ms/lnk amortized)`);

let resultText = readFileSync(resultFile, "utf8");
if (resultText.charCodeAt(0) === 0xfeff) resultText = resultText.slice(1); // strip UTF-8 BOM from PowerShell Out-File
const raw = JSON.parse(resultText);
const rows = Array.isArray(raw) ? raw : [raw];

// Finding 6 fix: every .lnk that did not produce a usable target (resolution
// itself failed — WScript.Shell threw, or TargetPath came back empty because
// the shortcut points at a URL / virtual shell folder rather than a file) is
// recorded in unresolvedLnks WITH WHY, instead of the previous version's "8
// vanish with no record of which or why". Kept distinct from
// excludedResolvedTargets: a .lnk whose resolution SUCCEEDED but whose target
// was then filtered out downstream (uninstaller pattern, dedup, missing
// on-disk file) is not "unresolved" — it resolved fine; the harness chose
// not to benchmark it, for a stated reason.
const unresolvedLnks = [];
const excludedResolvedTargets = [];

const UNINSTALLER_RE = /^unins\d*\.exe$|^uninstall/i;
const seen = new Set();
const resolvedApps = []; // every resolved target, BEFORE the .exe-only filter (finding 7)
for (const row of rows) {
  if (!row.target) {
    unresolvedLnks.push({ lnk: row.lnk, name: row.name, reason: row.resolveError || "no target and no resolveError reported" });
    continue;
  }
  const target = String(row.target).trim();
  if (!target) {
    unresolvedLnks.push({ lnk: row.lnk, name: row.name, reason: "TargetPath resolved to empty string (shortcut targets a URL, a virtual shell folder, or is broken)" });
    continue;
  }
  const base = path.basename(target);
  if (UNINSTALLER_RE.test(base)) {
    excludedResolvedTargets.push({ lnk: row.lnk, name: row.name, targetPath: target, reason: `matches uninstaller pattern (${base})` });
    continue;
  }
  if (!existsSync(target)) {
    excludedResolvedTargets.push({ lnk: row.lnk, name: row.name, targetPath: target, reason: "target does not exist on disk" });
    continue;
  }
  let st;
  try {
    st = statSync(target);
  } catch (err) {
    excludedResolvedTargets.push({ lnk: row.lnk, name: row.name, targetPath: target, reason: `statSync failed: ${err.message}` });
    continue;
  }
  if (!st.isFile()) {
    excludedResolvedTargets.push({ lnk: row.lnk, name: row.name, targetPath: target, reason: "target exists but is not a file (directory)" });
    continue;
  }
  const norm = path.resolve(target).toUpperCase();
  if (seen.has(norm)) {
    excludedResolvedTargets.push({ lnk: row.lnk, name: row.name, targetPath: target, reason: `duplicate target (already added via another .lnk)` });
    continue;
  }
  seen.add(norm);
  resolvedApps.push({ name: row.name, lnk: row.lnk, targetPath: path.resolve(target) });
}

resolvedApps.sort((a, b) => a.name.localeCompare(b.name));

// Finding 7 fix: the ADR previously described the benchmarked set as
// "resolved to the .exe target", which was false for 25/136 entries
// (.msc/.url/.html/.htm/.txt/.chm/.pdf route through thumbnail providers,
// not the app-icon path PLAT-03 uses). Record the FULL composition here
// (auditable, nothing hidden), then filter the BENCHMARKED set to .exe only
// so it actually matches what PLAT-03 calls IShellItemImageFactory for.
const extensionHistogram = {};
for (const a of resolvedApps) {
  const ext = path.extname(a.targetPath).toLowerCase().replace(/^\./, "") || "(none)";
  extensionHistogram[ext] = (extensionHistogram[ext] || 0) + 1;
}
const apps = resolvedApps.filter((a) => path.extname(a.targetPath).toLowerCase() === ".exe");
const excludedNonExe = resolvedApps
  .filter((a) => path.extname(a.targetPath).toLowerCase() !== ".exe")
  .map((a) => ({ name: a.name, targetPath: a.targetPath, extension: path.extname(a.targetPath).toLowerCase() }));

const hasSpace = apps.some((a) => a.targetPath.includes(" "));
if (!hasSpace) {
  console.error("[list-apps] FATAL: no benchmarked path contains a space — Windows path-handling rule (rule 5) requires at least one. Refusing to write app list.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(
  outFile,
  JSON.stringify(
    {
      source: "Start Menu .lnk enumeration (machine + user roots), resolved via single PowerShell/WScript.Shell process, deduped by normalized target path, uninstaller executables excluded, THEN filtered to .exe-only targets (see extensionHistogramAllResolved / excludedNonExeTargets for the full resolved composition before that filter)",
      machineRoot,
      userRoot,
      lnkCount: lnkFiles.length,
      enumMs: Number(enumMs.toFixed(1)),
      resolveMs: Number(resolveMs.toFixed(1)),
      resolvedCount: rows.filter((r) => r.target).length,
      unresolvedCount: unresolvedLnks.length,
      unresolvedLnks,
      excludedResolvedCount: excludedResolvedTargets.length,
      excludedResolvedTargets,
      resolvedAllExtensionsCount: resolvedApps.length,
      extensionHistogramAllResolved: extensionHistogram,
      excludedNonExeTargets: excludedNonExe,
      dedupedAppCount: apps.length,
      hasSpaceInPath: hasSpace,
      generatedAt: new Date().toISOString(),
      apps,
    },
    null,
    2
  ),
  "utf8"
);

console.log(`[list-apps] resolved ${resolvedApps.length} apps total (all extensions); extension histogram: ${JSON.stringify(extensionHistogram)}`);
console.log(`[list-apps] unresolved .lnk count (resolution itself failed/empty): ${unresolvedLnks.length} (recorded with reasons in apps.json.unresolvedLnks)`);
console.log(`[list-apps] resolved-but-excluded count (uninstaller/dedup/missing file): ${excludedResolvedTargets.length} (recorded with reasons in apps.json.excludedResolvedTargets)`);
console.log(`[list-apps] wrote ${apps.length} .exe-only deduped apps to ${outFile} (${excludedNonExe.length} non-.exe targets excluded from the benchmarked set, recorded in apps.json.excludedNonExeTargets)`);
console.log(`[list-apps] at least one path contains a space: ${hasSpace}`);
