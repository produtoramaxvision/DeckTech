// platform/windows/actions.js
//
// PLAT-05 — Windows `listAppProcesses` + `activateApp` providers behind the
// Fase 2 contract (platform/index.js#win32Platform). `openWebsite` stays
// `notImplemented` — out of scope for PLAT-05 (.maxvision/REQUIREMENTS.md).
//
// Reuses the shared typed-error vocabulary from actions.js (PLAT-06):
// `ActionError` with codes FOCUS_RESTRICTED / APP_NOT_FOUND / LAUNCH_FAILED
// — the exact same class macOS's focusApp/openApp throw, not a parallel
// Windows-only error type. Only these three codes may ever escape
// `activateApp` here: any infrastructure failure underneath (a PowerShell
// collect dying, `win32ListInstalledApps` throwing `WindowsAppScanError`)
// gets folded into `LAUNCH_FAILED` before it reaches the caller — server.js's
// `fail()` has no copy path for a code outside PLAT-06's three, and letting
// one through would silently regress success criterion 4 ("the client
// receives the Phase 2 typed error, not a generic 500") back into an
// opaque, uncopied 500.
//
// PRD §15 / PLAT-05 decision record:
// Originally, this file considered SetForegroundWindow restrictions as legitimate
// Windows behavior not to be worked around with AttachThreadInput without evidence,
// preferring the fallback of opening a new instance and surfacing FOCUS_RESTRICTED.
//
// That decision was REOPENED on 2026-09-18 when the first real end-to-end test
// (Galaxy S10e over LAN) demonstrated that tapping an open app constantly returned
// FOCUS_RESTRICTED (0/5 activations in a cold run) and opened a new instance instead
// of bringing the existing window forward, breaking the product's core promise.
//
// The evidence now exists from two independent runs of the measurement harness
// (tools/fg-harness.mjs, results in tools/fg-results.json) on this
// machine against throwaway windows, discarding trivial passes:
//
//                 worker run    second run
//     plain          0/10          1/10      <- what production did previously
//     switch         0/10          1/10
//     alt           10/10          8/10
//     attach        10/10         10/10      <- AttachThreadInput
//     persistent     0/10          0/10      <- long-lived helper process
//
// attach achieved 20/20 (100% success across both runs). When split by incumbent,
// attach beat a third-party window (explorer, scrcpy) 2/2, while alt lost both (0/2,
// only succeeding against sibling targets). persistent at 0/20 proved this is an
// API issue rather than a process-lifetime issue.
//
// Therefore, the previous decision was overturned by empirical measurement:
// AttachThreadInput (attaching the calling thread's input queue to the foreground
// window's thread and target thread, restoring if iconic with ShowWindow(SW_RESTORE),
// calling SetForegroundWindow, and detaching) is adopted as the primary focus mechanism.
//
// FOCUS_RESTRICTED must still exist and still be reachable when focus genuinely fails
// (process gone, no window, or foreground confirmation failing despite the attach sequence).
// The typed error and the "opened new instance" fallback are preserved for those cases,
// stopping them from being the common path.
//
// ANY failure to confirm focus (process gone, no window, PowerShell itself
// failing, the API call returning false, the foreground window not
// actually changing) is treated UNIFORMLY as "not focused" here — same
// choice actions.js's `focusApp` already makes for macOS (its `catch` does
// not distinguish "osascript failed because of a restriction" from "the
// pid doesn't exist anymore"). Discriminating those Windows-side causes
// further is possible in principle but adds nothing the client or the PRD
// asks for: either the window came to front, or the accepted fallback (new
// instance + FOCUS_RESTRICTED) runs.

