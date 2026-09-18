import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { convertToPng, findIconFile, normalizePngIcon, realIconService, rasterizeMonogramPixels, scanAppsDirs } from "../apps.js";

// PROOF-07 / PLAT-04 (Fase 3, resolvido): monogramPng (apps.js) chamava
// incondicionalmente o binário `sips`, exclusivo do macOS, pra rasterizar o
// SVG de fallback — no win32 isso terminava em null (nenhum ícone, real nem
// monograma). PLAT-04 trocou o caminho win32 por um rasterizador pure JS
// (rasterizeMonogramPixels, sem sips) e manteve sips só atrás de um guard
// `platform === "darwin"` dentro de monogramPng — ver o JSDoc da função em
// apps.js. O teste "realIconService gera monograma para app desconhecido"
// (linha abaixo) por isso não precisa mais de gate: sem `exec` injetado,
// ele agora exercita o rasterizador JS real em qualquer SO (inclusive esta
// máquina, win32) em vez do sips real só-macOS que exigia o skip antigo.
// O gate "prova sips inatingível no win32" agora é um teste dedicado, mais
// abaixo ("PLAT-04: sips nunca é chamado quando platform !== darwin").

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

function rgbaPng(width, height, pixels) {
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    pixels.copy(scanlines, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function alphaBounds(buf) {
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  let off = 8;
  const chunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    if (type === "IDAT") chunks.push(buf.subarray(off + 8, off + 8 + len));
    off += len + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1) + 1;
    for (let x = 0; x < width; x++) {
      if (raw[row + x * 4 + 3] <= 8) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return { width, height, minX, minY, maxX, maxY };
}

/** Decodifica um PNG RGBA colorType 6 sem interlace (filtro 0 em toda
 * scanline, o mesmo formato que encodeRgbaPng/rgbaPng produzem neste
 * arquivo) pros pixels RGBA crus, sem depender de nenhuma lib nova. */
function decodePngRgba(buf) {
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  let off = 8;
  const chunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    if (type === "IDAT") chunks.push(buf.subarray(off + 8, off + 8 + len));
    off += len + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1) + 1;
    raw.copy(pixels, y * width * 4, rowStart, rowStart + width * 4);
  }
  return { width, height, pixels };
}

/** Conta quantas anti-diagonais (x+y constante) do monograma têm mais de
 * uma cor RGB distinta entre os pixels não-transparentes. O fundo é um
 * gradiente onde RGB depende SÓ de (x+y) — ver rasterizeMonogramPixels:
 * `t = (x+y)/diag`, e a cobertura (alpha) não afeta RGB. Então, qualquer
 * que seja o par de cores do token (c1/c2, escolhido por hash do nome e
 * não exportado), uma anti-diagonal com >1 RGB só pode ter esse jeito
 * porque um glifo de tinta foi blendado ali — nenhum acoplamento com a
 * seleção de token é necessário. Pixels com alpha 0 (recorte dos cantos
 * arredondados) são ignorados, mesma exclusão da outra correção deste
 * round de review.
 */
function countInkDiagonals(buf) {
  const { width, height, pixels } = decodePngRgba(buf);
  const byDiagonal = new Map();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (pixels[idx + 3] === 0) continue;
      const key = x + y;
      const rgb = (pixels[idx] << 16) | (pixels[idx + 1] << 8) | pixels[idx + 2];
      if (!byDiagonal.has(key)) byDiagonal.set(key, new Set());
      byDiagonal.get(key).add(rgb);
    }
  }
  let diagonalsWithInk = 0;
  for (const colors of byDiagonal.values()) if (colors.size > 1) diagonalsWithInk++;
  return diagonalsWithInk;
}

test("convertToPng chama sips com args corretos e resolve", async () => {
  const calls = [];
  const exec = async (cmd, args) => { calls.push([cmd, args]); };
  await convertToPng("/x/App.icns", "/out/app.png", exec);
  assert.deepEqual(calls, [["sips", ["-s", "format", "png", "-Z", "512", "/x/App.icns", "--out", "/out/app.png"]]]);
});

