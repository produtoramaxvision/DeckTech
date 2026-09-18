import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import WebSocket from "ws";
import { startServer } from "../server.js";

// PLAT-08: "Nenhuma rota HTTP nem mensagem WebSocket muda. O port é troca de
// provider, não de protocolo." Este arquivo prova isso com dois pins
// independentes: a tabela de rotas HTTP (estático, lido do texto-fonte) e o
// conjunto de chaves da mensagem WS `apps` (comportamental, lido de uma
// conexão real). test/apps-api.test.mjs, config-api.test.mjs, status-ws.test.mjs
// e actions-api.test.mjs já cobrem o comportamento individual de cada rota —
// o que eles NÃO cobrem, e o que este arquivo cobre, é uma rota nova/renomeada
// que nenhum desses testes pediria para existir (adição silenciosa).

const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");

/** Extrai `req.method` de uma condição `if (...)` textual do handler. */
function methodOf(cond) {
  const both = cond.match(/req\.method === "([A-Z]+)"\s*\|\|\s*req\.method === "([A-Z]+)"/);
  if (both) return [both[1], both[2]].sort().join("|");
  const one = cond.match(/req\.method === "([A-Z]+)"/);
  return one ? one[1] : "*";
}

/**
 * Lê as rotas estáticas (`url.pathname === "..."`) e dinâmicas
 * (`url.pathname.match(/regex/)` seguido de `if (var ...)`) direto do texto
 * de server.js — mesma técnica já usada por test/status-ws.test.mjs para
 * pinar a ordem de registro dos handlers de erro.
 */
function extractRoutes(source) {
  const lines = source.split("\n");
  const routes = [];

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith("if (")) continue;
    if (t.includes(".startsWith(")) continue; // guarda de auth (/api/*), não é rota
    const staticMatch = t.match(/url\.pathname === "([^"]+)"/);
    if (staticMatch) routes.push({ kind: "static", path: staticMatch[1], method: methodOf(t) });
  }

  const matchRe = /^const (\w+) = url\.pathname\.match\((.+)\);$/;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const m = t.match(matchRe);
    if (!m) continue;
    const [, varName, pattern] = m;
    let method = "*";
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const cond = lines[j].trim();
      if (cond.startsWith(`if (${varName}`)) { method = methodOf(cond); break; }
    }
    routes.push({ kind: "dynamic", pattern, method });
  }

  return routes;
}

// Snapshot fixo — o teste falha se a extração acima devolver algo diferente
// disto, seja por rota adicionada, removida ou renomeada (path, pattern ou
// method). Atualizar esta lista só quando a mudança de protocolo for
// intencional (PLAT-08 permite; um port de provider não deveria tocar aqui).
const EXPECTED_ROUTES = [
  { kind: "static", path: "/health", method: "*" },
  { kind: "static", path: "/api/probe", method: "*" },
  { kind: "static", path: "/api/version", method: "GET" },
  { kind: "static", path: "/api/auth", method: "POST" },
  { kind: "static", path: "/api/pin", method: "*" },
  { kind: "static", path: "/api/apps", method: "*" },
  { kind: "static", path: "/api/config", method: "*" },
  { kind: "static", path: "/api/config/pinned", method: "POST|PUT" },
  { kind: "static", path: "/api/config/pieces", method: "POST" },
  { kind: "static", path: "/api/config/pieces/order", method: "PUT" },
  { kind: "static", path: "/api/status", method: "GET" },
  { kind: "static", path: "/api/apps/installed", method: "*" },
  { kind: "static", path: "/api/obs/state", method: "*" },
  { kind: "static", path: "/api/obs/record", method: "POST" },
  { kind: "static", path: "/api/obs/stream", method: "POST" },
  { kind: "static", path: "/api/obs/stop-all", method: "POST" },
  { kind: "static", path: "/api/obs/scene", method: "POST" },
  { kind: "dynamic", pattern: "/^\\/api\\/config\\/pinned\\/([^/]+)$/", method: "DELETE" },
  { kind: "dynamic", pattern: "/^\\/api\\/config\\/pieces\\/([^/]+)$/", method: "DELETE" },
  { kind: "dynamic", pattern: "/^\\/api\\/pieces\\/([^/]+)\\/open$/", method: "POST" },
  { kind: "dynamic", pattern: "/^\\/api\\/apps\\/([^/]+)\\/activate$/", method: "*" },
  { kind: "dynamic", pattern: "/^\\/api\\/apps\\/([^/]+)\\/icon$/", method: "*" },
];

