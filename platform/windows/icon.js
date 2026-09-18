// platform/windows/icon.js
//
// PLAT-03 + PLAT-09 — Windows `iconService` provider behind the Fase 2
// contract (platform/index.js#win32Platform). Extracts a real 256x256 PNG
// per app, with a persistent (survives restart) disk cache, mtime-based
// invalidation and a cancellable extraction queue.
//
// Composes, without re-deriving, what Fase 0 already measured and decided
// (docs/adr/0001-proof-01-windows-icon-bridge.md):
//   - N-API addon wins over koffi and the PowerShell pool. The addon here
//     (platform/windows/native/icon-addon/icon_addon.cc) is byte-identical
//     to the one the ADR's benchmark measured
//     (measure/windows/icon-bench/addon-icon/icon_addon.cc) — copied, not
//     rewritten, so this module never re-litigates that decision. It is
//     built separately under platform/windows/native/icon-addon/build
//     (see package.json's "windows:build-icon-addon" script) so production
//     code does not depend on measure/'s gitignored build output.
//   - `extractIconBgra(path, size)` calls IShellItemImageFactory::GetImage,
//     confirmed on this machine: 20/20 success at 256x256, ~43.2 ms/icon
//     (ADR "Resultados medidos"). It is a SYNCHRONOUS, in-process call —
//     there is no child process to leak, but a naive loop over N apps would
//     still block the Node event loop for N*~43ms. That is why every call
//     here goes through `queue` (bounded concurrency) instead of being
//     awaited directly in series.
//   - ADR "Consequências", path contract: the addon normalizes via
//     GetFullPathNameW but does NOT expand `%VAR%`, strip surrounding
//     quotes, or strip a trailing `,<icon-index>` suffix — all three are
//     shapes a Windows registry `DisplayIcon` value can carry.
//     `prepareIconSourcePath` below does that normalization BEFORE the path
//     reaches the addon, closing the gap the ADR documents but explicitly
//     leaves undone (it is PLAT-03's job, not PROOF-01's).
//
// Known, explicit gap (not silently swallowed): the addon's internal
// GetFullPathNameW call corrupts a `shell:AppsFolder\<AUMID>` string (it is
// not a filesystem path), so `extractIconBgra` returns E_INVALIDARG for it
// — confirmed empirically against a real UWP AUMID
// (Microsoft.WindowsCalculator_8wekyb3d8bbwe!App) on this machine, not
// assumed. UWP-kind apps (platform/windows/apps.js's `kind: "uwp"`)
// therefore get no real icon from this service yet and fall back to the
// existing client-side monogram (same 404-then-fallback path the client
// already uses for any app with no icon, see public/index.html's
// `iconImg.src = fallback`). Fixing that is a resolvable but separate
// problem (parsing the shell:AppsFolder item without the addon's own
// normalization step) and is out of scope for PLAT-03+09.
//
// Shape mirrors `realIconService` (apps.js:569-739) deliberately: mem PNG
// LRU, on-disk PNG cache, an in-flight dedupe map keyed by cache key, and a
// TTL-cached app resolver — the same obligations PLAT-09 asks for, applied
// to the one part of the pipeline (concurrency + cancellation) that the
// macOS provider never needed because it has no equivalent 43ms-per-call
// synchronous native cost to bound.

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { log as defaultLog } from "../../log.js";
import { pruneIconCache } from "../../apps.js";
// Reused directly from measure/, same precedent platform/windows/apps.js's
// own header comment already documents for PLAT-02/10: these are pure,
// already-verified functions with no I/O and no measure/-only behavior
// (RGBA -> PNG encoding, BGRA -> RGBA channel swap). Re-copying them here
// would only create a second copy of PROOF-01-verified code to keep in
// sync — see that file's header comment for the full argument.
import { bgraToRgba, encodePng } from "../../measure/windows/icon-bench/lib/png.mjs";

const require = createRequire(import.meta.url);

/** 256x256 — the size ADR-0001 measured and PLAT-03's success criteria require. */
export const WIN_ICON_MAX_PX = 256;
/** Same on-disk cache root the macOS provider uses (apps.js's ICON_CACHE_DIR,
 * not exported there) — one gitignored `.icon-cache/` directory at repo
 * root, not a second one this module would need its own .gitignore entry
 * for. Windows PNGs are namespaced with a `win-` filename prefix so the two
 * providers' cache files are trivially distinguishable on disk even though
 * only one platform's provider ever runs in a given process. */
