// platform/windows/apps.js
//
// PLAT-02 + PLAT-10 — Windows `listInstalledApps` provider, behind the
// Fase 2 contract (platform/index.js#win32Platform). Composes, without
// re-deriving, the mechanisms Fase 0 already measured and decided:
//
//   - PLAT-10 / docs/adr/0003-proof-03-lnk-binary-parsing.md: the binary
//     `.lnk` reader (measure/windows/lnk-parser.mjs#parseLnk) is the
//     PRIMARY target-resolution mechanism, not COM — zero mismatches over
//     182 real shortcuts, 8.8x-16.4x faster. This module never spawns
//     `WScript.Shell` to resolve a `.lnk`.
//   - docs/adr/0002-proof-02-uwp-app-enumeration.md: UWP/Store apps are
//     found via `Get-StartApps`, cross-verified against `Get-AppxPackage`
//     (a row is "packaged" only when its AppID has the
//     `PackageFamilyName!AppId` shape AND that family exists in the live
//     `Get-AppxPackage` list — never guessed from the AUMID string alone).
//     The packaged pool is merged with the `.lnk` pool WITHOUT deduping
//     across them (disjoint key spaces: a resolved `.exe` path is never a
//     valid AUMID and vice versa — see that ADR's "Merge-without-
//     duplicates").
//   - docs/adr/PROOF-04-uninstaller-exclusion-rule.md: the exclusion rule
//     runs BEFORE dedupe-by-target
//     (measure/windows/lib/resolve-app-list.mjs#resolveAppList) — reusing
//     that exact composition, not reimplementing the order.
//
// What moved into production here vs. what stays a measure/ probe:
//
//   Imported directly (pure functions, no I/O, already unit-tested and
//   already validated against this machine's real data by their own
//   ADRs — nothing here is a throwaway copy):
//     measure/windows/lnk-parser.mjs            parseLnk
//     measure/windows/lib/uninstaller-rule.mjs  isUninstallerEntry (via resolveAppList)
//     measure/windows/lib/resolve-app-list.mjs  resolveAppList (partition BEFORE dedupe)
//     measure/windows/lib/dedupe-target.mjs     dedupeByTarget (via resolveAppList)
//   This repo has no packaging step that excludes measure/ from what
//   ships (checked: package.json carries no `files` allowlist; the only
//   packaging script, mac/package-dmg.sh, stages public/ web assets for a
//   macOS DMG and never touches measure/ or platform/) — so importing
//   across that boundary is not a shipping bug today, and re-copying
//   validated logic would only create a second copy to keep in sync.
//
//   NOT imported — measure/windows/scan-apps.mjs and
//   measure/windows/proof-02/uwp-enum.mjs themselves stay probes. Both are
//   one-shot CLI scripts (scan-apps.mjs calls `process.exit(1)` off-Windows;
//   uwp-enum.mjs writes ADR evidence, records git provenance/hashes, runs a
//   PID-attributed activation proof) with no cache, no cancellation, and no
//   typed failures — a benchmark's job is a rigorous one-shot measurement,
//   not a long-lived server dependency. This module reimplements only the
//   I/O shape they demonstrate (one PowerShell collect: Start Menu folder
//   paths + `.lnk` enumeration + `Get-StartApps` + `Get-AppxPackage`), with
//   the obligations production carries that a benchmark does not: a TTL
//   cache with explicit invalidation (PLAT-02's own requirement), typed
//   errors (`WindowsAppScanError`, same `{code, error}` shape as
//   `actions.js`'s `ActionError` / `platform/index.js`'s
//   `PlatformNotImplementedError`), and `AbortSignal`-based cancellation.
//
// pt-BR locale: identity for a packaged app is the AUMID's
// PackageFamilyName (locale-invariant, per ADR-0002) — never the display
// name. `classifyPackagedApps` below never matches on "Calculator" or
// "Photos" as strings; it only *displays* whatever localized `Name`
// `Get-StartApps` returns ("Calculadora" on this machine).
//
// Windows paths from PowerShell are parsed with `node:path/win32`
// explicitly (not host-dispatched `node:path`), the same discipline
// `measure/windows/lib/uninstaller-rule.mjs` documents and this repo's
// test suite runs on `ubuntu-latest` to enforce (docs/adr/0003 round-3
// blocker 1). `node:path`'s `join` is used only for this module's own
// temp-file paths on the machine actually running it.

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basename, extname } from "node:path/win32";
import { promisify } from "node:util";

