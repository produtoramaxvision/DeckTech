// measure/windows/proof-03-lnk-benchmark.mjs
//
// PROOF-03: Validate binary .lnk parsing in Node against the COM baseline.
//
// Enumerates every .lnk under the machine + user Start Menu (the same
// scope .maxvision/research/WINDOWS-STACK.md measured: 182 files), resolves
// each one two ways -- (a) COM WScript.Shell via lnk-com-resolve.ps1, the
// same mechanism that produced the 2395ms/149-shortcut baseline, and
// (b) the pure-Node binary reader in lnk-parser.mjs -- and reports, per
// shortcut, whether the two agree.
//
// Run order is binary parser FIRST, then COM: this means the COM pass
// (which touches every file through PowerShell/COM) cannot have already
// warmed the OS file cache before the Node parser's timing is taken.
//
// Usage: node measure/windows/proof-03-lnk-benchmark.mjs
// Writes: measure/windows/proof-03-results.json (full per-shortcut report)

import { readdirSync, readFileSync, writeFileSync, mkdtempSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { parseLnk } from './lnk-parser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASELINE_MS = 2395;
const BASELINE_COUNT = 149;
const BASELINE_MS_PER_ITEM = BASELINE_MS / BASELINE_COUNT;

function walkLnkFiles(root) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // directory absent on this machine -- not an error
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

/**
 * Tiered comparison between the COM-resolved target and every candidate
 * this parser produced for the same shortcut. Tries exact string equality
 * across all candidates first, then case-insensitive, then filesystem
 * identity (fs.realpathSync.native, which collapses 8.3-vs-long-name and
 * casing differences down to "same file on disk"). Returns the first tier
 * that finds a match, and which candidate matched.
 */
function compareTiered(comValue, candidates) {
  if (comValue == null || comValue === '') {
    return { tier: comValue === '' ? 'com-empty' : 'com-null', matchedVia: null };
  }
  if (candidates.length === 0) {
    return { tier: 'parser-empty', matchedVia: null };
  }

  for (const c of candidates) {
    if (c.value === comValue) return { tier: 'exact', matchedVia: c.source };
  }
  for (const c of candidates) {
    if (c.value.toLowerCase() === comValue.toLowerCase()) return { tier: 'case-insensitive', matchedVia: c.source };
  }
  const comReal = realpathOrNull(comValue);
  if (comReal) {
    for (const c of candidates) {
      const cReal = realpathOrNull(c.value);
      if (cReal && cReal === comReal) return { tier: 'realpath', matchedVia: c.source };
    }
  }
  return { tier: 'mismatch', matchedVia: null };
}

async function main() {
  const programData = requireEnv('ProgramData');
  const appData = requireEnv('APPDATA');

  const startMenuDirs = [
    join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];

  let files = startMenuDirs.flatMap(walkLnkFiles);
  files = Array.from(new Set(files)).sort();

  console.log('=== PROOF-03: Node binary .lnk parser vs COM (WScript.Shell) baseline ===\n');
  console.log(`Scanned:\n  ${startMenuDirs[0]}\n  ${startMenuDirs[1]}`);
  console.log(`Enumerated ${files.length} .lnk files.\n`);

  // --- Pass 1: binary parser (runs FIRST, before COM touches any file) ---
  const parseStart = process.hrtime.bigint();
  const binResults = new Map();
  for (const f of files) {
    try {
      const buf = readFileSync(f);
      binResults.set(f, parseLnk(buf));
    } catch (err) {
      binResults.set(f, { valid: false, rejectReason: `read error: ${err.message}`, candidates: [], resolvedTargetPath: null, category: {} });
    }
  }
  const parseEnd = process.hrtime.bigint();
  const binMs = Number(parseEnd - parseStart) / 1e6;

  // --- Pass 2: COM baseline via lnk-com-resolve.ps1 ---
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
  const wallEnd = process.hrtime.bigint();
  const comWallMs = Number(wallEnd - wallStart) / 1e6;

  if (proc.status !== 0) {
    console.error('COM resolver (PowerShell) failed:');
    console.error('stdout:', proc.stdout);
    console.error('stderr:', proc.stderr);
    process.exit(1);
  }

  const comOutput = readJsonStrippingBom(outputPath);
  const comLoopMs = comOutput.elapsedMs;
  const comResultsByPath = new Map();
  for (const r of comOutput.results) comResultsByPath.set(r.path, r);

  // --- Timing report ---
  console.log('--- Timing (side by side with the measured baseline) ---');
  console.log(`Baseline (research, prior run): ${BASELINE_COUNT} shortcuts, ${BASELINE_MS} ms total, ${BASELINE_MS_PER_ITEM.toFixed(2)} ms/shortcut`);
  console.log(`COM this run (loop-only, comparable to baseline): ${files.length} shortcuts, ${comLoopMs.toFixed(1)} ms total, ${(comLoopMs / files.length).toFixed(2)} ms/shortcut`);
  console.log(`COM this run (wall incl. PowerShell startup + COM instantiation): ${comWallMs.toFixed(1)} ms total`);
  console.log(`Node binary parser this run: ${files.length} shortcuts, ${binMs.toFixed(2)} ms total, ${(binMs / files.length).toFixed(4)} ms/shortcut`);
  console.log(`Speedup (COM loop-only / Node parser): ${(comLoopMs / binMs).toFixed(1)}x\n`);

  // --- Per-shortcut comparison ---
  let comSuccess = 0;
  let comEmptyOrError = 0;
  const tierCounts = { exact: 0, 'case-insensitive': 0, realpath: 0, mismatch: 0, 'com-empty': 0, 'com-null': 0, 'parser-empty': 0 };
  const mismatches = [];
  const categoryCensus = { envVar: 0, unc: 0, msiAdvertised: 0, idListOnly: 0, invalidFile: 0 };
  const rows = [];

  for (const f of files) {
    const com = comResultsByPath.get(f) ?? { targetPath: null, arguments: null, workingDirectory: null, error: 'no COM result' };
    const bin = binResults.get(f);

    if (!bin || bin.valid === false) {
      categoryCensus.invalidFile += 1;
    } else {
      if (bin.category.envVar) categoryCensus.envVar += 1;
      if (bin.category.unc) categoryCensus.unc += 1;
      if (bin.category.msiAdvertised) categoryCensus.msiAdvertised += 1;
      if (bin.category.idListOnly) categoryCensus.idListOnly += 1;
    }

    if (com.error) {
      comEmptyOrError += 1;
    } else if (com.targetPath) {
      comSuccess += 1;
    } else {
      comEmptyOrError += 1;
    }

    const candidates = bin && bin.candidates ? bin.candidates : [];
    const cmp = compareTiered(com.targetPath, candidates);
    tierCounts[cmp.tier] = (tierCounts[cmp.tier] ?? 0) + 1;

    const row = {
      path: f,
      comTargetPath: com.targetPath ?? null,
      comError: com.error ?? null,
      parserValid: bin ? bin.valid : false,
      parserRejectReason: bin ? bin.rejectReason : null,
      parserCandidates: candidates,
      parserResolvedTargetPath: bin ? bin.resolvedTargetPath : null,
      category: bin ? bin.category : null,
      comparisonTier: cmp.tier,
      matchedVia: cmp.matchedVia,
    };
    rows.push(row);

    if (cmp.tier === 'mismatch') mismatches.push(row);
  }

  console.log('--- Agreement (tiered: exact -> case-insensitive -> same file on disk) ---');
  console.log(`  exact match:                ${tierCounts.exact}`);
  console.log(`  case-insensitive match:     ${tierCounts['case-insensitive']}`);
  console.log(`  same file (realpath) match: ${tierCounts.realpath}`);
  console.log(`  MISMATCH (different target):${tierCounts.mismatch}`);
  console.log(`  COM returned empty string:  ${tierCounts['com-empty']}`);
  console.log(`  COM returned null/no result:${tierCounts['com-null']}`);
  console.log(`  parser produced no candidate (COM had one): ${tierCounts['parser-empty']}`);
  console.log(`  COM success rate: ${comSuccess}/${files.length} non-empty TargetPath\n`);

  console.log('--- Category census (real shortcuts on this machine, explicit zeros are findings) ---');
  console.log(`  Invalid/rejected .lnk (bad header/CLSID):      ${categoryCensus.invalidFile}`);
  console.log(`  HasExpString (environment-variable target):    ${categoryCensus.envVar}`);
  console.log(`  UNC target (CommonNetworkRelativeLink present):${categoryCensus.unc}`);
  console.log(`  HasDarwinID (MSI-advertised shortcut):         ${categoryCensus.msiAdvertised}`);
  console.log(`  IDList-only, no LinkInfo (UWP-shaped .lnk):    ${categoryCensus.idListOnly}`);
  console.log('  Note: real UWP/Store app entries in the Start Menu are NOT .lnk files at all');
  console.log('  (they resolve through shell:AppsFolder, owned by PROOF-02) -- a zero count above');
  console.log('  for IDList-only is the expected finding for this file set, not a parser gap.\n');

  if (mismatches.length > 0) {
    console.log(`--- MISMATCHES: every shortcut where COM and the parser disagree (${mismatches.length}) ---`);
    for (const m of mismatches) {
      console.log(`  ${m.path}`);
      console.log(`    COM targetPath:      ${JSON.stringify(m.comTargetPath)}`);
      console.log(`    parser candidates:   ${JSON.stringify(m.parserCandidates)}`);
      console.log(`    parser rejectReason: ${m.parserRejectReason ?? '(n/a, file parsed)'}`);
    }
    console.log('');
  } else {
    console.log('--- MISMATCHES: none. Every shortcut with a COM result matched at some tier. ---\n');
  }

  // Env-var shortcuts get their own explicit section per the task's
  // instruction to show COM value vs raw vs expanded side by side.
  const envVarRows = rows.filter((r) => r.category && r.category.envVar);
  if (envVarRows.length > 0) {
    console.log(`--- Environment-variable shortcuts (${envVarRows.length}): COM vs raw vs expanded ---`);
    for (const r of envVarRows) {
      console.log(`  ${r.path}`);
      console.log(`    COM targetPath: ${JSON.stringify(r.comTargetPath)}`);
      for (const c of r.parserCandidates) {
        console.log(`    ${c.source.padEnd(16)}: ${JSON.stringify(c.value)}`);
      }
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

  const idListOnlyGapCount = tierCounts['parser-empty'];

  const report = {
    generatedAt: new Date().toISOString(),
    baseline: { count: BASELINE_COUNT, totalMs: BASELINE_MS, msPerItem: BASELINE_MS_PER_ITEM },
    thisRun: {
      count: files.length,
      comLoopOnlyMs: comLoopMs,
      comMsPerItem: comLoopMs / files.length,
      comWallMs,
      nodeParserMs: binMs,
      nodeParserMsPerItem: binMs / files.length,
      speedupComLoopOverNode: comLoopMs / binMs,
    },
    agreement: {
      tierCounts,
      comSuccess,
      comEmptyOrError,
      mismatchCount: mismatches.length,
      idListOnlyGapCount,
      note: `${tierCounts.exact} of ${comSuccess} COM-resolved shortcuts matched exactly; ` +
        `the other ${idListOnlyGapCount} are the IDList-only coverage gap (parser correctly ` +
        `returns no candidate, not a wrong answer) -- not full "identical coverage", zero mismatches.`,
    },
    categoryCensus,
    envSnapshot,
    rows,
  };

  const reportPath = join(__dirname, 'proof-03-results.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Full per-shortcut report written to: ${reportPath}`);
  console.log(`Environment variables referenced by env-var shortcuts, snapshotted for reproducibility: ${JSON.stringify(envSnapshot, null, 2)}`);

  if (mismatches.length > 0) {
    console.log('\nRESULT: parser produced a WRONG target for at least one shortcut -- see MISMATCHES above. This is a real regression.');
    process.exitCode = 1;
  } else if (idListOnlyGapCount > 0) {
    console.log(`\nRESULT: zero mismatches. ${tierCounts.exact} of ${comSuccess} COM-resolved shortcuts matched exactly. ` +
      `${idListOnlyGapCount} IDList-only shortcuts are an honest coverage gap (parser abstains, does not guess) -- ` +
      'PLAT-10 needs a COM/IShellLinkW fallback for these, per docs/adr/0003.');
  } else {
    console.log('\nRESULT: parser output matches COM output for every shortcut COM resolved, with full coverage.');
  }
}

main().catch((err) => {
  console.error('proof-03-lnk-benchmark failed:', err);
  process.exit(1);
});
