// PLAT-02 + PLAT-10 — tests for platform/windows/apps.js, the Windows
// listInstalledApps provider behind the Fase 2 contract.
//
// Composition-level tests below inject `collect`/`readFile`/`parseLnk` so
// the whole pipeline (resolve .lnk -> partition-before-dedupe -> merge with
// UWP) is exercised WITHOUT PowerShell or a real Windows filesystem — this
// suite runs on ubuntu-latest CI the same as the rest of the repo. The one
// exception is the final "real machine" block, explicitly gated to win32,
// which calls the real bound provider end-to-end.

import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path/win32";

import {
  makeListInstalledApps,
  resolveLnkEntries,
  classifyPackagedApps,
  mergeAppLists,
  runPowerShellCollect,
  WindowsAppScanError,
  listInstalledApps as realListInstalledApps,
} from "../platform/windows/apps.js";

/** Fake parseLnk: looks up a canned parse result by the fake buffer's own tag string. */
function fakeParseLnkFactory(byTag) {
  return (buf) => {
    const tag = buf.toString("utf8");
    const hit = byTag.get(tag);
    if (!hit) return { resolvedTargetPath: null, strings: {} };
    return { resolvedTargetPath: hit.target ?? null, strings: { arguments: hit.arguments ?? null } };
  };
}

/** Fake readFile: the "file content" is just the lnk path itself (the fake parser's lookup key). */
function fakeReadFile(path) {
  return Buffer.from(path, "utf8");
}

function makeFakeDeps({ lnkFiles = [], byTag = new Map(), startApps = [], appxPackages = [], now = () => 0, ttlMs } = {}) {
  const collectCalls = [];
  const collect = async (opts) => {
    collectCalls.push(opts);
    return { dirErrorCount: 0, lnkFiles, startApps, appxPackages };
  };
  const deps = { collect, readFile: fakeReadFile, parseLnk: fakeParseLnkFactory(byTag), now };
  if (ttlMs !== undefined) deps.ttlMs = ttlMs;
  return { deps, collectCalls };
}