import { execFile, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path/win32";
import { promisify } from "node:util";

import { ActionError } from "../../actions.js";
import { listInstalledApps as defaultResolveApps } from "./apps.js";
import { log as defaultLog } from "../../log.js";

const execFileAsync = promisify(execFile);

/** TTL do "running" Windows — mesmo valor usado pelo macOS (apps.js's RUNNING_TTL_MS). */
export const RUNNING_TTL_MS = 1500;

// --------------------------------------------------------------------
// listAppProcesses (PLAT-05 / PLAT-11: enumeração por janela)
// --------------------------------------------------------------------

// Escreve em ARQUIVO UTF-8 sem BOM, nunca em stdout — mesma decisão (e mesmo
// motivo) de platform/windows/apps.js's PS_SCRIPT: o console do PowerShell
// numa máquina pt-BR corrompe títulos de janela acentuados capturados via
// child_process pipe.
//
// PLAT-11: EnumWindows enumera todas as janelas de topo visíveis com título
// e extrai pid, hwnd, monitor (MonitorFromWindow), min (IsIconic), isFg
// (GetForegroundWindow), title e o caminho do processo (QueryFullProcessImageName).
export const PS_LIST_PROCESSES_SCRIPT = `
param(
  [Parameter(Mandatory = $true)][string]$OutFile
)
$ErrorActionPreference = 'Stop'

$code = @"
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;

public class WindowEntry {
    public int pid;
    public long hwnd;
    public long mon;
    public bool min;
    public bool isFg;
    public string title;
    public string path;
}

public static class WindowScanner {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint dwFlags);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint processAccess, bool bInheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern bool QueryFullProcessImageName(IntPtr hProcess, uint dwFlags, StringBuilder lpExeName, ref uint lpdwSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr hObject);

    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    public static List<WindowEntry> Scan() {
        var list = new List<WindowEntry>();
        IntPtr fg = GetForegroundWindow();
        var pathCache = new Dictionary<uint, string>();

        EnumWindows((hWnd, lParam) => {
            if (IsWindowVisible(hWnd)) {
                int len = GetWindowTextLength(hWnd);
                if (len > 0) {
                    var sb = new StringBuilder(len + 1);
                    GetWindowText(hWnd, sb, sb.Capacity);
                    uint procId = 0;
                    GetWindowThreadProcessId(hWnd, out procId);

                    string path = null;
                    if (!pathCache.TryGetValue(procId, out path)) {
                        IntPtr hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, procId);
                        if (hProc != IntPtr.Zero) {
                            try {
                                var pathBuf = new StringBuilder(1024);
                                uint size = (uint)pathBuf.Capacity;
                                if (QueryFullProcessImageName(hProc, 0, pathBuf, ref size)) {
                                    path = pathBuf.ToString();
                                }
                            } finally {
                                CloseHandle(hProc);
                            }
                        }
                        pathCache[procId] = path;
                    }

                    IntPtr mon = MonitorFromWindow(hWnd, 2);
                    bool min = IsIconic(hWnd);
                    list.Add(new WindowEntry {
                        pid = (int)procId,
                        hwnd = hWnd.ToInt64(),
                        mon = mon.ToInt64(),
                        min = min,
                        isFg = (hWnd == fg),
                        title = sb.ToString(),
                        path = path
                    });
                }
            }
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
"@

if (-not ([System.Management.Automation.PSTypeName]'WindowScanner').Type) {
  Add-Type -TypeDefinition $code
}

$wins = [WindowScanner]::Scan()
$list = foreach ($w in $wins) {
  [PSCustomObject]@{
    Id = $w.pid
    hwnd = $w.hwnd
    mon = $w.mon
    min = $w.min
    isFg = $w.isFg
    title = $w.title
    Path = $w.path
  }
}
$json = $list | ConvertTo-Json -Depth 4 -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutFile, $json, $utf8NoBom)
`;

/** ConvertTo-Json colapsa um array de 1 item num objeto solto — mesma armadilha de platform/windows/apps.js#asArray. */
function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Roda o coletor PowerShell (processos com janela visível: Id, ProcessName,
 * MainWindowTitle, Path) e devolve os dados crus. Nunca chamado fora de
 * win32 — mesmo guard de `runPowerShellCollect` (platform/windows/apps.js).
 * @param {{signal?: AbortSignal}} opts
 */
export async function runPowerShellListProcesses({ signal } = {}) {
  if (process.platform !== "win32") {
    throw new Error(`Windows process listing requires win32, got "${process.platform}"`);
  }
  const workDir = mkdtempSync(join(tmpdir(), "decktech-plat05-list-"));
  const scriptPath = join(workDir, "list.ps1");
  const outPath = join(workDir, "list.json");
  writeFileSync(scriptPath, PS_LIST_PROCESSES_SCRIPT, "utf8");
  let raw;
  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-OutFile", outPath],
      { signal, maxBuffer: 32 * 1024 * 1024 },
    );
    raw = readFileSync(outPath, "utf8");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  return asArray(JSON.parse(raw));
}

/**
 * Path win32 normalizado só pra comparação — lower-case, sem tocar a
 * capitalização original que segue para o cliente. `node:path/win32`
 * explicitamente (não host-dispatched): esta função roda também na suíte de
 * testes injetados no ubuntu-latest.
 */
function normalizeExePath(p) {
  return String(p ?? "").trim().toLowerCase();
}

/**
 * Rastreador de janelas em memória com prevenção de reciclagem de HWND (PLAT-11).
 * O Windows pode reciclar valores de HWND quando uma janela fecha e outra abre.
 * Para garantir estabilidade enquanto a janela existe e invalidar imediatamente
 * quando ela fecha (nunca apontando para a janela errada depois que a original fecha),
 * este tracker associa a cada janela uma identidade estável `win-${pid}-${hwnd}-${seq}`
 * que só permanece válida enquanto o par (hwnd, pid) continua ativo no sistema.
 */
export function createWindowTracker() {
  const byId = new Map();
  const hwndToId = new Map();
  let counter = 0;

  function getOrCreateId(hwnd, pid) {
    const existingId = hwndToId.get(hwnd);
    if (existingId) {
      const existing = byId.get(existingId);
      if (existing && existing.pid === pid) {
        return existingId;
      }
      byId.delete(existingId);
      hwndToId.delete(hwnd);
    }
    const id = `win-${pid}-${hwnd}-${++counter}`;
    hwndToId.set(hwnd, id);
    byId.set(id, { id, hwnd, pid });
    return id;
  }

  function register(windowInfo) {
    const { id, hwnd, pid } = windowInfo;
    byId.set(id, windowInfo);
    hwndToId.set(hwnd, id);
  }

  function get(id) {
    return byId.get(id) ?? null;
  }

  function remove(id) {
    const w = byId.get(id);
    if (w) {
      hwndToId.delete(w.hwnd);
      byId.delete(id);
    }
  }

  function sweep(activeIds) {
    const activeSet = new Set(activeIds);
    for (const [id, w] of byId.entries()) {
      if (!activeSet.has(id)) {
        hwndToId.delete(w.hwnd);
        byId.delete(id);
      }
    }
  }

  function clear() {
    byId.clear();
    hwndToId.clear();
  }

  return { getOrCreateId, register, get, remove, sweep, clear, byId, hwndToId };
}

