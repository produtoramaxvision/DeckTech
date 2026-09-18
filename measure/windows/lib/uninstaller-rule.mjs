// PROOF-04 — exclusion rule for uninstaller entries in the Windows app scan.
//
// Pure predicate, no I/O. It does call one platform API — `basename()` — but
// deliberately imports it from `node:path/win32`, NOT the host-dispatched
// `node:path`, so its behavior is fixed to Windows path semantics no matter
// which OS runs the process. This matters concretely: the entries this
// predicate receives are always Windows-resolved shortcut TargetPath strings
// (e.g. "C:\\Program Files\\Some App\\unins000.exe"), and this repo's own
// `.github/workflows/test.yml` runs `npm test` (`node --test`, covering all
// of test/) on `ubuntu-latest`. Round-3 review caught this module importing
// plain `node:path` instead: on a POSIX host that dispatches to
// `path.posix.basename`, which does not split on `\`, so a backslash-only
// Windows path basenames to itself unchanged and every pattern below fails
// to match — 5 of the 13 tests in
// test/windows-uninstaller-rule.test.mjs failed when this was reproduced
// (see git history / the ADR's round-3 section for the exact repro). Fixed
// by importing `node:path/win32` explicitly below; see the "pins win32 path
// semantics" fixture in the test file for the regression guard.
//
// Consumed today by measure/windows/scan-apps.mjs (the Phase 0 probe) and
// intended to be the same module Phase 3 (PLAT-02, platform/win32/apps.js —
// not yet created) imports for the real `listInstalledApps()` provider, so
// the rule lives in exactly one place instead of being re-derived per
// caller.
//
// Design: match the RESOLVED TARGET's basename against a narrow, exact-match
// list of installer-framework uninstaller binary names. Do NOT match on the
// shortcut's display name by substring — see
// docs/adr/PROOF-04-uninstaller-exclusion-rule.md for the concrete
// false-positive this avoids (CrystalIdea's "Uninstall Tool.exe", a real
// shipping product whose own name contains "uninstall"). The one exception,
// below, is an EXACT (not substring) match on the display name being the
// bare word "Uninstall" — a distinct, much narrower signal than "contains
// uninstall"; see the ADR for the real entry on this machine that required it.

import { basename } from "node:path/win32";

// Exact (not substring) basename patterns for uninstaller binaries produced
// by common Windows installer frameworks. Anchored at both ends so a
// legitimate app whose filename merely *contains* one of these words never
// matches — only an exact, whole-basename hit does. Deliberately narrower
// than the ROADMAP's `unins*.exe` glob — see ADR §3's precision/recall
// note for why, and scan-apps.mjs's broader sanity check for how a future
// gap would surface.
const UNINSTALLER_BASENAME_PATTERNS = [
  // Inno Setup: unins000.exe, unins001.exe, ... (three digits, but the
  // digit count is not part of the Inno Setup contract, so match any run
  // of digits, including zero).
  /^unins\d*\.exe$/i,
  // A handful of installer frameworks (Ghost Installer, some NSIS builds,
  // in-house installers) ship a differently-named but equally dedicated
  // uninstaller binary. Each of these is, in practice, never anything
  // *other* than an uninstaller — unlike "setup.exe", which frameworks
  // reuse for install/repair/uninstall alike and which this rule
  // deliberately does NOT match (see ADR).
  /^uninst\d*\.exe$/i,
  /^uninstall\.exe$/i,
  /^uninstaller\.exe$/i,
];

// A shortcut whose DISPLAY NAME is exactly (not merely contains) the bare
// word "Uninstall" — no product name attached — is, in practice, never a
// standalone legitimate app: nobody ships a product literally named
// "Uninstall". This is what caught the real entry found on this machine,
// "Uninstall atkAudio Plugin.exe" (an OBS Studio plugin's leftover
// uninstaller, shortcut named plainly "Uninstall"), which the basename
// patterns above miss because the target's basename carries the plugin's
// product name and does not match any of them.
//
// This is deliberately EXACT-equality, not substring: "Uninstall Tool"
// (CrystalIdea's real product) and "UninstallGuard Pro" both fail this
// check because their names are not exactly "uninstall" — only "Uninstall"
// alone (any case, surrounding whitespace trimmed) matches. See the ADR for
// why substring matching on the name is rejected.
const EXACT_UNINSTALL_NAME = /^uninstall$/i;

// msiexec.exe is a generic installer *engine* shared by installs, repairs
// AND uninstalls alike (unlike unins000.exe, which only ever means
// "uninstall"), so this rule never matches msiexec.exe by basename alone —
// that would drop legitimate apps launched via `msiexec /i ...`. It is only
// an uninstaller when its own arguments say so: `/x` (or `/uninstall`,
// the long form) is the MSI uninstall verb; `/i`, `/package`, `/f`, `/j`
// and friends are install/repair/advertise verbs. Matched on this machine's
// real entries: "Uninstall Go" -> msiexec.exe /x {GUID}, "Uninstall Node.js"
// -> msiexec.exe /x {GUID} — see the ADR.
const MSIEXEC_BASENAME = /^msiexec\.exe$/i;
// `\b` after the verb (not a trailing `\s|$`) so `/x{GUID}` — no space
// before the brace, equally valid MSI syntax — still matches; both real
// entries on this machine happen to use `/x {GUID}` with a space, which
// would have hidden this gap if the no-space form had not been tested.
const MSI_UNINSTALL_ARG = /(^|\s)\/(x|uninstall)\b/i;

/**
 * @param {{ name?: string, target?: string | null, arguments?: string | null }} entry
 *   name: the shortcut's display name (e.g. "Uninstall DJI Assistant 2").
 *   target: the shortcut's resolved target path (e.g.
 *     "C:\\Program Files (x86)\\DJI Assistant 2\\unins000.exe"). May be
 *     null/empty for a shortcut the resolver could not resolve (URL
 *     shortcuts, broken links) — such entries are never excluded by this
 *     rule; that is a different problem than uninstaller exclusion. A
 *     null/empty-target entry that survives partitionUninstallers() this
 *     way is, in turn, never deduped by measure/windows/lib/dedupe-target.mjs's
 *     dedupeByTarget() either (round-4 review finding 2) — it has nothing
 *     to key on, so it passes through untouched. All three modules'
 *     contracts for this input shape are meant to read consistently; see
 *     dedupe-target.mjs's header if that ever needs re-checking.
 *   arguments: the shortcut's argument string, if any (e.g. "/x {GUID}").
 *     Only consulted for the msiexec.exe case, see MSI_UNINSTALL_ARG above.
 * @returns {boolean} true if this entry is an uninstaller and should be
 *   excluded from the app list.
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
 * Thin wrapper kept alongside the predicate so callers (and the test) have
 * one obvious entry point for "apply the rule to a scan result".
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
