import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, mkdir, writeFile, unlink, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { deflateSync, inflateSync } from "node:zlib";
import { log as defaultLog } from "./log.js";
// PLAT-04: cores/raio do monograma vêm dos design tokens (Fase 6), não
// inventados aqui — ver comentário de monogramPng mais abaixo.
import { findToken } from "./design/tokens.mjs";

const ex = promisify(execFile);
const LSAPPINFO = "/usr/bin/lsappinfo";
const ICON_CACHE_DIR = join(import.meta.dirname, ".icon-cache");
// Exportado para platform/index.js: a fábrica de plataforma precisa resolver
// o iconHelper do macOS explicitamente, em vez de depender do default
// implícito de realIconService() (linha ~571 abaixo).
export const MAC_ICON_HELPER = join(import.meta.dirname, "bin", "DokkeIconHelper.app");
const MAC_ICON_APPEARANCE_TTL_MS = 1000;
const registeredMacIconHelpers = new Set();
/** Ícone servido em até 512px para acompanhar telas de alta densidade. */
export const ICON_MAX_PX = 512;
/** TTL do inventário de apps (scan de /Applications). */
export const INSTALLED_APPS_TTL_MS = 120_000;
/** Cap do cache PNG em memória (LRU). Disco continua cacheando o resto. */
export const MEM_PNG_MAX = 40;
/** Cap de arquivos no cache de ícones em disco (poda os mais antigos). */
export const DISK_PNG_MAX = 256;
/** TTL do lsappinfo (fork caro) — evita um processo novo a cada poll do J5. */
export const RUNNING_TTL_MS = 1500;

const defaultAppDirs = () => [
  "/Applications",
  "/System/Applications",
  join(homedir(), "Applications"),
];

/** Apps de sistema fora dos dirs padrão (Finder fica em CoreServices, não /Applications). */
const SYSTEM_APP_PATHS = [
  ["Finder", "/System/Library/CoreServices/Finder.app"],
];

// lsappinfo usa o nome localizado que aparece no sistema (ex.: Calendário),
// enquanto o bundle normalmente mantém o nome original (Calendar). O ícone
// precisa resolver os dois nomes para não cair no monograma.
const LOCALIZED_APP_ALIASES = new Map([
  ["calendario", "Calendar"],
  ["calculadora", "Calculator"],
  ["notas", "Notes"],
  ["fotos", "Photos"],
  ["tempo", "Weather"],
  ["previsao do tempo", "Weather"],
  ["loja de apps", "App Store"],
]);

function normalizeAppLabel(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function resolveIconAppName(name, apps) {
  if (apps.has(name)) return name;
  const alias = LOCALIZED_APP_ALIASES.get(normalizeAppLabel(name));
  return alias && apps.has(alias) ? alias : name;
}

/** Cache de inventário: evita N× readdir quando a UI pede 80 ícones de uma vez. */
let installedCache = { at: 0, apps: null, promise: null };
/** Cache de running (lsappinfo): evita fork de processo a cada poll / por cliente. */
let runningCache = { at: 0, value: null, promise: null };

/** Só testes / hot-reload. */
export function clearInstalledAppsCache() {
  installedCache = { at: 0, apps: null, promise: null };
}

function parseApps(raw, includeBundlePath = false) {
  const apps = [];
  let cur = null;
  for (const line of raw.split("\n")) {
    const nm = line.match(/^\s*\d+\)\s+"([^"]+)"/);
    if (nm) { cur = { name: nm[1].trim(), pid: null, type: null }; apps.push(cur); continue; }
    const bp = line.match(/^\s*bundle path="([^"]+)"/);
    if (bp && cur && includeBundlePath) cur.bundlePath = bp[1];
    const pd = line.match(/^\s*pid\s*=\s*(\d+)/);
    if (pd && cur) {
      cur.pid = Number(pd[1]);
      const ty = line.match(/type="([^"]+)"/);
      if (ty) cur.type = ty[1];
    }
  }
  return apps;
}

export function listApps(raw) {
  return parseApps(raw);
}

export function canonicalAppNameFromBundlePath(bundlePath) {
  const match = String(bundlePath || "").match(/\/([^/]+)\.app\/?$/i);
  return match ? match[1] : null;
}

export async function listAppProcesses() {
  const now = Date.now();
  if (runningCache.value && now - runningCache.at < RUNNING_TTL_MS) return runningCache.value;
  if (runningCache.promise) return runningCache.promise;
  runningCache.promise = (async () => {
    try {
      const { stdout } = await ex(LSAPPINFO, []);
      // UI só precisa de apps em primeiro plano — corta 50+ helpers do payload
      return parseApps(stdout, true)
        .filter(a => !a.type || a.type === "Foreground")
        .map(a => {
          // lsappinfo localiza o nome (Calendário), mas o bundle path é a
          // identidade estável usada pelo inventário e pelo endpoint de ícone.
          const canonical = canonicalAppNameFromBundlePath(a.bundlePath);
          return canonical ? { name: canonical, pid: a.pid, type: a.type } : { name: a.name, pid: a.pid, type: a.type };
        });
    } catch {
      return [];
    }
  })().then((v) => {
    runningCache.value = v;
    runningCache.at = Date.now();
    runningCache.promise = null;
    return v;
  }, (e) => {
    runningCache.promise = null;
    throw e;
  });
  return runningCache.promise;
}