export const defaultWindowTracker = createWindowTracker();

/**
 * Casa janelas rodando (PLAT-11) com o catálogo de apps instalados (PLAT-02) —
 * POR CAMINHO DO EXECUTÁVEL, nunca por nome de processo ou título de janela.
 *
 * Ao contrário do antigo comportamento que deduplicava por PID (`seenPid.add(pid)`),
 * PLAT-11 preserva CADA JANELA individualmente. Dois navegadores ou janelas de um
 * mesmo app em dois monitores geram dois cartões com seus respectivos títulos,
 * monitores e estados.
 *
 * Estados possíveis (PLAT-11):
 * - "focused": janela ativa em primeiro plano (hwnd === GetForegroundWindow())
 * - "minimized": janela minimizada / icônica (IsIconic(hwnd) === true)
 * - "background": janela visível em segundo plano
 *
 * @param {Array<{Id?: number, pid?: number, hwnd?: number, MainWindowTitle?: string, title?: string, Path?: string, path?: string, mon?: number, min?: boolean, isFg?: boolean, state?: string}>} processes
 * @param {Array<{name: string, path?: string, kind?: string}>} catalogApps
 * @param {{tracker?: ReturnType<typeof createWindowTracker>}} [options]
 */
export function matchRunningProcesses(processes, catalogApps, { tracker = defaultWindowTracker } = {}) {
  const byPath = new Map();
  for (const app of catalogApps ?? []) {
    if (app?.kind === "win32" && app?.path) {
      byPath.set(normalizeExePath(app.path), app.name);
    }
  }
  const seenHwnd = new Set();
  const result = [];
  for (const p of processes ?? []) {
    const pid = Number(p?.pid ?? p?.Id);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const rawPath = p?.Path ?? p?.path;
    const name = rawPath ? byPath.get(normalizeExePath(rawPath)) : undefined;
    if (!name) continue;

    const hwnd = Number(p?.hwnd ?? p?.Id);
    if (seenHwnd.has(hwnd)) continue;
    seenHwnd.add(hwnd);

    let state;
    if (p?.min === true || p?.isIconic === true || p?.state === "minimized") {
      state = "minimized";
    } else if (p?.isFg === true || p?.isForeground === true || p?.state === "focused") {
      state = "focused";
    } else {
      state = "background";
    }

    const id = p?.id ?? tracker.getOrCreateId(hwnd, pid);
    const title = String(p?.title ?? p?.MainWindowTitle ?? "");
    const monitor = Number(p?.mon ?? p?.monitor ?? 0);

    const entry = {
      id,
      name,
      title,
      monitor,
      state,
      type: "Foreground",
      pid,
      hwnd,
    };
    tracker.register(entry);
    result.push(entry);
  }
  tracker.sweep(result.map((r) => r.id));
  return result;
}

/**
 * Fábrica testável (mesmo padrão de `makeListInstalledApps` em
 * platform/windows/apps.js): deps injetáveis permitem exercitar a
 * composição inteira sem PowerShell real — CI roda em ubuntu-latest.
 * Nunca lança: qualquer falha (PowerShell, catálogo, parse) vira `[]` com
 * log de warn — mesmo contrato de `listAppProcesses` do macOS (apps.js).
 * @param {{
 *   collect?: (opts: {signal?: AbortSignal}) => Promise<Array<any>>,
 *   resolveApps?: (opts?: {signal?: AbortSignal}) => Promise<Array<any>>,
 *   tracker?: ReturnType<typeof createWindowTracker>,
 *   ttlMs?: number,
 *   now?: () => number,
 *   log?: typeof defaultLog,
 * }} deps
 */
export function makeListAppProcesses(deps = {}) {
  const {
    collect = runPowerShellListProcesses,
    resolveApps = defaultResolveApps,
    tracker = defaultWindowTracker,
    ttlMs = RUNNING_TTL_MS,
    now = Date.now,
    log = defaultLog,
  } = deps;
  let cacheSeq = 0;
  let cache = { at: 0, value: null, promise: null };

  async function run(opts) {
    const [processes, apps] = await Promise.all([collect(opts), resolveApps(opts)]);
    return matchRunningProcesses(processes, apps, { tracker });
  }

  async function listAppProcesses(opts = {}) {
    const t = now();
    if (cache.value && t - cache.at < ttlMs) return cache.value;
    if (cache.promise) return cache.promise;
    const seq = ++cacheSeq;
    const p = run(opts)
      .then((value) => {
        if (cacheSeq === seq) {
          cache = { at: now(), value, promise: null };
        }
        return value;
      })
      .catch((err) => {
        if (cacheSeq === seq) {
          cache.promise = null;
        }
        log.warn("windows.actions.list_processes_failed", { message: err?.message ?? String(err) });
        return [];
      });
    cache.promise = p;
    return p;
  }

  /**
   * Invalida apenas o cache em memória da listagem de processos,
   * forçando nova coleta na próxima chamada, SEM limpar o window tracker.
   * Usado após ações de janela (focus, minimize, close, openNewWindow, activate)
   * para que o próximo status push ou GET /api/apps veja o estado novo imediatamente.
   */
  listAppProcesses.invalidateCache = () => {
    cacheSeq++;
    cache = { at: 0, value: null, promise: null };
  };

  /** Só testes / hot-reload — mesmo nome/forma de apps.js#clearInstalledAppsCache. */
  listAppProcesses.clearCache = () => {
    cacheSeq++;
    cache = { at: 0, value: null, promise: null };
    tracker.clear();
  };

  return listAppProcesses;
}

