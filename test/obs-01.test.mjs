// OBS-01: logging estruturado no core. Cobre os 3 caminhos hoje silenciosos
// nomeados pelo requisito — mkdirSync engolindo erro (server.js, Q30), a
// cadeia de ícone morrendo sem ruído (W1, apps.js), foco virando 500
// genérico (W3, server.js) — e a prova de que PIN/cookie de sessão nunca
// aparecem no log, mesmo quando o call site passa o corpo inteiro do
// request pro logger.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { createLogger } from "../log.js";
import { startServer, ensureUserDataDir, logBootstrapFailure } from "../server.js";
import { realIconService } from "../apps.js";
import { readPinFile, SESSION_COOKIE } from "../auth.js";

function capture(opts = {}) {
  const lines = [];
  const logger = createLogger({ sink: line => lines.push(line), ...opts });
  return { logger, lines, records: () => lines.map(l => JSON.parse(l)) };
}

// ---------------------------------------------------------------------
// Q30 / server.js:935 — mkdirSync não pode mais engolir o erro em silêncio
// ---------------------------------------------------------------------

test("mkdir: falha loga erro com o path tentado (inclusive com espaço) e NÃO lança", () => {
  const { logger, records } = capture({ level: "debug" });
  // path.join, nunca concatenação — regra 4. "Some User" exercita espaço.
  const dir = join("C:", "Users", "Some User", "AppData", "Local", "DeckTech");
  const boom = new Error("simulated EPERM");
  boom.code = "EPERM";
  const ok = ensureUserDataDir(dir, { log: logger, mkdirFn: () => { throw boom; } });
  assert.equal(ok, false, "reporta falha via retorno, nunca lança");
  const attempt = records().find(r => r.event === "userdata.mkdir.attempt");
  const failed = records().find(r => r.event === "userdata.mkdir.failed");
  assert.ok(attempt, "entrada registrada");
  assert.equal(attempt.path, dir, "path com espaço sobrevive intacto no registro de entrada");
  assert.ok(failed, "falha registrada — antes era `catch (e) {}`, sem diagnóstico nenhum");
  assert.equal(failed.level, "error");
  assert.equal(failed.code, "EPERM");
  assert.equal(failed.path, dir, "path com espaço sobrevive intacto no registro de falha");
});

test("mkdir: sucesso loga ok (visível só em nível debug) e retorna true", () => {
  const { logger, records } = capture({ level: "debug" });
  const dir = join("C:", "Users", "Some User", "AppData", "Local", "DeckTech");
  const ok = ensureUserDataDir(dir, { log: logger, mkdirFn: () => {} });
  assert.equal(ok, true);
  assert.deepEqual(records().map(r => r.event), ["userdata.mkdir.attempt", "userdata.mkdir.ok"]);
});

test("mkdir: no nível padrão (warn) o caminho feliz fica quieto — sem ruído em operação normal", () => {
  const { logger, lines } = capture(); // nível padrão, sem override
  ensureUserDataDir(join("C:", "Users", "Some User", "AppData"), { log: logger, mkdirFn: () => {} });
  assert.deepEqual(lines, []);
});

// ---------------------------------------------------------------------
// W1 — cadeia de ícone (apps.js) morrendo sem ruído
// ---------------------------------------------------------------------

