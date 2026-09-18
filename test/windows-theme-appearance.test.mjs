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
import { EventEmitter } from "node:events";

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
  // startWatcher injetado (nunca o default real): desde o Round-2 fix,
  // token() lazy-starta o watch na primeira chamada (ver "PLAT-07 Round-2"
  // abaixo) — sem este stub, este teste chamaria o startThemeWatcher REAL e
  // spawnaria um powershell.exe de verdade, nunca parado, como efeito
  // colateral de um teste que só quer provar o cache de leitura.
  const tracker = createWindowsAppearanceTracker({
    read: async () => { reads++; return "apps=dark"; },
    startWatcher: () => ({ kill() {} }),
  });
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

// Round-3 finding 1: uma invalidação que chega ENQUANTO uma leitura já está
// em voo não pode ser engolida pelo `.then` de sucesso dessa leitura
// escrevendo o valor PRÉ-mudança de volta em `cached` por cima do `null`
// que onWatcherChange() acabou de colocar lá. Sem guarda de geração, o
// token fica errado pro resto da vida do tracker — nenhum TTL por trás pra
// se autocurar (diferente do MAC_ICON_APPEARANCE_TTL_MS de apps.js) — até a
// PRÓXIMA mudança de tema. Determinístico: a 1ª leitura só resolve quando
// este teste manda (`releaseFirst`), então dá pra disparar o evento
// exatamente NO MEIO da janela, sem timer nenhum.
test("createWindowsAppearanceTracker: onChange chegando NO MEIO de uma leitura em voo não é engolido — a PRÓXIMA token() relê e vê o valor novo, não o poisoned (Round-3 finding 1)", async () => {
  let reads = 0;
  let current = "apps=dark";
  let releaseFirst;
  let onChangeCb;
  const tracker = createWindowsAppearanceTracker({
    read: () => {
      reads++;
      if (reads === 1) {
        // 1ª leitura fica pendurada até este teste liberar — simula a
        // janela real medida (~21ms) onde uma mudança pode chegar.
        return new Promise((resolve) => { releaseFirst = () => resolve("apps=dark"); });
      }
      return Promise.resolve(current);
    },
    startWatcher: (keyPath, { onChange }) => { onChangeCb = onChange; return { kill() {} }; },
  });

  const first = tracker.token(); // leitura #1 em voo, ainda não resolvida
  // `ensureToken()` encadeia `read()` dentro de um `.then()` — ele só roda
  // depois que a microtask atual esvazia, não sincronamente aqui. Um
  // `await` de uma promise já resolvida força exatamente essa drenagem
  // (confirmado via context7 /nodejs/node: callbacks de `.then()` rodam
  // como microtask, depois do código síncrono corrente) — sem isto,
  // `releaseFirst` ainda não teria sido atribuído por `read()`.
  await Promise.resolve();
  assert.equal(reads, 1, "leitura #1 já deveria estar em voo depois da drenagem de microtask");
  onChangeCb();                  // o tema muda ENQUANTO a leitura #1 ainda está no ar
  current = "apps=light";
  releaseFirst();                // leitura #1 finalmente resolve com o valor PRÉ-mudança

  assert.equal(await first, "apps=dark", "quem já estava esperando a leitura em voo recebe o valor que ela de fato leu — mesmo comportamento do TTL de 1s do macOS pra um co-chamador dentro da janela");
  assert.equal(
    await tracker.token(),
    "apps=light",
    "SEM a guarda de geração, isto seria 'apps=dark' — o .then de sucesso da leitura #1 escreveria o valor velho em cima do cached=null que onChange() acabou de colocar, engolindo a invalidação",
  );
  assert.equal(reads, 2, "a invalidação mid-flight deveria ter forçado uma releitura de verdade, não servido do cache poisoned");

  tracker.stop();
});

