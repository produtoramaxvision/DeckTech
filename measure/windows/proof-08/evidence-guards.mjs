// PROOF-08 evidence-integrity guards, extracted to pure/importable functions.
//
// ROUND-10 FIX (major finding #2): round-9 added three guards
// (--out-tag validation, JSON no-clobber/--force, the directional-verdict
// n-floor) but left them as inline top-level statements in run.mjs, with
// zero automated coverage — the only thing enforcing them was prose in the
// ADR Appendix, the exact failure class round-8 was rejected for ("a header
// comment claiming a protection nothing enforced"). This module pulls the
// argv/fs-state decision logic OUT of run.mjs's top-level side effects (still
// wired in unchanged there, see run.mjs's own comments at the call sites)
// and into named, pure, synchronously-testable functions — the same
// pattern measure/windows/lib/uninstaller-rule.mjs already established for
// PROOF-04, verified by test/windows-uninstaller-rule.test.mjs. Every
// function here takes plain data in and returns plain data out; none of
// them touch process.exit, console, or (checkNoClobber excepted, which must
// read real fs state to mean anything) anything beyond what's passed in.
// test/windows-proof08-evidence-guards.test.mjs imports this module
// directly and fails if any guard here is deleted or neutered.
import { existsSync } from "node:fs";

// A single filename-safe component: no "/", "\", ":", "." or ".." (nothing
// that can escape RESULTS_DIR via path.join's own normalization), and does
// not start with "-" (so a missing --out-tag VALUE can never be silently
// misread as the next flag). Exported so the test suite can assert against
// the exact same pattern run.mjs enforces, not a copy of it.
export const SAFE_TAG_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Decides the --out-tag this run will use, or reports why a supplied one is
 * invalid. Pure: no process.exit, no fs, no console — `now` is injectable so
 * the default-tag branch is deterministic in tests.
 * @param {string[]} args - process.argv.slice(2)-shaped argv
 * @param {{ now?: () => Date }} [opts]
 * @returns {{ tag: string, error: null } | { tag: null, error: string }}
 */
export function resolveOutTag(args, { now = () => new Date() } = {}) {
  const outTagFlagIndex = args.indexOf("--out-tag");
  if (outTagFlagIndex < 0) {
    // Timestamp-derived, not a fixed literal (round-9 minor finding #3): two
    // default-tag runs, even on the same day, get two different filenames —
    // a bare invocation can never land on a previous round's committed
    // evidence. The produced string is built only from [A-Za-z0-9-], so it
    // satisfies SAFE_TAG_RE by construction; test/windows-proof08-evidence-
    // guards.test.mjs asserts this directly rather than trusting that claim.
    return { tag: `run-${now().toISOString().replace(/[:.]/g, "-")}`, error: null };
  }
  const raw = args[outTagFlagIndex + 1];
  const looksLikeAnotherFlag = typeof raw === "string" && raw.startsWith("-");
  if (typeof raw !== "string" || raw.length === 0 || looksLikeAnotherFlag || !SAFE_TAG_RE.test(raw)) {
    return {
      tag: null,
      error: `invalid --out-tag value: ${JSON.stringify(raw)} — expected a non-empty single filename component matching ${SAFE_TAG_RE} and not starting with "-" (no "/", "\\", ":", "." or ".." — nothing that can escape RESULTS_DIR or be mistaken for another flag).`,
    };
  }
  return { tag: raw, error: null };
}

/**
 * ROUND-10 FIX (major finding #1): round-9's no-clobber guard protected only
 * `raw-results-<tag>.json`. `run.mjs`'s own console-capture .txt companion
 * (added this round, see run.mjs's COMMITTED_TXT_FILE) was written by the
 * ADR's Appendix reproduce line via `| tee`, which truncates its target at
 * pipeline setup — BEFORE this guard (or any guard) can run — so the exact
 * committed evidence the ADR cites by name was destroyed by re-running the
 * ADR's own reproduce instructions. This function now protects the PAIR:
 * blocked is true if EITHER path already exists and `force` is not set, and
 * (this is the load-bearing part) run.mjs must check this BEFORE writing
 * either file — never open/truncate one while still deciding about the
 * other.
 * @param {{ jsonPath: string, txtPath: string, force: boolean }} args
 */
export function checkNoClobber({ jsonPath, txtPath, force }) {
  const jsonPreexisted = existsSync(jsonPath);
  const txtPreexisted = existsSync(txtPath);
  const collidingPaths = [jsonPreexisted ? jsonPath : null, txtPreexisted ? txtPath : null].filter(Boolean);
  return { blocked: collidingPaths.length > 0 && !force, jsonPreexisted, txtPreexisted, collidingPaths };
}