test("convertToPng usa o helper nativo quando ele está empacotado", async () => {
  const calls = [];
  const exec = async (cmd, args) => { calls.push([cmd, args]); };
  await convertToPng(
    "/Applications/Google Chrome.app",
    "/tmp/chrome.png",
    exec,
    256,
    "/bundle/DokkeIconHelper",
  );
  assert.deepEqual(calls, [[
    "/bundle/DokkeIconHelper",
    ["/Applications/Google Chrome.app", "/tmp/chrome.png", "256"],
  ]]);
});

test("convertToPng lança o helper app pelo LaunchServices", async () => {
  const calls = [];
  const exec = async (cmd, args) => { calls.push([cmd, args]); };
  await convertToPng(
    "/Applications/Google Chrome.app",
    "/tmp/chrome.png",
    exec,
    512,
    "/bundle/DokkeIconHelper.app",
  );
  assert.deepEqual(calls, [[
    "/usr/bin/open",
    ["-W", "-n", "/bundle/DokkeIconHelper.app"],
  ], [
    "/usr/bin/open",
    ["-W", "-n", "/bundle/DokkeIconHelper.app", "--args", "/Applications/Google Chrome.app", "/tmp/chrome.png", "512"],
  ]]);
});

test("convertToPng propaga erro do exec", async () => {
  const exec = async () => { throw new Error("sips falhou"); };
  await assert.rejects(convertToPng("/x.icns", "/o.png", exec), /sips falhou/);
});

