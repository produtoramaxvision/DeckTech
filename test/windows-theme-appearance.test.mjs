// PLAT-07 — tests for platform/windows/theme.js, the Windows equivalent of
// apps.js's readMacIconAppearance (apps.js:281-291) wired into
// platform/windows/icon.js's `appearanceToken` dep (see
// test/windows-icon-service.test.mjs's "PLAT-07:" block for the cache-key
// side of this).
//
// Same split the rest of platform/windows/* tests use: composition-level
// tests below inject `execFn`/`read`/`startWatcher` so the read side and
// the tracker's caching/invalidation logic run on any OS (CI included) —
// none of them touch the real registry or spawn a real process. The
// win32Only block at the bottom exercises the REAL RegNotifyChangeKeyValue
// watcher end to end on this machine, against a disposable scratch
// registry key (never the real AppsUseLightTheme key — that stays
// untouched by the automated suite; the actual theme flip for criterion 5
// is a standalone scratch script, not part of `node --test`).

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  readWindowsIconAppearance,
  createWindowsAppearanceTracker,
  startThemeWatcher,
  THEME_KEY_PATH,
} from "../platform/windows/theme.js";

const win32Only = process.platform === "win32" ? {} : { skip: "requer Windows real (reg.exe + RegNotifyChangeKeyValue)" };
const execFileAsync = promisify(execFile);

// --- readWindowsIconAppearance: leitura sob demanda ------------------------

test("readWindowsIconAppearance: REG_DWORD 0x1 -> apps=light", async () => {
  const execFn = async () => ({ stdout: "    AppsUseLightTheme    REG_DWORD    0x1\r\n" });
  assert.equal(await readWindowsIconAppearance(execFn), "apps=light");
});

test("readWindowsIconAppearance: REG_DWORD 0x0 -> apps=dark", async () => {
  const execFn = async () => ({ stdout: "    AppsUseLightTheme    REG_DWORD    0x0\r\n" });
  assert.equal(await readWindowsIconAppearance(execFn), "apps=dark");
});

test("readWindowsIconAppearance: reg.exe falha (chave/valor ausente) -> token de fallback distinto, nunca lança", async () => {
  const execFn = async () => { throw new Error("ERROR: The system was unable to find the specified registry key or value."); };
  await assert.doesNotReject(async () => {
    const token = await readWindowsIconAppearance(execFn);
    assert.equal(token, "apps=unknown");
  });
});

test("readWindowsIconAppearance: stdout em formato inesperado -> mesmo token de fallback, não lança nem devolve NaN", async () => {
  const execFn = async () => ({ stdout: "saída completamente diferente sem AppsUseLightTheme nenhum\r\n" });
  assert.equal(await readWindowsIconAppearance(execFn), "apps=unknown");
});

test("readWindowsIconAppearance: nunca usa um shell — execFn recebe (cmd, args[]) separados, nunca uma string composta", async () => {
  let received;
  const execFn = async (cmd, args) => { received = { cmd, args }; return { stdout: "AppsUseLightTheme    REG_DWORD    0x1" }; };
  await readWindowsIconAppearance(execFn);
  assert.equal(received.cmd, "reg.exe");
  assert.ok(Array.isArray(received.args), "args deve ser um array — nunca uma string concatenada que passaria por um shell");
});

// --- createWindowsAppearanceTracker: cache + invalidação orientada a evento

test("createWindowsAppearanceTracker: token() é preguiçoso — read() só roda na primeira chamada, não na construção", async () => {
  let reads = 0;
  const tracker = createWindowsAppearanceTracker({ read: async () => { reads++; return "apps=dark"; } });
  assert.equal(reads, 0, "construir o tracker não deve ler nada");
  assert.equal(await tracker.token(), "apps=dark");
  assert.equal(reads, 1);
  await tracker.token();
  assert.equal(reads, 1, "segunda chamada usa o cache, não relê");
});

