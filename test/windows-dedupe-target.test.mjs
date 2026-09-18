// PROOF-04 round-4 review finding 1 + finding 2 — dedicated suite for
// measure/windows/lib/dedupe-target.mjs's dedupeByTarget(), previously only
// exercised indirectly (via test/windows-dedupe-order.test.mjs's msiexec
// fixture and measure/windows/scan-apps.mjs's live probe run).
//
// Finding 1 (mutation M27): removing `.toLowerCase()` from dedupeByTarget's
// key construction left the round-3 suite at 19/19 green — the
// case-insensitive-NTFS-target justification in this module's own header
// had zero test coverage. The first test below fails if `.toLowerCase()`
// is removed; see docs/adr/PROOF-04-uninstaller-exclusion-rule.md §9 for
// the re-run mutation output.
//
// Finding 2: dedupeByTarget previously called `entry.target.toLowerCase()`
// unconditionally, which threw a bare TypeError for {target: null},
// {target: ""} (in the sense that it silently mis-collapsed two distinct
// entries instead — see below) and a missing `target` field — all three
// documented as valid input shapes by resolve-app-list.mjs's and
// uninstaller-rule.mjs's own JSDoc. The remaining tests below pin the
// fixed, total behavior for all three shapes.

import test from "node:test";
import assert from "node:assert/strict";
import { dedupeByTarget } from "../measure/windows/lib/dedupe-target.mjs";

test("duas entradas cujo target difere só em CAIXA colapsam em 1 (NTFS é case-insensitive) — pina .toLowerCase()", () => {
  const list = [
    { name: "Foo (lower)", target: "C:\\Program Files\\Foo\\foo.exe" },
    { name: "Foo (upper, mesmo arquivo no NTFS)", target: "C:\\PROGRAM FILES\\FOO\\FOO.EXE" },
  ];
  const result = dedupeByTarget(list);
  assert.equal(result.length, 1, "mesmo arquivo NTFS (case-insensitive) deve colapsar em uma única entrada");
  assert.equal(result[0].name, "Foo (lower)", "a primeira entrada percorrida deve vencer, como no caso de mesma-caixa");
});

test("target: null — não pode ser chaveado, passa intocado (não lança, não é deduplicado contra nada)", () => {
  const list = [
    { name: "Broken URL shortcut 1", target: null },
    { name: "Broken URL shortcut 2", target: null },
  ];
  const result = dedupeByTarget(list);
  assert.equal(result.length, 2, "duas entradas distintas com target null NÃO são a mesma coisa e não devem colapsar");
  assert.deepEqual(
    result.map((e) => e.name),
    ["Broken URL shortcut 1", "Broken URL shortcut 2"],
  );
});

test("target: '' (string vazia) — mesmo tratamento de null, não colapsa duas entradas distintas", () => {
  // Round-3's implementation did NOT throw on "" (a valid, keyable string),
  // but silently collapsed two UNRELATED empty-target entries into one —
  // the same wrong-conflation failure as the null/undefined crash, just
  // silent instead of thrown. That silent-collapse was never pinned by a
  // test; this fixture pins the corrected (pass-through) behavior instead.
  const list = [
    { name: "Empty target 1", target: "" },
    { name: "Empty target 2", target: "" },
  ];
  const result = dedupeByTarget(list);
  assert.equal(result.length, 2, "duas entradas distintas com target vazio não devem colapsar em uma");
});

test("campo target ausente — mesmo tratamento, não lança", () => {
  const list = [{ name: "No target field at all" }];
  assert.doesNotThrow(() => dedupeByTarget(list));
  const result = dedupeByTarget(list);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "No target field at all");
});

test("entradas sem target e entradas com target se misturam corretamente, mantendo a ordem original", () => {
  const list = [
    { name: "Notepad++", target: "C:\\Program Files\\Notepad++\\notepad++.exe" },
    { name: "Broken shortcut", target: null },
    { name: "Notepad++ (duplicata de caixa)", target: "C:\\PROGRAM FILES\\NOTEPAD++\\NOTEPAD++.EXE" },
    { name: "Steam", target: "C:\\Program Files (x86)\\Steam\\steam.exe" },
  ];
  const result = dedupeByTarget(list);
  assert.deepEqual(
    result.map((e) => e.name),
    ["Notepad++", "Broken shortcut", "Steam"],
    "a duplicata de caixa do Notepad++ é removida; a entrada sem target passa intocada, na sua posição original",
  );
});
