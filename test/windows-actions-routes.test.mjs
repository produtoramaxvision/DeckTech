import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createServer } from "node:http";
import WebSocket from "ws";

import { startServer, makeApp } from "../server.js";
import { ActionError } from "../actions.js";
import { PlatformNotImplementedError } from "../platform/index.js";

async function createTestApp(platform, onStatusChange) {
  const handler = makeApp({
    platform,
    onStatusChange,
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const close = () => new Promise((resolve) => server.close(resolve));
  return { port, close };
}

test("PLAT-12 routes: POST /api/windows/:id/focus retorna 200 em sucesso e aciona onStatusChange", async () => {
  let focusedId = null;
  let statusChanged = false;

  const fakePlatform = {
    listInstalledApps: async () => [],
    listAppProcesses: async () => [],
    activateApp: async () => {},
    openWebsite: async () => {},
    iconService: { getIconPng: async () => null },
    focusWindow: async (id) => {
      focusedId = id;
      return { ok: true };
    },
    minimizeWindow: async () => {},
    closeWindow: async () => {},
    openNewWindow: async () => {},
  };

  const { port, close } = await createTestApp(fakePlatform, () => {
    statusChanged = true;
  });

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/windows/win-123/focus`, {
      method: "POST",
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(focusedId, "win-123");
    assert.equal(statusChanged, true, "onStatusChange deve ser chamado após foco com sucesso");
  } finally {
    await close();
  }
});

test("PLAT-12 routes: POST /api/windows/:id/focus mapeia WINDOW_NOT_FOUND para 404 e FOCUS_RESTRICTED para 500", async () => {
  let failureCode = "WINDOW_NOT_FOUND";

  const fakePlatform = {
    listInstalledApps: async () => [],
    listAppProcesses: async () => [],
    activateApp: async () => {},
    openWebsite: async () => {},
    iconService: { getIconPng: async () => null },
    focusWindow: async (id) => {
      throw new ActionError(failureCode, `falha de foco: ${id}`);
    },
    minimizeWindow: async () => {},
    closeWindow: async () => {},
    openNewWindow: async () => {},
  };

  const { port, close } = await startServer({
    port: 0,
    platform: fakePlatform,
  });

  try {
    // 1. WINDOW_NOT_FOUND -> 404
    const res404 = await fetch(`http://127.0.0.1:${port}/api/windows/win-missing/focus`, {
      method: "POST",
    });
    const body404 = await res404.json();
    assert.equal(res404.status, 404);
    assert.equal(body404.ok, false);
    assert.equal(body404.code, "WINDOW_NOT_FOUND");
    assert.equal(typeof body404.error, "string");

    // 2. FOCUS_RESTRICTED -> 500
    failureCode = "FOCUS_RESTRICTED";
    const res500 = await fetch(`http://127.0.0.1:${port}/api/windows/win-restricted/focus`, {
      method: "POST",
    });
    const body500 = await res500.json();
    assert.equal(res500.status, 500);
    assert.equal(body500.ok, false);
    assert.equal(body500.code, "FOCUS_RESTRICTED");
    assert.equal(body500.error, "Não foi possível trazer a janela para frente");
    assert.doesNotMatch(body500.error, /nova instância/i);
  } finally {
    await close();
  }
});

