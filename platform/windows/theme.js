// platform/windows/theme.js
//
// PLAT-07 — Windows equivalent of apps.js's readMacIconAppearance
// (apps.js:281-291): the signal that invalidates the Windows iconService's
// appearance-keyed cache (platform/windows/icon.js#makeWindowsIconService's
// `appearanceToken` dep). Matches readMacIconAppearance's OBSERVABLE effect
// (a token string that changes when the OS appearance changes, never
// throws, has a distinct fallback for "couldn't read" vs a real reading) —
// not its mechanism: macOS re-reads on demand behind a 1s TTL
// (apps.js:846-877, MAC_ICON_APPEARANCE_TTL_MS). Windows instead watches
// the registry key event-drivenly via RegNotifyChangeKeyValue, confirmed
// against the Win32 API reference via context7
// (/websites/learn_microsoft_en-us_windows_win32_api, function
// "RegNotifyChangeKeyValue") rather than recalled — a timer-based poll is
// exactly the defect class this project rejects for a tray app that runs
// all day.
//
// No PROOF-* requirement covers this — ROADMAP.md:150 says so explicitly
// ("PLAT-04, PLAT-05, PLAT-07 <- nenhuma dependência da Fase 0"). There is
// therefore no ADR to compose from; the mechanism below is designed here.
//
// Two independent pieces, exported separately so tests can exercise each
// without touching the real registry or spawning a real process:
//   - readWindowsIconAppearance(execFn): one-shot registry read (`reg.exe
//     query`), the literal read-side mirror of readMacIconAppearance.
//   - createWindowsAppearanceTracker(deps): owns the event-driven watch (a
//     persistent `powershell.exe` blocked in RegNotifyChangeKeyValue) and
//     exposes `.token()` (what makeWindowsIconService's `appearanceToken`
//     dep calls), `.start()` and `.stop()`. Nothing here starts a process
//     merely by being constructed — see platform/index.js#win32Platform's
//     comment on why `start()` is never called from the factory today.

import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { log as defaultLog } from "../../log.js";

const execFileAsync = promisify(execFile);

/** Subkey path (relative to HKEY_CURRENT_USER, no "HKCU\" prefix — that's
 * what `[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey` wants) this
 * module watches/reads by default — the literal Windows analog of
 * apps.js:288's `defaults read -g` target, just one key instead of the
 * whole global domain. */
export const THEME_KEY_PATH = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
const THEME_VALUE_NAME = "AppsUseLightTheme";

/**
 * Fallback quando o valor não pôde ser lido de jeito nenhum (reg.exe
 * falhou, chave/valor ausente, etc.) — distinto de um token real, do mesmo
 * jeito que apps.js:295 devolve um token diferente de
 * "icon=default;interface=light" pro seu próprio catch. Quem consome isto
 * (icon.js's resolveAppearanceToken) só usa o valor como parte de uma
 * chave de cache, nunca decide comportamento por ele — um token "unknown"
 * nunca derruba a cadeia de ícone, só nunca compartilha cache com um app
 * claro ou escuro real.
 */
const READ_FAILED_TOKEN = "apps=unknown";

async function defaultExec(cmd, args) {
  return execFileAsync(cmd, args, { windowsHide: true });
}

/**
 * Lê o sinal de aparência via `reg.exe query` — um processo curto que
 * nasce e morre (não o watcher persistente; ver createWindowsAppearanceTracker
 * abaixo). Espelha readMacIconAppearance (apps.js:288-296): nunca lança,
 * usa `execFile` (nunca um shell), então nenhum path/valor passa por
 * expansão de shell — o mesmo motivo do não-negociável #4 do resto do
 * projeto (path.join, nunca separador/escape hardcoded).
 * @param {(cmd: string, args: string[]) => Promise<{stdout: string}>} [execFn]
 * @returns {Promise<string>}
 */
