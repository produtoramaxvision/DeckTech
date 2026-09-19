import { existsSync } from "node:fs";

import {
  listAppProcesses,
  listInstalledApps,
  realIconService,
  MAC_ICON_HELPER,
} from "../apps.js";
import { activateApp, openWebsite } from "../actions.js";
import { listInstalledApps as win32ListInstalledApps } from "./windows/apps.js";
import { makeWindowsIconService } from "./windows/icon.js";
import {
  listAppProcesses as win32ListAppProcesses,
  activateApp as win32ActivateApp,
  focusWindow as win32FocusWindow,
  minimizeWindow as win32MinimizeWindow,
  closeWindow as win32CloseWindow,
  openNewWindow as win32OpenNewWindow,
} from "./windows/actions.js";
import { createWindowsAppearanceTracker } from "./windows/theme.js";

/**
 * Erro tipado para um membro do contrato de plataforma ainda sem provider
 * (Fase 3, PLAT-02..PLAT-07). Nunca falha em silêncio: `code` é estável e
 * consumível pelo cliente, seguindo o mesmo padrão `{code, error}` já usado
 * em server.js (ex.: "REVISION_CONFLICT", "PIECE_NOT_FOUND"). PLAT-06, que
 * chega logo em seguida, cobre os códigos específicos de falha de ação
 * (FOCUS_RESTRICTED, APP_NOT_FOUND, LAUNCH_FAILED) — este código cobre a
 * ausência total do provider, um caso anterior e distinto.
 */
export class PlatformNotImplementedError extends Error {
  constructor(member, platformName) {
    super(`platform/index.js: "${member}" não tem provider para a plataforma "${platformName}" ainda (Fase 3)`);
    this.name = "PlatformNotImplementedError";
    this.code = "PLATFORM_NOT_IMPLEMENTED";
    this.platform = platformName;
    this.member = member;
  }
}

/** Único ponto que resolve o iconHelper do macOS — ver comentário em apps.js:12-14. */
function resolveMacIconHelper() {
  return existsSync(MAC_ICON_HELPER) ? MAC_ICON_HELPER : null;
}

function notImplemented(member, platformName) {
  return async function notImplementedProvider() {
    throw new PlatformNotImplementedError(member, platformName);
  };
}

/**
 * Contrato macOS: reusa as implementações reais já injetáveis em
 * server.js:295-298 e apps.js:559-573. O iconHelper é resolvido AQUI, de
 * forma explícita, e passado para makeIconService — não fica implícito
 * dentro do default de realIconService() (apps.js:571), que continua
 * existindo só como fallback direto de quem chama realIconService() sem
 * passar pela fábrica (ex.: makeApp() hoje).
 */
function darwinPlatform(deps = {}) {
  const platformName = "darwin";
  const {
    makeIconService = realIconService,
    resolveMacIconHelper: resolveHelper = resolveMacIconHelper,
  } = deps;
  return {
    listInstalledApps,
    listAppProcesses,
    activateApp,
    openWebsite,
    iconService: makeIconService({ iconHelper: resolveHelper() }),
    // PLAT-12: macOS requer equivalente (CGWindowListCopyWindowInfo) ou degradação
    // explicitamente declarada (PlatformNotImplementedError), nunca undefined is not a function.
    focusWindow: notImplemented("focusWindow", platformName),
    minimizeWindow: notImplemented("minimizeWindow", platformName),
    closeWindow: notImplemented("closeWindow", platformName),
    openNewWindow: notImplemented("openNewWindow", platformName),
  };
}

/**
 * Contrato Windows: Fase 3 (PLAT-02..PLAT-07) chegando membro a membro.
 * PLAT-02+10 (descoberta de apps: atalhos do Menu Iniciar via o leitor
 * binário .lnk, UWP, dedupe por target, exclusão de desinstaladores),
 * PLAT-03+09 (ícone 256px via addon N-API, cache persistente cancelável),
 * PLAT-05 (listagem de processos + ativação de janela, com o fallback do
 * PRD §15) e PLAT-07 (aparência de ícone via AppsUseLightTheme — ver
 * platform/windows/theme.js) já existem de verdade — `listInstalledApps`,
 * `iconService`, `listAppProcesses` e `activateApp` usam as instâncias
 * reais de platform/windows/apps.js, platform/windows/actions.js e
 * platform/windows/theme.js. Só `openWebsite` (não coberto por nenhum
 * requisito de Fase 3 — ver .maxvision/REQUIREMENTS.md) continua ausente e
 * falha alto com erro tipado em vez de devolver lista vazia, null
 * silencioso ou lançar TypeError sem código.
 */
