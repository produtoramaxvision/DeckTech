// Round-2 review finding 3 (major), harness case: "add a case to the harness
// that feeds each bridge a forward-slash and relative form of the same real
// app". This script does exactly that, against a REAL app from data/apps.json
// (not a synthetic path), for both in-process bridges (addon, koffi — pwsh
// is a separate process and its .NET SHCreateItemFromParsingName call is
// documented separately in the ADR's path-contract section, since PLAT-03
// is not choosing pwsh).
//
// It asserts TWO things per bridge, per path form:
//   1. extraction SUCCEEDS (does not throw) — this is what the round-2
//      finding was actually about: the addon rejected a forward-slash path
//      with E_INVALIDARG while koffi silently accepted it, an unequal-work
//      bug the benchmark never exposed because list-apps.mjs pre-resolves
//      every path to an absolute backslash form.
//   2. the extracted BGRA pixels are BYTE-IDENTICAL to the canonical
//      absolute-backslash-path extraction from the SAME bridge — proving
//      the normalization didn't just avoid a crash, it resolved to the
//      SAME file.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { extractIconBgra as koffiExtract, comUninitialize } from "../lib/koffi-icon.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const addon = require(path.join(rootDir, "addon-icon", "build", "Release", "iconaddon.node"));

const appsData = JSON.parse(readFileSync(path.join(rootDir, "data", "apps.json"), "utf8"));

// Prefer an app whose canonical path contains a space (Windows path-handling
// rule 5) so this case exercises spaces AND slash/relative forms together.
const app = appsData.apps.find((a) => a.targetPath.includes(" ")) || appsData.apps[0];
if (!app) {
  console.error("[verify-path-contract] FATAL: no apps in data/apps.json to test against");
  process.exit(1);
}

const canonical = app.targetPath; // absolute, backslash — what list-apps.mjs / the benchmark actually feeds
const forwardSlash = canonical.split("\\").join("/");
const relative = path.relative(process.cwd(), canonical);

console.log(`[verify-path-contract] test app: ${app.name}`);
console.log(`[verify-path-contract]   canonical:     ${JSON.stringify(canonical)}`);
console.log(`[verify-path-contract]   forward-slash: ${JSON.stringify(forwardSlash)}`);
console.log(`[verify-path-contract]   relative:      ${JSON.stringify(relative)}`);

function bufEqual(a, b) {
  if (a.length !== b.length) return false;
  return Buffer.compare(a, b) === 0;
}

let failures = 0;

function testBridge(bridgeName, extractFn) {
  let canonicalBgra;
  try {
    canonicalBgra = extractFn(canonical);
  } catch (err) {
    console.error(`[verify-path-contract] ${bridgeName} FATAL: canonical path itself failed: ${err.message}`);
    failures++;
    return;
  }
  for (const [formName, formPath] of [
    ["forward-slash", forwardSlash],
    ["relative", relative],
  ]) {
    try {
      const bgra = extractFn(formPath);
      const matches = bufEqual(canonicalBgra, bgra);
      console.log(`[verify-path-contract] ${bridgeName} / ${formName}: extraction OK, pixel-identical to canonical: ${matches}`);
      if (!matches) {
        console.error(`[verify-path-contract] ${bridgeName} / ${formName}: FAIL — succeeded but pixels differ from canonical (resolved to a different file?)`);
        failures++;
      }
    } catch (err) {
      console.error(`[verify-path-contract] ${bridgeName} / ${formName}: FAIL — threw: ${err.message}`);
      failures++;
    }
  }
}

testBridge("addon", (p) => addon.extractIconBgra(p, 256));
testBridge("koffi", (p) => koffiExtract(p, 256).bgra);
comUninitialize();

if (failures > 0) {
  console.error(`\n[verify-path-contract] FATAL: ${failures} case(s) failed`);
  process.exit(1);
}
console.log(`\n[verify-path-contract] PASS: both bridges accept forward-slash and relative forms of the same real app, and resolve to pixel-identical output vs the canonical absolute path.`);
