// PLAT-01 wiring (Fase 4) — a fábrica de plataforma existe desde a Fase 1
// (platform/index.js#createPlatform), o provider Windows real existe desde
// a Fase 2/3 (platform/windows/*), mas nada em server.js chamava
// createPlatform() até este fix: makeApp() (server.js:392-395, antes deste
// commit) e o feed WS de startServer() (server.js:~1207, antes deste
// commit) default-avam appTools/actions/iconService pros stubs macOS
// hardcoded de apps.js/actions.js, mesmo rodando em win32. Resultado
// observável: GET /api/apps/installed numa máquina Windows real, sem
// nenhum override, devolvia só `[{name: "Finder", ...}]` — o fallback de
// SYSTEM_APP_PATHS de apps.js, que não checa process.platform.
//
// POR QUE NENHUM TESTE EXISTENTE PEGOU ISSO:
//   - test/platform-factory.test.mjs prova que createPlatform() resolve os
//     providers certos por SO — mas nunca chama makeApp()/startServer().
//   - test/windows-list-installed-apps.test.mjs prova que o provider
//     Windows (chamado DIRETO, sem passar pelo servidor) enumera >=122 apps
//     reais.
//   - Os 12 arquivos que injetam `appTools`/`listInstalledApps` sempre
//     passam um override explícito — nenhum deles exercita o DEFAULT.
// A fábrica e o provider foram testados isoladamente; o fio entre os dois
// nunca foi. Este arquivo é esse fio.
//
// Dois testes, papéis diferentes:
//   1. "seam guard" — roda em QUALQUER SO (Linux incluso, sem PowerShell/
//      filesystem real): injeta deps.platform com sentinels e prova que
//      makeApp deriva appTools/actions/iconService dele. Fica de pé como
//      guard-rail permanente contra a regressão desta tarefa.
//   2. "end-to-end via caminho default" — gated a win32 (mesma convenção de
//      test/windows-list-installed-apps.test.mjs), sem NENHUM override:
//      prova que os mesmos números que a Fase 3 mediu via provider direto
//      (>=122 apps, >=1 UWP, 0 unins*.exe) aparecem através do caminho HTTP
//      que um usuário de verdade bate.

import test from "node:test";
import assert from "node:assert/strict";

import { startServer } from "../server.js";

// Gate legítimo (mesma convenção de test/windows-list-installed-apps.test.mjs
// linha ~18): PowerShell + Get-StartApps/Get-AppxPackage + Start Menu real só
// existem em win32. Em CI (ubuntu-latest, .github/workflows/test.yml) o teste
// #2 conta como skipped — nomeado explicitamente, não escondido. Nesta
// máquina (win32) ele RODA de verdade.
const win32Only = process.platform === "win32"
  ? {}
  : { skip: "requer Windows real (PowerShell + Start Menu) — ver test/windows-list-installed-apps.test.mjs" };

