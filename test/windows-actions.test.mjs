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
import { tmpdir } from "node:os";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
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
  PS_FOCUS_SCRIPT,
  RUNNING_TTL_MS,
  createWindowTracker,
  makeFocusWindow,
  makeMinimizeWindow,
  makeCloseWindow,
  makeOpenNewWindow,
  focusWindow,
  minimizeWindow,
  closeWindow,
  openNewWindow,
  PS_FOCUS_WINDOW_SCRIPT,
  PS_MINIMIZE_WINDOW_SCRIPT,
  PS_CLOSE_WINDOW_SCRIPT,
} from "../platform/windows/actions.js";
import { ActionError } from "../actions.js";
import { WindowsAppScanError } from "../platform/windows/apps.js";

const win32Only = process.platform === "win32" ? {} : { skip: "requer Windows real (PowerShell + SetForegroundWindow)" };

const silentLog = { error() {}, warn() {}, info() {}, debug() {} };

// ---------------------------------------------------------------------
// matchRunningProcesses — identidade por caminho do executável (PLAT-05 / PLAT-11)
// ---------------------------------------------------------------------

test("PLAT-05/PLAT-11: matchRunningProcesses casa processo -> nome do catálogo pelo Path (win32), não por ProcessName/título", () => {
  const processes = [
    { Id: 111, hwnd: 1111, ProcessName: "chrome", MainWindowTitle: "alguma aba", Path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
    { Id: 222, hwnd: 2222, ProcessName: "notepad", MainWindowTitle: "sem titulo", Path: "C:\\Windows\\system32\\notepad.exe" },
  ];
  const catalog = [
    { name: "Google Chrome", path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", kind: "win32", target: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
  ];
  const result = matchRunningProcesses(processes, catalog);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Google Chrome");
  assert.equal(result[0].pid, 111);
  assert.equal(result[0].hwnd, 1111);
  assert.equal(result[0].title, "alguma aba");
  assert.equal(typeof result[0].id, "string");
  assert.equal(result[0].state, "background");
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

test("PLAT-05/PLAT-11: matchRunningProcesses é case-insensitive no path e ignora processo sem catálogo correspondente", () => {
  const processes = [
    { Id: 1, ProcessName: "app", MainWindowTitle: "x", Path: "C:\\APPS\\Foo\\FOO.EXE" },
    { Id: 2, ProcessName: "ghost", MainWindowTitle: "y", Path: "C:\\Somewhere\\ghost.exe" },
  ];
  const catalog = [{ name: "Foo", path: "C:\\Apps\\Foo\\foo.exe", kind: "win32" }];
  const result = matchRunningProcesses(processes, catalog);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Foo");
  assert.equal(result[0].pid, 1);
});

test("PLAT-05: matchRunningProcesses ignora processo sem Path e sem pid inteiro positivo", () => {
  const processes = [
    { Id: 1, ProcessName: "app", MainWindowTitle: "x" }, // sem Path
    { Id: 0, ProcessName: "app2", MainWindowTitle: "z", Path: "C:\\Apps\\Foo\\foo.exe" }, // pid inválido
  ];
  const catalog = [{ name: "Foo", path: "C:\\Apps\\Foo\\foo.exe", kind: "win32" }];
  assert.deepEqual(matchRunningProcesses(processes, catalog), []);
});

test("PLAT-11: matchRunningProcesses NÃO deduplica por PID — duas janelas do mesmo processo aparecem como entradas distintas", () => {
  const processes = [
    { Id: 10, hwnd: 1001, ProcessName: "firefox", title: "Firefox - Monitor 1", mon: 65537, isFg: true, min: false, Path: "C:\\Apps\\Firefox\\firefox.exe" },
    { Id: 10, hwnd: 1002, ProcessName: "firefox", title: "Firefox - Monitor 2", mon: 65539, isFg: false, min: false, Path: "C:\\Apps\\Firefox\\firefox.exe" },
  ];
  const catalog = [{ name: "Mozilla Firefox", path: "C:\\Apps\\Firefox\\firefox.exe", kind: "win32" }];
  const result = matchRunningProcesses(processes, catalog);
  assert.equal(result.length, 2, "duas janelas do mesmo processo devem gerar dois cartões de janela");
  assert.equal(result[0].name, "Mozilla Firefox");
  assert.equal(result[1].name, "Mozilla Firefox");
  assert.equal(result[0].title, "Firefox - Monitor 1");
  assert.equal(result[1].title, "Firefox - Monitor 2");
  assert.equal(result[0].monitor, 65537);
  assert.equal(result[1].monitor, 65539);
  assert.equal(result[0].state, "focused");
  assert.equal(result[1].state, "background");
  assert.equal(result[0].id !== result[1].id, true, "cada janela tem seu próprio identificador estável");
});

// Não-negociável #4: path.join sobre separador hardcoded, path com espaço
// atravessa a identidade de ponta a ponta.
test("PLAT-05/PLAT-11: matchRunningProcesses casa um path com espaço (Program Files) intacto", () => {
  const spaced = join("C:\\Program Files", "Some App", "some app.exe");
  assert.match(spaced, / /, "fixture precisa ter um espaço de verdade");
  const processes = [{ Id: 7, ProcessName: "some app", MainWindowTitle: "t", Path: spaced }];
  const catalog = [{ name: "Some App", path: spaced, kind: "win32" }];
  const result = matchRunningProcesses(processes, catalog);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Some App");
  assert.equal(result[0].pid, 7);
  assert.equal(result[0].title, "t");
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
// PLAT-05 regression: sequência AttachThreadInput + ShowWindow(SW_RESTORE)
// ---------------------------------------------------------------------

/** Remove comentários de bloco (<# ... #>) e comentários de linha (# ...) de scripts PowerShell. */
function stripPowerShellComments(script) {
  return script.replace(/<#[\s\S]*?#>/g, "").replace(/(^|[^$])#.*$/gm, "$1");
}

test("PLAT-05 regression: focusWindowByPid exige e executa a sequência AttachThreadInput e ShowWindow(SW_RESTORE)", async () => {
  let capturedScript = null;
  const fakeExec = async (cmd, args) => {
    const fileIdx = args.indexOf("-File");
    assert.ok(fileIdx !== -1, "powershell deve ser chamado com -File");
    const scriptPath = args[fileIdx + 1];
    capturedScript = readFileSync(scriptPath, "utf8");

    const outIdx = args.indexOf("-OutFile");
    assert.ok(outIdx !== -1, "powershell deve ser chamado com -OutFile");
    const outPath = args[outIdx + 1];
    writeFileSync(
      outPath,
      JSON.stringify({
        hadProcess: true,
        hadWindow: true,
        becameForeground: true,
        handle: 1234,
        foregroundHandleBefore: 5678,
        attachedFg: true,
        attachedTgt: true,
        setForegroundReturn: true,
        foregroundHandleAfter: 1234,
      }),
      "utf8",
    );
  };

  const observation = await focusWindowByPid(1234, { exec: fakeExec });
  assert.equal(observation.becameForeground, true);
  assert.equal(observation.attachedFg, true);
  assert.equal(observation.attachedTgt, true);
  assert.ok(capturedScript, "script deve ter sido gerado e executado");

  // Garante que o script NÃO contém chamadas de AttachThreadInput escondidas em comentários (<# ... #>)
  const cleanScript = stripPowerShellComments(capturedScript);

  // 1. Declaração do AttachThreadInput em código executável
  assert.match(
    cleanScript,
    /\[DllImport\("user32\.dll"\)\]\s+public\s+static\s+extern\s+bool\s+AttachThreadInput\(/,
    "script deve declarar a API Win32 AttachThreadInput em código limpo (não em comentário)",
  );

  // 2. Anexo da thread do foreground e da thread do alvo (não contornado por $false e não comentado)
  assert.match(
    cleanScript,
    /if\s*\(\$fgThread\s*-ne\s*0\s*-and\s*\$fgThread\s*-ne\s*\$curThread\)\s*\{\s*\$attachedFg\s*=\s*\$native::AttachThreadInput\(\$curThread,\s*\$fgThread,\s*\$true\)/,
    "script deve anexar a thread da janela em foreground via AttachThreadInput sem bypass ($false) e fora de comentários",
  );
  assert.match(
    cleanScript,
    /if\s*\(\$tgtThread\s*-ne\s*0\s*-and\s*\$tgtThread\s*-ne\s*\$curThread\)\s*\{\s*\$attachedTgt\s*=\s*\$native::AttachThreadInput\(\$curThread,\s*\$tgtThread,\s*\$true\)/,
    "script deve anexar a thread da janela alvo via AttachThreadInput sem bypass ($false) e fora de comentários",
  );

  // 3. Restauração de janela minimizada/icônica com SW_RESTORE = 9 (nunca 6 / SW_MINIMIZE)
  assert.match(
    cleanScript,
    /\$SW_RESTORE\s*=\s*9(?!\d)/,
    "SW_RESTORE deve ser 9 (SW_RESTORE), nunca 6 (SW_MINIMIZE)",
  );
  assert.match(
    cleanScript,
    /if\s*\(\$native::IsIconic\(\$handle\)\)\s*\{\s*\$native::ShowWindow\(\$handle,\s*\$SW_RESTORE\)/,
    "script deve verificar IsIconic na janela alvo (sem -not) e restaurar com ShowWindow($handle, $SW_RESTORE)",
  );

  // 4. Chamada de SetForegroundWindow entre o attach e o detach em código limpo
  const attachIdx = cleanScript.indexOf("$native::AttachThreadInput($curThread, $fgThread, $true)");
  const setFgIdx = cleanScript.indexOf("$native::SetForegroundWindow($handle)");
  const detachFgIdx = cleanScript.indexOf("$native::AttachThreadInput($curThread, $fgThread, $false)");
  assert.ok(attachIdx !== -1, "chamada de AttachThreadInput($true) deve estar presente em código limpo");
  assert.ok(setFgIdx !== -1, "chamada de SetForegroundWindow deve estar presente em código limpo");
  assert.ok(detachFgIdx !== -1, "chamada de AttachThreadInput($false) deve estar presente em código limpo");
  assert.ok(
    attachIdx < setFgIdx && setFgIdx < detachFgIdx,
    "SetForegroundWindow deve ser chamado entre AttachThreadInput($true) e AttachThreadInput($false)",
  );

  // 5. Validação com o Language.Parser oficial do PowerShell no Windows (rejeita MUT-C com comentário)
  if (process.platform === "win32") {
    const { tmpdir } = await import("node:os");
    const { mkdtempSync, writeFileSync: writeFileSyncFs, rmSync } = await import("node:fs");
    const tempDir = mkdtempSync(join(tmpdir(), "decktech-ast-check-"));
    const scriptFile = join(tempDir, "script.ps1");
    writeFileSyncFs(scriptFile, capturedScript, "utf8");
    try {
      const { stdout } = await execFileP("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        `
        $tokens = $null; $errors = $null
        $content = [System.IO.File]::ReadAllText('${scriptFile.replaceAll("\\", "\\\\")}')
        $ast = [System.Management.Automation.Language.Parser]::ParseInput($content, [ref]$tokens, [ref]$errors)
        $codeAttach = ($tokens | Where-Object { $_.Kind -ne "Comment" -and $_.Text -like "*AttachThreadInput*" }).Count
        $commentAttach = ($tokens | Where-Object { $_.Kind -eq "Comment" -and $_.Text -like "*AttachThreadInput*" }).Count
        [PSCustomObject]@{
          parseErrors = $errors.Count
          codeAttach = $codeAttach
          commentAttach = $commentAttach
        } | ConvertTo-Json -Compress
        `
      ]);
      const parserRes = JSON.parse(stdout.trim());
      assert.equal(parserRes.parseErrors, 0, "script não deve conter erros de sintaxe");
      assert.equal(parserRes.commentAttach, 0, "nenhuma ocorrência de AttachThreadInput pode estar em comentário (<# ... #>)");
      assert.ok(parserRes.codeAttach >= 5, "todas as 5 ocorrências de AttachThreadInput (1 declaração + 2 attach + 2 detach) devem ser tokens de código executável");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
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
    // Empurra o foco para outra janela (distrator) ativando-a de verdade no foreground
    // antes de tentar trazer o alvo de volta — sem isso, o terminal pai ainda seria o foreground
    // e o Windows concederia direito de ativação sem exercitar o AttachThreadInput.
    distractorPid = await launchGuiProcess(CHARMAP);
    await waitForMainWindowHandle(distractorPid);
    const distractorObs = await focusWindowByPid(distractorPid);
    assert.equal(distractorObs.becameForeground, true, "distrator deve ir para o foreground primeiro");
    assert.equal(distractorObs.attachedFg, true, "foco no distrator deve anexar à thread de foreground");
    assert.equal(distractorObs.attachedTgt, true, "foco no distrator deve anexar à thread do alvo");

    const t0 = Date.now();
    const observation = await focusWindowByPid(targetPid);
    const elapsedMs = Date.now() - t0;

    t.diagnostic(`focusWindowByPid round-trip: ${elapsedMs}ms (inclui spawn do powershell.exe + Add-Type compile + 150ms sleep do script)`);
    t.diagnostic(`observação medida (real, não simulada): ${JSON.stringify(observation)}`);

    // Estrutura sempre verdadeira, processo real com janela real:
    assert.equal(observation.hadProcess, true);
    assert.equal(observation.hadWindow, true);
    assert.equal(observation.handle, targetHandle);
    assert.equal(observation.attachedFg, true, "focusWindowByPid deve ter anexado à thread do foreground ($attachedFg)");
    assert.equal(observation.attachedTgt, true, "focusWindowByPid deve ter anexado à thread da janela alvo ($attachedTgt)");
    assert.equal(observation.setForegroundReturn, true);
    assert.equal(observation.becameForeground, true, "focusWindowByPid deve trazer a janela alvo para o foreground");
    assert.equal(observation.foregroundHandleAfter, targetHandle, "handle do foreground final deve ser o handle da janela alvo");
  } finally {
    if (distractorPid) await killPid(distractorPid);
    if (targetPid) await killPid(targetPid);
  }
});

async function minimizeWindowHwnd(hwnd) {
  await execFileP("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `$sig = @"
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
"@
$w = Add-Type -MemberDefinition $sig -Name "Win32Min$([guid]::NewGuid().ToString('N'))" -PassThru
$w::ShowWindow([IntPtr]${hwnd}, 6) | Out-Null
`,
  ]);
}

async function isWindowIconic(hwnd) {
  const { stdout } = await execFileP("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `$sig = @"
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
"@
$w = Add-Type -MemberDefinition $sig -Name "Win32Iconic$([guid]::NewGuid().ToString('N'))" -PassThru
$w::IsIconic([IntPtr]${hwnd})
`,
  ]);
  return stdout.trim().toLowerCase() === "true";
}

test("PLAT-05 (real): focusWindowByPid restaura janela minimizada/icônica com ShowWindow(SW_RESTORE) e traz para o foreground", win32Only, async (t) => {
  let targetPid = null;
  let distractorPid = null;
  try {
    targetPid = await launchGuiProcess(CHARMAP);
    const targetHandle = await waitForMainWindowHandle(targetPid);

    // Empurra o foco para outra janela (distrator) e garante que ela está em foreground
    distractorPid = await launchGuiProcess(CHARMAP);
    await waitForMainWindowHandle(distractorPid);
    const distractorObs = await focusWindowByPid(distractorPid);
    assert.equal(distractorObs.becameForeground, true, "distrator deve estar em foreground antes de testar restauração");
    assert.equal(distractorObs.attachedFg, true, "deve ter anexado ao foreground");
    assert.equal(distractorObs.attachedTgt, true, "deve ter anexado ao alvo");

    // Minimiza a janela alvo e confirma que ela ficou icônica
    await minimizeWindowHwnd(targetHandle);
    assert.equal(await isWindowIconic(targetHandle), true, "janela alvo deve estar icônica/minimizada antes do foco");

    const t0 = Date.now();
    const observation = await focusWindowByPid(targetPid);
    const elapsedMs = Date.now() - t0;

    assert.equal(observation.hadProcess, true);
    assert.equal(observation.hadWindow, true);
    assert.equal(observation.handle, targetHandle);
    assert.equal(observation.attachedFg, true, "focusWindowByPid deve ter anexado ao foreground ($attachedFg)");
    assert.equal(observation.attachedTgt, true, "focusWindowByPid deve ter anexado ao alvo ($attachedTgt)");
    assert.equal(observation.setForegroundReturn, true);
    assert.equal(observation.becameForeground, true, "janela minimizada deve vir para o foreground");
    assert.equal(observation.foregroundHandleAfter, targetHandle);
    assert.equal(await isWindowIconic(targetHandle), false, "janela alvo não deve mais estar icônica/minimizada após o foco");

    t.diagnostic(`focusWindowByPid (minimized) round-trip: ${elapsedMs}ms`);
    t.diagnostic(`observação medida (minimized): ${JSON.stringify(observation)}`);
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

// ---------------------------------------------------------------------
// PLAT-11 & PLAT-12 Unit Tests
// ---------------------------------------------------------------------

test("PLAT-11: os três estados (focused, background, minimized) são derivados de isFg e min, sem literais no código", () => {
  const catalog = [{ name: "App", path: "C:\\Apps\\App.exe", kind: "win32" }];
  const windows = [
    { Id: 1, hwnd: 10, title: "Janela Minimizada", min: true, isFg: false, Path: "C:\\Apps\\App.exe" },
    { Id: 2, hwnd: 20, title: "Janela em Foco", min: false, isFg: true, Path: "C:\\Apps\\App.exe" },
    { Id: 3, hwnd: 30, title: "Janela em Segundo Plano", min: false, isFg: false, Path: "C:\\Apps\\App.exe" },
  ];
  const result = matchRunningProcesses(windows, catalog);
  assert.equal(result.length, 3);
  assert.equal(result[0].state, "minimized");
  assert.equal(result[1].state, "focused");
  assert.equal(result[2].state, "background");
  assert.equal(result[0].type, "Foreground");
  assert.equal(result[1].type, "Foreground");
  assert.equal(result[2].type, "Foreground");
});

test("PLAT-11/B1: o filtro deckQueue da PWA (public/index.html:1882-1887) preserva todas as janelas retornadas por matchRunningProcesses", () => {
  const catalog = [
    { name: "Warp", path: "C:\\Apps\\Warp.exe", kind: "win32" },
    { name: "OBS Studio", path: "C:\\Apps\\obs.exe", kind: "win32" },
    { name: "Google Chrome", path: "C:\\Apps\\chrome.exe", kind: "win32" },
  ];
  const windows = [
    { Id: 1, hwnd: 10, title: "Warp", min: false, isFg: false, Path: "C:\\Apps\\Warp.exe" },
    { Id: 2, hwnd: 20, title: "OBS Studio", min: true, isFg: false, Path: "C:\\Apps\\obs.exe" },
    { Id: 3, hwnd: 30, title: "Chrome", min: false, isFg: true, Path: "C:\\Apps\\chrome.exe" },
  ];
  const running = matchRunningProcesses(windows, catalog);
  // Filtro verbatim do deckQueue em public/index.html:1882-1887
  const q = [];
  const seen = {};
  running.forEach(function(a){
    if (a.type && a.type !== "Foreground") return;
    if (seen[a.name]) return;
    seen[a.name] = true;
    q.push(a.name);
  });
  assert.deepEqual(q, ["Warp", "OBS Studio", "Google Chrome"]);
});

test("PLAT-11: createWindowTracker garante estabilidade de id enquanto viva e proteção contra reciclagem de HWND", () => {
  const tracker = createWindowTracker();
  // 1. Primeira observação gera ID único
  const id1 = tracker.getOrCreateId(1234, 100);
  assert.match(id1, /^win-100-1234-\d+$/);

  // 2. Re-escaneamento da mesma janela viva devolve o MESMO id (estabilidade)
  const id1Again = tracker.getOrCreateId(1234, 100);
  assert.equal(id1Again, id1, "janela viva deve manter o mesmo id entre varreduras");

  // 3. HWND é reciclado por outro PID (processo antigo fechou, novo abriu e pegou o mesmo handle)
  const id2 = tracker.getOrCreateId(1234, 200);
  assert.notEqual(id2, id1, "HWND reciclado para outro PID deve gerar novo ID");
  assert.equal(tracker.get(id1), null, "o ID da janela antiga não pode mais resolver após reciclagem");

  // 4. Sweep remove janelas que não estão mais presentes
  tracker.register({ id: id2, hwnd: 1234, pid: 200 });
  assert.notEqual(tracker.get(id2), null);
  tracker.sweep([]);
  assert.equal(tracker.get(id2), null, "sweep deve remover janela que fechou");
});

test("PLAT-12: focusWindow lança WINDOW_NOT_FOUND para ID desconhecido ou janela fechada", async () => {
  const tracker = createWindowTracker();
  const focus = makeFocusWindow({ tracker, log: silentLog });
  await assert.rejects(focus("win-fantasma"), (err) => {
    assert.ok(err instanceof ActionError);
    assert.equal(err.code, "WINDOW_NOT_FOUND");
    return true;
  });
});

test("PLAT-12: focusWindow resolve quando becameForeground é true", async () => {
  const tracker = createWindowTracker();
  tracker.register({ id: "w1", hwnd: 100, pid: 50 });
  const focus = makeFocusWindow({
    tracker,
    focusHwnd: async (hwnd, pid) => {
      assert.equal(hwnd, 100);
      assert.equal(pid, 50);
      return { becameForeground: true };
    },
    log: silentLog,
  });
  const res = await focus("w1");
  assert.deepEqual(res, { ok: true });
});

test("PLAT-12: focusWindow lança FOCUS_RESTRICTED quando becameForeground é false", async () => {
  const tracker = createWindowTracker();
  tracker.register({ id: "w1", hwnd: 100, pid: 50 });
  const focus = makeFocusWindow({
    tracker,
    focusHwnd: async () => ({ becameForeground: false }),
    log: silentLog,
  });
  await assert.rejects(focus("w1"), (err) => {
    assert.ok(err instanceof ActionError);
    assert.equal(err.code, "FOCUS_RESTRICTED");
    return true;
  });
});

test("PLAT-12: minimizeWindow resolve quando minimized é true e lança MINIMIZE_FAILED se falhar", async () => {
  const tracker = createWindowTracker();
  tracker.register({ id: "w1", hwnd: 100, pid: 50 });
  let minCalls = 0;
  let succeed = true;
  const minimize = makeMinimizeWindow({
    tracker,
    minimizeHwnd: async (hwnd, pid) => {
      minCalls++;
      assert.equal(hwnd, 100);
      assert.equal(pid, 50);
      return { minimized: succeed };
    },
    log: silentLog,
  });

  const res = await minimize("w1");
  assert.deepEqual(res, { ok: true });
  assert.equal(minCalls, 1);

  succeed = false;
  await assert.rejects(minimize("w1"), (err) => {
    assert.ok(err instanceof ActionError);
    assert.equal(err.code, "MINIMIZE_FAILED");
    return true;
  });
});

test("PLAT-12: closeWindow fecha via WM_CLOSE, lança CLOSE_FAILED se o app não fechar, e NUNCA usa force-kill", async () => {
  // Prova 1: o script de fechamento envia WM_CLOSE (0x0010) e NÃO contém Stop-Process nem -Force
  assert.match(PS_CLOSE_WINDOW_SCRIPT, /0x0010/, "deve enviar mensagem WM_CLOSE");
  assert.doesNotMatch(PS_CLOSE_WINDOW_SCRIPT, /Stop-Process/i, "NUNCA deve conter Stop-Process");
  assert.doesNotMatch(PS_CLOSE_WINDOW_SCRIPT, /-Force/i, "NUNCA deve conter a flag -Force");
  assert.doesNotMatch(PS_CLOSE_WINDOW_SCRIPT, /taskkill/i, "NUNCA deve conter taskkill");
  assert.doesNotMatch(PS_CLOSE_WINDOW_SCRIPT, /TerminateProcess/i, "NUNCA deve chamar TerminateProcess");

  const tracker = createWindowTracker();
  tracker.register({ id: "w1", hwnd: 100, pid: 50 });

  // Prova 2: sucesso quando closed=true
  let closeCalls = 0;
  let succeed = true;
  const close = makeCloseWindow({
    tracker,
    closeHwnd: async (hwnd, pid) => {
      closeCalls++;
      assert.equal(hwnd, 100);
      assert.equal(pid, 50);
      return { closed: succeed };
    },
    log: silentLog,
  });

  const res = await close("w1");
  assert.deepEqual(res, { ok: true });
  assert.equal(tracker.get("w1"), null, "janela fechada deve ser removida do tracker");

  // Prova 3: erro tipado CLOSE_FAILED se o app recusar o fechamento (ex.: diálogo salvar)
  tracker.register({ id: "w2", hwnd: 200, pid: 60 });
  succeed = false;
  await assert.rejects(close("w2"), (err) => {
    assert.ok(err instanceof ActionError);
    assert.equal(err.code, "CLOSE_FAILED");
    return true;
  });
  assert.notEqual(tracker.get("w2"), null, "janela que não fechou continua no tracker e viva");
});

test("PLAT-12: openNewWindow lança nova instância por app name, sem tentar focar ou lançar FOCUS_RESTRICTED", async () => {
  let launched = null;
  const openNew = makeOpenNewWindow({
    resolveApps: async () => [{ name: "Firefox", path: "C:\\Apps\\Firefox\\firefox.exe", kind: "win32" }],
    launch: async (entry) => { launched = entry; },
    log: silentLog,
  });

  const res = await openNew("Firefox");
  assert.deepEqual(res, { ok: true });
  assert.equal(launched.name, "Firefox");

  await assert.rejects(openNew("Desconhecido"), (err) => {
    assert.ok(err instanceof ActionError);
    assert.equal(err.code, "APP_NOT_FOUND");
    return true;
  });

  const failingOpen = makeOpenNewWindow({
    resolveApps: async () => [{ name: "Quebrado", path: "C:\\Apps\\broken.exe", kind: "win32" }],
    launch: async () => { throw new Error("spawn failed"); },
    log: silentLog,
  });
  await assert.rejects(failingOpen("Quebrado"), (err) => {
    assert.ok(err instanceof ActionError);
    assert.equal(err.code, "LAUNCH_FAILED");
    return true;
  });
});

test("PLAT-11 (real): runPowerShellListProcesses devolve janelas reais com hwnd, mon, title e estado", win32Only, async (t) => {
  const rawWindows = await runPowerShellListProcesses();
  assert.ok(Array.isArray(rawWindows));
  assert.ok(rawWindows.length > 0, "deve encontrar pelo menos uma janela nesta máquina");
  const win = rawWindows[0];
  assert.equal(typeof win.Id, "number");
  assert.equal(typeof win.hwnd, "number");
  assert.equal(typeof win.mon, "number");
  assert.equal(typeof win.min, "boolean");
  assert.equal(typeof win.isFg, "boolean");
  assert.equal(typeof win.title, "string");
  t.diagnostic(`Janelas observadas: ${rawWindows.length}, primeira: hwnd=${win.hwnd} title="${win.title}" pid=${win.Id} mon=${win.mon}`);
});

test("PLAT-12 (real): focusWindow, minimizeWindow e closeWindow controlam janela real (charmap.exe)", win32Only, async (t) => {
  let targetPid = null;
  try {
    targetPid = await launchGuiProcess(CHARMAP);
    const targetHandle = await waitForMainWindowHandle(targetPid);

    const tracker = createWindowTracker();
    const windowId = tracker.getOrCreateId(targetHandle, targetPid);

    // 1. Testar foco
    const focus = makeFocusWindow({ tracker, log: silentLog });
    const focusRes = await focus(windowId);
    assert.deepEqual(focusRes, { ok: true }, "focusWindow deve retornar { ok: true }");

    // 2. Testar minimizar
    const minimize = makeMinimizeWindow({ tracker, log: silentLog });
    const minRes = await minimize(windowId);
    assert.deepEqual(minRes, { ok: true }, "minimizeWindow deve retornar { ok: true }");
    assert.equal(await isWindowIconic(targetHandle), true, "janela deve estar minimizada");

    // 3. Testar fechar (WM_CLOSE, sem force-kill)
    const close = makeCloseWindow({ tracker, log: silentLog });
    const closeRes = await close(windowId);
    assert.deepEqual(closeRes, { ok: true }, "closeWindow deve retornar { ok: true }");

    // Confirma que a janela foi fechada
    assert.equal(tracker.get(windowId), null, "janela deve ser removida do tracker após close");
    targetPid = null; // charmap já fechou
  } finally {
    if (targetPid) await killPid(targetPid);
  }
});

test("PLAT-11/PLAT-12/MJ2 (real): focusWindow, minimizeWindow e closeWindow rejeitam com WINDOW_NOT_FOUND se o HWND foi reciclado para outro PID ($actualPid -ne $ExpectedPid)", win32Only, async (t) => {
  let targetPid = null;
  try {
    targetPid = await launchGuiProcess(CHARMAP);
    const targetHandle = await waitForMainWindowHandle(targetPid);

    // Simula janela cujo HWND pertence a targetPid, mas o tracker/chamador
    // espera outro PID (ex.: reciclagem de handle entre escaneamentos)
    const recycledPid = targetPid + 99999;
    const tracker = createWindowTracker();
    const winId = tracker.getOrCreateId(targetHandle, recycledPid);
    tracker.register({ id: winId, hwnd: targetHandle, pid: recycledPid });

    // 1. focusWindow com PID incompatível falha com WINDOW_NOT_FOUND
    const focus = makeFocusWindow({ tracker, log: silentLog });
    await assert.rejects(focus(winId), (err) => {
      assert.ok(err instanceof ActionError);
      assert.equal(err.code, "WINDOW_NOT_FOUND");
      return true;
    });

    // 2. minimizeWindow com PID incompatível falha com WINDOW_NOT_FOUND e não minimiza
    tracker.register({ id: winId, hwnd: targetHandle, pid: recycledPid });
    const minimize = makeMinimizeWindow({ tracker, log: silentLog });
    await assert.rejects(minimize(winId), (err) => {
      assert.ok(err instanceof ActionError);
      assert.equal(err.code, "WINDOW_NOT_FOUND");
      return true;
    });
    assert.equal(await isWindowIconic(targetHandle), false, "janela não deve ter sido minimizada sob PID incompatível");

    // 3. closeWindow com PID incompatível falha com WINDOW_NOT_FOUND e não fecha
    tracker.register({ id: winId, hwnd: targetHandle, pid: recycledPid });
    const close = makeCloseWindow({ tracker, log: silentLog });
    await assert.rejects(close(winId), (err) => {
      assert.ok(err instanceof ActionError);
      assert.equal(err.code, "WINDOW_NOT_FOUND");
      return true;
    });

    // A janela real do charmap ainda deve estar aberta e não fechada
    const validWinId = tracker.getOrCreateId(targetHandle, targetPid);
    tracker.register({ id: validWinId, hwnd: targetHandle, pid: targetPid });
    const closeValid = await close(validWinId);
    assert.deepEqual(closeValid, { ok: true });
    targetPid = null; // já fechado
  } finally {
    if (targetPid) await killPid(targetPid);
  }
});

test("PLAT-12/B2 (real): closeWindow em janela que recusa fechamento (FormClosing e.Cancel=true) devolve CLOSE_FAILED e mantém o processo vivo (sem force-kill)", win32Only, async (t) => {
  const tmpScript = join(tmpdir(), `unclosable-${Date.now()}.ps1`);
  const readyFile = join(tmpdir(), `unclosable-ready-${Date.now()}.txt`);
  const safeReadyPath = readyFile.replace(/\\/g, "\\\\");
  const psContent = `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = "DeckTechUnclosableForm"
$form.add_FormClosing({ param($s, $e) $e.Cancel = $true })
$hwnd = $form.Handle
[System.IO.File]::WriteAllText("${safeReadyPath}", "$($hwnd):$PID")
[System.Windows.Forms.Application]::Run($form)
`;
  writeFileSync(tmpScript, psContent, "utf8");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", tmpScript], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  let hwnd = null;
  let pid = null;
  try {
    for (let i = 0; i < 50; i++) {
      if (existsSync(readyFile)) {
        const text = readFileSync(readyFile, "utf8").trim();
        const parts = text.split(":");
        hwnd = Number(parts[0]);
        pid = Number(parts[1]);
        rmSync(readyFile, { force: true });
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(hwnd && pid, "deve ter obtido hwnd e pid da janela WinForms");

    const tracker = createWindowTracker();
    const winId = tracker.getOrCreateId(hwnd, pid);
    tracker.register({ id: winId, hwnd, pid });

    const close = makeCloseWindow({ tracker, log: silentLog });
    await assert.rejects(close(winId), (err) => {
      assert.ok(err instanceof ActionError);
      assert.equal(err.code, "CLOSE_FAILED");
      return true;
    });

    // Prova viva e discriminante: o processo NÃO foi morto (sem force-kill)
    let isAlive = false;
    try {
      process.kill(pid, 0);
      isAlive = true;
    } catch {
      isAlive = false;
    }
    assert.equal(isAlive, true, "o processo que cancelou WM_CLOSE deve permanecer vivo (nunca force-kill)");
    t.diagnostic(`fechamento recusado com CLOSE_FAILED: processo pid=${pid} continua vivo=${isAlive}`);
  } finally {
    rmSync(tmpScript, { force: true });
    if (pid) {
      await killPid(pid);
    }
  }
});
