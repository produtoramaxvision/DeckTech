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
 * Default --out is a gitignored scratch directory (NOT the committed out/
 * snapshot). To re-record the committed evidence, pass explicitly:
 *   node measure/windows/proof-02/uwp-enum.mjs --out measure/windows/proof-02/out
 *
 * Writes <out>/uwp-scan-result.json (derived data, for audit — committed for
 * the "out/" case) and <out>/raw-startapps.json (raw Get-StartApps +
 * Get-AppxPackage dump — a personal-machine inventory, gitignored
 * everywhere, never committed; see docs/adr/0002 "known gaps"). Prints a
 * human report to stdout.
 *
 * --- ROUND-2 REVIEW FIXES (see docs/adr/0002-proof-02-uwp-app-enumeration.md) ---
 *
 *   1. (blocker) Activation proof now snapshots the target process's PID set
 *      BEFORE launching, requires a PID that is NOT in that baseline set,
 *      and records that specific PID. If a matching process already exists
 *      at baseline, the proof is skipped (not faked) and the reason is
 *      recorded.
 *   2. (blocker) The second "Claude" AUMID is no longer characterized as a
 *      win32 Claude desktop app. Its .lnk is resolved (this run, via the
 *      pure-Node lnk-parser.mjs PROOF-03 already validated against COM) and
 *      the artifact/ADR state what that resolution actually shows: a
 *      Firefox "taskbar tab" web app.
 *   3. (major) The raw Get-StartApps/Get-AppxPackage dump
 *      (raw-startapps.json) is no longer committed — it is a personal
 *      machine's full software inventory with absolute user paths. Now
 *      gitignored; see .gitignore and docs/adr/0002.
 *   4. (major) "absentFromLnkScan" is no longer derived from a
 *      localized-display-name string match (renamed diagnostic-only field:
 *      lnkDisplayNameCollision). It is now a structural proof: every .lnk's
 *      target is resolved with lnk-parser.mjs and checked against each
 *      packaged app's Get-AppxPackage InstallLocation, plus a raw byte
 *      search of every .lnk file for the package's family name (covers
 *      IDList-only shortcuts the target-path resolution can't decide).
 *   5. (major) PROGRAMDATA/APPDATA missing now throws naming the variable,
 *      instead of silently shrinking the .lnk baseline. walkLnkFiles
 *      rethrows every readdir error except ENOENT. The walk asserts a
 *      non-zero result before any absence claim is made, and lnkRoots +
 *      per-root counts are recorded in the artifact.
 *   6. (major) Cleanup now kills only the PID this run itself attributed to
 *      its own launch (taskkill /PID, graceful first, /F only if the
 *      process survives) — never by image name — and a failed cleanup is
 *      recorded in activationProof instead of being swallowed.
 *   7. (major) The PowerShell collect and the .lnk walk each run 6 times
 *      (iteration 0 discarded as warmup); median/min/max/n are recorded in
 *      the artifact for both.
 *   8. (minor) Default --out no longer points at the committed out/
 *      directory (see Usage above).
 *   9. (minor, ROADMAP-level) See .maxvision/ROADMAP.md Phase 0 success
 *      criterion 2 — amended to name the Terminal substitution explicitly.
 *  10. (minor) A missing --out value or an unrecognized argument now throws
 *      naming the offending token, instead of being silently ignored.
 *  11. (minor) classify() keeps the parsed family/appIdPart on every
 *      AUMID-shaped row, packaged or not; packaged status is a separate
 *      familyInAppxRegistry field.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseLnk } from '../lnk-parser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- CLI ---------------------------------------------------------------

function parseArgs(argv) {
  const out = { outDir: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--out') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error(`--out requires a value (none given) — refusing to fall through to a default. Round-2 minor finding 10.`);
      }
      out.outDir = value;
      i++;
    } else {
      throw new Error(`Unrecognized argument: "${token}". Round-2 minor finding 10.`);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
// Default artifact location is a gitignored scratch dir under this script's
// own directory, joined with path.join (never a hardcoded separator) so it
// resolves correctly regardless of drive letter or install path — including
// one containing a space, which --out exists specifically to exercise.
// Round-2 minor finding 8: this used to default to the committed out/
// directory, so the ADR's own "Reproduce" line silently dirtied the repo on
// every run. Re-recording the committed snapshot is now an explicit act.
const outDir = args.outDir ? path.resolve(args.outDir) : path.join(__dirname, '.scratch');
mkdirSync(outDir, { recursive: true });

// --- PII redaction -------------------------------------------------------
// Round-2 major finding 3: nothing written to the committed artifact may
// embed the OS username. raw-startapps.json itself is no longer committed
// (see .gitignore), but every path recorded into uwp-scan-result.json
// (which IS committed under --out out/) is passed through this first.

function redact(value) {
  if (typeof value !== 'string') return value;
  const home = process.env.USERPROFILE || os.homedir();
  if (!home) return value;
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(escaped, 'gi'), '%USERPROFILE%');
}

