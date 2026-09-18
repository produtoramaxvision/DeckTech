// PROOF-04 — exclusion rule for uninstaller entries in the Windows app scan.
// Pure predicate, no I/O.
//
// `basename()` is imported from `node:path/win32` explicitly, not the
// host-dispatched `node:path`, because this repo's tests run on
// `ubuntu-latest` (`.github/workflows/test.yml`), where plain `node:path`
// would dispatch to POSIX semantics and stop splitting on `\`. See the
// "pins win32 path semantics" test fixture and ADR §9.2 for the measured
// repro of that failure mode.
//
// Consumed today by scan-apps.mjs; intended as the same module Phase 3's
// win32/apps.js provider (PLAT-02) will import, so the rule lives in one
// place.
//
// Design: match the target's basename, not the shortcut's display name by
// substring — see ADR §3 for the precision/recall tradeoff (a substring
// match on the name would drop CrystalIdea's real "Uninstall Tool.exe").

import { basename } from "node:path/win32";

// Exact (not substring), anchored at both ends, so a legitimate app whose
// filename merely *contains* one of these words never matches. Narrower
// than a bare `unins*.exe` glob — see ADR §3 for why, and scan-apps.mjs's
// broader sanity check for how a future gap would surface.
const UNINSTALLER_BASENAME_PATTERNS = [
  /^unins\d*\.exe$/i, // Inno Setup: unins000.exe, unins001.exe, ... any digit count
  /^uninst\d*\.exe$/i, // other installer frameworks' dedicated uninstaller binaries —
  /^uninstall\.exe$/i, // unlike "setup.exe" (shared by install/repair/uninstall,
  /^uninstaller\.exe$/i, // deliberately NOT matched here), each of these is only ever an uninstaller
];

// A shortcut named EXACTLY (not substring) "Uninstall" is, in practice,
// never a standalone legitimate app. Caught a real entry on this machine
// (an OBS plugin's leftover uninstaller) that the basename patterns above
// miss because its target carries the plugin's own product name. See ADR
// §4a; "Uninstall Tool" and "UninstallGuard Pro" both fail this exact match.
const EXACT_UNINSTALL_NAME = /^uninstall$/i;

// msiexec.exe is a generic installer *engine* (install/repair/uninstall
// alike), so it is never matched by basename alone — only when its own
// arguments carry the MSI uninstall verb. See ADR §4b for the real entries
// on this machine this matched.
const MSIEXEC_BASENAME = /^msiexec\.exe$/i;
// `\b` after the verb (not `\s|$`) so `/x{GUID}` (no space) still matches.
// The leading `(^|\s)` matters too: without it, "/x" as a path segment
// inside a legitimate install shortcut's own package path would wrongly
// read as the uninstall verb. Both boundaries pinned by tests — ADR §9.1b
// Group 6.
const MSI_UNINSTALL_ARG = /(^|\s)\/(x|uninstall)\b/i;

/**
 * @param {{ name?: string, target?: string | null, arguments?: string | null }} entry
 *   target: may be null/empty for an unresolved shortcut — never excluded
 *     by this rule (see dedupe-target.mjs for what happens downstream).
 *   arguments: only consulted for the msiexec.exe case.
 * @returns {boolean} true if this entry is an uninstaller.
 */
export function isUninstallerEntry(entry) {
  if (!entry || typeof entry.target !== "string" || entry.target === "") {
    return false;
  }
  const base = basename(entry.target);
  if (UNINSTALLER_BASENAME_PATTERNS.some((pattern) => pattern.test(base))) {
    return true;
  }
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  if (EXACT_UNINSTALL_NAME.test(name) && /\.exe$/i.test(base)) {
    return true;
  }
  if (MSIEXEC_BASENAME.test(base)) {
    const args = typeof entry.arguments === "string" ? entry.arguments : "";
    return MSI_UNINSTALL_ARG.test(args);
  }
  return false;
}

/**
 * Filters a list of resolved shortcut entries, removing uninstallers.
 * @param {Array<{name?: string, target?: string|null}>} entries
 * @returns {{ kept: Array, excluded: Array }}
 */
export function partitionUninstallers(entries) {
  const kept = [];
  const excluded = [];
  for (const entry of entries) {
    (isUninstallerEntry(entry) ? excluded : kept).push(entry);
  }
  return { kept, excluded };
}
