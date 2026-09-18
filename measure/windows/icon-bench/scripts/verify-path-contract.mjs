// Round-2 review finding 3 (major), extended by round-3 review finding 6:
// the addon's real Win32 path contract (what GetFullPathNameW normalizes
// and what it deliberately does NOT), tested here, not assumed, against a
// REAL app from data/apps.json (not a synthetic path), for both in-process
// bridges (addon, koffi — pwsh is a separate process and its .NET
// SHCreateItemFromParsingName call is documented separately in the ADR's
// path-contract section, since PLAT-03 is not choosing pwsh).
//
// Round-3 fix: this used to cover only 2 of the 8 forms the ADR's
// path-contract table documents (forward-slash, relative) as a committed
// case, with the other 5 (trailing space, trailing dot, %VAR%, quotes,
// ,<index> suffix) backed only by an ad hoc script under the gitignored
// .tmp/ — unreproducible by anyone who clones the repo. All rows are
// committed here now, run against BOTH in-process bridges (not addon only)
// so any divergence between them is caught, not just assumed absent.
//
// Round-4 fix (finding 1, major): the %VAR% row used to build a literal
// %VAR% prefix onto whichever real app was selected below, which on this
// machine (Adobe Acrobat, path under "C:\Program Files") failed identically
// whether or not the variable was expanded — non-discriminating. It is now
// two STANDALONE rows (ignore the selected app, always probe a fixed
// %SystemRoot%\System32\notepad.exe target): one asserting the literal
// %SystemRoot% form fails, and its required paired control asserting the
// hand-expanded form succeeds. See lib/probe-target.mjs.
//
// For each MUST-SUCCEED form: asserts extraction does not throw AND the
// extracted BGRA pixels are byte-identical to the canonical
// absolute-backslash-path extraction from the SAME bridge — proving
// normalization didn't just avoid a crash, it resolved to the SAME file.
// For each MUST-FAIL form: asserts extraction DOES throw (the form is
// deliberately unsupported input, not a bug) and prints the real error
// text/HRESULT, so the ADR's table cites an error actually observed in
// this run, not carried forward from memory.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { extractIconBgra as koffiExtract, comUninitialize } from "../lib/koffi-icon.mjs";
import { probeTargetPath } from "../lib/probe-target.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const addon = require(path.join(rootDir, "addon-icon", "build", "Release", "iconaddon.node"));

const appsData = JSON.parse(readFileSync(path.join(rootDir, "data", "apps.json"), "utf8"));

// Prefer an app whose canonical path contains a space (Windows path-handling
// rule 5) so this case exercises spaces AND slash/relative/edge forms together.
const app = appsData.apps.find((a) => a.targetPath.includes(" ")) || appsData.apps[0];
if (!app) {
  console.error("[verify-path-contract] FATAL: no apps in data/apps.json to test against");
  process.exit(1);
}

const canonical = app.targetPath; // absolute, backslash — what list-apps.mjs / the benchmark actually feeds

function bufEqual(a, b) {
  if (a.length !== b.length) return false;
  return Buffer.compare(a, b) === 0;
}

// The 8 rows the ADR's path-contract table documents. mustSucceed=true means
// the addon/koffi contract is expected to normalize this form to the SAME
// file as canonical; mustSucceed=false means the form is deliberately
// unsupported (the contract requires the CALLER, not the addon, to
// pre-process it) and extraction must throw.
const forms = [
  { name: "forward-slash", mustSucceed: true, build: (c) => c.split("\\").join("/") },
  { name: "relative", mustSucceed: true, build: (c) => path.relative(process.cwd(), c) },
  { name: "trailing space", mustSucceed: true, build: (c) => c + " " },
  { name: "trailing dot", mustSucceed: true, build: (c) => c + "." },
  {
    // Round-4 review fix (finding 1, major): this row used to prefix a
    // literal %VAR% onto whichever real app list-apps.mjs's rule-5 pick
    // above produced. On this machine that app is Adobe Acrobat under
    // "C:\Program Files" (rule 5 deliberately prefers an app whose path
    // contains a space), so the fallback branch fired and the form built
    // was "%ProgramFiles%\C:\Program Files\Adobe\Acrobat DC\Acrobat\
    // Acrobat.exe" — malformed either way you read it, and it fails with
    // the SAME hr=0x80070002 whether or not %VAR% expansion happens. That
    // made the row non-discriminating: it "passed" regardless of the
    // addon's real behavior on environment variables.
    //
    // A discriminating row needs a path that resolves to a real file IF
    // AND ONLY IF the variable is expanded. %SystemRoot% is a fixed,
    // always-present target (System32\notepad.exe) independent of which
    // real app was picked above — standalone: true means `build` ignores
    // the canonical app path entirely and always probes this fixed target.
    name: "%SystemRoot% (env var, must fail — not expanded)",
    mustSucceed: false,
    standalone: true,
    build: () => "%SystemRoot%\\System32\\notepad.exe",
  },
  {
    // Required pair for the row above: the SAME target, hand-expanded,
    // MUST succeed — this is what makes the row above discriminating. If
    // this control also failed, the row above would prove nothing (it
    // could be failing for an unrelated reason, e.g. notepad.exe missing).
    name: "%SystemRoot% control (hand-expanded, must succeed)",
    mustSucceed: true,
    standalone: true,
    build: () => probeTargetPath,
  },
  { name: "surrounding quotes (must fail — not stripped)", mustSucceed: false, build: (c) => `"${c}"` },
  { name: ",0 icon-index suffix (must fail — not stripped)", mustSucceed: false, build: (c) => c + ",0" },
];

