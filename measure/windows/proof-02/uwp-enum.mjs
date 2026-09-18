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
 * the "out/" case) and, ALWAYS in this script's own .scratch/ directory
 * (never in <out>, regardless of what --out points at — round-3 major
 * finding 2), raw-startapps.json: the raw Get-StartApps + Get-AppxPackage
 * dump, a personal-machine inventory, gitignored, never committed; see
 * docs/adr/0002 "known gaps". Prints a human report to stdout.
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
 *
 * --- ROUND-3 REVIEW FIXES (see docs/adr/0002-proof-02-uwp-app-enumeration.md) ---
 *
 *   1. (blocker) The byte-search half of the structural absence proof
 *      searched a latin1 decoding of each .lnk while the AUMID/family name
 *      is stored as UTF-16LE — it could never match and returned "absent"
 *      by construction for every IDList-only shortcut. Fixed to a real
 *      byte-level UTF-16LE search (lnkBytesContainFamily()), and — because
 *      an encoding tweak alone doesn't prove the check CAN return a
 *      negative — this run now self-tests that exact function against a
 *      committed positive/negative control fixture
 *      (fixtures/shell-appsfolder-calculator-control.lnk, a real
 *      shell:AppsFolder shortcut) before any absentFromLnkScan claim is
 *      made, and throws if either control fails. The ADR states precisely
 *      what this search does and does not establish.
 *   2. (major) The ADR claimed raw-startapps.json "was removed from the
 *      working tree" when the documented re-record command recreates it in
 *      out/ every time. Fixed at the source: the raw dump now always
 *      writes to this script's own gitignored .scratch/ directory,
 *      independent of --out, so out/ genuinely never receives it and the
 *      ADR sentence is now true rather than aspirational.
 *   3. (major) The stdout/ADR benchmark line labeled a bare directory walk
 *      (no target resolution) as "the existing mechanism" and set it
 *      against the new mechanism's cost, implying a ~276x gap that doesn't
 *      exist. Relabeled to what it measures; the real existing-mechanism
 *      comparison (COM .lnk resolution) is now printed alongside with its
 *      source labeled — no number is invented or presented as measured by
 *      this script when it wasn't.
 *   4. (minor) gitInfo() recorded lnk-parser.mjs's dirty status but not
 *      this script's own, and a dirty flag has an ordering problem (this
 *      file is dirty relative to HEAD until the commit that ships this fix
 *      lands). Now also records a SHA-256 of uwp-enum.mjs and
 *      collect-startapps.ps1 — provenance that holds regardless of commit
 *      timing — alongside both scripts' dirty status.
 *   5. (minor) `--out` followed by another flag (e.g. `--out --bogus`) was
 *      silently accepted as a literal directory name. parseArgs now
 *      rejects an --out value that starts with "--".
 *   6. (minor) The install-location containment check used a bare
 *      startsWith with no path-separator boundary, so a sibling package
 *      directory sharing a name prefix (e.g. `...Foo_1.0_x64__abc2`) could
 *      satisfy `...Foo_1.0_x64__abc`. Now requires the next character to
 *      be a path separator (or an exact match).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
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
      if (value.startsWith('--')) {
        throw new Error(
          `--out requires a path value, but got "${value}", which looks like another flag, not a directory — ` +
            `refusing to silently create a directory literally named after it. Round-3 minor finding 5.`
        );
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
// state so a reader of the committed artifact knows what code produced it,
// instead of assuming it matches HEAD.
//
// Round-3 minor finding 4: this used to record lnk-parser.mjs's dirty
// status only, and the comment above claimed that told a reader "exactly
// what code produced it" — but this script's OWN dirty status was never
// recorded, and at the commit the round-2 artifact cited, the entire
// structural-absence feature did not exist yet in this file. A dirty flag
// also has an ordering problem for a file recording its OWN provenance:
// this script is necessarily dirty relative to HEAD until the very commit
// that ships whatever fix it just made lands, so "dirty: true" here is
// expected, not a defect, on the run that produces the commit. What holds
// regardless of commit timing is a content hash — so this now also records
// a SHA-256 of uwp-enum.mjs and collect-startapps.ps1, in addition to both
// scripts' git dirty status.

function sha256File(filePath) {
  try {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
  } catch (err) {
    return null;
  }
}

function dirtyStatus(relativePath) {
  const statusLine = execFileSync('git', ['status', '--porcelain', '--', relativePath], {
    cwd: __dirname,
    encoding: 'utf8',
  }).trim();
  return { dirty: statusLine.length > 0, statusLine: statusLine || null };
}

function gitInfo() {
  try {
    const headCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).trim();
    const lnkParser = dirtyStatus('../lnk-parser.mjs');
    const self = dirtyStatus('uwp-enum.mjs');
    const collectScript = dirtyStatus('collect-startapps.ps1');
    return {
      headCommit,
      lnkParserDirty: lnkParser.dirty,
      lnkParserStatusLine: lnkParser.statusLine,
      uwpEnumDirty: self.dirty,
      uwpEnumStatusLine: self.statusLine,
      uwpEnumSha256: sha256File(path.join(__dirname, 'uwp-enum.mjs')),
      collectStartAppsDirty: collectScript.dirty,
      collectStartAppsStatusLine: collectScript.statusLine,
      collectStartAppsSha256: sha256File(path.join(__dirname, 'collect-startapps.ps1')),
    };
  } catch (err) {
    return {
      headCommit: null,
      lnkParserDirty: null,
      lnkParserStatusLine: null,
      uwpEnumDirty: null,
      uwpEnumStatusLine: null,
      uwpEnumSha256: sha256File(path.join(__dirname, 'uwp-enum.mjs')),
      collectStartAppsDirty: null,
      collectStartAppsStatusLine: null,
      collectStartAppsSha256: sha256File(path.join(__dirname, 'collect-startapps.ps1')),
      error: String(err?.message ?? err),
    };
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
//
// Round-3 major finding 2: the raw dump used to be written into whatever
// --out receives, so the ADR's own re-record command
// (`--out measure/windows/proof-02/out`) regenerated it in the committed
// out/ directory on every run, making the ADR's "removed from the working
// tree" claim false by construction. The raw dump now always writes to
// this script's own gitignored .scratch/ directory — independent of
// --out — so out/ genuinely never receives it, regardless of what --out is
// pointed at.

const rawScratchDir = path.join(__dirname, '.scratch');
mkdirSync(rawScratchDir, { recursive: true });
const psScript = path.join(__dirname, 'collect-startapps.ps1');
const rawOutFile = path.join(rawScratchDir, 'raw-startapps.json');

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
//       PackageFamilyName string covers *part* of that gap — see the
//       round-3 fix and honest scope statement immediately below.
//
// A packaged app is "absent from the .lnk scan" only when BOTH checks find
// nothing — not inferred from any string match on the display name.
//
// --- ROUND-3 blocker 1 fix -------------------------------------------------
//
// The byte search (b) used to lowercase each .lnk as LATIN1
// (`buf.toString('latin1').toLowerCase()`) and search for the family name
// in that decoding. The AUMID/family name inside a shell:AppsFolder IDList
// is stored as UTF-16LE, not Latin-1/ANSI — that search could never match
// and returned "absent" for every IDList-only shortcut BY CONSTRUCTION,
// regardless of whether the family name was actually present. It would
// have produced identical output if deleted.
//
// Fixed: lnkBytesContainFamily() does a byte-level search for the family
// name encoded as UTF-16LE (`buf.includes(Buffer.from(family, 'utf16le'))`)
// — not `buf.toString('utf16le').includes(...)`, which is also insufficient
// on its own: a shell item's string payload is not guaranteed to start at
// an even (2-byte-aligned) offset from 0, so decoding the WHOLE buffer as
// UTF-16LE from offset 0 can miss a needle that a raw byte-level search
// still finds.
//
// An encoding fix alone does not prove this check is CAPABLE of returning
// a negative — the round-3 review explicitly pre-rejected that as
// insufficient. So this exact function is now self-tested (see
// "Step 4a: self-test" below) against a committed positive/negative
// control fixture before any absentFromLnkScan claim is made, and the run
// throws if either control fails.
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
    // buf (the raw bytes) is deliberately kept in memory for every one of
    // the 182 shortcuts (not streamed/discarded per-file) because
    // structuralAbsenceCheck below runs the byte search once per PACKAGED
    // app (18 searches) against the whole set — re-reading each .lnk from
    // disk per app would be slower and this is a one-shot script, not a
    // long-lived process, so the retention is a deliberate trade, not a
    // leak.
    buf,
  };
});
const lnkParseMs = Number(process.hrtime.bigint() - lnkParseStart) / 1e6;
const unresolvedLnkCount = lnkResolved.filter((r) => !r.resolvedTargetPath).length;

