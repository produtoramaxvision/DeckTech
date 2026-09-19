import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { createPlatform, PlatformNotImplementedError } from "../platform/index.js";
import { realIconService, listInstalledApps } from "../apps.js";
import { listInstalledApps as win32ListInstalledApps } from "../platform/windows/apps.js";
import { makeWindowsIconService, WIN_ICON_MAX_PX } from "../platform/windows/icon.js";
import {
  listAppProcesses as win32ListAppProcesses,
  activateApp as win32ActivateApp,
  focusWindow as win32FocusWindow,
  minimizeWindow as win32MinimizeWindow,
  closeWindow as win32CloseWindow,
  openNewWindow as win32OpenNewWindow,
} from "../platform/windows/actions.js";
import { createWindowsAppearanceTracker } from "../platform/windows/theme.js";

const CONTRACT_MEMBERS = [
  "listInstalledApps",
  "listAppProcesses",
  "activateApp",
  "openWebsite",
  "iconService",
  "focusWindow",
  "minimizeWindow",
  "closeWindow",
  "openNewWindow",
];

test("PLAT-01: darwin devolve os 5 membros do contrato quando chamado explicitamente", () => {
  const platform = createPlatform("darwin");
  assert.deepEqual(Object.keys(platform).sort(), [...CONTRACT_MEMBERS].sort());
  for (const member of CONTRACT_MEMBERS) {
    assert.notEqual(platform[member], undefined, `membro ausente: ${member}`);
  }
  assert.equal(typeof platform.iconService.getIconPng, "function");
});

test("PLAT-01: win32 devolve os 5 membros do contrato quando chamado explicitamente", () => {
  const platform = createPlatform("win32");
  assert.deepEqual(Object.keys(platform).sort(), [...CONTRACT_MEMBERS].sort());
  for (const member of CONTRACT_MEMBERS) {
    assert.notEqual(platform[member], undefined, `membro ausente: ${member}`);
  }
  assert.equal(typeof platform.iconService.getIconPng, "function");
});

test("PLAT-01: createPlatform() sem argumento lê process.platform — forçado para win32", async (t) => {
  t.mock.property(process, "platform", "win32");
  const platform = createPlatform();
  assert.deepEqual(Object.keys(platform).sort(), [...CONTRACT_MEMBERS].sort());
  // Discrimina o ramo de verdade: sob win32 forçado, listInstalledApps tem
  // que ser o provider real de platform/windows/apps.js (PLAT-02), não a
  // implementação real do macOS nem um stub genérico. Sem esta asserção,
  // uma fábrica que sempre devolve o bundle darwin (ou sempre win32)
  // passaria aqui do mesmo jeito — só o conjunto de chaves é idêntico nos
  // dois SOs.
  assert.equal(platform.listInstalledApps, win32ListInstalledApps);
});

test("PLAT-01: createPlatform() sem argumento lê process.platform — forçado para darwin", (t) => {
  t.mock.property(process, "platform", "darwin");
  const platform = createPlatform();
  assert.deepEqual(Object.keys(platform).sort(), [...CONTRACT_MEMBERS].sort());
  // Discrimina o ramo de verdade: sob darwin forçado, listInstalledApps tem
  // que ser a função real importada de apps.js — não um stub win32 que só
  // por acaso também é `typeof === "function"`.
  assert.equal(platform.listInstalledApps, listInstalledApps);
});

test("PLAT-01: createPlatform(nome) ignora process.platform ambiente — darwin explícito sob win32 forçado", (t) => {
  t.mock.property(process, "platform", "win32");
  const platform = createPlatform("darwin");
  assert.deepEqual(Object.keys(platform).sort(), [...CONTRACT_MEMBERS].sort());
  assert.equal(typeof platform.listAppProcesses, "function");
});

test("PLAT-01: createPlatform(nome) ignora process.platform ambiente — win32 explícito sob darwin forçado", async (t) => {
  t.mock.property(process, "platform", "darwin");
  const platform = createPlatform("win32");
  assert.deepEqual(Object.keys(platform).sort(), [...CONTRACT_MEMBERS].sort());
  // listInstalledApps (PLAT-02), iconService (PLAT-03+09), listAppProcesses
  // e activateApp (PLAT-05) já têm provider real; só openWebsite continua
  // sem — a chamada deve falhar alto e tipado, nunca devolver undefined em
  // silêncio.
  await assertAllRejectTyped(platform);
});

