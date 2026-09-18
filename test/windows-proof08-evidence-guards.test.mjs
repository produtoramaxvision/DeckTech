// PROOF-08 round-10 review, major finding #2 — the evidence-integrity
// guards added in round 9 (--out-tag validation, JSON/txt no-clobber +
// --force, the MIN_N_FOR_DIRECTIONAL_VERDICT floor) had zero automated
// coverage; the only enforcement was prose in the ADR Appendix — the exact
// "a header comment claiming a protection nothing enforced" failure class
// round-8 was rejected for once already. This suite imports the pure
// functions directly from measure/windows/proof-08/evidence-guards.mjs
// (the same module run.mjs itself imports and calls unchanged — see that
// file's guard block) and, for the two argv-driven guards that actually
// exit the process, spawns run.mjs as a real subprocess so the WIRING is
// covered too, not just the logic in isolation. No Electron process is
// ever booted here: every case below is designed to exit (or return) before
// run.mjs's main() reaches the `import electronPath from "electron"` value
// being spawned — the guards under test are, by construction, the code that
// runs BEFORE that point.
//
// Every assertion below fails if the corresponding guard in
// measure/windows/proof-08/evidence-guards.mjs is deleted or neutered:
//   - deleting resolveOutTag/checkNoClobber/buildEvidenceMeta/deltaVsSpread
//     breaks the import (fails the whole file)
//   - a no-op resolveOutTag (always returns the raw value with no
//     validation) fails every "rejects ..." assertion below
//   - a checkNoClobber that always returns blocked:false fails the
//     collision assertions and would let run.mjs silently clobber
//     committed evidence again
//   - a deltaVsSpread that never checks n against MIN_N_FOR_DIRECTIONAL_VERDICT
//     fails the small-n assertion by printing a verdict where none should
//     render

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SAFE_TAG_RE,
  resolveOutTag,
  checkNoClobber,
  buildEvidenceMeta,
  deltaVsSpread,
  MIN_N_FOR_DIRECTIONAL_VERDICT,
} from "../measure/windows/proof-08/evidence-guards.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const runMjsPath = join(here, "..", "measure", "windows", "proof-08", "run.mjs");

// ---------------------------------------------------------------------
// resolveOutTag — pure unit coverage of every case the required fix names:
// missing, traversal-shaped, space-containing, and flag-shaped --out-tag.
// ---------------------------------------------------------------------

test("resolveOutTag: missing --out-tag VALUE (flag last, no value) is rejected", () => {
  const { tag, error } = resolveOutTag(["--reps", "1", "--out-tag"]);
  assert.equal(tag, null);
  assert.match(error, /invalid --out-tag value/);
  assert.match(error, /undefined/);
});

test("resolveOutTag: traversal-shaped --out-tag is rejected", () => {
  const { tag, error } = resolveOutTag(["--out-tag", "../../x"]);
  assert.equal(tag, null);
  assert.match(error, /invalid --out-tag value/);
  assert.match(error, /\.\.\/\.\.\/x/);
});

test("resolveOutTag: space-containing --out-tag is rejected", () => {
  const { tag, error } = resolveOutTag(["--out-tag", "a b"]);
  assert.equal(tag, null);
  assert.match(error, /invalid --out-tag value/);
});

test("resolveOutTag: flag-shaped --out-tag VALUE (e.g. the next flag itself) is rejected", () => {
  const { tag, error } = resolveOutTag(["--out-tag", "--force"]);
  assert.equal(tag, null);
  assert.match(error, /invalid --out-tag value/);
  assert.match(error, /not starting with "-"/);
});

test("resolveOutTag: a valid explicit tag is accepted unchanged", () => {
  const { tag, error } = resolveOutTag(["--out-tag", "round10manual"]);
  assert.equal(error, null);
  assert.equal(tag, "round10manual");
});

test("resolveOutTag: the omitted-tag default satisfies SAFE_TAG_RE and is deterministic given `now`", () => {
  const fixedNow = () => new Date("2026-01-02T03:04:05.678Z");
  const { tag, error } = resolveOutTag([], { now: fixedNow });
  assert.equal(error, null);
  assert.match(tag, SAFE_TAG_RE, `default tag ${JSON.stringify(tag)} must satisfy SAFE_TAG_RE`);
  assert.equal(tag, "run-2026-01-02T03-04-05-678Z");
  // Two default-tag calls even at the same instant must not collide with a
  // fixed literal (round-9 minor finding #3) — confirm it is actually
  // derived from `now`, not hardcoded.
  const other = resolveOutTag([], { now: () => new Date("2026-01-02T03:04:06.000Z") });
  assert.notEqual(other.tag, tag);
});