export const WIN_ICON_CACHE_DIR = join(import.meta.dirname, "..", "..", ".icon-cache");
/** Cap of concurrently in-flight native extractions. Bounded so a 122-icon
 * load costs at most ~4*43ms of "extra" work after cancellation, not
 * 122*43ms — see `PLAT-03: cancelamento` tests for the measured proof. */
export const WIN_ICON_CONCURRENCY = 4;
/** Cap of files kept in the on-disk PNG cache (mirrors apps.js's DISK_PNG_MAX). */
export const WIN_DISK_PNG_MAX = 256;
/** Cap of PNGs kept in the in-memory LRU (mirrors apps.js's MEM_PNG_MAX). */
export const WIN_MEM_PNG_MAX = 40;
/** TTL of the app inventory used to resolve name -> path (mirrors apps.js's
 * INSTALLED_APPS_TTL_MS); `win32ListInstalledApps` already TTL-caches
 * internally, this is a second, independent layer — same double-layering
 * `realIconService` already has around `listInstalledApps` in apps.js. */
export const WIN_ICON_APPS_TTL_MS = 120_000;

const DEFAULT_ADDON_PATH = join(import.meta.dirname, "native", "icon-addon", "build", "Release", "iconaddon.node");

/**
 * Erro tipado — mesmo formato `{code, error}` de WindowsAppScanError
 * (platform/windows/apps.js) e PlatformNotImplementedError
 * (platform/index.js). Lançado só quando o addon nativo não foi
 * compilado ainda (`pnpm run windows:build-icon-addon`), nunca escondido
 * atrás de um ícone genérico silencioso.
 */
export class WindowsIconAddonError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WindowsIconAddonError";
    this.code = code;
  }
}

/**
 * Round-2 finding 1+4 (code review): a queue item skipped because its
 * (shared) signal was already aborted is NOT the same outcome as "this app
 * genuinely has no icon" — conflating the two made `getIconPng` write an
 * aborted load into `memMiss`, so a fresh, never-aborted request for the
 * same app returned HTTP 404 for up to `WIN_ICON_APPS_TTL_MS` after any
 * navigate-away. This sentinel makes the distinction explicit end to end
 * (`createIconQueue` -> `loadPng` -> `getIconPng`) instead of inferring it
 * from a bare `null`, which is exactly the kind of implicit coupling that
 * produced the bug in the first place.
 */
const ICON_LOAD_ABORTED = Symbol("icon-load-aborted");

let cachedAddon = null;
/** Lazily requires + memoizes the native addon. Not called at module load
 * time: importing this file on a machine without the addon built yet (e.g.
 * CI running the cross-platform tests with an injected `extract`) must not
 * throw. */
function loadNativeAddon(addonPath) {
  if (cachedAddon) return cachedAddon;
  try {
    cachedAddon = require(addonPath);
  } catch (err) {
    throw new WindowsIconAddonError(
      "ICON_ADDON_MISSING",
      `platform/windows/icon.js: addon nativo não encontrado em ${addonPath} — rode "pnpm run windows:build-icon-addon" (requer VS Build Tools 2022 + componente C++ x64 e Python, ver docs/adr/0001-proof-01-windows-icon-bridge.md). Causa original: ${err?.message ?? err}`,
    );
  }
  return cachedAddon;
}

/**
 * Normaliza um path de origem ANTES de chegar no addon — fecha o gap que o
 * ADR-0001 documenta e deixa explicitamente por fazer ("Consequências"):
 * o addon expande '/' -> '\' e resolve '.'/'..' via GetFullPathNameW, mas
 * NÃO expande `%VAR%` nem remove aspas/sufixo `,<índice>` de valores de
 * registro DisplayIcon. `.lnk`-derived targets (o único `kind` suportado
 * hoje — ver comentário de topo sobre UWP) já costumam vir limpos, mas
 * tratar aqui é barato e evita um bug futuro silencioso caso uma fonte de
 * app baseada em registro seja adicionada depois.
 * @param {{kind?: string, path?: string}} app
 * @returns {string|null} path pronto pro addon, ou null se este `kind` não
 *   tem um path de arquivo real (hoje: qualquer coisa != "win32").
 */
