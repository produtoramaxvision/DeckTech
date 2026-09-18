// Feasibility probe: extract exactly ONE icon via the N-API addon bridge and
// verify the output is a real, correctly-sized PNG.
import { encodePng, bgraToRgba } from "../lib/png.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { probeTargetPath } from "../lib/probe-target.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const addon = require(path.join(__dirname, "..", "addon-icon", "build", "Release", "iconaddon.node"));

// argv override is intentional: this is a standalone smoke probe, not the
// path-contract discriminator (verify-path-contract.mjs), so callers may
// still point it at an arbitrary .exe on the command line.
const target = process.argv[2] || probeTargetPath;
const outDir = path.join(__dirname, "..", ".tmp");
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "probe-addon.png");

console.log(`[probe-addon] extracting 256x256 from: ${target}`);
try {
  const t0 = performance.now();
  const bgra = addon.extractIconBgra(target, 256);
  const t1 = performance.now();
  const rgba = bgraToRgba(bgra);
  const png = encodePng(rgba, 256, 256);
  writeFileSync(outFile, png);
  const t2 = performance.now();
  console.log(`[probe-addon] extract=${(t1 - t0).toFixed(1)}ms encode=${(t2 - t1).toFixed(1)}ms size=${png.length}B -> ${outFile}`);

  const psOut = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName System.Drawing; $img = [System.Drawing.Image]::FromFile('${outFile.replace(/'/g, "''")}'); Write-Output "$($img.Width)x$($img.Height)"; $img.Dispose()`,
    ],
    { encoding: "utf8" }
  ).trim();
  console.log(`[probe-addon] independent decode check: ${psOut}`);
  if (psOut !== "256x256") {
    console.error(`[probe-addon] FAIL: expected 256x256, got ${psOut}`);
    process.exit(1);
  }
  console.log("[probe-addon] PASS");
} catch (err) {
  console.error("[probe-addon] FAILED:", err.message);
  process.exit(1);
}
