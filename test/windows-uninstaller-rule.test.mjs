// PROOF-04 — the uninstaller-exclusion rule must remove uninstaller entries
// from the Windows app scan, and must NOT remove legitimate apps whose name
// happens to contain "uninstall". Every assertion below fails if the rule
// in measure/windows/lib/uninstaller-rule.mjs is deleted or neutered:
//   - deleting the module breaks the import (fails the whole file)
//   - a no-op predicate (`return false` always) fails every "excludes ..."
//     assertion below, because `isUninstallerEntry(...)` would be false
//   - a naive "name contains 'uninstall'" predicate fails the false-positive
//     assertions below, because they assert legitimate apps are KEPT
//
// Host-OS-independent by design, but NOT because the predicate makes "no
// platform calls" (round-1/round-2 phrasing, which was false — `basename()`
// is exactly a platform call). It is independent because the module
// imports `basename` from `node:path/win32` specifically, so its behavior
// is pinned to Windows path semantics regardless of which OS runs this
// suite. Round-3 review found the module importing plain `node:path`
// instead (host-dispatched) and reproduced the failure directly: on a POSIX
// host, `node:path`'s `basename()` resolves to `path.posix.basename`, which
// does not split on `\`, so every backslash-only Windows-path fixture below
// stopped matching — 5 of these 13 tests failed. This repo's own
// `.github/workflows/test.yml` runs `npm test` (`node --test`, all of
// test/) on `ubuntu-latest`, so that gap was live, not theoretical. The
// "pins win32 path semantics" test below documents the exact mechanism and
// fails again if the module ever reverts to host-dispatched `node:path`.
// This suite does not depend on the real Windows scan in scan-apps.mjs
// either way — the predicate takes only the already-resolved
// {name, target, arguments} shape.

import test from "node:test";
import assert from "node:assert/strict";
import { basename as win32Basename } from "node:path/win32";
import { basename as posixBasename } from "node:path/posix";
import { isUninstallerEntry, partitionUninstallers } from "../measure/windows/lib/uninstaller-rule.mjs";

test("exclui o achado real: Uninstall DJI Assistant 2 -> unins000.exe", () => {
  const entry = {
    name: "Uninstall DJI Assistant 2",
    target: "C:\\Program Files (x86)\\DJI Assistant 2\\unins000.exe",
  };
  assert.equal(isUninstallerEntry(entry), true);
});

test("pina a semântica win32 do path: basename() do módulo deve usar node:path/win32, não node:path host-dispatched", () => {
  const target = "C:\\Program Files\\Some App\\unins000.exe";
  // Sanity check on the test itself, not on the module: this fixture only
  // discriminates win32 vs posix basename() if the two genuinely disagree
  // for this input. If they ever agreed (e.g. someone changed the fixture
  // to a forward-slash path), the assertion below would pass vacuously
  // under EITHER import and prove nothing — exactly what rule zero warns
  // against. Failing loudly here, before the real assertion, means a
  // future edit to this fixture cannot silently stop discriminating.
  assert.notEqual(
    win32Basename(target),
    posixBasename(target),
    "sanity: fixture must produce different basenames under win32 vs posix semantics",
  );
  assert.equal(win32Basename(target), "unins000.exe");
  assert.equal(posixBasename(target), target, "posix basename() does not split on backslash, by definition");
  // The real assertion: if measure/windows/lib/uninstaller-rule.mjs ever
  // reverts its top-of-file `import { basename } from "node:path/win32"`
  // back to the host-dispatched `import { basename } from "node:path"`, this
  // fixture fails on any POSIX host (including .github/workflows/test.yml's
  // ubuntu-latest runner) because posix basename() leaves the whole
  // backslash-separated path intact and none of UNINSTALLER_BASENAME_PATTERNS
  // match it.
  assert.equal(isUninstallerEntry({ name: "Uninstall Some App", target }), true);
});

test("exclui variantes numeradas do Inno Setup, incluindo caminho com espaço", () => {
  for (const n of ["unins000.exe", "unins001.exe", "unins.exe"]) {
    assert.equal(
      isUninstallerEntry({
        name: `Uninstall Some App ${n}`,
        // Deliberately has a space in the directory name — Windows path
        // handling is a first-class concern for this project (rule 5).
        target: `C:\\Program Files\\Some App\\${n}`,
      }),
      true,
      `esperava excluir target terminando em ${n}`,
    );
  }
});