import { parseLnk } from "../../measure/windows/lnk-parser.mjs";
import { resolveAppList } from "../../measure/windows/lib/resolve-app-list.mjs";
import { log as defaultLog } from "../../log.js";

const execFileAsync = promisify(execFile);

/** TTL do inventário de apps Windows — mesmo valor usado pelo scan macOS (apps.js). */
export const INSTALLED_APPS_TTL_MS = 120_000;

/**
 * Erro tipado de falha de scan (PLAT-02). Mesmo formato `{code, error}` já
 * usado por `ActionError` (actions.js) e `PlatformNotImplementedError`
 * (platform/index.js) — nunca um erro cru sem `code` estável.
 */
export class WindowsAppScanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WindowsAppScanError";
    this.code = code;
  }
}

// Escreve o resultado em ARQUIVO (UTF-8 sem BOM), nunca em stdout: a
// codificação do console do PowerShell numa máquina pt-BR corrompe nomes
// acentuados ("Configurações", "Legendas ao vivo") capturados via
// child_process pipe — decisão já medida em
// measure/windows/proof-02/collect-startapps.ps1's próprio cabeçalho.
// `[Environment]::GetFolderPath` (não um Join-Path hardcoded) honra
// redirecionamento de Start Menu por Group Policy — ADR-0002/scan-apps.mjs
// round-2 finding 4. `-ErrorVariable +dirErrors` acumula falhas de
// enumeração por subpasta (ex.: ACL negada) em vez de deixar uma delas
// derrubar o scan inteiro.
const PS_SCRIPT = `
param(
  [Parameter(Mandatory = $true)][string]$OutFile
)
$ErrorActionPreference = 'Stop'
$dirs = @(
  [Environment]::GetFolderPath('CommonPrograms'),
  [Environment]::GetFolderPath('Programs')
)
$dirErrors = @()
$lnkFiles = New-Object System.Collections.Generic.List[string]
foreach ($dir in $dirs) {
  if (Test-Path -LiteralPath $dir) {
    Get-ChildItem -LiteralPath $dir -Filter *.lnk -Recurse -File -ErrorAction SilentlyContinue -ErrorVariable +dirErrors | ForEach-Object {
      $lnkFiles.Add($_.FullName)
    }
  }
}
$startApps = Get-StartApps | Select-Object Name, AppID
$appxPackages = Get-AppxPackage | Select-Object Name, PackageFamilyName, InstallLocation
$result = [ordered]@{
  dirErrorCount = $dirErrors.Count
  lnkFiles      = $lnkFiles
  startApps     = $startApps
  appxPackages  = $appxPackages
}
$json = $result | ConvertTo-Json -Depth 6 -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutFile, $json, $utf8NoBom)
`;

/** ConvertTo-Json colapsa um array de 1 item num objeto solto — mesma armadilha de scan-apps.mjs:143. */
function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Roda o coletor PowerShell único (pastas do Start Menu + enumeração de
 * `.lnk` + `Get-StartApps` + `Get-AppxPackage`) e devolve os dados crus.
 * Nunca resolve o alvo de um `.lnk` via COM — isso é o que PLAT-10 evita.
 * @param {{signal?: AbortSignal}} opts
 */