/**
 * Byte-level UTF-16LE search for `family` inside a .lnk's raw bytes. This
 * is the ONE function both the real per-app structural check and the
 * fixture self-test call — a control written against a copy-pasted search
 * would prove nothing about the search actually used.
 *
 * What this establishes: the package's PackageFamilyName is present
 * somewhere in the shortcut's raw bytes as a UTF-16LE string.
 * What this does NOT establish: this is not a decode of the
 * LinkTargetIDList structure (lnk-parser.mjs explicitly scopes that out —
 * see its header, "Deliberate scope limits" §1), so it cannot say WHERE in
 * the shortcut the string appears or what shell-item type references it,
 * and a shortcut that lacks the literal family-name string cannot be ruled
 * out from referencing the package through some other, indirect encoding
 * this search does not know how to recognize. It is a positive-hit
 * detector proven (by the self-test) capable of a real hit; it is not a
 * general proof that "byte search found nothing" implies "the package is
 * definitely not referenced" for every conceivable IDList encoding.
 */
function lnkBytesContainFamily(buf, family) {
  if (!buf) return false;
  return buf.includes(Buffer.from(family, 'utf16le'));
}

const appxInstallLocationByFamily = new Map(
  appxPackages.filter((p) => p.PackageFamilyName && p.InstallLocation).map((p) => [p.PackageFamilyName, p.InstallLocation])
);