test("exclui outros nomes de binário dedicados a desinstalação", () => {
  const targets = [
    "C:\\Program Files\\Foo\\uninst.exe",
    "C:\\Program Files\\Foo\\uninst002.exe",
    "C:\\Program Files\\Foo\\uninstall.exe",
    "C:\\Program Files\\Foo\\uninstaller.exe",
  ];
  for (const target of targets) {
    assert.equal(isUninstallerEntry({ name: "Uninstall Foo", target }), true, target);
  }
});

test("FALSO POSITIVO evitado: app legítimo cujo próprio nome do binário é 'Uninstall Tool.exe'", () => {
  // CrystalIdea "Uninstall Tool" ships its main executable literally named
  // "Uninstall Tool.exe" — a real, shippable product, not installer debris.
  // A substring/name-based rule ("contains uninstall") would drop this; the
  // exact-basename rule here does not, because "Uninstall Tool.exe" is not
  // an exact match for any pattern in UNINSTALLER_BASENAME_PATTERNS.
  const entry = {
    name: "Uninstall Tool",
    target: "C:\\Program Files\\Uninstall Tool\\Uninstall Tool.exe",
  };
  assert.equal(isUninstallerEntry(entry), false);
});

test("FALSO POSITIVO evitado: app cujo NOME contém 'uninstall' mas cujo alvo é um binário comum", () => {
  const entry = {
    name: "UninstallGuard Pro",
    target: "C:\\Program Files\\UninstallGuard\\UninstallGuardPro.exe",
  };
  assert.equal(isUninstallerEntry(entry), false);
});

test("apps comuns não são excluídos", () => {
  const legit = [
    { name: "Notepad++", target: "C:\\Program Files\\Notepad++\\notepad++.exe" },
    { name: "Visual Studio Code", target: "C:\\Users\\MaxVision\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" },
    { name: "Steam", target: "C:\\Program Files (x86)\\Steam\\steam.exe" },
  ];
  for (const entry of legit) {
    assert.equal(isUninstallerEntry(entry), false, entry.name);
  }
});

test("exclui achado real de máquina: shortcut nomeado exatamente 'Uninstall' para plugin OBS (atkAudio)", () => {
  // Encontrado no scan real desta máquina (measure/windows/scan-apps.mjs):
  // o basename do target não bate nenhum padrão de UNINSTALLER_BASENAME_PATTERNS
  // (carrega o nome do produto: "Uninstall atkAudio Plugin.exe"), mas o NOME
  // do atalho é exatamente "Uninstall", sem mais nada.
  const entry = {
    name: "Uninstall",
    target: "C:\\ProgramData\\obs-studio\\plugins\\Uninstall atkAudio Plugin.exe",
  };
  assert.equal(isUninstallerEntry(entry), true);
});

test("o match exato de nome 'Uninstall' não vira substring: 'Uninstall Tool' e 'UninstallGuard Pro' continuam protegidos", () => {
  assert.equal(
    isUninstallerEntry({ name: "Uninstall Tool", target: "C:\\Program Files\\Uninstall Tool\\Uninstall Tool.exe" }),
    false,
  );
  assert.equal(
    isUninstallerEntry({ name: "UninstallGuard Pro", target: "C:\\Program Files\\UninstallGuard\\UninstallGuardPro.exe" }),
    false,
  );
  assert.equal(
    isUninstallerEntry({ name: "  Uninstall  ", target: "C:\\Foo\\Bar\\CustomBinary.exe" }),
    true,
    "espaços em volta do nome exato 'Uninstall' ainda devem casar",
  );
});