export async function readWindowsIconAppearance(execFn = defaultExec) {
  let stdout;
  try {
    ({ stdout } = await execFn("reg.exe", ["query", `HKCU\\${THEME_KEY_PATH}`, "/v", THEME_VALUE_NAME]));
  } catch {
    // Cobre tanto "chave/valor ausente" (reg.exe sai com código != 0, sem
    // stdout útil) quanto qualquer outra falha de execução — reg.exe não
    // distingue os dois de forma estável o bastante pra separar aqui, e
    // "não consegui ler" é a única coisa que importa pra quem chama isto.
    return READ_FAILED_TOKEN;
  }
  // Formato de saída do reg.exe: "    AppsUseLightTheme    REG_DWORD    0x1"
  const match = stdout.match(/AppsUseLightTheme\s+REG_DWORD\s+0x([0-9a-fA-F]+)/);
  if (!match) return READ_FAILED_TOKEN;
  const value = parseInt(match[1], 16);
  // 1 = tema claro pros apps, 0 = escuro. Convenção amplamente documentada
  // (fora, porém, da referência oficial do Win32 API consultada via
  // context7 nesta tarefa — ver unresolved[] no relatório) e VERIFICADA
  // empiricamente nesta máquina antes de codar: `AppsUseLightTheme` e
  // `SystemUsesLightTheme` lidos ao vivo, ambos 0, nesta sessão real
  // (que está, de fato, em modo escuro).
  return value === 0 ? "apps=dark" : "apps=light";
}

// Linha "CHANGED" — o watcher nunca imprime texto localizado (nomes de
// app, etc.), então o cuidado de codificação de platform/windows/apps.js's
// PS_SCRIPT (escrever em arquivo UTF-8 sem BOM em vez de stdout, por causa
// da codepage do console pt-BR corromper acentos) não se aplica aqui: uma
// linha ASCII pura nunca é afetada por codepage.
const CHANGED_LINE = "CHANGED";
const KEY_MISSING_LINE = "KEY_MISSING";

/**
 * Script PowerShell do watcher: abre a chave uma vez, então chama
 * RegNotifyChangeKeyValue em loop SÍNCRONO (fAsynchronous=$false,
 * hEvent=[IntPtr]::Zero) — a chamada BLOQUEIA esta thread no kernel até a
 * próxima mudança, sem laço de sleep/poll em user-mode nenhum. "After
 * receiving a notification event, the caller should call the function
 * again to receive the next notification" (doc consultado via context7) —
 * é exatamente o loop abaixo, reusando o MESMO handle de chave aberto uma
 * vez só.
 */
const WATCH_SCRIPT = `
param(
  [Parameter(Mandatory = $true)][string]$KeyPath
)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace DokkePlat07 -Name RegWatch -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("advapi32.dll", SetLastError = true)]
public static extern int RegNotifyChangeKeyValue(
  Microsoft.Win32.SafeHandles.SafeRegistryHandle hKey,
  bool bWatchSubtree,
  int dwNotifyFilter,
  System.IntPtr hEvent,
  bool fAsynchronous);
'@

$REG_NOTIFY_CHANGE_NAME = 0x00000001
$REG_NOTIFY_CHANGE_LAST_SET = 0x00000004
$filter = $REG_NOTIFY_CHANGE_NAME -bor $REG_NOTIFY_CHANGE_LAST_SET

$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($KeyPath, $false)
if ($null -eq $key) {
  Write-Output "${KEY_MISSING_LINE}"
  exit 1
}
try {
  while ($true) {
    $result = [DokkePlat07.RegWatch]::RegNotifyChangeKeyValue($key.Handle, $false, $filter, [IntPtr]::Zero, $false)
    if ($result -ne 0) {
      Write-Output "WATCH_ERROR:$result"
      exit 1
    }
    Write-Output "${CHANGED_LINE}"
    [Console]::Out.Flush()
  }
} finally {
  $key.Close()
}
`;

/**
 * Spawna o watcher real: um único `powershell.exe` de vida longa (não o
 * "pool por chamada" que docs/adr/0001-proof-01-windows-icon-bridge.md
 * rejeitou — aquilo era um processo NOVO por extração de ícone; isto é UM
 * processo, criado uma vez, vivo pela vida útil do tracker). Escreve o
 * script num diretório mkdtemp com espaço no nome (não-negociável #4) e
 * passa o path via `-File`, nunca via `-Command` com o script inline
 * (evita qualquer risco de escaping).
 * @param {string} keyPath
 * @param {{onChange: () => void, onExit: (code: number|null) => void, spawnFn?: typeof spawn}} handlers
 * @returns {import("node:child_process").ChildProcess}
 */
export function startThemeWatcher(keyPath, { onChange, onExit, spawnFn = spawn }) {
  const workDir = mkdtempSync(join(tmpdir(), "decktech-plat07 watch-"));
  const scriptPath = join(workDir, "watch-theme.ps1");
  writeFileSync(scriptPath, WATCH_SCRIPT, "utf8");

  const child = spawnFn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-KeyPath", keyPath],
    { windowsHide: true },
  );

  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line === CHANGED_LINE) onChange();
    }
  });
  child.on("exit", (code) => {
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    onExit(code);
  });

  return child;
}

