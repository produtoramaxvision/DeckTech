// PROOF-04 — dedupe a list of resolved shortcut entries by normalized
// target path. Extracted out of measure/windows/scan-apps.mjs (round-3
// review finding 2) so the dedupe step is independently testable and so
// its ordering relative to measure/windows/lib/uninstaller-rule.mjs's
// partitionUninstallers() can be pinned by a unit test instead of only
// being exercisable by running the live PowerShell probe on a Windows
// machine. See measure/windows/lib/resolve-app-list.mjs for why the order
// matters and docs/adr/PROOF-04-uninstaller-exclusion-rule.md §4c for the
// measured evidence.
//
// Case-insensitive key: NTFS is case-preserving but not case-sensitive by
// default, so two shortcuts differing only in target case are the same
// file on Windows. Keeps the FIRST entry walked for a given target and
// silently drops the rest (including their `arguments`) — this is exactly
// the behavior PLAT-02 (.maxvision/REQUIREMENTS.md:56) locks in as "dedupe
// por target path" for the app list Phase 3 will ship, so it is preserved
// here unchanged; only WHEN it runs in the pipeline changed (see
// resolve-app-list.mjs). Pinned by a dedicated test
// (test/windows-dedupe-target.test.mjs, "duas entradas cujo target difere
// só em caixa colapsam em 1") that fails if `.toLowerCase()` is removed —
// round-4 review finding 1 measured that the pre-existing suite did not
// catch that mutation (M27 SURVIVED at 19/19) before this test existed.
//
// Round-4 review finding 2: an entry whose `target` is not a non-empty
// string (null, undefined, or a missing field) cannot be used as a Map
// key. resolve-app-list.mjs's own JSDoc documents `target` as
// `string | null`, and uninstaller-rule.mjs's `isUninstallerEntry` doc
// explicitly promises such entries are "never excluded by this rule" (so
// they land in `partitionUninstallers`'s `kept` and are handed straight to
// this function by resolveAppList) — so calling `.toLowerCase()`
// unconditionally on `entry.target` here contradicted both sibling
// modules' documented contracts and threw a bare TypeError the moment a
// real caller (Phase 3's future win32 apps.js provider, which will not
// necessarily have measure/windows/scan-apps.mjs:141's own pre-filter) hit
// it. Not reachable through scan-apps.mjs today (that pre-filter already
// guarantees every `target` reaching this pipeline is a non-empty string),
// but a latent crash in a module this ADR's own header names as the one
// Phase 3 will import directly.
//
// Fixed here, deliberately, not by narrowing the caller's contract: an
// entry whose target cannot be turned into a key is passed through
// UNTOUCHED — one row in the output per such entry, never collapsed
// against another unkeyable entry (two different broken/unresolved
// shortcuts are not "the same app" just because neither has a usable
// target) and never collapsed against a keyed entry either. This keeps the
// function total (no input shape it accepts throws) instead of pushing the
// validation burden onto every current and future caller. An empty string
// (`""`) is treated the same as null/undefined/missing for this purpose —
// round-3's implementation would have silently collapsed two DIFFERENT
// empty-target entries into one (both key to `""`), which is the same
// wrong-conflation failure mode as the crash, just silent instead of
// thrown; that silent-collapse behavior was never pinned by a test and is
// changed here rather than preserved. Pinned by
// test/windows-dedupe-target.test.mjs for all three unkeyable shapes
// ({target: null}, {target: ""}, and a missing `target` field) so this
// module's contract cannot drift out of sync with resolveAppList's own
// JSDoc (resolve-app-list.mjs) or isUninstallerEntry's `target` parameter
// doc (uninstaller-rule.mjs) again — cited by symbol, not line number, so
// the reference does not rot as these heavily-commented files grow
// (round-4 review finding 3).
//
// @param {Array<{target?: string | null}>} list
// @returns {Array} one entry per unique (lowercased) non-empty-string
//   target, first-walked wins; every entry whose target is not a
//   non-empty string is passed through untouched, one row each, in its
//   original relative position, never deduped against anything.
export function dedupeByTarget(list) {
  const seenTargets = new Set();
  const result = [];
  for (const entry of list) {
    if (typeof entry.target !== "string" || entry.target === "") {
      result.push(entry);
      continue;
    }
    const key = entry.target.toLowerCase();
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);
    result.push(entry);
  }
  return result;
}
