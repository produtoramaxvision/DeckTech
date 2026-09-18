// PLAT-03 + PLAT-09 — tests for platform/windows/icon.js, the Windows
// iconService provider behind the Fase 2 contract
// (platform/index.js#win32Platform).
//
// Same split test/windows-list-installed-apps.test.mjs already uses:
// composition-level tests inject `scan`/`extract`/`fs` so the cache,
// invalidation and cancellation logic run on any OS (CI included), and a
// `win32Only`-gated block at the bottom exercises the REAL native addon,
// a REAL on-disk cache directory and a REAL fixture file with a space in
// its path, end to end, on this machine.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  makeWindowsIconService,
  prepareIconSourcePath,
  WIN_ICON_MAX_PX,
} from "../platform/windows/icon.js";

const win32Only = process.platform === "win32" ? {} : { skip: "requer Windows real (addon N-API compilado)" };

function fakeFs(overrides = {}) {
  const files = new Map(); // path -> Buffer
  return {
    files,
    readFile: async (p) => {
      if (!files.has(p)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; }
      return files.get(p);
    },
    writeFile: async (p, buf) => { files.set(p, buf); },
    mkdir: async () => {},
    stat: overrides.stat ?? (async () => ({ mtimeMs: 1 })),
    unlink: async (p) => { files.delete(p); },
    readdir: async () => [...files.keys()].map(p => p.split(/[\\/]/).pop()),
  };
}

function makeApp(name, path = `C:\\Apps\\${name}.exe`, kind = "win32") {
  return { name, path, kind };
}

// --- prepareIconSourcePath: fecha o gap documentado pelo ADR-0001 -------

test("prepareIconSourcePath: kind != win32 (ex.: uwp) -> null, documentado, não um path quebrado", () => {
  assert.equal(prepareIconSourcePath({ kind: "uwp", path: "Foo_8wekyb3d8bbwe!App" }), null);
  assert.equal(prepareIconSourcePath(null), null);
  assert.equal(prepareIconSourcePath({ kind: "win32", path: "" }), null);
});

test("prepareIconSourcePath: remove aspas envolventes", () => {
  assert.equal(prepareIconSourcePath({ kind: "win32", path: '"C:\\Program Files\\App\\app.exe"' }), "C:\\Program Files\\App\\app.exe");
});

test("prepareIconSourcePath: remove sufixo ,<índice> de DisplayIcon de registro", () => {
  assert.equal(prepareIconSourcePath({ kind: "win32", path: "C:\\App\\app.exe,0" }), "C:\\App\\app.exe");
  assert.equal(prepareIconSourcePath({ kind: "win32", path: "C:\\App\\app.exe,-14" }), "C:\\App\\app.exe");
});

test("prepareIconSourcePath: não corta uma vírgula que não é seguida só de dígitos", () => {
  assert.equal(prepareIconSourcePath({ kind: "win32", path: "C:\\App\\app.exe,notanumber" }), "C:\\App\\app.exe,notanumber");
});

test("prepareIconSourcePath: expande %VAR% conhecida, preserva %VAR% desconhecida sem virar string vazia", () => {
  const prev = process.env.DOKKE_TEST_VAR;
  process.env.DOKKE_TEST_VAR = "C:\\Known";
  try {
    assert.equal(prepareIconSourcePath({ kind: "win32", path: "%DOKKE_TEST_VAR%\\app.exe" }), "C:\\Known\\app.exe");
    assert.equal(prepareIconSourcePath({ kind: "win32", path: "%DOKKE_NOT_SET_XYZ%\\app.exe" }), "%DOKKE_NOT_SET_XYZ%\\app.exe");
  } finally {
    if (prev === undefined) delete process.env.DOKKE_TEST_VAR; else process.env.DOKKE_TEST_VAR = prev;
  }
});

