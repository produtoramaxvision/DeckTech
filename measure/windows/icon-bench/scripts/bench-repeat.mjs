// Round-3 review fix (finding 4, MAJOR): the ADR's headline table used to
// report each candidate's median to two decimals from a SINGLE invocation of
// bench.mjs. N=222 (111 apps x 2 passes) bounds dispersion WITHIN one
// process's run, not BETWEEN separate invocations — and the round-3 reviewer
// showed, by re-running the documented command three times, that
// between-invocation spread on this machine is several times larger than
// the addon-vs-koffi gap the old table implied was a clean, stable
// difference (their runs: addon 9.89 / 14.60 / 12.04 ms, a ~4.7ms spread,
// while the addon-vs-koffi gap presented was 1.83ms in one run and 0.40ms in
// another).
//
// This script closes that gap by making the repeat a COMMITTED, runnable
// wrapper instead of three manually pasted runs: it invokes
// `node scripts/bench.mjs` K times (K>=3, default 5), snapshots
// results.json's per-candidate medianMs after each run, and reports the
// per-run values, the median-of-medians, and the observed min-max spread —
// so the next reviewer (or the ADR) can requote the SAME command instead of
// re-deriving the methodology.
//
// Usage: node scripts/bench-repeat.mjs [--runs K] [-- <args forwarded to bench.mjs>]
// Example: node scripts/bench-repeat.mjs --runs 5 -- --passes 2 --pool 4
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

const rawArgs = process.argv.slice(2);
const dashIdx = rawArgs.indexOf("--");
const ownArgs = dashIdx >= 0 ? rawArgs.slice(0, dashIdx) : rawArgs;
const forwardedArgs = dashIdx >= 0 ? rawArgs.slice(dashIdx + 1) : [];

function argVal(name, def) {
  const i = ownArgs.indexOf(`--${name}`);
  if (i < 0) return def;
  const n = Number(ownArgs[i + 1]);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    console.error(`[bench-repeat] FATAL: --${name} must be a positive integer, got ${JSON.stringify(ownArgs[i + 1])}`);
    process.exit(1);
  }
  return n;
}
const RUNS = argVal("runs", 5);
if (RUNS < 3) {
  console.error(`[bench-repeat] FATAL: --runs must be >= 3 (a between-invocation spread cannot be characterized from fewer than 3 independent runs), got ${RUNS}`);
  process.exit(1);
}

console.log(`[bench-repeat] running "node scripts/bench.mjs ${forwardedArgs.join(" ")}" ${RUNS} times (each a FRESH process — this is the between-INVOCATION spread, not within-run repetitions)`);

const resultsPath = path.join(rootDir, "results.json");
const perRunMedians = {}; // candidate -> [medianMs, ...]
const perRunFull = [];
// Round-4 review fix (finding 3, minor): the aggregate this script writes
// used to collect ONLY medianMs. The ADR quoted a pool-startup range
// (startupMs) and an aggregate-throughput figure (aggregateThroughputMsPerIcon)
// that lived nowhere in the committed output — a reader had no artifact to
// verify those two numbers against, and per-run snapshots that DID have
// them (.tmp/results-run{1..N}.json) are gitignored, not committed. These
// two extra fields (present on the pwsh candidate) are now collected and
// aggregated the same way medianMs already is.
const EXTRA_FIELDS = ["startupMs", "aggregateThroughputMsPerIcon"];
const perRunExtra = {}; // candidate -> field -> [value, ...]

