// measure/windows/proof-03-lnk-benchmark.mjs
//
// PROOF-03: Validate binary .lnk parsing in Node against the COM baseline.
//
// Enumerates every .lnk under the machine + user Start Menu, resolves each
// one two ways -- (a) COM WScript.Shell via lnk-com-resolve.ps1, the same
// mechanism that produced the 2395ms/149-shortcut baseline, and (b) the
// pure-Node binary reader in lnk-parser.mjs -- and reports, per shortcut,
// whether the two agree.
//
// The comparison is against the parser's PRIMARY output
// (parserResolvedTargetPath, i.e. candidates[0]) -- what the parser
// actually resolves a shortcut to. A match found only somewhere else in
// the candidate list is a DIFFERENT, weaker finding
// ('matched-only-via-secondary-candidate'), counted apart from 'exact'.
// See docs/adr/0003-proof-03-lnk-binary-parsing.md, round-2 blocker 1: the
// previous version of this script scanned the whole candidate list and
// reported a match found ANYWHERE as 'exact', which made the headline
// number identical whether or not resolution actually worked.
//
// Timing: iteration 0 runs the Node parser first (the original ordering)
// and is reported separately as "iteration 0", NOT averaged into the warm
// stats -- but it is NOT a fair cold-vs-warm comparison and no speedup
// ratio is derived from it: Node absorbs every file's first-touch disk
// read in this ordering, so COM then reads a cache Node just warmed. A
// genuinely first-touch run (nothing had touched these files beforehand)
// produced speedups ranging 2.2x-12.5x across two attempts on this
// machine -- round-3 blocker 1. Iterations 1..N are additional warm passes
// (the OS file cache and PowerShell/COM JIT are already warm); their
// median/min/max/stddev is the headline "warm" number, the only speedup
// figure this script derives a ratio from. Round-2 major finding 2,
// round-3 blocker 1.
//
// Scan roots: the two Start Menu \Programs folders (all-users, then
// per-user) are resolved via the OS known-folder mechanism (the `Shell
// Folders` registry key), which reflects whatever redirection (GPO,
// roaming profile relocation, OneDrive Known Folder Move) is currently in
// effect -- falling back, per root independently, to the original
// %ProgramData%/%APPDATA% + 'Microsoft\Windows\Start Menu\Programs'
// reconstruction only if that registry lookup itself fails. `--scan-root
// <path>` (repeatable) bypasses both and scans exactly the given path(s)
// instead -- see resolveStartMenuRoots's docblock. Round-10 blocker
// finding 1: a scan root that does not exist on disk is no longer
// silently dropped -- see walkLnkFiles's docblock for MISSING_SCAN_ROOT.
//
// Usage: node measure/windows/proof-03-lnk-benchmark.mjs [--write-canonical] [--scan-root <path> ...]
// Writes (default, no flag): an UNTRACKED, timestamped copy of the full
// per-shortcut report under measure/windows/out/, e.g.
// measure/windows/out/proof-03-results-2026-09-18T12-34-56.789Z.json --
// never the tracked measure/windows/proof-03-results.json. Round-9 blocker
// finding 4: a plain run used to silently overwrite that tracked canonical
// baseline every time, with only a generic "written to" line as a hint --
// no warning that it had just replaced a committed artifact other sessions
// depend on (the worker's own unresolved notes describe this file being
// "twice accidentally swept into unrelated commits by other sessions", and
// this design was a contributing cause).
// Writes (--write-canonical): the tracked measure/windows/proof-03-results.json
// itself, but ONLY when that exact path is both tracked by git AND currently
// clean (no uncommitted diff for THAT path) -- so the run's own diff is the
// only thing `git diff` shows afterward, and no other session's in-progress,
// uncommitted edit to that same file is silently clobbered. Refuses outright
// (exit 1, nothing written) otherwise: untracked, dirty, or git itself
// unreadable (missing binary, not a repo, etc. -- fails CLOSED, not open).

import { readdirSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { parseLnk } from './lnk-parser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASELINE_MS = 2395;
const BASELINE_COUNT = 149;
const BASELINE_MS_PER_ITEM = BASELINE_MS / BASELINE_COUNT;

const WARMUP_ITERATIONS = 1; // iteration 0: cold, reported separately, not in the warm stats
const TIMED_ITERATIONS = 5; // iterations 1..5: warm, aggregated (median/min/max/stddev)

/**
 * Enumerates *.lnk under `root`. `root` itself is a SCAN ROOT -- Windows
 * guarantees a Start Menu Programs folder resolved via the OS known-folder
 * mechanism (or, as a fallback, the env-var reconstruction) exists, so a
 * ROOT that does not exist (ENOENT) is NEVER expected and is recorded into
 * `dirErrors` with its own code, `MISSING_SCAN_ROOT` -- it reaches the
 * WARNING line and gates the exit code, the same as any other under-count.
 * Round-10 blocker finding 1: this file previously treated ROOT-level
 * ENOENT identically to every other ENOENT encountered mid-walk (silently
 * skipped, "expected on a machine without that root") -- but a scan root
 * can only be missing because GPO/roaming Start-Menu-specific redirection
 * points somewhere this account cannot see, a service-account profile has
 * no Start Menu, or the resolved path is itself wrong; none of those is
 * "expected," and the previous wording blessed exactly the defect this
 * fix closes. A directory that disappears MID-WALK (a subfolder deleted
 * between `readdirSync` calls, e.g.) is still genuinely benign and stays
 * silently skipped, not recorded -- only the top-level roots `main()`
 * passes to this function (via `resolveStartMenuRoots`) get the ROOT
 * treatment, via the `isRoot` flag `walk()` carries through its own
 * recursion.
 *
 * Any OTHER readdir error (EACCES, EPERM, ENOTDIR, EMFILE, ...), at any
 * depth including the root, is recorded into `dirErrors` instead of being
 * swallowed, so a permission-denied or otherwise-unreadable subtree
 * shrinks the measured set VISIBLY rather than silently. Round-2 major
 * finding 5.
 *
 * A directory ENTRY that is a reparse point (junction or symlink --
 * `entry.isSymbolicLink()`) is neither `isDirectory()` nor `isFile()` per
 * `readdirSync(..., {withFileTypes:true})` on Windows, so it used to fall
 * through BOTH branches below: not descended into, not recorded anywhere,
 * no WARNING, exit code still 0 -- the scanned set would shrink with zero
 * signal. This is exactly the shape folder redirection uses (roaming
 * profiles, OneDrive Known Folder Move, GPO redirection of
 * %APPDATA%/%LOCALAPPDATA%), so a redirected-profile machine would have
 * silently under-counted its Start Menu. Round-4 major finding 3: such an
 * entry is now explicitly recorded into `dirErrors` with a distinct code
 * (`SKIPPED_REPARSE_POINT`), which reaches both the WARNING line and the
 * exit-code gate, the same as any other under-count. It is deliberately
 * NOT followed (no realpath loop-guard is needed as a result): a reparse
 * point can point outside either scanned root or form a cycle, and this
 * benchmark's job is to report what it did NOT scan, honestly, not to
 * silently widen its own scope. This covers REPARSE-POINT redirection
 * (roaming profile relocation, OneDrive KFM) only -- a scan root that is
 * simply absent (a plain missing directory, no reparse point involved,
 * the round-10 GPO/service-account/wrong-env-var shape) is the separate
 * `MISSING_SCAN_ROOT` case above; the two are DIFFERENT failure shapes
 * and this file no longer conflates "redirection is covered" with "a
 * missing root is covered" -- only the former was true before this round.
 *
 * `readdirImpl` is injectable (default `readdirSync`) purely so
 * test/windows-lnk-parser.test.mjs can exercise the root-vs-mid-walk
 * ENOENT distinction deterministically, without racing a real directory
 * deletion against a real `readdirSync` call (round-10 minor finding 3).
 */
export function walkLnkFiles(root, dirErrors, deps = {}) {
  const { readdirImpl = readdirSync } = deps;
  const out = [];
  function walk(dir, isRoot) {
    let entries;
    try {
      entries = readdirImpl(dir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        if (isRoot) {
          dirErrors.push({
            dir,
            code: 'MISSING_SCAN_ROOT',
            message: 'this Start Menu scan root does not exist. A ROOT (unlike a directory reached mid-walk) is never expected to be missing -- see walkLnkFiles docblock. Likely causes: GPO/roaming Start-Menu-specific redirection pointing somewhere this account cannot see, a service-account profile with no Start Menu, or a wrong known-folder/env-var resolution.',
          });
        }
        // A non-root ENOENT (mid-walk) stays genuinely benign and silent:
        // a subfolder that disappears between readdirSync calls is not a
        // sign of anything wrong with the scan.
        return;
      }
      dirErrors.push({ dir, code: err.code ?? 'UNKNOWN', message: err.message });
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        dirErrors.push({
          dir: full,
          code: 'SKIPPED_REPARSE_POINT',
          message: 'entry is a symlink/junction (reparse point); not followed, not descended into -- see walkLnkFiles docblock',
        });
        continue;
      }
      if (entry.isDirectory()) walk(full, false);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) out.push(full);
    }
  }
  walk(root, true);
  return out;
}

