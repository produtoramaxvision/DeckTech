#!/usr/bin/env node
// PROOF-08 — ROUND-5 addition (closes minor finding #3). The ADR Appendix's
// round-4 "decode titleB64/classB64 and confirm an accented window title
// round-trips intact" line was a bare `powershell.exe ... enum-windows.ps1`
// invocation with no decode step — it prints raw base64 and decodes
// nothing, so a reader following the Appendix alone could not confirm the
// round-trip claim (round-5 review, minor finding #3). This script is the
// committed decode path: it calls lib.mjs's real `enumAllWindows()` — the
// SAME function windowsForPids() (and through it crash-timeline.mjs, and
// through that the ADR §5 window-survival evidence) actually calls — so
// running this reproduces the exact decode the measurement relies on, not
// a parallel one-off.
//
// It prints every enumerated window as plain (already-decoded) JSON, then a
// summary line counting how many titles contain a non-ASCII character —
// reported honestly even if that count is zero on a given run (a desktop
// with no accented titles open demonstrates nothing either way; the count
// makes that visible instead of silently claiming success).
//
// Usage: node measure/windows/proof-08/decode-windows.mjs
import { enumAllWindows } from "./lib.mjs";

const windows = await enumAllWindows();
for (const w of windows) {
  console.log(JSON.stringify(w));
}
const nonAscii = windows.filter((w) => /[^\x00-\x7F]/.test(w.title) || /[^\x00-\x7F]/.test(w.class));
console.log(`\n${windows.length} windows enumerated; ${nonAscii.length} with a non-ASCII title or class (decoded, printed above).`);
if (nonAscii.length > 0) {
  console.log("non-ASCII sample:", JSON.stringify(nonAscii[0]));
} else {
  console.log("(no non-ASCII title/class present on this desktop right now — this run does not by itself demonstrate the round-trip; re-run while an accented window, e.g. Windows' own Task Switcher, is open.)");
}