export function prepareIconSourcePath(app) {
  if (!app || app.kind !== "win32" || typeof app.path !== "string") return null;
  let p = app.path.trim();
  if (!p) return null;

  // Sufixo de índice de ícone de registro, ex.: `"C:\...\app.exe,0"` ou
  // `"C:\...\app.exe,-14"`. Só corta se o que sobra depois da última
  // vírgula for inteiro puro — nunca corta uma vírgula que faz parte do
  // próprio path (não é comum em Windows, mas não é impossível).
  const commaIdx = p.lastIndexOf(",");
  if (commaIdx > 0 && /^-?\d+$/.test(p.slice(commaIdx + 1).trim())) {
    p = p.slice(0, commaIdx).trim();
  }

  // Aspas envolventes.
  if (p.length >= 2 && p[0] === '"' && p[p.length - 1] === '"') {
    p = p.slice(1, -1).trim();
  }

  // Variáveis de ambiente `%VAR%`. Uma variável desconhecida vira ela
  // mesma sem expansão (mesmo comportamento de cmd.exe quando a variável
  // não existe) em vez de virar string vazia — não inventa um path.
  p = p.replace(/%([^%]+)%/g, (whole, varName) => (varName in process.env ? process.env[varName] : whole));

  return p.trim() || null;
}