test("prepareIconSourcePath: aspas + sufixo de índice + %VAR% compostos — formato real de DisplayIcon do registro (índice FORA das aspas: '\"path\",0')", () => {
  const prev = process.env.DOKKE_TEST_VAR2;
  process.env.DOKKE_TEST_VAR2 = "C:\\Known";
  try {
    assert.equal(
      prepareIconSourcePath({ kind: "win32", path: '"%DOKKE_TEST_VAR2%\\app.exe",0' }),
      "C:\\Known\\app.exe",
    );
  } finally {
    if (prev === undefined) delete process.env.DOKKE_TEST_VAR2; else process.env.DOKKE_TEST_VAR2 = prev;
  }
});

// --- getIconPng: básico ---------------------------------------------------

test("getIconPng: app desconhecido -> null, não lança", async () => {
  const svc = makeWindowsIconService({ scan: async () => [makeApp("A")], fs: fakeFs(), extract: () => new Uint8Array(4) });
  assert.equal(await svc.getIconPng("Fantasma"), null);
});

test("getIconPng: extrai via addon injetado e devolve PNG 256x256 válido", async () => {
  let calls = 0;
  const svc = makeWindowsIconService({
    scan: async () => [makeApp("A")],
    fs: fakeFs(),
    extract: (p, size) => { calls++; return new Uint8Array(size * size * 4).fill(200); },
  });
  const png = await svc.getIconPng("A");
  assert.equal(calls, 1);
  assert.equal(png.readUInt32BE(0), 0x89504e47, "assinatura PNG");
  assert.equal(png.readUInt32BE(16), WIN_ICON_MAX_PX, "IHDR width");
  assert.equal(png.readUInt32BE(20), WIN_ICON_MAX_PX, "IHDR height");
});

test("getIconPng: 2 chamadas concorrentes pro MESMO nome deduplicam (1 extração só)", async () => {
  let calls = 0;
  const svc = makeWindowsIconService({
    scan: async () => [makeApp("A")],
    fs: fakeFs(),
    extract: (p, size) => { calls++; return new Uint8Array(size * size * 4); },
  });
  const [a, b] = await Promise.all([svc.getIconPng("A"), svc.getIconPng("A")]);
  assert.equal(calls, 1);
  assert.equal(Buffer.compare(a, b), 0);
});

test("getIconPng: app cujo binário sumiu (stat falha) -> null, nunca serve ícone obsoleto", async () => {
  const fs = fakeFs({ stat: async () => { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; } });
  const svc = makeWindowsIconService({ scan: async () => [makeApp("A")], fs, extract: () => new Uint8Array(4) });
  assert.equal(await svc.getIconPng("A"), null);
});

test("getIconPng: falha do addon (ex.: E_INVALIDARG) -> null, não propaga a exceção", async () => {
  const svc = makeWindowsIconService({
    scan: async () => [makeApp("A")],
    fs: fakeFs(),
    extract: () => { throw new Error("SHCreateItemFromParsingName failed hr=0x80070057"); },
  });
  await assert.doesNotReject(async () => {
    const buf = await svc.getIconPng("A");
    assert.equal(buf, null);
  });
});

test("getIconPng: kind uwp -> null (gap documentado, não finge suportar)", async () => {
  const svc = makeWindowsIconService({
    scan: async () => [makeApp("Calc", "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", "uwp")],
    fs: fakeFs(),
    extract: () => { throw new Error("nunca deveria ser chamado para uwp"); },
  });
  assert.equal(await svc.getIconPng("Calc"), null);
});

// --- PLAT-09: cache persistente + invalidação por mtime -------------------

test("PLAT-09: cache em disco sobrevive a uma NOVA instância do serviço (mesmo cacheDir) — simula restart", async () => {
  let calls = 0;
  const fs = fakeFs();
  const extract = (p, size) => { calls++; return new Uint8Array(size * size * 4).fill(50); };
  const scan = async () => [makeApp("A")];

  const svc1 = makeWindowsIconService({ scan, fs, extract, cacheDir: "C:\\fake-cache" });
  const first = await svc1.getIconPng("A");
  assert.equal(calls, 1);

  // instância NOVA (memória fria), MESMO fs (= mesmo cacheDir em disco) —
  // isto é literalmente o que "sobrevive a restart" significa: o processo
  // (e portanto toda a memória do svc1) morreu, só o disco persiste.
  const svc2 = makeWindowsIconService({ scan, fs, extract, cacheDir: "C:\\fake-cache" });
  const second = await svc2.getIconPng("A");
  assert.equal(calls, 1, "instância nova não deveria re-extrair — deveria ler o PNG do disco");
  assert.equal(Buffer.compare(first, second), 0);
});