// listInstalledApps, iconService, listAppProcesses e activateApp
// deliberadamente FORA desta lista: PLAT-02, PLAT-03+09 e PLAT-05 já
// implementaram os providers reais (platform/windows/apps.js e
// platform/windows/actions.js) — ver os testes dedicados "PLAT-02: win32
// listInstalledApps...", "PLAT-03: win32 iconService..." e "PLAT-05: win32
// listAppProcesses/activateApp..." abaixo, que provam a referência real em
// vez de reusar este helper.
async function assertAllRejectTyped(platform) {
  await assert.rejects(platform.openWebsite("https://example.com"), PlatformNotImplementedError);
}

test("PLAT-01/PLAT-06: openWebsite win32 (único membro ainda sem provider) falha alto com PlatformNotImplementedError e code estável", async () => {
  const platform = createPlatform("win32");
  await assertAllRejectTyped(platform);
  try {
    await platform.openWebsite("https://example.com");
    assert.fail("deveria ter lançado");
  } catch (err) {
    assert.equal(err.code, "PLATFORM_NOT_IMPLEMENTED");
    assert.equal(err.platform, "win32");
    assert.equal(err.member, "openWebsite");
    assert.match(err.message, /openWebsite/);
  }
});

// Critério discriminante equivalente pro PLAT-05: sem esta asserção de
// referência, um win32Platform() que devolvesse `notImplemented(...)` de
// novo pra listAppProcesses/activateApp passaria em "devolve os 5 membros"
// do mesmo jeito (typeof função ainda bate). Prova de discriminação em
// discrimination_proof.
test("PLAT-05: win32 listAppProcesses/activateApp são os providers reais de platform/windows/actions.js, não notImplemented", () => {
  const platform = createPlatform("win32");
  assert.equal(platform.listAppProcesses, win32ListAppProcesses);
  assert.equal(platform.activateApp, win32ActivateApp);
  assert.equal(typeof platform.listAppProcesses, "function");
  assert.equal(typeof platform.activateApp, "function");
});

test("PLAT-12: win32 focusWindow/minimizeWindow/closeWindow/openNewWindow são os providers reais de platform/windows/actions.js", () => {
  const platform = createPlatform("win32");
  assert.equal(platform.focusWindow, win32FocusWindow);
  assert.equal(platform.minimizeWindow, win32MinimizeWindow);
  assert.equal(platform.closeWindow, win32CloseWindow);
  assert.equal(platform.openNewWindow, win32OpenNewWindow);
  assert.equal(typeof platform.focusWindow, "function");
  assert.equal(typeof platform.minimizeWindow, "function");
  assert.equal(typeof platform.closeWindow, "function");
  assert.equal(typeof platform.openNewWindow, "function");
});

test("PLAT-12: darwin tem degradação explicitamente declarada (PlatformNotImplementedError) em focusWindow/minimizeWindow/closeWindow/openNewWindow", async () => {
  const platform = createPlatform("darwin");
  await assert.rejects(platform.focusWindow("win-1"), PlatformNotImplementedError);
  await assert.rejects(platform.minimizeWindow("win-1"), PlatformNotImplementedError);
  await assert.rejects(platform.closeWindow("win-1"), PlatformNotImplementedError);
  await assert.rejects(platform.openNewWindow("App"), PlatformNotImplementedError);
});