// Round-3 minor finding 6: containment used to be a bare startsWith with no
// path-separator boundary, so `...Foo_1.0_x64__abc2\` would satisfy
// startsWith(`...Foo_1.0_x64__abc`) — a false "resolved target matches"
// against a merely name-prefixed SIBLING package directory. Now the target
// must be the install directory itself, or fall strictly inside it (next
// character after the install-location prefix must be a path separator).
function isInsideInstallLocation(targetPathLower, installLocationLower) {
  if (targetPathLower === installLocationLower) return true;
  return targetPathLower.startsWith(installLocationLower + path.sep);
}

function structuralAbsenceCheck(family) {
  const installLocationRaw = appxInstallLocationByFamily.get(family) ?? null;
  // Strip any trailing separator first so installLocationLower + path.sep
  // below never produces a doubled separator.
  const installLocation = installLocationRaw ? installLocationRaw.replace(/[\\/]+$/, '') : null;
  const installLocationLower = installLocation ? installLocation.toLowerCase() : null;
  const targetMatches = installLocationLower
    ? lnkResolved.filter((r) => r.resolvedTargetPath && isInsideInstallLocation(r.resolvedTargetPath.toLowerCase(), installLocationLower))
    : [];
  const byteMatches = lnkResolved.filter((r) => lnkBytesContainFamily(r.buf, family));
  return {
    installLocation: redact(installLocation),
    resolvedTargetMatches: targetMatches.map((m) => redact(m.file)),
    byteSearchMatches: byteMatches.map((m) => redact(m.file)),
    absent: targetMatches.length === 0 && byteMatches.length === 0,
  };
}

// --- Step 4a: self-test the structural-absence checks against a committed
// positive/negative control fixture (round-3 blocker 1 required fix (a),
// combined with (c)'s honest-scope statement above) -------------------------
//
// fixtures/shell-appsfolder-calculator-control.lnk is a REAL
// shell:AppsFolder shortcut, generated via WScript.Shell with
// TargetPath = "shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"
// — the exact case (an IDList-only shortcut whose only path information is
// the AppsFolder shell item) that lnk-parser.mjs's resolvedTargetPath
// cannot decide (scope limit §1) and that the byte search exists to cover.
// Verified free of any machine-specific/PII content before being committed
// (grep for the OS username and "C:\Users" both returned no match).
//
// This run refuses to make any absentFromLnkScan claim unless:
//   1. parseLnk() on the fixture confirms resolvedTargetPath is null and
//      idListOnly is true — i.e. this really is a case check (a) cannot
//      decide, so the byte search is load-bearing for it, not redundant.
//   2. lnkBytesContainFamily() — the EXACT function used above, not a
//      separately-written copy — DOES detect the Calculator family name in
//      the fixture (positive control: proves the check can return a hit).
//   3. lnkBytesContainFamily() does NOT detect an unrelated family (Photos)
//      that the fixture does not reference (negative control: proves a
//      passing positive control isn't a degenerate "always true").
// Any failure throws, naming which control failed — a control that only
// prints and continues is decoration, not a proof.