/** Instância padrão, ligada às dependências reais — o que platform/index.js consome. */
export const listAppProcesses = makeListAppProcesses();

/** Invalida apenas o cache de processos rodando sem tocar no tracker. */
export function invalidateRunningProcessesCache() {
  listAppProcesses.invalidateCache();
}

/** Só testes / hot-reload. */
export function clearRunningProcessesCache({ preserveTracker = false } = {}) {
  if (preserveTracker) {
    listAppProcesses.invalidateCache();
  } else {
    listAppProcesses.clearCache();
  }
}

// --------------------------------------------------------------------
// activateApp (PLAT-05, metade 2)
// --------------------------------------------------------------------

// Observação, não decisão binária: anexa a fila de input da thread chamadora
// à thread da janela em foreground e à thread da janela alvo (AttachThreadInput),
// restaura com ShowWindow(SW_RESTORE) se estiver minimizada/icônica, chama
// SetForegroundWindow, desanexa e então RELÊ GetForegroundWindow — a prova de
// que a janela virou de fato o foreground. `becameForeground` abaixo é o único
// campo que `focusWindowByPid` trata como sucesso.
export const PS_FOCUS_SCRIPT = `
param(
  [Parameter(Mandatory = $true)][int]$TargetPid,
  [Parameter(Mandatory = $true)][string]$OutFile
)
$ErrorActionPreference = 'Stop'
$sig = @"
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
"@
$native = Add-Type -MemberDefinition $sig -Name "DokkeFocus$([guid]::NewGuid().ToString('N'))" -Namespace Win32Functions -PassThru

$result = [ordered]@{ hadProcess = $false; hadWindow = $false; becameForeground = $false }
try {
  $proc = Get-Process -Id $TargetPid -ErrorAction Stop
  $result.hadProcess = $true
  $handle = $proc.MainWindowHandle
  $result.handle = $handle.ToInt64()
  if ($handle -ne [IntPtr]::Zero) {
    $result.hadWindow = $true
    $fgBefore = $native::GetForegroundWindow()
    $result.foregroundHandleBefore = $fgBefore.ToInt64()

    $curThread = $native::GetCurrentThreadId()
    $fgPid = 0
    $fgThread = $native::GetWindowThreadProcessId($fgBefore, [ref]$fgPid)
    $tgtPid = 0
    $tgtThread = $native::GetWindowThreadProcessId($handle, [ref]$tgtPid)

    $attachedFg = $false
    if ($fgThread -ne 0 -and $fgThread -ne $curThread) {
      $attachedFg = $native::AttachThreadInput($curThread, $fgThread, $true)
    }
    $attachedTgt = $false
    if ($tgtThread -ne 0 -and $tgtThread -ne $curThread) {
      $attachedTgt = $native::AttachThreadInput($curThread, $tgtThread, $true)
    }

    $SW_RESTORE = 9
    if ($native::IsIconic($handle)) {
      $native::ShowWindow($handle, $SW_RESTORE) | Out-Null
    }

    $result.attachedFg = $attachedFg
    $result.attachedTgt = $attachedTgt
    $result.setForegroundReturn = $native::SetForegroundWindow($handle)

    if ($attachedTgt) {
      $native::AttachThreadInput($curThread, $tgtThread, $false) | Out-Null
    }
    if ($attachedFg) {
      $native::AttachThreadInput($curThread, $fgThread, $false) | Out-Null
    }

    Start-Sleep -Milliseconds 150
    $fgAfter = $native::GetForegroundWindow()
    $result.foregroundHandleAfter = $fgAfter.ToInt64()
    $result.becameForeground = ($fgAfter -eq $handle)
  }
} catch {
  $result.error = $_.Exception.Message
}
$json = $result | ConvertTo-Json -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutFile, $json, $utf8NoBom)
`;

/**
 * Tenta trazer a janela do `pid` pra frente e devolve a OBSERVAÇÃO completa
 * (não só um bool) — pra quem chama poder logar/depurar exatamente qual
 * parte falhou (processo não existe mais / sem janela visível / API
 * chamada mas o foreground não mudou). `activateApp` abaixo trata qualquer
 * resultado que não seja `becameForeground: true` uniformemente como "não
 * focou" — ver comentário de topo do arquivo.
 * @param {number} pid
 * @param {{signal?: AbortSignal, exec?: typeof execFileAsync}} opts
 */
