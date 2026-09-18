// PROOF-04 — dedupe a list of resolved shortcut entries by normalized
// target path. Runs AFTER uninstaller-rule.mjs's partitionUninstallers()
// in the pipeline (see resolve-app-list.mjs for why the order matters).
//
// Key is lowercased because NTFS is case-preserving but not case-sensitive
// by default. First entry walked for a given target wins — this module's
// own choice; PLAT-02 (.maxvision/REQUIREMENTS.md:56) requires dedupe by
// target path but does not specify which duplicate wins.
//
// An entry whose `target` is not a non-empty string (null/undefined/
// missing/"") cannot key a Map, so it passes through UNTOUCHED — one row
// each, never collapsed against another unkeyable entry or a keyed one.
// This keeps the function total: a future caller (Phase 3's win32 apps.js
// provider) will not necessarily have scan-apps.mjs's own pre-filter.

/**
 * Dedupe a list of resolved shortcut entries by (lowercased) target path.
 * @param {Array<{target?: string | null}>} list
 * @returns {Array} one entry per unique non-empty-string target
 *   (case-insensitive), first-walked wins; every entry whose target is not
 *   a non-empty string passes through untouched, never deduped.
 */
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