// Usos de "url.pathname" que não são rota nenhuma — a parede de auth de
// /api/* (linha ~462) e o dispatch de arquivo estático de index.html/sw.js
// (linhas ~888 e ~896). Cada um está contado explicitamente aqui: se o
// código ganhar um branch de rota escrito numa sintaxe que os dois
// extractors acima não reconhecem (ex.: `.startsWith()` num caminho novo,
// um switch, um router de terceiros), a contagem total de ocorrências do
// literal "url.pathname" no arquivo muda mas a lista extraída não — e este
// teste pega a divergência mesmo sem saber nomear a rota nova.
const KNOWN_NON_ROUTE_PATHNAME_USES = 1 /* .startsWith("/api/") — parede de auth */
  + 2 /* const file = url.pathname === "/" ? "/index.html" : url.pathname */
  + 3; /* const isUi = url.pathname === "/" || .endsWith(...) || .endsWith(...) */

test("PLAT-08: tabela de rotas HTTP é exatamente a esperada (falha em rota adicionada, removida ou renomeada)", () => {
  const actual = extractRoutes(serverSource);
  assert.deepEqual(
    actual,
    EXPECTED_ROUTES,
    "tabela de rotas HTTP mudou — atualize EXPECTED_ROUTES só se a mudança de protocolo for intencional (PLAT-08 proíbe mudança de protocolo numa troca de provider)",
  );
});

test("PLAT-08: nenhuma rota nova escapa por sintaxe não reconhecida pelos dois extractors", () => {
  const totalPathnameUses = (serverSource.match(/url\.pathname/g) || []).length;
  const accountedFor = extractRoutes(serverSource).length + KNOWN_NON_ROUTE_PATHNAME_USES;
  assert.equal(
    totalPathnameUses,
    accountedFor,
    "server.js referencia url.pathname em algum lugar não contabilizado por EXPECTED_ROUTES nem por KNOWN_NON_ROUTE_PATHNAME_USES — provável rota nova escrita numa sintaxe que os extractors deste teste não reconhecem",
  );
});

/** Coletor mínimo de mensagens WS — propositalmente não importa de status-ws.test.mjs. */
function collectWs(port) {
  const messages = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const opened = new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.on("message", raw => {
    try { messages.push(JSON.parse(String(raw))); } catch { /* ignore não-JSON */ }
  });
  async function waitForApps(timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = messages.find(m => m && m.type === "apps");
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error("timeout aguardando mensagem type=apps");
      await new Promise(r => setTimeout(r, 20));
    }
  }
  return { ws, opened, waitForApps };
}

const EXPECTED_APPS_WS_KEYS = ["devices", "limits", "pieces", "pinned", "revision", "running", "type", "v"].sort();

test("PLAT-08: mensagem WS 'apps' tem exatamente o conjunto de chaves esperado (falha em chave adicionada, removida ou renomeada)", async () => {
  const { port, close } = await startServer({
    port: 0,
    config: { pinned: ["Figma"] },
    appTools: { listAppProcesses: async () => [{ name: "Chrome", pid: 9, type: "Foreground" }] },
  });
  const client = collectWs(port);
  try {
    await client.opened;
    const apps = await client.waitForApps();
    assert.deepEqual(
      Object.keys(apps).sort(),
      EXPECTED_APPS_WS_KEYS,
      "chaves da mensagem WS 'apps' mudaram — PLAT-08 proíbe isso numa troca de provider",
    );
    // confirma que o pin observado na doc do requisito (pieces, revision, pinned,
    // running, devices, v, limits) está de fato presente — "v" é condicional a
    // `version` em createStatusFeed, e startServer() sempre fornece um.
    for (const key of ["pieces", "revision", "pinned", "running", "devices", "v", "limits"]) {
      assert.ok(Object.prototype.hasOwnProperty.call(apps, key), `chave documentada ausente: ${key}`);
    }
  } finally {
    try { client.ws.close(); } catch { /* noop */ }
    await close();
  }
});