test("PLAT-02: monta a lista final a partir de .lnk (win32) + UWP, exclui desinstalador, dedupe por target, ordenado por nome", async () => {
  const byTag = new Map([
    ["C:\\...\\Zeta.lnk", { target: "C:\\Apps\\Zeta\\zeta.exe" }],
    ["C:\\...\\Alpha.lnk", { target: "C:\\Apps\\Alpha\\alpha.exe" }],
    ["C:\\...\\Alpha (2).lnk", { target: "C:\\Apps\\Alpha\\alpha.exe" }], // mesmo target -> dedupe
    ["C:\\...\\Uninstall Zeta.lnk", { target: "C:\\Apps\\Zeta\\unins000.exe" }], // desinstalador -> excluído
    ["C:\\...\\Run.lnk", { target: null }], // shortcut CLSID sem target -> não é app, descartado
  ]);
  const { deps } = makeFakeDeps({
    lnkFiles: [...byTag.keys()],
    byTag,
    startApps: [{ Name: "Calculadora", AppID: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App" }],
    appxPackages: [{ Name: "Calculator", PackageFamilyName: "Microsoft.WindowsCalculator_8wekyb3d8bbwe" }],
  });
  const listInstalledApps = makeListInstalledApps(deps);
  const apps = await listInstalledApps();

  assert.deepEqual(
    apps.map((a) => a.name),
    ["Alpha", "Calculadora", "Zeta"],
    "ordenado por nome, sem duplicata de target, sem o desinstalador, sem o shortcut CLSID sem target",
  );
  assert.deepEqual(apps.map((a) => a.kind).sort(), ["uwp", "win32", "win32"].sort());
  const calc = apps.find((a) => a.name === "Calculadora");
  assert.equal(calc.kind, "uwp");
  assert.equal(calc.path, "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App");
  assert.equal(apps.some((a) => /unins.*\.exe$/i.test(a.path ?? "")), false, "nenhum target bate unins*.exe");
  // sem duplicata de target path no resultado final
  const targets = apps.filter((a) => a.kind === "win32").map((a) => a.target.toLowerCase());
  assert.equal(new Set(targets).size, targets.length);
});

test("PLAT-02: sanity check amplo — nenhum target no resultado final bate /^unins.*\\.exe$/i, mesmo além dos padrões exatos da regra", async () => {
  // Mesmo diagnóstico mais amplo que scan-apps.mjs aplica sobre `kept`
  // (ADR PROOF-04 §3): a regra em si é mais estreita que o glob unins*.exe;
  // este teste prova que o pipeline composto aqui não deixa passar nada
  // que bata o glob largo, do jeito que o teste em produção deveria vigiar.
  const byTag = new Map([
    ["a.lnk", { target: "C:\\Apps\\Foo\\foo.exe" }],
    ["b.lnk", { target: "C:\\Apps\\Foo\\unins000.exe" }],
  ]);
  const { deps } = makeFakeDeps({ lnkFiles: [...byTag.keys()], byTag });
  const apps = await makeListInstalledApps(deps)();
  const leftover = apps.filter((a) => a.kind === "win32" && /^unins.*\.exe$/i.test(join(a.target).split("\\").pop()));
  assert.deepEqual(leftover, []);
});

test("PLAT-02/PROOF-04 §4c: exclusão roda ANTES do dedupe — o shortcut /i legítimo sobrevive em AMBAS as ordens de caminhamento", async () => {
  const guid = "{5370C587-5FA3-4F85-8287-6483B693690C}";
  const sameTarget = "C:\\Windows\\System32\\msiexec.exe";
  const iFirst = new Map([
    ["install.lnk", { target: sameTarget, arguments: `/i ${guid}` }],
    ["uninstall.lnk", { target: sameTarget, arguments: `/x ${guid}` }],
  ]);
  const xFirst = new Map([
    ["uninstall.lnk", { target: sameTarget, arguments: `/x ${guid}` }],
    ["install.lnk", { target: sameTarget, arguments: `/i ${guid}` }],
  ]);
  for (const [label, byTag] of [["/i primeiro", iFirst], ["/x primeiro", xFirst]]) {
    const { deps } = makeFakeDeps({ lnkFiles: [...byTag.keys()], byTag });
    const apps = await makeListInstalledApps(deps)();
    const win32Apps = apps.filter((a) => a.kind === "win32");
    assert.equal(win32Apps.length, 1, `ordem "${label}": deveria sobrar exatamente 1 app (o /i)`);
    assert.equal(win32Apps[0].name, "install", `ordem "${label}": o sobrevivente deveria ser o shortcut /i, não o /x`);
  }
});

test("ADR-0002 'Claude': um app UWP e um .lnk que compartilham display name NÃO são fundidos — os dois sobrevivem separados", async () => {
  const byTag = new Map([
    ["Claude.lnk", { target: "C:\\Program Files\\Mozilla Firefox\\firefox.exe" }],
  ]);
  const { deps } = makeFakeDeps({
    lnkFiles: [...byTag.keys()],
    byTag,
    startApps: [{ Name: "Claude", AppID: "Claude_pzs8sxrjxfjjc!Claude" }],
    appxPackages: [{ Name: "Claude", PackageFamilyName: "Claude_pzs8sxrjxfjjc" }],
  });
  const apps = await makeListInstalledApps(deps)();
  const claudes = apps.filter((a) => a.name === "Claude");
  assert.equal(claudes.length, 2, "o app UWP 'Claude' e o .lnk 'Claude' (Firefox web app) devem existir como 2 entradas separadas");
  assert.deepEqual(claudes.map((a) => a.kind).sort(), ["uwp", "win32"]);
});

test("path.join sobre um alvo .lnk com espaço no diretório atravessa intacto (Windows real, não separador hardcoded)", async () => {
  const spacedTarget = join("C:\\Program Files (x86)", "Some App", "some app.exe");
  assert.match(spacedTarget, / /, "fixture precisa conter um espaço de verdade");
  const byTag = new Map([
    [join("C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs", "Some App.lnk"), { target: spacedTarget }],
  ]);
  const { deps } = makeFakeDeps({ lnkFiles: [...byTag.keys()], byTag });
  const apps = await makeListInstalledApps(deps)();
  assert.equal(apps.length, 1);
  assert.equal(apps[0].name, "Some App");
  assert.equal(apps[0].path, spacedTarget);
});

test("cache com TTL: uma segunda chamada dentro do TTL não invoca collect() de novo; clearCache() força re-scan", async () => {
  let t = 0;
  const { deps, collectCalls } = makeFakeDeps({ lnkFiles: [], now: () => t, ttlMs: 1000 });
  const listInstalledApps = makeListInstalledApps(deps);

  await listInstalledApps();
  assert.equal(collectCalls.length, 1);
  t += 500;
  await listInstalledApps();
  assert.equal(collectCalls.length, 1, "dentro do TTL, não deveria ter chamado collect() de novo");
  t += 600; // total 1100ms > ttlMs
  await listInstalledApps();
  assert.equal(collectCalls.length, 2, "após o TTL expirar, deveria ter re-escaneado");

  listInstalledApps.clearCache();
  await listInstalledApps();
  assert.equal(collectCalls.length, 3, "clearCache() invalida mesmo dentro do TTL — PLAT-02 exige cache COM invalidação");
});

test("chamadas concorrentes dentro da mesma janela reusam a mesma promise em voo (nunca 2 scans simultâneos)", async () => {
  const { deps, collectCalls } = makeFakeDeps({ lnkFiles: [] });
  const listInstalledApps = makeListInstalledApps(deps);
  const [a, b] = await Promise.all([listInstalledApps(), listInstalledApps()]);
  assert.equal(collectCalls.length, 1);
  assert.deepEqual(a, b);
});

test("erro tipado: falha de collect() propaga um WindowsAppScanError com code estável, e o cache não fica 'preso' com o erro", async () => {
  let shouldFail = true;
  const collect = async () => {
    if (shouldFail) throw new WindowsAppScanError("POWERSHELL_FAILED", "boom");
    return { dirErrorCount: 0, lnkFiles: [], startApps: [], appxPackages: [] };
  };
  const listInstalledApps = makeListInstalledApps({ collect, readFile: fakeReadFile, parseLnk: () => ({}) });
  await assert.rejects(listInstalledApps(), (err) => {
    assert.ok(err instanceof WindowsAppScanError);
    assert.equal(err.code, "POWERSHELL_FAILED");
    return true;
  });
  shouldFail = false;
  const apps = await listInstalledApps();
  assert.deepEqual(apps, [], "depois que collect() para de falhar, uma nova chamada deve ter sucesso (erro não fica cacheado)");
});

test("cancelamento: signal já abortado entre collect() e o merge final rejeita com code ABORTED", async () => {
  const collect = async () => ({ dirErrorCount: 0, lnkFiles: [], startApps: [], appxPackages: [] });
  const listInstalledApps = makeListInstalledApps({ collect, readFile: fakeReadFile, parseLnk: () => ({}) });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(listInstalledApps({ signal: controller.signal }), (err) => {
    assert.ok(err instanceof WindowsAppScanError);
    assert.equal(err.code, "ABORTED");
    return true;
  });
});

test("cancelamento: o AbortSignal é de fato repassado a collect()", async () => {
  let seenSignal;
  const collect = async ({ signal }) => {
    seenSignal = signal;
    return { dirErrorCount: 0, lnkFiles: [], startApps: [], appxPackages: [] };
  };
  const listInstalledApps = makeListInstalledApps({ collect, readFile: fakeReadFile, parseLnk: () => ({}) });
  const controller = new AbortController();
  await listInstalledApps({ signal: controller.signal });
  assert.equal(seenSignal, controller.signal);
});

test("runPowerShellCollect: guarda de plataforma falha tipado e alto fora de win32 (testável em qualquer SO)", async (t) => {
  t.mock.property(process, "platform", "linux");
  await assert.rejects(runPowerShellCollect(), (err) => {
    assert.ok(err instanceof WindowsAppScanError);
    assert.equal(err.code, "UNSUPPORTED_PLATFORM");
    return true;
  });
});

test("resolveLnkEntries: falha de leitura/parse de UM .lnk vira target:null (readError) sem derrubar o scan inteiro", () => {
  const parseLnkThatThrows = () => { throw new Error("corrupt .lnk"); };
  const entries = resolveLnkEntries(["broken.lnk"], { readFile: fakeReadFile, parseLnk: parseLnkThatThrows });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].target, null);
  assert.match(entries[0].readError, /corrupt \.lnk/);
});

