import test from "node:test";
import assert from "node:assert/strict";
import { access, rm } from "node:fs/promises";
import { startServer } from "../server.js";
import { activateApp as realActivate, ActionError } from "../actions.js";

function realStack(cmds) {
  const tools = { exec: async (cmd, args) => { cmds.push([cmd, args]); return { stdout: "" }; } };
  return { activateApp: app => realActivate(app, tools) };
}

test("POST /api/apps/:name/activate foca via actions com pid", async () => {
  let called = null;
  const { port, close } = await startServer({
    port: 0,
    actions: { activateApp: async app => { called = app; } },
  });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pid: 1234 }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.deepEqual(called, { name: "Chrome", pid: 1234 });
  } finally { await close(); }
});

test("POST activate sem body trata pid como undefined (abre)", async () => {
  let called = null;
  const { port, close } = await startServer({
    port: 0,
    actions: { activateApp: async app => { called = app; } },
  });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/TextEdit/activate`, { method: "POST" });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.deepEqual(d, { ok: true });
    assert.deepEqual(called, { name: "TextEdit", pid: undefined });
  } finally { await close(); }
});

test("POST activate com erro responde 500 ok:false", async () => {
  const { port, close } = await startServer({
    port: 0,
    actions: { activateApp: async () => { throw new Error("boom"); } },
  });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, {
      method: "POST",
      body: JSON.stringify({ pid: 1 }),
    });
    assert.equal(r.status, 500);
    const d = await r.json();
    assert.equal(d.ok, false);
    assert.match(d.error, /erro interno/);
    assert.doesNotMatch(d.error, /boom/, "detalhe interno não vaza pro cliente");
  } finally { await close(); }
});

test("POST activate com pid malicioso (string) nunca vai pro osascript", async () => {
  const cmds = [];
  const target = "/tmp/j5pwned";
  await rm(target, { force: true });
  const { port, close } = await startServer({ port: 0, actions: realStack(cmds) });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pid: `5; do shell script "touch ${target}"` }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(cmds.filter(c => c[0] === "osascript"), []);
    assert.ok(cmds.some(c => c[0] === "open" && c[1].join(" ").includes("Chrome")));
    assert.ok(cmds.every(c => !c[1].join(" ").includes(target)));
    await assert.rejects(access(target), /ENOENT/);
  } finally { await close(); await rm(target, { force: true }); }
});

test("POST activate com pid float cai pro open (sem pid)", async () => {
  const cmds = [];
  const { port, close } = await startServer({ port: 0, actions: realStack(cmds) });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, {
      method: "POST",
      body: JSON.stringify({ pid: 7.5 }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(cmds.filter(c => c[0] === "osascript"), []);
    assert.ok(cmds.some(c => c[0] === "open"));
  } finally { await close(); }
});

test("POST activate com pid inteiro positivo foca via osascript", async () => {
  const cmds = [];
  const { port, close } = await startServer({ port: 0, actions: realStack(cmds) });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, {
      method: "POST",
      body: JSON.stringify({ pid: 1234 }),
    });
    assert.equal(r.status, 200);
    assert.ok(cmds.some(c => c[0] === "osascript" && c[1].join(" ").includes("1234")));
  } finally { await close(); }
});

test("GET activate com URI malformada nao derruba o servidor", async () => {
  const { port, close } = await startServer({ port: 0 });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/%E0%A4%A/activate`);
    assert.ok(r.status === 400 || r.status === 404);
    const h = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(h.status, 200);
  } finally { await close(); }
});