function win32Platform(deps = {}) {
  const platformName = "win32";
  const {
    makeIconService = makeWindowsIconService,
    // PLAT-07: mesmo padrão de darwinPlatform's resolveMacIconHelper —
    // resolvido explicitamente AQUI, na fábrica, e passado pra
    // makeIconService, em vez de ficar implícito num default dentro de
    // icon.js. `createWindowsAppearanceTracker()` em si continua barato e
    // sem efeito colateral: SÓ constrói o objeto (cache vazio, nenhum
    // powershell.exe spawnado) — a fábrica em si NUNCA chama `.start()`,
    // então `createPlatform("win32")` sozinho ainda não spawna processo
    // nenhum. Round-2 finding 1 (bloqueador): antes desta correção, como
    // nada aqui chamava `.start()` e o tracker não era exposto além da
    // construção, `appearanceTracker.token` ficava CONGELADO no valor da
    // primeira leitura pra sempre — um AppsUseLightTheme real nunca
    // invalidava o cache de platform/windows/icon.js, apesar de
    // `appearance` já entrar na chave de cache (icon.js:516) desde a
    // primeira versão desta ticket. A correção não mudou este arquivo: fica
    // em platform/windows/theme.js — `appearanceTracker.token()` agora
    // liga o watch sozinho na SUA PRÓPRIA primeira chamada (lazy-start, ver
    // JSDoc de createWindowsAppearanceTracker), então o consumidor real
    // (icon.js's resolveAppearanceToken, chamado de getIconPng) já é o
    // gatilho — sem precisar de um `.start()` explícito aqui nem de uma
    // segunda API na fábrica. `token` continua passado por referência (não
    // chamado aqui) exatamente como antes.
    resolveWindowsAppearanceTracker = createWindowsAppearanceTracker,
    focusWindow = win32FocusWindow,
    minimizeWindow = win32MinimizeWindow,
    closeWindow = win32CloseWindow,
    openNewWindow = win32OpenNewWindow,
  } = deps;
  const appearanceTracker = resolveWindowsAppearanceTracker();
  const iconService = makeIconService({ scan: win32ListInstalledApps, appearanceToken: appearanceTracker.token });
  iconService.dispose = () => appearanceTracker.stop();
  return {
    listInstalledApps: win32ListInstalledApps,
    listAppProcesses: win32ListAppProcesses,
    activateApp: win32ActivateApp,
    openWebsite: notImplemented("openWebsite", platformName),
    iconService,
    focusWindow,
    minimizeWindow,
    closeWindow,
    openNewWindow,
  };
}

/**
 * Contrato de fallback (Phase 14 critério 6): responde aos 9 membros do
 * contrato de plataforma. Para sistemas sem provider nativo (ex.: Linux em
 * desenvolvimento), os 4 métodos de controle de janela devolvem o erro
 * tipado PlatformNotImplementedError — nunca undefined is not a function.
 */
export function fallbackPlatform(deps = {}) {
  const platformName = "fallback";
  const { makeIconService = realIconService } = deps;
  return {
    listInstalledApps,
    listAppProcesses,
    activateApp,
    openWebsite,
    iconService: makeIconService(),
    focusWindow: notImplemented("focusWindow", platformName),
    minimizeWindow: notImplemented("minimizeWindow", platformName),
    closeWindow: notImplemented("closeWindow", platformName),
    openNewWindow: notImplemented("openNewWindow", platformName),
  };
}

const PLATFORM_FACTORIES = {
  darwin: darwinPlatform,
  win32: win32Platform,
  fallback: fallbackPlatform,
};

/**
 * Fábrica explícita de plataforma (PLAT-01). Resolve
 * {listInstalledApps, listAppProcesses, activateApp, openWebsite, iconService}
 * por SO, a partir de `platformName` (default: `process.platform`, lido uma
 * única vez aqui — nunca de novo dentro de apps.js/actions.js).
 *
 * `deps` é passado adiante para o provider da plataforma resolvida (hoje só
 * darwinPlatform usa `makeIconService`/`resolveMacIconHelper`; win32Platform
 * não aceita deps porque ainda não tem implementação real a injetar).
 */
export function createPlatform(platformName = process.platform, deps = {}) {
  const factory = PLATFORM_FACTORIES[platformName];
  if (!factory) throw new PlatformNotImplementedError("createPlatform", platformName);
  return factory(deps);
}