test("PLAT-12 routes: POST /api/windows/:id/minimize retorna 200 em sucesso e trata MINIMIZE_FAILED", async () => {
  let minimizedId = null;
  let succeed = true;

  const fakePlatform = {
    listInstalledApps: async () => [],
    listAppProcesses: async () => [],
    activateApp: async () => {},
    openWebsite: async () => {},
    iconService: { getIconPng: async () => null },
    focusWindow: async () => {},
    minimizeWindow: async (id) => {
      minimizedId = id;
      if (!succeed) throw new ActionError("MINIMIZE_FAILED", `failed to minimize ${id}`);
      return { ok: true };
    },
    closeWindow: async () => {},
    openNewWindow: async () => {},
  };

  const { port, close } = await startServer({
    port: 0,
    platform: fakePlatform,
  });

  try {
    const resOk = await fetch(`http://127.0.0.1:${port}/api/windows/win-min-1/minimize`, {
      method: "POST",
    });
    const bodyOk = await resOk.json();
    assert.equal(resOk.status, 200);
    assert.deepEqual(bodyOk, { ok: true });
    assert.equal(minimizedId, "win-min-1");

    succeed = false;
    const resFail = await fetch(`http://127.0.0.1:${port}/api/windows/win-min-1/minimize`, {
      method: "POST",
    });
    const bodyFail = await resFail.json();
    assert.equal(resFail.status, 500);
    assert.equal(bodyFail.ok, false);
    assert.equal(bodyFail.code, "MINIMIZE_FAILED");
  } finally {
    await close();
  }
});

test("PLAT-12 routes: POST /api/windows/:id/close retorna 200 em sucesso e trata CLOSE_FAILED", async () => {
  let closedId = null;
  let succeed = true;

  const fakePlatform = {
    listInstalledApps: async () => [],
    listAppProcesses: async () => [],
    activateApp: async () => {},
    openWebsite: async () => {},
    iconService: { getIconPng: async () => null },
    focusWindow: async () => {},
    minimizeWindow: async () => {},
    closeWindow: async (id) => {
      closedId = id;
      if (!succeed) throw new ActionError("CLOSE_FAILED", `failed to close ${id}`);
      return { ok: true };
    },
    openNewWindow: async () => {},
  };

  const { port, close } = await startServer({
    port: 0,
    platform: fakePlatform,
  });

  try {
    const resOk = await fetch(`http://127.0.0.1:${port}/api/windows/win-close-1/close`, {
      method: "POST",
    });
    const bodyOk = await resOk.json();
    assert.equal(resOk.status, 200);
    assert.deepEqual(bodyOk, { ok: true });
    assert.equal(closedId, "win-close-1");

    succeed = false;
    const resFail = await fetch(`http://127.0.0.1:${port}/api/windows/win-close-1/close`, {
      method: "POST",
    });
    const bodyFail = await resFail.json();
    assert.equal(resFail.status, 500);
    assert.equal(bodyFail.ok, false);
    assert.equal(bodyFail.code, "CLOSE_FAILED");
  } finally {
    await close();
  }
});

test("PLAT-12 routes: POST /api/apps/:name/open-new-window aceita path com espaço e trata APP_NOT_FOUND", async () => {
  let openedName = null;
  const spacedAppName = "Mozilla Firefox Extended";

  const fakePlatform = {
    listInstalledApps: async () => [],
    listAppProcesses: async () => [],
    activateApp: async () => {},
    openWebsite: async () => {},
    iconService: { getIconPng: async () => null },
    focusWindow: async () => {},
    minimizeWindow: async () => {},
    closeWindow: async () => {},
    openNewWindow: async (name) => {
      openedName = name;
      if (name === "Desconhecido") throw new ActionError("APP_NOT_FOUND", "app not found");
      return { ok: true };
    },
  };

  const { port, close } = await startServer({
    port: 0,
    platform: fakePlatform,
  });

  try {
    const resOk = await fetch(`http://127.0.0.1:${port}/api/apps/${encodeURIComponent(spacedAppName)}/open-new-window`, {
      method: "POST",
    });
    const bodyOk = await resOk.json();
    assert.equal(resOk.status, 200);
    assert.deepEqual(bodyOk, { ok: true });
    assert.equal(openedName, spacedAppName);

    const resFail = await fetch(`http://127.0.0.1:${port}/api/apps/Desconhecido/open-new-window`, {
      method: "POST",
    });
    const bodyFail = await resFail.json();
    assert.equal(resFail.status, 500);
    assert.equal(bodyFail.ok, false);
    assert.equal(bodyFail.code, "APP_NOT_FOUND");
  } finally {
    await close();
  }
});