/** Só readdir — sem plutil. Usado no inventário (80 apps × plutil = segundos). */
export async function hasAnyIconFile(appPath) {
  try {
    const files = await readdir(join(appPath, "Contents", "Resources"));
    return files.some(f => {
      const lower = f.toLowerCase();
      return lower.endsWith(".icns") || lower.endsWith(".png");
    });
  } catch {
    return false;
  }
}

async function bundleIconName(appPath) {
  // CFBundleIconFile é a fonte autoritativa; só no getIcon (lazy), não no scan.
  try {
    const { stdout } = await ex("plutil", ["-convert", "json", "-o", "-", join(appPath, "Contents", "Info.plist")]);
    const info = JSON.parse(stdout);
    const raw = info && info.CFBundleIconFile;
    if (typeof raw === "string" && raw) return /\.[a-z0-9]+$/i.test(raw) ? raw : raw + ".icns";
  } catch {}
  return null;
}

export async function findIconFile(appPath) {
  try {
    const resDir = join(appPath, "Contents", "Resources");
    const files = await readdir(resDir);
    const named = await bundleIconName(appPath);
    if (named) {
      const hit = files.find(f => f.toLowerCase() === named.toLowerCase());
      if (hit && /\.(icns|png)$/i.test(hit)) return join(resDir, hit);
    }
    const icns = files.filter(f => f.toLowerCase().endsWith(".icns"));
    if (icns.length) {
      const pref = ["appicon.icns", "app.icns", "icon.icns"];
      for (let i = 0; i < pref.length; i++) {
        const hit = icns.find(f => f.toLowerCase() === pref[i]);
        if (hit) return join(resDir, hit);
      }
      return join(resDir, icns[0]);
    }
    const pngs = files.filter(f => f.toLowerCase().endsWith(".png"));
    const prefPng = ["appicon.png", "app.png", "icon.png", "icon-production.png"];
    let png = null;
    for (const pref of prefPng) {
      const hit = pngs.find(f => f.toLowerCase() === pref);
      if (hit) { png = hit; break; }
    }
    if (!png) png = pngs[0];
    return png ? join(resDir, png) : null;
  } catch {
    return null;
  }
}

async function findAppBundles(dir, depth = 0) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const found = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const isAppBundle = entry.name.endsWith(".app") && (entry.isDirectory() || entry.isSymbolicLink());
    if (isAppBundle) {
      // O macOS expõe alguns apps, como o Safari, como symlink para o Cryptex.
      // Confirma o destino sem seguir symlinks de diretórios arbitrários e sem
      // abrir espaço para loops durante a varredura.
      try {
        if (!(await stat(path)).isDirectory()) continue;
      } catch {
        continue;
      }
      found.push({ name: entry.name.slice(0, -4), path });
    } else if (entry.isDirectory() && depth < 2 && !entry.name.startsWith(".")) {
      found.push(...await findAppBundles(path, depth + 1));
    }
  }
  return found;
}

/**
 * Descoberta macOS: procura bundles em /Applications, /System/Applications
 * e ~/Applications, inclusive em subpastas. A UI nunca conhece esses paths;
 * cada plataforma só precisa implementar este mesmo contrato {name,path}.
 */
export async function scanAppsDirs(dirs, includeSystemApps = false) {
  const seen = new Set();
  const apps = [];
  for (const dir of dirs) {
    const batch = await findAppBundles(dir);
    for (const bundle of batch) {
      const key = bundle.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // inventário mínimo: sem readdir de Resources (ícone assume true; 404 → monograma)
      apps.push({ name: bundle.name, path: bundle.path, icon: true });
    }
  }
  if (includeSystemApps) {
    for (const [name, path] of SYSTEM_APP_PATHS) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      apps.push({ name, path, icon: true });
    }
  }
  apps.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  return apps;
}

export async function listInstalledApps() {
  const now = Date.now();
  if (installedCache.apps && now - installedCache.at < INSTALLED_APPS_TTL_MS) {
    return installedCache.apps;
  }
  if (installedCache.promise) return installedCache.promise;
  installedCache.promise = scanAppsDirs(defaultAppDirs(), true)
    .then(apps => {
      installedCache = { at: Date.now(), apps, promise: null };
      return apps;
    })
    .catch(err => {
      installedCache.promise = null;
      throw err;
    });
  return installedCache.promise;
}