// Contra-discriminador: se a guarda fosse invertida (`generation !== startedAt`),
// TODA escrita de cache ficaria bloqueada, inclusive a normal (nenhuma leitura
// jamais popularia `cached`, então toda chamada subsequente de token() releria
// do zero). Verificado manualmente invertendo a guarda e rodando esta suite: o
// teste "evento onChange do watcher invalida o cache" acima falha nesse cenário
// (2ª chamada de token() sem invalidação nenhuma relê — reads=2 em vez de 1),
// provando que a guarda não é um no-op na direção oposta.

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
  assert.equal(spawnCount, 1, "sem auto-restart IMEDIATO — um watcher morto não deve virar um segundo processo sozinho, dentro do próprio handler de exit");
  assert.equal(await tracker.token(), "apps=dark", "token() continua respondendo (via leitura avulsa), mesmo com o watcher morto");
});

// Segunda revisão do Round-2 (finding 2, achado do advisor sobre a primeira
// versão desta correção): a versão inicial deixava `autoStartAttempted`
// travado em `true` pra sempre depois de QUALQUER morte do watcher — a
// MESMA forma estrutural do bug original que o Round-2 corrigiu (um
// gatilho de disparo único que nunca reabre), só que documentado como
// "KNOWN GAP" em vez de fechado. Este teste prova que uma `.token()`
// chamada DEPOIS da morte espontânea religa o watcher na PRÓXIMA vez —
// sem loop apertado (só quando alguém de qualquer jeito já ia chamar
// token()), sem reabrir enquanto o processo antigo ainda existisse.
test("createWindowsAppearanceTracker: token() chamado DEPOIS de um onExit espontâneo religa o watch na PRÓXIMA vez — o lazy-trigger não fica travado pra sempre (Round-2 finding 2, revisão)", async () => {
  let spawnCount = 0;
  let onExitCb;
  const tracker = createWindowsAppearanceTracker({
    read: async () => "apps=dark",
    startWatcher: (keyPath, { onExit }) => { spawnCount++; onExitCb = onExit; return { kill() {} }; },
  });

  await tracker.token(); // lazy-start dispara a primeira vez
  assert.equal(spawnCount, 1);

  onExitCb(1); // watcher morreu sozinho
  await tracker.token(); // sem isto religar, spawnCount ficaria travado em 1 pro resto da vida do tracker
  assert.equal(spawnCount, 2, "token() depois da morte do watcher deveria ter religado o watch — sem isso, o lazy-trigger de disparo único vira permanentemente inerte após a PRIMEIRA morte, mesmo padrão do bug que o Round-2 corrigiu");

  tracker.stop();
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

// Pin explícito pro ordering que a correção de re-arm (onWatcherExit ->
// autoStartAttempted = false) depende: stop() marca `stopped = true` e
// mata o processo, MAS o processo real só dispara seu próprio evento
// 'exit' um instante depois — de forma assíncrona, DEPOIS que stop() já
// retornou. Esse 'exit' tardio ainda chama onWatcherExit, que agora reseta
// autoStartAttempted — sem este teste, nada garantiria que `stopped`
// continua bloqueando um respawn nesse cenário (a ordem "stopped=true
// ANTES do kill()" é o que torna isso seguro, não documentado por
// nenhuma asserção antes deste teste).
test("createWindowsAppearanceTracker: onExit assíncrono do processo morto, CHEGANDO DEPOIS de stop(), não religa o watch — stopped continua bloqueando mesmo com autoStartAttempted resetado", async () => {
  let spawnCount = 0;
  let onExitCb;
  const tracker = createWindowsAppearanceTracker({
    read: async () => "apps=dark",
    startWatcher: (keyPath, { onExit }) => { spawnCount++; onExitCb = onExit; return { kill: () => {} }; },
  });
  tracker.start();
  assert.equal(spawnCount, 1);
  tracker.stop();
  // Simula o 'exit' real chegando DEPOIS de stop() já ter retornado (o
  // processo real leva um instante pra sair depois de kill()) — onExitCb
  // aqui é a MESMA função que startThemeWatcher chamaria.
  onExitCb(null);
  assert.equal(await tracker.token(), "apps=dark", "token() continua respondendo (leitura avulsa) mesmo depois de stop() + onExit tardio");
  assert.equal(spawnCount, 1, "stop() + onExit tardio não deveria religar o watch, mesmo com autoStartAttempted resetado por onWatcherExit — stopped continua bloqueando");
});

// --- PLAT-07 Round-2 (finding 1, hardening): token() é a única porta de
// entrada do lazy-start, então ele NUNCA pode propagar uma exceção do
// startWatcher — icon.js:312 faz `String(await appearanceToken())` sem
// try/catch próprio; sem esta garantia, um startWatcher que lança
// SINCRONAMENTE (mkdtempSync/writeFileSync reais podem lançar — ex.: %TEMP%
// sem permissão de escrita) viraria um 500 em getIconPng em vez de degradar
// pra "leitura avulsa, sem watch".

test("createWindowsAppearanceTracker: token() (lazy-start) nunca lança mesmo se startWatcher lançar SÍNCRONO — degrada pra leitura avulsa", async () => {
  const tracker = createWindowsAppearanceTracker({
    read: async () => "apps=dark",
    startWatcher: () => { throw new Error("mkdtempSync: EACCES, permission denied"); },
  });
  await assert.doesNotReject(async () => {
    assert.equal(await tracker.token(), "apps=dark");
  });
});

// --- PLAT-07 Round-2 (finding 2): startThemeWatcher precisa de um handler
// 'error', não só 'exit' — um spawn que falha (powershell.exe ausente/
// bloqueado por política, o cenário que o próprio JSDoc do onExit já cita)
// emite 'error', confirmado contra a referência oficial do Node.js via
// context7 (/nodejs/node, "Handling failed spawn errors with
// child_process.spawn"). `spawnFn` é fake (devolve um EventEmitter
// controlado por este teste) mas `startThemeWatcher` ainda roda
// mkdtempSync/writeFileSync DE VERDADE — só o processo em si é fake, então
// estes testes também prova que a limpeza do workDir roda no caminho de
// erro, cross-platform (nenhum código aqui é win32-only).

function fakeChildProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.kill = () => {};
  return child;
}

test("startThemeWatcher: evento 'error' do child (spawn falhou) aciona onExit com code=null — sem handler, isto seria uma exceção não tratada e derrubaria o processo (Round-2 finding 2)", () => {
  const child = fakeChildProcess();
  let onExitCalls = 0;
  let lastCode = "unset";
  const returned = startThemeWatcher("Software\\Unused", {
    onChange: () => {},
    onExit: (code) => { onExitCalls++; lastCode = code; },
    spawnFn: () => child,
  });
  assert.equal(returned, child);
  child.emit("error", Object.assign(new Error("spawn powershell.exe ENOENT"), { code: "ENOENT" }));
  assert.equal(onExitCalls, 1, "onExit deveria ter sido chamado exatamente uma vez a partir do evento 'error'");
  assert.equal(lastCode, null, "sem processo real de fato rodando, não há exit code — null, a mesma forma que o JSDoc do onExit já documenta (code: number|null)");
});

test("startThemeWatcher: 'error' seguido de 'exit' (Node não garante exclusividade entre os dois) só aciona onExit UMA vez — settle guard", () => {
  const child = fakeChildProcess();
  let onExitCalls = 0;
  startThemeWatcher("Software\\Unused", {
    onChange: () => {},
    onExit: () => { onExitCalls++; },
    spawnFn: () => child,
  });
  child.emit("error", new Error("boom"));
  child.emit("exit", 1);
  assert.equal(onExitCalls, 1, "'error' e 'exit' disparando os dois não deve chamar onExit duas vezes nem tentar limpar o workDir duas vezes");
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
