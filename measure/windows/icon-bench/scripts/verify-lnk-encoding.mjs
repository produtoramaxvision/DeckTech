// Round-3 review regression case (finding 2, BLOCKER): a .lnk whose file
// name contains a non-ASCII character (and a space — Windows path-handling
// rule 5) must resolve to its real target through the SAME Node -> PowerShell
// hop scripts/list-apps.mjs uses (lib/lnk-resolve.mjs), not be silently
// dropped the way "Firefox Navegação Privada.lnk" and 3 others were before
// this fix (Get-Content -Raw decoding the UTF-8-no-BOM input JSON with PS
// 5.1's ANSI codepage default, mangling the path before WScript.Shell ever
// opened it).
//
// Method: copy a REAL, already-resolvable .lnk from data/apps.json into a
// scratch directory under a name containing a non-ASCII character and a
// space, resolve it through lib/lnk-resolve.mjs, and assert the resolved
// TargetPath equals the original's. An ASCII-named copy of the same .lnk is
// resolved alongside it as a control, so a failure here is attributable to
// the non-ASCII character specifically, not to the copy/resolve mechanics
// in general.
import { readFileSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLnkTargets } from "../lib/lnk-resolve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

const appsData = JSON.parse(readFileSync(path.join(rootDir, "data", "apps.json"), "utf8"));
const app = appsData.apps[0];
if (!app) {
  console.error("[verify-lnk-encoding] FATAL: data/apps.json has no apps — run scripts/list-apps.mjs first");
  process.exit(1);
}

const scratchDir = path.join(rootDir, ".tmp", "lnk-encoding-regression");
rmSync(scratchDir, { recursive: true, force: true });
mkdirSync(scratchDir, { recursive: true });

// Non-ASCII (Portuguese diacritics, matching the actual mojibake examples
// this bug produced on this pt-BR machine) AND a space, per rule 5.
const nonAsciiName = "Ícone de Teste Não-ASCII.lnk";
const asciiControlName = "Ascii Control Copy.lnk";
const nonAsciiPath = path.join(scratchDir, nonAsciiName);
const asciiControlPath = path.join(scratchDir, asciiControlName);

copyFileSync(app.lnk, nonAsciiPath);
copyFileSync(app.lnk, asciiControlPath);

console.log(`[verify-lnk-encoding] source .lnk: ${app.lnk}`);
console.log(`[verify-lnk-encoding] expected target: ${app.targetPath}`);
console.log(`[verify-lnk-encoding] non-ASCII copy: ${nonAsciiPath}`);
console.log(`[verify-lnk-encoding] ASCII control copy: ${asciiControlPath}`);

const { rows } = resolveLnkTargets([nonAsciiPath, asciiControlPath], { tmpDir: scratchDir });

const byLnk = new Map(rows.map((r) => [r.lnk, r]));
const nonAsciiRow = byLnk.get(nonAsciiPath);
const controlRow = byLnk.get(asciiControlPath);

let failures = 0;

if (!controlRow || controlRow.target !== app.targetPath) {
  console.error(`[verify-lnk-encoding] FATAL: ASCII control copy did not resolve correctly — got ${JSON.stringify(controlRow)}. The test setup itself is broken; the non-ASCII result below cannot be trusted.`);
  failures++;
} else {
  console.log(`[verify-lnk-encoding] PASS: ASCII control copy resolved correctly: ${controlRow.target}`);
}

if (!nonAsciiRow) {
  console.error("[verify-lnk-encoding] FAIL: non-ASCII copy produced no result row at all");
  failures++;
} else if (nonAsciiRow.target !== app.targetPath) {
  console.error(`[verify-lnk-encoding] FAIL: non-ASCII copy resolved to ${JSON.stringify(nonAsciiRow.target)} (resolveError=${JSON.stringify(nonAsciiRow.resolveError)}), expected ${JSON.stringify(app.targetPath)}`);
  failures++;
} else {
  console.log(`[verify-lnk-encoding] PASS: non-ASCII-named .lnk (${nonAsciiName}) resolved correctly: ${nonAsciiRow.target}`);
}

rmSync(scratchDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n[verify-lnk-encoding] FATAL: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("\n[verify-lnk-encoding] PASS: a .lnk file name containing a non-ASCII character and a space resolves to its real target, matching the ASCII control.");
