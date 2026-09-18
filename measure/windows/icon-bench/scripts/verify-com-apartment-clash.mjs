// Round-3 review promotion (finding 6, MINOR): reproduces the COM apartment
// clash scenario the ADR's "Consequências"/round-2 finding 5 section names
// as the realistic Electron main-process risk — Electron initializes COM in
// a specific apartment before any app code runs, and if it chose MTA while
// the addon calls CoInitializeEx(COINIT_APARTMENTTHREADED), the mismatch is
// RPC_E_CHANGED_MODE (hr=0x80010106), not a generic failure. This lived only
// as an ad hoc script under the gitignored .tmp/ before this fix.
//
// Must run as its OWN process (not folded into another script's process):
// this test needs to control the FIRST CoInitializeEx call this Node process
// ever makes, before the addon's own EnsureCom() runs — mixing it into a
// process that already touched COM for something else would invalidate it.
//
// Usage: node scripts/verify-com-apartment-clash.mjs
import koffi from "koffi";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { probeTargetPath } from "../lib/probe-target.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

const ole32 = koffi.load("ole32.dll");
const CoInitializeEx = ole32.func("__stdcall", "CoInitializeEx", "long", ["void *", "uint32"]);
const COINIT_MULTITHREADED = 0x0;
const RPC_E_CHANGED_MODE = 0x80010106;

// Force this process's COM apartment to MTA BEFORE the addon ever calls
// CoInitializeEx(COINIT_APARTMENTTHREADED) — this is the Electron
// main-process scenario the ADR names.
const hr = CoInitializeEx(null, COINIT_MULTITHREADED) >>> 0;
console.log(`[verify-com-apartment-clash] CoInitializeEx(MTA) in this process returned hr=0x${hr.toString(16)}`);
if (hr !== 0 && hr !== 1 /* S_FALSE: already initialized in this mode */) {
  console.error(`[verify-com-apartment-clash] FATAL: could not force this process into MTA (unexpected hr) — test setup itself is broken`);
  process.exit(1);
}

const addon = require(path.join(rootDir, "addon-icon", "build", "Release", "iconaddon.node"));

let failures = 0;
try {
  addon.extractIconBgra(probeTargetPath, 256);
  console.error("[verify-com-apartment-clash] FAIL: addon call unexpectedly SUCCEEDED despite the forced apartment clash");
  failures++;
} catch (err) {
  console.log(`[verify-com-apartment-clash] addon threw (expected): ${err.message}`);
  const mentionsChangedModeHex = /80010106/i.test(err.message);
  if (mentionsChangedModeHex) {
    console.log(`[verify-com-apartment-clash] PASS: error message contains RPC_E_CHANGED_MODE (0x${RPC_E_CHANGED_MODE.toString(16)}), confirming this is the documented apartment-clash failure, not some other error`);
  } else {
    console.error(`[verify-com-apartment-clash] FAIL: addon threw, but the message does not contain the expected RPC_E_CHANGED_MODE hex code — got: ${err.message}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n[verify-com-apartment-clash] FATAL: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("\n[verify-com-apartment-clash] PASS: forcing this process's COM apartment to MTA before the addon's own CoInitializeEx(APARTMENTTHREADED) call reproduces RPC_E_CHANGED_MODE, the documented Electron main-process risk — not a hypothetical.");