test("W1: cadeia de ícone esgotada loga warn com o nome do app MESMO em nível padrão (quieto)", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "j5-icon-log-"));
  try {
    const { logger, records } = capture(); // nível padrão (warn) — não injeta "debug"
    const svc = realIconService({
      scan: async () => [{ name: "SemIcone", path: "/nowhere/SemIcone.app", icon: true }],
      findIcon: async () => null,
      exec: async () => { throw new Error("sips indisponível (simulado)"); },
      cacheDir,
      iconHelper: null,
      log: logger,
    });
    const buf = await svc.getIconPng("SemIcone");
    assert.equal(buf, null);
    const monoFail = records().find(r => r.event === "icon.monogram.failed");
    const done = records().find(r => r.event === "icon.load.done");
    assert.ok(monoFail, "app sem ícone nenhum precisa deixar rastro, mesmo com log quieto por padrão");
    assert.equal(monoFail.name, "SemIcone");
    assert.equal(monoFail.level, "warn");
    assert.ok(done);
    assert.equal(done.source, "none");
    assert.equal(done.level, "warn");
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("W1: nível debug expõe entrada e cada ramo da cadeia (helper → manual → monograma)", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "j5-icon-log-"));
  try {
    const { logger, records } = capture({ level: "debug" });
    const svc = realIconService({
      scan: async () => [{ name: "ComIcone", path: "/apps/ComIcone.app", icon: true }],
      findIcon: async () => "/apps/ComIcone.app/Contents/Resources/icon.icns",
      exec: async () => { throw new Error("sips indisponível (simulado)"); },
      cacheDir,
      iconHelper: "/fake/icon-helper",
      log: logger,
    });
    const buf = await svc.getIconPng("ComIcone");
    assert.equal(buf, null);
    const evs = records().map(r => r.event);
    assert.ok(evs.includes("icon.load.start"), "entrada da cadeia");
    assert.equal(records().find(r => r.event === "icon.load.start").found, true);
    assert.ok(evs.includes("icon.helper.failed"), "ramo do helper NSWorkspace");
    assert.ok(evs.includes("icon.manual.failed"), "ramo do fallback manual");
    assert.ok(evs.includes("icon.monogram.failed"), "ramo do monograma");
    assert.ok(evs.includes("icon.load.done"), "saída da cadeia");
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

function pngChunk(type, data) {
  const name = Buffer.from(type, "latin1");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) {
    crc ^= out[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}

/** PNG RGBA opaco mínimo, válido — usado pra exercitar o caminho de
 *  SUCESSO da cadeia de ícone (source="manual"), não só as falhas. */
function opaqueRgbaPng(size = 4) {
  const stride = size * 4;
  const scanlines = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (stride + 1);
    for (let x = 0; x < size; x++) {
      const p = row + 1 + x * 4;
      scanlines[p] = 10; scanlines[p + 1] = 20; scanlines[p + 2] = 30; scanlines[p + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

test("W1: ícone resolvido com sucesso não loga warn/error nenhum (source='manual')", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "j5-icon-log-"));
  try {
    const iconPath = join(cacheDir, "icon.png");
    await writeFile(iconPath, opaqueRgbaPng());
    const { logger, records } = capture({ level: "debug" });
    const svc = realIconService({
      scan: async () => [{ name: "ComIconeReal", path: "/apps/ComIconeReal.app", icon: true }],
      findIcon: async () => iconPath,
      exec: async () => {},
      cacheDir,
      iconHelper: null,
      log: logger,
    });
    const buf = await svc.getIconPng("ComIconeReal");
    assert.ok(buf, "ícone real resolvido com sucesso");
    const warnsOrErrors = records().filter(r => r.level === "warn" || r.level === "error");
    assert.deepEqual(warnsOrErrors, [], "caminho feliz não produz warn/error — sem ruído no caso comum");
    const done = records().find(r => r.event === "icon.load.done");
    assert.equal(done.source, "manual");
    assert.equal(done.level, "debug");
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------
// W3 — falha de foco virando 500 genérico sem rastro
// ---------------------------------------------------------------------

test("W3: falha de foco vira log com código tipado e contexto do request, não só 500 mudo", async () => {
  const { logger, records } = capture({ level: "debug" });
  const { port, close } = await startServer({
    port: 0,
    log: logger,
    actions: { activateApp: async () => {
      // server.js:917 só lê `.code` (typeof err?.code === "string" ? err.code : null) —
      // não depende da classe ActionError (PLAT-06, ../actions.js), então o teste
      // constrói o erro tipado inline pra não acoplar OBS-01 a trabalho não commitado.
      const e = new Error('focus restricted for "Chrome", opened new instance');
      e.code = "FOCUS_RESTRICTED";
      throw e;
    } },
  });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pid: 777 }),
    });
    assert.equal(r.status, 500);
    const attempt = records().find(x => x.event === "action.activate.attempt");
    const failed = records().find(x => x.event === "action.activate.failed");
    assert.ok(attempt, "entrada registrada — o que foi tentado, com que argumentos");
    assert.equal(attempt.name, "Chrome");
    assert.equal(attempt.pid, 777);
    assert.ok(attempt.requestId, "para qual request");
    assert.ok(failed, "falha registrada — antes esse caminho não deixava rastro nenhum no servidor");
    assert.equal(failed.level, "warn");
    assert.equal(failed.code, "FOCUS_RESTRICTED");
    assert.equal(failed.requestId, attempt.requestId, "mesmo requestId correlaciona entrada e falha");
  } finally { await close(); }
});