export async function focusWindowByPid(pid, opts = {}) {
  const { signal, exec = execFileAsync } = opts;
  if (process.platform !== "win32") {
    throw new Error(`Windows window focus requires win32, got "${process.platform}"`);
  }
  const workDir = mkdtempSync(join(tmpdir(), "decktech-plat05-focus-"));
  const scriptPath = join(workDir, "focus.ps1");
  const outPath = join(workDir, "focus.json");
  writeFileSync(scriptPath, PS_FOCUS_SCRIPT, "utf8");
  try {
    await exec(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath,
        "-TargetPid", String(pid), "-OutFile", outPath],
      { signal, maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(readFileSync(outPath, "utf8"));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Classifica a falha de lançar `entry` (spawn direto no .exe, ou
 * `explorer.exe shell:AppsFolder\\<AUMID>` pro pacote UWP). `ENOENT` do
 * spawn do .exe é o único sinal confiável de "não está mais instalado" —
 * qualquer outra falha vira LAUNCH_FAILED. Para UWP, `explorer.exe` quase
 * nunca falha alto mesmo com um AUMID stale (ver comentário de
 * `launchAppEntry` e unresolved[] da tarefa): esse caminho é um gap
 * conhecido, não uma classificação testada empiricamente como certeira.
 */
function classifyLaunchFailure(err) {
  if (err?.code === "ENOENT") return "APP_NOT_FOUND";
  return "LAUNCH_FAILED";
}

// BUG real encontrado nesta máquina (não hipotético): `execFile`/`promisify`
// só resolve quando o processo filho SAI. Pra um app de janela normal
// (Chrome, Notepad++, qualquer app da Store) isso nunca acontece sozinho —
// `activateApp` ficaria pendurado pra sempre esperando o usuário fechar o
// app que acabou de abrir. Medido: `execFileAsync("...\\mpc-hc64.exe", [])`
// nunca resolveu enquanto o Media Player Classic ficou aberto na tela
// (discrimination_proof da tarefa tem o traço completo). `spawnDetached`
// abaixo resolve assim que o processo filho TERMINA DE NASCER (evento
// `spawn`, não `exit`) e `.unref()` o processo pai nunca aguarda o filho —
// exatamente "abrir e não esperar", que é o que lançar um app precisa ser.
function spawnDetached(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(cmd, args, { ...opts, detached: true, stdio: "ignore" });
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve();
    });
  });
}

/**
 * Lança `entry` (win32: spawn direto no .exe resolvido pelo .lnk — nunca
 * via shell, então um path com espaço nunca precisa de quoting manual;
 * uwp: `explorer.exe shell:AppsFolder\\<AUMID>`, o mecanismo documentado do
 * Shell do Windows pra ativar um pacote pelo AUMID sem COM). `cwd` é o
 * diretório do .exe — mesmo comportamento que abrir o atalho do Menu
 * Iniciar produziria. NUNCA espera o processo filho sair — ver comentário
 * de `spawnDetached` acima.
 * @param {{name: string, kind?: string, path?: string, aumid?: string}} entry
 * @param {{exec?: typeof spawnDetached}} tools
 */
export async function launchAppEntry(entry, tools = {}) {
  const { exec = spawnDetached } = tools;
  try {
    if (entry.kind === "uwp") {
      await exec("explorer.exe", [`shell:AppsFolder\\${entry.aumid}`]);
    } else {
      await exec(entry.path, [], { cwd: dirname(entry.path) });
    }
  } catch (err) {
    throw new ActionError(classifyLaunchFailure(err), `launch failed for "${entry.name}"`);
  }
}

/**
 * Fábrica testável do provider `activateApp` (PLAT-05). `resolveApps` é o
 * catálogo TTL-cacheado de PLAT-02 (`win32ListInstalledApps` por default) —
 * a MESMA instância que `platform/index.js#win32Platform` já injeta em
 * `iconService`/`listAppProcesses`, não um segundo scan independente.
 * @param {{
 *   resolveApps?: (opts?: {signal?: AbortSignal}) => Promise<Array<any>>,
 *   focusPid?: typeof focusWindowByPid,
 *   launch?: typeof launchAppEntry,
 *   log?: typeof defaultLog,
 * }} deps
 */