test("createWindowsAppearanceTracker: construir NUNCA spawna o watcher — só start() faz isso", () => {
  let spawned = false;
  createWindowsAppearanceTracker({ startWatcher: () => { spawned = true; return { kill() {} }; } });
  assert.equal(spawned, false, "construção sozinha não deve chamar startWatcher");
});

test("createWindowsAppearanceTracker: start() é idempotente — uma 2ª chamada com processo já de pé não spawna outro", () => {
  let spawnCount = 0;
  const tracker = createWindowsAppearanceTracker({
    startWatcher: () => { spawnCount++; return { kill() {} }; },
  });
  tracker.start();
  tracker.start();
  assert.equal(spawnCount, 1);
  tracker.stop();
});

test("createWindowsAppearanceTracker: evento onChange do watcher invalida o cache — token() relê na PRÓXIMA chamada, event-driven, não por TTL/timer", async () => {
  let reads = 0;
  let current = "apps=dark";
  let onChangeCb;
  const tracker = createWindowsAppearanceTracker({
    read: async () => { reads++; return current; },
    startWatcher: (keyPath, { onChange }) => { onChangeCb = onChange; return { kill() {} }; },
  });

  assert.equal(await tracker.token(), "apps=dark");
  assert.equal(reads, 1);
  assert.equal(await tracker.token(), "apps=dark");
  assert.equal(reads, 1, "sem evento nenhum, token() continua servindo do cache — nunca relê sozinho");

  tracker.start();
  current = "apps=light"; // "o usuário trocou o tema" — só o VALOR muda; ninguém chamou token() ainda
  assert.equal(reads, 1, "trocar o valor sozinho, sem o evento, não deve disparar leitura nenhuma — não é polling");

  onChangeCb(); // o watcher real dispararia isto quando RegNotifyChangeKeyValue retornasse
  assert.equal(await tracker.token(), "apps=light", "depois do evento, a PRÓXIMA chamada de token() já vê o valor novo");
  assert.equal(reads, 2, "releu exatamente uma vez, por causa do evento — não um contador crescendo sozinho");

  tracker.stop();
});

test("createWindowsAppearanceTracker: onExit inesperado do watcher NÃO reinicia sozinho (sem crash-loop) — token() continua funcionando via leitura avulsa", async () => {
  let reads = 0;
  let spawnCount = 0;
  let onExitCb;
  const tracker = createWindowsAppearanceTracker({
    read: async () => { reads++; return "apps=dark"; },
    startWatcher: (keyPath, { onExit }) => { spawnCount++; onExitCb = onExit; return { kill() {} }; },
  });

  tracker.start();
  assert.equal(spawnCount, 1);
  onExitCb(1); // watcher morreu sozinho (ex.: powershell.exe bloqueado por política)
  // dar tempo pro event loop não é necessário aqui: onExit é síncrono no design do tracker.
  assert.equal(spawnCount, 1, "sem auto-restart — um watcher morto não deve virar um segundo processo sozinho");
  assert.equal(await tracker.token(), "apps=dark", "token() continua respondendo (via leitura avulsa), mesmo com o watcher morto");
});

test("createWindowsAppearanceTracker: stop() mata o processo e start() depois de stop() é no-op", () => {
  let killed = false;
  let spawnCount = 0;
  const tracker = createWindowsAppearanceTracker({
    startWatcher: () => { spawnCount++; return { kill: () => { killed = true; } }; },
  });
  tracker.start();
  tracker.stop();
  assert.equal(killed, true);
  tracker.start(); // depois de stop() — não deve religar
  assert.equal(spawnCount, 1, "start() após stop() não deve spawnar de novo");
});

// --- Real machine: o watcher de verdade, contra uma chave descartável -----
// Nunca toca HKCU\...\Personalize\AppsUseLightTheme — só uma sub-chave de
// teste, criada e destruída por este teste. O flip real de AppsUseLightTheme
// (critério de sucesso 5) é um script avulso, não esta suite.