test("PLAT-12: todas as 4 rotas de janela acionam onStatusChange em sucesso (discriminação)", async () => {
  let statusChangeCount = 0;
  const fakePlatform = {
    listInstalledApps: async () => [],
    listAppProcesses: async () => [],
    activateApp: async () => {},
    openWebsite: async () => {},
    iconService: { getIconPng: async () => null },
    focusWindow: async () => ({ ok: true }),
    minimizeWindow: async () => ({ ok: true }),
    closeWindow: async () => ({ ok: true }),
    openNewWindow: async () => ({ ok: true }),
  };

  const { port, close } = await createTestApp(fakePlatform, () => {
    statusChangeCount++;
  });

  try {
    // 1. POST /api/windows/:id/focus
    statusChangeCount = 0;
    const r1 = await fetch(`http://127.0.0.1:${port}/api/windows/win-1/focus`, { method: "POST" });
    assert.equal(r1.status, 200);
    assert.equal(statusChangeCount, 1, "focusWindow deve acionar onStatusChange");

    // 2. POST /api/windows/:id/minimize
    statusChangeCount = 0;
    const r2 = await fetch(`http://127.0.0.1:${port}/api/windows/win-1/minimize`, { method: "POST" });
    assert.equal(r2.status, 200);
    assert.equal(statusChangeCount, 1, "minimizeWindow deve acionar onStatusChange");

    // 3. POST /api/windows/:id/close
    statusChangeCount = 0;
    const r3 = await fetch(`http://127.0.0.1:${port}/api/windows/win-1/close`, { method: "POST" });
    assert.equal(r3.status, 200);
    assert.equal(statusChangeCount, 1, "closeWindow deve acionar onStatusChange");

    // 4. POST /api/apps/:name/open-new-window
    statusChangeCount = 0;
    const r4 = await fetch(`http://127.0.0.1:${port}/api/apps/App/open-new-window`, { method: "POST" });
    assert.equal(r4.status, 200);
    assert.equal(statusChangeCount, 1, "openNewWindow deve acionar onStatusChange");
  } finally {
    await close();
  }
});

test("PLAT-12 routes: rota de janela sob plataforma não suportada (ex.: darwin sem provider) responde 501", async () => {
  const darwinPlatformObj = {
    listInstalledApps: async () => [],
    listAppProcesses: async () => [],
    activateApp: async () => {},
    openWebsite: async () => {},
    iconService: { getIconPng: async () => null },
    focusWindow: async () => { throw new PlatformNotImplementedError("focusWindow", "darwin"); },
    minimizeWindow: async () => { throw new PlatformNotImplementedError("minimizeWindow", "darwin"); },
    closeWindow: async () => { throw new PlatformNotImplementedError("closeWindow", "darwin"); },
    openNewWindow: async () => { throw new PlatformNotImplementedError("openNewWindow", "darwin"); },
  };

  const { port, close } = await startServer({
    port: 0,
    platform: darwinPlatformObj,
  });

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/windows/w1/focus`, {
      method: "POST",
    });
    const body = await res.json();
    assert.equal(res.status, 501);
    assert.equal(body.ok, false);
    assert.equal(body.code, "PLATFORM_NOT_IMPLEMENTED");
  } finally {
    await close();
  }
});

test("PLAT-12/MJ3 routes: provedor que não possui os membros de janela (typeof guard) responde 501 nas 4 rotas", async () => {
  // Provedor que não implementa nenhum dos 4 membros novos (ex.: formato pré-Phase 14)
  const legacyPlatform = {
    listInstalledApps: async () => [],
    listAppProcesses: async () => [],
    activateApp: async () => {},
    openWebsite: async () => {},
    iconService: { getIconPng: async () => null },
  };

  const { port, close } = await startServer({
    port: 0,
    platform: legacyPlatform,
  });

  try {
    const rFocus = await fetch(`http://127.0.0.1:${port}/api/windows/w1/focus`, { method: "POST" });
    const bFocus = await rFocus.json();
    assert.equal(rFocus.status, 501);
    assert.equal(bFocus.code, "PLATFORM_NOT_IMPLEMENTED");

    const rMin = await fetch(`http://127.0.0.1:${port}/api/windows/w1/minimize`, { method: "POST" });
    const bMin = await rMin.json();
    assert.equal(rMin.status, 501);
    assert.equal(bMin.code, "PLATFORM_NOT_IMPLEMENTED");

    const rClose = await fetch(`http://127.0.0.1:${port}/api/windows/w1/close`, { method: "POST" });
    const bClose = await rClose.json();
    assert.equal(rClose.status, 501);
    assert.equal(bClose.code, "PLATFORM_NOT_IMPLEMENTED");

    const rOpen = await fetch(`http://127.0.0.1:${port}/api/apps/TestApp/open-new-window`, { method: "POST" });
    const bOpen = await rOpen.json();
    assert.equal(rOpen.status, 501);
    assert.equal(bOpen.code, "PLATFORM_NOT_IMPLEMENTED");
  } finally {
    await close();
  }
});