export async function convertToPng(sourcePath, outPath, exec, maxPx = ICON_MAX_PX, iconHelper = null) {
  if (iconHelper) {
    if (iconHelper.endsWith(".app")) {
      // LaunchServices pode ainda não reconhecer um app auxiliar recém-
      // empacotado. Um primeiro lançamento sem argumentos registra o bundle;
      // depois o lançamento com --args recebe o caminho do app normalmente.
      if (!registeredMacIconHelpers.has(iconHelper)) {
        await exec("/usr/bin/open", ["-W", "-n", iconHelper]);
        registeredMacIconHelpers.add(iconHelper);
      }
      await exec("/usr/bin/open", ["-W", "-n", iconHelper, "--args", sourcePath, outPath, String(maxPx)]);
    } else {
      await exec(iconHelper, [sourcePath, outPath, String(maxPx)]);
    }
    return;
  }
  // -Z = fit longest side; 512px cobre tiles grandes e telas de alta densidade.
  await exec("sips", ["-s", "format", "png", "-Z", String(maxPx), sourcePath, "--out", outPath]);
}

async function readMacIconAppearance(exec) {
  try {
    const result = await exec("/usr/bin/defaults", ["read", "-g"]);
    const output = String(result?.stdout ?? "");
    const theme = output.match(/^\s*AppleIconAppearanceTheme\s*=\s*([^;]+);/m)?.[1]?.trim() || "default";
    const interfaceStyle = output.match(/^\s*AppleInterfaceStyle\s*=\s*([^;]+);/m)?.[1]?.trim() || "light";
    return `icon=${theme};interface=${interfaceStyle}`;
  } catch {
    return "icon=system;interface=system";
  }
}

function lruSet(map, key, value, max) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const first = map.keys().next().value;
    map.delete(first);
  }
}

/** Poda o cache em disco: mantém só os DISK_PNG_MAX pngs mais recentes. */
export async function pruneIconCache(cacheDir, maxFiles = DISK_PNG_MAX, fsDeps = {}) {
  const readdirFn = fsDeps.readdir ?? readdir;
  const unlinkFn = fsDeps.unlink ?? unlink;
  const statFn = fsDeps.stat ?? stat;
  let files;
  try {
    files = (await readdirFn(cacheDir)).filter(f => f.endsWith(".png"));
  } catch { return; }
  if (files.length <= maxFiles) return;
  const dated = await Promise.all(files.map(async f => {
    const full = join(cacheDir, f);
    try { return { full, mtime: (await statFn(full)).mtimeMs }; } catch { return null; }
  }));
  const alive = dated.filter(Boolean).sort((a, b) => a.mtime - b.mtime);
  const excess = alive.slice(0, alive.length - maxFiles);
  await Promise.all(excess.map(e => unlinkFn(e.full).catch(() => {})));
}

/** PNG tem conteúdo visível? sips pode gerar PNG todo transparente p/ alguns .icns
 *  (ex.: Books.app) — nesse caso tratamos como "sem ícone" (cai no monograma no cliente). */