// ---------------------------------------------------------------------
// checkNoClobber — the guard must protect the JSON/txt PAIR (round-10
// major finding #1), refuse without touching either file's bytes, and let
// --force through. Scratch dir deliberately contains a space (Rule 5).
// ---------------------------------------------------------------------

function freshScratchDir() {
  return mkdtempSync(join(tmpdir(), "proof08 guards-"));
}

test("checkNoClobber: neither file exists -> not blocked", () => {
  const dir = freshScratchDir();
  const jsonPath = join(dir, "raw-results-x.json");
  const txtPath = join(dir, "x-run-output.txt");
  const result = checkNoClobber({ jsonPath, txtPath, force: false });
  assert.equal(result.blocked, false);
  assert.equal(result.jsonPreexisted, false);
  assert.equal(result.txtPreexisted, false);
  assert.deepEqual(result.collidingPaths, []);
});

test("checkNoClobber: only the JSON half preexisting still blocks (closes the round-9 gap: it must protect the PAIR, not just the JSON)", () => {
  const dir = freshScratchDir();
  const jsonPath = join(dir, "raw-results-x.json");
  const txtPath = join(dir, "x-run-output.txt");
  const originalJsonBytes = "PRE-EXISTING-JSON-MARKER";
  writeFileSync(jsonPath, originalJsonBytes);
  const result = checkNoClobber({ jsonPath, txtPath, force: false });
  assert.equal(result.blocked, true);
  assert.deepEqual(result.collidingPaths, [jsonPath]);
  // The guard itself must not have touched anything.
  assert.equal(readFileSync(jsonPath, "utf8"), originalJsonBytes);
  assert.equal(existsSync(txtPath), false);
});

test("checkNoClobber: only the .txt half preexisting blocks too (this is round-10's actual fix — round-9's guard checked the JSON path only)", () => {
  const dir = freshScratchDir();
  const jsonPath = join(dir, "raw-results-x.json");
  const txtPath = join(dir, "x-run-output.txt");
  const originalTxtBytes = "PRE-EXISTING-TXT-MARKER (e.g. a committed round8-run-output.txt)";
  writeFileSync(txtPath, originalTxtBytes);
  const result = checkNoClobber({ jsonPath, txtPath, force: false });
  assert.equal(result.blocked, true);
  assert.deepEqual(result.collidingPaths, [txtPath]);
  assert.equal(readFileSync(txtPath, "utf8"), originalTxtBytes);
  assert.equal(existsSync(jsonPath), false);
});

test("checkNoClobber: both preexisting, --force -> not blocked (caller may proceed to overwrite)", () => {
  const dir = freshScratchDir();
  const jsonPath = join(dir, "raw-results-x.json");
  const txtPath = join(dir, "x-run-output.txt");
  writeFileSync(jsonPath, "old json");
  writeFileSync(txtPath, "old txt");
  const result = checkNoClobber({ jsonPath, txtPath, force: true });
  assert.equal(result.blocked, false);
  assert.equal(result.jsonPreexisted, true);
  assert.equal(result.txtPreexisted, true);
});

// ---------------------------------------------------------------------
// buildEvidenceMeta — the in-band record run.mjs writes into results.meta.
// Required fix (2): --force overwriting must record
// meta.forced/meta.overwroteExistingFile=true.
// ---------------------------------------------------------------------

test("buildEvidenceMeta: fresh tag, no --force -> forced=false, nothing recorded as overwritten", () => {
  const meta = buildEvidenceMeta({ force: false, jsonPreexisted: false, txtPreexisted: false });
  assert.deepEqual(meta, {
    forced: false,
    overwroteExistingFile: false,
    overwroteExistingJsonFile: false,
    overwroteExistingTxtFile: false,
  });
});

test("buildEvidenceMeta: --force over a preexisting pair -> forced=true, overwroteExistingFile=true (and both detail flags true)", () => {
  const meta = buildEvidenceMeta({ force: true, jsonPreexisted: true, txtPreexisted: true });
  assert.equal(meta.forced, true);
  assert.equal(meta.overwroteExistingFile, true);
  assert.equal(meta.overwroteExistingJsonFile, true);
  assert.equal(meta.overwroteExistingTxtFile, true);
});

test("buildEvidenceMeta: --force typed but nothing actually preexisted -> forced=true, overwroteExistingFile=false (the honestly-distinct case round-9's own follow-up fix called out)", () => {
  const meta = buildEvidenceMeta({ force: true, jsonPreexisted: false, txtPreexisted: false });
  assert.equal(meta.forced, true);
  assert.equal(meta.overwroteExistingFile, false);
});