/**
 * Dono do watch persistente e do cache de token que ele invalida. Nada
 * aqui spawna processo na CONSTRUÇÃO — só `start()` faz isso,
 * explicitamente. `createPlatform("win32")` não tem chamador de produção
 * hoje (grep confirma: só test/*.mjs) — o caso "PLAT-07 emite um sinal que
 * ainda ninguém consome" que ROADMAP.md:167 pré-declara como esperado, não
 * defeito. Por isso platform/index.js#win32Platform() CONSTRÓI o tracker
 * mas nunca chama start(): sem isso, todo teste que chama
 * createPlatform("win32") nesta máquina Windows real spawnaria um
 * powershell.exe de verdade como efeito colateral de construção —
 * exatamente a classe de processo órfão que este projeto rejeita (ver
 * comentário de createIconQueue em icon.js). `.token()` funciona mesmo sem
 * start() ter sido chamado (lê sob demanda, uma vez, e fica com esse valor
 * até start() ligar o watch de verdade) — nunca cai pra um poll por TTL
 * como fallback.
 * @param {object} [deps]
 * @param {() => Promise<string>} [deps.read]
 * @param {string} [deps.keyPath]
 * @param {typeof startThemeWatcher} [deps.startWatcher]
 * @param {{debug: Function, warn: Function}} [deps.log]
 */
export function createWindowsAppearanceTracker(deps = {}) {
  const {
    read = readWindowsIconAppearance,
    keyPath = THEME_KEY_PATH,
    startWatcher = startThemeWatcher,
    log = defaultLog,
  } = deps;

  let cached = null; // string | null — null = precisa reler
  let inflight = null;
  let child = null;
  let stopped = false;

  function ensureToken() {
    if (cached !== null) return Promise.resolve(cached);
    if (inflight) return inflight;
    inflight = Promise.resolve()
      .then(() => read())
      .then(token => {
        cached = token;
        inflight = null;
        return token;
      })
      .catch(() => {
        inflight = null;
        return READ_FAILED_TOKEN;
      });
    return inflight;
  }

  return {
    /** @returns {Promise<string>} */
    token: () => ensureToken(),
    /**
     * Liga o watch persistente — idempotente (uma segunda chamada com um
     * processo já de pé é no-op). Nunca chamado por padrão pela fábrica de
     * plataforma — ver JSDoc da função acima.
     */
    start() {
      if (child || stopped) return;
      child = startWatcher(keyPath, {
        onChange: () => {
          // Nunca infere o token novo do próprio evento — o evento só diz
          // "algo mudou sob esta chave" (qualquer valor, não só
          // AppsUseLightTheme; RegNotifyChangeKeyValue não filtra por
          // nome de valor). Quem decide o token novo é sempre `read()` na
          // PRÓXIMA chamada de token() — mesmo espírito de
          // resolveAppearanceToken em apps.js, que relê TUDO de `defaults
          // -g` em qualquer mudança em vez de tentar interpretar o
          // evento.
          cached = null;
          log.debug("icon.win.theme_changed", {});
        },
        onExit: (code) => {
          // Sem auto-restart: um watcher morto deixa o token
          // potencialmente atrasado (não errado — só não mais
          // event-driven) até o próximo start(). Reiniciar sozinho aqui
          // arriscaria um crash-loop se o motivo da morte for
          // persistente (ex.: powershell.exe removido/bloqueado por
          // política) — um defeito pior que um token atrasado. KNOWN
          // GAP, não fechado aqui, mesmo padrão de disclosure do resto do
          // arquivo (ver comentários "Round-2/3/4" em icon.js).
          log.warn("icon.win.theme_watch_exited", { code });
          child = null;
        },
      });
    },
    /** Mata o watcher, se algum estiver de pé, e marca o tracker como
     * parado (start() depois de stop() é no-op — sem essa trava, um
     * consumidor que chama stop() por engano duas vezes ou depois de um
     * exit espontâneo poderia religar um processo que achava estar
     * morto). */
    stop() {
      stopped = true;
      if (child) { child.kill(); child = null; }
    },
    // Exposto só pra teste (prova de "sem processo órfão" — mesmo padrão
    // de `_queue` em icon.js).
    _debugChildPid: () => child?.pid ?? null,
  };
}