test("PLAT-12/MJ3 routes: provedor fallback responde 501 nas 4 rotas via erro tipado", async () => {
  const { createPlatform } = await import("../platform/index.js");
  const fallback = createPlatform("fallback");

  const { port, close } = await startServer({
    port: 0,
    platform: fallback,
  });

  try {
    const rFocus = await fetch(`http://127.0.0.1:${port}/api/windows/w1/focus`, { method: "POST" });
    const bFocus = await rFocus.json();
    assert.equal(rFocus.status, 501);
    assert.equal(bFocus.code, "PLATFORM_NOT_IMPLEMENTED");

    const rMin = await fetch(`http://127.0.0.1:${port}/api/windows/w1/minimize`, { method: "POST" });
    const bMin = await rMin.json();
    assert.equal(rMin.status, 501);
    assert.equal(bMin.code, "PLATFORM_NOT_IMPLEMENTED");

    const rClose = await fetch(`http://127.0.0.1:${port}/api/windows/w1/close`, { method: "POST" });
    const bClose = await rClose.json();
    assert.equal(rClose.status, 501);
    assert.equal(bClose.code, "PLATFORM_NOT_IMPLEMENTED");

    const rOpen = await fetch(`http://127.0.0.1:${port}/api/apps/TestApp/open-new-window`, { method: "POST" });
    const bOpen = await rOpen.json();
    assert.equal(rOpen.status, 501);
    assert.equal(bOpen.code, "PLATFORM_NOT_IMPLEMENTED");
  } finally {
    await close();
  }
});