/** Windows basenames cannot contain ':' (NTFS reserves it for alternate
 * data streams; `new Date().toISOString()` produces "12:34:56", which
 * would either throw or silently write to a `...12` ADS on a bare-':'
 * path). Replace ':' with '-' so the default timestamped report path is a
 * valid Windows filename, not merely POSIX-safe -- rule 5 of this task:
 * Windows path handling is the whole point of the project. */
export function isoForFilename(date) {
  return date.toISOString().replace(/:/g, '-');
}

/** `git status --porcelain -- <path>` for exactly one path, run with cwd
 * inside the repo so git resolves the root itself. Returns the raw
 * (possibly empty) stdout, or null if git could not be asked at all
 * (missing binary, not a repo, non-zero exit) -- callers must treat null
 * as "unknown," never as "clean." */
export function gitPorcelainStatusForPath(cwd, absPath) {
  try {
    const proc = spawnSync('git', ['status', '--porcelain', '--', absPath], { cwd, encoding: 'utf8' });
    if (proc.error || proc.status !== 0) return null;
    return proc.stdout;
  } catch {
    return null;
  }
}

/** `git ls-files --error-unmatch -- <path>`: true only if git itself ran
 * successfully AND reported the path as tracked. Any failure to run git
 * (missing binary, not a repo) or a nonzero exit (untracked) is false. */
export function gitPathIsTracked(cwd, absPath) {
  try {
    const proc = spawnSync('git', ['ls-files', '--error-unmatch', '--', absPath], { cwd, encoding: 'utf8' });
    return !proc.error && proc.status === 0;
  } catch {
    return false;
  }
}

/** Thrown by `resolveReportPath` on a `--write-canonical` refusal.
 * `reason` is a machine-checkable discriminant -- `'git-unreadable'`,
 * `'untracked'`, or `'dirty'` -- so a test (or a caller) can assert WHICH
 * refusal fired without parsing stderr prose. Round-10 minor finding 3:
 * the previous version signaled refusal only via `process.exit(1)`
 * inside this function, which is untestable in-process (it would kill the
 * test runner), and via stderr text a wording tweak could silently
 * decouple from the actual branch taken. */
export class ReportPathRefusal extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'ReportPathRefusal';
    this.reason = reason;
  }
}

/** Decides where this run's report gets written and enforces the
 * --write-canonical gate (round-9 blocker finding 4). Runs BEFORE the
 * (expensive) benchmark loop so a refusal fails fast instead of burning a
 * full COM+parser measurement run first.
 *
 * Throws `ReportPathRefusal` on refusal instead of calling
 * `process.exit(1)` directly (round-10 minor finding 3) -- the caller
 * (`main`) is responsible for turning that into exit code 1. `deps` lets
 * tests inject fake git results and capture the printed messages without
 * spawning real git or exiting the test process. */