// ---------------------------------------------------------------------
// deltaVsSpread — renders no verdict below MIN_N_FOR_DIRECTIONAL_VERDICT,
// and renders one at/above it (required fix item 4).
// ---------------------------------------------------------------------

function runDeltaVsSpread(statsA, statsB) {
  const lines = [];
  deltaVsSpread("metric", "unit", statsA, statsB, (v) => String(v), { log: (s) => lines.push(s) });
  return lines.join("\n");
}

test(`deltaVsSpread: below MIN_N_FOR_DIRECTIONAL_VERDICT (${MIN_N_FOR_DIRECTIONAL_VERDICT}) renders NO verdict, either way`, () => {
  const n = MIN_N_FOR_DIRECTIONAL_VERDICT - 1;
  assert.ok(n >= 1, "test assumes MIN_N_FOR_DIRECTIONAL_VERDICT > 1");
  // delta (100) is far bigger than either spread (1) — if the n-guard were
  // deleted, this shape would print "directionally supported", which is
  // exactly the round-9 major-finding-#2 regression this pins against.
  const out = runDeltaVsSpread({ n, median: 100, spread: 1 }, { n, median: 0, spread: 1 });
  assert.match(out, /n too small to judge directionality/);
  assert.doesNotMatch(out, /directionally supported/);
  assert.doesNotMatch(out, /FLAG:/);
});

test(`deltaVsSpread: at MIN_N_FOR_DIRECTIONAL_VERDICT (${MIN_N_FOR_DIRECTIONAL_VERDICT}), delta exceeding both spreads renders "directionally supported"`, () => {
  const n = MIN_N_FOR_DIRECTIONAL_VERDICT;
  const out = runDeltaVsSpread({ n, median: 100, spread: 1 }, { n, median: 0, spread: 1 });
  assert.doesNotMatch(out, /n too small to judge directionality/);
  assert.match(out, /directionally supported/);
});

test(`deltaVsSpread: at MIN_N_FOR_DIRECTIONAL_VERDICT (${MIN_N_FOR_DIRECTIONAL_VERDICT}), delta smaller than a spread renders a FLAG, not a verdict`, () => {
  const n = MIN_N_FOR_DIRECTIONAL_VERDICT;
  const out = runDeltaVsSpread({ n, median: 10, spread: 50 }, { n, median: 0, spread: 1 });
  assert.doesNotMatch(out, /n too small to judge directionality/);
  assert.match(out, /FLAG:/);
  assert.doesNotMatch(out, /directionally supported/);
});

// ---------------------------------------------------------------------
// Wiring: run.mjs must actually CALL these guards and exit before ever
// spawning Electron. Both cases below exit at module top level (before
// `main()` runs), so no Electron process is booted. PROOF08_RESULTS_DIR
// points run.mjs at a disposable temp dir so nothing under the real,
// committed measure/windows/proof-08/results/ is ever read or written by
// this suite.
// ---------------------------------------------------------------------

test("wiring: run.mjs rejects a traversal-shaped --out-tag, writes nothing, exits non-zero, never touches Electron", () => {
  const dir = freshScratchDir();
  const result = spawnSync(process.execPath, [runMjsPath, "--reps", "1", "--crash-reps", "1", "--out-tag", "../../x"], {
    env: { ...process.env, PROOF08_RESULTS_DIR: dir },
    encoding: "utf8",
    timeout: 15000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FATAL: invalid --out-tag value/);
  assert.match(result.stderr, /\.\.\/\.\.\/x/);
  assert.deepEqual(readdirSync(dir), [], "the guard must exit before writing anything under RESULTS_DIR");
});

test("wiring: run.mjs refuses a tag colliding with an already-committed file, without touching that file's bytes, and without creating its .txt companion", () => {
  const dir = freshScratchDir();
  const tag = "round10wiringtest";
  const jsonPath = join(dir, `raw-results-${tag}.json`);
  const txtPath = join(dir, `${tag}-run-output.txt`);
  const originalBytes = JSON.stringify({ meta: { outTag: tag, note: "pretend prior committed evidence" } });
  writeFileSync(jsonPath, originalBytes);

  const result = spawnSync(process.execPath, [runMjsPath, "--reps", "1", "--crash-reps", "1", "--out-tag", tag], {
    env: { ...process.env, PROOF08_RESULTS_DIR: dir },
    encoding: "utf8",
    timeout: 15000,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to overwrite committed evidence/);
  assert.match(result.stderr, new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(readFileSync(jsonPath, "utf8"), originalBytes, "the pre-existing committed JSON must be byte-identical after the refused run");
  assert.equal(existsSync(txtPath), false, "no .txt companion must be created when the run is refused");
});
