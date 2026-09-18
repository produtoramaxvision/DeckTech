// Round-4 review fix (finding 4, minor): a fixed, known-good probe path
// shared by every script that needs "some real .exe on this machine" for a
// smoke test or a discriminating path-contract row, instead of each script
// hardcoding "C:\\Windows\\System32\\notepad.exe" independently.
//
// This module MUST stay a pure `node:path` computation with ZERO other
// imports and zero side effects. verify-com-apartment-clash.mjs depends on
// controlling the FIRST CoInitializeEx call this Node process ever makes —
// if this module pulled in koffi or the addon transitively, importing it
// would initialize COM before the test's own forced-MTA call runs, and
// silently invalidate the exact scenario that script exists to reproduce.
import path from "node:path";

// process.env.SystemRoot is normally "C:\Windows" but is not guaranteed —
// deriving it (as verify-path-contract.mjs already did) instead of
// hardcoding means this still resolves correctly on a machine where the
// Windows directory was relocated at install time.
export const winDir = process.env.SystemRoot || "C:\\Windows";
export const probeTargetPath = path.join(winDir, "System32", "notepad.exe");