// --- Reproducibility metadata --------------------------------------------
// lnk-parser.mjs (imported below) is co-owned by PROOF-03 and may carry
// uncommitted local changes at the time this script runs. Record the repo
// state so a reader of the committed artifact knows exactly what code
// produced it, instead of assuming it matches HEAD.

function gitInfo() {
  try {
    const headCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).trim();
    const dirtyLnkParser = execFileSync('git', ['status', '--porcelain', '--', '../lnk-parser.mjs'], {
      cwd: __dirname,
      encoding: 'utf8',
    }).trim();
    return { headCommit, lnkParserDirty: dirtyLnkParser.length > 0, lnkParserStatusLine: dirtyLnkParser || null };
  } catch (err) {
    return { headCommit: null, lnkParserDirty: null, lnkParserStatusLine: null, error: String(err?.message ?? err) };
  }
}

const repoState = gitInfo();

// --- Step 1: the .lnk baseline the "absent from .lnk scan" claim rests on -

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Required environment variable ${name} is not set on this machine. The .lnk baseline this proof's ` +
        `"absent from .lnk scan" claim depends on cannot be built without it — refusing to silently shrink the ` +
        `baseline to whichever roots happen to resolve. Round-2 major finding 5.`
    );
  }
  return value;
}

function walkLnkFiles(rootDir) {
  const results = [];
  let stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      // Only a genuinely-absent directory is expected/benign here (e.g. no
      // per-user Start Menu yet). EACCES, EMFILE, a broken junction, or any
      // other error class must NOT be indistinguishable from "does not
      // exist" — round-2 major finding 5.
      if (err && err.code === 'ENOENT') continue;
      throw err;
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

const lnkRootDefs = [
  { label: 'PROGRAMDATA', dir: path.join(requireEnv('PROGRAMDATA'), 'Microsoft', 'Windows', 'Start Menu', 'Programs') },
  { label: 'APPDATA', dir: path.join(requireEnv('APPDATA'), 'Microsoft', 'Windows', 'Start Menu', 'Programs') },
];

function runLnkWalk() {
  const t0 = process.hrtime.bigint();
  const perRoot = lnkRootDefs.map(({ label, dir }) => {
    const files = walkLnkFiles(dir);
    return { label, dir, count: files.length, files };
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, perRoot, allFiles: perRoot.flatMap((r) => r.files) };
}

// Round-2 major finding 7: single-sample timings were quoted as THE
// measurement despite ~20% observed run-to-run variance. Iteration 0 is a
// cold warmup, discarded; iterations 1..5 are timed and reduced to
// median/min/max/n.
const WARMUP_ITERATIONS = 1;
const TIMED_ITERATIONS = 5;

function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function stats(samples) {
  return {
    median: Number(median(samples).toFixed(3)),
    min: Number(Math.min(...samples).toFixed(3)),
    max: Number(Math.max(...samples).toFixed(3)),
    n: samples.length,
  };
}

const lnkWalkSamplesMs = [];
let lastLnkWalk = null;
for (let i = 0; i < WARMUP_ITERATIONS + TIMED_ITERATIONS; i++) {
  const result = runLnkWalk();
  lastLnkWalk = result;
  if (i >= WARMUP_ITERATIONS) lnkWalkSamplesMs.push(result.ms);
}

if (lastLnkWalk.allFiles.length === 0) {
  throw new Error(
    'The .lnk baseline walk found 0 shortcuts across both Start Menu roots. Every "absent from .lnk scan" claim ' +
      'this proof makes would be trivially true against an empty baseline — refusing to proceed. Round-2 major finding 5.'
  );
}

const lnkFiles = lastLnkWalk.allFiles;
const lnkBaseNames = new Set(lnkFiles.map((f) => path.basename(f, path.extname(f)).toLowerCase()));
const lnkWalkStats = stats(lnkWalkSamplesMs);
const lnkRootsReport = lastLnkWalk.perRoot.map((r) => ({ label: r.label, dir: redact(r.dir), count: r.count }));

// --- Step 2: collect Get-StartApps + Get-AppxPackage, repeated for timing -

const psScript = path.join(__dirname, 'collect-startapps.ps1');
const rawOutFile = path.join(outDir, 'raw-startapps.json');

const psSamplesMs = [];
let raw = null;
for (let i = 0; i < WARMUP_ITERATIONS + TIMED_ITERATIONS; i++) {
  const t0 = process.hrtime.bigint();
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psScript, '-OutFile', rawOutFile],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (i >= WARMUP_ITERATIONS) psSamplesMs.push(ms);
  raw = JSON.parse(readFileSync(rawOutFile, 'utf8'));
}

const psCollectStats = stats(psSamplesMs);
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
//
// Round-2 minor finding 11: family/appIdPart are kept on EVERY AUMID-shaped
// row, not just packaged ones — a deregistered-but-still-indexed package
// should stay distinguishable from a GUID/path row, not collapse to look
// identical to one. "AUMID-shaped" and "AUMID-shaped AND verified packaged"
// are now two separate facts (aumidShaped, familyInAppxRegistry).

function classify(appId) {
  const id = String(appId);
  const bang = id.indexOf('!');
  if (bang === -1) {
    return { aumidShaped: false, family: null, appIdPart: null, familyInAppxRegistry: false, packaged: false };
  }
  const family = id.slice(0, bang);
  const appIdPart = id.slice(bang + 1);
  const familyInAppxRegistry = appxFamilies.has(family);
  return { aumidShaped: true, family, appIdPart, familyInAppxRegistry, packaged: familyInAppxRegistry };
}

const classified = startApps.map((row) => ({
  name: row.Name,
  aumid: row.AppID,
  ...classify(row.AppID),
  // Diagnostic only — NEVER used to derive absentFromLnkScan (round-2
  // major finding 4). Renamed from lnkNameCollision to make that explicit.
  lnkDisplayNameCollision: lnkBaseNames.has(String(row.Name).toLowerCase()),
}));

const packagedApps = classified.filter((r) => r.packaged);
const unpackagedApps = classified.filter((r) => !r.packaged);

// --- Step 4: resolve every .lnk's target, for the structural absence proof

// Round-2 major finding 4: the previous version decided "absent from the
// .lnk scan" by matching the packaged app's display name against .lnk
// basenames — a THIRD key space that isn't even what PLAT-02's real dedupe
// uses, and it produced a false negative on this machine's own data (the
// Store-packaged "Claude" app was reported non-absent purely because an
// unrelated Firefox web-app .lnk happens to share its four-letter display
// name). Absence is now decided structurally, per packaged app:
//
//   (a) does any .lnk's RESOLVED target path fall inside this package's
//       Get-AppxPackage InstallLocation? lnk-parser.mjs (PROOF-03,
//       independently validated against the COM baseline) resolves
//       candidates[0] for every shortcut it can parse.
//   (b) IDList-only shortcuts (category.idListOnly) resolve to
//       resolvedTargetPath: null — (a) cannot decide those. A raw
//       byte-level search of the .lnk file for the package's
//       PackageFamilyName string (same technique ADR-0003 already used)
//       covers that gap: an IDList referencing a packaged app's shell
//       item would still spell the family name somewhere in its bytes if
//       it referenced one at all.
//
// A packaged app is "absent from the .lnk scan" only when BOTH checks find
// nothing — not inferred from any string match on the display name.

// rawBytesLower is deliberately kept in memory for every one of the 182
// shortcuts (not streamed/discarded per-file) because structuralAbsenceCheck
// below runs the byte search once per PACKAGED app (18 searches) against
// the whole set — re-reading each .lnk from disk per app would be slower
// and this is a one-shot script, not a long-lived process, so the
// retention is a deliberate trade, not a leak.
const lnkParseStart = process.hrtime.bigint();
const lnkResolved = lnkFiles.map((file) => {
  let buf = null;
  let parsed = null;
  let readError = null;
  try {
    buf = readFileSync(file);
    parsed = parseLnk(buf);
  } catch (err) {
    readError = String(err?.message ?? err);
  }
  return {
    file,
    resolvedTargetPath: parsed?.resolvedTargetPath ?? null,
    idListOnly: parsed?.category?.idListOnly ?? false,
    valid: parsed?.valid ?? false,
    readError,
    rawBytesLower: buf ? buf.toString('latin1').toLowerCase() : '',
  };
});
const lnkParseMs = Number(process.hrtime.bigint() - lnkParseStart) / 1e6;
const unresolvedLnkCount = lnkResolved.filter((r) => !r.resolvedTargetPath).length;

const appxInstallLocationByFamily = new Map(
  appxPackages.filter((p) => p.PackageFamilyName && p.InstallLocation).map((p) => [p.PackageFamilyName, p.InstallLocation])
);

function structuralAbsenceCheck(family) {
  const installLocation = appxInstallLocationByFamily.get(family) ?? null;
  const installLocationLower = installLocation ? installLocation.toLowerCase() : null;
  const targetMatches = installLocationLower
    ? lnkResolved.filter((r) => r.resolvedTargetPath && r.resolvedTargetPath.toLowerCase().startsWith(installLocationLower))
    : [];
  const familyLower = family.toLowerCase();
  const byteMatches = lnkResolved.filter((r) => r.rawBytesLower.includes(familyLower));
  return {
    installLocation: redact(installLocation),
    resolvedTargetMatches: targetMatches.map((m) => redact(m.file)),
    byteSearchMatches: byteMatches.map((m) => redact(m.file)),
    absent: targetMatches.length === 0 && byteMatches.length === 0,
  };
}

// --- Step 5: locate the 3 proof-of-concept apps -----------------------------
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
// from the .lnk scan. The ROADMAP Phase 0 success criterion for PROOF-02
// has been amended to name this substitution explicitly (round-2 minor
// finding 9).

const PROOF_FAMILIES = [
  { label: 'Calculadora (Calculator)', family: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe' },
  { label: 'Fotos (Photos)', family: 'Microsoft.Windows.Photos_8wekyb3d8bbwe' },
  { label: 'PowerShell (Store) — substitute for Terminal, see note below', family: 'Microsoft.PowerShell_8wekyb3d8bbwe' },
];

const terminalInstalled = appxFamilies.has('Microsoft.WindowsTerminal_8wekyb3d8bbwe');

const proofResults = PROOF_FAMILIES.map(({ label, family }) => {
  const row = packagedApps.find((r) => r.family === family);
  const structural = row ? structuralAbsenceCheck(family) : null;
  return {
    label,
    family,
    found: Boolean(row),
    name: row?.name ?? null,
    aumid: row?.aumid ?? null,
    activationPath: row ? `shell:AppsFolder\\${row.aumid}` : null,
    lnkDisplayNameCollision: row?.lnkDisplayNameCollision ?? null,
    absentFromLnkScan: structural ? structural.absent : null,
    structuralAbsenceEvidence: structural,
  };
});

// --- Step 6: prove one activation path actually launches the app ----------
// (rule 1: don't claim a result not observed — launch it, watch the process
// appear, close it.)
//
// Round-2 blocker 1 + major 6: the previous version polled tasklist for the
// image name with no pre-launch baseline and no PID identity, so
// processObserved:true could not distinguish "our AUMID launched the app"
// from "this process was already running" — and cleanup killed every
// CalculatorApp.exe on the machine by /IM, including one this script never
// launched. Now: snapshot the baseline PID set first; require a PID that is
// NOT in that set; if the baseline is non-empty, skip the proof rather than
// risk killing a process this run did not start; clean up only the
// attributed PID.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseTasklistCsv(output) {
  const pids = new Set();
  if (!output) return pids;
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('"')) continue; // skips locale-specific "INFO: No tasks..." lines
    const cols = trimmed.split('","').map((c) => c.replace(/^"|"$/g, ''));
    const pid = cols[1];
    if (pid && /^\d+$/.test(pid)) pids.add(pid);
  }
  return pids;
}

