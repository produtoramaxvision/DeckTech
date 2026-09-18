// PLAT-05 — tests for platform/windows/actions.js, the Windows
// listAppProcesses + activateApp providers behind the Fase 2 contract
// (platform/index.js#win32Platform).
//
// Same split test/windows-list-installed-apps.test.mjs and
// test/windows-icon-service.test.mjs already use: composition-level tests
// inject `collect`/`resolveApps`/`focusPid`/`launch`/`exec` so the whole
// pipeline runs on any OS (CI included), and a `win32Only`-gated block at
// the bottom exercises the REAL PowerShell scripts (process listing,
// SetForegroundWindow+GetForegroundWindow observation, a real launch with
// a space in the path) end to end, on this machine.

import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { spawn, execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFileCb);

import {
  matchRunningProcesses,
  makeListAppProcesses,
  makeActivateApp,
  launchAppEntry,
  runPowerShellListProcesses,
  focusWindowByPid,
  RUNNING_TTL_MS,
} from "../platform/windows/actions.js";
import { ActionError } from "../actions.js";
import { WindowsAppScanError } from "../platform/windows/apps.js";

const win32Only = process.platform === "win32" ? {} : { skip: "requer Windows real (PowerShell + SetForegroundWindow)" };

const silentLog = { error() {}, warn() {}, info() {}, debug() {} };

// ---------------------------------------------------------------------
// matchRunningProcesses — identidade por caminho do executável
// ---------------------------------------------------------------------