test("W3: erro genérico (sem .code) ainda loga mensagem e contexto; code vem null", async () => {
  const { logger, records } = capture({ level: "debug" });
  const { port, close } = await startServer({
    port: 0,
    log: logger,
    actions: { activateApp: async () => { throw new Error("boom"); } },
  });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 500);
    const failed = records().find(x => x.event === "action.activate.failed");
    assert.ok(failed);
    assert.equal(failed.code, null);
    assert.equal(failed.message, "boom");
  } finally { await close(); }
});

// ---------------------------------------------------------------------
// Nunca logar PIN nem cookie de sessão — prova via fluxo de auth real
// ---------------------------------------------------------------------

test("OBS-01: PIN e cookie de sessão NUNCA aparecem no log capturado durante um fluxo de auth real", async () => {
  const root = await mkdtemp(join(tmpdir(), "j5obs-auth-"));
  const { logger, lines, records } = capture({ level: "debug" });
  const { port, close } = await startServer({
    port: 0, root, config: { pinned: [] }, trustLoopback: false, log: logger,
  });
  try {
    const realPin = await readPinFile(root);

    const bad = await fetch(`http://127.0.0.1:${port}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "0000" }),
    });
    assert.equal(bad.status, 401);

    const good = await fetch(`http://127.0.0.1:${port}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: realPin }),
    });
    assert.equal(good.status, 200);
    const setCookie = good.headers.get("set-cookie") || "";
    const sessionMatch = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
    assert.ok(sessionMatch, "cookie de sessão emitido pelo login");
    const sessionToken = sessionMatch[1];

    // reautenticação carregando o Cookie de sessão junto — exercita a
    // redação do campo "cookie", não só do "pin".
    const again = await fetch(`http://127.0.0.1:${port}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: setCookie },
      body: JSON.stringify({ pin: realPin }),
    });
    assert.equal(again.status, 200);

    const raw = lines.join("\n");
    assert.ok(raw.includes("auth.attempt"), "a instrumentação de fato rodou — sem isso o teste seria vácuo");
    assert.doesNotMatch(raw, new RegExp(realPin), "o PIN real não aparece em NENHUM lugar do log capturado");
    assert.doesNotMatch(raw, /0000/, "nem o PIN tentado e errado aparece");
    const escapedToken = sessionToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(raw, new RegExp(escapedToken), "o token de sessão não aparece no log capturado");

    const attempts = records().filter(r => r.event === "auth.attempt");
    assert.equal(attempts.length, 3);
    for (const r of attempts) {
      assert.equal(r.body.pin, "[REDACTED]", "a chave pin do corpo foi redigida pelo logger, não omitida por quem loga");
    }
    assert.equal(attempts[2].cookie, "[REDACTED]", "o header Cookie também é redigido quando presente");

    const success = records().find(r => r.event === "auth.success");
    const invalidPin = records().find(r => r.event === "auth.invalid_pin");
    assert.ok(success);
    assert.ok(invalidPin);
  } finally {
    await close();
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------
// Round 2, achado 1 — corpo NÃO-objeto (escalar puro / array de escalar)
// furava o redator por chave: `JSON.parse('"0080"')` vira uma STRING, sem
// chave "pin" pra casar; `JSON.parse('["0080"]')` vira um ARRAY cujo
// elemento também não tem chave. Nos dois casos o PIN real ia pro log
// verbatim antes da correção em server.js (guarda de forma no bodyForLog).
// ---------------------------------------------------------------------

test("OBS-01 round 2: corpo do POST /api/auth como escalar puro (string JSON) não vaza o PIN no log", async () => {
  const root = await mkdtemp(join(tmpdir(), "j5obs-auth-scalar-"));
  const { logger, lines } = capture({ level: "debug" });
  const { port, close } = await startServer({
    port: 0, root, config: { pinned: [] }, trustLoopback: false, log: logger,
  });
  try {
    const realPin = await readPinFile(root);

    const r = await fetch(`http://127.0.0.1:${port}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(realPin), // corpo = `"0080"`, uma STRING, não {pin: "0080"}
    });
    assert.equal(r.status, 400, "corpo em forma inesperada não autentica");

    const raw = lines.join("\n");
    assert.ok(raw.includes("auth.attempt"), "a instrumentação de fato rodou — sem isso o teste seria vácuo");
    assert.doesNotMatch(raw, new RegExp(realPin), "o PIN real não aparece no log mesmo quando o corpo é um escalar puro");
  } finally {
    await close();
    await rm(root, { recursive: true, force: true });
  }
});

