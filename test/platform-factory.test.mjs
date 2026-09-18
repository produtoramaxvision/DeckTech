import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { createPlatform, PlatformNotImplementedError } from "../platform/index.js";
import { realIconService, listInstalledApps } from "../apps.js";
import { listInstalledApps as win32ListInstalledApps } from "../platform/windows/apps.js";

const CONTRACT_MEMBERS = ["listInstalledApps", "listAppProcesses", "activateApp", "openWebsite", "iconService"];

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
  // listInstalledApps já tem provider real (PLAT-02); os outros quatro
  // membros de Fase 3 ainda não — a chamada deve falhar alto e tipado,
  // nunca devolver [] / null em silêncio.
  await assertAllRejectTyped(platform);
});

// listInstalledApps deliberadamente FORA desta lista: PLAT-02 já implementou
// o provider real (platform/windows/apps.js) — ver o teste dedicado acima
// ("...devolve os 5 membros...") e "PLAT-02: win32 listInstalledApps..."
// abaixo, que prova a referência real em vez de reusar este helper.
async function assertAllRejectTyped(platform) {
  for (const member of ["listAppProcesses"]) {
    await assert.rejects(platform[member](), PlatformNotImplementedError);
  }
  await assert.rejects(platform.activateApp({ name: "Notepad" }), PlatformNotImplementedError);
  await assert.rejects(platform.openWebsite("https://example.com"), PlatformNotImplementedError);
  await assert.rejects(platform.iconService.getIconPng("Notepad"), PlatformNotImplementedError);
}

test("PLAT-01/PLAT-06: cada membro win32 ainda-não-implementado falha alto com PlatformNotImplementedError e code estável", async () => {
  const platform = createPlatform("win32");
  await assertAllRejectTyped(platform);
  try {
    await platform.listAppProcesses();
    assert.fail("deveria ter lançado");
  } catch (err) {
    assert.equal(err.code, "PLATFORM_NOT_IMPLEMENTED");
    assert.equal(err.platform, "win32");
    assert.equal(err.member, "listAppProcesses");
    assert.match(err.message, /listAppProcesses/);
  }
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