export async function runPowerShellCollect({ signal } = {}) {
  if (process.platform !== "win32") {
    throw new WindowsAppScanError(
      "UNSUPPORTED_PLATFORM",
      `Windows app scan requires win32, got "${process.platform}"`,
    );
  }
  const workDir = mkdtempSync(join(tmpdir(), "decktech-plat02-"));
  const scriptPath = join(workDir, "collect.ps1");
  const outPath = join(workDir, "collect.json");
  writeFileSync(scriptPath, PS_SCRIPT, "utf8");

  let raw;
  try {
    try {
      await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-OutFile", outPath],
        { signal, maxBuffer: 32 * 1024 * 1024 },
      );
    } catch (err) {
      if (err?.name === "AbortError" || err?.code === "ABORT_ERR") {
        throw new WindowsAppScanError("ABORTED", "Windows app scan aborted before PowerShell finished");
      }
      throw new WindowsAppScanError("POWERSHELL_FAILED", `PowerShell collect failed: ${err?.message ?? err}`);
    }
    try {
      raw = readFileSync(outPath, "utf8");
    } catch (err) {
      throw new WindowsAppScanError("POWERSHELL_FAILED", `PowerShell collect produced no output: ${err?.message ?? err}`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    throw new WindowsAppScanError("SCAN_OUTPUT_INVALID", `PowerShell collect produced invalid JSON: ${err?.message ?? err}`);
  }

  return {
    dirErrorCount: payload.dirErrorCount ?? 0,
    lnkFiles: asArray(payload.lnkFiles),
    startApps: asArray(payload.startApps),
    appxPackages: asArray(payload.appxPackages),
  };
}

/**
 * Lê e resolve cada `.lnk` via o leitor binário PRIMARY (PLAT-10) — nunca
 * COM. Uma falha de leitura/parse de UM `.lnk` vira `target: null` (entra
 * como "não resolvido", igual a scan-apps.mjs) em vez de derrubar o scan
 * inteiro.
 * @param {string[]} lnkPaths
 * @param {{readFile?: (p: string) => Buffer, parseLnk?: typeof parseLnk}} deps
 * @returns {Array<{name: string, target: string|null, arguments: string|null, lnk: string, readError: string|null}>}
 */
export function resolveLnkEntries(lnkPaths, deps = {}) {
  const { readFile = readFileSync, parseLnk: parseFn = parseLnk } = deps;
  return lnkPaths.map((lnkPath) => {
    let parsed = null;
    let readError = null;
    try {
      const buf = readFile(lnkPath);
      parsed = parseFn(buf);
    } catch (err) {
      readError = String(err?.message ?? err);
    }
    return {
      name: basename(lnkPath, extname(lnkPath)),
      target: parsed?.resolvedTargetPath ?? null,
      arguments: parsed?.strings?.arguments ?? null,
      lnk: lnkPath,
      readError,
    };
  });
}

/**
 * Classifica linhas de `Get-StartApps` como pacote UWP/Store SOMENTE
 * quando o AppID tem a forma `PackageFamilyName!AppId` E essa família
 * exata existe em `Get-AppxPackage` — nunca por forma de string isolada
 * (ADR-0002, "Mechanism decision"). Identidade é `family`
 * (locale-invariante); `name` é só o que exibir.
 * @param {Array<{Name?: string, AppID?: string}>} startApps
 * @param {Array<{PackageFamilyName?: string}>} appxPackages
 */
export function classifyPackagedApps(startApps, appxPackages) {
  const families = new Set((appxPackages ?? []).map((p) => p?.PackageFamilyName).filter(Boolean));
  const packaged = [];
  for (const row of startApps ?? []) {
    const id = String(row?.AppID ?? "");
    const bang = id.indexOf("!");
    if (bang === -1) continue; // não tem a forma de AUMID empacotado — deixa para o pool .lnk decidir
    const family = id.slice(0, bang);
    if (!families.has(family)) continue; // AUMID-shaped mas não confirmado no registro — não é "packaged"
    packaged.push({ name: row?.Name ?? id, aumid: id, family, appIdPart: id.slice(bang + 1) });
  }
  return packaged;
}

/**
 * Funde o pool `.lnk` (deduplicado/filtrado por resolveAppList) com o pool
 * UWP empacotado — NUNCA cruzando os dois por nome (ADR-0002: um app UWP e
 * um `.lnk` podem compartilhar display name e são entidades distintas).
 * Um `.lnk` sem alvo resolvido (URL/CLSID shortcut, ou os `noUsablePathSource`
 * IDList-only que o leitor binário — PLAT-10 — não decodifica por escopo)
 * não é um app lançável e é descartado aqui, não antes: `resolveAppList`
 * ainda precisa vê-lo para a regra de exclusão/dedupe correr sobre ele.
 * @param {Array<{name: string, target: string|null}>} win32Kept
 * @param {Array<{name: string, aumid: string}>} uwpPackaged
 */
export function mergeAppLists(win32Kept, uwpPackaged) {
  const win32Apps = win32Kept
    .filter((e) => typeof e.target === "string" && e.target !== "")
    .map((e) => ({ name: e.name, path: e.target, icon: true, kind: "win32", target: e.target }));
  const uwpApps = uwpPackaged.map((a) => ({ name: a.name, path: a.aumid, icon: true, kind: "uwp", aumid: a.aumid }));
  const merged = [...win32Apps, ...uwpApps];
  merged.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  return merged;
}

/**
 * Fábrica testável (mesmo padrão de `realIconService(deps)` em apps.js):
 * deps injetáveis permitem exercitar a composição inteira sem PowerShell
 * real nem Windows real — CI roda em `ubuntu-latest`. `platform/index.js`
 * usa a instância padrão exportada abaixo (`listInstalledApps`), ligada às
 * dependências reais.
 * @param {{
 *   collect?: (opts: {signal?: AbortSignal}) => Promise<{dirErrorCount: number, lnkFiles: string[], startApps: any[], appxPackages: any[]}>,
 *   readFile?: (p: string) => Buffer,
 *   parseLnk?: typeof parseLnk,
 *   ttlMs?: number,
 *   now?: () => number,
 *   log?: typeof defaultLog,
 * }} deps
 */
export function makeListInstalledApps(deps = {}) {
  const {
    collect = runPowerShellCollect,
    readFile = readFileSync,
    parseLnk: parseFn = parseLnk,
    ttlMs = INSTALLED_APPS_TTL_MS,
    now = Date.now,
    log = defaultLog,
  } = deps;
  let cache = { at: 0, apps: null, promise: null };

  async function scan({ signal } = {}) {
    const collected = await collect({ signal });
    if (signal?.aborted) throw new WindowsAppScanError("ABORTED", "Windows app scan aborted before merge");
    // PROOF-04 round-2 finding 3: uma subpasta do Start Menu negada por ACL
    // não pode encolher a lista de apps em silêncio — o mesmo defeito que
    // essa ADR fechou no probe. dirErrorCount > 0 aqui é sinal, não decisão
    // (o scan continua com o que conseguiu enumerar, igual ao probe).
    if (collected.dirErrorCount > 0) {
      log.warn("windows.apps.dir_enum_incomplete", { dirErrorCount: collected.dirErrorCount });
    }
    const resolved = resolveLnkEntries(collected.lnkFiles, { readFile, parseLnk: parseFn });
    // Ordem não-negociável (PROOF-04 §4c): exclusão de desinstaladores
    // ANTES do dedupe por target — resolveAppList já compõe exatamente
    // nessa ordem, não reimplementada aqui.
    const { kept } = resolveAppList(resolved);
    const packaged = classifyPackagedApps(collected.startApps, collected.appxPackages);
    return mergeAppLists(kept, packaged);
  }

  /**
   * @param {{signal?: AbortSignal}} [opts]
   * @returns {Promise<Array<{name: string, path: string, icon: true, kind: "win32"|"uwp"}>>}
   */
  async function listInstalledApps(opts = {}) {
    const { signal } = opts;
    const t = now();
    if (cache.apps && t - cache.at < ttlMs) return cache.apps;
    if (cache.promise) return cache.promise;
    cache.promise = scan({ signal })
      .then((apps) => {
        cache = { at: now(), apps, promise: null };
        return apps;
      })
      .catch((err) => {
        cache.promise = null;
        throw err;
      });
    return cache.promise;
  }

  /** Invalidação explícita do cache (PLAT-02: "cache com invalidação"). */
  listInstalledApps.clearCache = () => {
    cache = { at: 0, apps: null, promise: null };
  };

  return listInstalledApps;
}

/** Instância padrão, ligada às dependências reais — o que platform/index.js consome. */
export const listInstalledApps = makeListInstalledApps();

/** Só testes / hot-reload — mesmo nome/forma de apps.js#clearInstalledAppsCache. */
export function clearInstalledAppsCache() {
  listInstalledApps.clearCache();
}