/**
 * ROUND-10 FOLLOW-UP (closing the advisor-review gap the round-9 --force fix
 * itself left, same as round-8's --out-tag fix needed its own follow-up):
 * `results.meta` must say, unconditionally (never `undefined`, which
 * `JSON.stringify` drops silently), whether this run's write replaced an
 * existing committed file — not just that `--force` was typed. Kept as its
 * own function, called from run.mjs with the exact same
 * checkNoClobber(...) output that decided whether to proceed, so the meta
 * this run.mjs writes cannot drift from the decision that let it run.
 */
export function buildEvidenceMeta({ force, jsonPreexisted, txtPreexisted }) {
  return {
    forced: Boolean(force),
    overwroteExistingFile: Boolean(jsonPreexisted || txtPreexisted),
    overwroteExistingJsonFile: Boolean(jsonPreexisted),
    overwroteExistingTxtFile: Boolean(txtPreexisted),
  };
}

// ROUND-9 FIX (major finding #2): a within-arm spread (max−min) computed
// from a handful of reps cannot bound this machine's documented run-to-run
// variation (§6) — at n=1 every arm's spread is 0 BY CONSTRUCTION, so
// `delta < maxSpread` was false for any nonzero delta and the old code
// printed "directionally supported" at n=1, the opposite of the FLAG the
// identical metric earned at n=8 in the committed round-8 evidence. Below
// this floor, no verdict is rendered at all.
//
// ROUND-10 FIX (minor finding #3): the choice of 5 was undocumented. It is
// NOT a statistical power calculation — there was never one; git history
// (the round-9 commit that introduced this constant) shows only the
// reasoning above, which motivates that SOME floor is needed, not why this
// one. The honest basis: 5 is the smallest n this project actually re-ran
// (round9review-n5, committed at results/raw-results-round9review-n5.json /
// results/round9review-n5-run-output.txt) that produced a non-degenerate,
// multi-valued spread per arm and confirmed the guard renders a real
// verdict again once n reaches it — chosen as the cheapest n that
// demonstrated both failure and recovery, not derived from a significance
// target.
//
// `spread` is max−min, so it is monotonically NON-DECREASING as more reps
// are added to a SINGLE sample: raising this constant, or simply running
// more reps at a fixed n≥5, can only make the affirmative "directionally
// supported" verdict harder to earn, never easier — this is a conservative
// bar, not a fixed-alpha significance test, and it gets more conservative
// as reps accumulate. That property holds WITHIN one growing sample; it is
// not what the two committed batteries show ACROSS independent runs at
// different n, where ambient load dominates: arm A's idle-RSS spread was
// 5.3 MB at n=8 (round8-run-output.txt) vs. 9.5 MB at n=5
// (round9review-n5-run-output.txt) — smaller n, bigger spread, because this
// machine's concurrent-process load (documented throughout §6) moved the
// number more than n did. Both things are true at once: more reps in one
// run make the bar strictly harder to clear; comparing spread across
// different runs at different n tells you almost nothing about n alone.
export const MIN_N_FOR_DIRECTIONAL_VERDICT = 5;

/**
 * Prints (via injectable `log`, default `console.log`) the delta-vs-spread
 * comparison for one metric and renders a verdict only at/above
 * MIN_N_FOR_DIRECTIONAL_VERDICT.
 */
export function deltaVsSpread(title, unit, statsA, statsB, fmt, { log = console.log } = {}) {
  if (!statsA || !statsB) return;
  const n = Math.min(statsA.n, statsB.n);
  const delta = Math.abs(statsA.median - statsB.median);
  const maxSpread = Math.max(statsA.spread, statsB.spread);
  log(`\n=== ${title}: delta vs. within-arm spread ===`);
  log(`median delta A vs B: ${fmt(delta)} ${unit} (n: A=${statsA.n}, B=${statsB.n})`);
  log(`A spread: ${fmt(statsA.spread)} ${unit} | B spread: ${fmt(statsB.spread)} ${unit}`);
  if (n < MIN_N_FOR_DIRECTIONAL_VERDICT) {
    log(`n too small to judge directionality (n=${n}, minimum ${MIN_N_FOR_DIRECTIONAL_VERDICT}) — a within-arm spread from fewer reps cannot bound run-to-run variation on this machine; no verdict rendered.`);
    return;
  }
  if (delta < maxSpread) {
    log(`FLAG: median delta (${fmt(delta)} ${unit}) is SMALLER than at least one arm's own spread (${fmt(maxSpread)} ${unit}) — not a reproducible directional claim at this n.`);
  } else {
    log(`Median delta exceeds both arms' spread — directionally supported at this n.`);
  }
}