test("PLAT-09: mtime do binário de origem muda -> próxima carga REEXTRAI em vez de servir o PNG velho", async () => {
  let calls = 0;
  let mtimeMs = 1000;
  const fs = fakeFs({ stat: async () => ({ mtimeMs }) });
  const svc = makeWindowsIconService({
    scan: async () => [makeApp("A")],
    fs,
    extract: (p, size) => { calls++; return new Uint8Array(size * size * 4).fill(calls); },
  });

  const before = await svc.getIconPng("A");
  assert.equal(calls, 1);
  const beforeAgain = await svc.getIconPng("A");
  assert.equal(calls, 1, "mesma mtime -> cache hit, sem re-extração");
  assert.equal(Buffer.compare(before, beforeAgain), 0);

  mtimeMs = 2000; // "app foi atualizado" — o binário mudou, o mtime mudou
  const after = await svc.getIconPng("A");
  assert.equal(calls, 2, "mtime nova -> reextraiu");
  assert.notEqual(Buffer.compare(before, after), 0, "PNG pós-update deve ser diferente do PNG pré-update");
});

// --- PLAT-03: cancelamento -------------------------------------------------

test("PLAT-03: abortar o signal ANTES de uma extração ainda não iniciada pula essa extração (não lança, resolve null)", async () => {
  let calls = 0;
  const svc = makeWindowsIconService({
    scan: async () => [makeApp("A")],
    fs: fakeFs(),
    extract: (p, size) => { calls++; return new Uint8Array(size * size * 4); },
  });
  const controller = new AbortController();
  controller.abort();
  const result = await svc.getIconPng("A", { signal: controller.signal });
  assert.equal(result, null);
  assert.equal(calls, 0, "signal já abortado antes de enfileirar -> addon nunca deveria ser chamado");
});

test("PLAT-03: carga de 122 ícones abandonada — a fila PARA de iniciar extrações após o abort, não drena os 122", async () => {
  const N = 122;
  const CONCURRENCY = 4;
  const apps = Array.from({ length: N }, (_, i) => makeApp(`App${i}`));
  let started = 0;
  let completed = 0;

  function busyWaitMs(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* simula o custo síncrono real do addon (~43ms medido no ADR-0001) */ }
  }

  const svc = makeWindowsIconService({
    scan: async () => apps,
    fs: fakeFs(),
    concurrency: CONCURRENCY,
    onExtractStart: () => { started++; },
    extract: (p, size) => {
      busyWaitMs(2);
      completed++;
      return new Uint8Array(size * size * 4);
    },
  });

  const controller = new AbortController();
  const promises = apps.map(app => svc.getIconPng(app.name, { signal: controller.signal }));

  // POLLING, não um sleep de duração fixa: numa máquina sob carga real (ex.:
  // dezenas de outros arquivos de teste rodando em paralelo), um `setTimeout`
  // fixo de poucos ms pode disparar ANTES do event loop ter tido chance de
  // processar o primeiro `setImmediate` da fila — isso é falso negativo do
  // TESTE (timing frágil), não do código guardado. Poll até `started > 0`
  // (com teto generoso) é o mesmo tipo de folga em que um 'close' de request
  // HTTP chegaria, só que sem depender de quanto tempo de CPU esta máquina
  // especificamente tinha livre neste instante.
  const pollDeadline = Date.now() + 5000;
  while (started === 0 && Date.now() < pollDeadline) {
    await new Promise(r => setTimeout(r, 2));
  }
  assert.ok(started > 0, "sanity: o teste precisa observar ALGUMA extração já iniciada antes do abort, senão não está testando concorrência real (timeout de 5s esgotado)");
  assert.ok(started < N, `sanity: ${started} já deveria ser bem menor que ${N} neste ponto`);
  controller.abort();

  const results = await Promise.all(promises);

  assert.ok(started < N, `FALHA REAL: ${started}/${N} extrações rodaram — o abort não impediu a fila de continuar processando a cauda abandonada`);
  // A prova de discriminação (ver discrimination_proof) quebra exatamente
  // esta asserção comentando o check de signal.aborted dentro da fila.
  assert.equal(started, completed, "toda extração que começou (síncrona) deveria ter completado — nenhuma trava a meio");
  for (const r of results) assert.ok(r === null || Buffer.isBuffer(r) || r instanceof Uint8Array);
});