function tasklistPids(imageName) {
  let out = '';
  try {
    out = execFileSync('tasklist.exe', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  } catch {
    out = '';
  }
  return parseTasklistCsv(out);
}

async function launchAndObserve(aumid, processNameHint, timeoutMs = 8000) {
  const baselinePids = tasklistPids(processNameHint);
  if (baselinePids.size > 0) {
    return {
      skipped: true,
      skipReason: `${processNameHint} already running at baseline (PID(s): ${[...baselinePids].join(', ')}). Cannot ` +
        `attribute a newly-launched process to this AUMID without risking killing a process this script did not ` +
        `start — skipping the activation proof rather than faking it. Round-2 blocker 1 / major finding 6.`,
      attemptedPid: null,
      extraPidsObserved: [],
      processObserved: false,
      cleanup: null,
    };
  }

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
  const newPids = new Set();
  while (Date.now() < deadline && newPids.size === 0) {
    const current = tasklistPids(processNameHint);
    for (const pid of current) {
      if (!baselinePids.has(pid)) newPids.add(pid);
    }
    if (newPids.size === 0) await sleep(300);
  }

  if (newPids.size === 0) {
    return {
      skipped: false,
      skipReason: null,
      attemptedPid: null,
      extraPidsObserved: [],
      processObserved: false,
      cleanup: null,
    };
  }

  const pidList = [...newPids];
  const attemptedPid = pidList[0];
  const extraPidsObserved = pidList.slice(1);

  // Cleanup: kill ONLY the PID this run attributed to its own launch —
  // never by image name (round-2 major finding 6). Try a graceful
  // taskkill first; escalate to /F only if the process survives. /F is
  // justified here specifically because this is a proof instance this
  // script just launched fresh seconds ago (no unsaved user state to
  // discard), never as a blanket default.
  const cleanup = { attemptedGraceful: false, forced: false, survivedGraceful: null, error: null };
  try {
    execFileSync('taskkill.exe', ['/PID', attemptedPid], { stdio: ['ignore', 'pipe', 'pipe'] });
    cleanup.attemptedGraceful = true;
  } catch (err) {
    cleanup.attemptedGraceful = true;
    cleanup.error = String(err?.stderr ?? err?.message ?? err);
  }
  await sleep(500);
  const survivedGraceful = tasklistPids(processNameHint).has(attemptedPid);
  cleanup.survivedGraceful = survivedGraceful;
  if (survivedGraceful) {
    try {
      execFileSync('taskkill.exe', ['/PID', attemptedPid, '/F'], { stdio: ['ignore', 'pipe', 'pipe'] });
      cleanup.forced = true;
    } catch (err) {
      cleanup.forced = true;
      cleanup.error = String(err?.stderr ?? err?.message ?? err);
    }
  }

  return { skipped: false, skipReason: null, attemptedPid, extraPidsObserved, processObserved: true, cleanup };
}

const calcRow = proofResults.find((r) => r.family === 'Microsoft.WindowsCalculator_8wekyb3d8bbwe');
let activation = {
  skipped: true,
  skipReason: 'Calculadora not found as a packaged app on this machine.',
  attemptedPid: null,
  extraPidsObserved: [],
  processObserved: false,
  cleanup: null,
};
let activationError = null;
if (calcRow?.found) {
  try {
    activation = await launchAndObserve(calcRow.aumid, 'CalculatorApp.exe');
  } catch (err) {
    activationError = String(err?.message ?? err);
  }
}

// --- Step 7: merge-without-duplicates statement, backed by real data -------
//
// Round-2 blocker 2: the previous version characterized the second "Claude"
// AUMID as "the separately installed win32 Claude desktop app (its AUMID
// has the shape electron-builder assigns for Windows toast notifications on
// non-MSIX installs)" WITHOUT resolving the .lnk it claimed backed that
// row. Resolved this run (via lnk-parser.mjs, the same parser PROOF-03
// validated against COM): it is a Firefox "taskbar tab" web app, not a
// win32 Claude install. See the ADR for the full resolved-target evidence.

const claudeRows = classified.filter((r) => r.name === 'Claude');
const claudeLnkMatches = lnkResolved
  .filter((r) => path.basename(r.file, path.extname(r.file)).toLowerCase() === 'claude')
  .map((r) => ({ file: redact(r.file), resolvedTargetPath: redact(r.resolvedTargetPath) }));
const claudePackagedRow = classified.find((r) => r.family === 'Claude_pzs8sxrjxfjjc');
const claudePackagedStructuralCheck = claudePackagedRow ? structuralAbsenceCheck('Claude_pzs8sxrjxfjjc') : null;

// --- write full artifact for audit --------------------------------------

const resultPayload = {
  generatedAtUtc: new Date().toISOString(),
  outDir: redact(outDir),
  repoState,
  culture: raw.culture ?? null,
  timings: {
    lnkWalk: { ...lnkWalkStats, unit: 'ms' },
    powershellCollect: { ...psCollectStats, unit: 'ms' },
    totalMs: Number((lnkWalkStats.median + psCollectStats.median).toFixed(2)),
    totalMsNote: 'sum of the two arms\' medians, not a single elapsed-time sample',
    lnkTargetResolveMs: Number(lnkParseMs.toFixed(2)),
    lnkTargetResolveMsNote: 'single sample, diagnostic only — new proof plumbing, not the existing .lnk-scan mechanism being benchmarked',
  },
  lnkBaseline: {
    roots: lnkRootsReport,
    totalLnkFiles: lnkFiles.length,
    unresolvedTargetCount: unresolvedLnkCount,
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
    launchedViaExplorerShellAppsFolder: Boolean(calcRow?.found) && !activation.skipped,
    baselineSkipped: activation.skipped,
    skipReason: activation.skipReason,
    attemptedPid: activation.attemptedPid,
    extraPidsObserved: activation.extraPidsObserved,
    processObserved: activation.processObserved,
    cleanup: activation.cleanup,
    error: activationError,
  },
  duplicateCaseEvidence: {
    name: 'Claude',
    rows: claudeRows,
    lnkFilesNamedClaude: claudeLnkMatches,
    packagedClaudeStructuralAbsenceCheck: claudePackagedStructuralCheck,
  },
  packagedApps,
};

writeFileSync(path.join(outDir, 'uwp-scan-result.json'), JSON.stringify(resultPayload, null, 2), 'utf8');

// --- Step 8: report ---------------------------------------------------------

console.log('=== PROOF-02: UWP/Store app enumerator ===');
console.log(
  `.lnk scan (existing mechanism): ${lnkFiles.length} .lnk files, ${WARMUP_ITERATIONS} warmup + ${TIMED_ITERATIONS} timed runs ` +
    `-> median ${lnkWalkStats.median} ms (min ${lnkWalkStats.min}, max ${lnkWalkStats.max}, n=${lnkWalkStats.n})`
);
for (const r of lnkRootsReport) console.log(`  root [${r.label}]: ${r.count} .lnk files`);
console.log(
  `Get-StartApps + Get-AppxPackage collect: ${WARMUP_ITERATIONS} warmup + ${TIMED_ITERATIONS} timed runs -> median ` +
    `${psCollectStats.median} ms (min ${psCollectStats.min}, max ${psCollectStats.max}, n=${psCollectStats.n}) -> ` +
    `${startApps.length} index rows, ${appxPackages.length} installed AppX packages`
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
  console.log(`      absent from .lnk scan (structural proof): ${r.absentFromLnkScan}`);
}
console.log('');
console.log(`Windows Terminal (Microsoft.WindowsTerminal_8wekyb3d8bbwe) installed on this machine: ${terminalInstalled}`);
console.log('  -> Substituted with the Store-packaged PowerShell app in the 3rd proof slot (see report/ADR).');
console.log('');
console.log('Activation proof (baseline-diffed PID, not a bare tasklist poll):');
console.log(`  launched via explorer.exe shell:AppsFolder\\...: ${Boolean(calcRow?.found) && !activation.skipped}`);
if (activation.skipped) {
  console.log(`  SKIPPED: ${activation.skipReason}`);
} else {
  console.log(`  new CalculatorApp.exe PID observed after launch: ${activation.attemptedPid ?? '(none)'}`);
  console.log(`  processObserved: ${activation.processObserved}`);
  if (activation.cleanup) console.log(`  cleanup: ${JSON.stringify(activation.cleanup)}`);
}
if (activationError) console.log(`  error: ${activationError}`);
console.log('');
console.log('Merge-without-duplicates evidence (real duplicate risk found on this machine — "Claude"):');
for (const row of claudeRows) {
  console.log(
    `  - aumid=${row.aumid} packaged=${row.packaged} familyInAppxRegistry=${row.familyInAppxRegistry} ` +
      `lnkDisplayNameCollision=${row.lnkDisplayNameCollision}`
  );
}
for (const m of claudeLnkMatches) {
  console.log(`  - Claude.lnk resolved target: ${m.resolvedTargetPath ?? '(unresolved)'}  (${m.file})`);
}
if (claudePackagedStructuralCheck) {
  console.log(`  - packaged "Claude" structural absence check: absent=${claudePackagedStructuralCheck.absent}`);
}
console.log('');
console.log(`Total scan count: ${startApps.length} Start-menu index rows scanned`);
console.log(`  of which ${packagedApps.length} are confirmed UWP/Store apps (packaged)`);
console.log(`  of which ${unpackagedApps.length} are non-packaged (left for the .lnk-based scan to discover by target path)`);
console.log(
  `Elapsed time: ${resultPayload.timings.totalMs} ms (median .lnk walk ${lnkWalkStats.median} ms + median PowerShell ` +
    `collect ${psCollectStats.median} ms)`
);
console.log('');
console.log(`Full artifact written to: ${redact(path.join(outDir, 'uwp-scan-result.json'))}`);