test("classifyPackagedApps: só marca 'packaged' quando o AppID tem forma AUMID E a família existe em Get-AppxPackage (nunca por forma isolada)", () => {
  const startApps = [
    { Name: "Calculadora", AppID: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App" }, // confirmado
    { Name: "Ghost App", AppID: "Some.Ghost.Family_abc123!App" }, // forma de AUMID, mas família NÃO está em Get-AppxPackage
    { Name: "Chrome", AppID: "C:\\Program Files\\Google\\Chrome\\chrome.exe" }, // não tem "!"
  ];
  const appxPackages = [{ PackageFamilyName: "Microsoft.WindowsCalculator_8wekyb3d8bbwe" }];
  const packaged = classifyPackagedApps(startApps, appxPackages);
  assert.deepEqual(packaged.map((p) => p.name), ["Calculadora"]);
});

test("mergeAppLists: descarta .lnk sem target resolvido (shortcut CLSID/URL) e não cruza UWP com win32 por nome", () => {
  const win32Kept = [
    { name: "Foo", target: "C:\\Apps\\foo.exe" },
    { name: "Run", target: null },
  ];
  const uwp = [{ name: "Foo", aumid: "Some.Family_x!App" }]; // mesmo nome de exibição que o win32 acima
  const merged = mergeAppLists(win32Kept, uwp);
  assert.equal(merged.length, 2, "os dois 'Foo' (win32 e uwp) devem sobreviver — nunca fundidos por nome");
  assert.deepEqual(merged.map((a) => a.kind).sort(), ["uwp", "win32"]);
});

// --- Máquina real (Windows) ------------------------------------------------
// Gate legítimo: PowerShell + Get-StartApps/Get-AppxPackage + Start Menu
// real só existem em win32. Em CI (ubuntu-latest) este bloco conta como
// skipped -- nomeado explicitamente aqui, não escondido, como pedido pela
// tarefa. Nesta máquina (win32) ele RODA de verdade.
const win32Only = process.platform === "win32" ? {} : { skip: "requer Windows real (PowerShell + Start Menu)" };

test("PLAT-02 end-to-end nesta máquina real: >=122 apps, UWP presente, sem unins*.exe, ordenado, sem target duplicado", win32Only, async () => {
  const apps = await realListInstalledApps();
  assert.ok(apps.length >= 122, `esperava >=122 apps, veio ${apps.length}`);
  assert.ok(apps.some((a) => a.kind === "uwp"), "esperava pelo menos 1 app UWP");
  // Anchorado no BASENAME, não na string inteira (a own product real
  // "IObitUninstaler.exe" deve sobreviver — o teste "sanity check amplo"
  // acima e ADR PROOF-04 §3 explicam por que um match não-ancorado seria
  // um falso positivo aqui).
  for (const a of apps) {
    const path = String(a.path ?? "");
    const base = path.includes("\\") ? path.slice(path.lastIndexOf("\\") + 1) : path;
    assert.doesNotMatch(base, /^unins.*\.exe$/i, `entrada com target de desinstalador: ${JSON.stringify(a)}`);
  }
  const names = apps.map((a) => a.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  assert.deepEqual(names, sorted, "lista final deve estar ordenada por nome");
  const win32Targets = apps.filter((a) => a.kind === "win32").map((a) => a.target.toLowerCase());
  assert.equal(new Set(win32Targets).size, win32Targets.length, "nenhum target duplicado no pool win32");
});