test("PLAT-01 seam guard: makeApp deriva appTools/actions/iconService de deps.platform quando nada mais é injetado (roda em qualquer SO)", async () => {
  const SENTINEL_NAME = "__PLAT01_SENTINEL__";
  const sentinelApps = [{ name: SENTINEL_NAME, path: "C:\\Sentinel Apps\\sentinel.exe", icon: true, kind: "win32" }];
  const sentinelPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x99]); // header PNG + byte-tag
  let activateCalls = 0;

  // Deliberadamente NÃO passamos appTools/actions/iconService — só
  // deps.platform. Se makeApp voltar a usar o default hardcoded de
  // apps.js/actions.js (a regressão exata desta tarefa), nenhum destes
  // sentinels aparece na resposta HTTP e as asserções abaixo falham — em
  // QUALQUER SO, sem precisar de uma máquina Windows real para discriminar.
  const fakePlatform = {
    listInstalledApps: async () => sentinelApps,
    listAppProcesses: async () => [],
    activateApp: async () => { activateCalls++; return { activated: true }; },
    openWebsite: async () => {},
    iconService: { getIconPng: async () => sentinelPng },
  };

  const { port, close } = await startServer({
    port: 0,
    obs: null,
    config: {},
    platform: fakePlatform,
  });
  try {
    // 1) appTools.listInstalledApps veio de deps.platform
    const installedRes = await fetch(`http://127.0.0.1:${port}/api/apps/installed`);
    const installed = await installedRes.json();
    assert.equal(installedRes.status, 200);
    assert.equal(installed.ok, true);
    assert.deepEqual(
      installed.apps,
      sentinelApps,
      "GET /api/apps/installed deveria devolver os apps de deps.platform.listInstalledApps — makeApp não está lendo o default de deps.platform (regressão PLAT-01)",
    );

    // 2) actions.activateApp veio de deps.platform
    const activateRes = await fetch(`http://127.0.0.1:${port}/api/apps/${encodeURIComponent(SENTINEL_NAME)}/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const activateBody = await activateRes.json();
    assert.equal(activateRes.status, 200);
    assert.equal(activateBody.ok, true);
    assert.equal(activateCalls, 1, "actions.activateApp deveria ter vindo de deps.platform.activateApp — makeApp não está lendo o default de deps.platform (regressão PLAT-01)");

    // 3) iconService.getIconPng veio de deps.platform
    const iconRes = await fetch(`http://127.0.0.1:${port}/api/apps/${encodeURIComponent(SENTINEL_NAME)}/icon`);
    const iconBytes = Buffer.from(await iconRes.arrayBuffer());
    assert.equal(iconRes.status, 200);
    assert.equal(
      Buffer.compare(iconBytes, sentinelPng),
      0,
      "GET .../icon deveria devolver os bytes de deps.platform.iconService.getIconPng — makeApp não está lendo o default de deps.platform (regressão PLAT-01)",
    );
  } finally {
    await close();
  }
});

test(
  "PLAT-01 (Fase 4): GET /api/apps/installed via o caminho DEFAULT do servidor (sem nenhum override) bate os mesmos números que a Fase 3 mediu via provider direto",
  win32Only,
  async () => {
    // Sem appTools, sem actions, sem iconService, sem platform — o caminho
    // que server.js resolve sozinho quando ninguém injeta nada, exatamente
    // o que um usuário real bate ao abrir o app.
    const { port, close } = await startServer({ port: 0, obs: null, config: {} });
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/apps/installed`);
      const d = await r.json();
      assert.equal(r.status, 200);
      assert.equal(d.ok, true);
      assert.ok(Array.isArray(d.apps));

      // Mesmo critério de test/windows-list-installed-apps.test.mjs's "PLAT-02
      // end-to-end nesta máquina real" (chamada direta ao provider) — aqui via
      // GET /api/apps/installed, o caminho default do servidor.
      assert.ok(
        d.apps.length >= 122,
        `esperava >=122 apps via o caminho default do servidor, veio ${d.apps.length} — se isto falhar com poucos apps (ex.: 1, "Finder"), o wire makeApp -> createPlatform() está ausente ou quebrado de novo`,
      );
      assert.ok(d.apps.some(a => a.kind === "uwp"), "esperava >=1 app UWP via o caminho default do servidor");

      for (const a of d.apps) {
        const path = String(a.path ?? "");
        const base = path.includes("\\") ? path.slice(path.lastIndexOf("\\") + 1) : path;
        assert.doesNotMatch(base, /^unins.*\.exe$/i, `entrada com target de desinstalador via o caminho default: ${JSON.stringify(a)}`);
      }

      // Não-negociável #3: path.join, nunca separador hardcoded — prova
      // positiva de que pelo menos um path REAL (não sintético) com espaço
      // (ex.: "Program Files") atravessou o pipeline inteiro (PowerShell ->
      // provider -> HTTP JSON) intacto.
      assert.ok(
        d.apps.some(a => / /.test(String(a.path ?? ""))),
        "esperava >=1 path com espaço (ex.: Program Files) entre os apps reais via o caminho default",
      );
    } finally {
      await close();
    }
  },
);
