// Shared Win32 path normalizer for the koffi bridge.
//
// Round-2 review finding 3 (major): the koffi bridge used `path.resolve()`
// (Node's own, JS-implemented path logic) while the N-API addon passed the
// raw string straight to SHCreateItemFromParsingName with NO normalization.
// A forward-slash path ("C:/Windows/System32/notepad.exe") worked on koffi
// and returned E_INVALIDARG (hr=0x80070057) on the addon — the two
// "identical" candidates were doing UNEQUAL work, and the app list
// (list-apps.mjs) happened to hide this because every path it emits is
// already an absolute, backslash path from path.resolve().
//
// Fix: both bridges now normalize by calling the SAME Win32 API,
// GetFullPathNameW, directly — not by re-implementing its behavior in JS.
// The addon calls it in C++ (see addon-icon/icon_addon.cc); this module
// binds the identical function via koffi so the JS-side bridge performs the
// literal same OS-level normalization, not merely an equivalent one.
//
// Documented contract (verified empirically below, not assumed):
//   - Converts '/' to '\' and resolves '.'/'..' segments.               -> handled
//   - Resolves a relative path against the CURRENT WORKING DIRECTORY.   -> handled
//   - Strips trailing dots/spaces from the final path component.       -> handled
//   - Does NOT expand %ENVIRONMENT% variables (registry DisplayIcon
//     values commonly carry these) — caller must run ExpandEnvironmentStringsW
//     (or Node's own logic) BEFORE calling this.                        -> NOT handled here
//   - Does NOT strip surrounding quotes (`"C:\...\app.exe"`) or a
//     trailing `,<icon-index>` suffix (both common in registry
//     DisplayIcon values) — caller must strip these first.              -> NOT handled here
// PROOF-01's benchmark only exercises Start-Menu-derived, already-plain
// paths, so none of the NOT-handled cases are exercised by the numbers in
// the ADR; they are documented here because PLAT-03 (which THIS ADR feeds)
// will see registry DisplayIcon values, and silently mishandling them would
// be exactly the kind of Windows-path bug this project exists to avoid.
import koffi from "koffi";

const kernel32 = koffi.load("kernel32.dll");

// DWORD GetFullPathNameW(LPCWSTR lpFileName, DWORD nBufferLength, LPWSTR lpBuffer, LPWSTR *lpFilePart)
// lpBuffer is passed as a raw Buffer (koffi marshals a Node Buffer as a
// pointer to its backing memory for a `void *` parameter), which the OS
// writes into in place; we then decode that same memory as UTF-16LE. This
// is the identical calling pattern verified by hand against real output
// before being relied on (see docs/adr/0001 "Método" section).
const GetFullPathNameW = kernel32.func("__stdcall", "GetFullPathNameW", "uint32", [
  "str16", // lpFileName
  "uint32", // nBufferLength, in WCHARs
  "void *", // lpBuffer (out)
  "void *", // lpFilePart (unused; null)
]);

const PATH_BUF_CHARS = 32768; // generous; real Win32 MAX_PATH-extended limit

/**
 * Normalizes `input` via the real GetFullPathNameW Win32 API — the same
 * call the N-API addon makes internally — so both bridges do identical
 * normalization work.
 * @param {string} input
 * @returns {string} absolute, backslash-separated path
 */
export function normalizeWin32Path(input) {
  if (typeof input !== "string" || input.length === 0) {
    throw new TypeError(`normalizeWin32Path: expected non-empty string, got ${JSON.stringify(input)}`);
  }
  const buf = Buffer.alloc(PATH_BUF_CHARS * 2);
  const written = GetFullPathNameW(input, PATH_BUF_CHARS, buf, null);
  if (written === 0) {
    throw new Error(`GetFullPathNameW failed (returned 0) for path: ${input}`);
  }
  if (written >= PATH_BUF_CHARS) {
    throw new Error(`GetFullPathNameW: normalized path too long (${written} chars) for: ${input}`);
  }
  return buf.toString("utf16le", 0, written * 2);
}