test("PLAT-11: darwin listAppProcesses devolve janelas com id, title, monitor e state definidos (degradação declarada, honesta: background, sem falso focused)", async () => {
  // apps.js#listAppProcesses entrega apenas type="Foreground" para regular apps.
  // A degradação honesta relata 'background' por padrão para não reivindicar foco
  // falso em múltiplos apps simultaneamente (Finding M1).
  const platform = createPlatform("darwin", {
    listAppProcesses: async () => [
      { name: "Safari", pid: 1234, type: "Foreground" },
      { name: "Notes", pid: 5678, type: "Foreground" },
    ],
  });
  const windows = await platform.listAppProcesses();
  assert.equal(windows.length, 2);
  assert.deepEqual(windows[0], {
    id: "darwin-1234",
    name: "Safari",
    title: "Safari",
    monitor: 0,
    state: "background",
    type: "Foreground",
    pid: 1234,
    degraded: true,
  });
  assert.deepEqual(windows[1], {
    id: "darwin-5678",
    name: "Notes",
    title: "Notes",
    monitor: 0,
    state: "background",
    type: "Foreground",
    pid: 5678,
    degraded: true,
  });
  for (const w of windows) {
    assert.notEqual(w.id, undefined);
    assert.notEqual(w.name, undefined);
    assert.notEqual(w.title, undefined);
    assert.notEqual(w.monitor, undefined);
    assert.notEqual(w.state, undefined);
    assert.equal(w.state, "background");
  }
});

test("PLAT-11: darwin listAppProcesses com getFrontmostApp marca apenas o app frontmost como focused", async () => {
  const platform = createPlatform("darwin", {
    listAppProcesses: async () => [
      { name: "Safari", pid: 1234, type: "Foreground" },
      { name: "Notes", pid: 5678, type: "Foreground" },
    ],
    getFrontmostApp: async () => 1234,
  });
  const windows = await platform.listAppProcesses();
  assert.equal(windows.length, 2);
  assert.equal(windows[0].state, "focused");
  assert.equal(windows[1].state, "background");
});

test("PLAT-12/MJ3: fallback platform devolve os 9 membros e degradação declarada (Phase 14 critério 6)", async () => {
  const platform = createPlatform("fallback");
  assert.deepEqual(Object.keys(platform).sort(), [...CONTRACT_MEMBERS].sort());
  for (const member of CONTRACT_MEMBERS) {
    assert.notEqual(platform[member], undefined, `membro ausente: ${member}`);
  }
  // Nenhum dos métodos é undefined nem lança TypeError "is not a function"
  assert.equal(typeof platform.focusWindow, "function");
  assert.equal(typeof platform.minimizeWindow, "function");
  assert.equal(typeof platform.closeWindow, "function");
  assert.equal(typeof platform.openNewWindow, "function");

  await assert.rejects(platform.focusWindow("win-1"), (err) => {
    assert.equal(err.name, "PlatformNotImplementedError");
    assert.equal(err.code, "PLATFORM_NOT_IMPLEMENTED");
    assert.equal(err.platform, "fallback");
    assert.equal(err.member, "focusWindow");
    return true;
  });
  await assert.rejects(platform.minimizeWindow("win-1"), (err) => {
    assert.equal(err.code, "PLATFORM_NOT_IMPLEMENTED");
    assert.equal(err.platform, "fallback");
    assert.equal(err.member, "minimizeWindow");
    return true;
  });
  await assert.rejects(platform.closeWindow("win-1"), (err) => {
    assert.equal(err.code, "PLATFORM_NOT_IMPLEMENTED");
    assert.equal(err.platform, "fallback");
    assert.equal(err.member, "closeWindow");
    return true;
  });
  await assert.rejects(platform.openNewWindow("App"), (err) => {
    assert.equal(err.code, "PLATFORM_NOT_IMPLEMENTED");
    assert.equal(err.platform, "fallback");
    assert.equal(err.member, "openNewWindow");
    return true;
  });
});

// Critério 1 discriminante para PLAT-02: sem esta asserção de referência, um
// win32Platform() que devolvesse qualquer função (inclusive um novo stub
// notImplemented) passaria nos testes de forma/contrato acima do mesmo
// jeito. Prova de discriminação em discrimination_proof.
test("PLAT-02: win32 listInstalledApps é o provider real de platform/windows/apps.js, não notImplemented", () => {
  const platform = createPlatform("win32");
  assert.equal(platform.listInstalledApps, win32ListInstalledApps);
  assert.equal(typeof platform.listInstalledApps, "function");
});