test("PLAT-12 (M1): rotas de janela invalidam cache e onStatusChange entrega o novo estado imediatamente", async () => {
  let currentState = "focused";
  let windowList = [{ id: "win-1", name: "TestApp", state: currentState, monitor: 0, title: "Test" }];

  let collectCalls = 0;
  let cache = null;

  const fakeListAppProcesses = async () => {
    if (cache) return cache;
    collectCalls++;
    cache = windowList.map(w => ({ ...w, state: currentState }));
    return cache;
  };
  fakeListAppProcesses.invalidateCache = () => {
    cache = null;
  };

  let pushState = null;
  const fakePlatform = {
    listInstalledApps: async () => [],
    listAppProcesses: fakeListAppProcesses,
    activateApp: async () => {},
    openWebsite: async () => {},
    iconService: { getIconPng: async () => null },
    focusWindow: async () => {
      currentState = "focused";
      return { ok: true };
    },
    minimizeWindow: async () => {
      currentState = "minimized";
      return { ok: true };
    },
    closeWindow: async () => {
      windowList = [];
      return { ok: true };
    },
    openNewWindow: async () => {
      windowList = [
        { id: "win-1", name: "TestApp", state: currentState, monitor: 0, title: "Test" },
        { id: "win-2", name: "TestApp", state: "background", monitor: 0, title: "Test 2" },
      ];
      return { ok: true };
    },
  };

  const { port, close } = await createTestApp(fakePlatform, async () => {
    const procs = await fakePlatform.listAppProcesses();
    pushState = procs;
  });

  try {
    // 1. Aquece o cache com estado inicial "focused"
    const warm = await fakePlatform.listAppProcesses();
    assert.equal(warm[0].state, "focused");
    assert.equal(collectCalls, 1);

    // 2. Minimiza a janela via POST
    const rMin = await fetch(`http://127.0.0.1:${port}/api/windows/win-1/minimize`, { method: "POST" });
    assert.equal(rMin.status, 200);
    // onStatusChange deve ter lido o estado NOVO imediatamente ("minimized"), não o cache antigo ("focused")
    assert.equal(pushState[0].state, "minimized", "push após minimize deve carregar o novo estado 'minimized'");
    assert.equal(collectCalls, 2);

    // 3. Foca a janela via POST
    const rFocus = await fetch(`http://127.0.0.1:${port}/api/windows/win-1/focus`, { method: "POST" });
    assert.equal(rFocus.status, 200);
    assert.equal(pushState[0].state, "focused", "push após focus deve carregar o novo estado 'focused'");
    assert.equal(collectCalls, 3);

    // 4. Abre nova janela via POST
    const rOpen = await fetch(`http://127.0.0.1:${port}/api/apps/TestApp/open-new-window`, { method: "POST" });
    assert.equal(rOpen.status, 200);
    assert.equal(pushState.length, 2, "push após open-new-window deve conter a nova janela");
    assert.equal(collectCalls, 4);

    // 5. Fecha a janela via POST
    const rClose = await fetch(`http://127.0.0.1:${port}/api/windows/win-1/close`, { method: "POST" });
    assert.equal(rClose.status, 200);
    assert.equal(pushState.length, 0, "push após close deve refletir fechamento imediatamente");
    assert.equal(collectCalls, 5);
  } finally {
    await close();
  }
});

test("PLAT-12 (M1): WebSocket push após ação de janela entrega o estado novo imediatamente (sem esperar TTL)", async () => {
  let currentState = "focused";
  let cache = null;
  let collectCount = 0;

  const fakeListAppProcesses = async () => {
    if (cache) return cache;
    collectCount++;
    cache = [{ id: "win-1", name: "TestApp", state: currentState, monitor: 0, title: "Test" }];
    return cache;
  };
  fakeListAppProcesses.invalidateCache = () => {
    cache = null;
  };

  const fakePlatform = {
    listInstalledApps: async () => [],
    listAppProcesses: fakeListAppProcesses,
    activateApp: async () => {},
    openWebsite: async () => {},
    iconService: { getIconPng: async () => null },
    focusWindow: async () => {
      currentState = "focused";
      return { ok: true };
    },
    minimizeWindow: async () => {
      currentState = "minimized";
      return { ok: true };
    },
    closeWindow: async () => {
      currentState = "closed";
      return { ok: true };
    },
    openNewWindow: async () => ({ ok: true }),
  };

  const { port, close } = await startServer({
    port: 0,
    platform: fakePlatform,
  });

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const wsMessages = [];
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString("utf8"));
      if (msg.type === "apps") wsMessages.push(msg);
    } catch {}
  });

  await new Promise((resolve) => ws.once("open", resolve));
  // Aguarda primeiro push do WS (estado inicial)
  for (let i = 0; i < 20 && wsMessages.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(wsMessages.length, 1);
  assert.equal(wsMessages[0].running[0].state, "focused");

  try {
    // POST /api/windows/win-1/minimize
    const r = await fetch(`http://127.0.0.1:${port}/api/windows/win-1/minimize`, { method: "POST" });
    assert.equal(r.status, 200);

    // Aguarda o push disparado pela ação
    for (let i = 0; i < 20 && wsMessages.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(wsMessages.length >= 2, "deve ter recebido push imediato após minimize");
    const pushAfterMin = wsMessages[1];
    assert.equal(
      pushAfterMin.running[0].state,
      "minimized",
      "o primeiro push após minimize DEVE carregar 'minimized', não o estado anterior em cache ('focused')"
    );
  } finally {
    ws.close();
    await close();
  }
});