test("o guard '.exe' da exceção de nome exato é uma cláusula própria: nome exatamente 'Uninstall' cujo alvo NÃO é .exe permanece", () => {
  // Round-2 finding 1: `EXACT_UNINSTALL_NAME.test(name) && /\.exe$/i.test(base)`
  // (the conjunction inside isUninstallerEntry, uninstaller-rule.mjs) is
  // a two-clause conjunction. Every other
  // fixture for the exact-name path already has a `.exe` target, so it
  // cannot distinguish "the name-match clause fired" from "the .exe guard
  // clause also fired" -- deleting the `.exe` guard left the suite green.
  // This fixture pins the guard on its own: the display name is exactly
  // "Uninstall" (would satisfy EXACT_UNINSTALL_NAME alone), but the
  // resolved target is a .txt, not an executable, so the entry must NOT be
  // treated as an uninstaller. ADR §4a states the .exe requirement is
  // deliberate; this is that decision, pinned.
  assert.equal(
    isUninstallerEntry({ name: "Uninstall", target: "C:\\Program Files\\Some App\\Uninstall.txt" }),
    false,
    "nome exato 'Uninstall' com alvo não-.exe não deve ser tratado como desinstalador",
  );
});

test("exclui achado real de máquina: msiexec.exe /x {GUID} (Uninstall Go, Uninstall Node.js)", () => {
  assert.equal(
    isUninstallerEntry({
      name: "Uninstall Go",
      target: "C:\\Windows\\System32\\msiexec.exe",
      arguments: "/x {5370C587-5FA3-4F85-8287-6483B693690C}",
    }),
    true,
  );
  assert.equal(
    isUninstallerEntry({
      name: "Uninstall Node.js",
      target: "C:\\Windows\\SysWOW64\\msiexec.exe",
      arguments: "/x {34499F1F-2970-4D10-9161-55FB08B9FE2D}",
    }),
    true,
  );
  assert.equal(
    isUninstallerEntry({ name: "Repair Foo", target: "C:\\Windows\\System32\\msiexec.exe", arguments: "/uninstall {GUID}" }),
    true,
  );
  // No space between the verb and the GUID — equally valid MSI syntax
  // (`msiexec /x{GUID}`), not observed on this machine but not something
  // the rule should depend on the vendor's shortcut happening to have a
  // space to catch.
  assert.equal(
    isUninstallerEntry({
      name: "Uninstall Something",
      target: "C:\\Windows\\System32\\msiexec.exe",
      arguments: "/x{5370C587-5FA3-4F85-8287-6483B693690C}",
    }),
    true,
    "/x{GUID} sem espaço também deve ser tratado como desinstalação",
  );
});

test("FALSO POSITIVO evitado: msiexec.exe sem verbo de desinstalação (install/repair) permanece um app normal", () => {
  const installVerbs = ["/i {GUID}", "/package {GUID}", "/fa {GUID}", "/j m {GUID}", ""];
  for (const args of installVerbs) {
    assert.equal(
      isUninstallerEntry({ name: "Some App Installer Shortcut", target: "C:\\Windows\\System32\\msiexec.exe", arguments: args }),
      false,
      `args="${args}" não deveria ser tratado como desinstalação`,
    );
  }
});

test("atalho não resolvido (target vazio/null) nunca é excluído por esta regra", () => {
  assert.equal(isUninstallerEntry({ name: "Alguma Coisa", target: null }), false);
  assert.equal(isUninstallerEntry({ name: "Alguma Coisa", target: "" }), false);
  assert.equal(isUninstallerEntry({ name: "Alguma Coisa" }), false);
});

