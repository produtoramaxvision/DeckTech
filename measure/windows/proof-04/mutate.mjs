// PROOF-04 mutation-testing harness for the uninstaller-exclusion rule.
//
// Originates from the round-6 reviewer's independent mutation harness
// (built to check the round-5 ADR's own mutation claims), checked in here
// as a reproducible probe artifact per this project's rule that Phase 0
// probes live under measure/windows/ — not left in a session scratchpad
// the ADR could cite but nobody else could re-run. Repo root is resolved
// from this file's own location, not hardcoded, so it runs unmodified on
// any checkout.
//
// Usage: `node measure/windows/proof-04/mutate.mjs` from anywhere; it
// resolves its own paths internally.
//
// For each mutant: apply a single, exact, unique string replacement to the
// named source file, run the three PROOF-04 test files, record whether any
// test failed (mutant killed) or the suite stayed green (mutant survived),
// then restore the file byte-for-byte before moving to the next mutant. A
// survivor means an assertion is missing, not that the code is wrong — see
// docs/adr/PROOF-04-uninstaller-exclusion-rule.md §9.1b for how each
// surviving mutant found by this harness was either closed with a new
// fixture or confirmed genuinely equivalent (X8).
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const RULE = path.join(REPO, "measure", "windows", "lib", "uninstaller-rule.mjs");
const DEDUPE = path.join(REPO, "measure", "windows", "lib", "dedupe-target.mjs");
const RESOLVE = path.join(REPO, "measure", "windows", "lib", "resolve-app-list.mjs");
const TESTS = [
  "test/windows-uninstaller-rule.test.mjs",
  "test/windows-dedupe-order.test.mjs",
  "test/windows-dedupe-target.test.mjs",
];

const MUTANTS = [
  // --- feature-deletion control ---
  { id: "K0-neuter-rule(return false)", file: RULE, from: "export function isUninstallerEntry(entry) {", to: "export function isUninstallerEntry(entry) {\n  if (true) return false;" },
  // --- sites earlier rounds' tables already cover (spot-check reproduction) ---
  { id: "G1-unins-drop-both-anchors", file: RULE, from: "/^unins\\d*\\.exe$/i", to: "/unins\\d*\\.exe/i" },
  { id: "G6-msi-drop-leading-(^|s)", file: RULE, from: "/(^|\\s)\\/(x|uninstall)\\b/i", to: "/\\/(x|uninstall)\\b/i" },
  { id: "G6-msi-drop-trailing-\\b", file: RULE, from: "/(^|\\s)\\/(x|uninstall)\\b/i", to: "/(^|\\s)\\/(x|uninstall)/i" },
  { id: "G5-EXACT_NAME-drop-/i", file: RULE, from: "/^uninstall$/i", to: "/^uninstall$/" },
  // --- round-6: sites NOT present in any earlier round's table ---
  { id: "X1-EXACT_NAME-drop-^", file: RULE, from: "/^uninstall$/i", to: "/uninstall$/i" },
  { id: "X2-EXACT_NAME-drop-$", file: RULE, from: "/^uninstall$/i", to: "/^uninstall/i" },
  { id: "X3-MSIEXEC_BASENAME-drop-^", file: RULE, from: "/^msiexec\\.exe$/i", to: "/msiexec\\.exe$/i" },
  { id: "X4-MSIEXEC_BASENAME-drop-$", file: RULE, from: "/^msiexec\\.exe$/i", to: "/^msiexec\\.exe/i" },
  { id: "X5-exe-guard-drop-$", file: RULE, from: "/\\.exe$/i.test(base)", to: "/\\.exe/i.test(base)" },
  { id: "X6-name-.trim()-removed", file: RULE, from: "entry.name.trim()", to: "entry.name" },
  { id: "X7-unins-\\d*-to-\\d+", file: RULE, from: "/^unins\\d*\\.exe$/i", to: "/^unins\\d+\\.exe$/i" },
  { id: "X8-empty-target-guard-removed", file: RULE, from: 'typeof entry.target !== "string" || entry.target === ""', to: 'typeof entry.target !== "string"' },
  { id: "X9-msi-verb-'uninstall'-dropped", file: RULE, from: "/(^|\\s)\\/(x|uninstall)\\b/i", to: "/(^|\\s)\\/(x)\\b/i" },
  { id: "X10-dedupe-drop-.toLowerCase()", file: DEDUPE, from: "entry.target.toLowerCase()", to: "entry.target" },
  { id: "X11-dedupe-''-passthrough-removed", file: DEDUPE, from: 'typeof entry.target !== "string" || entry.target === ""', to: 'typeof entry.target !== "string"' },
  { id: "X12-pipeline-order-reversed", file: RESOLVE, from: "const { kept, excluded } = partitionUninstallers(resolved);\n  return { kept: dedupeByTarget(kept), excluded };", to: "const { kept, excluded } = partitionUninstallers(dedupeByTarget(resolved));\n  return { kept, excluded };" },
  { id: "X13-excluded-also-deduped", file: RESOLVE, from: "return { kept: dedupeByTarget(kept), excluded };", to: "return { kept: dedupeByTarget(kept), excluded: dedupeByTarget(excluded) };" },
];

function runSuite() {
  try {
    return execFileSync("node", ["--test", ...TESTS], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    return (err.stdout || "") + (err.stderr || "");
  }
}
function counts(out) {
  const g = (k) => {
    const m = out.match(new RegExp("^ℹ " + k + " (\\d+)$", "m"));
    return m ? Number(m[1]) : null;
  };
  const failing = [...out.matchAll(/^✖ (.+?) \(/gm)].map((m) => m[1]);
  return { tests: g("tests"), pass: g("pass"), fail: g("fail"), failing };
}

const originals = new Map();
for (const f of [RULE, DEDUPE, RESOLVE]) originals.set(f, readFileSync(f, "utf8"));

const base = counts(runSuite());
console.log(`BASELINE: tests=${base.tests} pass=${base.pass} fail=${base.fail}`);
console.log("");

const survivors = [];
for (const m of MUTANTS) {
  const orig = originals.get(m.file);
  const idx = orig.indexOf(m.from);
  if (idx === -1) { console.log(`${m.id}: !! PATTERN NOT FOUND`); continue; }
  if (orig.indexOf(m.from, idx + 1) !== -1) { console.log(`${m.id}: !! PATTERN NOT UNIQUE`); continue; }
  writeFileSync(m.file, orig.slice(0, idx) + m.to + orig.slice(idx + m.from.length), "utf8");
  const r = counts(runSuite());
  writeFileSync(m.file, orig, "utf8");
  const killed = r.fail > 0;
  if (!killed) survivors.push(m.id);
  console.log(`${m.id}: tests=${r.tests} pass=${r.pass} fail=${r.fail}  ${killed ? "KILLED" : "*** SURVIVED ***"}`);
  for (const t of r.failing) console.log(`      x ${t}`);
}

let clean = true;
for (const f of [RULE, DEDUPE, RESOLVE]) {
  if (readFileSync(f, "utf8") !== originals.get(f)) { clean = false; console.log("!! NOT RESTORED: " + f); }
}
console.log("");
console.log("SURVIVORS: " + (survivors.length ? survivors.join(", ") : "(none)"));
console.log("restore byte-identical: " + clean);
const after = counts(runSuite());
console.log(`POST-RUN BASELINE: tests=${after.tests} pass=${after.pass} fail=${after.fail}`);
