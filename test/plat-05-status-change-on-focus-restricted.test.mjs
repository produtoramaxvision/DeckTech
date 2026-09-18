// PLAT-05 — reviewer finding from Fase 2 closed here: `onStatusChange` (the
// WS push) did not fire on FOCUS_RESTRICTED even though the app DID open
// (PRD §15's accepted fallback: a new instance). Without the push, other
// devices connected to the same server never learned about the new
// instance until the next STATUS_POLL_MS (1.5s) poll — the exact delay the
// WS feed exists to eliminate for every OTHER mutation (pin/unpin, config
// change, add/remove piece — see the `onStatusChange` calls throughout
// server.js). This file proves both directions: the push DOES fire for
// FOCUS_RESTRICTED (app opened, others need to know) and does NOT fire for
// APP_NOT_FOUND / LAUNCH_FAILED (nothing opened — pushing would be noise
// and would wrongly suggest "call onStatusChange unconditionally in the
// catch" is the fix, which it is not).
//
// The assertion is on the WS PUSH ITSELF (frame count), never on payload
// content: `running` comes from a TTL-cached (1.5s) `listAppProcesses()`
// mock here anyway, but even with a real provider a freshly launched app's
// window can take longer than one broadcast to appear — asserting content
// would be flaky by construction. `broadcast(true)` (what `onStatusChange`
// triggers via `feed.ping()`) bypasses the `encoded === last` dedupe in
// server.js's `createStatusFeed`, so a push always lands regardless of
// content — that is what makes a frame-count assertion reliable here.

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import WebSocket from "ws";
import { startServer, makeApp } from "../server.js";
import { ActionError } from "../actions.js";

/** Conta só as mensagens `type:"apps"` — mesmo filtro que o front real usa. */
function collectAppsFrames(port) {
  const frames = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const opened = new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.on("message", (raw) => {
    let d = null;
    try { d = JSON.parse(String(raw)); } catch { return; }
    if (d && d.type === "apps") frames.push(d);
  });
  async function waitForCount(n, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (frames.length < n) {
      if (Date.now() > deadline) throw new Error(`timeout esperando ${n} frame(s) 'apps' (tenho ${frames.length})`);
      await new Promise((r) => setTimeout(r, 20));
    }
    return frames;
  }
  return { ws, opened, frames, waitForCount };
}

async function withServer(actionsOverride, fn) {
  const { port, close } = await startServer({
    port: 0,
    config: { pinned: [] },
    appTools: { listAppProcesses: async () => [] },
    actions: actionsOverride,
  });
  const client = collectAppsFrames(port);
  try {
    await client.opened;
    await client.waitForCount(1); // frame inicial do addClient (broadcast(true) no connect)
    await fn({ port, client });
  } finally {
    try { client.ws.close(); } catch { /* noop */ }
    await close();
  }
}

test("PLAT-05: FOCUS_RESTRICTED empurra um novo frame 'apps' via WS (nova instância abriu, outros devices precisam saber)", async () => {
  await withServer(
    { activateApp: async () => { throw new ActionError("FOCUS_RESTRICTED", 'focus restricted for "Notepad++", opened new instance'); } },
    async ({ port, client }) => {
      const before = client.frames.length;
      const r = await fetch(`http://127.0.0.1:${port}/api/apps/Notepad%2B%2B/activate`, {
        method: "POST",
        body: JSON.stringify({ pid: 123 }),
      });
      assert.equal(r.status, 500);
      const d = await r.json();
      assert.equal(d.code, "FOCUS_RESTRICTED");
      await client.waitForCount(before + 1);
    },
  );
});

test("PLAT-05: APP_NOT_FOUND NÃO empurra frame extra (nada abriu — 'sempre no catch' seria o fix errado)", async () => {
  await withServer(
    { activateApp: async () => { throw new ActionError("APP_NOT_FOUND", 'app not found in Windows catalog: "Fantasma"'); } },
    async ({ port, client }) => {
      const before = client.frames.length;
      const r = await fetch(`http://127.0.0.1:${port}/api/apps/Fantasma/activate`, { method: "POST", body: "{}" });
      assert.equal(r.status, 500);
      const d = await r.json();
      assert.equal(d.code, "APP_NOT_FOUND");
      await new Promise((res) => setTimeout(res, 400)); // dá tempo pra um push indevido chegar, se houvesse
      assert.equal(client.frames.length, before, "APP_NOT_FOUND não deveria empurrar WS — nada abriu");
    },
  );
});

test("PLAT-05: LAUNCH_FAILED NÃO empurra frame extra (fallback também falhou — nada abriu)", async () => {
  await withServer(
    { activateApp: async () => { throw new ActionError("LAUNCH_FAILED", 'launch failed for "Notepad++"'); } },
    async ({ port, client }) => {
      const before = client.frames.length;
      const r = await fetch(`http://127.0.0.1:${port}/api/apps/Notepad%2B%2B/activate`, { method: "POST", body: "{}" });
      assert.equal(r.status, 500);
      const d = await r.json();
      assert.equal(d.code, "LAUNCH_FAILED");
      await new Promise((res) => setTimeout(res, 400));
      assert.equal(client.frames.length, before, "LAUNCH_FAILED não deveria empurrar WS — nada abriu");
    },
  );
});

test("PLAT-05: activação bem-sucedida (sem erro) continua empurrando frame — regressão do comportamento pré-existente", async () => {
  await withServer(
    { activateApp: async () => {} },
    async ({ port, client }) => {
      const before = client.frames.length;
      const r = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, { method: "POST", body: JSON.stringify({ pid: 1 }) });
      assert.equal(r.status, 200);
      await client.waitForCount(before + 1);
    },
  );
});

// Um listener de onStatusChange que lança nunca pode derrubar a resposta
// HTTP já enviada por fail() — server.js precisa envolver a segunda chamada
// em try/catch. `startServer` sempre substitui `onStatusChange` por
// `() => feed.ping()` (server.js:~1108), então pra injetar um listener que
// lança de propósito é preciso ir direto em `makeApp` (que aceita
// `onStatusChange` sem sobrescrever) + um `http.createServer` cru — não dá
// pra provar isso passando por `startServer`.
test("PLAT-05: onStatusChange lançando no caminho FOCUS_RESTRICTED não derruba a resposta HTTP nem o servidor", async () => {
  let onStatusChangeCalls = 0;
  const handler = makeApp({
    config: { pinned: [] },
    appTools: { listAppProcesses: async () => [] },
    actions: { activateApp: async () => { throw new ActionError("FOCUS_RESTRICTED", "x"); } },
    onStatusChange: () => { onStatusChangeCalls++; throw new Error("listener quebrado de propósito"); },
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, { method: "POST", body: JSON.stringify({ pid: 1 }) });
    assert.equal(r.status, 500);
    const d = await r.json();
    assert.equal(d.code, "FOCUS_RESTRICTED");
    assert.equal(typeof d.error, "string");
    assert.equal(onStatusChangeCalls, 1, "onStatusChange precisa ter sido chamado (e lançado) mesmo assim");
    // servidor continua de pé — o throw do listener não virou unhandled rejection
    const r2 = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, { method: "POST", body: JSON.stringify({ pid: 1 }) });
    assert.equal(r2.status, 500);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