// Round-4 review finding 1: anchoring (^/$) and case-insensitivity (/i) are
// the mechanisms UNINSTALLER_BASENAME_PATTERNS's own header (see
// uninstaller-rule.mjs, "Anchored at both ends so a legitimate app whose
// filename merely *contains* one of these words never matches") and the
// predicate's JSDoc ("any case") name as load-bearing, but round 3's suite
// never pinned either: dropping `^`/`$` or `/i` from any of the four
// UNINSTALLER_BASENAME_PATTERNS entries, from MSIEXEC_BASENAME, or from the
// exact-name exception's own two `/i` sites (EXACT_UNINSTALL_NAME and the
// `.exe` guard at the end of isUninstallerEntry) all left the round-3 suite
// green. Each fixture below was checked with `node -e` against both the
// real (anchored/case-insensitive) pattern and the specific mutant it
// targets before being committed here — see the ADR §9.1 for the verified
// node -e output and the re-run mutation table.
//
// Anchoring has three independently-mutable shapes per pattern — drop the
// leading `^` only, drop the trailing `$` only, or drop both — so each
// pattern below gets TWO fixtures: a "prefix" fixture (extra text BEFORE
// the pattern's word) that a dropped-`^` (or dropped-both) mutant would
// wrongly match, and a "suffix" fixture (extra text AFTER `.exe`) that a
// dropped-`$` (or dropped-both) mutant would wrongly match. A prefix
// fixture alone does NOT discriminate a dropped-`$`-only mutant (still
// anchored at the start, so a prefixed string never matches it either way)
// and a suffix fixture alone does NOT discriminate a dropped-`^`-only
// mutant, by the same logic in reverse — confirmed with `node -e` for every
// cell below, not assumed from the pattern shape.
test("ANCORAGEM (prefixo): nome contém o padrão como substring no MEIO/FIM do basename e deve permanecer kept — pina ^ (e a remoção combinada de ^+$)", () => {
  const kept = [
    // Reviewer-specified fixtures (round-4 finding 1's required-fix list).
    { name: "App Uninstall Helper", target: "C:\\Program Files\\Foo\\AppUninstall.exe" }, // pins UNINSTALLER_BASENAME_PATTERNS[2] (/^uninstall\.exe$/i)
    { name: "Smart Uninstaller Suite", target: "C:\\Program Files\\Foo\\SmartUninstaller.exe" }, // pins [3] (/^uninstaller\.exe$/i)
    { name: "My Uninst Tool", target: "C:\\Program Files\\Foo\\MyUninst.exe" }, // pins [1] (/^uninst\d*\.exe$/i)
    // Not in the reviewer's list: the reviewer's three fixtures collectively
    // discriminate patterns [1]-[3] but none of them contain "unins" +
    // digits* immediately followed by ".exe" (verified with node -e: none
    // of the three match the unanchored /unins\d*\.exe/i either), so [0]
    // (the Inno Setup pattern — the one the DJI Assistant real-finding
    // itself hits) was left uncovered by the reviewer's own list. Added
    // here so all four patterns actually have a prefix discriminator.
    { name: "Old Unins Backup Tool", target: "C:\\Program Files\\Foo\\MyUnins000.exe" }, // pins [0] (/^unins\d*\.exe$/i)
  ];
  for (const entry of kept) {
    assert.equal(isUninstallerEntry(entry), false, `${entry.target} não deve ser tratado como desinstalador`);
  }
});

test("ANCORAGEM (sufixo): nome termina com lixo APÓS o '.exe' do padrão e deve permanecer kept — pina $ isoladamente (round-4: um prefixo sozinho não pina $)", () => {
  // Round-4 review finding 1, self-caught gap (not in the reviewer's own
  // fixture list): dropping ONLY the trailing `$` from a pattern (leaving
  // `^` intact) does not make any of the four fixtures above wrongly match,
  // because they are all still anchored at the start on a prefix that isn't
  // the pattern's word. A `$`-only mutant needs a fixture with the
  // pattern's exact word at the START of the basename and extra text AFTER
  // it — verified with node -e that each of these matches its
  // `$`-dropped mutant and none of the other three patterns, anchored or
  // not.
  const kept = [
    { name: "Unins Backup Copy", target: "C:\\Program Files\\Foo\\unins000.exe.bak" }, // pins [0]
    { name: "Uninst Backup Copy", target: "C:\\Program Files\\Foo\\uninst002.exe.bak" }, // pins [1]
    { name: "Uninstall Backup Copy", target: "C:\\Program Files\\Foo\\uninstall.exe.bak" }, // pins [2]
    { name: "Uninstaller Backup Copy", target: "C:\\Program Files\\Foo\\uninstaller.exe.bak" }, // pins [3]
  ];
  for (const entry of kept) {
    assert.equal(isUninstallerEntry(entry), false, `${entry.target} não deve ser tratado como desinstalador`);
  }
});