// Critério discriminante equivalente pro PLAT-03+09: sem esta asserção, um
// win32Platform() que devolvesse `{getIconPng: notImplemented(...)}` de
// novo passaria em "devolve os 5 membros" do mesmo jeito (typeof função
// ainda bate). getIconPng("Fantasma") resolvendo pra `null` (em vez de
// rejeitar com PlatformNotImplementedError) é a prova comportamental de
// que é o provider real. Prova de discriminação em discrimination_proof.
//
// `scan` injetado (stub, sem apps) deliberadamente: usar o
// win32ListInstalledApps DEFAULT chamaria PowerShell de verdade, o que só
// existe numa máquina Windows real — esta suite roda no ubuntu-latest do
// CI (.github/workflows/test.yml) também, e makeWindowsIconService em si
// não tem nenhum código OS-específico até chegar no require() preguiçoso
// do addon nativo (nunca acontece aqui: lista de apps vazia -> null antes
// de qualquer extração) — só win32ListInstalledApps/runPowerShellCollect
// são win32-only, e este teste evita tocar neles.
test("PLAT-03+09: win32 iconService é o provider real de platform/windows/icon.js, não notImplemented", async () => {
  const platform = createPlatform("win32", {
    makeIconService: (deps) => makeWindowsIconService({ ...deps, scan: async () => [] }),
  });
  assert.equal(typeof platform.iconService.getIconPng, "function");
  // notImplemented() sempre REJEITA com PlatformNotImplementedError; o
  // provider real, pra um app inexistente, RESOLVE com null — comportamento
  // observável só possível se for de fato platform/windows/icon.js.
  await assert.doesNotReject(platform.iconService.getIconPng("Fantasma-plat-03"));
  assert.equal(await platform.iconService.getIconPng("Fantasma-plat-03"), null);
});

test("PLAT-01: win32Platform() aceita deps.makeIconService injetável, mesmo padrão de darwinPlatform() com makeIconService/resolveMacIconHelper", () => {
  let receivedDeps = null;
  const platform = createPlatform("win32", {
    makeIconService: (deps) => { receivedDeps = deps; return { getIconPng: async () => null }; },
  });
  assert.equal(typeof receivedDeps.scan, "function", "createPlatform deveria injetar scan=win32ListInstalledApps na fábrica");
  assert.equal(receivedDeps.scan, win32ListInstalledApps);
  assert.notEqual(platform.iconService.getIconPng, undefined);
});

test("createPlatform(plataforma desconhecida) falha alto e tipado, nunca undefined em silêncio", () => {
  assert.throws(() => createPlatform("linux"), PlatformNotImplementedError);
  try {
    createPlatform("linux");
    assert.fail("deveria ter lançado");
  } catch (err) {
    assert.equal(err.code, "PLATFORM_NOT_IMPLEMENTED");
    assert.equal(err.platform, "linux");
    assert.equal(err.member, "createPlatform");
  }
});

// --- Critério 1, a parte que faz a asserção discriminar de verdade ---
// "sem o ramo darwin implícito que hoje sobra em apps.js:571": o teste abaixo
// prova que o iconHelper do macOS é resolvido pela FÁBRICA e passado
// explicitamente para makeIconService — não fica escondido no default
// `iconHelper = process.platform === "darwin" && existsSync(...) ? ... : null`
// de apps.js:571. Se alguém reverter darwinPlatform() para chamar
// `realIconService()` sem argumento (reintroduzindo a dependência no default
// implícito), este teste falha porque capturedDeps não terá a chave
// "iconHelper". Prova de discriminação em discrimination_proof.
test("PLAT-01: darwin resolve iconHelper explicitamente na fábrica, não no default implícito de realIconService", () => {
  let capturedDeps;
  const spyMakeIconService = (deps) => {
    capturedDeps = deps;
    return { getIconPng: async () => null };
  };
  const platform = createPlatform("darwin", {
    makeIconService: spyMakeIconService,
    resolveMacIconHelper: () => "/Applications/Dokke.app/Contents/Resources/DokkeIconHelper.app",
  });
  assert.notEqual(capturedDeps, undefined, "makeIconService deveria ter sido chamado com deps explícitos");
  assert.ok(Object.prototype.hasOwnProperty.call(capturedDeps, "iconHelper"), "iconHelper precisa ser passado explicitamente pela fábrica");
  assert.equal(capturedDeps.iconHelper, "/Applications/Dokke.app/Contents/Resources/DokkeIconHelper.app");
  assert.equal(typeof platform.iconService.getIconPng, "function");
});