const fixturePath = path.join(__dirname, 'fixtures', 'shell-appsfolder-calculator-control.lnk');
const fixtureBuf = readFileSync(fixturePath);
const fixtureParsed = parseLnk(fixtureBuf);
const FIXTURE_POSITIVE_FAMILY = 'Microsoft.WindowsCalculator_8wekyb3d8bbwe';
const FIXTURE_NEGATIVE_FAMILY = 'Microsoft.Windows.Photos_8wekyb3d8bbwe';

if (fixtureParsed.resolvedTargetPath !== null || fixtureParsed.category?.idListOnly !== true) {
  throw new Error(
    `Structural-absence self-test precondition failed: the committed control fixture ` +
      `(${fixturePath}) was expected to be an IDList-only shortcut (resolvedTargetPath: null, ` +
      `idListOnly: true) — the exact case check (a) cannot decide — but parseLnk returned ` +
      `resolvedTargetPath=${JSON.stringify(fixtureParsed.resolvedTargetPath)}, ` +
      `idListOnly=${JSON.stringify(fixtureParsed.category?.idListOnly)}. Refusing to trust the byte ` +
      `search's self-test until this is understood. Round-3 blocker 1.`
  );
}
const positiveControlDetected = lnkBytesContainFamily(fixtureBuf, FIXTURE_POSITIVE_FAMILY);
if (!positiveControlDetected) {
  throw new Error(
    `Structural-absence self-test FAILED (positive control): lnkBytesContainFamily() did not detect ` +
      `family "${FIXTURE_POSITIVE_FAMILY}" inside the committed control fixture, which is a real ` +
      `shell:AppsFolder shortcut for exactly that package. The byte search cannot be trusted to return a ` +
      `negative when it cannot even return a positive on a known-true case — refusing to make any ` +
      `absentFromLnkScan claim. Round-3 blocker 1.`
  );
}
const negativeControlDetected = lnkBytesContainFamily(fixtureBuf, FIXTURE_NEGATIVE_FAMILY);
if (negativeControlDetected) {
  throw new Error(
    `Structural-absence self-test FAILED (negative control): lnkBytesContainFamily() reported family ` +
      `"${FIXTURE_NEGATIVE_FAMILY}" as present inside a fixture that only references ` +
      `"${FIXTURE_POSITIVE_FAMILY}" — the check is not discriminating and would report false "not absent" ` +
      `results. Refusing to make any absentFromLnkScan claim. Round-3 blocker 1.`
  );
}