test("CASE-INSENSITIVITY: variantes em MAIÚSCULAS devem ser excluídas — pina /i nos quatro padrões de basename e em MSIEXEC_BASENAME", () => {
  // Round-4 review finding 1: display names are deliberately NOT the exact
  // word "Uninstall" (so the exact-name exception's own, separately-tested
  // /i site can't accidentally cover for a dropped /i on these basename
  // patterns and make the fixture prove nothing — verified with node -e
  // that "Uninstall Foo".trim() fails EXACT_UNINSTALL_NAME either way).
  const excluded = [
    { name: "Uninstall Foo", target: "C:\\Program Files\\Foo\\UNINS000.EXE" }, // pins [0]
    { name: "Uninstall Foo", target: "C:\\Program Files\\Foo\\UNINST002.EXE" }, // pins [1]
    { name: "Uninstall Foo", target: "C:\\Program Files\\Foo\\UNINSTALL.EXE" }, // pins [2]
    { name: "Uninstall Foo", target: "C:\\Program Files\\Foo\\UNINSTALLER.EXE" }, // pins [3]
  ];
  for (const entry of excluded) {
    assert.equal(isUninstallerEntry(entry), true, `${entry.target} deveria ser excluído independente de caixa`);
  }
  // MSIEXEC_BASENAME's own /i: "MsiExec.exe" (mixed case) is the exact
  // casing Windows Installer itself writes into shortcuts (per round-4
  // finding 1's evidence) — not a hypothetical case, the canonical one.
  assert.equal(
    isUninstallerEntry({
      name: "Uninstall Something",
      target: "C:\\Windows\\System32\\MsiExec.exe",
      arguments: "/x {GUID}",
    }),
    true,
    "MsiExec.exe (caixa mista, a grafia canônica do Windows Installer) deve ser reconhecido independente de caixa",
  );
});

test("CASE-INSENSITIVITY, os dois /i não cobertos pela lista do reviewer: EXACT_UNINSTALL_NAME e o guard '.exe' final", () => {
  // Round-4 self-review, going beyond the reviewer's explicit "Must be
  // excluded" list: two more /i sites exist in uninstaller-rule.mjs and
  // were equally untested — EXACT_UNINSTALL_NAME's own /i (line ~75) and
  // the `/\.exe$/i` guard on the exact-name exception (line ~115). Neither
  // is in the round-4 finding's required-fix list, but leaving them
  // uncovered after finding and fixing the other six would be exactly the
  // "closed one instance, declared the table complete" pattern this same
  // finding calls out one level up.
  assert.equal(
    isUninstallerEntry({ name: "UNINSTALL", target: "C:\\Foo\\Bar\\CustomBinary.exe" }),
    true,
    "nome exato 'UNINSTALL' em maiúsculas deve casar com EXACT_UNINSTALL_NAME independente de caixa",
  );
  assert.equal(
    isUninstallerEntry({ name: "UNINSTALL", target: "C:\\Foo\\Bar\\CustomBinary.EXE" }),
    true,
    "guard '.exe' final deve aceitar extensão em maiúsculas (.EXE) independente de caixa",
  );
  assert.equal(
    isUninstallerEntry({
      name: "Uninstall Something",
      target: "C:\\Windows\\System32\\msiexec.exe",
      arguments: "/X {GUID}",
    }),
    true,
    "MSI_UNINSTALL_ARG deve reconhecer o verbo /X em maiúsculas independente de caixa",
  );
});

test("partitionUninstallers separa a lista real medida: 1 excluído de 4, nomeado", () => {
  const scanResult = [
    { name: "Notepad++", target: "C:\\Program Files\\Notepad++\\notepad++.exe" },
    { name: "Uninstall DJI Assistant 2", target: "C:\\Program Files (x86)\\DJI Assistant 2\\unins000.exe" },
    { name: "Steam", target: "C:\\Program Files (x86)\\Steam\\steam.exe" },
    { name: "Uninstall Tool", target: "C:\\Program Files\\Uninstall Tool\\Uninstall Tool.exe" },
  ];
  const { kept, excluded } = partitionUninstallers(scanResult);
  assert.equal(excluded.length, 1, "exatamente 1 entrada deve ser excluída");
  assert.equal(excluded[0].name, "Uninstall DJI Assistant 2");
  assert.equal(kept.length, 3, "as outras 3 entradas, incluindo 'Uninstall Tool', permanecem");
  assert.ok(kept.some((e) => e.name === "Uninstall Tool"), "'Uninstall Tool' é um app legítimo e deve sobreviver ao filtro");
  assert.ok(!kept.some((e) => e.name === "Uninstall DJI Assistant 2"));
});
