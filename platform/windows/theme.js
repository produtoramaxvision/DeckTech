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
//     merely by being CONSTRUCTED (createWindowsAppearanceTracker() itself
//     stays free of side effects) — but `.token()` DOES lazily start the
//     watcher on its own first call (Round-2 finding 1). Before this round,
//     platform/index.js#win32Platform() built the tracker but never called
//     `.start()` and never exposed it past construction, so the token was
//     structurally incapable of ever changing — the wired appearanceToken
//     stayed frozen at whatever the first read returned, and a real
//     AppsUseLightTheme flip never invalidated platform/windows/icon.js's
//     cache. Lazy-start on first `.token()` call fixes that without adding
//     a construction-time side effect: the watcher only spins up once
//     something (icon.js's resolveAppearanceToken, called from
//     getIconPng) actually asks for a token, exactly the same "constructed
//     cheap, active on demand" shape this file already had — see
//     ensureToken() below.

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

  // Round-2 finding 2: a spawn failure (powershell.exe missing, blocked by
  // policy — the exact scenario the JSDoc above and onExit's own comment
  // already cite) emits 'error', not 'exit' — confirmed against the
  // official Node.js child_process reference via context7 (/nodejs/node,
  // "Handling failed spawn errors with child_process.spawn": "Listens for
  // the 'error' event ... to detect when a command fails to spawn"), not
  // recalled. Without a listener that 'error' is unhandled and crashes the
  // whole process — the crash landed here BEFORE this fix, reproduced with
  // a scratch script swapping spawnFn for a non-existent binary (see
  // discrimination_proof). 'error' and 'exit' are not guaranteed mutually
  // exclusive by Node's own docs, so `settled` makes cleanup + onExit fire
  // exactly once no matter which one (or both) arrive.
  let settled = false;
  function settle(code) {
    if (settled) return;
    settled = true;
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    onExit(code);
  }
  child.on("error", () => {
    // Same "no auto-restart" posture as a normal exit (see onExit's own
    // comment in createWindowsAppearanceTracker below) — a process that
    // never spawned has no exit code, so `code` is null, the same shape
    // JSDoc already documents for onExit (`code: number|null`).
    settle(null);
  });
  child.on("exit", (code) => {
    settle(code);
  });

  return child;
}

