import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { startServer } from "../server.js";
import { ActionError } from "../actions.js";
import { PlatformNotImplementedError } from "../platform/index.js";

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

  const { port, close } = await startServer({
    port: 0,
    platform: fakePlatform,
  });

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/windows/win-123/focus`, {
      method: "POST",
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(focusedId, "win-123");
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