const structuralAbsenceSelfTest = {
  fixtureFile: 'measure/windows/proof-02/fixtures/shell-appsfolder-calculator-control.lnk',
  fixtureSizeBytes: fixtureBuf.length,
  fixtureConfirmedIdListOnly: true,
  fixtureConfirmedUnresolvedByCheck1: true,
  positiveControlFamily: FIXTURE_POSITIVE_FAMILY,
  positiveControlDetected,
  negativeControlFamily: FIXTURE_NEGATIVE_FAMILY,
  negativeControlDetected,
  passed: true,
  scopeStatement:
    'This search detects a PackageFamilyName present as literal UTF-16LE bytes anywhere in a .lnk file. ' +
    'It is not a decode of LinkTargetIDList (lnk-parser.mjs scope limit #1) and cannot say where/how the ' +
    'string is referenced. It is proven (by this self-test) capable of a real positive hit and of not ' +
    'firing on an unrelated family; it is not a general proof that a miss rules out every possible IDList ' +
    'encoding of a reference to the package.',
};

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
    // Round-3 major finding 3: this arm is a bare directory walk — it never
    // resolves a target — and was previously mislabeled "existing
    // mechanism", set against the new mechanism's ~1710 ms as if the .lnk
    // scan itself costs 6 ms. It does not; see existingMechanismComparison
    // below for the honest figures (with provenance) this decision
    // actually rests on.
    lnkDirectoryWalk: { ...lnkWalkStats, unit: 'ms' },
    lnkDirectoryWalkNote:
      'baseline enumeration only (readdir + filter by .lnk extension) — does NOT resolve any shortcut target. ' +
      'Renamed from "lnk scan (existing mechanism)"; see existingMechanismComparison for the real existing-mechanism cost.',
    powershellCollect: { ...psCollectStats, unit: 'ms' },
    totalMs: Number((lnkWalkStats.median + psCollectStats.median).toFixed(2)),
    totalMsNote: 'sum of the directory-walk and PowerShell-collect arms\' medians, not a single elapsed-time sample',
    lnkTargetResolveMs: Number(lnkParseMs.toFixed(2)),
    lnkTargetResolveMsNote: 'single sample, diagnostic only — new proof plumbing (structural-absence check), not the existing .lnk-resolution mechanism being compared against',
  },
  // Round-3 major finding 3: the actual "what does the existing mechanism
  // cost" comparison this decision rests on. Neither figure was measured by
  // THIS script — both are cited with their source so a reader can tell
  // measured-by-this-run apart from measured-elsewhere.
  existingMechanismComparison: {
    researchDocBaseline: {
      source: '.maxvision/research/WINDOWS-STACK.md',
      description: '149 .lnk shortcuts resolved via COM',
      ms: 2395,
      measuredByThisScript: false,
    },
    adr0003Remeasurement: {
      source: 'docs/adr/0003-proof-03-lnk-binary-parsing.md',
      description: 'COM loop-only, re-measured, median of n=5',
      ms: 273.1,
      measuredByThisScript: false,
    },
    thisRunUwpEnumerationMs: psCollectStats.median,
    note:
      'The new UWP-enumeration mechanism (Get-StartApps + Get-AppxPackage, median ' +
      psCollectStats.median +
      ' ms this run) is the same order of magnitude as COM .lnk resolution (273.1–2395 ms depending on which ' +
      'measurement), not ~276x cheaper than a bare directory walk that never resolves anything and was never ' +
      'the thing being compared against.',
  },
  structuralAbsenceSelfTest,
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
  `.lnk directory walk (baseline enumeration only, no target resolution): ${lnkFiles.length} .lnk files, ` +
    `${WARMUP_ITERATIONS} warmup + ${TIMED_ITERATIONS} timed runs -> median ${lnkWalkStats.median} ms ` +
    `(min ${lnkWalkStats.min}, max ${lnkWalkStats.max}, n=${lnkWalkStats.n})`
);
for (const r of lnkRootsReport) console.log(`  root [${r.label}]: ${r.count} .lnk files`);
console.log(
  `  (for comparison, NOT measured by this run: research-doc baseline 2395 ms / 149 .lnk resolved via COM ` +
    `[.maxvision/research/WINDOWS-STACK.md]; ADR-0003 re-measured COM loop-only median 273.1 ms, n=5)`
);
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
console.log('Structural-absence byte-search self-test (round-3 blocker 1 — fixture: fixtures/shell-appsfolder-calculator-control.lnk):');
console.log(
  `  fixture confirmed IDList-only (unresolvable by check 1): ${structuralAbsenceSelfTest.fixtureConfirmedIdListOnly}`
);
console.log(
  `  positive control (${structuralAbsenceSelfTest.positiveControlFamily}) detected: ${structuralAbsenceSelfTest.positiveControlDetected}`
);
console.log(
  `  negative control (${structuralAbsenceSelfTest.negativeControlFamily}) NOT detected: ${!structuralAbsenceSelfTest.negativeControlDetected}`
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
  `Elapsed time: ${resultPayload.timings.totalMs} ms (median .lnk directory walk ${lnkWalkStats.median} ms + median PowerShell ` +
    `collect ${psCollectStats.median} ms)`
);
console.log('');
console.log(`Full artifact written to: ${redact(path.join(outDir, 'uwp-scan-result.json'))}`);