function pngIsEmpty(buf) {
  try {
    if (!buf || buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return false;
    let off = 8;
    let idat = [];
    let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0, hasIHDR = false;
    while (off + 8 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString("latin1", off + 4, off + 8);
      const dataStart = off + 8;
      if (type === "IHDR") {
        hasIHDR = true;
        width = buf.readUInt32BE(dataStart);
        height = buf.readUInt32BE(dataStart + 4);
        bitDepth = buf[dataStart + 8];
        colorType = buf[dataStart + 9];
        interlace = buf[dataStart + 12];
      } else if (type === "IDAT") {
        idat.push(buf.subarray(dataStart, dataStart + len));
      } else if (type === "IEND") {
        break;
      }
      off = dataStart + len + 4; // pula CRC
    }
    if (!hasIHDR || interlace !== 0) return false;
    const hasAlpha = colorType === 6 || colorType === 4; // RGBA / gray+alpha
    if (!hasAlpha || bitDepth !== 8 || width < 1 || height < 1) return false;
    if (idat.length === 0) return false;
    const raw = inflateSync(Buffer.concat(idat));
    const channels = colorType === 6 ? 4 : 2;
    const stride = width * channels;
    let visible = 0, total = 0, p = 0;
    for (let y = 0; y < height; y++) {
      p += 1; // byte de filtro por linha
      for (let x = 0; x < width; x++) {
        const alphaIdx = p + x * channels + (channels - 1);
        if (alphaIdx + 1 > raw.length) return false;
        if (raw[alphaIdx] > 8) visible++;
        total++;
      }
      p += stride;
    }
    return total === 0 || visible / total < 0.01; // <1% opaco => vazio
  } catch (e) {
    return false;
  }
}

// PLAT-04: pares de cor do gradiente do monograma — SÓ tokens de
// design/tokens.mjs (Fase 6), nunca hex inventado aqui. Os 5 tokens
// semânticos disponíveis (accent/accent-alt/green/amber/red) não têm a
// mesma cardinalidade da paleta antiga de 8 pares (que incluía roxo/ciano
// sem token equivalente) — 5 combinações é a variedade real que os tokens
// hoje sustentam sem inventar uma 6ª cor.
//
// Conhecido, não escondido: public/index.html:953 (PALETTE, o fallback CSS
// client-side) continua com a paleta antiga hardcoded — não foi tocado
// aqui (fora do escopo desta ticket, que é apps.js/monogramPng; ver
// unresolved[] do relatório desta tarefa). As duas paletas divergem agora;
// antes eram idênticas por acidente de terem sido copiadas uma da outra.
const MONOGRAM_TOKEN_PAIRS = [
  ["--dt-accent", "--dt-accent-alt"],
  ["--dt-red", "--dt-amber"],
  ["--dt-green", "--dt-accent"],
  ["--dt-amber", "--dt-red"],
  ["--dt-accent-alt", "--dt-green"],
];

function hexToRgbTriple(hex) {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Faz parse de um literal `rgba(r,g,b,a)`/`rgb(r,g,b)` de design/tokens.mjs. */
function parseRgbaLiteral(value) {
  const m = String(value || "").match(/rgba?\(([^)]+)\)/);
  if (!m) return { r: 255, g: 255, b: 255, a: 1 };
  const parts = m[1].split(",").map(s => parseFloat(s.trim()));
  const [r, g, b] = parts;
  return { r, g, b, a: parts.length > 3 ? parts[3] : 1 };
}

/**
 * Resolve o par de cores do gradiente e a cor da tinta do texto a partir dos
 * design tokens (Fase 6), para o `theme` pedido ("dark" | "light" — D11
 * exige as duas). `--dt-ink` já é semi-transparente (.94) nos dois temas;
 * essa alpha é preservada e usada de verdade em rasterizeMonogramPixels
 * (blend contra o fundo), em vez de virar branco/preto sólido inventado.
 */
function resolveMonogramTokens(name, theme) {
  const t = theme === "light" ? "light" : "dark";
  const [aName, bName] = MONOGRAM_TOKEN_PAIRS[monogramHash(name) % MONOGRAM_TOKEN_PAIRS.length];
  const c1 = findToken(aName)[t].value;
  const c2 = findToken(bName)[t].value;
  const ink = parseRgbaLiteral(findToken("--dt-ink")[t].value);
  // --dt-r-tile-icon (0.19): mesmo raio proporcional que a CSS do client já
  // aplica em `.atile .aglass img.aicon{ border-radius: 18% }` — não um
  // valor novo, o token cujo NOME já é literalmente "raio do ícone do tile".
  const radiusRatio = parseFloat(findToken("--dt-r-tile-icon").value);
  return { c1, c2, ink, radiusRatio };
}

/**
 * Extrai as iniciais do monograma, código-a-código (nunca por índice cru de
 * UTF-16 — um par substituto cortado ao meio virava metade de um glifo).
 * Acentos latinos são removidos via NFD antes de extrair (mesma técnica já
 * usada em normalizeAppLabel acima) para que "Índice" vire "IN", não caia
 * no glifo de fallback por causa só do acento. Scripts fora do alfabeto do
 * monograma (CJK, emoji, cirílico) não têm glifo — ver glyphRowsFor, que
 * troca CADA caractere sem glifo pelo "?" em vez de deixar o canvas vazio.
 */
function monogramInitials(name) {
  const stripped = String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const trimmed = stripped.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  let raw;
  if (words.length > 1) {
    raw = (Array.from(words[0])[0] || "") + (Array.from(words[1])[0] || "");
  } else {
    raw = Array.from(trimmed).slice(0, 2).join("");
  }
  const upper = raw.toLocaleUpperCase("en-US");
  return upper || "?";
}

function monogramHash(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

// Fonte bitmap 5x7 pura-JS — A-Z, 0-9 e "?" (glifo de fallback pra qualquer
// caractere fora deste alfabeto). Desenhada à mão para esta ticket: não é
// uma cópia de nenhuma fonte existente, é um bloco 5x7 simples o bastante
// pra ser auditável linha a linha. "#" = pixel de tinta, "." = vazio.
const MONOGRAM_FONT = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".####"],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  0: [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  1: ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", "#####"],
  2: [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  3: ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  4: ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  5: ["#####", "#....", "#....", "####.", "....#", "....#", "####."],
  6: [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  7: ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  8: [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  9: [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
};
const MONOGRAM_GLYPH_COLS = 5;
const MONOGRAM_GLYPH_ROWS = 7;

function glyphRowsFor(ch) {
  return MONOGRAM_FONT[ch] || MONOGRAM_FONT["?"];
}

/** Cobertura anti-serrilhada (0..1) de um ponto num retângulo de cantos
 * arredondados — só os cantos precisam de faixa suave de 1px; as bordas
 * retas são cobertura total/zero, sem custo de supersample. */
function roundedRectCoverage(px, py, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const cx = Math.min(Math.max(px, r), w - r);
  const cy = Math.min(Math.max(py, r), h - r);
  const dx = px - cx, dy = py - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= r - 0.5) return 1;
  if (dist >= r + 0.5) return 0;
  return r + 0.5 - dist;
}

/**
 * Rasteriza o monograma em pixels RGBA puros — sem SVG, sem sips, sem
 * nenhuma dependência de sistema. Fundo: gradiente diagonal entre `c1`/`c2`
 * (hex dos design tokens) recortado por um retângulo de cantos arredondados
 * (`radiusRatio` proporcional, também de token). Texto: até 2 glifos da
 * MONOGRAM_FONT, escala inteira (nearest-neighbor deliberado — num grid 5x7
 * a essa resolução, supersample não muda a leitura, só custa CPU), com a
 * tinta (`ink`, {r,g,b,a} de --dt-ink) alpha-blendada contra o fundo em vez
 * de pintada opaca — honra a alpha .94 do token em vez de inventar branco
 * sólido.
 * Nunca lança nem devolve canvas vazio: `initials` sem glifo conhecido cai
 * no "?" por caractere (ver glyphRowsFor), nunca em branco.
 */
export function rasterizeMonogramPixels({ initials, c1, c2, ink, size, radiusRatio }) {
  const w = size, h = size;
  const pixels = Buffer.alloc(w * h * 4);
  const [r1, g1, b1] = hexToRgbTriple(c1);
  const [r2, g2, b2] = hexToRgbTriple(c2);
  const radiusPx = radiusRatio * Math.min(w, h);
  const diag = Math.max(1, (w - 1) + (h - 1));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cov = roundedRectCoverage(x + 0.5, y + 0.5, w, h, radiusPx);
      if (cov <= 0) continue;
      const t = (x + y) / diag;
      const idx = (y * w + x) * 4;
      pixels[idx] = Math.round(r1 + (r2 - r1) * t);
      pixels[idx + 1] = Math.round(g1 + (g2 - g1) * t);
      pixels[idx + 2] = Math.round(b1 + (b2 - b1) * t);
      pixels[idx + 3] = Math.round(255 * cov);
    }
  }

  const chars = Array.from(String(initials || "?")).slice(0, 2);
  const glyphs = (chars.length ? chars : ["?"]).map(glyphRowsFor);
  const glyphH = Math.max(MONOGRAM_GLYPH_ROWS, Math.round(size * 0.46));
  const scale = Math.max(1, Math.floor(glyphH / MONOGRAM_GLYPH_ROWS));
  const gW = MONOGRAM_GLYPH_COLS * scale;
  const gH = MONOGRAM_GLYPH_ROWS * scale;
  const gap = glyphs.length > 1 ? scale : 0;
  const totalW = glyphs.length * gW + (glyphs.length - 1) * gap;
  const startX = Math.round((w - totalW) / 2);
  const startY = Math.round((h - gH) / 2);

  glyphs.forEach((rows, gi) => {
    const ox = startX + gi * (gW + gap);
    for (let ry = 0; ry < MONOGRAM_GLYPH_ROWS; ry++) {
      const rowStr = rows[ry] || "";
      for (let rx = 0; rx < MONOGRAM_GLYPH_COLS; rx++) {
        if (rowStr[rx] !== "#") continue;
        for (let py = 0; py < scale; py++) {
          const y = startY + ry * scale + py;
          if (y < 0 || y >= h) continue;
          for (let px = 0; px < scale; px++) {
            const x = ox + rx * scale + px;
            if (x < 0 || x >= w) continue;
            const idx = (y * w + x) * 4;
            if (pixels[idx + 3] === 0) continue; // fora do retângulo arredondado — nunca pinta lá
            const a = ink.a;
            pixels[idx] = Math.round(ink.r * a + pixels[idx] * (1 - a));
            pixels[idx + 1] = Math.round(ink.g * a + pixels[idx + 1] * (1 - a));
            pixels[idx + 2] = Math.round(ink.b * a + pixels[idx + 2] * (1 - a));
            pixels[idx + 3] = 255;
          }
        }
      }
    }
  });

  return pixels;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
}

/** Decodifica o PNG RGBA não-interlaçado gerado pelo sips. */
function decodeRgbaPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const start = off + 8;
    if (start + len + 4 > buf.length) return null;
    if (type === "IHDR") {
      width = buf.readUInt32BE(start);
      height = buf.readUInt32BE(start + 4);
      bitDepth = buf[start + 8];
      colorType = buf[start + 9];
      interlace = buf[start + 12];
    } else if (type === "IDAT") {
      idat.push(buf.subarray(start, start + len));
    } else if (type === "IEND") {
      break;
    }
    off = start + len + 4;
  }
  const channels = colorType === 6 ? 4 : (colorType === 4 ? 2 : (colorType === 2 ? 3 : 0));
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0 || !idat.length) return null;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < height * (stride + 1)) return null;
  const decoded = Buffer.alloc(width * height * channels);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? decoded[row + x - channels] : 0;
      const up = y > 0 ? decoded[row - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? decoded[row - stride + x - channels] : 0;
      const value = raw[src++];
      if (filter === 0) decoded[row + x] = value;
      else if (filter === 1) decoded[row + x] = (value + left) & 255;
      else if (filter === 2) decoded[row + x] = (value + up) & 255;
      else if (filter === 3) decoded[row + x] = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) decoded[row + x] = (value + paeth(left, up, upLeft)) & 255;
      else return null;
    }
  }
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const from = i * channels, to = i * 4;
    if (channels === 4) decoded.copy(pixels, to, from, from + 4);
    else if (channels === 2) {
      pixels[to] = decoded[from]; pixels[to + 1] = decoded[from]; pixels[to + 2] = decoded[from]; pixels[to + 3] = decoded[from + 1];
    } else {
      pixels[to] = decoded[from]; pixels[to + 1] = decoded[from + 1]; pixels[to + 2] = decoded[from + 2]; pixels[to + 3] = 255;
    }
  }
  return { width, height, pixels };
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "latin1");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) {
    crc ^= out[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}

/**
 * Recorta margens transparentes e reencaixa a arte em um canvas fixo.
 * Calendar e Notion, por exemplo, têm bounds visuais diferentes no ICNS.
 */
export function normalizePngIcon(buf, maxPx = ICON_MAX_PX) {
  const decoded = decodeRgbaPng(buf);
  if (!decoded) return buf;
  const { width, height, pixels } = decoded;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] <= 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return buf;

  const frame = Math.max(1, Math.round(maxPx * 0.94));
  const cropW = maxX - minX + 1, cropH = maxY - minY + 1;
  const scale = Math.min(frame / cropW, frame / cropH);
  const outW = Math.max(1, Math.round(cropW * scale));
  const outH = Math.max(1, Math.round(cropH * scale));
  const canvas = Buffer.alloc(maxPx * maxPx * 4);
  const left = Math.floor((maxPx - outW) / 2), top = Math.floor((maxPx - outH) / 2);
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(cropH - 1, Math.floor(y / scale));
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(cropW - 1, Math.floor(x / scale));
      const from = ((minY + sy) * width + minX + sx) * 4;
      const to = ((top + y) * maxPx + left + x) * 4;
      pixels.copy(canvas, to, from, from + 4);
    }
  }

  return encodeRgbaPng(canvas, maxPx, maxPx);
}