/**
 * Dono do watch persistente e do cache de token que ele invalida. Nada
 * aqui spawna processo na CONSTRUÇÃO — só `start()` faz isso (chamado
 * explicitamente, OU preguiçosamente pela primeira chamada de `.token()` —
 * ver `ensureToken()`/`maybeAutoStart()` abaixo, Round-2 finding 1).
 * `createWindowsAppearanceTracker()` sozinho continua barato e sem efeito
 * colateral (nenhum powershell.exe nasce só de CONSTRUIR o tracker —
 * platform/index.js#win32Platform() ainda depende disso pra não spawnar um
 * processo real toda vez que `createPlatform("win32")` roda numa suite de
 * teste). O que mudou nesta rodada: antes, `.token()` sozinho NUNCA ligava
 * o watch — só um `.start()` explícito fazia isso, e platform/index.js não
 * tinha (nem tem, propositalmente — ver seu próprio comentário) um
 * consumidor que chamasse `.start()`. Resultado: o token ficava congelado
 * pra sempre no valor da primeira leitura, e um AppsUseLightTheme real
 * nunca invalidava o cache de ícone (achado do Round-2). Agora a PRIMEIRA
 * chamada de `.token()` (não a construção) também liga o watch — o
 * primeiro consumidor real (icon.js's resolveAppearanceToken, chamado de
 * getIconPng) já é, por construção, o gatilho certo: só liga o processo
 * quando alguém de fato pede um token, nunca antes disso.
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
  let autoStartAttempted = false; // trava o lazy-start pra rodar no máximo 1x
  // Round-3 finding 1: contador de geração. onWatcherChange() incrementa
  // isto no MESMO instante em que zera `cached` (ver abaixo). Uma leitura
  // já em voo captura a geração vigente em `startedAt` antes de começar;
  // se uma invalidação chegar enquanto ela ainda está no ar, a geração
  // global avança e o `.then` de sucesso, ao terminar, percebe que sua
  // geração ficou velha e DESCARTA o resultado em vez de escrevê-lo em
  // `cached` — sem isto, o valor pré-mudança que essa leitura já tinha em
  // mãos sobrescrevia a invalidação, e o token ficava errado até a
  // PRÓXIMA mudança de tema (nenhum TTL por trás pra se autocurar, ao
  // contrário do MAC_ICON_APPEARANCE_TTL_MS de apps.js). O braço de erro
  // (`.catch()` abaixo) já não escreve em `cached`, então só o braço de
  // sucesso precisa da guarda.
  let generation = 0;

  function ensureToken() {
    maybeAutoStart();
    if (cached !== null) return Promise.resolve(cached);
    if (inflight) return inflight;
    const startedAt = generation;
    inflight = Promise.resolve()
      .then(() => read())
      .then(token => {
        if (generation === startedAt) cached = token;
        inflight = null;
        return token;
      })
      .catch(() => {
        inflight = null;
        return READ_FAILED_TOKEN;
      });
    return inflight;
  }

  /**
   * Round-2 finding 1: dispara na PRIMEIRA `.token()` — não na construção
   * do tracker (deixaria de ser "barato por construção") nem a cada
   * chamada (start() já é idempotente, mas não há motivo pra pagar a
   * checagem de novo sempre enquanto o watcher segue de pé). Normalmente
   * roda só uma vez na vida do tracker, mas `autoStartAttempted` pode
   * voltar pra false por `onWatcherExit` depois de uma morte espontânea
   * do watcher (ver seu comentário) — então uma PRÓXIMA `.token()` depois
   * disso re-arma o lazy-start, não fica travada pra sempre. `token()`
   * nunca pode lançar por causa disto: `startInternal()` (chamada abaixo)
   * já embrulha qualquer exceção SÍNCRONA de `startWatcher`
   * (mkdtempSync/writeFileSync podem lançar — ex.: %TEMP% sem permissão de
   * escrita) — aqui só existe pra documentar QUANDO o gatilho dispara, não
   * pra tratar erro de novo.
   */
  function maybeAutoStart() {
    if (autoStartAttempted || stopped) return;
    autoStartAttempted = true;
    startInternal();
  }

  function onWatcherChange() {
    // Nunca infere o token novo do próprio evento — o evento só diz "algo
    // mudou sob esta chave" (qualquer valor, não só AppsUseLightTheme;
    // RegNotifyChangeKeyValue não filtra por nome de valor). Quem decide o
    // token novo é sempre `read()` na PRÓXIMA chamada de token() — mesmo
    // espírito de resolveAppearanceToken em apps.js, que relê TUDO de
    // `defaults -g` em qualquer mudança em vez de tentar interpretar o
    // evento.
    cached = null;
    generation++; // Round-3 finding 1: descarta qualquer leitura já em voo (ver `generation` acima)
    log.debug("icon.win.theme_changed", {});
  }

  function onWatcherExit(code) {
    // Sem auto-restart IMEDIATO: nada aqui religa o watcher síncrono/na
    // hora — reiniciar sozinho DENTRO deste handler arriscaria um
    // crash-loop se o motivo da morte for persistente (ex.: powershell.exe
    // removido/bloqueado por política) — um defeito pior que um token
    // atrasado. Mas `autoStartAttempted` VOLTA pra false aqui (revisão do
    // Round-2: a primeira versão desta correção deixava o lazy-trigger
    // consumido pra sempre depois de qualquer morte do watcher — mesma
    // forma estrutural do bug original, "gatilho de disparo único que
    // nunca reabre", só que documentado como gap em vez de corrigido).
    // Sem isso, um watcher que morre uma vez (ex.: powershell.exe
    // temporariamente bloqueado por política, depois liberado) deixaria o
    // token congelado pro resto da vida do tracker, mesmo com token()
    // continuando a ser chamado — nenhum start() explícito existe na
    // wiring de produção pra reabrir. Resetar `autoStartAttempted` faz a
    // PRÓXIMA chamada de token() tentar `startInternal()` de novo — não é
    // polling (só tenta quando ALGUÉM já ia chamar token() de qualquer
    // jeito) nem reinício imediato (`child || stopped` em startInternal()
    // já impede um segundo processo enquanto o antigo ainda existisse, e
    // `stopped` continua bloqueando reabertura depois de um stop()
    // intencional).
    log.warn("icon.win.theme_watch_exited", { code });
    child = null;
    autoStartAttempted = false;
  }

  /**
   * Liga o watch persistente — idempotente (uma segunda chamada com um
   * processo já de pé, ou depois de stop(), é no-op). Chamado tanto pelo
   * `.start()` explícito abaixo quanto pelo lazy-start de `maybeAutoStart()`.
   * `startWatcher` pode lançar SINCRONAMENTE (mkdtempSync/writeFileSync —
   * ex.: diretório temp sem permissão de escrita); sem o try/catch aqui,
   * essa exceção subiria através de `.token()` e viraria um 500 em vez de
   * um ícone servido (icon.js:312 faz `String(await appearanceToken())`
   * sem try/catch próprio) — degrada pra "leitura avulsa, não mais
   * event-driven" em vez de derrubar o chamador, mesma postura de
   * onWatcherExit's "sem auto-restart" pra uma morte assíncrona.
   */
  function startInternal() {
    if (child || stopped) return;
    try {
      child = startWatcher(keyPath, { onChange: onWatcherChange, onExit: onWatcherExit });
    } catch (err) {
      log.warn("icon.win.theme_watch_start_failed", { message: err?.message ?? String(err) });
    }
  }

  return {
    /** @returns {Promise<string>} */
    token: () => ensureToken(),
    /**
     * Liga o watch persistente — idempotente (uma segunda chamada com um
     * processo já de pé é no-op). Chamado explicitamente por quem quiser
     * o watch de pé sem esperar a primeira `.token()`, OU implicitamente
     * pela primeira `.token()` via `maybeAutoStart()` acima.
     */
    start() {
      autoStartAttempted = true; // start() explícito também consome o lazy-trigger
      startInternal();
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
