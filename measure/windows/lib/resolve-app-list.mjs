// PROOF-04 — compose the exclusion rule and the target-path dedupe into
// the pipeline order the app-list scan uses: partition BEFORE dedupe.
//
// Why: the exclusion rule's msiexec branch decides purely on
// `entry.arguments` (uninstaller-rule.mjs's MSI_UNINSTALL_ARG). Deduping
// first keeps only the first shortcut WALKED for a given target and
// discards every sibling's `arguments` before the rule runs — so two
// shortcuts at the same msiexec.exe path, one `/i {GUID}` (install) and one
// `/x {GUID}` (uninstall), collapse to whichever the walk visits first, and
// a legitimate install can silently vanish. Partitioning first judges every
// shortcut on its own `arguments`; only the survivors are then deduped.
// `excluded` is intentionally NOT deduped, so duplicate-across-scope
// uninstaller shortcuts stay visible rather than collapsing away. Measured
// evidence this was live on this machine's own walk order:
// docs/adr/PROOF-04-uninstaller-exclusion-rule.md §4c.

import { partitionUninstallers } from "./uninstaller-rule.mjs";
import { dedupeByTarget } from "./dedupe-target.mjs";

/**
 * Partition a resolved shortcut list into uninstallers vs. kept apps, then
 * dedupe only the kept side by target path.
 * @param {Array<{name?: string, target?: string|null, arguments?: string|null}>} resolved
 *   Every individually-walked shortcut entry, NOT yet deduped by target.
 * @returns {{ kept: Array, excluded: Array }}
 *   kept: deduped by target (first-walked wins); an entry with a
 *     null/empty/missing target is never excluded and passes through
 *     untouched (see uninstaller-rule.mjs, dedupe-target.mjs).
 *   excluded: every individual uninstaller shortcut, one row each, not deduped.
 */
export function resolveAppList(resolved) {
  const { kept, excluded } = partitionUninstallers(resolved);
  return { kept: dedupeByTarget(kept), excluded };
}
