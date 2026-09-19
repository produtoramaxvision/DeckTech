import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../server.js";

// BRAND-14: as strings de marca do CLIENTE PWA.
//
// BRAND-11 já cobre LICENSE, README e docs/src/main.js
// (test/brand-11-attribution.test.mjs), e BRAND-01 cobriu as quatro
// superfícies de auto-update. Nenhum dos dois olhava `public/index.html`, que
// é literalmente a tela que o usuário vê no celular — ela dizia "Conectar ao
// Dokke" e "Conecte o aparelho ao seu Mac" num produto chamado DeckTech cujo
// diferencial é o host Windows.
//
// O que NÃO pode virar DeckTech e é verificado aqui como negativa:
//  - `window.DokkeAndroid` é o nome da bridge JS injetada pelo APK já
//    instalado no aparelho do usuário. Renomear quebra o APK em campo, mesmo
//    espírito do dual-accept do WIRE-01. UI-08 adiciona
//    `window.DeckTechWindows` AO LADO, não no lugar.
//  - a atribuição ao Felipe Natanael, que a decisão D2 manda preservar e
//    manter VISÍVEL.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = join(ROOT, "public", "index.html");
const SITE = "https://www.produtoramaxvision.com.br";

async function client() {
  return readFile(CLIENT, "utf8");
}

test("BRAND-14: o cliente PWA não anuncia mais a marca Dokke nem um host Mac", async () => {
  const html = await client();

  assert.match(html, /<title>DeckTech<\/title>/, "o título da aba é a marca do produto");
  assert.doesNotMatch(html, /Conectar ao Dokke/, "o cartão de login não pode convidar pra marca antiga");
  assert.doesNotMatch(html, /Connect to Dokke/, "idem no inglês");
  assert.match(html, /"login\.title":\s*"Conectar ao DeckTech"/, "pt-BR");
  assert.match(html, /"login\.title":\s*"Connect to DeckTech"/, "en");

  // "seu Mac" é falso num produto cujo host é Windows. O texto tem que
  // funcionar nos dois, então fala "computador".
  assert.doesNotMatch(html, /ao seu Mac para abrir os apps/, "a descrição não pode prometer Mac");
  assert.doesNotMatch(html, /to your Mac to open apps/, "idem no inglês");
  assert.doesNotMatch(html, /"login\.step2Prefix":\s*"No Mac, abra o"/, "o passo 2 não pode dizer Mac");
  assert.doesNotMatch(html, /no Mac e digite o código/, "o passo 3 não pode dizer Mac");
});

test("BRAND-14: o rodapé do login credita a Produtora MaxVision com link, e preserva a origem (D2)", async () => {
  const html = await client();

  assert.match(html, /"footer\.brand":\s*"DeckTech by"/, "pt-BR: o rodapé é do DeckTech");
  assert.match(html, /"footer\.brand":\s*"DeckTech by"[\s\S]{0,400}?"footer\.origin":\s*"based on Dokke, by Felipe Natanael"/,
    "en: a linha de origem existe no inglês também");
  assert.match(html, /"footer\.origin":\s*"baseado no Dokke, de Felipe Natanael"/,
    "D2: a atribuição ao autor original continua no cliente, não só no README");

  const link = html.match(/<a class="lfoot-link"[^>]*>/);
  assert.ok(link, "o rodapé tem que ter o link da Produtora MaxVision");
  assert.match(link[0], new RegExp(`href="${SITE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), "aponta pro site certo");
  assert.match(link[0], /rel="noopener noreferrer"/, "target=_blank sem noopener entrega window.opener pra página de destino");
  assert.match(link[0], /target="_blank"/, "abre fora do app pra não derrubar a sessão do dock");
});

test("BRAND-14: o fallback de update do cliente aponta pro DeckTech — a QUINTA superfície, que BRAND-01 não listou", async () => {
  const html = await client();

  // BRAND-01 nomeou server.js, docs/src/main.js, DokkeUpdateManager.swift e
  // MainActivity.kt. public/index.html tem DOIS fallbacks hardcoded que
  // ninguém listou. Ficam inertes enquanto ENABLE_VERSION_CHECK=false, e
  // viram um download do APK upstream no dia em que BRAND-12 ligar a flag.
  assert.doesNotMatch(html, /felipenalves\/Dokke/,
    "nenhuma URL do cliente pode apontar pro repositório upstream");
  assert.match(html, /produtoramaxvision\/DeckTech\/releases\/latest\/download\//,
    "o fallback do APK aponta pro DeckTech");
  assert.match(html, /produtoramaxvision\/DeckTech\/releases\/latest"/,
    "o fallback da release do host aponta pro DeckTech");
});

test("BRAND-14: window.DokkeAndroid NÃO é renomeada — o APK instalado depende do nome", async () => {
  const html = await client();
  assert.match(html, /window\.DokkeAndroid/,
    "renomear a bridge quebra o APK que já está no aparelho; UI-08 adiciona window.DeckTechWindows ao lado");
});

test("BRAND-14: o cartão de login renderizado mostra DeckTech e o link clicável", async () => {
  const { port, close } = await startServer({
    port: 0,
    obs: null,
    config: { schemaVersion: 2, revision: 0, pieces: [], pinned: [] },
    appTools: { listInstalledApps: async () => [], listAppProcesses: async () => [] },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForSelector(".login-card .lfoot-link");

    const seen = await page.evaluate(() => {
      const link = document.querySelector(".login-card .lfoot-link");
      const origin = document.querySelector(".login-card .lfoot-origin");
      const title = document.getElementById("loginTitle");
      const cards = [...document.querySelectorAll(".login-card .lfoot")];
      return {
        title: title.textContent.trim(),
        linkText: link.textContent.trim(),
        href: link.getAttribute("href"),
        rel: link.getAttribute("rel"),
        origin: origin ? origin.textContent.trim() : null,
        // a linha do DeckTech tem que ser a ÚLTIMA do cartão, como pedido
        lastIsDeckTech: /DeckTech/.test(cards[cards.length - 1].textContent),
        originVisible: origin ? getComputedStyle(origin).display !== "none" && origin.getBoundingClientRect().height > 0 : false,
      };
    });

    assert.equal(seen.title, "Conectar ao DeckTech");
    assert.equal(seen.linkText, "Produtora MaxVision");
    assert.equal(seen.href, SITE);
    assert.equal(seen.rel, "noopener noreferrer");
    assert.match(seen.origin, /Felipe Natanael/, "D2: a origem aparece renderizada, não só no fonte");
    assert.equal(seen.originVisible, true, "D2 exige VISÍVEL — display:none não conta como preservada");
    assert.equal(seen.lastIsDeckTech, true, "a última linha do cartão é a do DeckTech");
  } finally {
    await browser.close();
    await close();
  }
});
