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
// node --test prints each failing test's `✖ <name> (<duration>ms)` line
// TWICE — once in the streaming list, once again in the trailing "failing
// tests:" summary — and both copies are followed by an indented stack trace
// whose own lines can themselves contain "(" (e.g. "at Test.run
// (node:...)"). Anchoring on the FIRST "(" (the round-6/round-7 harness's
// original `/^✖ (.+?) \(/gm`) truncates any name that itself contains a
// "(" before its trailing duration — which is exactly every round-6
// ANCORAGEM fixture name, since they all read "... (finding N, X#): ...".
// Anchoring on the trailing "(<number>ms)" instead captures the full name
// even when it contains parentheses, and `new Set(...)` collapses the
// streaming/summary duplicate so the printed line count matches `fail`.
function counts(out) {
  const g = (k) => {
    const m = out.match(new RegExp("^ℹ " + k + " (\\d+)$", "m"));
    return m ? Number(m[1]) : null;
  };
  const failingRaw = [...out.matchAll(/^✖ (.+) \(\d+(?:\.\d+)?ms\)$/gm)].map((m) => m[1]);
  const failing = [...new Set(failingRaw)];
  return { tests: g("tests"), pass: g("pass"), fail: g("fail"), failing };
}

const originals = new Map();
for (const f of [RULE, DEDUPE, RESOLVE]) originals.set(f, readFileSync(f, "utf8"));

// What these handlers do NOT cover: the window a mutant sits on disk is
// exactly one blocking `execFileSync()` call inside `runSuite()`, and
// `execFileSync` blocks the whole Node.js event loop for its full duration
// (Node's own docs, via context7 `/nodejs/node` `child_process.md`:
// "spawnSync(), execSync(), and execFileSync() ... are synchronous and
// will block the Node.js event loop, pausing execution of any additional
// code until the spawned process exits"). A registered signal handler is
// dispatched through that same event loop, not a separate preemptive path
// (Node's own source: a Signal watcher's `onsignal` calls `process.emit()`,
// and libuv's `uv_run()` runs signal-watcher and timer callbacks as phases
// of the same loop iteration — reasoned from source, since no real signal
// can be delivered and observed from this headless session; see ADR §9.1c
// for the full chain). What IS measured directly, on the timer path that
// same loop mechanism also serves: a 50ms `setTimeout` scheduled
// immediately before a 2000ms `execFileSync` did not fire until the call
// returned (t+2057ms in this file's committed probe run, not t+50ms —
// see ADR §9.1c for two other independent runs of the same probe), and
// the same held across the gap
// between two consecutive `execFileSync` calls with nothing but ordinary
// synchronous statements in between (fired only once the whole script's
// own top-level synchronous code had finished, not in the gap) — see ADR
// §9.1c for both raw runs. What actually restores the file across that
// window is the synchronous `try/finally` around each `runSuite()` call
// below, which runs unconditionally the instant `runSuite()` returns,
// throw or not.
//
// What these handlers DO cover: an interrupt Node's runtime is able to
// dispatch to JS at all — i.e. once the event loop regains control, which
// for this fully-synchronous script is only once the whole top-level run
// completes (at which point every file is already restored) or, per the
// measurement above, not demonstrably at any earlier point either.
// Registered anyway, before the first mutation is written, as the
// POSIX-idiomatic pattern and as defense-in-depth should this file ever
// gain a genuine async yield point (e.g. a future maintainer adding real
// I/O to the loop) that would otherwise leave a mutant unrestored.
let restoring = false;
function restoreAllAndExit(signalName, code) {
  if (restoring) return;
  restoring = true;
  console.error(`\n!! INTERRUPTED (${signalName}) — restoring ${originals.size} file(s) before exit.`);
  for (const [f, content] of originals) {
    try {
      writeFileSync(f, content, "utf8");
      console.error(`   restored: ${f}`);
    } catch (err) {
      console.error(`!! FAILED TO RESTORE ${f} during interrupt: ${err.message}`);
    }
  }
  process.exit(code);
}
process.on("SIGINT", () => restoreAllAndExit("SIGINT", 130));
process.on("SIGTERM", () => restoreAllAndExit("SIGTERM", 143));