/**
 * Encoder RGBA -> PNG (IHDR/IDAT/IEND colorType 6, sem interlace) — a peça
 * que já existia aqui dentro de normalizePngIcon (mesmo bloco, extraído sem
 * mudar comportamento) e que PLAT-04 reusa pra rasterizar o monograma em
 * pure JS. Nenhuma dependência nova: só node:zlib (já importado no topo).
 */
function encodeRgbaPng(pixels, width, height) {
  const stride = width * 4;
  const scanlines = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    pixels.copy(scanlines, row + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * PLAT-04 — monograma de fallback, agora rasterizado em pure JS
 * (rasterizeMonogramPixels + encodeRgbaPng acima), sem nenhum binário
 * externo no caminho que roda no win32.
 *
 * `sips` continua REACHABLE só atrás de `platform === "darwin"` — nunca no
 * win32 (grep -n "sips" apps.js precisa achar a chamada só dentro desse
 * `if`). Não foi removido do macOS: é o caminho já medido/testado ali, e
 * trocar um caminho funcionando por causa de um critério do Windows seria
 * regressão numa plataforma que não dá pra testar nesta máquina. Se o sips
 * falhar mesmo no darwin (disco cheio, binário ausente etc.), cai no MESMO
 * rasterizador JS em vez de devolver null — antes disso o macOS também
 * podia terminar "sem ícone nenhum" nesse caso; agora não termina mais em
 * nenhuma das duas plataformas.
 *
 * `theme` ("dark" default | "light") resolve os tokens de design/tokens.mjs
 * pra cor/tinta — D11 exige as duas variantes existirem e serem testáveis.
 * Nenhum chamador real passa "light" hoje: a rota /api/apps/:name/icon está
 * congelada por PLAT-08 e o client (public/index.html) não tem alternância
 * de tema ainda (verificado: 0 ocorrências de `--dt-` nesse arquivo) — ver
 * unresolved[] do relatório desta tarefa.
 *
 * `rasterize`/`platform` são injetáveis (mesmo padrão de `exec`/`scan` no
 * resto do arquivo) só pra teste: um teste força platform:"win32" com um
 * execFn que lança se for chamado (prova que sips é inatingível) e outro
 * injeta um `rasterize` que lança (repõe o caminho de falha genuína que o
 * exec-mudo antigo cobria pro cache negativo em memMiss).
 */
async function monogramPng(name, execFn, cacheDir, maxPx, log = defaultLog, deps = {}) {
  const {
    platform = process.platform,
    theme = "dark",
    rasterize = rasterizeMonogramPixels,
  } = deps;

  const key = createHash("sha1").update(name).digest("hex");
  const cacheFile = join(cacheDir, `mono-${key}-${theme}-z${maxPx}.png`);
  try { return await readFile(cacheFile); } catch {}

  const initials = monogramInitials(name);
  const { c1, c2, ink, radiusRatio } = resolveMonogramTokens(name, theme);

  await mkdir(cacheDir, { recursive: true });

  if (platform === "darwin") {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxPx}" height="${maxPx}" viewBox="0 0 128 128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient></defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  <text x="64" y="72" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif"
    font-weight="700" font-size="${initials.length > 1 ? 48 : 56}" fill="white"
    dominant-baseline="central">${initials.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</text>
</svg>`;
    const tmpSvg = join(cacheDir, `mono-${monogramHash(name)}-z${maxPx}.svg`);
    await writeFile(tmpSvg, svg);
    try {
      await execFn("sips", ["-s", "format", "png", "-z", String(maxPx), String(maxPx), tmpSvg, "--out", cacheFile]);
      return await readFile(cacheFile);
    } catch (err) {
      // Não é mais o fim silencioso da cadeia (W1 original): sips falhou,
      // mas cai no rasterizador JS abaixo em vez de devolver null aqui.
      log.warn("icon.monogram.sips_failed", { name, stage: "monogram-raster-sips", code: err?.code ?? null, message: err?.message ?? String(err) });
    } finally {
      try { await unlink(tmpSvg); } catch {}
    }
  }

  try {
    const pixels = rasterize({ initials, c1, c2, ink, size: maxPx, radiusRatio });
    const buf = encodeRgbaPng(pixels, maxPx, maxPx);
    await writeFile(cacheFile, buf);
    return buf;
  } catch (err) {
    // W1: aqui SIM é o fim silencioso real da cadeia inteira de ícone — se
    // o rasterizador puro (que não deveria falhar em uso normal) lançar,
    // o app fica sem ícone nenhum, real ou monograma. warn mesmo no nível
    // padrão (quieto): não é ruído de volume, é sempre um evento raro.
    log.warn("icon.monogram.failed", { name, stage: "monogram-raster-js", code: err?.code ?? null, message: err?.message ?? String(err) });
    return null;
  }
}

export function realIconService(deps = {}) {
  const {
    scan = listInstalledApps,
    // Adaptador por plataforma: macOS usa Contents/Resources; o futuro
    // Windows poderá injetar um resolvedor de .exe/.lnk sem mudar a API HTTP.
    findIcon = findIconFile,
    exec = ex,
    cacheDir = ICON_CACHE_DIR,
    ttlMs = INSTALLED_APPS_TTL_MS,
    memMax = MEM_PNG_MAX,
    diskMax = DISK_PNG_MAX,
    maxPx = ICON_MAX_PX,
    iconHelper = process.platform === "darwin" && existsSync(MAC_ICON_HELPER) ? MAC_ICON_HELPER : null,
    appearanceToken = null,
    log = defaultLog,
    // PLAT-04: injetáveis só pra teste determinístico do monograma em
    // qualquer SO — ver JSDoc de monogramPng. Produção nunca passa nenhum
    // dos três (usa os defaults: SO real, tema escuro, rasterizador real).
    monogramPlatform = process.platform,
    monogramTheme = "dark",
    rasterizeMonogram = rasterizeMonogramPixels,
  } = deps;
  let appsByName = null;
  let appsAt = 0;
  let scanInflight = null;
  const memPng = new Map();
  const memMiss = new Set();
  const loadInflight = new Map();
  const iconPathByApp = new Map();
  let appearanceAt = 0;
  let appearanceInflight = null;

  async function resolveAppearanceToken() {
    if (!iconHelper) return "legacy";
    if (typeof appearanceToken === "function") return String(await appearanceToken());
    if (appearanceToken) return String(appearanceToken);
    const now = Date.now();
    if (appearanceInflight && now - appearanceAt < MAC_ICON_APPEARANCE_TTL_MS) return appearanceInflight;
    appearanceAt = now;
    appearanceInflight = readMacIconAppearance(exec).finally(() => {
      appearanceInflight = null;
    });
    return appearanceInflight;
  }

  async function resolveApps() {
    const now = Date.now();
    if (appsByName && now - appsAt < ttlMs) return appsByName;
    if (scanInflight) return scanInflight;
    scanInflight = Promise.resolve()
      .then(() => scan())
      .then(apps => {
        const m = new Map();
        for (const a of apps) m.set(a.name, a);
        appsByName = m;
        appsAt = Date.now();
        scanInflight = null;
        // não limpa memPng: ícones ainda válidos; path pode mudar no próximo miss
        memMiss.clear();
        iconPathByApp.clear();
        return m;
      })
      .catch(err => {
        scanInflight = null;
        throw err;
      });
    return scanInflight;
  }

  async function loadPng(name, cacheKey, currentAppearance) {
    if (memPng.has(cacheKey)) {
      const hit = memPng.get(cacheKey);
      lruSet(memPng, cacheKey, hit, memMax);
      return hit;
    }

    const apps = await resolveApps();
    const app = apps.get(resolveIconAppName(name, apps));
    log.debug("icon.load.start", { name, found: !!app });

    let buf = null;
    let source = null;
    // O bundle empacotado traz um helper AppKit que usa NSWorkspace, a mesma
    // fonte dos ícones exibidos pelo Finder. O caminho manual continua como
    // fallback para desenvolvimento e para apps em que o helper falhar.
    if (app && iconHelper) {
      try {
        const iconCacheKey = createHash("sha1").update(`${name}\0${app.path}\0${currentAppearance}`).digest("hex");
        const out = join(cacheDir, `${iconCacheKey}-z${maxPx}.png`);
        try { buf = await readFile(out); } catch {
          await mkdir(cacheDir, { recursive: true });
          await convertToPng(app.path, out, exec, maxPx, iconHelper);
          buf = await readFile(out);
        }
        if (buf) source = "helper";
      } catch (err) {
        // W1: antes um erro aqui (helper travado, LaunchServices não
        // registrou o bundle ainda, disco cheio) caía direto pro fallback
        // manual sem deixar rastro — indistinguível de "não tinha helper".
        log.debug("icon.helper.failed", { name, stage: "icon-helper", code: err?.code ?? null, message: err?.message ?? String(err) });
        buf = null;
      }
    }

    if (!buf && app) {
      let src = iconPathByApp.get(name);
      if (src === undefined) {
        src = await findIcon(app.path);
        iconPathByApp.set(name, src);
      }
      if (src) {
        try {
          if (src.endsWith(".png")) {
            buf = await readFile(src);
          } else {
            const cacheKey = createHash("sha1").update(`${name}\0${src}`).digest("hex");
            const out = join(cacheDir, `${cacheKey}-z${maxPx}.png`);
            try { buf = await readFile(out); } catch {
              await mkdir(cacheDir, { recursive: true });
              await convertToPng(src, out, exec, maxPx);
              buf = await readFile(out);
            }
          }
          if (buf) source = "manual";
        } catch (err) {
          log.debug("icon.manual.failed", { name, stage: "icon-manual", code: err?.code ?? null, message: err?.message ?? String(err) });
          buf = null;
        }
      }
    }

    if (buf) buf = normalizePngIcon(buf, maxPx);
    if (buf && pngIsEmpty(buf)) {
      log.debug("icon.empty_alpha", { name, stage: "normalize" });
      buf = null;
      source = null;
      iconPathByApp.delete(name);
    }

    if (!buf) {
      buf = await monogramPng(name, exec, cacheDir, maxPx, log, {
        platform: monogramPlatform,
        theme: monogramTheme,
        rasterize: rasterizeMonogram,
      });
      source = buf ? "monogram" : "none";
    }

    // Saída da cadeia inteira: qual estágio produziu o ícone, ou "none" se
    // nenhum produziu — esse "none" é exatamente o app sem ícone nenhum
    // que W1 descreve, agora visível em vez de silencioso.
    log[buf ? "debug" : "warn"]("icon.load.done", { name, source: source ?? "none" });

    if (buf) {
      lruSet(memPng, cacheKey, buf, memMax);
      // nome novo gravou arquivo novo em disco — poda mantém o cache com teto
      // (awaited: podar concorrente com a próxima escrita subconta arquivos)
      try { await pruneIconCache(cacheDir, diskMax); } catch {}
    } else {
      memMiss.add(cacheKey);
    }
    return buf;
  }

  return {
    async getIconPng(name) {
      const currentAppearance = await resolveAppearanceToken();
      const cacheKey = `${name}\0${currentAppearance}`;
      if (memPng.has(cacheKey)) {
        const hit = memPng.get(cacheKey);
        lruSet(memPng, cacheKey, hit, memMax);
        return hit;
      }
      if (memMiss.has(cacheKey)) return null;
      if (loadInflight.has(cacheKey)) return loadInflight.get(cacheKey);
      const p = loadPng(name, cacheKey, currentAppearance).finally(() => loadInflight.delete(cacheKey));
      loadInflight.set(cacheKey, p);
      return p;
    },
  };
}
