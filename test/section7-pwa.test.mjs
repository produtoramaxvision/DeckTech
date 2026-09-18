import assert from "node:assert/strict";
import test from "node:test";
import { startServer } from "../server.js";

import { GRID } from "../design/section7-fixture.mjs";

// TEST-01 — PWA side of the shared PRD §7 fixture. Same grid contract as
// test/section7-mac.test.mjs and test/section7-windows.test.mjs, read from
// the real served HTML instead of a second hand-typed regex copy.
//
// Scope note (advisor-confirmed, re-verified by grep before writing this
// file): public/index.html is the phone/browser COMPANION, not the host.
// It has no sidebar (Slots/Conectar), no explicit reorder mode and no app
// picker — `grep -n "picker do host Mac" public/index.html` confirms the
// companion's own comment says picking/pinning happens on the host, not
// here. Its login modal is PIN *entry*, not the host's Conectar screen
// (PIN/URL/QR/status/device-count/regenerate). Those bullets are therefore
// NOT asserted here — see design/section7-fixture.mjs BULLETS, none of
// which tag "pwa" for sidebar-nav, reorder-mode, app-picker or the connect-*
// bullets. Only "grid-4x2" is tagged for all three surfaces, which is what
// this file asserts.

test("§7 grid: pageSize e grid-template do PWA batem com a fixture compartilhada", async () => {
  const { port, close } = await startServer(0);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`);
    const html = await r.text();

    const pageSizeRe = new RegExp(`function pageSize\\(\\)\\{ return ${GRID.pageSize}; \\}`);
    assert.match(html, pageSizeRe, `esperava pageSize() retornar ${GRID.pageSize} (fixture GRID.pageSize)`);

    const columnsRe = new RegExp(`grid-template-columns: repeat\\(${GRID.columns}, var\\(--tile\\)\\)`);
    const rowsRe = new RegExp(`grid-template-rows: repeat\\(${GRID.rows}, var\\(--tile\\)\\)`);
    assert.match(html, columnsRe, `esperava grid-template-columns repeat(${GRID.columns}, ...) (fixture GRID.columns)`);
    assert.match(html, rowsRe, `esperava grid-template-rows repeat(${GRID.rows}, ...) (fixture GRID.rows)`);

    // Indicadores de página e peek lateral (existência — os detalhes finos
    // continuam em test/ui.test.mjs, que não é duplicado aqui).
    assert.match(html, /id="vdots"/, "indicadores de página (dots) devem existir");
    assert.match(html, /function syncDots\(pageIdx\)/, "sincronização dos indicadores deve existir");
    assert.match(html, /className = "page-grid"/, "peek lateral: grid interna do pager deve existir");
  } finally {
    await close();
  }
});

// A escolha de escopo em si — por que sidebar, reorder mode e app picker
// não são bullets "pwa" — já está documentada e é aplicada pela própria
// fixture (nenhum desses ids em BULLETS marca "pwa" em `surfaces`; ver
// design/section7-fixture.mjs e o comentário no topo deste arquivo). Um
// teste `doesNotMatch` contra sintaxe Swift literal ("case apps = ...")
// ou um identificador Swift ("isReordering") dentro de public/index.html
// não consegue falhar de forma realista — não fazia parte da prova de
// discriminação de TEST-01 e foi removido por não fechar nada.
