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

const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
}
const LIMIT = argVal("limit", 0); // 0 = no limit, use full app list
const MEASURE_PASSES = argVal("passes", 2); // full passes over the app list, after 1 discarded warmup pass
const POOL_SIZE = argVal("pool", 4);
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

// -- Independent verification (spot check, not every sample — .NET decode
// is itself slow to spawn repeatedly) ------------------------------------
import { execFileSync } from "node:child_process";
function verifyPngWithDotNet(file) {
  try {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName System.Drawing; $img = [System.Drawing.Image]::FromFile('${file.replace(/'/g, "''")}'); Write-Output "$($img.Width)x$($img.Height)"; $img.Dispose()`,
      ],
      { encoding: "utf8", timeout: 10000 }
    ).trim();
    return out === `${ICON_SIZE}x${ICON_SIZE}`;
  } catch {
    return false;
  }
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
        samples.push(performance.now() - t0);
        failures.push({ app: app.name, error: String(err) });
      }
    }
  }

  await Promise.all(Array.from({ length: pool.size }, (_, slot) => worker(slot)));
  return { samplesMs: samples, successes, failures };
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
  const startup = await pool.start();
  console.log(`[bench] pool startup (spawn ${POOL_SIZE} processes + Add-Type compile in each, until ALL ready): ${startup.startupMs.toFixed(1)}ms total; per-worker: ${startup.perWorkerMs.map((x) => x.toFixed(0)).join(", ")}ms`);

  await runPwshPoolPass(pool); // warmup pass (discarded), pool already warm after this
  let pwshSamples = [];
  let pwshSuccesses = 0;
  let pwshFailures = [];
  let pwshWallMs = [];
  for (let p = 0; p < MEASURE_PASSES; p++) {
    const passT0 = performance.now();
    const r = await runPwshPoolPass(pool);
    const passWall = performance.now() - passT0;
    pwshWallMs.push(passWall);
    pwshSamples.push(...r.samplesMs);
    pwshSuccesses += r.successes;
    pwshFailures.push(...r.failures);
  }
  pool.stop();
  const pwshStats = summarize(pwshSamples);
  const avgPassWall = pwshWallMs.reduce((a, b) => a + b, 0) / pwshWallMs.length;
  const throughputMsPerIcon = avgPassWall / N_APPS;
  console.log(`[bench] pwsh per-request latency: n=${pwshStats.n} median=${pwshStats.medianMs}ms p95=${pwshStats.p95Ms}ms mean=${pwshStats.meanMs}ms success=${pwshSuccesses}/${pwshSamples.length}`);
  console.log(`[bench] pwsh AGGREGATE THROUGHPUT at concurrency=${POOL_SIZE}: ${throughputMsPerIcon.toFixed(2)} ms/icon (wall time for a full ${N_APPS}-app pass / ${N_APPS}, averaged over ${MEASURE_PASSES} passes)`);
  if (pwshFailures.length) console.log(`[bench] pwsh failures (first 5): ${JSON.stringify(pwshFailures.slice(0, 5))}`);
  report.candidates.pwsh = {
    ...pwshStats,
    successRate: pwshSuccesses / pwshSamples.length,
    startupMs: Number(startup.startupMs.toFixed(1)),
    perWorkerStartupMs: startup.perWorkerMs.map((x) => Number(x.toFixed(1))),
    poolSize: POOL_SIZE,
    aggregateThroughputMsPerIcon: Number(throughputMsPerIcon.toFixed(2)),
    note: "median/p95 are PER-REQUEST round-trip latency at concurrency=" + POOL_SIZE + "; aggregateThroughputMsPerIcon is wall-clock/app-count and is the number comparable to a single-icon-at-a-time cost",
  };

  // --- Spot-check independent verification ---
  console.log("\n[bench] === independent verification (spot check via .NET Image decode) ===");
  for (const cand of ["control", "addon", "koffi", "pwsh"]) {
    const sampleFile = path.join(cacheDir, cand, "0.png");
    const ok = verifyPngWithDotNet(sampleFile);
    console.log(`[bench] ${cand} sample #0 independently decodes to ${ICON_SIZE}x${ICON_SIZE}: ${ok}`);
    report.candidates[cand].spotCheckDotNetVerified = ok;
  }

  // --- Baseline comparison ---
  report.measuredBaselineComparison = {
    priorMeasuredIShellItemImageFactoryMsPerIcon: 43.2,
    source: ".maxvision/research/WINDOWS-STACK.md section 6.2 (Windows PowerShell 5.1, 20/20 success)",
  };

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
}

main().catch((err) => {
  console.error("[bench] FATAL:", err);
  process.exit(1);
});
