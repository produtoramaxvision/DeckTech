import assert from "node:assert/strict";
import test from "node:test";

import { GRID, SIDEBAR, PICKER, CONNECT, EMPTY_STATE, BULLETS, bulletsFor } from "../design/section7-fixture.mjs";

// TEST-01 — Windows side of the shared PRD §7 fixture.
//
// Phase 7 (UI desktop) has not built the Windows chrome yet — there is no
// live source to read the way test/section7-mac.test.mjs reads
// mac/Sources/*.swift or test/section7-pwa.test.mjs reads public/index.html.
// This file is NOT a placeholder standing in for that absence: it is the
// Phase 7 acceptance contract, in the same idiom
// test/platform-protocol-snapshot.test.mjs already established for "pin an
// independently-authored expectation, fail loud on ANY drift" (PLAT-08).
// There, EXPECTED_ROUTES is compared against routes extracted from the
// live server; here, EXPECTED_WINDOWS_CONTRACT — authored by hand, not
// derived from the fixture — is compared against the live fixture. Phase 7
// imports this same fixture to build the real Windows UI; when that UI
// exists, its own DOM-reading test (per ROADMAP.md Phase 7 criterion 1:
// "nenhuma asserção de UI desta fase em diante é regex sobre código-fonte")
// supersedes the ratification role this file plays today, the same way a
// real running server superseded a hypothetical route stub for PLAT-08.
//
// Why this is a REAL, breakable test and not ceremony: EXPECTED_WINDOWS_CONTRACT
// below was NOT computed from design/section7-fixture.mjs — it is retyped
// by hand. Editing only the fixture (e.g. GRID.columns) without updating
// this constant makes the equality assertions below fail, exactly like
// editing server.js's routes without updating EXPECTED_ROUTES fails PLAT-08.
// This is deliberate: a fixture edit must not "slip through unratified" —
// Phase 7's build target has to be an explicit decision, not a silent
// re-import.

const EXPECTED_WINDOWS_CONTRACT = {
  grid: { columns: 4, rows: 2, pageSize: 8 },
  sidebar: { items: ["Slots", "Conectar"] },
  picker: { searchKey: "picker.search", addedKey: "picker.added", addKey: "picker.add" },
  connect: {
    onlineKey: "connect.online",
    offlineKey: "connect.offline",
    copyURLKey: "connect.copyURL",
    openKey: "connect.open",
    regenerateKey: "confirm.newCodeAction",
    devicesKey: "connect.devices",
  },
  emptyState: { real: true },
};

test("§7 grid: contrato ratificado da Fase 7 bate com a fixture compartilhada", () => {
  assert.equal(GRID.columns, EXPECTED_WINDOWS_CONTRACT.grid.columns, "GRID.columns divergiu do contrato ratificado da Fase 7");
  assert.equal(GRID.rows, EXPECTED_WINDOWS_CONTRACT.grid.rows, "GRID.rows divergiu do contrato ratificado da Fase 7");
  assert.equal(GRID.pageSize, EXPECTED_WINDOWS_CONTRACT.grid.pageSize, "GRID.pageSize divergiu do contrato ratificado da Fase 7");
});

test("§7 sidebar: contrato ratificado bate com a fixture (D4 — 'Slots', não 'Apps')", () => {
  assert.deepEqual(SIDEBAR.items, EXPECTED_WINDOWS_CONTRACT.sidebar.items);
  assert.ok(!SIDEBAR.items.includes("Apps"), "D4: a Fase 7 não pode construir a sidebar com a string stale do PRD");
});

test("§7 app picker: contrato ratificado bate com as chaves i18n da fixture", () => {
  assert.equal(PICKER.searchKey, EXPECTED_WINDOWS_CONTRACT.picker.searchKey);
  assert.equal(PICKER.addedKey, EXPECTED_WINDOWS_CONTRACT.picker.addedKey);
  assert.equal(PICKER.addKey, EXPECTED_WINDOWS_CONTRACT.picker.addKey);
});

test("§7 Conectar: contrato ratificado bate com as chaves i18n da fixture", () => {
  for (const key of Object.keys(EXPECTED_WINDOWS_CONTRACT.connect)) {
    assert.equal(CONNECT[key], EXPECTED_WINDOWS_CONTRACT.connect[key], `CONNECT.${key} divergiu do contrato ratificado da Fase 7`);
  }
});

test("§7/D13: contrato ratificado exige o estado vazio real que o Mac não tem", () => {
  assert.equal(EMPTY_STATE.real, EXPECTED_WINDOWS_CONTRACT.emptyState.real, "Windows deve implementar o estado vazio real (D13)");
  assert.equal(EMPTY_STATE.macHasRealEmptyState, false, "o contrato não pode se basear na ausência de estado vazio do Mac");
});

test("bullets da fixture aplicáveis ao Windows: enumeração completa do §7, nada esquecido", () => {
  const bullets = bulletsFor("windows");
  const ids = bullets.map((b) => b.id).sort();
  // Windows é a superfície mais completa do §7 — todo bullet do contrato
  // visual obrigatório se aplica a ela (é a plataforma nova sendo
  // construída à imagem do Mac). Falha se um bullet novo for adicionado à
  // fixture sem ser marcado para Windows, ou se um existente for removido
  // dela por engano.
  const allIds = BULLETS.map((b) => b.id).sort();
  assert.deepEqual(ids, allIds, "todo bullet do §7 deve se aplicar a Windows — a fixture e este contrato divergiram");
});

test("bullets deferred citam TEST-02 (escopo: extração, não cobertura nova)", () => {
  const deferred = BULLETS.filter((b) => b.status === "deferred");
  assert.ok(deferred.length > 0, "esperava pelo menos um bullet deferred (copy/open/device-count/PIN-regen)");
  for (const b of deferred) {
    assert.equal(b.deferredTo, "TEST-02", `bullet deferred ${b.id} deve apontar para TEST-02`);
  }
});