function lruSet(map, key, value, max) {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

/**
 * Fila com concorrência limitada e cancelamento cooperativo — a peça que
 * PLAT-03 precisa e que os providers síncronos/single-call (darwin) nunca
 * tiveram motivo pra ter. Um item cujo `signal` já está `aborted` quando a
 * fila for tirá-lo da espera NUNCA chama `run()` — é isso que faz uma carga
 * de 122 ícones abandonada parar de fazer trabalho de verdade, em vez de só
 * não ter processo externo pra matar (que seria verdade mesmo sem fila
 * nenhuma, dado que o addon é in-process — ver comentário de topo do
 * arquivo e o teste "PLAT-03: cancelamento" para a prova real).
 */
function createIconQueue(concurrency) {
  let active = 0;
  const pending = [];

  function pump() {
    while (active < concurrency && pending.length > 0) {
      const task = pending.shift();
      if (task.signal?.aborted) {
        // Round-2 finding 1+4: sentinela explícita, nunca `null` — `null`
        // é (e precisa continuar sendo) um resultado legítimo e distinto
        // de "abortado" em outras camadas; inferir abort de um `null`
        // implícito foi exatamente o que gravou cancelamentos no
        // `memMiss` como se fossem "app sem ícone" (ver icon.js:loadPng).
        task.resolve(ICON_LOAD_ABORTED);
        continue;
      }
      active++;
      // setImmediate, não Promise.resolve().then(): um addon síncrono
      // bloqueia a thread por ~43ms por chamada, e se cada item da fila só
      // encadear via microtask, os 122 itens drenam numa única "avalanche"
      // de microtasks ANTES do event loop voltar pra fase de I/O — que é
      // exatamente onde o 'close' do request HTTP (o gatilho real de
      // abort()) seria despachado. Sem este yield, abort() nunca teria
      // chance de rodar a tempo de impedir os itens ainda não iniciados,
      // tornando o "cancelamento" real inobservável mesmo com o check
      // `task.signal?.aborted` presente. Descoberto escrevendo o teste de
      // discriminação (ver "PLAT-03: cancelamento"), não por inspeção.
      setImmediate(() => {
        Promise.resolve()
          .then(() => (task.signal?.aborted ? ICON_LOAD_ABORTED : task.run()))
          .then(
            value => { active--; task.resolve(value); pump(); },
            err => { active--; task.reject(err); pump(); },
          );
      });
    }
  }

  function enqueue(run, signal) {
    return new Promise((resolve, reject) => {
      pending.push({ run, signal, resolve, reject });
      pump();
    });
  }

  return { enqueue, get pendingCount() { return pending.length; }, get activeCount() { return active; } };
}

/**
 * Fábrica do iconService Windows (PLAT-03 + PLAT-09).
 * @param {object} [deps]
 * @param {() => Promise<Array<{name:string, path:string, kind:string}>>} [deps.scan]
 *   Default: `platform/windows/apps.js`'s bound `listInstalledApps`
 *   (importado por quem chama esta fábrica — ver platform/index.js — pra
 *   não criar um import circular entre apps.js e icon.js).
 * @param {(path: string, size: number) => Buffer} [deps.extract] Default:
 *   `addon.extractIconBgra`, carregado sob demanda. Injetável em teste pra
 *   rodar em qualquer SO e pra controlar timing/contagem determinística.
 * @param {string} [deps.addonPath]
 * @param {string} [deps.cacheDir]
 * @param {number} [deps.ttlMs]
 * @param {number} [deps.memMax]
 * @param {number} [deps.diskMax]
 * @param {number} [deps.maxPx]
 * @param {number} [deps.concurrency]
 * @param {(dir: string, max: number) => Promise<void>} [deps.pruneCache]
 * @param {typeof import("node:fs/promises")} [deps.fs]
 * @param {() => number} [deps.now]
 * @param {{debug: Function, warn: Function}} [deps.log]
 */
export function makeWindowsIconService(deps = {}) {
  const {
    scan,
    extract,
    addonPath = DEFAULT_ADDON_PATH,
    cacheDir = WIN_ICON_CACHE_DIR,
    ttlMs = WIN_ICON_APPS_TTL_MS,
    memMax = WIN_MEM_PNG_MAX,
    diskMax = WIN_DISK_PNG_MAX,
    maxPx = WIN_ICON_MAX_PX,
    concurrency = WIN_ICON_CONCURRENCY,
    pruneCache = pruneIconCache,
    fs = { readFile, writeFile, mkdir, stat, unlink, readdir },
    now = () => Date.now(),
    log = defaultLog,
    // Só pra observabilidade de teste — nunca chamado em produção real
    // além de contabilizar. Ver "PLAT-03: cancelamento".
    onExtractStart,
  } = deps;

  if (typeof scan !== "function") {
    throw new TypeError("makeWindowsIconService: deps.scan é obrigatório (função async () => apps[])");
  }

  const extractFn = extract ?? ((sourcePath, size) => loadNativeAddon(addonPath).extractIconBgra(sourcePath, size));
  const queue = createIconQueue(concurrency);

  let appsByName = null;
  let appsAt = 0;
  let scanInflight = null;
  const memPng = new Map();
  const memMiss = new Set();
  const loadInflight = new Map();

  /**
   * Round-3 finding 1 (code review, REJECTED): round-2's fix here — passing
   * THIS caller's HTTP signal straight into `scan({ signal })` — was
   * reverted. It looked safe (the 30-line JSDoc it replaced argued exactly
   * that) but was proven wrong by decisive isolation: `scan` is the SAME
   * singleton instance as `win32ListInstalledApps` (platform/index.js
   * `win32Platform`: `listInstalledApps: win32ListInstalledApps` AND
   * `iconService: makeIconService({ scan: win32ListInstalledApps })`), and
   * that singleton (platform/windows/apps.js#listInstalledApps) shares ONE
   * `cache.promise` across every caller regardless of whose signal drove
   * it (`if (cache.promise) return cache.promise;` — first caller in wins,
   * everyone else just joins). So one icon request's navigate-away while
   * the shared scan is cold/in-flight aborted the PowerShell collect
   * (`WindowsAppScanError("ABORTED")`) and that rejection propagated to
   * every OTHER caller joined on the same `cache.promise` — a concurrent,
   * never-aborted icon request (the round-2 `getIconPng` catch back then
   * swallowed it into a misleading 404) AND `GET /api/apps/installed`
   * (collapsed into the generic, untyped 500 from `fail()` — apps.js has
   * no `ABORTED` entry in `ACTION_ERROR_MESSAGES`). Reproduced end to end
   * with the real modules, a real `startServer`, and the real
   * `platform/index.js` wiring; see test/windows-icon-service.test.mjs's
   * round-3 finding 1 regression test.
   *
   * KNOWN GAP, not closed: `scan()` is called here with no signal at all,
   * same as before round-2 finding 5. A genuinely abandoned page load can
   * still leave the underlying PowerShell scan running to completion
   * instead of being killed early — round-2 already classified that as
   * non-critical (the child is self-terminating and TTL-cached, nothing
   * stays orphaned indefinitely; PLAT-03's cancellation guarantee for
   * icon EXTRACTION, the 122-icon queue, is unaffected and still enforced
   * below via `queue`/`loadInflight`). Fixing the scan-level cancellation
   * properly needs `listInstalledApps`'s own `cache.promise` to track
   * per-caller signals/refcounts (the same shape as `loadInflight`'s
   * finding-2 fix a few lines down) — that lives in apps.js, is PLAT-02
   * territory, and is out of scope for this ticket (PLAT-03+09).
   */
  async function resolveApps() {
    const nowMs = now();
    if (appsByName && nowMs - appsAt < ttlMs) return appsByName;
    if (scanInflight) return scanInflight;
    scanInflight = Promise.resolve()
      .then(() => scan())
      .then(apps => {
        const m = new Map();
        for (const a of apps) m.set(a.name, a);
        appsByName = m;
        appsAt = now();
        scanInflight = null;
        memMiss.clear();
        return m;
      })
      .catch(err => {
        scanInflight = null;
        throw err;
      });
    return scanInflight;
  }

  /**
   * @returns {Promise<Buffer|null|typeof ICON_LOAD_ABORTED>} Um PNG real em
   *   sucesso; `null` SÓ pra uma falha de extração GENUÍNA por app (ex.:
   *   E_INVALIDARG) — a única forma segura de gravar em `memMiss`;
   *   `ICON_LOAD_ABORTED` quando o item foi pulado porque o `signal`
   *   COMPARTILHADO já estava abortado (round-2 finding 1: nunca deve
   *   virar `memMiss`, ou uma requisição fresca e nunca abortada pro
   *   mesmo app volta 404 por até WIN_ICON_APPS_TTL_MS). Rejeita com
   *   `WindowsIconAddonError` quando o addon nativo em si não está
   *   disponível — falha de configuração do processo inteiro, nunca
   *   escondida atrás de um "app não encontrado" por app (round-2
   *   finding 3).
   */
  async function loadPng(name, sourcePath, cacheKey, signal) {
    const diskPath = join(cacheDir, `win-${cacheKey}-z${maxPx}.png`);

    try {
      const cached = await fs.readFile(diskPath);
      log.debug("icon.win.cache_hit", { name, source: "disk" });
      return cached;
    } catch { /* miss, segue pra extração */ }

    if (signal?.aborted) {
      log.debug("icon.win.extract_skipped_aborted", { name });
      return ICON_LOAD_ABORTED;
    }

    let buf;
    try {
      buf = await queue.enqueue(async () => {
        onExtractStart?.(name);
        const bgra = extractFn(sourcePath, maxPx);
        const rgba = bgraToRgba(bgra);
        return encodePng(rgba, maxPx, maxPx);
      }, signal);
    } catch (err) {
      if (err instanceof WindowsIconAddonError) {
        // Round-2 finding 3: isto não é "este app não tem ícone" — é o
        // addon nativo inteiro faltando pro PROCESSO. Propaga em vez de
        // virar buf=null (que o catch de baixo transformaria em 404
        // idêntico ao de um app sem ícone, escondendo exatamente o que o
        // JSDoc de WindowsIconAddonError promete nunca esconder).
        log.warn("icon.win.extract_addon_missing", { name, code: err.code, message: err.message });
        throw err;
      }
      log.warn("icon.win.extract_failed", {
        name, code: err?.code ?? null, message: err?.message ?? String(err),
      });
      buf = null; // falha de extração genuína PARA ESTE app — cacheável em memMiss.
    }

    // `queue.enqueue` só resolve com o sentinel quando o item foi pulado
    // por abort (ver createIconQueue) — uma extração que de fato rodou
    // sempre devolve um Buffer ou lança. Preserva essa distinção até
    // getIconPng, que é quem decide se pode gravar em `memMiss`.
    if (buf === ICON_LOAD_ABORTED) {
      log.debug("icon.win.extract_skipped_aborted", { name });
      return ICON_LOAD_ABORTED;
    }

    try {
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(diskPath, buf);
      await pruneCache(cacheDir, diskMax, { readdir: fs.readdir, unlink: fs.unlink, stat: fs.stat });
    } catch (err) {
      // Escrita de cache é best-effort: um ícone que não pôde ser salvo em
      // disco ainda é um ícone válido pra devolver nesta chamada — só a
      // próxima chamada volta a pagar o custo de extração.
      log.debug("icon.win.cache_write_failed", { name, message: err?.message ?? String(err) });
    }
    return buf;
  }

  return {
    /**
     * @param {string} name
     * @param {{signal?: AbortSignal}} [opts]
     * @returns {Promise<Buffer|null>}
     */
    async getIconPng(name, opts = {}) {
      const { signal } = opts;

      // Round-3 finding 1: `resolveApps()` no longer takes a signal (see
      // its JSDoc above) — this call can never fail because THIS caller
      // gave up, so there is no self-inflicted "ABORTED" left to swallow
      // here. Any error it does throw (a genuine scan failure, or —
      // KNOWN GAP — an ABORTED that leaked in from some unrelated future
      // caller sharing apps.js's `cache.promise`) is not this caller's to
      // silently interpret as "not found": it propagates to the generic
      // `fail(res, err)` 500 in server.js, same as any other real error,
      // instead of a swallowed, misleading 404.
      const apps = await resolveApps();
      const app = apps.get(name);
      if (!app) return null;

      const sourcePath = prepareIconSourcePath(app);
      if (!sourcePath) return null; // kind sem path de arquivo real (ex.: uwp — ver comentário de topo)

      let mtimeMs;
      try {
        mtimeMs = (await fs.stat(sourcePath)).mtimeMs;
      } catch {
        // Binário de origem sumiu desde o último scan (app desinstalado
        // entre o TTL do resolveApps e agora) — nunca serve um ícone
        // obsoleto pra um app que já era, devolve null igual "não achado".
        return null;
      }

      // PLAT-09: mtime entra na chave — um app atualizado (mtime novo) gera
      // uma chave nova automaticamente, então a próxima carga reextrai em
      // vez de servir o PNG do binário antigo. Não existe uma segunda
      // estrutura de "invalidação" separada: a chave em si é a prova.
      const cacheKey = createHash("sha1").update(`${sourcePath}\0${mtimeMs}\0${maxPx}`).digest("hex");

      if (memPng.has(cacheKey)) {
        const hit = memPng.get(cacheKey);
        lruSet(memPng, cacheKey, hit, memMax);
        return hit;
      }
      if (memMiss.has(cacheKey)) return null;

      // Round-2 finding 2: o dedupe em voo (loadInflight) usava só o
      // signal do PRIMEIRO chamador pra controlar a extração inteira — um
      // 2º chamador concorrente (nunca abortado) era derrubado pelo abort
      // de um chamador não relacionado. Agora o trabalho compartilhado
      // (`entry.promise`) roda sob um AbortController PRÓPRIO desta
      // extração, e só é abortado quando TODOS os chamadores atuais
      // (`entry.waiters`) já desistiram — cada chamador individual "corre"
      // seu próprio signal contra o trabalho compartilhado sem conseguir
      // decidir o destino de ninguém além de si mesmo.
      let entry = loadInflight.get(cacheKey);
      // Uma entrada cujo controller JÁ foi abortado é uma entrada MORTA: o
      // último waiter que a segurava desistiu e chamou `entry.controller
      // .abort()`, mas a limpeza (`.then` abaixo, que remove de
      // `loadInflight`) ainda não rodou — é assíncrona. Se um chamador
      // NOVO (sem relação nenhuma com quem abortou) se juntasse a ela
      // agora, herdaria um resultado ICON_LOAD_ABORTED por um abort que
      // não foi dele, mesmo sem `signal` nenhum — a mesma classe de bug
      // do finding 2, só que numa janela mais estreita (entre o abort do
      // último waiter e a limpeza da entrada). Tratar como se não
      // existisse força a criação de uma entrada nova e não-abortada.
      if (entry && entry.controller.signal.aborted) entry = undefined;
      if (!entry) {
        if (signal?.aborted) return null; // ninguém rodando ainda e este chamador já desistiu — não inicia trabalho por ninguém.
        const controller = new AbortController();
        const shared = loadPng(name, sourcePath, cacheKey, controller.signal).then(
          buf => {
            if (loadInflight.get(cacheKey) === entry) loadInflight.delete(cacheKey);
            if (buf === ICON_LOAD_ABORTED) return buf; // nunca grava memMiss por causa de abort — finding 1
            if (buf) lruSet(memPng, cacheKey, buf, memMax);
            else memMiss.add(cacheKey); // só aqui: falha genuína, nunca abort
            return buf;
          },
          err => {
            if (loadInflight.get(cacheKey) === entry) loadInflight.delete(cacheKey);
            throw err; // WindowsIconAddonError etc. propaga pros chamadores ainda vivos — finding 3
          },
        );
        entry = { promise: shared, controller, waiters: 0 };
        loadInflight.set(cacheKey, entry);
      }

      entry.waiters++;
      try {
        if (!signal) {
          const buf = await entry.promise;
          return buf === ICON_LOAD_ABORTED ? null : buf;
        }
        const giveUp = new Promise(resolve => {
          if (signal.aborted) { resolve(ICON_LOAD_ABORTED); return; }
          signal.addEventListener("abort", () => resolve(ICON_LOAD_ABORTED), { once: true });
        });
        const buf = await Promise.race([entry.promise, giveUp]);
        return buf === ICON_LOAD_ABORTED ? null : buf;
      } finally {
        entry.waiters--;
        if (entry.waiters <= 0) entry.controller.abort();
      }
    },
    // Exposto só pra teste determinístico da fila (ver "PLAT-03: cancelamento").
    _queue: queue,
  };
}