// Não-negociável #4: path.join sobre separador hardcoded, exercitando um
// caminho com espaço — o resolvedor de iconHelper injetado usa join() e a
// fábrica repassa o resultado intacto, sem recompor a string.
test("PLAT-01: caminho de iconHelper com espaço (path.join) atravessa a fábrica intacto", () => {
  const spacedHelperPath = join("C:\\Program Files", "Deck Tech", "bin", "DokkeIconHelper.app");
  assert.match(spacedHelperPath, / /, "fixture precisa conter um espaço de verdade");
  let capturedDeps;
  const platform = createPlatform("darwin", {
    makeIconService: (deps) => { capturedDeps = deps; return { getIconPng: async () => null }; },
    resolveMacIconHelper: () => spacedHelperPath,
  });
  assert.equal(capturedDeps.iconHelper, spacedHelperPath);
  assert.equal(typeof platform.iconService.getIconPng, "function");
});

// Regressão de fallback real: quando não há override, a fábrica ainda chama
// o realIconService() de verdade (não um mock) e o resultado tem a forma do
// contrato — prova que darwinPlatform() não está apenas satisfazendo o spy.
test("PLAT-01: darwin sem overrides usa realIconService de verdade (não mock)", () => {
  const platform = createPlatform("darwin");
  const bare = realIconService();
  assert.equal(typeof platform.iconService.getIconPng, "function");
  assert.equal(typeof bare.getIconPng, "function");
});

// Critério discriminante equivalente pro PLAT-07, espelhando o teste
// "PLAT-01: darwin resolve iconHelper explicitamente na fábrica" acima: sem
// esta asserção, um win32Platform() que nunca resolvesse/injetasse um
// appearance tracker passaria em todos os testes de forma/contrato do mesmo
// jeito (typeof função ainda bate, getIconPng ainda resolve). Prova de
// discriminação em discrimination_proof.
test("PLAT-07: win32 resolve o appearance tracker explicitamente na fábrica e passa .token pra makeIconService — não fica implícito dentro de icon.js", () => {
  let capturedDeps;
  let tokenCalls = 0;
  const fakeTracker = { token: () => { tokenCalls++; return "apps=dark"; }, start() {}, stop() {} };
  const platform = createPlatform("win32", {
    makeIconService: (deps) => { capturedDeps = deps; return { getIconPng: async () => null }; },
    resolveWindowsAppearanceTracker: () => fakeTracker,
  });
  assert.notEqual(capturedDeps, undefined, "makeIconService deveria ter sido chamado com deps explícitos");
  assert.ok(Object.prototype.hasOwnProperty.call(capturedDeps, "appearanceToken"), "appearanceToken precisa ser passado explicitamente pela fábrica");
  assert.equal(capturedDeps.appearanceToken, fakeTracker.token);
  assert.equal(typeof platform.iconService.getIconPng, "function");
  // A fábrica só RESOLVE o tracker (construção), nunca chama .token() ela
  // mesma — quem decide quando ler é makeWindowsIconService/getIconPng.
  assert.equal(tokenCalls, 0, "win32Platform() não deveria ter chamado token() sozinha");
});

// Critério discriminante: construir a plataforma win32 (com ou sem
// overrides) NUNCA spawna um processo real — resolveWindowsAppearanceTracker
// default (createWindowsAppearanceTracker) é barato por design (ver
// platform/windows/theme.js). Sem start() explícito, um powershell.exe real
// seria um processo órfão criado só por chamar createPlatform("win32") —
// exatamente o que os outros testes acima ("win32 devolve os 5 membros...")
// já fazem em bateria nesta máquina Windows real; este teste torna essa
// garantia EXPLÍCITA em vez de incidental.
test("PLAT-07: createPlatform(\"win32\") sem overrides NUNCA chama start() no tracker — construção é sempre barata, nunca spawna processo", () => {
  let startCalls = 0;
  const platform = createPlatform("win32", {
    resolveWindowsAppearanceTracker: () => ({
      token: async () => "apps=dark",
      start: () => { startCalls++; },
      stop: () => {},
    }),
  });
  assert.equal(startCalls, 0);
  assert.equal(typeof platform.iconService.getIconPng, "function");
});