export function makeActivateApp(deps = {}) {
  const {
    resolveApps = defaultResolveApps,
    focusPid = focusWindowByPid,
    launch = launchAppEntry,
    invalidateCache = () => listAppProcesses.invalidateCache(),
    log = defaultLog,
  } = deps;

  async function findAppEntry(name) {
    let apps;
    try {
      apps = await resolveApps();
    } catch (err) {
      // WindowsAppScanError (POWERSHELL_FAILED/SCAN_OUTPUT_INVALID/...) não
      // tem entrada em ACTION_ERROR_MESSAGES (server.js) nem copy no PWA
      // (PLAT-06) — nunca deixa esse code escapar pro cliente. Detalhe
      // interno vai pro log, não pro body da resposta.
      log.warn("windows.actions.resolve_apps_failed", { message: err?.message ?? String(err) });
      throw new ActionError("LAUNCH_FAILED", `could not resolve app catalog while activating "${name}"`);
    }
    return (apps ?? []).find((a) => a?.name === name) ?? null;
  }

  /**
   * @param {{name: string, pid?: number}} app
   */
  async function activateApp({ name, pid }) {
    const entry = await findAppEntry(name);
    if (!entry) throw new ActionError("APP_NOT_FOUND", `app not found in Windows catalog: "${name}"`);

    if (Number.isInteger(pid) && pid > 0) {
      let observation = null;
      try {
        observation = await focusPid(pid);
      } catch (err) {
        log.debug("windows.actions.focus_attempt_failed", { pid, message: err?.message ?? String(err) });
      }
      if (observation?.becameForeground === true) {
        if (typeof invalidateCache === "function") {
          try { invalidateCache(); } catch {}
        }
        return; // sucesso: janela existente veio pra frente
      }
      // Qualquer outro resultado (processo sumiu, sem janela, API chamada
      // mas o foreground não mudou, ou o próprio PowerShell falhou) — PRD
      // §15: abre nova instância e sinaliza FOCUS_RESTRICTED. Igual a
      // actions.js#focusApp no macOS: o fallback bem-sucedido não engole o
      // erro, ele propaga DEPOIS do open.
      await launch(entry);
      if (typeof invalidateCache === "function") {
        try { invalidateCache(); } catch {}
      }
      throw new ActionError("FOCUS_RESTRICTED", `focus restricted for "${name}", opened new instance`);
    }

    await launch(entry);
    if (typeof invalidateCache === "function") {
      try { invalidateCache(); } catch {}
    }
  }

  return activateApp;
}

/** Instância padrão, ligada às dependências reais — o que platform/index.js consome. */
export const activateApp = makeActivateApp();

// --------------------------------------------------------------------
// PLAT-12 — Ações de janela endereçadas por janela (e openNewWindow por app)
// --------------------------------------------------------------------

export const PS_FOCUS_WINDOW_SCRIPT = `
param(
  [Parameter(Mandatory = $true)][long]$TargetHwnd,
  [Parameter(Mandatory = $true)][int]$ExpectedPid,
  [Parameter(Mandatory = $true)][string]$OutFile
)
$ErrorActionPreference = 'Stop'
$sig = @"
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
"@
$native = Add-Type -MemberDefinition $sig -Name "DokkeFocusWin$([guid]::NewGuid().ToString('N'))" -Namespace Win32Functions -PassThru

$result = [ordered]@{ notFound = $false; becameForeground = $false; setForegroundReturn = $false }
try {
  $handle = [IntPtr]$TargetHwnd
  if (-not $native::IsWindow($handle)) {
    $result.notFound = $true
  } else {
    $actualPid = [uint32]0
    $native::GetWindowThreadProcessId($handle, [ref]$actualPid) | Out-Null
    if ($actualPid -ne $ExpectedPid) {
      $result.notFound = $true
    } else {
      $fgBefore = $native::GetForegroundWindow()
      $result.foregroundHandleBefore = $fgBefore.ToInt64()

      $curThread = $native::GetCurrentThreadId()
      $fgPid = 0
      $fgThread = $native::GetWindowThreadProcessId($fgBefore, [ref]$fgPid)
      $tgtPid = 0
      $tgtThread = $native::GetWindowThreadProcessId($handle, [ref]$tgtPid)

      $attachedFg = $false
      if ($fgThread -ne 0 -and $fgThread -ne $curThread) {
        $attachedFg = $native::AttachThreadInput($curThread, $fgThread, $true)
      }
      $attachedTgt = $false
      if ($tgtThread -ne 0 -and $tgtThread -ne $curThread) {
        $attachedTgt = $native::AttachThreadInput($curThread, $tgtThread, $true)
      }

      $SW_RESTORE = 9
      if ($native::IsIconic($handle)) {
        $native::ShowWindow($handle, $SW_RESTORE) | Out-Null
      }

      $result.attachedFg = $attachedFg
      $result.attachedTgt = $attachedTgt
      $result.setForegroundReturn = $native::SetForegroundWindow($handle)

      if ($attachedTgt) {
        $native::AttachThreadInput($curThread, $tgtThread, $false) | Out-Null
      }
      if ($attachedFg) {
        $native::AttachThreadInput($curThread, $fgThread, $false) | Out-Null
      }

      Start-Sleep -Milliseconds 150
      $fgAfter = $native::GetForegroundWindow()
      $result.foregroundHandleAfter = $fgAfter.ToInt64()
      $result.becameForeground = ($fgAfter -eq $handle)
    }
  }
} catch {
  $result.error = $_.Exception.Message
}
$json = $result | ConvertTo-Json -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutFile, $json, $utf8NoBom)
`;