test("OBS-01 round 2: corpo do POST /api/auth como array de escalar não vaza o PIN no log", async () => {
  const root = await mkdtemp(join(tmpdir(), "j5obs-auth-array-"));
  const { logger, lines } = capture({ level: "debug" });
  const { port, close } = await startServer({
    port: 0, root, config: { pinned: [] }, trustLoopback: false, log: logger,
  });
  try {
    const realPin = await readPinFile(root);

    const r = await fetch(`http://127.0.0.1:${port}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([realPin]), // corpo = `["0080"]`, array sem chave "pin"
    });
    assert.equal(r.status, 400, "corpo em forma inesperada não autentica");

    const raw = lines.join("\n");
    assert.ok(raw.includes("auth.attempt"), "a instrumentação de fato rodou — sem isso o teste seria vácuo");
    assert.doesNotMatch(raw, new RegExp(realPin), "o PIN real não aparece no log mesmo quando o corpo é um array de escalar");
  } finally {
    await close();
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------
// Round 2, achado 2 — `seen` (WeakSet de redact()) não liberava o nó após
// descer, então uma referência COMPARTILHADA (DAG, não ciclo) era marcada
// "[Circular]" por engano na segunda ocorrência, derrubando um campo de
// diagnóstico legítimo em silêncio.
// ---------------------------------------------------------------------

test("OBS-01 round 2: referência compartilhada não-circular serializa por completo nas duas ocorrências", () => {
  const { logger, records } = capture({ level: "debug" });
  const shared = { ok: 1 };
  logger.debug("dag", { a: shared, b: shared });
  const rec = records().find(r => r.event === "dag");
  assert.deepEqual(rec.a, { ok: 1 }, "primeira ocorrência sempre serializou por completo");
  assert.deepEqual(rec.b, { ok: 1 }, "segunda ocorrência da MESMA referência não é um ciclo — não pode virar '[Circular]'");
});

// ---------------------------------------------------------------------
// Round 2, achado 3 — bootstrap.failed descartava o stack trace, o único
// diagnóstico disponível num crash de subida do processo.
// ---------------------------------------------------------------------

test("OBS-01 round 2: bootstrap.failed preserva o stack trace, não só a mensagem", () => {
  const { logger, records } = capture({ level: "warn" }); // error passa mesmo com nível padrão-quieto
  const err = new Error("EADDRINUSE simulado");
  logBootstrapFailure(err, logger);
  const failed = records().find(r => r.event === "bootstrap.failed");
  assert.ok(failed, "evento registrado");
  assert.equal(failed.message, "EADDRINUSE simulado");
  assert.equal(typeof failed.stack, "string", "stack sobrevive como campo próprio, não descartado");
  assert.match(failed.stack, /EADDRINUSE simulado/, "o stack capturado é o do erro real, não um texto genérico");
});
