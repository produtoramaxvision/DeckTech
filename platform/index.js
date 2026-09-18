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
} from "./windows/actions.js";

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
  };
}

/**
 * Contrato Windows: Fase 3 (PLAT-02..PLAT-07) chegando membro a membro.
 * PLAT-02+10 (descoberta de apps: atalhos do Menu Iniciar via o leitor
 * binário .lnk, UWP, dedupe por target, exclusão de desinstaladores),
 * PLAT-03+09 (ícone 256px via addon N-API, cache persistente cancelável) e
 * PLAT-05 (listagem de processos + ativação de janela, com o fallback do
 * PRD §15) já existem de verdade — `listInstalledApps`, `iconService`,
 * `listAppProcesses` e `activateApp` usam as instâncias reais de
 * platform/windows/apps.js e platform/windows/actions.js. Só `openWebsite`
 * (PLAT-07 é outra coisa — ver .maxvision/REQUIREMENTS.md; não há
 * requisito de Fase 3 que cubra abrir URL no Windows) continua ausente e
 * falha alto com erro tipado em vez de devolver lista vazia, null
 * silencioso ou lançar TypeError sem código.
 */
function win32Platform(deps = {}) {
  const platformName = "win32";
  const { makeIconService = makeWindowsIconService } = deps;
  return {
    listInstalledApps: win32ListInstalledApps,
    listAppProcesses: win32ListAppProcesses,
    activateApp: win32ActivateApp,
    openWebsite: notImplemented("openWebsite", platformName),
    // scan reusa a MESMA instância TTL-cacheada de win32ListInstalledApps —
    // não um segundo scan PowerShell independente (ver comentário de topo
    // de platform/windows/icon.js sobre o double-layer de TTL, que já
    // existe em apps.js/realIconService pro macOS). listAppProcesses e
    // activateApp (platform/windows/actions.js) seguem a mesma regra: suas
    // próprias instâncias default já resolvem `resolveApps` para
    // win32ListInstalledApps sem precisar de injeção aqui.
    iconService: makeIconService({ scan: win32ListInstalledApps }),
  };
}

const PLATFORM_FACTORIES = {
  darwin: darwinPlatform,
  win32: win32Platform,
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