test("POST activate com URI malformada responde 400 sem cair", async () => {
  const { port, close } = await startServer({ port: 0 });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/%E0%A4%A/activate`, {
      method: "POST",
      body: "{}",
    });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { ok: false, error: "nome inválido" });
    const h = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(h.status, 200);
  } finally { await close(); }
});

test("POST activate com corpo maior que 64KB responde 413", async () => {
  const { port, close } = await startServer({ port: 0 });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, {
      method: "POST",
      body: JSON.stringify({ pid: 1234, junk: "x".repeat(128 * 1024) }),
    });
    assert.equal(r.status, 413);
  } finally { await close(); }
});

// ---------- PLAT-06: erros tipados de ação chegam ao cliente como código
// distinguível, não como o {ok:false,error:"erro interno"} genérico de
// fail() (server.js). Cada teste injeta `actions.activateApp` para forçar a
// falha correspondente — o mesmo mapeamento de server.js roda hoje no
// macOS real (actions.js) e vai rodar no Windows futuro (platform/index.js),
// então testar aqui a camada de mapeamento (fail() por `.code`) cobre as
// duas plataformas sem depender de nenhuma delas.

test("PLAT-06: activate com APP_NOT_FOUND chega ao cliente com code distinguível, não 'erro interno'", async () => {
  const { port, close } = await startServer({
    port: 0,
    // nome com espaço: exercita encode/decodeURIComponent na rota (constraint
    // da tarefa) e prova que o code tipado sobrevive ao round-trip.
    actions: { activateApp: async () => { throw new ActionError("APP_NOT_FOUND", "open failed for \"Google Chrome\""); } },
  });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/${encodeURIComponent("Google Chrome")}/activate`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 500);
    const d = await r.json();
    assert.equal(d.ok, false);
    assert.equal(d.code, "APP_NOT_FOUND");
    assert.notEqual(d.error, "erro interno");
    // shape preservado: ok:false + error (string) continuam presentes, como
    // já era antes do PLAT-06 — só ganhou o campo `code` a mais.
    assert.equal(typeof d.error, "string");
  } finally { await close(); }
});

test("PLAT-06: activate com LAUNCH_FAILED chega ao cliente com code distinguível de APP_NOT_FOUND", async () => {
  const { port, close } = await startServer({
    port: 0,
    actions: { activateApp: async () => { throw new ActionError("LAUNCH_FAILED", "boom internals /Users/x/Applications/Chrome.app"); } },
  });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 500);
    const d = await r.json();
    assert.equal(d.ok, false);
    assert.equal(d.code, "LAUNCH_FAILED");
    assert.notEqual(d.error, "erro interno");
    // detalhe interno (path do .app) nunca vaza pro cliente
    assert.doesNotMatch(d.error, /\/Users\//);
    assert.doesNotMatch(d.error, /boom/);
  } finally { await close(); }
});

test("PLAT-06: activate com FOCUS_RESTRICTED chega ao cliente com code distinguível (PRD §15: nova instância é fallback aceito)", async () => {
  const { port, close } = await startServer({
    port: 0,
    actions: { activateApp: async () => { throw new ActionError("FOCUS_RESTRICTED", "focus restricted for \"Notes\", opened new instance"); } },
  });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/apps/Notes/activate`, {
      method: "POST",
      body: JSON.stringify({ pid: 55 }),
    });
    assert.equal(r.status, 500);
    const d = await r.json();
    assert.equal(d.ok, false);
    assert.equal(d.code, "FOCUS_RESTRICTED");
    assert.notEqual(d.code, "APP_NOT_FOUND");
    assert.notEqual(d.error, "erro interno");
  } finally { await close(); }
});

test("PLAT-06: os 3 códigos tipados são mutuamente distinguíveis (error text nunca coincide entre eles)", async () => {
  const codes = ["FOCUS_RESTRICTED", "APP_NOT_FOUND", "LAUNCH_FAILED"];
  const seen = new Map();
  for (const code of codes) {
    const { port, close } = await startServer({
      port: 0,
      actions: { activateApp: async () => { throw new ActionError(code, "detalhe interno irrelevante"); } },
    });
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/apps/Chrome/activate`, { method: "POST", body: "{}" });
      const d = await r.json();
      seen.set(code, d.error);
    } finally { await close(); }
  }
  const texts = [...seen.values()];
  assert.equal(new Set(texts).size, texts.length, "cada código precisa de uma mensagem própria e distinguível");
});