test("PLAT-05: matchRunningProcesses casa processo -> nome do catálogo pelo Path (win32), não por ProcessName/título", () => {
  const processes = [
    { Id: 111, ProcessName: "chrome", MainWindowTitle: "alguma aba", Path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
    { Id: 222, ProcessName: "notepad", MainWindowTitle: "sem titulo", Path: "C:\\Windows\\system32\\notepad.exe" },
  ];
  const catalog = [
    { name: "Google Chrome", path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", kind: "win32", target: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
  ];
  const result = matchRunningProcesses(processes, catalog);
  assert.deepEqual(result, [{ name: "Google Chrome", pid: 111, type: "Foreground" }]);
});

test("PLAT-05: matchRunningProcesses ignora entradas UWP do catálogo (identidade é AUMID, não path) — gap documentado", () => {
  const processes = [
    { Id: 5416, ProcessName: "Notepad", MainWindowTitle: "Sem titulo", Path: "C:\\Program Files\\WindowsApps\\Microsoft.WindowsNotepad_1.0_x64__8wekyb3d8bbwe\\Notepad\\Notepad.exe" },
  ];
  const catalog = [
    { name: "Bloco de notas", path: "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App", kind: "uwp", aumid: "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App" },
  ];
  assert.deepEqual(matchRunningProcesses(processes, catalog), []);
});

test("PLAT-05: matchRunningProcesses é case-insensitive no path e ignora processo sem catálogo correspondente", () => {
  const processes = [
    { Id: 1, ProcessName: "app", MainWindowTitle: "x", Path: "C:\\APPS\\Foo\\FOO.EXE" },
    { Id: 2, ProcessName: "ghost", MainWindowTitle: "y", Path: "C:\\Somewhere\\ghost.exe" },
  ];
  const catalog = [{ name: "Foo", path: "C:\\Apps\\Foo\\foo.exe", kind: "win32" }];
  assert.deepEqual(matchRunningProcesses(processes, catalog), [{ name: "Foo", pid: 1, type: "Foreground" }]);
});

test("PLAT-05: matchRunningProcesses ignora processo sem Path e sem pid inteiro positivo", () => {
  const processes = [
    { Id: 1, ProcessName: "app", MainWindowTitle: "x" }, // sem Path
    { Id: 0, ProcessName: "app2", MainWindowTitle: "z", Path: "C:\\Apps\\Foo\\foo.exe" }, // pid inválido
  ];
  const catalog = [{ name: "Foo", path: "C:\\Apps\\Foo\\foo.exe", kind: "win32" }];
  assert.deepEqual(matchRunningProcesses(processes, catalog), []);
});

test("PLAT-05: matchRunningProcesses deduplica por pid (nunca repete o mesmo processo)", () => {
  const processes = [
    { Id: 1, ProcessName: "app", MainWindowTitle: "x", Path: "C:\\Apps\\Foo\\foo.exe" },
    { Id: 1, ProcessName: "app", MainWindowTitle: "x", Path: "C:\\Apps\\Foo\\foo.exe" },
  ];
  const catalog = [{ name: "Foo", path: "C:\\Apps\\Foo\\foo.exe", kind: "win32" }];
  assert.deepEqual(matchRunningProcesses(processes, catalog), [{ name: "Foo", pid: 1, type: "Foreground" }]);
});

// Não-negociável #4: path.join sobre separador hardcoded, path com espaço
// atravessa a identidade de ponta a ponta.
test("PLAT-05: matchRunningProcesses casa um path com espaço (Program Files) intacto", () => {
  const spaced = join("C:\\Program Files", "Some App", "some app.exe");
  assert.match(spaced, / /, "fixture precisa ter um espaço de verdade");
  const processes = [{ Id: 7, ProcessName: "some app", MainWindowTitle: "t", Path: spaced }];
  const catalog = [{ name: "Some App", path: spaced, kind: "win32" }];
  assert.deepEqual(matchRunningProcesses(processes, catalog), [{ name: "Some App", pid: 7, type: "Foreground" }]);
});

// ---------------------------------------------------------------------
// makeListAppProcesses — cache TTL + nunca lança
// ---------------------------------------------------------------------

test("PLAT-05: makeListAppProcesses cacheia por TTL (RUNNING_TTL_MS) e reusa enquanto fresco", async () => {
  let collectCalls = 0;
  let t = 0;
  const listAppProcesses = makeListAppProcesses({
    collect: async () => { collectCalls++; return [{ Id: 1, Path: "C:\\Apps\\A\\a.exe" }]; },
    resolveApps: async () => [{ name: "A", path: "C:\\Apps\\A\\a.exe", kind: "win32" }],
    now: () => t,
    log: silentLog,
  });
  await listAppProcesses();
  t += RUNNING_TTL_MS - 1;
  await listAppProcesses();
  assert.equal(collectCalls, 1, "dentro do TTL não deveria coletar de novo");
  t += 2;
  await listAppProcesses();
  assert.equal(collectCalls, 2, "fora do TTL deveria coletar de novo");
});

test("PLAT-05: makeListAppProcesses nunca lança — falha de collect vira [] com log.warn (mesmo contrato do macOS)", async () => {
  let warned = null;
  const listAppProcesses = makeListAppProcesses({
    collect: async () => { throw new Error("powershell explodiu"); },
    resolveApps: async () => [],
    log: { ...silentLog, warn: (event, fields) => { warned = { event, fields }; } },
  });
  const result = await listAppProcesses();
  assert.deepEqual(result, []);
  assert.equal(warned.event, "windows.actions.list_processes_failed");
});

test("PLAT-05: makeListAppProcesses.clearCache força nova coleta mesmo dentro do TTL", async () => {
  let collectCalls = 0;
  const listAppProcesses = makeListAppProcesses({
    collect: async () => { collectCalls++; return []; },
    resolveApps: async () => [],
    now: () => 0,
    log: silentLog,
  });
  await listAppProcesses();
  listAppProcesses.clearCache();
  await listAppProcesses();
  assert.equal(collectCalls, 2);
});

// ---------------------------------------------------------------------
// makeActivateApp — vocabulário tipado (PLAT-06) e fallback do PRD §15
// ---------------------------------------------------------------------

const CATALOG = [
  { name: "Notepad++", path: "C:\\Apps\\Notepad++\\notepad++.exe", kind: "win32" },
  { name: "Calculadora", aumid: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", kind: "uwp" },
];

test("PLAT-05/PLAT-06: activateApp lança APP_NOT_FOUND (não genérico) quando o nome não está no catálogo", async () => {
  const activateApp = makeActivateApp({ resolveApps: async () => CATALOG, log: silentLog });
  await assert.rejects(activateApp({ name: "Fantasma" }), (err) => {
    assert.ok(err instanceof ActionError);
    assert.equal(err.code, "APP_NOT_FOUND");
    return true;
  });
});

test("PLAT-05/PLAT-06: activateApp dobra falha de infra do catálogo (WindowsAppScanError) em LAUNCH_FAILED — nunca vaza um code fora do vocabulário PLAT-06", async () => {
  const activateApp = makeActivateApp({
    resolveApps: async () => { throw new WindowsAppScanError("POWERSHELL_FAILED", "boom"); },
    log: silentLog,
  });
  await assert.rejects(activateApp({ name: "Notepad++" }), (err) => {
    assert.ok(err instanceof ActionError);
    assert.equal(err.code, "LAUNCH_FAILED");
    assert.notEqual(err.code, "POWERSHELL_FAILED");
    return true;
  });
});

test("PLAT-05: activateApp sem pid apenas lança o catálogo (não tenta focar)", async () => {
  let focusCalled = false;
  const launched = [];
  const activateApp = makeActivateApp({
    resolveApps: async () => CATALOG,
    focusPid: async () => { focusCalled = true; return { becameForeground: true }; },
    launch: async (entry) => { launched.push(entry.name); },
    log: silentLog,
  });
  await activateApp({ name: "Notepad++" });
  assert.equal(focusCalled, false);
  assert.deepEqual(launched, ["Notepad++"]);
});

test("PLAT-05: activateApp com pid e foco bem-sucedido (becameForeground) resolve sem lançar nem abrir nova instância", async () => {
  let launchCalled = false;
  const activateApp = makeActivateApp({
    resolveApps: async () => CATALOG,
    focusPid: async (pid) => { assert.equal(pid, 4242); return { becameForeground: true, setForegroundReturn: true }; },
    launch: async () => { launchCalled = true; },
    log: silentLog,
  });
  await activateApp({ name: "Notepad++", pid: 4242 });
  assert.equal(launchCalled, false);
});

// Prova central da tarefa (item 2 da revisão): a classificação de sucesso é
// a OBSERVAÇÃO `becameForeground`, não o retorno bruto de SetForegroundWindow
// — um retorno TRUE que não moveu o foreground de verdade continua contando
// como restrito.
test("PLAT-05: setForegroundReturn=true SEM becameForeground ainda conta como restrito (retorno bruto da API não é prova)", async () => {
  const launched = [];
  const activateApp = makeActivateApp({
    resolveApps: async () => CATALOG,
    focusPid: async () => ({ becameForeground: false, setForegroundReturn: true, hadWindow: true }),
    launch: async (entry) => { launched.push(entry.name); },
    log: silentLog,
  });
  await assert.rejects(activateApp({ name: "Notepad++", pid: 99 }), (err) => {
    assert.equal(err.code, "FOCUS_RESTRICTED");
    return true;
  });
  assert.deepEqual(launched, ["Notepad++"], "fallback do PRD §15 precisa ter rodado mesmo com retorno bruto true");
});

test("PLAT-05: activateApp com pid e foco restrito (becameForeground=false) abre nova instância e lança FOCUS_RESTRICTED DEPOIS do fallback funcionar", async () => {
  const order = [];
  const activateApp = makeActivateApp({
    resolveApps: async () => CATALOG,
    focusPid: async () => { order.push("focus"); return { becameForeground: false, hadWindow: true }; },
    launch: async (entry) => { order.push(`launch:${entry.name}`); },
    log: silentLog,
  });
  await assert.rejects(activateApp({ name: "Notepad++", pid: 99 }), (err) => {
    assert.equal(err.code, "FOCUS_RESTRICTED");
    assert.match(err.message, /Notepad\+\+/);
    return true;
  });
  assert.deepEqual(order, ["focus", "launch:Notepad++"], "fallback tem que rodar DEPOIS da tentativa de foco, nunca antes");
});

test("PLAT-05: activateApp trata falha do PRÓPRIO focusPid (PowerShell explodiu) igual a 'não focou' — cai no mesmo fallback", async () => {
  const launched = [];
  const activateApp = makeActivateApp({
    resolveApps: async () => CATALOG,
    focusPid: async () => { throw new Error("powershell crashed"); },
    launch: async (entry) => { launched.push(entry.name); },
    log: silentLog,
  });
  await assert.rejects(activateApp({ name: "Notepad++", pid: 99 }), (err) => {
    assert.equal(err.code, "FOCUS_RESTRICTED");
    return true;
  });
  assert.deepEqual(launched, ["Notepad++"]);
});

test("PLAT-05/PLAT-06: quando o fallback de lançamento TAMBÉM falha, o erro do launch propaga (mais informativo que FOCUS_RESTRICTED), igual ao comentário de actions.js#focusApp", async () => {
  const activateApp = makeActivateApp({
    resolveApps: async () => CATALOG,
    focusPid: async () => ({ becameForeground: false }),
    launch: async () => { throw new ActionError("LAUNCH_FAILED", "boom"); },
    log: silentLog,
  });
  await assert.rejects(activateApp({ name: "Notepad++", pid: 99 }), (err) => {
    assert.equal(err.code, "LAUNCH_FAILED");
    assert.notEqual(err.code, "FOCUS_RESTRICTED");
    return true;
  });
});

test("PLAT-05: activateApp com kind uwp lança via explorer.exe shell:AppsFolder\\<AUMID>, nunca tenta focar sem pid", async () => {
  const calls = [];
  const activateApp = makeActivateApp({
    resolveApps: async () => CATALOG,
    launch: async (entry, tools) => launchAppEntry(entry, {
      exec: async (cmd, args, opts) => { calls.push({ cmd, args, opts }); },
    }),
    log: silentLog,
  });
  await activateApp({ name: "Calculadora" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "explorer.exe");
  assert.deepEqual(calls[0].args, ["shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"]);
});

// ---------------------------------------------------------------------
// launchAppEntry — classificação de falha + execFile via argv (não shell)
// ---------------------------------------------------------------------

test("PLAT-05: launchAppEntry (win32) chama execFile com o .exe como argv[0] e cwd = dirname do .exe — nunca via shell", async () => {
  const calls = [];
  await launchAppEntry(
    { name: "Notepad++", kind: "win32", path: "C:\\Apps\\Notepad++\\notepad++.exe" },
    { exec: async (cmd, args, opts) => { calls.push({ cmd, args, opts }); } },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "C:\\Apps\\Notepad++\\notepad++.exe");
  assert.deepEqual(calls[0].args, []);
  assert.equal(calls[0].opts.cwd, "C:\\Apps\\Notepad++");
});

// Não-negociável #4: path.join / path com espaço atravessa launchAppEntry intacto.
test("PLAT-05: launchAppEntry preserva um path com espaço (Program Files) intacto no argv, sem quoting manual", async () => {
  const spacedPath = join("C:\\Program Files", "Some App", "some app.exe");
  assert.match(spacedPath, / /, "fixture precisa ter um espaço de verdade");
  const calls = [];
  await launchAppEntry(
    { name: "Some App", kind: "win32", path: spacedPath },
    { exec: async (cmd, args, opts) => { calls.push({ cmd, args, opts }); } },
  );
  assert.equal(calls[0].cmd, spacedPath);
  assert.deepEqual(calls[0].args, [], "sem shell, sem quoting manual: o path inteiro é UM ÚNICO argv[0]");
});

test("PLAT-05/PLAT-06: launchAppEntry classifica ENOENT como APP_NOT_FOUND", async () => {
  const err = new Error("spawn ENOENT");
  err.code = "ENOENT";
  await assert.rejects(
    launchAppEntry({ name: "Sumiu", kind: "win32", path: "C:\\Apps\\Sumiu\\sumiu.exe" }, { exec: async () => { throw err; } }),
    (e) => { assert.equal(e.code, "APP_NOT_FOUND"); return true; },
  );
});

test("PLAT-05/PLAT-06: launchAppEntry classifica qualquer outra falha como LAUNCH_FAILED, nunca vaza o path interno na mensagem", async () => {
  const err = new Error("acesso negado a C:\\Apps\\Secreto\\segredo.exe");
  err.code = "EPERM";
  await assert.rejects(
    launchAppEntry({ name: "Secreto", kind: "win32", path: "C:\\Apps\\Secreto\\segredo.exe" }, { exec: async () => { throw err; } }),
    (e) => {
      assert.equal(e.code, "LAUNCH_FAILED");
      assert.doesNotMatch(e.message, /Secreto\\segredo\.exe/, "path interno não deveria vazar na mensagem tipada");
      return true;
    },
  );
});

// ---------------------------------------------------------------------
// Bloco real-machine (win32Only) — PowerShell de verdade nesta máquina
// ---------------------------------------------------------------------

test("PLAT-05 (real): runPowerShellListProcesses devolve processos com Path preenchido", win32Only, async () => {
  const procs = await runPowerShellListProcesses();
  assert.ok(Array.isArray(procs));
  assert.ok(procs.length > 0, "esta máquina tem pelo menos um app com janela visível");
  for (const p of procs) {
    assert.equal(typeof p.Id, "number");
  }
  assert.ok(procs.some((p) => typeof p.Path === "string" && p.Path.length > 0), "pelo menos um processo com Path resolvido");
});

test("PLAT-05 (real): runPowerShellListProcesses fora de win32 lança (guard explícito)", { skip: process.platform === "win32" ? "guard só se aplica fora de win32" : undefined }, async () => {
  await assert.rejects(runPowerShellListProcesses());
});

/** charmap.exe: utilitário built-in do Windows, sem redirecionamento MSIX
 * (ao contrário do Notepad/Calculadora modernos — medido nesta máquina:
 * seu pid É o pid da janela real, sem processo-launcher intermediário),
 * abre em <1s e fecha limpo com Stop-Process — candidato seguro pra
 * lançar/focar/matar repetidamente num teste automatizado. */
const CHARMAP = "C:\\Windows\\System32\\charmap.exe";

async function launchGuiProcess(exePath) {
  const child = spawn(exePath, [], { detached: true, stdio: "ignore" });
  child.unref();
  return child.pid;
}

async function waitForMainWindowHandle(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { stdout } = await execFileP("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowHandle.ToInt64()`,
    ]);
    const handle = Number(stdout.trim());
    if (Number.isInteger(handle) && handle !== 0) return handle;
    if (Date.now() > deadline) throw new Error(`timeout esperando MainWindowHandle do pid ${pid}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function killPid(pid) {
  try { await execFileP("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`]); }
  catch { /* já morto, tudo bem */ }
}

// Item 2/3 da revisão: prova de que SetForegroundWindow é observado (não só
// o retorno BOOL) contra um processo REAL, não injetado — e que o resultado
// é logado por inteiro (não resumido), pra discrimination_proof/
// measured_results poderem colar a saída verdadeira desta máquina. A
// asserção fica em cima da CONSISTÊNCIA da observação (becameForeground só
// é true quando o handle final bate com o handle alvo, e o measured JSON
// completo é devolvido pro chamador do teste conferir) — nunca assume
// vitória/derrota fixa, porque o resultado real depende de estado do SO
// (ForegroundLockTimeout, o que tem foco no momento) que este teste não
// deveria e não pode controlar sem mexer em configuração do usuário.
test("PLAT-05 (real): focusWindowByPid observa GetForegroundWindow contra um processo real (charmap.exe), não simula o resultado", win32Only, async (t) => {
  let targetPid = null;
  let distractorPid = null;
  try {
    targetPid = await launchGuiProcess(CHARMAP);
    const targetHandle = await waitForMainWindowHandle(targetPid);
    // empurra o foco pra outro lugar antes de tentar trazer o alvo de volta
    // — sem isso, o alvo já É o foreground (recém-lançado) e o teste não
    // exercitaria transição nenhuma.
    distractorPid = await launchGuiProcess(CHARMAP);
    await waitForMainWindowHandle(distractorPid);
    await new Promise((r) => setTimeout(r, 300));

    const t0 = Date.now();
    const observation = await focusWindowByPid(targetPid);
    const elapsedMs = Date.now() - t0;

    // Estrutura sempre verdadeira, processo real com janela real:
    assert.equal(observation.hadProcess, true);
    assert.equal(observation.hadWindow, true);
    assert.equal(observation.handle, targetHandle);
    assert.equal(typeof observation.setForegroundReturn, "boolean");
    assert.equal(typeof observation.becameForeground, "boolean");
    // Consistência interna: becameForeground só pode ser true quando o
    // handle final observado é EXATAMENTE o handle do alvo — a mesma
    // verificação que faz a classificação em makeActivateApp discriminar
    // de um retorno bruto TRUE que não moveu o foreground de verdade.
    assert.equal(observation.becameForeground, observation.foregroundHandleAfter === targetHandle);

    t.diagnostic(`focusWindowByPid round-trip: ${elapsedMs}ms (inclui spawn do powershell.exe + Add-Type compile + 150ms sleep do script)`);
    t.diagnostic(`observação medida (real, não simulada): ${JSON.stringify(observation)}`);
  } finally {
    if (distractorPid) await killPid(distractorPid);
    if (targetPid) await killPid(targetPid);
  }
});

// Não-negociável #4 + prova end-to-end: lança um app REAL do catálogo cujo
// path tem espaço ("Program Files"), via o MESMO launchAppEntry que
// activateApp usa em produção — não uma cópia do mecanismo.
//
// Seleção de candidato deliberadamente cautelosa: esta máquina é a estação
// de trabalho real do usuário, não uma VM descartável. "OBS Studio" fica de
// fora mesmo tendo espaço no path (C:\Program Files\obs-studio\...) porque
// já está aberto nesta sessão (medido: pid 42196 na listagem de processos
// no início da tarefa) — abrir uma segunda instância de um app de captura/
// streaming em uso é o tipo de efeito colateral que este teste não deveria
// causar. A lista de preferência abaixo busca um utilitário leve, que abre
// sem diálogo de licença/splash pesado e fecha limpo — "MPC-HC x64" (media
// player, path com espaço em "Program Files") é o primeiro candidato nesta
// máquina.
const SAFE_SPACED_CANDIDATES = ["MPC-HC x64", "WinRAR", "MobaXterm", "HandBrake"];

test("PLAT-05 (real): launchAppEntry abre um app real cujo path contém espaço (Program Files), depois mata o processo", win32Only, async (t) => {
  const { listInstalledApps: realListInstalledApps } = await import("../platform/windows/apps.js");
  const apps = await realListInstalledApps();
  let candidate = null;
  for (const wanted of SAFE_SPACED_CANDIDATES) {
    const found = apps.find((a) => a.kind === "win32" && a.name === wanted && /\s/.test(a.path));
    if (found) { candidate = found; break; }
  }
  if (!candidate) {
    t.skip(`nenhum dos candidatos seguros (${SAFE_SPACED_CANDIDATES.join(", ")}) está no catálogo desta máquina`);
    return;
  }
  assert.match(candidate.path, / /, "fixture precisa ter um espaço de verdade");
  t.diagnostic(`candidato real: ${candidate.name} -> ${candidate.path}`);

  const before = await execFileP("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `(Get-Process -Name '${candidate.path.split("\\").pop().replace(/\.exe$/i, "")}' -ErrorAction SilentlyContinue | Measure-Object).Count`,
  ]);
  const beforeCount = Number(before.stdout.trim());
  if (beforeCount > 0) {
    // já rodando por outro motivo (sessão do usuário) — não arrisca lançar
    // uma segunda instância nem apagar o que já estava aberto na limpeza.
    t.skip(`"${candidate.name}" já está rodando nesta máquina (${beforeCount} processo(s)) — pulando pra não interferir na sessão do usuário`);
    return;
  }

  await launchAppEntry(candidate, {});

  const procName = candidate.path.split("\\").pop().replace(/\.exe$/i, "");
  const deadline = Date.now() + 8000;
  let afterCount = beforeCount;
  while (Date.now() < deadline) {
    const after = await execFileP("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `(Get-Process -Name '${procName}' -ErrorAction SilentlyContinue | Measure-Object).Count`,
    ]);
    afterCount = Number(after.stdout.trim());
    if (afterCount > beforeCount) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  t.diagnostic(`processos '${procName}' antes=${beforeCount} depois=${afterCount}`);
  assert.ok(afterCount > beforeCount, `launchAppEntry deveria ter aberto uma nova instância de "${candidate.name}" (path com espaço)`);

  // limpeza: mata só o que este teste abriu não é possível distinguir por
  // pid (execFile não devolve o pid do processo GUI real quando o alvo é
  // um app que se relança/relay — ver comentário de PLAT-05 sobre
  // Notepad/Calculadora); se o app não existia antes, mata todos os
  // processos com esse nome, que este teste acabou de criar.
  if (beforeCount === 0) {
    await execFileP("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Get-Process -Name '${procName}' -ErrorAction SilentlyContinue | Stop-Process -Force`]);
  }
});
