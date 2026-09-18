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
// resolve-app-list.mjs).
//
// @param {Array<{target: string}>} list
// @returns {Array} one entry per unique (lowercased) target, first-walked wins
export function dedupeByTarget(list) {
  const byTarget = new Map();
  for (const entry of list) {
    const key = entry.target.toLowerCase();
    if (!byTarget.has(key)) byTarget.set(key, entry);
  }
  return [...byTarget.values()];
}