console.log(`[verify-path-contract] test app: ${app.name}`);
console.log(`[verify-path-contract] canonical: ${JSON.stringify(canonical)}`);
for (const f of forms) {
  console.log(`[verify-path-contract]   ${f.name}: ${JSON.stringify(f.build(canonical))}`);
}

let failures = 0;
const rowResults = { canonical, forms: {} };

function testBridge(bridgeName, extractFn) {
  let canonicalBgra;
  try {
    canonicalBgra = extractFn(canonical);
  } catch (err) {
    console.error(`[verify-path-contract] ${bridgeName} FATAL: canonical path itself failed: ${err.message}`);
    failures++;
    return;
  }
  for (const f of forms) {
    const formPath = f.build(canonical);
    const key = f.name;
    rowResults.forms[key] = rowResults.forms[key] || {};
    try {
      const bgra = extractFn(formPath);
      if (f.mustSucceed) {
        if (f.standalone) {
          // standalone rows probe a fixed target (notepad.exe), not the
          // canonical app (Adobe Acrobat here) — pixel identity to
          // canonicalBgra is meaningless for them (different file). "no
          // throw" is the whole assertion.
          console.log(`[verify-path-contract] ${bridgeName} / ${key}: extraction OK (standalone target, not compared to canonical), ${bgra.length} bytes`);
          rowResults.forms[key][bridgeName] = { outcome: "succeeded", standalone: true };
        } else {
          const matches = bufEqual(canonicalBgra, bgra);
          console.log(`[verify-path-contract] ${bridgeName} / ${key}: extraction OK, pixel-identical to canonical: ${matches}`);
          rowResults.forms[key][bridgeName] = { outcome: "succeeded", pixelIdenticalToCanonical: matches };
          if (!matches) {
            console.error(`[verify-path-contract] ${bridgeName} / ${key}: FAIL — succeeded but pixels differ from canonical (resolved to a different file?)`);
            failures++;
          }
        }
      } else {
        // This form was expected to FAIL (deliberately unsupported input)
        // but succeeded instead — that is a contract violation, not a pass.
        console.error(`[verify-path-contract] ${bridgeName} / ${key}: FAIL — expected this form to be REJECTED (contract says it is not normalized), but extraction SUCCEEDED`);
        rowResults.forms[key][bridgeName] = { outcome: "unexpectedly succeeded" };
        failures++;
      }
    } catch (err) {
      if (f.mustSucceed) {
        console.error(`[verify-path-contract] ${bridgeName} / ${key}: FAIL — threw: ${err.message}`);
        rowResults.forms[key][bridgeName] = { outcome: "unexpectedly threw", error: err.message };
        failures++;
      } else {
        console.log(`[verify-path-contract] ${bridgeName} / ${key}: correctly REJECTED — ${err.message}`);
        rowResults.forms[key][bridgeName] = { outcome: "correctly rejected", error: err.message };
      }
    }
  }
}

testBridge("addon", (p) => addon.extractIconBgra(p, 256));
testBridge("koffi", (p) => koffiExtract(p, 256).bgra);
comUninitialize();

// Report any divergence between the two bridges on the same form — the
// whole origin of round-2 finding 3 was addon and koffi doing UNEQUAL work
// on the same input, so a divergence here is exactly what this script must
// not suppress.
console.log("\n[verify-path-contract] === addon vs koffi outcome per form ===");
let divergences = 0;
for (const f of forms) {
  const a = rowResults.forms[f.name]?.addon?.outcome;
  const k = rowResults.forms[f.name]?.koffi?.outcome;
  const agree = a === k;
  console.log(`[verify-path-contract]   ${f.name}: addon=${a} koffi=${k} ${agree ? "(agree)" : "*** DIVERGE ***"}`);
  if (!agree) divergences++;
}
if (divergences > 0) {
  console.log(`[verify-path-contract] NOTE: ${divergences} form(s) show addon/koffi diverging in OUTCOME (not pixel content) — recorded above, not hidden. This does not by itself fail the script (mustSucceed/mustFail per-bridge checks above already gate pass/fail); it is reported so the ADR can state divergence as measured fact if present.`);
}

if (failures > 0) {
  console.error(`\n[verify-path-contract] FATAL: ${failures} case(s) failed`);
  process.exit(1);
}
console.log(`\n[verify-path-contract] PASS: both bridges accept forward-slash/relative/trailing-space/trailing-dot forms of the same real app (pixel-identical to canonical), correctly reject the literal %SystemRoot%/quoted/,<index> forms as unsupported input, and correctly accept the hand-expanded %SystemRoot% control.`);
