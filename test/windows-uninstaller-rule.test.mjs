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
// Platform-independent by design (see module header): the predicate takes
// only the already-resolved {name, target} shape, so this suite runs on any
// OS and does not depend on the real Windows scan in scan-apps.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { isUninstallerEntry, partitionUninstallers } from "../measure/windows/lib/uninstaller-rule.mjs";

test("exclui o achado real: Uninstall DJI Assistant 2 -> unins000.exe", () => {
  const entry = {
    name: "Uninstall DJI Assistant 2",
    target: "C:\\Program Files (x86)\\DJI Assistant 2\\unins000.exe",
  };
  assert.equal(isUninstallerEntry(entry), true);
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
