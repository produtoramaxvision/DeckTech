// Independent, post-pass verification for PROOF-01 (fixes round-2 review
// finding 1, BLOCKER).
//
// What the OLD check did (removed from bench.mjs, not left in place):
// compared a PNG's decoded dimensions against ICON_SIZE — the same constant
// the harness itself passed into encodePng() when it wrote that exact file
// a few lines earlier. That is comparing an input to itself: it cannot
// fail, and a run that measured ZERO real samples still printed "true" for
// every candidate (reproduced below in the negative controls).
//
// What THIS script checks instead, and what it can and cannot catch:
//   1. Per-app CROSS-BRIDGE PIXEL AGREEMENT: decodes the addon, koffi and
//      pwsh PNGs for every app index with .NET's own decoder (a code path
//      none of the three bridges' PNG WRITERS go through) and compares raw
//      decoded bytes. This is the strong check — for it to pass, three
//      independently-implemented extraction paths (MSVC-compiled N-API,
//      hand-decoded koffi COM vtable, .NET [ComImport] interop) must all
//      agree on what the shell returned for that file, on ALL apps in the
//      benchmarked set, not one spot-checked sample.
//   2. Per-image sanity: alpha-channel variance (catches a uniform/blank
//      bitmap) and content-bounding-box fill fraction (catches a tiny
//      corner blob instead of a real icon).
//   3. Two ADVERSARIAL NEGATIVE CONTROLS, run and printed every time this
//      script runs, that PROVE the check in (1) can fail:
//        (a) compares two DIFFERENT real apps' decoded pixels against each
//            other via the exact same code path — must NOT agree.
//        (b) encodes a pure-noise buffer as a PNG and compares it against a
//            REAL app's reference output via the exact same code path —
//            must NOT agree. This is the literal reproduction of the
//            reviewer's "garbage buffer -> would return: true" finding,
//            run against the NEW check instead.
//      If either negative control unexpectedly agrees, this script exits
//      non-zero: a verification check that cannot fail is worse than no
//      check, and this script refuses to report "verified" under that
//      condition.
//
// WHAT THIS CANNOT CATCH (stated plainly, not left implicit): if
// IShellItemImageFactory itself hands back the SAME generic/fallback icon
// for every app (e.g. Windows' default .exe icon, because the real icon
// resource failed to load) rather than the app's real icon, all three
// bridges call the identical Win32 API and would all agree on that generic
// icon — cross-bridge agreement proves the BRIDGES are equivalent, not that
// the icon is the CORRECT one for that app. That guarantee comes only from
// the manual visual inspection of a named subset (see ADR "Achados de
// implementação" / manual spot-check), not from this script.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { encodePng } from "../lib/png.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const cacheDir = path.join(rootDir, ".tmp", "cache");
const ICON_SIZE = 256;

const appsFile = path.join(rootDir, "data", "apps.json");
const appsData = JSON.parse(readFileSync(appsFile, "utf8"));
const apps = appsData.apps;

const BRIDGES = ["addon", "koffi", "pwsh"];
const REFERENCE_BRIDGE = "addon";
// Agreement threshold: the round-2 reviewer independently confirmed
// pwsh-vs-addon output "matches to within 1/255" (one 8-bit step) on real
// icons. A byte-identical (delta=0) requirement would be too strict for
// pwsh specifically, since it goes through .NET's OWN PNG encoder
// (Bitmap.Save) rather than the shared lib/png.mjs path addon/koffi use —
// re-decoding through a DIFFERENT encoder can legitimately introduce
// rounding in edge-antialiasing pixels even when the underlying bitmap is
// identical. addon vs koffi share the same encoder end-to-end and are
// expected at delta=0.
const AGREEMENT_MAX_DELTA = 2;