export function resolveReportPath(argv, dirnameOfThisFile, deps = {}) {
  const {
    isTracked = gitPathIsTracked,
    porcelainStatus = gitPorcelainStatusForPath,
    log = (...a) => console.log(...a),
    logError = (...a) => console.error(...a),
  } = deps;

  const writeCanonical = argv.includes('--write-canonical');
  const canonicalPath = join(dirnameOfThisFile, 'proof-03-results.json');

  if (!writeCanonical) {
    const outDir = join(dirnameOfThisFile, 'out');
    mkdirSync(outDir, { recursive: true });
    const path = join(outDir, `proof-03-results-${isoForFilename(new Date())}.json`);
    log(`Report destination: ${path} (untracked, timestamped -- default; the tracked canonical`);
    log(`  measure/windows/proof-03-results.json is left untouched. Pass --write-canonical to`);
    log(`  deliberately overwrite it instead, which only succeeds when that file is tracked and`);
    log('  currently clean.\n');
    return path;
  }

  const tracked = isTracked(dirnameOfThisFile, canonicalPath);
  const statusOutput = porcelainStatus(dirnameOfThisFile, canonicalPath);
  const clean = statusOutput !== null && statusOutput.trim() === '';

  if (!tracked || statusOutput === null || !clean) {
    logError('--write-canonical REFUSED. measure/windows/proof-03-results.json is the repo\'s');
    logError('committed canonical baseline. It is overwritten only when it is BOTH (a) tracked by');
    logError('git and (b) currently clean (no uncommitted diff) for that exact path -- so this');
    logError('run\'s own diff is the only thing `git diff` shows afterward, and no other session\'s');
    logError('in-progress edit to that same file is silently clobbered.');
    // statusOutput === null (git itself unreachable) is checked FIRST and
    // wins over "not tracked": with git gone or this not being a repo,
    // `ls-files` would independently fail too, so the precise, actionable
    // reason is "we could not ask git at all," never a misleading "not
    // tracked" that implies git ran fine and simply said no.
    let reason;
    if (statusOutput === null) {
      logError('Reason: `git status`/`git ls-files` could not be run (git missing, or this is not');
      logError('a git working tree) -- refusing CLOSED rather than assuming clean.');
      reason = 'git-unreadable';
    } else if (!tracked) {
      logError('Reason: that path is not tracked by git.');
      reason = 'untracked';
    } else {
      logError('Reason: that path has an uncommitted diff:');
      logError(statusOutput);
      reason = 'dirty';
    }
    logError('Commit or `git checkout --` your changes to that file first, or drop');
    logError('--write-canonical to write an untracked timestamped copy instead (the default).');
    throw new ReportPathRefusal(reason, `--write-canonical refused: ${reason}`);
  }

  log(`Report destination: ${canonicalPath} (--write-canonical: tracked and clean, overwriting deliberately)\n`);
  return canonicalPath;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is not set on this machine.`);
  return value;
}

/** Reads one value from the RESOLVED `Shell Folders` registry key -- never
 * `User Shell Folders`, which can hold an unexpanded `%VAR%` form on some
 * Windows versions. `Shell Folders` always holds the fully-resolved
 * absolute path Explorer itself uses, already reflecting whatever
 * redirection (GPO, roaming profile relocation, OneDrive Known Folder
 * Move) is currently in effect for this session -- unlike reconstructing
 * the path from `%APPDATA%`/`%ProgramData%` plus a hardcoded
 * `Microsoft\Windows\Start Menu\Programs` suffix, which only reflects
 * redirection of the PARENT profile folder, not a Start-Menu-specific
 * redirect (round-10 blocker finding 1, "preferably also" clause).
 * Returns null on ANY failure -- missing value, `reg.exe` not found, wrong
 * platform, malformed output -- NEVER throws; callers must fall back to
 * env-var reconstruction in that case, not treat null as "this folder
 * does not exist on disk." `spawnImpl` is injectable for tests. */
export function knownFolderFromRegistry(fullKeyPath, valueName, deps = {}) {
  const { spawnImpl = spawnSync } = deps;
  try {
    const proc = spawnImpl('reg', ['query', fullKeyPath, '/v', valueName], { encoding: 'utf8' });
    if (proc.error || proc.status !== 0 || !proc.stdout) return null;
    // `reg query <key> /v <name>` prints one matching line shaped like
    // "    Start Menu    REG_SZ    C:\Users\...\Start Menu" -- find the
    // REG_SZ line and take everything after the type token as the value
    // (a path can itself contain runs of whitespace-adjacent segments, so
    // this deliberately does not split-and-rejoin on whitespace).
    const line = proc.stdout.split(/\r?\n/).find((l) => l.includes('REG_SZ'));
    if (!line) return null;
    const match = line.match(/REG_SZ\s+(.+?)\s*$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Parses repeatable `--scan-root <path>` CLI overrides. Returns an array
 * of paths (order preserved) if at least one was given, else null.
 *
 * This flag exists ONLY to make the `MISSING_SCAN_ROOT` gate (see
 * `walkLnkFiles` above) exercisable end-to-end without needing to break
 * this machine's real Start Menu -- round-10 blocker finding 1 was
 * reproduced by the reviewer via `APPDATA=<bogus-path>`, which no longer
 * relocates the scan roots now that they are resolved from the registry
 * first (see `resolveStartMenuRoots` below); `--scan-root` is the
 * documented replacement lever for exercising the same scenario. When
 * given, it BYPASSES both the registry lookup and the env-var fallback
 * entirely -- the given path(s) are used exactly as given, nothing else
 * is scanned. */
export function parseScanRootOverrides(argv) {
  const roots = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--scan-root') {
      const value = argv[i + 1];
      if (!value) throw new Error('--scan-root requires a path argument');
      roots.push(value);
      i += 1;
    }
  }
  return roots.length > 0 ? roots : null;
}

/** Resolves the two Start Menu \Programs roots to scan (all-users, then
 * per-user, matching this script's original order) via, in order:
 * (1) `--scan-root` CLI overrides, if any (see `parseScanRootOverrides`);
 * (2) the OS known-folder mechanism, read via the `Shell Folders` registry
 *     key (see `knownFolderFromRegistry`), independently per root;
 * (3) for whichever root the registry lookup could not resolve, the
 *     original env-var reconstruction (`%ProgramData%`/`%APPDATA%` +
 *     the standard suffix) as a fallback.
 * Each returned root carries `source` so the run's own output/report is
 * explicit about which mechanism actually produced each path -- never
 * silently either one. */
export function resolveStartMenuRoots(argv, deps = {}) {
  const { regQuery = knownFolderFromRegistry } = deps;

  const overrides = parseScanRootOverrides(argv);
  if (overrides) {
    return overrides.map((path) => ({ path, source: 'cli-override' }));
  }

  const registryCommon = regQuery('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders', 'Common Programs');
  const registryUser = regQuery('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders', 'Programs');

  const common = registryCommon
    ? { path: registryCommon, source: 'registry-known-folder' }
    : { path: join(requireEnv('ProgramData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), source: 'env-var-reconstruction-fallback' };
  const user = registryUser
    ? { path: registryUser, source: 'registry-known-folder' }
    : { path: join(requireEnv('APPDATA'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), source: 'env-var-reconstruction-fallback' };

  return [common, user];
}

function readJsonStrippingBom(path) {
  // Windows PowerShell 5.1's `Out-File -Encoding UTF8` always writes a
  // UTF-8 BOM (unlike pwsh 7's `utf8NoBOM`), which JSON.parse rejects.
  let text = readFileSync(path, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}

/** Resolves `p` via fs.realpathSync.native, distinguishing "does not
 * exist" (ENOENT/ENOTDIR -- expected, silently null, e.g. a shortcut
 * whose target was uninstalled) from every other failure (EACCES/EPERM/
 * etc.), which is recorded as `errorCode` instead of being collapsed
 * into the same null a missing path produces. Without this, a target
 * behind a permission boundary would silently downgrade a resolvable
 * comparison to "mismatch" with no signal as to why. Round-3 minor
 * finding 6. Has no live impact on this machine (0 rows hit this tier in
 * either committed run), but is exercised the moment a comparison
 * reaches the realpath tier on a machine where that's not true. */
function realpathOrNull(p) {
  if (!p) return { value: null, errorCode: null };
  try {
    return { value: realpathSync.native(p).toLowerCase(), errorCode: null };
  } catch (err) {
    const code = err && err.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { value: null, errorCode: null };
    return { value: null, errorCode: code ?? 'UNKNOWN' };
  }
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function stddev(arr) {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}
function stats(arr) {
  return { median: median(arr), min: Math.min(...arr), max: Math.max(...arr), stddev: stddev(arr), raw: arr };
}

/**
 * Tiered comparison of the COM-resolved target against this parser's
 * PRIMARY candidate (parserResolvedTargetPath === candidates[0].value, by
 * construction -- asserted by the caller). Exact -> case-insensitive ->
 * filesystem identity (fs.realpathSync.native) are tried against the
 * primary candidate first; ONLY if none of those match does it fall back
 * to scanning the remaining (secondary/diagnostic) candidates, and a match
 * found there is tagged 'matched-only-via-secondary-candidate' -- a
 * distinct, weaker tier from 'exact', never folded into it. Round-2
 * blocker 1.
 *
 * Exported (not just used internally) so the regression guard in
 * test/windows-lnk-parser.test.mjs can call it directly instead of
 * duplicating this logic.
 */
export function compareTiered(comValue, candidates) {
  // Any non-ENOENT/ENOTDIR realpath failure encountered while comparing is
  // accumulated here and returned to the caller (round-3 minor finding 6)
  // instead of being silently swallowed as an ordinary "no match" null.
  const realpathErrors = [];
  const trackRealpath = (p) => {
    const r = realpathOrNull(p);
    if (r.errorCode) realpathErrors.push({ path: p, errorCode: r.errorCode });
    return r.value;
  };

  if (comValue == null || comValue === '') {
    return { tier: comValue === '' ? 'com-empty' : 'com-null', matchedVia: null, secondaryMatchTier: null, realpathErrors };
  }
  if (candidates.length === 0) {
    return { tier: 'parser-empty', matchedVia: null, secondaryMatchTier: null, realpathErrors };
  }

  const primary = candidates[0];
  const secondary = candidates.slice(1);

  if (primary.value === comValue) return { tier: 'exact', matchedVia: primary.source, secondaryMatchTier: null, realpathErrors };
  if (primary.value.toLowerCase() === comValue.toLowerCase()) {
    return { tier: 'case-insensitive', matchedVia: primary.source, secondaryMatchTier: null, realpathErrors };
  }
  const comReal = trackRealpath(comValue);
  if (comReal) {
    const primaryReal = trackRealpath(primary.value);
    if (primaryReal && primaryReal === comReal) return { tier: 'realpath', matchedVia: primary.source, secondaryMatchTier: null, realpathErrors };
  }

  for (const c of secondary) {
    if (c.value === comValue) return { tier: 'matched-only-via-secondary-candidate', matchedVia: c.source, secondaryMatchTier: 'exact', realpathErrors };
  }
  for (const c of secondary) {
    if (c.value.toLowerCase() === comValue.toLowerCase()) {
      return { tier: 'matched-only-via-secondary-candidate', matchedVia: c.source, secondaryMatchTier: 'case-insensitive', realpathErrors };
    }
  }
  if (comReal) {
    for (const c of secondary) {
      const cReal = trackRealpath(c.value);
      if (cReal && cReal === comReal) return { tier: 'matched-only-via-secondary-candidate', matchedVia: c.source, secondaryMatchTier: 'realpath', realpathErrors };
    }
  }

  return { tier: 'mismatch', matchedVia: null, secondaryMatchTier: null, realpathErrors };
}

/** Reads every file in `files` and parses it, with I/O failures and parser
 * exceptions recorded and counted SEPARATELY from a structural
 * {valid:false} rejection (round-2 major finding 4). Returns a Map path ->
 * parse result (or a synthetic ioError/parserException result). */
function runParserPass(files) {
  const results = new Map();
  const start = process.hrtime.bigint();
  for (const f of files) {
    let buf;
    try {
      buf = readFileSync(f);
    } catch (err) {
      results.set(f, {
        valid: false, rejectReason: null, ioError: `read error: ${err.message}`,
        flags: {}, candidates: [], resolvedTargetPath: null,
        category: { envVar: false, unc: false, msiAdvertised: false, idListOnly: false, noUsablePathSource: false },
      });
      continue;
    }
    let parsed;
    try {
      parsed = parseLnk(buf);
    } catch (err) {
      parsed = {
        valid: false, rejectReason: null,
        parserException: `parser threw unexpectedly (this is a parser bug, not a corrupt-file rejection): ${err.message}`,
        flags: {}, candidates: [], resolvedTargetPath: null,
        category: { envVar: false, unc: false, msiAdvertised: false, idListOnly: false, noUsablePathSource: false },
      };
    }
    results.set(f, parsed);
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { results, ms };
}

/** Runs the COM baseline resolver once over `files`. Returns loop-only ms
 * (from the PowerShell script's own Stopwatch, comparable to the research
 * baseline), wall ms (incl. PowerShell startup), and the per-path result map. */
function runComPass(files) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'decktech-proof03-'));
  const inputPath = join(tmpDir, 'input.json');
  const outputPath = join(tmpDir, 'output.json');
  writeFileSync(inputPath, JSON.stringify(files), 'utf8');

  const psScript = join(__dirname, 'lnk-com-resolve.ps1');
  const wallStart = process.hrtime.bigint();
  const proc = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', psScript,
    '-InputJsonPath', inputPath,
    '-OutputJsonPath', outputPath,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const wallMs = Number(process.hrtime.bigint() - wallStart) / 1e6;

  if (proc.status !== 0) {
    console.error('COM resolver (PowerShell) failed:');
    console.error('stdout:', proc.stdout);
    console.error('stderr:', proc.stderr);
    process.exit(1);
  }

  const comOutput = readJsonStrippingBom(outputPath);
  const resultsByPath = new Map();
  for (const r of comOutput.results) resultsByPath.set(r.path, r);
  return { loopMs: comOutput.elapsedMs, wallMs, resultsByPath };
}

/** Scans raw .lnk bytes (both UTF-16LE and Latin-1 decodings) for the
 * "AppsFolder" / "!App" (AUMID suffix) byte patterns that a UWP/Store
 * shell-item .lnk would carry in its IDList. This is a genuinely
 * reproducible probe backing the "zero UWP .lnk files on this machine"
 * finding -- round-2 minor finding 7 flagged that the ADR asserted this
 * scan's result without it existing anywhere in the committed script.
 *
 * An unreadable file is recorded into `unreadable`/`unreadableRows`
 * instead of being silently skipped -- round-3 major finding 2: the
 * previous version's bare `catch { continue; }` meant an EACCES/EPERM
 * file would vanish from both the numerator AND the printed denominator
 * (files.length), so "0/182" could be printed even when N files were
 * never actually scanned. `scanned` is the count this function actually
 * read, and callers must report hits against THAT denominator, not
 * files.length. */
function scanForUwpMarkers(files) {
  let appsFolderHits = 0;
  let bangAppHits = 0;
  const rows = [];
  const unreadableRows = [];
  for (const f of files) {
    let buf;
    try {
      buf = readFileSync(f);
    } catch (err) {
      unreadableRows.push({ path: f, code: err.code ?? 'UNKNOWN', message: err.message });
      continue;
    }
    const latin1 = buf.toString('latin1');
    const utf16 = buf.toString('utf16le');
    const hasAppsFolder = latin1.includes('AppsFolder') || utf16.includes('AppsFolder');
    const hasBangApp = latin1.includes('!App') || utf16.includes('!App');
    if (hasAppsFolder) appsFolderHits += 1;
    if (hasBangApp) bangAppHits += 1;
    if (hasAppsFolder || hasBangApp) rows.push({ path: f, hasAppsFolder, hasBangApp });
  }
  return {
    appsFolderHits,
    bangAppHits,
    scanned: files.length - unreadableRows.length,
    unreadable: unreadableRows.length,
    unreadableRows,
    rows,
  };
}

async function main() {
  const argv = process.argv.slice(2);

  // Resolved and gated BEFORE the expensive benchmark loop below, so a
  // --write-canonical refusal fails fast (round-9 blocker finding 4).
  // resolveReportPath throws ReportPathRefusal (never calls process.exit
  // itself, round-10 minor finding 3) -- turn that into exit code 1 here,
  // with nothing else run and nothing written, same observable behavior
  // as before this round's refactor.
  let reportPath;
  try {
    reportPath = resolveReportPath(argv, __dirname);
  } catch (err) {
    if (err instanceof ReportPathRefusal) process.exit(1);
    throw err;
  }

  // Scan roots: registry known-folder first, env-var reconstruction
  // fallback per-root, or a `--scan-root` CLI override -- see
  // resolveStartMenuRoots's docblock. Round-10 blocker finding 1.
  const startMenuRoots = resolveStartMenuRoots(argv);
  const startMenuDirs = startMenuRoots.map((r) => r.path);

  const dirErrors = [];
  let files = startMenuDirs.flatMap((d) => walkLnkFiles(d, dirErrors));
  files = Array.from(new Set(files)).sort();

  console.log('=== PROOF-03: Node binary .lnk parser vs COM (WScript.Shell) baseline ===\n');
  console.log('Scanned:');
  for (const r of startMenuRoots) console.log(`  ${r.path}  (source: ${r.source})`);
  console.log(`Enumerated ${files.length} .lnk files.`);
  if (dirErrors.length > 0) {
    console.log(`WARNING: ${dirErrors.length} directory enumeration error(s) -- the scanned set may be UNDER-counted:`);
    for (const e of dirErrors) console.log(`  ${e.dir} -- ${e.code}: ${e.message}`);
  }
  console.log('');

  // --- Timing: 1 cold iteration (kept in its original order: parser
  // before COM), then TIMED_ITERATIONS warm iterations aggregated ---
  let cold = null;
  let canonicalBinResults = null;
  let canonicalComResultsByPath = null;
  const nodeWarmMs = [];
  const comLoopWarmMs = [];

  for (let iter = 0; iter < WARMUP_ITERATIONS + TIMED_ITERATIONS; iter++) {
    const parserPass = runParserPass(files);
    const comPass = runComPass(files);

    if (iter < WARMUP_ITERATIONS) {
      cold = {
        nodeParserMs: parserPass.ms,
        comLoopOnlyMs: comPass.loopMs,
        comWallMs: comPass.wallMs,
      };
      canonicalBinResults = parserPass.results;
      canonicalComResultsByPath = comPass.resultsByPath;
    } else {
      nodeWarmMs.push(parserPass.ms);
      comLoopWarmMs.push(comPass.loopMs);
    }
  }

  const nodeWarmStats = stats(nodeWarmMs);
  const comWarmStats = stats(comLoopWarmMs);
  const speedupRatiosPerIteration = nodeWarmMs.map((n, i) => comLoopWarmMs[i] / n);
  const speedupWarmStats = stats(speedupRatiosPerIteration);
  // No speedup ratio is derived from iteration 0. Round-3 blocker 1: a
  // rigorous re-run split the "cold" pass into two genuinely-fresh runs
  // (nothing had touched the files beforehand) and got a 2.2x speedup on
  // the first and 12.5x on the second, with COM's own loop-only time
  // moving in the OPPOSITE direction between the two runs (310.2ms then
  // 420.4ms) while Node's moved sharply faster (140.72ms then 33.74ms).
  // That is the OS file-cache warming up under repeated runs of the SAME
  // 182 files, not measurement noise -- and it means any single-run
  // "cold speedup" figure, including the 10.2x this script used to print
  // and the previously-claimed 9.5x-10.2x range, was bracketed from
  // outside on both sides by a genuinely-cold run. The mechanism: this
  // iteration runs the Node parser FIRST, so Node absorbs every file's
  // first-touch disk read, and COM then reads a cache Node just warmed --
  // structurally biased in Node's favor, not a fair comparison. See
  // docs/adr/0003, round-3 fix 1.

  console.log('--- Timing: iteration 0 (n=1, first pass; NOT a fair cold-vs-warm comparison -- see note below) ---');
  console.log(`Baseline (research, prior run, different file count AND -- see below -- a total that does not reproduce via the same COM mechanism on this machine; see docs/adr/0003 round-4 finding 1): ${BASELINE_COUNT} shortcuts, ${BASELINE_MS} ms total, ${BASELINE_MS_PER_ITEM.toFixed(2)} ms/shortcut`);
  console.log(`COM loop-only (iteration 0): ${files.length} shortcuts, ${cold.comLoopOnlyMs.toFixed(1)} ms total, ${(cold.comLoopOnlyMs / files.length).toFixed(2)} ms/shortcut`);
  console.log(`COM wall incl. PowerShell startup + COM instantiation (iteration 0): ${cold.comWallMs.toFixed(1)} ms total`);
  console.log(`Node binary parser (iteration 0): ${files.length} shortcuts, ${cold.nodeParserMs.toFixed(2)} ms total, ${(cold.nodeParserMs / files.length).toFixed(4)} ms/shortcut`);
  console.log('NOTE: no speedup ratio is printed for iteration 0. The Node parser runs BEFORE COM in this iteration, so Node absorbs every file\'s first-touch disk read and COM then reads a cache Node just warmed -- structurally biased toward Node, not a like-for-like comparison. A genuinely first-touch run on this machine produced speedups ranging 2.2x-12.5x across two attempts, moving in opposite directions for Node vs COM between runs. Only the warm figures below (n=5, cache already stable) are used as a speedup claim. See docs/adr/0003, round-3 fix 1.\n');

  console.log(`--- Timing: warm (n=${TIMED_ITERATIONS}, after ${WARMUP_ITERATIONS} discarded warmup iteration -- warmup changes the profile, do not compare a cold number against a warm one) ---`);
  console.log(`Node parser: median ${nodeWarmStats.median.toFixed(2)} ms, min ${nodeWarmStats.min.toFixed(2)}, max ${nodeWarmStats.max.toFixed(2)}, stddev ${nodeWarmStats.stddev.toFixed(2)} -- raw: [${nodeWarmMs.map((x) => x.toFixed(2)).join(', ')}]`);
  console.log(`COM loop-only: median ${comWarmStats.median.toFixed(1)} ms, min ${comWarmStats.min.toFixed(1)}, max ${comWarmStats.max.toFixed(1)}, stddev ${comWarmStats.stddev.toFixed(1)} -- raw: [${comLoopWarmMs.map((x) => x.toFixed(1)).join(', ')}]`);
  console.log(`Speedup (median of per-iteration COM/Node ratios): median ${speedupWarmStats.median.toFixed(1)}x, min ${speedupWarmStats.min.toFixed(1)}x, max ${speedupWarmStats.max.toFixed(1)}x`);
  console.log(`Node parser warm median, per-shortcut: ${(nodeWarmStats.median / files.length).toFixed(4)} ms/shortcut`);
  const comWarmMsPerItemMedian = comWarmStats.median / files.length;
  console.log(`COM warm median, per-shortcut: ${comWarmMsPerItemMedian.toFixed(4)} ms/shortcut`);
  console.log(`NOTE (round-4 blocker finding 1): the research baseline's per-item rate is ${BASELINE_MS_PER_ITEM.toFixed(2)} ms/shortcut (${BASELINE_MS} ms / ${BASELINE_COUNT} shortcuts). This run's COM warm median is ${comWarmMsPerItemMedian.toFixed(2)} ms/shortcut over ${files.length} shortcuts, the SAME WScript.Shell mechanism -- a ${(BASELINE_MS_PER_ITEM / comWarmMsPerItemMedian).toFixed(1)}x difference NOT explained by the file-count difference (a larger denominator here would raise COM's TOTAL time, not cut its PER-ITEM rate). The baseline total does not reproduce on this machine; see docs/adr/0003 round-4 finding 1 for the absolute-magnitude implication for PLAT-10.\n`);

  // --- Per-shortcut comparison, from the canonical (cold) iteration's
  // output -- deterministic across iterations for the same file set, so
  // any iteration would produce the same rows. ---
  let comSuccess = 0;
  let comEmptyOrError = 0;
  const tierCounts = {
    exact: 0, 'case-insensitive': 0, realpath: 0,
    'matched-only-via-secondary-candidate': 0,
    mismatch: 0, 'com-empty': 0, 'com-null': 0, 'parser-empty': 0,
  };
  const mismatches = [];
  const secondaryOnlyMatches = [];
  const realpathErrors = [];
  const categoryCensus = { envVar: 0, unc: 0, msiAdvertised: 0, idListOnly: 0, noUsablePathSource: 0, invalidFile: 0, ioError: 0, parserException: 0, extraDataTruncated: 0 };
  const rows = [];
  let forceNoLinkInfoCount = 0;

  for (const f of files) {
    const com = canonicalComResultsByPath.get(f) ?? { targetPath: null, arguments: null, workingDirectory: null, error: 'no COM result' };
    const bin = canonicalBinResults.get(f);

    if (!bin || bin.valid === false) {
      if (bin && bin.ioError) categoryCensus.ioError += 1;
      else if (bin && bin.parserException) categoryCensus.parserException += 1;
      else categoryCensus.invalidFile += 1;
    } else {
      if (bin.category.envVar) categoryCensus.envVar += 1;
      if (bin.category.unc) categoryCensus.unc += 1;
      if (bin.category.msiAdvertised) categoryCensus.msiAdvertised += 1;
      if (bin.category.idListOnly) categoryCensus.idListOnly += 1;
      if (bin.category.noUsablePathSource) categoryCensus.noUsablePathSource += 1;
      if (bin.flags && bin.flags.ForceNoLinkInfo) forceNoLinkInfoCount += 1;
      // extraDataTruncated is intentionally NOT censused here, inside the
      // "bin is valid" branch. It is instead derived after the loop from
      // `rows[].parserExtraDataTruncated` (see below `rows.forEach`/filter),
      // the SAME field the gap-classification filter reads, so the census
      // count can never drift from what actually gates the exit code --
      // the same "derive from one source, don't keep two predicates in
      // sync by hand" fix shape round-3 minor finding 7 used for
      // noUsablePathSource vs idListOnly.
    }

    if (com.error) {
      comEmptyOrError += 1;
    } else if (com.targetPath) {
      comSuccess += 1;
    } else {
      comEmptyOrError += 1;
    }

    const candidates = bin && bin.candidates ? bin.candidates : [];

    // Structural invariant: resolvedTargetPath (what the parser actually
    // resolves a shortcut to) MUST equal candidates[0].value (the primary
    // candidate the comparator below checks first). If this ever diverges,
    // the comparator would silently be checking the wrong value again --
    // exactly the class of defect round-2 blocker 1 found. Fail loudly
    // instead of producing a quietly-wrong headline number.
    if (bin && bin.valid && candidates.length > 0 && bin.resolvedTargetPath !== candidates[0].value) {
      throw new Error(
        `INVARIANT VIOLATION at ${f}: resolvedTargetPath (${JSON.stringify(bin.resolvedTargetPath)}) `
        + `!== candidates[0].value (${JSON.stringify(candidates[0].value)}). lnk-parser.mjs's primary-candidate `
        + 'selection and this benchmark\'s primary-candidate comparison have gone out of sync.',
      );
    }

    const cmp = compareTiered(com.targetPath, candidates);
    tierCounts[cmp.tier] = (tierCounts[cmp.tier] ?? 0) + 1;

    const row = {
      path: f,
      comTargetPath: com.targetPath ?? null,
      comError: com.error ?? null,
      parserValid: bin ? bin.valid : false,
      parserRejectReason: bin ? bin.rejectReason : null,
      parserIoError: bin && bin.ioError ? bin.ioError : null,
      parserException: bin && bin.parserException ? bin.parserException : null,
      parserCandidates: candidates,
      parserResolvedTargetPath: bin ? bin.resolvedTargetPath : null,
      parserFlags: bin ? bin.flags : null,
      parserExtraDataBlockSignatures: bin ? bin.extraDataBlockSignatures ?? null : null,
      parserExtraDataTruncated: bin ? bin.extraDataTruncated ?? null : null,
      category: bin ? bin.category : null,
      comparisonTier: cmp.tier,
      matchedVia: cmp.matchedVia,
      secondaryMatchTier: cmp.secondaryMatchTier,
      realpathErrors: cmp.realpathErrors.length > 0 ? cmp.realpathErrors : null,
    };
    rows.push(row);

    if (cmp.tier === 'mismatch') mismatches.push(row);
    if (cmp.tier === 'matched-only-via-secondary-candidate') secondaryOnlyMatches.push(row);
    if (cmp.realpathErrors.length > 0) {
      for (const e of cmp.realpathErrors) realpathErrors.push({ path: f, ...e });
    }
  }

  if (realpathErrors.length > 0) {
    console.log(`WARNING: ${realpathErrors.length} realpath lookup(s) failed with a non-ENOENT/ENOTDIR error during comparison -- a mismatch on these rows may be caused by an unreadable target, not a wrong path (round-3 minor finding 6):`);
    for (const e of realpathErrors) console.log(`  ${e.path} -- ${e.errorCode}`);
    console.log('');
  }

  // Derived from `rows[].parserExtraDataTruncated` -- the SAME field the
  // gap-classification filter below reads -- rather than censused inside
  // the per-file loop's "bin is valid" branch, so `categoryCensus.
  // extraDataTruncated`/`extraDataTruncatedRows` can never drift from what
  // actually gates the exit code (round-4 minor finding 4, hardened after
  // review: derive from one source, don't keep two predicates in sync by
  // hand -- the same shape round-3 minor finding 7 used).
  const extraDataTruncatedRows = rows
    .filter((r) => r.parserExtraDataTruncated)
    .map((r) => ({ path: r.path, ...r.parserExtraDataTruncated }));
  categoryCensus.extraDataTruncated = extraDataTruncatedRows.length;

  console.log('--- Agreement (against the PARSER\'S PRIMARY output; a match found only via a secondary candidate is its own tier, not folded into exact) ---');
  console.log(`  exact match (primary candidate):        ${tierCounts.exact}`);
  console.log(`  case-insensitive match (primary):       ${tierCounts['case-insensitive']}`);
  console.log(`  same file (realpath) match (primary):   ${tierCounts.realpath}`);
  console.log(`  matched only via secondary candidate:   ${tierCounts['matched-only-via-secondary-candidate']}`);
  console.log(`  MISMATCH (no candidate matches at all): ${tierCounts.mismatch}`);
  console.log(`  COM returned empty string:              ${tierCounts['com-empty']}`);
  console.log(`  COM returned null/no result:            ${tierCounts['com-null']}`);
  console.log(`  parser produced no candidate (COM had one): ${tierCounts['parser-empty']}`);
  console.log(`  COM success rate: ${comSuccess}/${files.length} non-empty TargetPath\n`);

  // idListOnlyGapCount / unexpectedParserEmptyGapCount are derived from the
  // ACTUAL rows (comparisonTier + category), not assumed from a tier count
  // whose only guaranteed property is "candidates.length === 0" for ANY
  // reason (invalid file, I/O error, a future parse failure). Round-2
  // minor finding 8.
  //
  // Classification uses category.noUsablePathSource, NOT category.idListOnly
  // (round-3 minor finding 7): idListOnly is a narrower structural
  // predicate (HasLinkTargetIDList && !HasLinkInfo) that disagrees with
  // what the candidate builder actually does whenever LinkInfo is present
  // but ForceNoLinkInfo'd with no env-var fallback -- that shape reads
  // idListOnly: false while still producing zero candidates, which used to
  // fall through into unexpectedParserEmptyGapCount as an unexplained gap.
  // noUsablePathSource is derived from candidates.length itself, so it
  // cannot drift from what the parser actually resolved.
  // A row whose ExtraData block was itself truncated/corrupt
  // (parserExtraDataTruncated set -- round-4 minor finding 4) is NEVER
  // accepted into the honest noUsablePathSource gap bucket, even when its
  // candidate list is otherwise empty for IDList-only reasons: a corrupt
  // file must not be indistinguishable from a shortcut the parser
  // honestly abstains on. It is always routed into
  // unexpectedParserEmptyGapCount, which DOES gate the exit code.
  const idListOnlyGapRows = rows.filter((r) => r.comparisonTier === 'parser-empty' && r.category && r.category.noUsablePathSource && !r.parserExtraDataTruncated);
  const unexpectedParserEmptyRows = rows.filter((r) => r.comparisonTier === 'parser-empty' && !(r.category && r.category.noUsablePathSource && !r.parserExtraDataTruncated));
  const idListOnlyGapCount = idListOnlyGapRows.length;
  const unexpectedParserEmptyGapCount = unexpectedParserEmptyRows.length;

  console.log('--- Category census (real shortcuts on this machine, explicit zeros are findings) ---');
  console.log(`  Invalid/rejected .lnk (bad header/CLSID/truncated struct): ${categoryCensus.invalidFile}`);
  console.log(`  I/O error (file unreadable, not a parse failure):          ${categoryCensus.ioError}`);
  console.log(`  Parser exception (parser BUG, not a corrupt-file reject):  ${categoryCensus.parserException}`);
  console.log(`  HasExpString (environment-variable target):                ${categoryCensus.envVar}`);
  console.log(`  UNC target (CommonNetworkRelativeLink present):            ${categoryCensus.unc}`);
  console.log(`  HasDarwinID (MSI-advertised shortcut):                     ${categoryCensus.msiAdvertised}`);
  console.log(`  IDList-only, no LinkInfo AT ALL (UWP-shaped .lnk):         ${categoryCensus.idListOnly}`);
  console.log(`  No usable target-path source (gap classification field):  ${categoryCensus.noUsablePathSource}`);
  console.log(`  ForceNoLinkInfo tripped (checked and honored):             ${forceNoLinkInfoCount}`);
  console.log(`  ExtraData block truncated/corrupt (round-4 minor finding 4): ${categoryCensus.extraDataTruncated}`);
  if (categoryCensus.extraDataTruncated > 0) {
    // Printed unconditionally when nonzero, REGARDLESS of whether the row
    // also ended up in unexpectedParserEmptyGapCount below -- a row can
    // have a truncated ExtraData block and STILL produce a candidate from
    // LinkInfo (so it is not parser-empty and does not gate the exit
    // code), and that case must not be invisible just because it isn't a
    // coverage gap.
    console.log(`  WARNING: ${categoryCensus.extraDataTruncated} shortcut(s) have a truncated/corrupt ExtraData block -- see extraDataTruncatedRows in the JSON:`);
    for (const r of extraDataTruncatedRows) {
      console.log(`    ${r.path} -- claimed BlockSize ${r.claimedBlockSize} at offset 0x${r.offset.toString(16)}, file is ${r.bufLength} bytes`);
    }
  }
  if (categoryCensus.idListOnly === 0) {
    console.log('  Zero IDList-only shortcuts is the expected finding for THIS file set (see UWP marker scan below), not a parser gap.');
  } else {
    console.log(`  ${categoryCensus.idListOnly} IDList-only shortcut(s) exist -- this IS the coverage gap documented in docs/adr/0003, not an "expected zero".`);
  }
  if (categoryCensus.noUsablePathSource !== categoryCensus.idListOnly) {
    console.log(`  NOTE: noUsablePathSource (${categoryCensus.noUsablePathSource}) != idListOnly (${categoryCensus.idListOnly}) -- at least one shortcut has LinkInfo present but unusable (ForceNoLinkInfo) with no env-var fallback (round-3 minor finding 7); see rows with category.noUsablePathSource=true, category.idListOnly=false in the JSON.`);
  }
  if (unexpectedParserEmptyGapCount > 0) {
    console.log(`  WARNING: ${unexpectedParserEmptyGapCount} shortcut(s) produced no candidate for a reason OTHER than "no usable target-path source" -- see unexpectedParserEmptyRows in the JSON.`);
  }
  console.log('');

  // --- UWP/Store marker scan: a real, reproducible probe, not an
  // assertion in prose (round-2 minor finding 7). ---
  const uwpScan = scanForUwpMarkers(files);
  console.log('--- UWP/Store shell-item marker scan (raw bytes, both UTF-16LE and Latin-1 decodings) ---');
  if (uwpScan.unreadable > 0) {
    console.log(`WARNING: ${uwpScan.unreadable} .lnk file(s) could not be read for this scan -- the scanned set is UNDER-counted, denominator below is files ACTUALLY READ, not files enumerated:`);
    for (const e of uwpScan.unreadableRows) console.log(`  ${e.path} -- ${e.code}: ${e.message}`);
  }
  console.log(`  "AppsFolder" byte-pattern found in: ${uwpScan.appsFolderHits}/${uwpScan.scanned} .lnk files actually read (${uwpScan.unreadable} unreadable, ${files.length} enumerated)`);
  console.log(`  "!App" (AUMID suffix) byte-pattern found in: ${uwpScan.bangAppHits}/${uwpScan.scanned} .lnk files actually read (${uwpScan.unreadable} unreadable, ${files.length} enumerated)`);
  console.log(uwpScan.appsFolderHits === 0 && uwpScan.bangAppHits === 0
    ? '  Zero hits: consistent with real UWP/Store Start Menu tiles not being .lnk files at all (they resolve through shell:AppsFolder -- PROOF-02\'s scope). This is the expected finding, stated as its own claim, not conflated with the IDList-only census above.'
    : '  Non-zero hits: at least one .lnk on this machine carries a UWP/Store shell-item marker -- see uwpMarkerScan.rows in the JSON report.');
  console.log('');

  if (mismatches.length > 0) {
    console.log(`--- MISMATCHES: shortcuts where NO candidate (primary or secondary) matches COM at all (${mismatches.length}) ---`);
    for (const m of mismatches) {
      console.log(`  ${m.path}`);
      console.log(`    COM targetPath:      ${JSON.stringify(m.comTargetPath)}`);
      console.log(`    parser candidates:   ${JSON.stringify(m.parserCandidates)}`);
      console.log(`    parser rejectReason: ${m.parserRejectReason ?? '(n/a, file parsed)'}`);
    }
    console.log('');
  } else {
    console.log('--- MISMATCHES: none. Every shortcut with a COM result matched at some tier against the PRIMARY candidate, or only via a demoted secondary match (see below). ---\n');
  }

  if (secondaryOnlyMatches.length > 0) {
    console.log(`--- MATCHED-ONLY-VIA-SECONDARY-CANDIDATE: parser's PRIMARY output disagrees with COM, but a lower-priority candidate matches (${secondaryOnlyMatches.length}) ---`);
    for (const m of secondaryOnlyMatches) {
      console.log(`  ${m.path}`);
      console.log(`    COM targetPath:              ${JSON.stringify(m.comTargetPath)}`);
      console.log(`    parser PRIMARY output:       ${JSON.stringify(m.parserResolvedTargetPath)}`);
      console.log(`    matched via (secondary):     ${m.matchedVia} (${m.secondaryMatchTier})`);
    }
    console.log('');
  }

  // Env-var shortcuts get their own explicit section per the task's
  // instruction to show COM value vs raw vs expanded side by side.
  const envVarRows = rows.filter((r) => r.category && r.category.envVar);
  if (envVarRows.length > 0) {
    console.log(`--- Environment-variable shortcuts (${envVarRows.length}): COM vs raw vs expanded (parser's PRIMARY marked with *) ---`);
    for (const r of envVarRows) {
      console.log(`  ${r.path}`);
      console.log(`    COM targetPath: ${JSON.stringify(r.comTargetPath)}`);
      r.parserCandidates.forEach((c, i) => {
        console.log(`    ${(i === 0 ? '*' : ' ')}${c.source.padEnd(16)}: ${JSON.stringify(c.value)}`);
      });
      console.log(`    matched tier: ${r.comparisonTier} via ${r.matchedVia ?? '(none)'}`);
    }
    console.log('');
  } else {
    console.log('--- Environment-variable shortcuts: 0 found on this machine (not exercised). ---\n');
  }

  const uncRows = rows.filter((r) => r.category && r.category.unc);
  console.log(uncRows.length > 0
    ? `--- UNC-target shortcuts: ${uncRows.length} found, see full report JSON for detail. ---\n`
    : '--- UNC-target shortcuts: 0 found on this machine (not exercised). ---\n');

  const msiRows = rows.filter((r) => r.category && r.category.msiAdvertised);
  console.log(msiRows.length > 0
    ? `--- MSI-advertised shortcuts: ${msiRows.length} found, see full report JSON for detail. Not resolved by this parser by design (see module header). ---\n`
    : '--- MSI-advertised shortcuts: 0 found on this machine (not exercised). ---\n');

  // Environment-variable expansion is process.env-dependent (a different
  // machine, service account, or shell session could have different
  // values for %windir%/%ProgramFiles%/etc). Snapshot the actual values
  // of every %VAR% referenced by an env-raw candidate in this run, so a
  // future re-run can tell whether a disagreement is a real regression or
  // just a different environment.
  const envVarNamesReferenced = new Set();
  const envVarPattern = /%([^%]+)%/g;
  for (const r of rows) {
    for (const c of r.parserCandidates) {
      if (c.source === 'env-raw' || c.source === 'env-raw-ansi') {
        let m;
        while ((m = envVarPattern.exec(c.value)) !== null) envVarNamesReferenced.add(m[1]);
      }
    }
  }
  const envSnapshot = {};
  const envKeysByLower = new Map(Object.keys(process.env).map((k) => [k.toLowerCase(), k]));
  for (const name of envVarNamesReferenced) {
    const realKey = envKeysByLower.get(name.toLowerCase());
    envSnapshot[name] = realKey !== undefined ? process.env[realKey] : null;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    startMenuRoots,
    baseline: {
      count: BASELINE_COUNT,
      totalMs: BASELINE_MS,
      msPerItem: BASELINE_MS_PER_ITEM,
      denominatorReconciledWithThisRun: false,
      // Round-4 blocker finding 1: the baseline's headline TOTAL (2395ms)
      // does not reproduce on this machine via the same WScript.Shell
      // mechanism, independently of the 149-vs-182 file-count question
      // above. comWarmMsPerItemMedianThisRun is this run's own measured
      // per-item rate; the ratio below is NOT explained by file count (a
      // larger denominator would raise COM's total, not cut its per-item
      // rate).
      comWarmMsPerItemMedianThisRun: comWarmMsPerItemMedian,
      baselineMsPerItemDividedByThisRunComWarmMsPerItem: BASELINE_MS_PER_ITEM / comWarmMsPerItemMedian,
      baselineTotalReproducedOnThisMachine: false,
    },
    dirErrors,
    thisRun: {
      count: files.length,
      iteration0: {
        note: 'n=1, first pass. NOT a fair cold-vs-warm comparison: this iteration runs the Node parser BEFORE COM (original ordering, kept for continuity), so Node absorbs every first-touch disk read for these files and COM then reads a cache Node just warmed. No speedup ratio is derived from this iteration -- round-3 blocker 1 found the previously-printed 10.2x (and the previously-claimed 9.5x-10.2x range) does not reproduce on a genuinely first-touch run: two fresh attempts on this machine gave 2.2x and 12.5x, moving in opposite directions between runs for Node vs COM. See docs/adr/0003, round-3 fix 1.',
        comLoopOnlyMs: cold.comLoopOnlyMs,
        comWallMs: cold.comWallMs,
        nodeParserMs: cold.nodeParserMs,
      },
      warm: {
        n: TIMED_ITERATIONS,
        warmupIterationsDiscarded: WARMUP_ITERATIONS,
        nodeParserMs: nodeWarmStats,
        nodeParserMsPerItemMedian: nodeWarmStats.median / files.length,
        comLoopOnlyMs: comWarmStats,
        speedupComLoopOverNode: speedupWarmStats,
      },
    },
    agreement: {
      tierCounts,
      comSuccess,
      comEmptyOrError,
      mismatchCount: mismatches.length,
      matchedOnlyViaSecondaryCandidateCount: secondaryOnlyMatches.length,
      idListOnlyGapCount,
      unexpectedParserEmptyGapCount,
      note: `${tierCounts.exact} of ${comSuccess} COM-resolved shortcuts matched exactly on the parser's PRIMARY output. `
        + `${secondaryOnlyMatches.length} matched only via a non-primary candidate (a weaker, separately-counted finding). `
        + `${idListOnlyGapCount} are the honest "no usable target-path source" coverage gap (parser correctly returns no candidate; classified via category.noUsablePathSource, not category.idListOnly -- round-3 minor finding 7). `
        + (unexpectedParserEmptyGapCount > 0
          ? `${unexpectedParserEmptyGapCount} produced no candidate for a reason OTHER than that -- investigate.`
          : 'Zero parser-empty rows outside that gap.'),
    },
    categoryCensus,
    forceNoLinkInfoCount,
    extraDataTruncatedRows,
    realpathErrors,
    uwpMarkerScan: uwpScan,
    envSnapshot,
    rows,
  };

  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Full per-shortcut report written to: ${reportPath}`);
  console.log(`Environment variables referenced by env-var shortcuts, snapshotted for reproducibility: ${JSON.stringify(envSnapshot, null, 2)}`);

  if (mismatches.length > 0) {
    console.log('\nRESULT: parser produced NO matching candidate at all for at least one shortcut -- see MISMATCHES above. This is a real regression.');
  } else if (secondaryOnlyMatches.length > 0) {
    console.log(`\nRESULT: ${secondaryOnlyMatches.length} shortcut(s) only matched via a secondary candidate -- the parser's actual (primary) output disagrees with COM on those. See MATCHED-ONLY-VIA-SECONDARY-CANDIDATE above. This is a real finding, not a pass.`);
  } else if (idListOnlyGapCount > 0 || unexpectedParserEmptyGapCount > 0) {
    console.log(`\nRESULT: zero mismatches, zero secondary-only matches. ${tierCounts.exact} of ${comSuccess} COM-resolved shortcuts matched exactly on the primary output. `
      + `${idListOnlyGapCount} shortcut(s) with no usable target-path source are an honest coverage gap (parser abstains, does not guess)`
      + (unexpectedParserEmptyGapCount > 0 ? `; ${unexpectedParserEmptyGapCount} additional gap(s) are NOT accounted for by that classification and need investigation.` : ' -- PLAT-10 needs a COM/IShellLinkW fallback for these, per docs/adr/0003.'));
  } else {
    console.log('\nRESULT: parser\'s primary output matches COM output for every shortcut COM resolved, with full coverage.');
  }

  // Printed AFTER whichever RESULT branch above fired, regardless of which
  // one -- a scan with directory-enumeration errors (including a missing
  // scan root, round-10 blocker finding 1) can still have zero mismatches
  // among the files it DID manage to enumerate, and that branch's "zero
  // mismatches"/"full coverage" wording must never be read on its own as
  // "this was a complete scan" when it was not. This line does not change
  // the exit-code gate below (dirErrors.length already gates it
  // independently) -- it exists so the text output alone, not just the
  // exit code, makes an incomplete scan impossible to mistake for a clean
  // one.
  if (dirErrors.length > 0) {
    console.log(`RESULT ALSO: this scan is INCOMPLETE -- ${dirErrors.length} directory enumeration error(s) above (see WARNING near the top of this output), so the "RESULT" line above describes only the ${files.length} .lnk file(s) actually enumerated, not the full Start Menu.`);
  }

  // Exit code is decided ONCE, independently of which RESULT branch printed
  // above, from every condition this script treats as a gate failure.
  // idListOnlyGapCount is deliberately NOT one of them: it is the accepted,
  // honestly-scoped coverage gap (8/182 on this machine), and gating on it
  // would make exit 1 the permanent normal state for a clean run instead of
  // a signal something regressed. dirErrors and unexpectedParserEmptyGapCount
  // WERE printed as WARNING/investigate above in round 2 but did not move
  // the exit code -- a half-fix this round closes (round-3 minor finding 5):
  // a permission-denied Start Menu subtree, or a parser-empty row with no
  // IDList/no-usable-source explanation, must not be mistakable for a clean
  // reproduction just because the script happened to exit 0.
  if (
    mismatches.length > 0
    || secondaryOnlyMatches.length > 0
    || dirErrors.length > 0
    || unexpectedParserEmptyGapCount > 0
  ) {
    process.exitCode = 1;
  }
}

// Only run the full benchmark when this file is executed directly (`node
// proof-03-lnk-benchmark.mjs`), not when it is imported -- so
// test/windows-lnk-parser.test.mjs can import `compareTiered` for a
// regression guard without triggering a real Start Menu scan + PowerShell
// spawn as an import side effect.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error('proof-03-lnk-benchmark failed:', err);
    process.exit(1);
  });
}