for (let run = 1; run <= RUNS; run++) {
  console.log(`\n[bench-repeat] === run ${run}/${RUNS} ===`);
  const t0 = performance.now();
  const proc = spawnSync("node", [path.join(__dirname, "bench.mjs"), ...forwardedArgs], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const wallMs = performance.now() - t0;
  if (proc.status !== 0) {
    console.error(`[bench-repeat] FATAL: run ${run} failed (exit ${proc.status})`);
    console.error(proc.stdout);
    console.error(proc.stderr);
    process.exit(1);
  }
  // Surface the child's own per-run summary lines so the operator sees each
  // run's real output, not just this wrapper's aggregate at the end.
  const summaryStart = proc.stdout.indexOf("[bench] === SUMMARY TABLE ===");
  console.log(summaryStart >= 0 ? proc.stdout.slice(summaryStart) : proc.stdout);

  const report = JSON.parse(readFileSync(resultsPath, "utf8"));
  perRunFull.push(report);
  for (const [name, c] of Object.entries(report.candidates)) {
    (perRunMedians[name] ||= []).push(c.medianMs);
    for (const field of EXTRA_FIELDS) {
      if (typeof c[field] === "number") {
        perRunExtra[name] ||= {};
        (perRunExtra[name][field] ||= []).push(c[field]);
      }
    }
  }
  // Snapshot this run's results.json so every individual run's raw output is
  // preserved, not just the aggregate below.
  copyFileSync(resultsPath, path.join(rootDir, ".tmp", `results-run${run}.json`));
  console.log(`[bench-repeat] run ${run} wall time: ${(wallMs / 1000).toFixed(1)}s`);
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

console.log(`\n[bench-repeat] === AGGREGATE ACROSS ${RUNS} INDEPENDENT INVOCATIONS ===`);
console.log("candidate       per-run medians (ms)                    median-of-medians  min-max spread");
const aggregate = {};
for (const [name, medians] of Object.entries(perRunMedians)) {
  const mom = median(medians);
  const lo = Math.min(...medians);
  const hi = Math.max(...medians);
  aggregate[name] = { perRunMedians: medians, medianOfMedians: Number(mom.toFixed(2)), min: lo, max: hi, spread: Number((hi - lo).toFixed(2)) };
  console.log(
    `${name.padEnd(15)} ${medians.map((m) => m.toFixed(2)).join(", ").padEnd(40)} ${mom.toFixed(2).padEnd(18)} ${lo.toFixed(2)}–${hi.toFixed(2)} (${(hi - lo).toFixed(2)})`
  );
  if (perRunExtra[name]) {
    aggregate[name].extra = {};
    for (const [field, values] of Object.entries(perRunExtra[name])) {
      const eLo = Math.min(...values);
      const eHi = Math.max(...values);
      const eMom = median(values);
      aggregate[name].extra[field] = {
        perRun: values,
        medianOfMedians: Number(eMom.toFixed(2)),
        min: eLo,
        max: eHi,
        spread: Number((eHi - eLo).toFixed(2)),
      };
      console.log(
        `  ${name}.${field.padEnd(28)} ${values.map((v) => v.toFixed(2)).join(", ").padEnd(40)} ${eMom.toFixed(2).padEnd(18)} ${eLo.toFixed(2)}–${eHi.toFixed(2)} (${(eHi - eLo).toFixed(2)})`
      );
    }
  }
}

// The finding this closes: is the addon-vs-koffi gap bigger or smaller than
// the between-run spread each candidate shows on its own? Print it plainly
// instead of leaving the reader to do the arithmetic.
if (aggregate.addon && aggregate.koffi) {
  const gap = Math.abs(aggregate.addon.medianOfMedians - aggregate.koffi.medianOfMedians);
  const maxOwnSpread = Math.max(aggregate.addon.spread, aggregate.koffi.spread);
  console.log(
    `\n[bench-repeat] addon-vs-koffi median-of-medians gap: ${gap.toFixed(2)}ms. Largest single candidate's own between-run spread (addon or koffi): ${maxOwnSpread.toFixed(2)}ms. ${
      maxOwnSpread >= gap
        ? "The between-run spread is >= the addon-vs-koffi gap: the two candidates are NOT reliably distinguishable by ms/icon alone at this repeat count."
        : "The addon-vs-koffi gap exceeds the observed between-run spread this time."
    }`
  );
}

const outFile = path.join(rootDir, "bench-repeat-results.json");
writeFileSync(
  outFile,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      runs: RUNS,
      benchArgs: forwardedArgs,
      aggregate,
    },
    null,
    2
  )
);
console.log(`\n[bench-repeat] wrote ${outFile}`);
console.log(`[bench-repeat] the LAST run's results.json (run ${RUNS}) is what's currently at results.json; individual runs are preserved at .tmp/results-run{1..${RUNS}}.json (gitignored, not committed — bench-repeat-results.json above is the committed aggregate).`);
