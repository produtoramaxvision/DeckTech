import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { GRID, SIDEBAR, PICKER, CONNECT, EMPTY_STATE, bulletsFor } from "../design/section7-fixture.mjs";

// TEST-01 — Mac side of the shared PRD §7 fixture. Every assertion below is
// built FROM the fixture's values (not a second hand-typed copy of them),
// so a value change in design/section7-fixture.mjs changes what this file
// requires the live Mac source to say. See test/section7-pwa.test.mjs and
// test/section7-windows.test.mjs for the other two consumers.

const dockGrid = await readFile(new URL("../mac/Sources/DockGridView.swift", import.meta.url), "utf8");
const contentView = await readFile(new URL("../mac/Sources/ContentView.swift", import.meta.url), "utf8");
const appPicker = await readFile(new URL("../mac/Sources/AppPickerSheet.swift", import.meta.url), "utf8");
const languageStore = await readFile(new URL("../mac/Sources/LanguageStore.swift", import.meta.url), "utf8");

test("§7 grid: pageSize e coluna do Mac batem com a fixture compartilhada", () => {
  const pageSizeRe = new RegExp(`private let pageSize = ${GRID.pageSize}\\b`);
  const columnsRe = new RegExp(`count: ${GRID.columns}\\b`);
  assert.match(dockGrid, pageSizeRe, `esperava pageSize = ${GRID.pageSize} (fixture GRID.pageSize)`);
  assert.match(dockGrid, columnsRe, `esperava GridItem com count: ${GRID.columns} (fixture GRID.columns)`);
  // páginas, peek lateral e indicadores continuam existindo (existência, não regex duplicada
  // dos testes visuais detalhados de test/mac-app-slides-ui.test.mjs).
  assert.match(dockGrid, /private func pageDots\(count: Int\)/, "indicadores de página devem existir");
  assert.match(dockGrid, /carouselPeekRatio/, "peek lateral deve existir");
});

test("§7 sidebar: itens e string shipada batem com a fixture (D4)", () => {
  const [first, second] = SIDEBAR.items;
  assert.match(contentView, new RegExp(`case apps = "${first}"`), `sidebar.items[0] da fixture é "${first}"`);
  assert.match(contentView, new RegExp(`case about = "${second}"`), `sidebar.items[1] da fixture é "${second}"`);
  assert.notEqual(first, "Apps", "D4: a fixture não pode reverter para a string stale do PRD");
});

test("§7 add module e reorder mode explícito existem no Mac", () => {
  assert.match(dockGrid, /case add\(Int\)/, "módulo de adicionar deve existir (TileItem.add)");
  assert.match(dockGrid, /@State private var isReordering = false/, "modo de reorganizar deve ser explícito e opt-in");
});

test("§7 app picker: busca e estado 'Adicionado' batem com as chaves i18n da fixture", () => {
  assert.match(appPicker, new RegExp(`I18n\\.text\\("${PICKER.searchKey.replace(".", "\\.")}"`), "busca deve usar a chave da fixture");
  assert.match(appPicker, new RegExp(`I18n\\.text\\("${PICKER.addedKey.replace(".", "\\.")}"`), "estado Adicionado deve usar a chave da fixture");
  assert.match(appPicker, new RegExp(`I18n\\.text\\("${PICKER.addKey.replace(".", "\\.")}"`), "ação Adicionar deve usar a chave da fixture");
  assert.match(languageStore, /"picker\.added": "Adicionado"/, "pt-BR de picker.added deve ser 'Adicionado', não outra string");
});

test("§7 Conectar: PIN, URL, QR, status e regeneração usam as chaves i18n da fixture", () => {
  assert.match(contentView, /AccessCodeView\(code: store\.pinCode\)/, "PIN deve estar presente");
  assert.match(contentView, /QRCodeView\(value: localURL\)/, "QR Code deve estar presente");
  assert.match(contentView, /Text\(localURL\)/, "URL deve estar presente");
  assert.match(contentView, new RegExp(`I18n\\.text\\("${CONNECT.regenerateKey.replace(".", "\\.")}"`), "regenerar PIN deve usar a chave da fixture");
  assert.match(languageStore, new RegExp(`"${CONNECT.onlineKey.replace(".", "\\.")}": "Servidor online"`), "status online deve existir");
  assert.match(languageStore, new RegExp(`"${CONNECT.offlineKey.replace(".", "\\.")}": "Servidor offline"`), "status offline deve existir");
});

test("§7/D13: o Mac NÃO tem estado vazio real — todo slot livre vira .add (não inverter o contrato)", () => {
  assert.equal(EMPTY_STATE.macHasRealEmptyState, false, "fixture deve registrar que o Mac não tem estado vazio real");
  assert.match(
    dockGrid,
    /guard let piece = byPosition\[index\] else \{ return \.add\(index\) \}/,
    "toda posição livre deve virar .add — a ausência de estado vazio é o comportamento real do Mac",
  );
  assert.doesNotMatch(dockGrid, /isEmpty.*EmptyState|EmptyStateView|estado vazio/i, "o Mac não deve ganhar um EmptyStateView por engano nesta suíte");
});

test("bullets da fixture aplicáveis ao Mac estão todos com id e status válidos", () => {
  const bullets = bulletsFor("mac");
  assert.ok(bullets.length >= 8, "esperava pelo menos os bullets mac-aplicáveis do §7");
  for (const b of bullets) {
    assert.ok(b.id && typeof b.id === "string", "bullet precisa de id");
    assert.ok(["asserted", "partial", "deferred"].includes(b.status), `status inválido em ${b.id}`);
    if (b.status === "deferred") {
      assert.ok(b.deferredTo, `bullet deferred ${b.id} precisa declarar deferredTo`);
    }
  }
});