test("realIconService converte icns via exec e cacheia no segundo chamado", async () => {
  const dir = await mkdtemp(join(tmpdir(), "j5-icon-"));
  const appPath = join(dir, "A.app");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  try {
    await mkdir(join(appPath, "Contents", "Resources"), { recursive: true });
    await writeFile(join(appPath, "Contents", "Resources", "a.icns"), "icns-dados");
    let execCalls = 0;
    const exec = async (cmd, args) => {
      execCalls++;
      assert.equal(cmd, "sips");
      const out = args[args.indexOf("--out") + 1];
      await writeFile(out, png);
    };
    const svc = realIconService({
      scan: async () => [{ name: "A", path: appPath, icon: true }],
      exec,
      cacheDir: join(dir, ".icon-cache"),
    });
    assert.deepEqual([...await svc.getIconPng("A")], [...png]);
    assert.deepEqual([...await svc.getIconPng("A")], [...png]);
    assert.equal(execCalls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("realIconService prioriza NSWorkspace pelo path do bundle e cacheia o resultado", async () => {
  // espaço no prefixo é deliberado (CLAUDE.md regra 5): exercita o path
  // completo — mkdtemp -> join -> args do exec — com um espaço nele, de ponta
  // a ponta. Quem pega a regressão de regex/separador hardcoded é a asserção
  // abaixo em si (startsWith com path.join + path.sep, sem "/" hardcoded), não
  // o espaço: um espaço não é metacaractere de regex.
  const dir = await mkdtemp(join(tmpdir(), "j5-icon native-"));
  const appPath = join(dir, "Native.app");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const helperPath = join(dir, "DokkeIconHelper");
  try {
    await mkdir(appPath, { recursive: true });
    let execCalls = 0;
    const exec = async (cmd, args) => {
      execCalls++;
      assert.equal(cmd, helperPath);
      assert.equal(args[0], appPath);
      // path.join usa "\\" no Windows: checar containment + basename em vez de
      // um regex com "/" hardcoded (que nunca bateria fora do POSIX).
      assert.ok(args[1].startsWith(join(dir, ".icon-cache") + sep), "ícone deve cair dentro do cache dir");
      assert.match(basename(args[1]), /^[a-f0-9]{40}-z512\.png$/);
      assert.equal(args[2], "512");
      await writeFile(args[1], png);
    };
    const svc = realIconService({
      scan: async () => [{ name: "Native", path: appPath, icon: true }],
      exec,
      iconHelper: helperPath,
      appearanceToken: "RegularDark",
      cacheDir: join(dir, ".icon-cache"),
    });
    assert.deepEqual([...await svc.getIconPng("Native")], [...png]);
    assert.deepEqual([...await svc.getIconPng("Native")], [...png]);
    assert.equal(execCalls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("realIconService separa o cache quando a aparência dos ícones muda", async () => {
  const dir = await mkdtemp(join(tmpdir(), "j5-icon-appearance-"));
  const appPath = join(dir, "Native.app");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const helperPath = join(dir, "DokkeIconHelper");
  let appearance = "RegularDark";
  try {
    await mkdir(appPath, { recursive: true });
    let execCalls = 0;
    const exec = async (cmd, args) => {
      execCalls++;
      assert.equal(cmd, helperPath);
      await writeFile(args[1], png);
    };
    const svc = realIconService({
      scan: async () => [{ name: "Native", path: appPath, icon: true }],
      exec,
      iconHelper: helperPath,
      appearanceToken: () => appearance,
      cacheDir: join(dir, ".icon-cache"),
    });
    await svc.getIconPng("Native");
    await svc.getIconPng("Native");
    appearance = "Mono";
    await svc.getIconPng("Native");
    assert.equal(execCalls, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("realIconService gera monograma para app desconhecido", async () => {
  // Sem exec injetado: no darwin exercitaria o sips real (inalterado por
  // PLAT-04); em qualquer outro SO (esta máquina, win32) exercita o
  // rasterizador JS real — nenhum dos dois precisa mais de mock nem de skip.
  const svc = realIconService({ scan: async () => [], cacheDir: join(tmpdir(), "j5-cache-xyz") });
  const buf = await svc.getIconPng("Fantasma");
  assert.ok(Buffer.isBuffer(buf), "deve retornar um buffer PNG");
  assert.ok(buf.length > 0, "buffer não deve estar vazio");
  assert.equal(buf[0], 0x89, "deve começar com magic number PNG");
});

test("PLAT-04: sips nunca é chamado quando platform !== darwin", async () => {
  // Discrimina o critério de sucesso literal da ticket. IMPORTANTE: a
  // asserção que importa é `execCalls === 0`, NÃO só "buf é um PNG válido"
  // — monogramPng tem uma rede de segurança que cai no rasterizador JS até
  // quando sips É chamado e falha (ver "darwin cai no rasterizador JS" mais
  // abaixo), então um `buf` válido sozinho NÃO prova que sips nunca foi
  // tentado; ele só prova que a cadeia terminou com algum ícone. Verificado
  // manualmente: com o guard `platform === "darwin"` de monogramPng
  // propositalmente quebrado (invertido pra sempre-true) numa cópia
  // scratch, este teste com a asserção de buffer sozinha continuava
  // passando (a rede de segurança escondia a regressão) — só `execCalls`
  // detecta.
  const dir = await mkdtemp(join(tmpdir(), "j5 plat04 win32-"));
  try {
    let execCalls = 0;
    const exec = async (cmd) => { execCalls++; throw new Error(`sips não deveria ser chamado no win32 (cmd=${cmd})`); };
    const svc = realIconService({
      scan: async () => [],
      exec,
      cacheDir: dir,
      monogramPlatform: "win32",
    });
    const buf = await svc.getIconPng("Fantasma Win32");
    assert.equal(execCalls, 0, "sips (exec) nunca deve ser sequer TENTADO quando platform !== darwin");
    assert.ok(Buffer.isBuffer(buf), "deve retornar um PNG mesmo sem nunca chamar sips");
    assert.equal(buf[0], 0x89, "PNG válido");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("PLAT-04: darwin ainda usa sips quando disponível (caminho macOS preservado)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "j5-plat04-darwin-"));
  try {
    let execCalls = 0;
    const exec = async (cmd, args) => {
      execCalls++;
      assert.equal(cmd, "sips");
      const out = args[args.indexOf("--out") + 1];
      await writeFile(out, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    };
    const svc = realIconService({
      scan: async () => [],
      exec,
      cacheDir: dir,
      monogramPlatform: "darwin",
    });
    const buf = await svc.getIconPng("Fantasma Darwin");
    assert.ok(Buffer.isBuffer(buf));
    assert.equal(execCalls, 1, "com platform darwin forçado, monogramPng ainda tenta sips primeiro");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("PLAT-04: darwin cai no rasterizador JS se o sips real falhar (nunca mais 'sem ícone')", async () => {
  const dir = await mkdtemp(join(tmpdir(), "j5-plat04-darwin-fallback-"));
  try {
    const exec = async () => { throw new Error("sips indisponível (simulado)"); };
    const svc = realIconService({
      scan: async () => [],
      exec,
      cacheDir: dir,
      monogramPlatform: "darwin",
    });
    const buf = await svc.getIconPng("Fantasma Darwin Fallback");
    assert.ok(Buffer.isBuffer(buf), "sips falhou, mas o rasterizador JS ainda produz um PNG — nunca null");
    assert.equal(buf[0], 0x89);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("PLAT-04: iniciais com acento/CJK/emoji nunca produzem canvas vazio", async () => {
  // normalizeAppLabel já usa NFD+strip de acento em outro lugar deste
  // arquivo; monogramInitials aplica a mesma técnica. Nomes fora do alfabeto
  // A-Z0-9 (CJK, emoji) caem no glifo "?" por caractere (glyphRowsFor), em
  // vez de lançar ou de resolver pra um fallback vazio (canvas em branco).
  //
  // "canvas vazio" seria só o gradiente de fundo, sem tinta: decodifica o
  // PNG de verdade e conta anti-diagonais (x+y constante) com mais de uma
  // cor RGB entre pixels não-transparentes — ver countInkDiagonals acima.
  // O fundo tem RGB determinado só por (x+y) (rasterizeMonogramPixels:
  // `t = (x+y)/diag`), então isso discrimina tinta real sem precisar
  // conhecer c1/c2 (escolhidos por hash do nome via resolveMonogramTokens,
  // não exportada) — corrigido no round 2 de review, achado #1.
  const dir = await mkdtemp(join(tmpdir(), "j5-plat04-unicode-"));
  try {
    const svc = realIconService({ scan: async () => [], cacheDir: dir, monogramPlatform: "win32" });
    for (const name of ["Índice", "日本語アプリ", "🎮 Game Center", "Ção"]) {
      const buf = await svc.getIconPng(name);
      assert.ok(Buffer.isBuffer(buf), `deve gerar PNG pra "${name}"`);
      assert.equal(buf[0], 0x89, `PNG de "${name}" deve ter magic number válido`);
      assert.ok(countInkDiagonals(buf) > 0, `PNG de "${name}" deve ter tinta real, não só o gradiente de fundo`);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("PLAT-04: cacheDir com espaço no caminho funciona (Windows real)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "j5 plat04 space cache "));
  try {
    const svc1 = realIconService({ scan: async () => [], cacheDir: dir, monogramPlatform: "win32" });
    const buf = await svc1.getIconPng("App Com Espaço");
    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf[0], 0x89);
    // Prova de disco de verdade (não só memória): o arquivo mono-*.png
    // precisa existir no path com espaço (via join, não separador
    // hardcoded) — readdir nesse dir, sem passar pelo memPng do svc1.
    const files = await readdir(dir);
    const monoFiles = files.filter((f) => f.startsWith("mono-") && f.endsWith(".png"));
    assert.equal(monoFiles.length, 1, "deve escrever exatamente um arquivo de cache no disco com espaço no path");
    const onDisk = await readFile(join(dir, monoFiles[0]));
    assert.deepEqual([...onDisk], [...buf], "bytes em disco devem bater com o PNG retornado");
    // 2ª instância do serviço aponta pro MESMO dir com cache em MEMÓRIA
    // vazio: só pode bater byte-a-byte se leu do disco, não da memória do
    // svc1 (prova real de "cache em disco", não só "resultado
    // determinístico repetido").
    const svc2 = realIconService({ scan: async () => [], cacheDir: dir, monogramPlatform: "win32" });
    const buf2 = await svc2.getIconPng("App Com Espaço");
    assert.deepEqual([...buf], [...buf2], "cache em disco (path com espaço via join) deve servir o mesmo PNG pra uma instância nova, sem memPng aquecido");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("PLAT-04: theme light usa tokens diferentes de dark (pixels realmente mudam)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "j5-plat04-theme-"));
  try {
    const dark = realIconService({ scan: async () => [], cacheDir: dir, monogramPlatform: "win32", monogramTheme: "dark" });
    const light = realIconService({ scan: async () => [], cacheDir: dir, monogramPlatform: "win32", monogramTheme: "light" });
    const bufDark = await dark.getIconPng("Tema App");
    const bufLight = await light.getIconPng("Tema App");
    assert.ok(Buffer.isBuffer(bufDark) && Buffer.isBuffer(bufLight));
    assert.notDeepEqual([...bufDark], [...bufLight], "dark e light devem gerar PNGs diferentes (tokens distintos)");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("rasterizeMonogramPixels: total para initials sem glifo (CJK) — nunca lança, nunca fica só-fundo", () => {
  const size = 64;
  const pixels = rasterizeMonogramPixels({
    initials: "日", c1: "#0a84ff", c2: "#5e5ce6",
    ink: { r: 255, g: 255, b: 255, a: 0.94 }, size, radiusRatio: 0.19,
  });
  assert.equal(pixels.length, size * size * 4);
  // conta pixels cuja cor foi alterada pelo blend de tinta (glifo "?" de
  // fallback) comparando contra a cor pura do gradiente no mesmo ponto.
  // Pixels totalmente transparentes (alpha 0 — o recorte dos cantos
  // arredondados, fora do retângulo) NÃO contam: eles diferem do gradiente
  // "puro" (RGB fica 0,0,0 ali, ver rasterizeMonogramPixels) mas isso é o
  // fundo do canvas, não tinta — achado do round 2 de review (o teste
  // original contava 92 pixels de canto transparente como "tinta" e por
  // isso não discriminava um glyphRowsFor quebrado que devolvesse []).
  let inkPixels = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      if (pixels[idx + 3] === 0) continue;
      const t = (x + y) / (2 * (size - 1));
      const [r1, g1, b1] = [0x0a, 0x84, 0xff];
      const [r2, g2, b2] = [0x5e, 0x5c, 0xe6];
      const expectedR = Math.round(r1 + (r2 - r1) * t);
      const expectedG = Math.round(g1 + (g2 - g1) * t);
      if (Math.abs(pixels[idx] - expectedR) > 2 || Math.abs(pixels[idx + 1] - expectedG) > 2) inkPixels++;
    }
  }
  assert.ok(inkPixels > 0, "glifo de fallback '?' deve pintar tinta de verdade, não ficar só o fundo");
});

test("cache de monogramas em disco respeita o cap (poda os mais antigos)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "j5-icon-prune-"));
  try {
    const cacheDir = join(dir, ".icon-cache");
    const exec = async (cmd, args) => {
      const out = args[args.indexOf("--out") + 1] ?? args[args.length - 1];
      await writeFile(out, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    };
    const diskMax = 10;
    const svc = realIconService({ scan: async () => [], exec, cacheDir, diskMax });
    for (let i = 0; i < 25; i++) {
      const buf = await svc.getIconPng(`Fantasma-${i}`);
      assert.ok(Buffer.isBuffer(buf));
    }
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(cacheDir)).filter(f => f.endsWith(".png"));
    assert.ok(files.length <= diskMax, `esperava <= ${diskMax} pngs em disco, tem ${files.length}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("normalizePngIcon equaliza margens transparentes no canvas", () => {
  const pixels = Buffer.alloc(4 * 4 * 4);
  for (let y = 1; y <= 2; y++) {
    for (let x = 1; x <= 2; x++) {
      const i = (y * 4 + x) * 4;
      pixels[i] = 255; pixels[i + 1] = 100; pixels[i + 2] = 20; pixels[i + 3] = 255;
    }
  }
  const normalized = normalizePngIcon(rgbaPng(4, 4, pixels), 32);
  assert.deepEqual(alphaBounds(normalized), {
    width: 32, height: 32, minX: 1, minY: 1, maxX: 30, maxY: 30,
  });
});

test("realIconService resolve nome localizado do app para o bundle original", async () => {
  const dir = await mkdtemp(join(tmpdir(), "j5-icon-alias-"));
  const appPath = join(dir, "Calendar.app");
  const bytes = Buffer.from("calendar-png");
  try {
    await mkdir(join(appPath, "Contents", "Resources"), { recursive: true });
    await writeFile(join(appPath, "Contents", "Resources", "calendar.png"), bytes);
    const svc = realIconService({
      scan: async () => [{ name: "Calendar", path: appPath, icon: true }],
      cacheDir: join(dir, ".icon-cache"),
    });
    assert.deepEqual(await svc.getIconPng("Calendário"), bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("realIconService serve png direto sem chamar exec", async () => {
  const dir = await mkdtemp(join(tmpdir(), "j5-png-"));
  const appPath = join(dir, "P.app");
  try {
    await mkdir(join(appPath, "Contents", "Resources"), { recursive: true });
    const bytes = Buffer.from("dados-png");
    await writeFile(join(appPath, "Contents", "Resources", "p.png"), bytes);
    let execCalls = 0;
    const svc = realIconService({
      scan: async () => [{ name: "P", path: appPath, icon: true }],
      exec: async () => { execCalls++; },
      cacheDir: join(dir, ".icon-cache"),
    });
    assert.deepEqual(await svc.getIconPng("P"), bytes);
    assert.equal(execCalls, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("realIconService faz um único scan no TTL (N getIconPng)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "j5-scan-ttl-"));
  const appPath = join(dir, "A.app");
  try {
    await mkdir(join(appPath, "Contents", "Resources"), { recursive: true });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await writeFile(join(appPath, "Contents", "Resources", "a.png"), png);
    let scans = 0;
    const svc = realIconService({
      scan: async () => {
        scans++;
        return [{ name: "A", path: appPath, icon: true }];
      },
      exec: async () => {},
      cacheDir: join(dir, ".icon-cache"),
      ttlMs: 60_000,
    });
    await Promise.all([svc.getIconPng("A"), svc.getIconPng("A"), svc.getIconPng("A")]);
    assert.equal(scans, 1, "scan deve rodar uma vez sob concorrência");
    await svc.getIconPng("A");
    assert.equal(scans, 1, "scan em memória deve cobrir o segundo round");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("realIconService sem app correspondente cai no monograma e cacheia com um único scan", async () => {
  // Assunto deste teste é o fallback pra monograma quando o scan não acha o
  // app (não a rasterização em si) e o CACHE EM MEMÓRIA (memPng) do
  // resultado — roda em qualquer plataforma.
  //
  // PLAT-04: antes disto era medido contando chamadas ao `exec` (sips
  // mockado). Com o rasterizador pure JS, monogramPng no win32 nunca chama
  // exec — então o contador certo agora é `rasterizeMonogram` (deps
  // injetável, mesmo padrão de `exec`/`scan`), que envolve o rasterizador
  // REAL (rasterizeMonogramPixels) só pra contar, sem trocar o resultado.
  //
  // scans e deepEqual sozinhos não provam "cacheia": com ttlMs alto,
  // resolveApps já cacheia o scan (apps.js:597-599). E monogramPng tem o
  // PRÓPRIO cache em disco (readFile(cacheFile) antes de rasterizar de
  // novo) — então mesmo SEM o hit em memPng, a 2ª chamada reentraria em
  // monogramPng e ainda assim acharia o PNG no disco (escrito pela 1ª
  // chamada) sem rasterizar de novo. Por isso o cacheFile de disco é
  // apagado entre as duas chamadas: só o memPng pode entregar buf2 sem
  // rasterizar de novo, porque o fallback em disco deixou de existir.
  const dir = await mkdtemp(join(tmpdir(), "j5-miss-cache-"));
  try {
    let scans = 0;
    let rasterCalls = 0;
    const rasterizeMonogram = (args) => {
      rasterCalls++;
      return rasterizeMonogramPixels(args);
    };
    const svc = realIconService({
      scan: async () => {
        scans++;
        return [];
      },
      iconHelper: null,
      cacheDir: dir,
      ttlMs: 60_000,
      monogramPlatform: "win32",
      rasterizeMonogram,
    });
    const buf1 = await svc.getIconPng("Fantasma");
    assert.ok(Buffer.isBuffer(buf1), "primeira chamada retorna monograma");
    assert.equal(rasterCalls, 1, "1ª chamada rasteriza via rasterizeMonogram");

    const { readdir, unlink } = await import("node:fs/promises");
    for (const f of await readdir(dir)) {
      if (f.endsWith(".png")) await unlink(join(dir, f));
    }

    const buf2 = await svc.getIconPng("Fantasma");
    assert.ok(Buffer.isBuffer(buf2), "segunda chamada retorna monograma cached");
    assert.deepEqual([...buf1], [...buf2], "deve retornar o mesmo monograma cached");
    assert.equal(scans, 1, "scan deve rodar apenas uma vez");
    assert.equal(rasterCalls, 1, "2ª chamada deve vir do cache em memória (memPng): com o cache de disco apagado, um novo monogramPng rasterizaria de novo");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("realIconService miss em memória não rescaneia a cada miss", async () => {
  // Assunto real deste teste é o branch de cache negativo em apps.js
  // (memMiss.has(cacheKey) -> return null): quando NEM o app é encontrado
  // NEM o monograma consegue ser rasterizado, getIconPng deve devolver null
  // nas duas chamadas sem rodar um segundo scan NEM uma segunda tentativa
  // de rasterizar.
  //
  // PLAT-04: o rasterizador pure JS não falha em uso normal (é computação
  // pura), então o truque antigo de "exec no-op que não escreve o PNG" não
  // discrimina mais nada no win32 (exec nem é chamado). O substituto exato
  // é `rasterizeMonogram` injetado lançando — reproduz a MESMA falha
  // genuína de rasterização que o catch{return null} de monogramPng trata,
  // sem depender de plataforma nem mockar sucesso onde a produção falha.
  // rasterCalls é a asserção que prova o cache negativo: sem memMiss, o 2º
  // getIconPng reentraria em monogramPng e chamaria rasterizeMonogram de
  // novo. iconHelper:null remove a variável do helper nativo do macOS.
  const dir = await mkdtemp(join(tmpdir(), "j5-miss-null-"));
  try {
    let scans = 0;
    let rasterCalls = 0;
    const rasterizeMonogram = () => {
      rasterCalls++;
      throw new Error("rasterização falhou (simulado)");
    };
    const svc = realIconService({
      scan: async () => {
        scans++;
        return [];
      },
      iconHelper: null,
      cacheDir: dir,
      ttlMs: 60_000,
      monogramPlatform: "win32",
      rasterizeMonogram,
    });
    const buf1 = await svc.getIconPng("Fantasma");
    const buf2 = await svc.getIconPng("Fantasma");
    assert.equal(buf1, null, "sem app e sem monograma rasterizável, deve devolver null");
    assert.equal(buf2, null, "segunda chamada deve continuar null (cache negativo em memória)");
    assert.equal(scans, 1, "scan deve rodar apenas uma vez, mesmo com dois misses");
    assert.equal(rasterCalls, 1, "2º miss vem do cache negativo (memMiss), não de uma nova tentativa de rasterizar");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("scanAppsDirs com includeSystemApps adiciona Finder de CoreServices com ícone real", async (t) => {
  // guard: só roda em Mac real com Finder — senão skip
  try {
    const fs = await import("node:fs");
    fs.accessSync("/System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns");
  } catch { t.skip("Finder não disponível neste sistema"); return; }
  const apps = await scanAppsDirs([], true);
  const finder = apps.find(a => a.name === "Finder");
  assert.ok(finder, "Finder deve entrar no inventário via path de sistema");
  assert.equal(finder.path, "/System/Library/CoreServices/Finder.app");
  assert.equal(finder.icon, true, "Finder deve ter ícone real detectado (Finder.icns)");
  // sem a flag, o comportamento antigo permanece (não injeta Finder nos testes tmp)
  const plain = await scanAppsDirs([]);
  assert.equal(plain.find(a => a.name === "Finder"), undefined);
});

test("findIconFile respeita CFBundleIconFile do Info.plist (e não a ordem do readdir)", async () => {
  let plutilOk = true;
  try { await import("node:child_process").then(m => m.execFileSync("plutil", ["-help"])); }
  catch { plutilOk = false; }
  const dir = await mkdtemp(join(tmpdir(), "j5-plist-"));
  const appPath = join(dir, "Multi Icon.app");
  try {
    await mkdir(join(appPath, "Contents", "Resources"), { recursive: true });
    await writeFile(join(appPath, "Contents", "Resources", "a.icns"), "primeiro-alfabetico");
    await writeFile(join(appPath, "Contents", "Resources", "z-real.icns"), "icone-real");
    await writeFile(join(appPath, "Contents", "Info.plist"),
      "<?xml version=\"1.0\"?><plist><dict><key>CFBundleIconFile</key><string>z-real.icns</string></dict></plist>");
    const apps = await scanAppsDirs([dir]);
    assert.equal(apps.length, 1);
    if (plutilOk){
      // plutil lê o plist: tem que escolher o ícone nomeado, não o primeiro do readdir
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0a]);
      const exec = async (cmd, args) => {
        const out = args[args.indexOf("--out") + 1];
        await writeFile(out, png);
      };
      const svc = realIconService({ scan: async () => apps, exec, cacheDir: join(dir, ".cache") });
      assert.deepEqual([...await svc.getIconPng(apps[0].name)], [...png], "ícone resolvido via CFBundleIconFile");
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("findIconFile aceita CFBundleIconFile PNG e ignora PNG auxiliar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "j5-plist-png-"));
  const appPath = join(dir, "NotionLike.app");
  try {
    await mkdir(join(appPath, "Contents", "Resources"), { recursive: true });
    await writeFile(join(appPath, "Contents", "Resources", "menuBar.png"), "auxiliar");
    await writeFile(join(appPath, "Contents", "Resources", "icon-production.png"), "real");
    await writeFile(join(appPath, "Contents", "Info.plist"),
      "<?xml version=\"1.0\"?><plist><dict><key>CFBundleIconFile</key><string>icon-production.png</string></dict></plist>");
    assert.equal(await findIconFile(appPath), join(appPath, "Contents", "Resources", "icon-production.png"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
