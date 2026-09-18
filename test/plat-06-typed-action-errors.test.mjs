import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// PLAT-06 — erros tipados de ação que o companion consegue exibir. Ver
// actions.js (ActionError/classifyOpenFailure/focusApp), server.js (fail())
// e .maxvision/ROADMAP.md (Fase 2, critério de sucesso #2).

const pwa = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const serverSrc = await readFile(new URL("../server.js", import.meta.url), "utf8");
const actionsSrc = await readFile(new URL("../actions.js", import.meta.url), "utf8");

const TYPED_ACTION_CODES = ["FOCUS_RESTRICTED", "APP_NOT_FOUND", "LAUNCH_FAILED"];

test("PLAT-06: server.js mapeia os 3 códigos de ação com mensagem fixa por código (nunca err.message)", () => {
  assert.match(serverSrc, /const ACTION_ERROR_MESSAGES = \{/);
  for (const code of TYPED_ACTION_CODES) {
    assert.match(serverSrc, new RegExp(`${code}:\\s*"`), `faltou mensagem fixa para ${code} em server.js`);
  }
  // fail() não repassa err.message pro corpo da resposta tipada
  const failFn = serverSrc.slice(serverSrc.indexOf("function fail("), serverSrc.indexOf("function readBody("));
  assert.doesNotMatch(failFn, /error:\s*err(\?\.)?\.message/);
});

test("PLAT-06: actions.js exporta ActionError e os 3 códigos são alcançáveis a partir de openApp/focusApp", () => {
  assert.match(actionsSrc, /export class ActionError extends Error/);
  assert.match(actionsSrc, /"APP_NOT_FOUND"/);
  assert.match(actionsSrc, /"LAUNCH_FAILED"/);
  assert.match(actionsSrc, /"FOCUS_RESTRICTED"/);
  // focusApp precisa lançar depois do fallback bem-sucedido, não engolir o erro
  const focusFn = actionsSrc.slice(actionsSrc.indexOf("export async function focusApp"), actionsSrc.indexOf("export async function activateApp"));
  assert.match(focusFn, /await openApp\(name, tools\);\s*\n\s*throw new ActionError\("FOCUS_RESTRICTED"/);
});

test("PLAT-06: PWA localiza os 3 códigos em pt-BR e en, e o companion consegue renderizar cada um (constraint: nenhum code sem copy path)", () => {
  const ptBlockStart = pwa.indexOf('"pt-BR": {') !== -1 ? pwa.indexOf('"pt-BR": {') : pwa.indexOf("pt-BR: {");
  assert.ok(ptBlockStart !== -1, "não achei o bloco pt-BR do I18N");
  for (const code of TYPED_ACTION_CODES) {
    const re = new RegExp(`"error\\.${code}":\\s*"[^"]+"`);
    assert.match(pwa, re, `faltou error.${code} no catálogo PWA`);
  }
  // presentes nos DOIS catálogos, não só em um (senão o fallback genérico
  // mascara silenciosamente a falta — ver serverErrorMessage())
  const matches = [...pwa.matchAll(/"error\.(FOCUS_RESTRICTED|APP_NOT_FOUND|LAUNCH_FAILED)":/g)];
  assert.equal(matches.length, TYPED_ACTION_CODES.length * 2,
    "cada código tipado precisa de exatamente 2 entradas (pt-BR + en) no catálogo");
});

test("PLAT-06: activateApp() da PWA usa o código tipado da resposta, não r.data.error cru", () => {
  const fn = pwa.slice(pwa.indexOf("async function activateApp(name)"), pwa.indexOf("async function activatePiece"));
  assert.match(fn, /data\.code === "FOCUS_RESTRICTED"/);
  assert.match(fn, /serverErrorMessage\(data, "toast\.openFailed"/);
  assert.doesNotMatch(fn, /r\.data\.error/);
});

test("PLAT-06 — DISCRIMINAÇÃO: se o server.js parar de repassar `code` na resposta tipada, esta suíte detecta (documenta o contrato consumido pelos testes acima)", () => {
  // Este teste é a documentação executável do contrato: os testes de
  // integração reais (test/actions-api.test.mjs) fazem a prova de mutação
  // fim-a-fim contra o servidor rodando; aqui fixamos o pedaço de server.js
  // que, se apagado, quebra aquela prova — undo-a-lo localmente reproduz a
  // falha descrita no discrimination_proof da tarefa.
  assert.match(serverSrc, /res\.end\(JSON\.stringify\(\{ ok: false, code, error: typedMessage, \.\.\.extra \}\)\);/);
});
