// PROOF-04 — compose the exclusion rule and the target-path dedupe into
// the actual pipeline order the app-list scan uses.
//
// Round-3 review finding 2: measure/windows/scan-apps.mjs previously ran
// dedupeByTarget(resolved) BEFORE partitionUninstallers(deduped). That
// ordering silently starves the exclusion rule's msiexec branch (which
// decides purely on `entry.arguments` — see uninstaller-rule.mjs's
// MSI_UNINSTALL_ARG and ADR §4b) of the one field it needs, for every
// target with 2+ shortcuts whose arguments differ: dedupeByTarget keeps
// only the first shortcut WALKED for a given target and discards every
// sibling's `arguments` before the rule ever runs. Concretely: two
// shortcuts at the SAME msiexec.exe path, one `/i {GUID}` (install) and
// one `/x {GUID}` (uninstall) — whichever the directory walk visits first
// wins the target, and if that's the `/x` one, its arguments get applied
// to the survivor and a legitimate install shortcut silently vanishes from
// the app list. On this machine's real data the two msiexec entries
// happened to survive because they sit at different paths (System32 vs
// SysWOW64) — luck, not design (see docs/adr/PROOF-04-uninstaller-exclusion-rule.md §4b/§4c).
//
// Fix: partition BEFORE dedupe. Every individual shortcut is judged on its
// own `arguments` first; only the survivors (`kept`) are then deduped by
// target. This still honors PLAT-02's "dedupe por target path" requirement
// for the final app list (.maxvision/REQUIREMENTS.md:56) — the semantics
// of dedupeByTarget itself are unchanged (see dedupe-target.mjs) — only
// its position in the pipeline moved, so an arguments-dependent rule never
// sees a collapsed sibling.
//
// `excluded` is intentionally NOT deduped: every individual excluded
// shortcut is reported, because collapsing them would hide exactly the
// kind of duplicate-across-Start-Menu-scope entries (machine-wide vs
// per-user shortcuts to the same uninstaller) this fix exists to stop
// silently discarding.

import { partitionUninstallers } from "./uninstaller-rule.mjs";
import { dedupeByTarget } from "./dedupe-target.mjs";

/**
 * @param {Array<{name?: string, target?: string|null, arguments?: string|null}>} resolved
 *   Every individually-walked shortcut entry, NOT yet deduped by target.
 * @returns {{ kept: Array, excluded: Array }}
 *   kept: legitimate apps, deduped by target path (first-walked wins).
 *   excluded: every individual shortcut the rule identified as an
 *     uninstaller, one row per shortcut (not deduped).
 */
export function resolveAppList(resolved) {
  const { kept, excluded } = partitionUninstallers(resolved);
  return { kept: dedupeByTarget(kept), excluded };
}
