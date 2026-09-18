// PROOF-01 benchmark: N-API addon vs koffi (FFI) vs pooled PowerShell, all
// three calling the SAME COM interface (IShellItemImageFactory::GetImage)
// against the SAME real, on-disk app set, with a control and repetitions.
//
// Usage: node scripts/bench.mjs [--limit N] [--passes N] [--pool N]
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { extractIconBgra as koffiExtract, comUninitialize } from "../lib/koffi-icon.mjs";
import { encodePng, bgraToRgba } from "../lib/png.mjs";
import { summarize } from "../lib/stats.mjs";
import { PwshPool } from "../lib/pwsh-pool.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

// Round-2 review finding 4 (minor): argVal used to do `Number(args[i+1])`
// with NO validation, so a typo like `--passes abc` silently became NaN, the
// `for (let p = 0; p < NaN; p++)` measurement loops never ran, and the
// script still exited 0 and wrote a results.json full of `null`/`NaN` that
// is indistinguishable downstream from a real result. Fixed: every parsed
// value is checked (finite integer, with the stated bound) and a bad flag
// exits non-zero naming the offending flag AND value, instead of silently
// producing a non-result.
const args = process.argv.slice(2);
function argVal(name, def, { min = -Infinity } = {}) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const raw = args[i + 1];
  if (raw === undefined) {
    console.error(`[bench] FATAL: --${name} was given with no value`);
    process.exit(1);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    console.error(`[bench] FATAL: --${name} must be a finite integer, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  if (n < min) {
    console.error(`[bench] FATAL: --${name} must be >= ${min}, got ${n}`);
    process.exit(1);
  }
  return n;
}
const LIMIT = argVal("limit", 0, { min: 0 }); // 0 = no limit, use full app list
const MEASURE_PASSES = argVal("passes", 2, { min: 1 }); // full passes over the app list, after 1 discarded warmup pass
const POOL_SIZE = argVal("pool", 4, { min: 1 });
const ICON_SIZE = 256;

console.log(`[bench] config: limit=${LIMIT || "none"} measurePasses=${MEASURE_PASSES} poolSize=${POOL_SIZE} iconSize=${ICON_SIZE}`);

// -- Load the shared app list -------------------------------------------
const appsFile = path.join(rootDir, "data", "apps.json");
let appsData;
try {
  appsData = JSON.parse(readFileSync(appsFile, "utf8"));
} catch {
  console.error(`[bench] FATAL: ${appsFile} not found. Run "node scripts/list-apps.mjs" first.`);
  process.exit(1);
}
if (!appsData.hasSpaceInPath) {
  console.error("[bench] FATAL: app list has no path containing a space (Windows path-handling rule). Refusing to benchmark.");
  process.exit(1);
}
let apps = appsData.apps;
if (LIMIT > 0) apps = apps.slice(0, LIMIT);
const N_APPS = apps.length;
console.log(`[bench] app set: ${N_APPS} apps (source: ${appsData.source})`);
console.log(`[bench] at least one path has a space: ${appsData.hasSpaceInPath}`);

// -- Output dirs ----------------------------------------------------------
const cacheDir = path.join(rootDir, ".tmp", "cache");
rmSync(cacheDir, { recursive: true, force: true });
for (const c of ["control", "addon", "koffi", "pwsh"]) {
  mkdirSync(path.join(cacheDir, c), { recursive: true });
}

// -- Sanity: not-blank check (cheap, in-process; avoids spawning a decoder
// per icon while still catching "extraction silently returned garbage") ---
function looksBlank(rgba) {
  // Sample a stride of pixels; if every sampled pixel is byte-identical to
  // the first, treat as suspiciously blank (a real icon has variation).
  const first = rgba.readUInt32LE(0);
  const stride = Math.max(4, Math.floor(rgba.length / 4 / 200) * 4);
  for (let i = 4; i < rgba.length; i += stride) {
    if (rgba.readUInt32LE(i) !== first) return false;
  }
  return true;
}

// -- Candidate runners ----------------------------------------------------
// Each returns { samplesMs: number[], successes: number, failures: {app,error}[] }

function runControlPass() {
  const fixed = Buffer.alloc(ICON_SIZE * ICON_SIZE * 4, 0x7f); // mid-gray opaque, fixed buffer — no real extraction
  const samples = [];
  let successes = 0;
  const failures = [];
  for (let i = 0; i < apps.length; i++) {
    const t0 = performance.now();
    try {
      const png = encodePng(fixed, ICON_SIZE, ICON_SIZE);
      const out = path.join(cacheDir, "control", `${i}.png`);
      writeFileSync(out, png);
      successes++;
    } catch (err) {
      failures.push({ app: apps[i].name, error: err.message });
    }
    samples.push(performance.now() - t0);
  }
  return { samplesMs: samples, successes, failures };
}

function runAddonPass(addon) {
  const samples = [];
  let successes = 0;
  const failures = [];
  for (let i = 0; i < apps.length; i++) {
    const app = apps[i];
    const t0 = performance.now();
    try {
      const bgra = addon.extractIconBgra(app.targetPath, ICON_SIZE);
      const rgba = bgraToRgba(bgra);
      if (looksBlank(rgba)) throw new Error("blank output (sanity check failed)");
      const png = encodePng(rgba, ICON_SIZE, ICON_SIZE);
      writeFileSync(path.join(cacheDir, "addon", `${i}.png`), png);
      successes++;
    } catch (err) {
      failures.push({ app: app.name, error: err.message });
    }
    samples.push(performance.now() - t0);
  }
  return { samplesMs: samples, successes, failures };
}

function runKoffiPass() {
  const samples = [];
  let successes = 0;
  const failures = [];
  for (let i = 0; i < apps.length; i++) {
    const app = apps[i];
    const t0 = performance.now();
    try {
      const { bgra } = koffiExtract(app.targetPath, ICON_SIZE);
      const rgba = bgraToRgba(bgra);
      if (looksBlank(rgba)) throw new Error("blank output (sanity check failed)");
      const png = encodePng(rgba, ICON_SIZE, ICON_SIZE);
      writeFileSync(path.join(cacheDir, "koffi", `${i}.png`), png);
      successes++;
    } catch (err) {
      failures.push({ app: app.name, error: err.message });
    }
    samples.push(performance.now() - t0);
  }
  return { samplesMs: samples, successes, failures };
}

async function runPwshPoolPass(pool) {
  const samples = [];
  let successes = 0;
  const failures = [];
  let timeouts = 0;
  let nextIndex = 0;

  async function worker(slot) {
    while (true) {
      const i = nextIndex++;
      if (i >= apps.length) return;
      const app = apps[i];
      const out = path.join(cacheDir, "pwsh", `${i}.png`);
      const t0 = performance.now();
      try {
        const resp = await pool.worker(slot).request(app.targetPath, out, ICON_SIZE);
        const elapsed = performance.now() - t0;
        samples.push(elapsed);
        if (resp.ok) successes++;
        else failures.push({ app: app.name, error: resp.error });
      } catch (err) {
        // Round-2 review finding 2: a request-level timeout is NOT a latency
        // measurement — it is "we gave up waiting after N ms", an arbitrary
        // threshold, not an observed extraction time. Including it in
        // samplesMs would poison the median/p95 with a number that measures
        // the timeout constant, not the bridge. It still counts as a
        // failure (correctness of the reported success rate depends on
        // that), just excluded from the latency distribution. A non-timeout
        // failure (worker died, explicit error response) DOES keep its
        // elapsed time — that failure was genuinely observed, not given up
        // on.
        if (err && err.name === "PwshTimeoutError") {
          timeouts++;
        } else {
          samples.push(performance.now() - t0);
        }
        failures.push({ app: app.name, error: String(err && err.message ? err.message : err) });
      }
    }
  }

  await Promise.all(Array.from({ length: pool.size }, (_, slot) => worker(slot)));
  return { samplesMs: samples, successes, failures, timeouts };
}

// -- Main -------------------------------------------------------------------
async function main() {
  const report = { generatedAt: new Date().toISOString(), appCount: N_APPS, iconSize: ICON_SIZE, measurePasses: MEASURE_PASSES, poolSize: POOL_SIZE, candidates: {} };

  // --- Cold, bridge-agnostic baseline (measured ONCE, before any candidate
  // touches the app list) --------------------------------------------------
  // Windows caches shell thumbnails/icons (thumbcache) keyed by file, not by
  // which COM bridge asked for them. If candidates ran one after another
  // over the SAME 136 files, whichever ran first would pay a real "cold"
  // cost and every later candidate would look artificially fast purely from
  // OS-level cache warmth — a confound, not a bridge difference. Fix: pay
  // the cold cost exactly once, with one bridge (the addon, arbitrarily,
  // since all three call the identical Win32 API), record it as its own
  // number, then let every candidate's OWN measurement start from an
  // equally-warm cache. This isolates bridge overhead (marshaling, IPC,
  // process model) as the actual discriminator between candidates, and
  // still yields one honest cold-cache number to compare against the
  // previously measured 43.2 ms/icon baseline.
  console.log("\n[bench] === cold baseline (bridge-agnostic first-exposure cost, measured once via addon before any candidate loop) ===");
  const addonForColdT0 = performance.now();
  const addonForCold = require(path.join(rootDir, "addon-icon", "build", "Release", "iconaddon.node"));
  const addonModuleLoadMs = performance.now() - addonForColdT0;
  const coldPass = runAddonPass(addonForCold);
  const coldStats = summarize(coldPass.samplesMs);
  console.log(`[bench] cold baseline: n=${coldStats.n} median=${coldStats.medianMs}ms p95=${coldStats.p95Ms}ms mean=${coldStats.meanMs}ms success=${coldPass.successes}/${coldPass.samplesMs.length}`);
  console.log("[bench] shell icon cache is now warm for all apps in the list; candidate measurements below compare BRIDGE OVERHEAD on a level cache, not cold-cache variance");
  report.coldBaseline = { ...coldStats, successRate: coldPass.successes / coldPass.samplesMs.length, addonModuleLoadMs: Number(addonModuleLoadMs.toFixed(1)), note: "bridge-agnostic: measured with the N-API addon exactly once, before any candidate loop, because Windows' thumbcache is keyed by file not by bridge" };

  // --- Control ---
  console.log("\n[bench] === control (harness overhead: loop + PNG encode + fs write, fixed buffer, no real extraction) ===");
  runControlPass(); // warmup (discarded)
  let controlSamples = [];
  let controlSuccesses = 0;
  for (let p = 0; p < MEASURE_PASSES; p++) {
    const r = runControlPass();
    controlSamples.push(...r.samplesMs);
    controlSuccesses += r.successes;
  }
  const controlStats = summarize(controlSamples);
  console.log(`[bench] control: n=${controlStats.n} median=${controlStats.medianMs}ms p95=${controlStats.p95Ms}ms mean=${controlStats.meanMs}ms success=${controlSuccesses}/${controlSamples.length}`);
  report.candidates.control = { ...controlStats, successRate: controlSuccesses / controlSamples.length, startupMs: 0, note: "harness overhead baseline: no real icon extraction, fixed buffer" };

  // --- N-API addon ---
  // Module already loaded above (for the cold baseline); reuse it so this
  // phase measures steady-state per-icon cost only, on a warm shell cache.
  console.log("\n[bench] === N-API addon (in-process, compiled against real Windows SDK headers) ===");
  const addon = addonForCold;
  runAddonPass(addon); // warmup (discarded; primes V8 JIT for this loop shape)
  let addonSamples = [];
  let addonSuccesses = 0;
  let addonFailures = [];
  for (let p = 0; p < MEASURE_PASSES; p++) {
    const r = runAddonPass(addon);
    addonSamples.push(...r.samplesMs);
    addonSuccesses += r.successes;
    addonFailures.push(...r.failures);
  }
  const addonStats = summarize(addonSamples);
  console.log(`[bench] addon: n=${addonStats.n} median=${addonStats.medianMs}ms p95=${addonStats.p95Ms}ms mean=${addonStats.meanMs}ms success=${addonSuccesses}/${addonSamples.length}`);
  if (addonFailures.length) console.log(`[bench] addon failures (first 5): ${JSON.stringify(addonFailures.slice(0, 5))}`);
  report.candidates.addon = { ...addonStats, successRate: addonSuccesses / addonSamples.length, startupMs: Number(addonModuleLoadMs.toFixed(1)), note: "in-process N-API; startupMs is one-time module load (measured during the cold-baseline phase above); per-icon stats here are warm-cache steady-state" };

  // --- koffi ---
  console.log("\n[bench] === koffi FFI (in-process, hand-decoded COM vtable) ===");
  const koffiLoadT0 = performance.now();
  koffiExtract(apps[0].targetPath, ICON_SIZE); // first call pays koffi's internal lib-load + CoInitializeEx cost
  const koffiLoadMs = performance.now() - koffiLoadT0;
  console.log(`[bench] koffi first-call cost (dll load + CoInitializeEx + 1 extraction): ${koffiLoadMs.toFixed(1)}ms (one-time-ish, included informationally; NOT subtracted from steady-state below)`);
  runKoffiPass(); // warmup (full pass, discarded)
  let koffiSamples = [];
  let koffiSuccesses = 0;
  let koffiFailures = [];
  for (let p = 0; p < MEASURE_PASSES; p++) {
    const r = runKoffiPass();
    koffiSamples.push(...r.samplesMs);
    koffiSuccesses += r.successes;
    koffiFailures.push(...r.failures);
  }
  const koffiStats = summarize(koffiSamples);
  console.log(`[bench] koffi: n=${koffiStats.n} median=${koffiStats.medianMs}ms p95=${koffiStats.p95Ms}ms mean=${koffiStats.meanMs}ms success=${koffiSuccesses}/${koffiSamples.length}`);
  if (koffiFailures.length) console.log(`[bench] koffi failures (first 5): ${JSON.stringify(koffiFailures.slice(0, 5))}`);
  report.candidates.koffi = { ...koffiStats, successRate: koffiSuccesses / koffiSamples.length, startupMs: Number(koffiLoadMs.toFixed(1)), note: "in-process koffi FFI, dll-load+CoInitializeEx+first-call cost measured separately" };
  comUninitialize();

  // --- pooled PowerShell ---
  console.log(`\n[bench] === pooled PowerShell (pool size=${POOL_SIZE}, concurrent dispatch) ===`);
  const scriptPath = path.join(rootDir, "pwsh", "worker.ps1");
  const pool = new PwshPool(scriptPath, POOL_SIZE);
  let startup;
  try {
    startup = await pool.start();
  } catch (err) {
    // Round-2 review finding 2: pool.start() can now REJECT (bad script
    // path, worker crash before READY) instead of hanging forever. Report
    // it as a real failure, not a silent hang.
    console.error(`[bench] FATAL: pwsh pool failed to start: ${err.message}`);
    process.exit(1);
  }
  console.log(`[bench] pool startup (spawn ${POOL_SIZE} processes + Add-Type compile in each, until ALL ready): ${startup.startupMs.toFixed(1)}ms total; per-worker: ${startup.perWorkerMs.map((x) => x.toFixed(0)).join(", ")}ms`);

  await runPwshPoolPass(pool); // warmup pass (discarded), pool already warm after this
  let pwshSamples = [];
  let pwshSuccesses = 0;
  let pwshFailures = [];
  let pwshTimeouts = 0;
  let pwshWallMs = [];
  for (let p = 0; p < MEASURE_PASSES; p++) {
    const passT0 = performance.now();
    const r = await runPwshPoolPass(pool);
    const passWall = performance.now() - passT0;
    pwshWallMs.push(passWall);
    pwshSamples.push(...r.samplesMs);
    pwshSuccesses += r.successes;
    pwshFailures.push(...r.failures);
    pwshTimeouts += r.timeouts;
  }
  pool.stop();
  const pwshStats = summarize(pwshSamples);
  const avgPassWall = pwshWallMs.reduce((a, b) => a + b, 0) / pwshWallMs.length;
  const throughputMsPerIcon = avgPassWall / N_APPS;
  // successRate's denominator is TOTAL ATTEMPTS (successes + failures,
  // including timeouts) — NOT pwshSamples.length, because timeouts are
  // deliberately excluded from the latency samples (see runPwshPoolPass)
  // but must still count against success rate, or a hung/timed-out request
  // would silently vanish from BOTH the latency stats and the denominator
  // and "success rate" would look better than what actually happened.
  const pwshTotalAttempts = pwshSuccesses + pwshFailures.length;
  const pwshSuccessRate = pwshSuccesses / pwshTotalAttempts;
  console.log(`[bench] pwsh per-request latency: n=${pwshStats.n} median=${pwshStats.medianMs}ms p95=${pwshStats.p95Ms}ms mean=${pwshStats.meanMs}ms success=${pwshSuccesses}/${pwshTotalAttempts} (successRate=${(pwshSuccessRate * 100).toFixed(1)}%, timeouts=${pwshTimeouts})`);
  console.log(`[bench] pwsh AGGREGATE THROUGHPUT at concurrency=${POOL_SIZE}: ${throughputMsPerIcon.toFixed(2)} ms/icon (wall time for a full ${N_APPS}-app pass / ${N_APPS}, averaged over ${MEASURE_PASSES} passes)`);
  if (pwshFailures.length) console.log(`[bench] pwsh failures (first 5): ${JSON.stringify(pwshFailures.slice(0, 5))}`);
  report.candidates.pwsh = {
    ...pwshStats,
    successRate: pwshSuccessRate,
    totalAttempts: pwshTotalAttempts,
    timeouts: pwshTimeouts,
    startupMs: Number(startup.startupMs.toFixed(1)),
    perWorkerStartupMs: startup.perWorkerMs.map((x) => Number(x.toFixed(1))),
    poolSize: POOL_SIZE,
    aggregateThroughputMsPerIcon: Number(throughputMsPerIcon.toFixed(2)),
    note: "median/p95 are PER-REQUEST round-trip latency at concurrency=" + POOL_SIZE + ", EXCLUDING timed-out requests (a timeout measures the timeout constant, not the bridge); successRate's denominator is total attempts (successes+failures incl. timeouts), not sample count; aggregateThroughputMsPerIcon is wall-clock/app-count and is the number comparable to a single-icon-at-a-time cost",
  };

  // NOTE on independent verification (round-2 review finding 1, blocker):
  // this file used to do a "spot check" here that compared the PNG's
  // decoded dimensions against ICON_SIZE — the SAME constant the harness
  // itself passed into encodePng() a few lines above when it wrote that
  // exact file. That compares an input to itself; it certifies nothing and
  // cannot fail, which is why it printed "true" for all four candidates even
  // in a run that measured zero real samples. It has been REMOVED from this
  // file rather than patched in place. Real, harness-independent
  // verification (cross-bridge PIXEL agreement across all N apps, plus
  // properties the harness cannot fake: alpha-channel variance, a content
  // bounding box that fills the frame) now lives in its own post-pass
  // script, run after this one: `node scripts/verify.mjs`. See that file for
  // exactly what is checked, on how many samples, and what class of error it
  // cannot catch (documented at the top of verify.mjs and restated in the
  // ADR).

  // --- Baseline comparison ---
  report.measuredBaselineComparison = {
    priorMeasuredIShellItemImageFactoryMsPerIcon: 43.2,
    source: ".maxvision/research/WINDOWS-STACK.md section 6.2 (Windows PowerShell 5.1, 20/20 success)",
  };

  // Round-2 review finding 4: refuse to write a results.json that looks like
  // a real result but isn't — if any candidate collected zero samples
  // (e.g. every pass was skipped because of an earlier bad-but-unvalidated
  // argument, or every request failed/hung), that is a harness failure, not
  // a benchmark outcome, and must not be written as if it were one.
  const zeroSampleCandidates = Object.entries(report.candidates)
    .filter(([, c]) => c.n === 0)
    .map(([name]) => name);
  if (zeroSampleCandidates.length > 0) {
    console.error(`[bench] FATAL: refusing to write results.json — candidate(s) with zero samples: ${zeroSampleCandidates.join(", ")}`);
    process.exit(1);
  }

  const outFile = path.join(rootDir, "results.json");
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\n[bench] wrote full results to ${outFile}`);

  console.log("\n[bench] === SUMMARY TABLE ===");
  console.log("candidate       n     median(ms)  p95(ms)  success%   startup(ms)");
  for (const [name, c] of Object.entries(report.candidates)) {
    const startupStr = c.startupMs !== undefined ? c.startupMs.toFixed(0) : "-";
    console.log(
      `${name.padEnd(15)} ${String(c.n).padEnd(5)} ${String(c.medianMs).padEnd(11)} ${String(c.p95Ms).padEnd(8)} ${(c.successRate * 100).toFixed(1).padEnd(10)} ${startupStr}`
    );
  }
  // Success criteria (PROOF-01): "prints ms/icon and success rate for each
  // candidate against the measured 43.2 ms/icon IShellItemImageFactory
  // baseline". report.measuredBaselineComparison already carries this; this
  // line is what actually PRINTS it, closing the gap between "written to
  // results.json" and "printed" that the criteria literally asks for.
  console.log(
    `[bench] baseline comparison: prior measured IShellItemImageFactory cost = ${report.measuredBaselineComparison.priorMeasuredIShellItemImageFactoryMsPerIcon} ms/icon (${report.measuredBaselineComparison.source})`
  );
}

main().catch((err) => {
  console.error("[bench] FATAL:", err);
  process.exit(1);
});