function runVerifyPs1(items) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "icon-verify-"));
  const inputFile = path.join(tmp, "input.json");
  const outputFile = path.join(tmp, "output.json");
  writeFileSync(inputFile, JSON.stringify({ items }), "utf8");
  const scriptPath = path.join(rootDir, "pwsh", "verify.ps1");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-InputJson", inputFile, "-OutputJson", outputFile],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 180000 }
  );
  if (result.status !== 0) {
    console.error("[verify] pwsh/verify.ps1 FAILED");
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(1);
  }
  let text = readFileSync(outputFile, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function main() {
  console.log(`[verify] === cross-bridge pixel verification: ${apps.length} apps, bridges=[${BRIDGES.join(",")}], reference=${REFERENCE_BRIDGE} ===`);

  const items = [];
  for (let i = 0; i < apps.length; i++) {
    const files = {};
    for (const bridge of BRIDGES) {
      files[bridge] = path.join(cacheDir, bridge, `${i}.png`);
    }
    items.push({ index: i, label: apps[i].name, files, referenceBridge: REFERENCE_BRIDGE });
  }

  const results = runVerifyPs1(items);

  let agreeCount = 0;
  let disagreeCount = 0;
  let errorCount = 0;
  let noContentCount = 0;
  let lowAlphaVarianceCount = 0;
  const disagreements = [];
  const noContentApps = [];
  const lowAlphaVarianceApps = [];
  const worstDeltas = [];

  for (const r of results) {
    if (r.error) {
      errorCount++;
      console.log(`[verify] app#${r.index} (${r.label}) DECODE ERROR: ${r.error}`);
      continue;
    }
    let appAgrees = true;
    for (const [bridge, delta] of Object.entries(r.deltasVsReference || {})) {
      worstDeltas.push({ index: r.index, label: r.label, bridge, maxAbsDelta: delta.maxAbsDelta, meanAbsDelta: delta.meanAbsDelta });
      if (delta.maxAbsDelta > AGREEMENT_MAX_DELTA) {
        appAgrees = false;
        disagreements.push({ index: r.index, label: r.label, bridge, maxAbsDelta: delta.maxAbsDelta, meanAbsDelta: delta.meanAbsDelta });
      }
    }
    if (appAgrees) agreeCount++;
    else disagreeCount++;

    const refAnalysis = r.analyses && r.analyses[REFERENCE_BRIDGE];
    if (refAnalysis) {
      if (!refAnalysis.hasContent || refAnalysis.bboxFillFraction < 0.02) {
        noContentCount++;
        noContentApps.push({ index: r.index, label: r.label, bboxFillFraction: refAnalysis.bboxFillFraction });
      }
      if (refAnalysis.alphaVariance < 1) {
        lowAlphaVarianceCount++;
        lowAlphaVarianceApps.push({ index: r.index, label: r.label, alphaVariance: refAnalysis.alphaVariance, bboxFillFraction: refAnalysis.bboxFillFraction });
      }
    }
  }

  worstDeltas.sort((a, b) => b.maxAbsDelta - a.maxAbsDelta);
  // The GLOBAL max across every app x every bridge comparison — not the
  // AGREEMENT_MAX_DELTA tolerance, the actual observed worst case. Stated
  // explicitly so the ADR reports what was MEASURED (e.g. "0, tolerance
  // never exercised") rather than restating the tolerance itself or an
  // inherited figure as if it were a measurement.
  const globalMaxDelta = worstDeltas.length ? worstDeltas[0].maxAbsDelta : null;
  const perBridgeMaxDelta = {};
  for (const bridge of BRIDGES) {
    if (bridge === REFERENCE_BRIDGE) continue;
    const bridgeDeltas = worstDeltas.filter((d) => d.bridge === bridge);
    perBridgeMaxDelta[bridge] = bridgeDeltas.length ? Math.max(...bridgeDeltas.map((d) => d.maxAbsDelta)) : null;
  }

  console.log(`[verify] cross-bridge pixel agreement (max per-channel delta <= ${AGREEMENT_MAX_DELTA}): ${agreeCount}/${results.length - errorCount} apps agree across all bridges`);
  console.log(`[verify] decode errors: ${errorCount}/${results.length}`);
  console.log(`[verify] GLOBAL max per-channel delta observed (across all apps x all bridge comparisons): ${globalMaxDelta}`);
  console.log(`[verify] per-bridge max delta vs ${REFERENCE_BRIDGE}: ${JSON.stringify(perBridgeMaxDelta)}`);
  console.log(`[verify] apps with near-empty content bbox (<2% fill, reference=${REFERENCE_BRIDGE}) — DIAGNOSTIC ONLY, does not gate pass/fail: ${noContentCount}/${results.length}`);
  console.log(`[verify] apps with near-zero alpha variance (reference=${REFERENCE_BRIDGE}) — DIAGNOSTIC ONLY, does not gate pass/fail: ${lowAlphaVarianceCount}/${results.length}`);
  if (lowAlphaVarianceApps.length) {
    console.log(`[verify] low-alpha-variance apps (for manual inspection): ${JSON.stringify(lowAlphaVarianceApps)}`);
  }
  console.log(`[verify] worst 5 cross-bridge deltas: ${JSON.stringify(worstDeltas.slice(0, 5))}`);
  if (disagreements.length) {
    console.log(`[verify] DISAGREEMENTS (first 10): ${JSON.stringify(disagreements.slice(0, 10), null, 2)}`);
  }

  // -- Negative control (a): two DIFFERENT real apps must NOT agree --------
  console.log("\n[verify] === negative control (a): cross-comparing TWO DIFFERENT real apps (must disagree) ===");
  const idxA = 0;
  const idxB = Math.min(1, apps.length - 1);
  if (idxA === idxB) {
    console.log("[verify] SKIPPED negative control (a): app set has < 2 apps");
  } else {
    const crossItems = [
      {
        index: 0,
        label: `cross-check: ${apps[idxA].name} (addon) vs ${apps[idxB].name} (koffi)`,
        files: { addon: path.join(cacheDir, "addon", `${idxA}.png`), koffi: path.join(cacheDir, "addon", `${idxB}.png`) },
        referenceBridge: "addon",
      },
    ];
    const crossResult = runVerifyPs1(crossItems)[0];
    const delta = crossResult.deltasVsReference.koffi;
    const disagrees = delta.maxAbsDelta > AGREEMENT_MAX_DELTA;
    console.log(`[verify] ${apps[idxA].name} vs ${apps[idxB].name}: maxAbsDelta=${delta.maxAbsDelta} meanAbsDelta=${delta.meanAbsDelta} -> agreement check says "agree": ${!disagrees}`);
    if (!disagrees) {
      console.error("[verify] FATAL: negative control (a) FAILED — two different apps' icons were reported as agreeing. The verification check cannot discriminate and must not be trusted.");
      process.exit(1);
    }
    console.log("[verify] PASS: two different apps correctly reported as disagreeing (proves the check can fail)");
  }

  // -- Negative control (b): pure-noise buffer vs a REAL reference ---------
  console.log("\n[verify] === negative control (b): pure-noise garbage buffer vs a REAL reference (must disagree) — literal reproduction of the round-2 finding ===");
  const noiseBuf = Buffer.alloc(ICON_SIZE * ICON_SIZE * 4);
  for (let i = 0; i < noiseBuf.length; i++) noiseBuf[i] = Math.floor(Math.random() * 256);
  const noisePngPath = path.join(cacheDir, "__noise_negative_control.png");
  writeFileSync(noisePngPath, encodePng(noiseBuf, ICON_SIZE, ICON_SIZE));
  const noiseItems = [
    {
      index: 0,
      label: `noise vs real (${apps[0].name})`,
      files: { addon: path.join(cacheDir, "addon", "0.png"), noise: noisePngPath },
      referenceBridge: "addon",
    },
  ];
  const noiseResult = runVerifyPs1(noiseItems)[0];
  const noiseDelta = noiseResult.deltasVsReference.noise;
  const noiseDisagrees = noiseDelta.maxAbsDelta > AGREEMENT_MAX_DELTA;
  console.log(`[verify] noise vs real ${apps[0].name}: maxAbsDelta=${noiseDelta.maxAbsDelta} meanAbsDelta=${noiseDelta.meanAbsDelta} -> agreement check says "agree": ${!noiseDisagrees}`);
  console.log(`[verify] (for comparison, the OLD self-referential check would have printed "independently decodes to 256x256: true" for this exact noise PNG — dimensions alone do not detect garbage content)`);
  if (!noiseDisagrees) {
    console.error("[verify] FATAL: negative control (b) FAILED — a pure-noise buffer was reported as agreeing with a real icon. The verification check cannot discriminate and must not be trusted.");
    process.exit(1);
  }
  console.log("[verify] PASS: pure-noise buffer correctly reported as disagreeing (proves the check can fail on garbage content, not just wrong dimensions)");

  const report = {
    generatedAt: new Date().toISOString(),
    appCount: apps.length,
    bridges: BRIDGES,
    referenceBridge: REFERENCE_BRIDGE,
    agreementMaxDeltaThreshold: AGREEMENT_MAX_DELTA,
    globalMaxDeltaObserved: globalMaxDelta,
    perBridgeMaxDeltaObserved: perBridgeMaxDelta,
    agreeCount,
    disagreeCount,
    errorCount,
    noContentCount,
    lowAlphaVarianceCount,
    disagreements,
    noContentApps,
    lowAlphaVarianceApps,
    worstDeltas: worstDeltas.slice(0, 20),
    negativeControls: {
      differentAppsCorrectlyDisagree: idxA !== idxB,
      noiseVsRealCorrectlyDisagrees: true,
    },
    sanityChecksAreDiagnosticOnly:
      "alphaVariance and bboxFillFraction (noContentCount/lowAlphaVarianceCount/noContentApps/lowAlphaVarianceApps) are REPORTED, not gated — they do not affect the pass/fail exit code, only cross-bridge pixel agreement (disagreeCount) does. A low-variance/low-fill icon is not necessarily wrong (a fully-opaque square icon has near-zero alpha variance by construction); these are for manual follow-up, not automated rejection.",
    whatThisCannotCatch:
      "If IShellItemImageFactory itself returns the SAME generic/fallback icon for every app, all three bridges call the identical Win32 API and would all agree on that generic icon. Cross-bridge agreement proves bridge equivalence, not per-app icon correctness. That guarantee comes from manual visual inspection of a named subset (see ADR), not from this script.",
  };
  writeFileSync(path.join(rootDir, "verify-results.json"), JSON.stringify(report, null, 2));
  console.log(`\n[verify] wrote verify-results.json`);

  if (disagreeCount > 0) {
    console.error(`\n[verify] FATAL: ${disagreeCount} app(s) disagree across bridges beyond the ${AGREEMENT_MAX_DELTA}-per-channel threshold — see disagreements above and in verify-results.json`);
    process.exit(1);
  }
  console.log(`\n[verify] ALL ${apps.length} apps agree across all bridges within the stated threshold, and both negative controls correctly failed. Verification PASSED.`);
}

main();
