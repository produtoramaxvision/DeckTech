// Feasibility probe: extract exactly ONE icon via the koffi bridge and
// verify the output is a real, correctly-sized PNG before trusting it for
// a 136-icon benchmark. Per PROOF-01 instructions: if this fails after a
// bounded attempt, that is reported as a result, not papered over.
import { extractIconBgra, comUninitialize } from "../lib/koffi-icon.mjs";
import { encodePng, bgraToRgba } from "../lib/png.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || "C:\\Windows\\System32\\notepad.exe";
const outDir = path.join(__dirname, "..", ".tmp");
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "probe-koffi.png");

console.log(`[probe-koffi] extracting 256x256 from: ${target}`);
try {
  const t0 = performance.now();
  const { width, height, bgra } = extractIconBgra(target, 256);
  const t1 = performance.now();
  const rgba = bgraToRgba(bgra);
  const png = encodePng(rgba, width, height);
  writeFileSync(outFile, png);
  const t2 = performance.now();
  console.log(`[probe-koffi] extract=${(t1 - t0).toFixed(1)}ms encode=${(t2 - t1).toFixed(1)}ms size=${png.length}B -> ${outFile}`);

  // Independent verification: decode with .NET's own PNG decoder (not our
  // own encoder logic) and confirm dimensions.
  const psOut = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName System.Drawing; $img = [System.Drawing.Image]::FromFile('${outFile.replace(/'/g, "''")}'); Write-Output "$($img.Width)x$($img.Height)"; $img.Dispose()`,
    ],
    { encoding: "utf8" }
  ).trim();
  console.log(`[probe-koffi] independent decode check: ${psOut}`);
  if (psOut !== "256x256") {
    console.error(`[probe-koffi] FAIL: expected 256x256, got ${psOut}`);
    process.exit(1);
  }
  console.log("[probe-koffi] PASS");
} catch (err) {
  console.error("[probe-koffi] FAILED:", err.message);
  process.exit(1);
} finally {
  comUninitialize();
}