// --- Ponta a ponta real: addon nativo compilado + fixture com espaço -----

test("PLAT-03+09 (máquina real): extrai 256x256 de um .exe cujo path tem ESPAÇO, cacheia em disco entre instâncias, reextrai após mtime mudar", win32Only, async (t) => {
  const { makeWindowsIconService: realMake } = await import("../platform/windows/icon.js");
  const scratchRoot = await mkdtemp(join(tmpdir(), "dokke-icon-e2e-"));
  const spacedDir = join(scratchRoot, "My Test Dir");
  await mkdir(spacedDir, { recursive: true });
  const fixture = join(spacedDir, "Sample App.exe");
  // Fixture real (não um binário do sistema — nunca tocamos mtime de algo
  // que não seja nosso): copia notepad.exe pra um path com espaço.
  const { copyFile } = await import("node:fs/promises");
  await copyFile("C:\\Windows\\System32\\notepad.exe", fixture);

  const cacheDir = join(scratchRoot, "cache");
  const scan = async () => [{ name: "SampleApp", path: fixture, kind: "win32" }];

  try {
    const svc1 = realMake({ scan, cacheDir });
    const t0 = Date.now();
    const png1 = await svc1.getIconPng("SampleApp");
    const coldMs = Date.now() - t0;
    assert.ok(png1 && png1.length > 0, "extração real deveria produzir um PNG não vazio de um path com espaço");
    assert.equal(png1.readUInt32BE(0), 0x89504e47);
    assert.equal(png1.readUInt32BE(16), 256);
    assert.equal(png1.readUInt32BE(20), 256);

    // Nova instância (memória fria), mesmo cacheDir em disco — mede o
    // ganho real de PLAT-09, não um número inventado.
    const svc2 = realMake({ scan, cacheDir });
    const t1 = Date.now();
    const png2 = await svc2.getIconPng("SampleApp");
    const warmMs = Date.now() - t1;
    assert.equal(Buffer.compare(png1, png2), 0, "cache em disco deveria devolver bytes idênticos");
    t.diagnostic(`cold=${coldMs}ms warm(disk, nova instância)=${warmMs}ms`);
    assert.ok(warmMs < coldMs, "carga do cache em disco deveria ser visivelmente mais rápida que a extração fria");

    // Invalidação: muda o mtime do NOSSO fixture (nunca de um binário do
    // sistema), a próxima carga tem que reextrair.
    const now = new Date();
    await utimes(fixture, now, new Date(now.getTime() + 60_000));
    const svc3 = realMake({ scan, cacheDir });
    const t2 = Date.now();
    const png3 = await svc3.getIconPng("SampleApp");
    const afterMtimeMs = Date.now() - t2;
    assert.ok(png3 && png3.length > 0);
    t.diagnostic(`after mtime bump=${afterMtimeMs}ms (deveria se parecer com cold=${coldMs}ms, não com warm=${warmMs}ms)`);
    assert.ok(afterMtimeMs > warmMs, "após mudar o mtime, a carga deveria reextrair (mais lenta que o hit de disco), não servir o PNG antigo");
  } finally {
    await rm(scratchRoot, { recursive: true, force: true }).catch(() => {});
  }
});
