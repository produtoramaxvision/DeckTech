#!/usr/bin/env node
/**
 * PROOF-02 — UWP/Store app enumerator (measurement script, not production code).
 *
 * The existing .lnk scan (measured: 182 .lnk in 8 ms, 149 resolved via COM in
 * 2395 ms, 122 apps after dedupe-by-target-path) never sees a UWP/Store app,
 * because packaged apps have no Start-menu .lnk at all — they are reachable
 * only through the virtual shell:AppsFolder namespace, addressed by
 * AppUserModelID (AUMID), not by a filesystem path.
 *
 * Mechanism chosen: `Get-StartApps` (same shell index Win+S search reads),
 * cross-verified row by row against `Get-AppxPackage` (the authoritative
 * registry of installed MSIX/UWP packages) so a row is only ever classified
 * "packaged" when Windows itself confirms the package is installed — never by
 * guessing from the AppID string shape.
 *
 * Usage:
 *   node measure/windows/proof-02/uwp-enum.mjs [--out <dir>]
 *
 * Writes measure/windows/proof-02/<out>/uwp-scan-result.json (raw + derived
 * data, for audit) and prints a human report to stdout.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- CLI -------------------------------------------------------------------

function parseArgs(argv) {
  const out = { outDir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) {
      out.outDir = argv[i + 1];
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
// Default artifact location lives under this script's own directory, joined
// with path.join (never a hardcoded separator) so it resolves correctly
// regardless of drive letter or install path — including one containing a
// space, which --out exists specifically to exercise.
const outDir = args.outDir ? path.resolve(args.outDir) : path.join(__dirname, 'out');
mkdirSync(outDir, { recursive: true });

// --- Step 1: prove the .lnk scan really does not see these apps -----------

function walkLnkFiles(rootDir) {
  const results = [];
  let stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // directory may not exist (e.g. no per-user Start Menu yet)
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && full.toLowerCase().endsWith('.lnk')) {
        results.push(full);
      }
    }
  }
  return results;
}

const lnkRoots = [
  process.env.PROGRAMDATA
    ? path.join(process.env.PROGRAMDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    : null,
  process.env.APPDATA
    ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    : null,
].filter(Boolean);

const lnkScanStart = process.hrtime.bigint();
const lnkFiles = lnkRoots.flatMap(walkLnkFiles);
const lnkScanMs = Number(process.hrtime.bigint() - lnkScanStart) / 1e6;
const lnkBaseNames = new Set(
  lnkFiles.map((f) => path.basename(f, path.extname(f)).toLowerCase())
);

// --- Step 2: collect Get-StartApps + Get-AppxPackage in one PS process ----

const psScript = path.join(__dirname, 'collect-startapps.ps1');
const rawOutFile = path.join(outDir, 'raw-startapps.json');

const psStart = process.hrtime.bigint();
execFileSync(
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psScript, '-OutFile', rawOutFile],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);
const psMs = Number(process.hrtime.bigint() - psStart) / 1e6;

const raw = JSON.parse(readFileSync(rawOutFile, 'utf8'));
const startApps = raw.startApps ?? [];
const appxPackages = raw.appxPackages ?? [];
const appxFamilies = new Set(appxPackages.map((p) => p.PackageFamilyName));

// --- Step 3: classify every Start-menu-index row ---------------------------
//
// A row is "packaged" (UWP/Store) only when its AppID has the
// PackageFamilyName!ApplicationId shape AND that exact family is present in
// the live Get-AppxPackage registry. Everything else (GUID AUMIDs,
// filesystem-path AUMIDs, protocol-launcher AUMIDs, ";"-separated AUMIDs
// like Firefox's private-browsing entry) is left classified as non-packaged
// — those are apps the existing/forthcoming .lnk-based scan already
// discovers by target path, just keyed differently here.

function classify(appId) {
  const bang = appId.indexOf('!');
  if (bang === -1) return { packaged: false, family: null, appIdPart: null };
  const family = appId.slice(0, bang);
  const appIdPart = appId.slice(bang + 1);
  if (appxFamilies.has(family)) {
    return { packaged: true, family, appIdPart };
  }
  return { packaged: false, family: null, appIdPart: null };
}

const classified = startApps.map((row) => ({
  name: row.Name,
  aumid: row.AppID,
  ...classify(row.AppID),
  lnkNameCollision: lnkBaseNames.has(String(row.Name).toLowerCase()),
}));

const packagedApps = classified.filter((r) => r.packaged);
const unpackagedApps = classified.filter((r) => !r.packaged);

// --- Step 4: locate the 3 proof-of-concept apps -----------------------------
//
// Identity is the AUMID's PackageFamilyName, which is locale-invariant. The
// display name (Name) is whatever the shell resolved from the package
// manifest's ms-resource: string for the current UI culture — for this
// machine, pt-BR. We select rows by family, never by matching an English
// name, precisely because a name-only match is the broken behavior this
// requirement calls out.
//
// Windows Terminal (Microsoft.WindowsTerminal_8wekyb3d8bbwe) is NOT
// installed on this machine — verified empirically (see ADR, and the
// "terminalInstalled" field below, which will be false). Substituted with
// the Microsoft Store-packaged PowerShell (Microsoft.PowerShell), confirmed
// installed via Get-AppxPackage, and — like Calculator and Photos — absent
// from the .lnk scan.

const PROOF_FAMILIES = [
  { label: 'Calculadora (Calculator)', family: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe' },
  { label: 'Fotos (Photos)', family: 'Microsoft.Windows.Photos_8wekyb3d8bbwe' },
  { label: 'PowerShell (Store) — substitute for Terminal, see note below', family: 'Microsoft.PowerShell_8wekyb3d8bbwe' },
];

const terminalInstalled = appxFamilies.has('Microsoft.WindowsTerminal_8wekyb3d8bbwe');

const proofResults = PROOF_FAMILIES.map(({ label, family }) => {
  const row = packagedApps.find((r) => r.family === family);
  return {
    label,
    family,
    found: Boolean(row),
    name: row?.name ?? null,
    aumid: row?.aumid ?? null,
    activationPath: row ? `shell:AppsFolder\\${row.aumid}` : null,
    absentFromLnkScan: row ? !row.lnkNameCollision : null,
  };
});

// --- Step 5: prove one activation path actually launches the app ----------
// (rule 1: don't claim a result not observed — launch it, watch the process
// appear, close it.)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function launchAndObserve(aumid, processNameHint, timeoutMs = 8000) {
  const shellPath = `shell:AppsFolder\\${aumid}`;
  try {
    // explorer.exe routinely exits non-zero for shell: URIs even when the
    // launch succeeds (it hands the URI to the shell and returns immediately
    // without waiting to see whether the target process spawned) — the
    // outcome is judged by the tasklist poll below, not by this exit code.
    execFileSync('explorer.exe', [shellPath], { stdio: 'ignore' });
  } catch {
    /* expected — see comment above */
  }
  const deadline = Date.now() + timeoutMs;
  let seenPid = null;
  while (Date.now() < deadline && !seenPid) {
    let out;
    try {
      out = execFileSync('tasklist.exe', ['/FI', `IMAGENAME eq ${processNameHint}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
      });
    } catch {
      out = '';
    }
    if (out && out.toLowerCase().includes(processNameHint.toLowerCase())) {
      seenPid = out.trim();
    } else {
      await sleep(300);
    }
  }
  if (seenPid) {
    try {
      execFileSync('taskkill.exe', ['/IM', processNameHint, '/F'], { stdio: 'ignore' });
    } catch {
      /* best-effort cleanup */
    }
  }
  return Boolean(seenPid);
}

const calcRow = proofResults.find((r) => r.family === 'Microsoft.WindowsCalculator_8wekyb3d8bbwe');
let activationObserved = false;
let activationError = null;
if (calcRow?.found) {
  try {
    activationObserved = await launchAndObserve(calcRow.aumid, 'CalculatorApp.exe');
  } catch (err) {
    activationError = String(err?.message ?? err);
  }
}

// --- Step 6: merge-without-duplicates statement, backed by real data -------
//
// The concrete duplicate risk found on THIS machine's real data: "Claude"
// appears twice in Get-StartApps —
//   1) AUMID "Claude_pzs8sxrjxfjjc!Claude"           -> confirmed packaged
//      (Get-AppxPackage has family "Claude_pzs8sxrjxfjjc")
//   2) AUMID "1bbf47ca-ae3c-4c7c-accd-4ac80b81cc1f"   -> NOT packaged (no "!"
//      -> classify() short-circuits to unpackaged; also confirmed absent
//      from Get-AppxPackage) — this is the win32 Claude desktop app's
//      electron-builder-assigned toast AUMID, and it DOES have a matching
//      .lnk in the Start Menu ("Claude.lnk").
// These are two genuinely different installed products that happen to
// share a display name — not one app double-counted. A name-based collapse
// would have wrongly merged them; a target-path/AUMID-based merge does not.
const claudeRows = classified.filter((r) => r.name === 'Claude');

// --- write full artifact for audit --------------------------------------

const resultPayload = {
  generatedAtUtc: new Date().toISOString(),
  outDir,
  timings: {
    lnkWalkMs: Number(lnkScanMs.toFixed(2)),
    lnkFilesFound: lnkFiles.length,
    powershellCollectMs: Number(psMs.toFixed(2)),
    totalMs: Number((lnkScanMs + psMs).toFixed(2)),
  },
  counts: {
    startAppsIndexRows: startApps.length,
    packagedApps: packagedApps.length,
    unpackagedRowsFromIndex: unpackagedApps.length,
    appxPackagesInstalled: appxPackages.length,
  },
  proofTargets: proofResults,
  terminalInstalled,
  activationProof: {
    app: 'Calculadora',
    aumid: calcRow?.aumid ?? null,
    launchedViaExplorerShellAppsFolder: Boolean(calcRow?.found),
    processObserved: activationObserved,
    error: activationError,
  },
  duplicateCaseEvidence: {
    name: 'Claude',
    rows: claudeRows,
  },
  packagedApps,
};

writeFileSync(path.join(outDir, 'uwp-scan-result.json'), JSON.stringify(resultPayload, null, 2), 'utf8');

// --- Step 7: report ---------------------------------------------------------

console.log('=== PROOF-02: UWP/Store app enumerator ===');
console.log(`.lnk scan (existing mechanism): ${lnkFiles.length} .lnk files in ${lnkScanMs.toFixed(1)} ms`);
console.log(
  `Get-StartApps + Get-AppxPackage collect: ${psMs.toFixed(1)} ms -> ${startApps.length} index rows, ` +
    `${appxPackages.length} installed AppX packages`
);
console.log(
  `Classification: ${packagedApps.length} rows confirmed packaged (UWP/Store), ` +
    `${unpackagedApps.length} rows non-packaged (left to the .lnk-based scan)`
);
console.log('');
console.log('Proof targets (found by package family, not by name — locale is pt-BR on this machine):');
for (const r of proofResults) {
  console.log(`  - ${r.label}`);
  if (!r.found) {
    console.log(`      NOT FOUND as a packaged app on this machine.`);
    if (r.family === 'Microsoft.WindowsTerminal_8wekyb3d8bbwe') {
      console.log(`      (Windows Terminal is genuinely not installed here — see note below.)`);
    }
    continue;
  }
  console.log(`      display name (localized): ${r.name}`);
  console.log(`      AUMID (activation path):  ${r.aumid}`);
  console.log(`      activation command:       explorer.exe ${r.activationPath}`);
  console.log(`      absent from .lnk scan:    ${r.absentFromLnkScan}`);
}
console.log('');
console.log(`Windows Terminal (Microsoft.WindowsTerminal_8wekyb3d8bbwe) installed on this machine: ${terminalInstalled}`);
console.log('  -> Substituted with the Store-packaged PowerShell app in the 3rd proof slot (see report/ADR).');
console.log('');
console.log('Activation proof (Calculadora launched, not just printed):');
console.log(`  launched via explorer.exe shell:AppsFolder\\...: ${Boolean(calcRow?.found)}`);
console.log(`  CalculatorApp.exe process observed after launch: ${activationObserved}`);
if (activationError) console.log(`  error: ${activationError}`);
console.log('');
console.log('Merge-without-duplicates evidence (real duplicate risk found on this machine — "Claude"):');
for (const row of claudeRows) {
  console.log(`  - aumid=${row.aumid} packaged=${row.packaged} lnkNameCollision=${row.lnkNameCollision}`);
}
console.log('');
console.log(`Total scan count: ${startApps.length} Start-menu index rows scanned`);
console.log(`  of which ${packagedApps.length} are confirmed UWP/Store apps (packaged)`);
console.log(`  of which ${unpackagedApps.length} are non-packaged (left for the .lnk-based scan to discover by target path)`);
console.log(`Elapsed time: ${(lnkScanMs + psMs).toFixed(1)} ms total (.lnk walk ${lnkScanMs.toFixed(1)} ms + PowerShell collect ${psMs.toFixed(1)} ms)`);
console.log('');
console.log(`Full artifact written to: ${path.join(outDir, 'uwp-scan-result.json')}`);
