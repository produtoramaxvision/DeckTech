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
// Timing: iteration 0 runs cold (Node parser first, exactly as originally
// designed, so COM cannot have already warmed the OS file cache before the
// parser's timing is taken) and is reported separately, not averaged in.
// Iterations 1..N are additional warm passes (the OS file cache and
// PowerShell/COM JIT are already warm from iteration 0); their median/
// min/max/stddev is the headline "warm" number. Round-2 major finding 2.
//
// Usage: node measure/windows/proof-03-lnk-benchmark.mjs
// Writes: measure/windows/proof-03-results.json (full per-shortcut report)

import { readdirSync, readFileSync, writeFileSync, mkdtempSync, realpathSync } from 'node:fs';
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
 * Enumerates *.lnk under `root`. A directory that genuinely does not exist
 * (ENOENT) is silently skipped -- expected on a machine without that root.
 * Any OTHER readdir error (EACCES, EPERM, ENOTDIR, EMFILE, ...) is recorded
 * into `dirErrors` instead of being swallowed, so a permission-denied or
 * otherwise-unreadable subtree shrinks the measured set VISIBLY rather than
 * silently. Round-2 major finding 5.
 */
function walkLnkFiles(root, dirErrors) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        dirErrors.push({ dir, code: err.code ?? 'UNKNOWN', message: err.message });
      }
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) out.push(full);
    }
  }
  walk(root);
  return out;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is not set on this machine.`);
  return value;
}

function readJsonStrippingBom(path) {
  // Windows PowerShell 5.1's `Out-File -Encoding UTF8` always writes a
  // UTF-8 BOM (unlike pwsh 7's `utf8NoBOM`), which JSON.parse rejects.
  let text = readFileSync(path, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}

function realpathOrNull(p) {
  if (!p) return null;
  try {
    return realpathSync.native(p).toLowerCase();
  } catch {
    return null;
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
  if (comValue == null || comValue === '') {
    return { tier: comValue === '' ? 'com-empty' : 'com-null', matchedVia: null, secondaryMatchTier: null };
  }
  if (candidates.length === 0) {
    return { tier: 'parser-empty', matchedVia: null, secondaryMatchTier: null };
  }

  const primary = candidates[0];
  const secondary = candidates.slice(1);

  if (primary.value === comValue) return { tier: 'exact', matchedVia: primary.source, secondaryMatchTier: null };
  if (primary.value.toLowerCase() === comValue.toLowerCase()) {
    return { tier: 'case-insensitive', matchedVia: primary.source, secondaryMatchTier: null };
  }
  const comReal = realpathOrNull(comValue);
  if (comReal) {
    const primaryReal = realpathOrNull(primary.value);
    if (primaryReal && primaryReal === comReal) return { tier: 'realpath', matchedVia: primary.source, secondaryMatchTier: null };
  }

  for (const c of secondary) {
    if (c.value === comValue) return { tier: 'matched-only-via-secondary-candidate', matchedVia: c.source, secondaryMatchTier: 'exact' };
  }
  for (const c of secondary) {
    if (c.value.toLowerCase() === comValue.toLowerCase()) {
      return { tier: 'matched-only-via-secondary-candidate', matchedVia: c.source, secondaryMatchTier: 'case-insensitive' };
    }
  }
  if (comReal) {
    for (const c of secondary) {
      const cReal = realpathOrNull(c.value);
      if (cReal && cReal === comReal) return { tier: 'matched-only-via-secondary-candidate', matchedVia: c.source, secondaryMatchTier: 'realpath' };
    }
  }

  return { tier: 'mismatch', matchedVia: null, secondaryMatchTier: null };
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
        category: { envVar: false, unc: false, msiAdvertised: false, idListOnly: false },
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
        category: { envVar: false, unc: false, msiAdvertised: false, idListOnly: false },
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
 * scan's result without it existing anywhere in the committed script. */
function scanForUwpMarkers(files) {
  let appsFolderHits = 0;
  let bangAppHits = 0;
  const rows = [];
  for (const f of files) {
    let buf;
    try {
      buf = readFileSync(f);
    } catch {
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
  return { appsFolderHits, bangAppHits, rows };
}

async function main() {
  const programData = requireEnv('ProgramData');
  const appData = requireEnv('APPDATA');

  const startMenuDirs = [
    join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];

  const dirErrors = [];
  let files = startMenuDirs.flatMap((d) => walkLnkFiles(d, dirErrors));
  files = Array.from(new Set(files)).sort();

  console.log('=== PROOF-03: Node binary .lnk parser vs COM (WScript.Shell) baseline ===\n');
  console.log(`Scanned:\n  ${startMenuDirs[0]}\n  ${startMenuDirs[1]}`);
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
  const speedupCold = cold.comLoopOnlyMs / cold.nodeParserMs;

  console.log('--- Timing: cold (n=1, first pass; Node parser ran BEFORE COM, so COM was not measured on a cold OS file cache in this harness) ---');
  console.log(`Baseline (research, prior run, different file count -- see docs/adr/0003 for the unreconciled 149-vs-${files.length} denominator): ${BASELINE_COUNT} shortcuts, ${BASELINE_MS} ms total, ${BASELINE_MS_PER_ITEM.toFixed(2)} ms/shortcut`);
  console.log(`COM loop-only (cold): ${files.length} shortcuts, ${cold.comLoopOnlyMs.toFixed(1)} ms total, ${(cold.comLoopOnlyMs / files.length).toFixed(2)} ms/shortcut`);
  console.log(`COM wall incl. PowerShell startup + COM instantiation (cold): ${cold.comWallMs.toFixed(1)} ms total`);
  console.log(`Node binary parser (cold): ${files.length} shortcuts, ${cold.nodeParserMs.toFixed(2)} ms total, ${(cold.nodeParserMs / files.length).toFixed(4)} ms/shortcut`);
  console.log(`Speedup (cold, COM loop-only / Node parser): ${speedupCold.toFixed(1)}x\n`);

  console.log(`--- Timing: warm (n=${TIMED_ITERATIONS}, after ${WARMUP_ITERATIONS} discarded warmup iteration -- warmup changes the profile, do not compare a cold number against a warm one) ---`);
  console.log(`Node parser: median ${nodeWarmStats.median.toFixed(2)} ms, min ${nodeWarmStats.min.toFixed(2)}, max ${nodeWarmStats.max.toFixed(2)}, stddev ${nodeWarmStats.stddev.toFixed(2)} -- raw: [${nodeWarmMs.map((x) => x.toFixed(2)).join(', ')}]`);
  console.log(`COM loop-only: median ${comWarmStats.median.toFixed(1)} ms, min ${comWarmStats.min.toFixed(1)}, max ${comWarmStats.max.toFixed(1)}, stddev ${comWarmStats.stddev.toFixed(1)} -- raw: [${comLoopWarmMs.map((x) => x.toFixed(1)).join(', ')}]`);
  console.log(`Speedup (median of per-iteration COM/Node ratios): median ${speedupWarmStats.median.toFixed(1)}x, min ${speedupWarmStats.min.toFixed(1)}x, max ${speedupWarmStats.max.toFixed(1)}x\n`);

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
  const categoryCensus = { envVar: 0, unc: 0, msiAdvertised: 0, idListOnly: 0, invalidFile: 0, ioError: 0, parserException: 0 };
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
      if (bin.flags && bin.flags.ForceNoLinkInfo) forceNoLinkInfoCount += 1;
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
      category: bin ? bin.category : null,
      comparisonTier: cmp.tier,
      matchedVia: cmp.matchedVia,
      secondaryMatchTier: cmp.secondaryMatchTier,
    };
    rows.push(row);

    if (cmp.tier === 'mismatch') mismatches.push(row);
    if (cmp.tier === 'matched-only-via-secondary-candidate') secondaryOnlyMatches.push(row);
  }

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
  const idListOnlyGapRows = rows.filter((r) => r.comparisonTier === 'parser-empty' && r.category && r.category.idListOnly);
  const unexpectedParserEmptyRows = rows.filter((r) => r.comparisonTier === 'parser-empty' && !(r.category && r.category.idListOnly));
  const idListOnlyGapCount = idListOnlyGapRows.length;
  const unexpectedParserEmptyGapCount = unexpectedParserEmptyRows.length;

  console.log('--- Category census (real shortcuts on this machine, explicit zeros are findings) ---');
  console.log(`  Invalid/rejected .lnk (bad header/CLSID/truncated struct): ${categoryCensus.invalidFile}`);
  console.log(`  I/O error (file unreadable, not a parse failure):          ${categoryCensus.ioError}`);
  console.log(`  Parser exception (parser BUG, not a corrupt-file reject):  ${categoryCensus.parserException}`);
  console.log(`  HasExpString (environment-variable target):                ${categoryCensus.envVar}`);
  console.log(`  UNC target (CommonNetworkRelativeLink present):            ${categoryCensus.unc}`);
  console.log(`  HasDarwinID (MSI-advertised shortcut):                     ${categoryCensus.msiAdvertised}`);
  console.log(`  IDList-only, no LinkInfo (UWP-shaped .lnk):                ${categoryCensus.idListOnly}`);
  console.log(`  ForceNoLinkInfo tripped (checked and honored):             ${forceNoLinkInfoCount}`);
  if (categoryCensus.idListOnly === 0) {
    console.log('  Zero IDList-only shortcuts is the expected finding for THIS file set (see UWP marker scan below), not a parser gap.');
  } else {
    console.log(`  ${categoryCensus.idListOnly} IDList-only shortcut(s) exist -- this IS the coverage gap documented in docs/adr/0003, not an "expected zero".`);
  }
  if (unexpectedParserEmptyGapCount > 0) {
    console.log(`  WARNING: ${unexpectedParserEmptyGapCount} shortcut(s) produced no candidate for a reason OTHER than IDList-only -- see unexpectedParserEmptyRows in the JSON.`);
  }
  console.log('');

  // --- UWP/Store marker scan: a real, reproducible probe, not an
  // assertion in prose (round-2 minor finding 7). ---
  const uwpScan = scanForUwpMarkers(files);
  console.log('--- UWP/Store shell-item marker scan (raw bytes, both UTF-16LE and Latin-1 decodings) ---');
  console.log(`  "AppsFolder" byte-pattern found in: ${uwpScan.appsFolderHits}/${files.length} .lnk files`);
  console.log(`  "!App" (AUMID suffix) byte-pattern found in: ${uwpScan.bangAppHits}/${files.length} .lnk files`);
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
    baseline: { count: BASELINE_COUNT, totalMs: BASELINE_MS, msPerItem: BASELINE_MS_PER_ITEM, denominatorReconciledWithThisRun: false },
    dirErrors,
    thisRun: {
      count: files.length,
      cold: {
        note: 'n=1, first pass, Node parser BEFORE COM (original ordering) -- COM was NOT measured on a cold OS file cache in this harness',
        comLoopOnlyMs: cold.comLoopOnlyMs,
        comWallMs: cold.comWallMs,
        nodeParserMs: cold.nodeParserMs,
        speedupComLoopOverNode: speedupCold,
      },
      warm: {
        n: TIMED_ITERATIONS,
        warmupIterationsDiscarded: WARMUP_ITERATIONS,
        nodeParserMs: nodeWarmStats,
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
        + `${idListOnlyGapCount} are the honest IDList-only coverage gap (parser correctly returns no candidate). `
        + (unexpectedParserEmptyGapCount > 0
          ? `${unexpectedParserEmptyGapCount} produced no candidate for a reason OTHER than IDList-only -- investigate.`
          : 'Zero parser-empty rows outside the IDList-only gap.'),
    },
    categoryCensus,
    forceNoLinkInfoCount,
    uwpMarkerScan: uwpScan,
    envSnapshot,
    rows,
  };

  const reportPath = join(__dirname, 'proof-03-results.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Full per-shortcut report written to: ${reportPath}`);
  console.log(`Environment variables referenced by env-var shortcuts, snapshotted for reproducibility: ${JSON.stringify(envSnapshot, null, 2)}`);

  if (mismatches.length > 0) {
    console.log('\nRESULT: parser produced NO matching candidate at all for at least one shortcut -- see MISMATCHES above. This is a real regression.');
    process.exitCode = 1;
  } else if (secondaryOnlyMatches.length > 0) {
    console.log(`\nRESULT: ${secondaryOnlyMatches.length} shortcut(s) only matched via a secondary candidate -- the parser's actual (primary) output disagrees with COM on those. See MATCHED-ONLY-VIA-SECONDARY-CANDIDATE above. This is a real finding, not a pass.`);
    process.exitCode = 1;
  } else if (idListOnlyGapCount > 0 || unexpectedParserEmptyGapCount > 0) {
    console.log(`\nRESULT: zero mismatches, zero secondary-only matches. ${tierCounts.exact} of ${comSuccess} COM-resolved shortcuts matched exactly on the primary output. `
      + `${idListOnlyGapCount} IDList-only shortcuts are an honest coverage gap (parser abstains, does not guess)`
      + (unexpectedParserEmptyGapCount > 0 ? `; ${unexpectedParserEmptyGapCount} additional gap(s) are NOT IDList-only and need investigation.` : ' -- PLAT-10 needs a COM/IShellLinkW fallback for these, per docs/adr/0003.'));
  } else {
    console.log('\nRESULT: parser\'s primary output matches COM output for every shortcut COM resolved, with full coverage.');
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