export async function runPowerShellFocusWindow(hwnd, expectedPid, opts = {}) {
  const { signal, exec = execFileAsync } = opts;
  if (process.platform !== "win32") {
    throw new Error(`Windows window focus requires win32, got "${process.platform}"`);
  }
  const workDir = mkdtempSync(join(tmpdir(), "decktech-plat12-focus-"));
  const scriptPath = join(workDir, "focus.ps1");
  const outPath = join(workDir, "focus.json");
  writeFileSync(scriptPath, PS_FOCUS_WINDOW_SCRIPT, "utf8");
  try {
    await exec(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath,
        "-TargetHwnd", String(hwnd), "-ExpectedPid", String(expectedPid), "-OutFile", outPath],
      { signal, maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(readFileSync(outPath, "utf8"));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function makeFocusWindow(deps = {}) {
  const {
    tracker = defaultWindowTracker,
    focusHwnd = runPowerShellFocusWindow,
    invalidateCache = () => listAppProcesses.invalidateCache(),
    log = defaultLog,
  } = deps;

  return async function focusWindow(target, opts = {}) {
    const windowId = typeof target === "object" && target !== null ? target.id : String(target);
    const win = tracker.get(windowId);
    if (!win) {
      throw new ActionError("WINDOW_NOT_FOUND", `window "${windowId}" not found`);
    }
    let obs;
    try {
      obs = await focusHwnd(win.hwnd, win.pid, opts);
    } catch (err) {
      log.warn("windows.actions.focus_window_failed", { windowId, message: err?.message ?? String(err) });
      throw new ActionError("FOCUS_RESTRICTED", `focus restricted for window "${windowId}"`);
    }
    if (obs?.notFound) {
      tracker.remove(windowId);
      throw new ActionError("WINDOW_NOT_FOUND", `window "${windowId}" not found or closed`);
    }
    if (obs?.becameForeground !== true) {
      throw new ActionError("FOCUS_RESTRICTED", `focus restricted for window "${windowId}"`);
    }
    if (typeof invalidateCache === "function") {
      try { invalidateCache(); } catch {}
    }
    return { ok: true };
  };
}

export const focusWindow = makeFocusWindow();

export const PS_MINIMIZE_WINDOW_SCRIPT = `
param(
  [Parameter(Mandatory = $true)][long]$TargetHwnd,
  [Parameter(Mandatory = $true)][int]$ExpectedPid,
  [Parameter(Mandatory = $true)][string]$OutFile
)
$ErrorActionPreference = 'Stop'
$sig = @"
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
"@
$native = Add-Type -MemberDefinition $sig -Name "DokkeMinWin$([guid]::NewGuid().ToString('N'))" -Namespace Win32Functions -PassThru

$result = [ordered]@{ notFound = $false; minimized = $false }
try {
  $handle = [IntPtr]$TargetHwnd
  if (-not $native::IsWindow($handle)) {
    $result.notFound = $true
  } else {
    $actualPid = [uint32]0
    $native::GetWindowThreadProcessId($handle, [ref]$actualPid) | Out-Null
    if ($actualPid -ne $ExpectedPid) {
      $result.notFound = $true
    } else {
      $SW_MINIMIZE = 6
      $native::ShowWindow($handle, $SW_MINIMIZE) | Out-Null
      Start-Sleep -Milliseconds 100
      $result.minimized = $native::IsIconic($handle)
    }
  }
} catch {
  $result.error = $_.Exception.Message
}
$json = $result | ConvertTo-Json -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutFile, $json, $utf8NoBom)
`;

export async function runPowerShellMinimizeWindow(hwnd, expectedPid, opts = {}) {
  const { signal, exec = execFileAsync } = opts;
  if (process.platform !== "win32") {
    throw new Error(`Windows window minimize requires win32, got "${process.platform}"`);
  }
  const workDir = mkdtempSync(join(tmpdir(), "decktech-plat12-min-"));
  const scriptPath = join(workDir, "min.ps1");
  const outPath = join(workDir, "min.json");
  writeFileSync(scriptPath, PS_MINIMIZE_WINDOW_SCRIPT, "utf8");
  try {
    await exec(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath,
        "-TargetHwnd", String(hwnd), "-ExpectedPid", String(expectedPid), "-OutFile", outPath],
      { signal, maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(readFileSync(outPath, "utf8"));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function makeMinimizeWindow(deps = {}) {
  const {
    tracker = defaultWindowTracker,
    minimizeHwnd = runPowerShellMinimizeWindow,
    invalidateCache = () => listAppProcesses.invalidateCache(),
    log = defaultLog,
  } = deps;

  return async function minimizeWindow(target, opts = {}) {
    const windowId = typeof target === "object" && target !== null ? target.id : String(target);
    const win = tracker.get(windowId);
    if (!win) {
      throw new ActionError("WINDOW_NOT_FOUND", `window "${windowId}" not found`);
    }
    let obs;
    try {
      obs = await minimizeHwnd(win.hwnd, win.pid, opts);
    } catch (err) {
      log.warn("windows.actions.minimize_window_failed", { windowId, message: err?.message ?? String(err) });
      throw new ActionError("MINIMIZE_FAILED", `failed to minimize window "${windowId}"`);
    }
    if (obs?.notFound) {
      tracker.remove(windowId);
      throw new ActionError("WINDOW_NOT_FOUND", `window "${windowId}" not found or closed`);
    }
    if (obs?.minimized !== true) {
      throw new ActionError("MINIMIZE_FAILED", `failed to minimize window "${windowId}"`);
    }
    if (typeof invalidateCache === "function") {
      try { invalidateCache(); } catch {}
    }
    return { ok: true };
  };
}

export const minimizeWindow = makeMinimizeWindow();

// PLAT-12: Fechar é destrutivo. Manda WM_CLOSE e deixa o app abrir seu próprio diálogo.
// NUNCA Stop-Process -Force.
export const PS_CLOSE_WINDOW_SCRIPT = `
param(
  [Parameter(Mandatory = $true)][long]$TargetHwnd,
  [Parameter(Mandatory = $true)][int]$ExpectedPid,
  [Parameter(Mandatory = $true)][string]$OutFile
)
$ErrorActionPreference = 'Stop'
$sig = @"
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
"@
$native = Add-Type -MemberDefinition $sig -Name "DokkeCloseWin$([guid]::NewGuid().ToString('N'))" -Namespace Win32Functions -PassThru

$result = [ordered]@{ notFound = $false; closed = $false }
try {
  $handle = [IntPtr]$TargetHwnd
  if (-not $native::IsWindow($handle)) {
    $result.notFound = $true
  } else {
    $actualPid = [uint32]0
    $native::GetWindowThreadProcessId($handle, [ref]$actualPid) | Out-Null
    if ($actualPid -ne $ExpectedPid) {
      $result.notFound = $true
    } else {
      $WM_CLOSE = 0x0010
      $native::PostMessage($handle, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
      $sw = [System.Diagnostics.Stopwatch]::StartNew()
      $closed = $false
      while ($sw.ElapsedMilliseconds -lt 2000) {
        if (-not $native::IsWindow($handle)) {
          $closed = $true
          break
        }
        Start-Sleep -Milliseconds 50
      }
      $result.closed = $closed
    }
  }
} catch {
  $result.error = $_.Exception.Message
}
$json = $result | ConvertTo-Json -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutFile, $json, $utf8NoBom)
`;

export async function runPowerShellCloseWindow(hwnd, expectedPid, opts = {}) {
  const { signal, exec = execFileAsync } = opts;
  if (process.platform !== "win32") {
    throw new Error(`Windows window close requires win32, got "${process.platform}"`);
  }
  const workDir = mkdtempSync(join(tmpdir(), "decktech-plat12-close-"));
  const scriptPath = join(workDir, "close.ps1");
  const outPath = join(workDir, "close.json");
  writeFileSync(scriptPath, PS_CLOSE_WINDOW_SCRIPT, "utf8");
  try {
    await exec(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath,
        "-TargetHwnd", String(hwnd), "-ExpectedPid", String(expectedPid), "-OutFile", outPath],
      { signal, maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(readFileSync(outPath, "utf8"));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function makeCloseWindow(deps = {}) {
  const {
    tracker = defaultWindowTracker,
    closeHwnd = runPowerShellCloseWindow,
    invalidateCache = () => listAppProcesses.invalidateCache(),
    log = defaultLog,
  } = deps;

  return async function closeWindow(target, opts = {}) {
    const windowId = typeof target === "object" && target !== null ? target.id : String(target);
    const win = tracker.get(windowId);
    if (!win) {
      throw new ActionError("WINDOW_NOT_FOUND", `window "${windowId}" not found`);
    }
    let obs;
    try {
      obs = await closeHwnd(win.hwnd, win.pid, opts);
    } catch (err) {
      log.warn("windows.actions.close_window_failed", { windowId, message: err?.message ?? String(err) });
      throw new ActionError("CLOSE_FAILED", `failed to close window "${windowId}"`);
    }
    if (obs?.notFound) {
      tracker.remove(windowId);
      throw new ActionError("WINDOW_NOT_FOUND", `window "${windowId}" not found or closed`);
    }
    if (obs?.closed !== true) {
      // O app não fechou (ex.: diálogo de confirmação/salvar aberto).
      // NUNCA matar com Stop-Process -Force: o cliente recebe erro tipado.
      throw new ActionError("CLOSE_FAILED", `window "${windowId}" did not close`);
    }
    tracker.remove(windowId);
    if (typeof invalidateCache === "function") {
      try { invalidateCache(); } catch {}
    }
    return { ok: true };
  };
}

export const closeWindow = makeCloseWindow();

export function makeOpenNewWindow(deps = {}) {
  const {
    resolveApps = defaultResolveApps,
    launch = launchAppEntry,
    invalidateCache = () => listAppProcesses.invalidateCache(),
    log = defaultLog,
  } = deps;

  return async function openNewWindow(target, opts = {}) {
    const name = typeof target === "object" && target !== null ? (target.name ?? target.app) : String(target);
    let apps;
    try {
      apps = await resolveApps(opts);
    } catch (err) {
      log.warn("windows.actions.open_new_window.resolve_failed", { name, message: err?.message ?? String(err) });
      throw new ActionError("LAUNCH_FAILED", `could not resolve app catalog while opening "${name}"`);
    }
    const entry = (apps ?? []).find((a) => a?.name === name) ?? null;
    if (!entry) {
      throw new ActionError("APP_NOT_FOUND", `app not found in Windows catalog: "${name}"`);
    }
    try {
      await launch(entry);
    } catch (err) {
      if (err instanceof ActionError) throw err;
      throw new ActionError("LAUNCH_FAILED", `launch failed for "${name}"`);
    }
    if (typeof invalidateCache === "function") {
      try { invalidateCache(); } catch {}
    }
    return { ok: true };
  };
}

export const openNewWindow = makeOpenNewWindow();