// --- PLAT-07 Round-2 (finding 1, bloqueador) --------------------------------
// A diferença crítica deste bloco pros testes acima: todos eles injetam um
// objeto de tracker FEITO À MÃO (`{token: () => ..., start() {}, stop() {}}`)
// — nenhum deles usa a máquina REAL de createWindowsAppearanceTracker
// (platform/windows/theme.js), então nenhum deles conseguiria detectar que
// o token wireado pela fábrica era estruturalmente incapaz de mudar (o
// achado do reviewer). Este teste usa o `createWindowsAppearanceTracker`
// DE VERDADE — só `read`/`startWatcher` são fakes, exatamente como
// test/windows-theme-appearance.test.mjs já faz pro próprio tracker isolado
// — só que aqui ele passa pela fábrica inteira (win32Platform ->
// makeWindowsIconService) igual à produção. `scan`/`fs`/`extract` também são
// fakes (sem isso o `makeIconService` default chamaria PowerShell/addon
// nativo de verdade — mesmo motivo do teste PLAT-03+09 acima).
function fakeIconFs() {
  const files = new Map();
  return {
    readFile: async (p) => { if (!files.has(p)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; } return files.get(p); },
    writeFile: async (p, buf) => { files.set(p, buf); },
    mkdir: async () => {},
    stat: async () => ({ mtimeMs: 1 }), // constante — só a aparência deve mudar a chave neste teste
    unlink: async (p) => { files.delete(p); },
    readdir: async () => [...files.keys()].map(p => p.split(/[\\/]/).pop()),
  };
}

test("PLAT-07 Round-2: o token wireado pela fábrica (tracker REAL, não um objeto fake) muda sozinho quando o watch dispara — a próxima getIconPng() reextrai em vez de servir a variante congelada", async () => {
  let extractions = 0;
  let appearance = "apps=dark";
  let onChangeCb;
  let spawnCount = 0;

  const platform = createPlatform("win32", {
    makeIconService: (deps) => makeWindowsIconService({
      ...deps,
      scan: async () => [{ name: "A", path: "C:\\Apps\\A.exe", kind: "win32" }],
      fs: fakeIconFs(),
      extract: () => { extractions++; return new Uint8Array(WIN_ICON_MAX_PX * WIN_ICON_MAX_PX * 4).fill(extractions); },
    }),
    // A ÚNICA diferença estrutural pros outros testes deste arquivo: o
    // tracker devolvido aqui é o createWindowsAppearanceTracker REAL
    // (importado de platform/windows/theme.js), não um objeto hand-rolled.
    // `read`/`startWatcher` são as únicas partes fakes — o mesmo padrão que
    // test/windows-theme-appearance.test.mjs já usa pra testar o tracker
    // isolado, agora atravessando a fábrica inteira.
    resolveWindowsAppearanceTracker: () => createWindowsAppearanceTracker({
      read: async () => appearance,
      startWatcher: (keyPath, { onChange }) => { spawnCount++; onChangeCb = onChange; return { kill() {} }; },
    }),
  });

  const before = await platform.iconService.getIconPng("A");
  assert.equal(extractions, 1);
  assert.equal(spawnCount, 1, "a PRIMEIRA getIconPng() (via resolveAppearanceToken -> token()) já deve ter lazy-startado o watch sozinha — sem start() explícito de ninguém, nem da fábrica nem deste teste");

  const beforeAgain = await platform.iconService.getIconPng("A");
  assert.equal(extractions, 1, "sem evento nenhum, mesmo token -> mesma chave -> cache hit");
  assert.equal(Buffer.compare(before, beforeAgain), 0);

  // "o usuário trocou o tema do Windows": o valor muda E o watcher (real,
  // via RegNotifyChangeKeyValue) dispara o evento — onChangeCb() é
  // exatamente o que startThemeWatcher chamaria.
  appearance = "apps=light";
  onChangeCb();
  const after = await platform.iconService.getIconPng("A");
  assert.equal(extractions, 2, "PLAT-07 critério 5: o token wireado pela fábrica mudou -> cache invalidado -> reextraiu. Antes do fix do Round-2, isto ficava travado em 1 (ver discrimination_proof) porque nada nunca chamava start() no tracker construído por win32Platform().");
  assert.notEqual(Buffer.compare(before, after), 0, "PNG pós-troca de tema deve ser diferente do PNG pré-troca");
});