const SCRATCH_KEY_PATH = "Software\\DecktechPlat07Test\\WatchProbe";
const SCRATCH_KEY_HKCU = `HKCU\\${SCRATCH_KEY_PATH}`;

async function regAdd(name, value) {
  await execFileAsync("reg.exe", ["add", SCRATCH_KEY_HKCU, "/v", name, "/t", "REG_DWORD", "/d", String(value), "/f"], { windowsHide: true });
}
async function regDeleteTree() {
  try {
    await execFileAsync("reg.exe", ["delete", "HKCU\\Software\\DecktechPlat07Test", "/f"], { windowsHide: true });
  } catch { /* já não existia */ }
}

test("PLAT-07 (máquina real): startThemeWatcher detecta uma mudança REAL de registro via RegNotifyChangeKeyValue e não deixa processo órfão", win32Only, async () => {
  await regDeleteTree();
  await regAdd("Probe", 1);
  try {
    const changes = [];
    let exitCode;
    const child = await new Promise((resolve) => {
      const c = startThemeWatcher(SCRATCH_KEY_PATH, {
        onChange: () => changes.push(Date.now()),
        onExit: (code) => { exitCode = code; },
      });
      // dá um instante pro powershell.exe subir e entrar na chamada
      // bloqueante antes de mexermos no registro.
      setTimeout(() => resolve(c), 800);
    });
    const pid = child.pid;
    assert.ok(pid > 0, "watcher deveria ter um pid real");

    await regAdd("Probe", 2); // mudança real sob a chave observada

    // Espera a notificação chegar — poll CURTO e FINITO só pra sincronizar
    // com um evento assíncrono de teste (não é o mecanismo de produção,
    // que é 100% orientado a evento — ver comentário de topo do arquivo e
    // WATCH_SCRIPT em theme.js). 10s de teto, checagem a cada 100ms.
    const deadline = Date.now() + 10_000;
    while (changes.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(changes.length, 1, "deveria ter recebido exatamente 1 notificação da mudança real de registro");

    child.kill();
    // dá tempo do 'exit' disparar e o pid morrer de verdade.
    const exitDeadline = Date.now() + 5_000;
    while (exitCode === undefined && Date.now() < exitDeadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.notEqual(exitCode, undefined, "onExit deveria ter disparado depois de kill()");

    // Prova de "sem órfão": confirma por PID *e* por nome via `tasklist`
    // (nunca lança por código de saída — diferente de `powershell -Command
    // ... -ErrorAction SilentlyContinue`, que devolve exit code 1 mesmo
    // pro caso "não achei nada", visto empiricamente escrevendo este
    // teste) — checar só o pid seria a MESMA lição que
    // docs/adr/0004-...'s round-3/4 documentam (pid sozinho não prova
    // ausência/presença real sob reciclagem de pid desta máquina), daí o
    // segundo filtro por IMAGENAME.
    await new Promise((r) => setTimeout(r, 300));
    const { stdout: tasklistOut } = await execFileAsync(
      "tasklist",
      ["/FI", `PID eq ${pid}`, "/FI", "IMAGENAME eq powershell.exe", "/NH", "/FO", "CSV"],
      { windowsHide: true },
    );
    assert.ok(!tasklistOut.includes(`"${pid}"`), `pid ${pid} não deveria mais existir como processo powershell.exe após kill() — tasklist: ${tasklistOut.trim()}`);
  } finally {
    await regDeleteTree();
  }
});

test("PLAT-07 (máquina real): THEME_KEY_PATH aponta pra chave certa e o leitor real (sem execFn injetado) não lança nesta máquina", win32Only, async () => {
  assert.equal(THEME_KEY_PATH, "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");
  const token = await readWindowsIconAppearance(); // execFn real, reg.exe de verdade
  assert.match(token, /^apps=(light|dark|unknown)$/);
});
