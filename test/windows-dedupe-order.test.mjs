// PROOF-04 round-3 review finding 2 — pins the pipeline ORDER: the
// uninstaller-exclusion rule must run BEFORE dedupe-by-target-path, not
// after. This suite fails if resolve-app-list.mjs is changed back to
// dedupe first (or if someone re-inlines the old dedupe-then-partition
// order directly in scan-apps.mjs instead of using this module).
//
// Concrete failure mode this guards: two shortcuts resolving to the SAME
// msiexec.exe path, one `/i {GUID}` (install — a legitimate app) and one
// `/x {GUID}` (uninstall — debris). Deduping by target BEFORE judging
// arguments keeps whichever shortcut the directory walk visits first and
// throws away the other's `arguments` — so if dedupe runs first and the
// `/x` shortcut is walked first, the surviving (deduped) entry carries
// `/x` arguments and the rule correctly excludes it, but the legitimate
// `/i` shortcut is GONE from the list before the rule ever saw its own
// arguments — a real app silently vanishes. If the `/i` shortcut is walked
// first instead, the opposite happens: the surviving entry carries `/i`
// arguments, the rule (correctly, given only what it's fed) does NOT
// exclude it, and the debris `/x` shortcut is gone too, but now for the
// wrong reason (collapsed away, not judged) — the correct outcome only
// held by the accident of walk order. Both orders are asserted below so
// neither accident of directory-walk order can make this pass by luck.

import test from "node:test";
import assert from "node:assert/strict";
import { resolveAppList } from "../measure/windows/lib/resolve-app-list.mjs";
import { dedupeByTarget } from "../measure/windows/lib/dedupe-target.mjs";

const TARGET = "C:\\Windows\\System32\\msiexec.exe";
const installShortcut = { name: "Some App", target: TARGET, arguments: "/i {5370C587-5FA3-4F85-8287-6483B693690C}" };
const uninstallShortcut = { name: "Uninstall Some App", target: TARGET, arguments: "/x {5370C587-5FA3-4F85-8287-6483B693690C}" };

test("resolveAppList: install-shortcut-walked-first — the uninstall sibling is still excluded on its own arguments, not silently dropped by dedupe", () => {
  const resolved = [installShortcut, uninstallShortcut];
  const { kept, excluded } = resolveAppList(resolved);
  assert.equal(kept.length, 1, "the legitimate /i shortcut must survive");
  assert.equal(kept[0].name, "Some App");
  assert.equal(kept[0].arguments, "/i {5370C587-5FA3-4F85-8287-6483B693690C}");
  assert.equal(excluded.length, 1, "the /x shortcut must be excluded, judged on its own arguments");
  assert.equal(excluded[0].name, "Uninstall Some App");
});

test("resolveAppList: uninstall-shortcut-walked-first (the failure-triggering order) — the /i shortcut still survives", () => {
  // This is the walk order that broke under the OLD dedupe-then-partition
  // pipeline: dedupeByTarget would have kept the /x entry (walked first)
  // and the /i shortcut would never have reached the rule at all.
  const resolved = [uninstallShortcut, installShortcut];
  const { kept, excluded } = resolveAppList(resolved);
  assert.equal(kept.length, 1, "the legitimate /i shortcut must survive regardless of walk order");
  assert.equal(kept[0].name, "Some App");
  assert.equal(kept[0].arguments, "/i {5370C587-5FA3-4F85-8287-6483B693690C}");
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].name, "Uninstall Some App");
});

test("regression guard: dedupe-BEFORE-partition (the old, wrong order) demonstrably loses the /i shortcut's arguments when /x is walked first", () => {
  // Documents the exact bug mechanism, using the same primitive
  // (dedupeByTarget) the old scan-apps.mjs pipeline called first. This does
  // NOT exercise resolveAppList — it proves the old order was actually
  // broken, as a permanent record of why the new order (above) is required.
  const resolved = [uninstallShortcut, installShortcut];
  const wrongOrderDeduped = dedupeByTarget(resolved);
  assert.equal(wrongOrderDeduped.length, 1, "same target collapses to one entry");
  assert.equal(
    wrongOrderDeduped[0].arguments,
    "/x {5370C587-5FA3-4F85-8287-6483B693690C}",
    "walked-first (/x) wins the collapse — the /i shortcut's arguments are gone before any rule runs",
  );
});

test("resolveAppList: excluded list is NOT deduped — two distinct uninstaller shortcuts at the same target are both reported", () => {
  const dup = { name: "Uninstall Some App (per-user copy)", target: TARGET, arguments: "/x {5370C587-5FA3-4F85-8287-6483B693690C}" };
  const { kept, excluded } = resolveAppList([uninstallShortcut, dup]);
  assert.equal(kept.length, 0);
  assert.equal(excluded.length, 2, "both individual uninstaller shortcuts are reported, not collapsed");
});

test("resolveAppList: ordinary apps with distinct targets are unaffected — same behavior as a plain dedupe+partition would give", () => {
  const resolved = [
    { name: "Notepad++", target: "C:\\Program Files\\Notepad++\\notepad++.exe" },
    { name: "Uninstall DJI Assistant 2", target: "C:\\Program Files (x86)\\DJI Assistant 2\\unins000.exe" },
    { name: "Steam", target: "C:\\Program Files (x86)\\Steam\\steam.exe" },
  ];
  const { kept, excluded } = resolveAppList(resolved);
  assert.equal(kept.length, 2);
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].name, "Uninstall DJI Assistant 2");
});

// Round-5 review finding 3 — a null-target entry ("File Explorer" with no
// resolvable target is a real entry from this machine's own scan output)
// must survive the WHOLE pipeline (partitionUninstallers -> dedupeByTarget)
// without throwing, exactly as isUninstallerEntry's and dedupeByTarget's own
// per-function tests already pin in isolation. This is the same input shape
// through the actual composed function scan-apps.mjs calls, not a synthetic
// unit test of either half alone — the shape the review's repro used to crash
// scan-apps.mjs's own basename(e.target) call sites before those were guarded.
test("resolveAppList: a null-target entry survives the whole pipeline untouched, alongside a normal kept entry", () => {
  const resolved = [
    { name: "Notepad++", target: "C:\\Program Files\\Notepad++\\notepad++.exe" },
    { name: "File Explorer", target: null },
  ];
  const { kept, excluded } = resolveAppList(resolved);
  assert.equal(excluded.length, 0);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].name, "Notepad++");
  assert.equal(kept[1].name, "File Explorer");
  assert.equal(kept[1].target, null);
});