const base = counts(runSuite());
console.log(`BASELINE: tests=${base.tests} pass=${base.pass} fail=${base.fail}`);
console.log("");

// A red or unparseable baseline invalidates every subsequent row: with the
// pre-fix `r.fail > 0` check, `fail` staying above 0 for a reason unrelated
// to the mutation would mark every single mutant KILLED and print the false
// all-clear "SURVIVORS: (none)" — the harness's one product, from an
// instrument whose own baseline was never actually green. Refuse to proceed.
if (base.tests === null || base.pass === null || base.fail === null) {
  console.error("BASELINE UNPARSEABLE — the `ℹ tests/pass/fail` summary lines were not found in `node --test`'s output. Refusing to mutate against an instrument that cannot read its own baseline.");
  process.exitCode = 1;
  process.exit(1);
}
if (base.fail !== 0) {
  console.error(`BASELINE NOT GREEN (fail=${base.fail}) — fix test/windows-uninstaller-rule.test.mjs, test/windows-dedupe-order.test.mjs and test/windows-dedupe-target.test.mjs first. Refusing to mutate against a red baseline: every mutant run would report fail>0 regardless of the mutation and the harness would print a false "SURVIVORS: (none)".`);
  process.exitCode = 1;
  process.exit(1);
}

const survivors = [];
const errors = [];
for (const m of MUTANTS) {
  const orig = originals.get(m.file);
  const idx = orig.indexOf(m.from);
  if (idx === -1) { console.log(`${m.id}: !! PATTERN NOT FOUND`); continue; }
  if (orig.indexOf(m.from, idx + 1) !== -1) { console.log(`${m.id}: !! PATTERN NOT UNIQUE`); continue; }
  writeFileSync(m.file, orig.slice(0, idx) + m.to + orig.slice(idx + m.from.length), "utf8");
  let out;
  try {
    out = runSuite();
  } finally {
    // This does NOT shrink the on-disk-mutated window below one
    // `runSuite()` call — that was already true before this round: the
    // restore always ran immediately after `runSuite()` returned. What it
    // adds is that the restore now also runs if `runSuite()` itself throws
    // (or, before this refactor, if the now-relocated `counts(...)` call
    // that used to run before the restore had thrown) — previously any
    // such exception skipped the restore entirely and left the mutated
    // file on disk for the rest of the process's life. `counts(out)` is
    // now called AFTER this block, once the file is already back to
    // original, so a bug in output parsing can no longer leave a mutant on
    // disk either. The reviewer's round-7 probe (sampling `git diff
    // --shortstat` while the harness ran and catching it dirty on 7 of 7
    // samples) is still expected behavior with this fix — the file IS
    // legitimately mutated for the duration of each `runSuite()` call by
    // design; only a same-process crash mid-mutant is what this hardens
    // against. SIGINT/SIGTERM (handled below) cannot fire during this
    // exact window either — see the comment above the handlers for the
    // measurement — so it is this `finally`, not those handlers, that
    // covers the file while `runSuite()` runs.
    writeFileSync(m.file, orig, "utf8");
  }
  const r = counts(out);
  if (r.fail === null) {
    // A mutant that made the file fail to parse (or otherwise produced
    // output without a `ℹ fail N` line) is neither killed nor survived —
    // `null > 0` is false, so the old code silently filed it as SURVIVED.
    // That is over-reporting in the conservative direction, but still a
    // silent misclassification of an instrument whose only job is this
    // classification. Report it as its own category instead.
    errors.push(m.id);
    console.log(`${m.id}: !! UNPARSEABLE OUTPUT (no "ℹ fail N" line — mutant likely broke parsing, not just behavior)`);
    console.log("      raw output tail:");
    for (const line of out.trim().split("\n").slice(-15)) console.log(`      | ${line}`);
    continue;
  }
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
console.log("UNPARSEABLE (neither killed nor survived): " + (errors.length ? errors.join(", ") : "(none)"));
console.log("restore byte-identical: " + clean);
const after = counts(runSuite());
console.log(`POST-RUN BASELINE: tests=${after.tests} pass=${after.pass} fail=${after.fail}`);
if (errors.length || !clean || after.fail !== 0) process.exitCode = 1;
