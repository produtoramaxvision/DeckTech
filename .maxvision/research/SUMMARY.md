# DeckTech — Síntese de pesquisa e roadmap decision-ready

**Data:** 2026-09-17
**Fontes:** as 9 análises de superfície em `.maxvision/research/` + o PRD e o plano de implementação em `docs/plans/2026-08-18-dokke-windows-host-*`
**Repo:** `decktech` — fork de `felipenalves/Dokke` v0.2.8 (MIT, histórico upstream completo)

Toda afirmação aqui é rastreável a `path:linha`. Onde duas análises de origem se
contradizem, o conflito é **nomeado** e recebe resolução explícita ou vira pergunta
aberta na §7 — nenhuma contradição foi suavizada em prosa.

---

## 1. O que é o Dokke, arquiteturalmente

Dokke é **um servidor Node local + três clientes**. Um único processo Node
(`server.js`, 1089 linhas na raiz) sobe um `http(s).Server` e um `WebSocketServer`
compartilhando a mesma porta (upgrade no mesmo listener, `server.js:989-996`), serve
a PWA estática de `public/`, responde a descoberta UDP na porta 3001, e expõe ~20
rotas `/api/*` protegidas por PIN de 4 dígitos + cookie de sessão.

**Dois pontos de entrada, deliberadamente separados:**

- `makeApp(deps)` (`server.js:292`) — o request handler **puro e testável**, sem bind
  de porta. Recebe toda dependência de plataforma por injeção.
- `startServer(opts)` (`server.js:912`) — o bootstrap real: resolve diretório de
  dados por SO, garante PIN, carrega sessões, conecta OBS, faz `listen()`.

**A injeção de plataforma já existe e é o seam do port Windows** (verificado nesta
sessão, `server.js:292-300`): `makeApp` recebe `appTools = { listAppProcesses,
listInstalledApps }` (`:295`), `actions = { activateApp, openWebsite }` (`:296`) e
`iconService = realIconService()` (`:298`).

Os *defaults* são 100% macOS. `apps.js` (707 linhas) usa `lsappinfo`, `plutil`,
`sips` e um helper Swift `DokkeIconHelper.app` via `NSWorkspace`; `actions.js`
(31 linhas) usa `open -a` e `osascript`. **Nenhuma rota HTTP ou mensagem WS precisa
mudar para Windows** — o contrato já é neutro (`{name,path,icon}` para apps
instalados, `{name,pid,type}` para processos, PNG binário para ícone).

**O que é portável como está:** todo o roteamento HTTP, o protocolo WS, o CSRF por
`sameOrigin` (`server.js:66-77`), a concorrência otimista por `revision`
(`server.js:345-349`), `obs.js`/`obs-ws.js` (WebSocket puro, zero shell-out), e todo
o pipeline puro-JS de PNG em `apps.js` (`decodeRgbaPng`, `normalizePngIcon`,
`pngChunk`) que recorta a margem transparente e reencaixa num canvas fixo.

**Protocolo WS:** servidor→cliente manda `{type:"online"}` na conexão e
`{type:"apps", pieces, revision, pinned, running, devices, v, limits}` a cada mudança
ou a cada 1500ms, com dedupe por payload serializado (`server.js:261`);
cliente→servidor só manda `{type:"ping"}`, rate-limitado a 1500ms
(`server.js:1008-1016`). Heartbeat WS nativo de 30s mata conexões mortas.

**Persistência:** `config.json`, `.j5-pin` e `j5-sessions.json` vivem em
`userDataDir()` (`server.js:928-933`) — `%APPDATA%\Dokke` no Windows,
`~/Library/Application Support/Dokke` no macOS. Fora do bundle, sobrevive a
reinstalação por construção.

**Os clientes:**

| Cliente | O que é | Tamanho |
|---|---|---|
| **PWA companion** (`public/index.html`) | Arquivo único monolítico: CSS inline (19-747), markup (748-812), um IIFE clássico não-module (813-3111). Login por PIN, launchpad, Recents, drawer OBS. | 3113 linhas |
| **Host macOS** (`mac/Sources/`) | App SwiftUI que envolve o Node como processo filho. Sidebar + dock 4×2 + app picker + tela Conectar. **É a referência visual do host Windows** (PRD §7). | 4023 linhas |
| **Companion Android** (`android/`) | Activity única, WebView shell que carrega a PWA. Adiciona painel offline nativo, bridge JS `DokkeAndroid` (5 métodos), descoberta UDP, pipeline de update de APK. | 954 linhas Kotlin |

Mais uma **landing** (`docs/`, projeto Vite 8 separado) e um **harness de testes**
(`node --test` sobre `test/*.test.mjs`, 36 arquivos).

**O que NÃO existe:** `platform/` e `windows/` não existem no tree (verificado:
`ls -d platform windows` → *No such file or directory*). O PRD e o plano de 7 tasks
foram especificados e **nunca implementados**.

---

## 2. Registro de ativos herdados — o que já funciona e não pode regredir

### 2.1 Core server (`server.js`, `apps.js`, `actions.js`, `obs*.js`)

| Ativo | Evidência | Por que não pode regredir |
|---|---|---|
| Injeção de plataforma completa | `server.js:295,296,298` + `apps.js:559-573` | É o seam inteiro do port Windows; quebrar isso reescreve Tasks 1-3 |
| Concorrência otimista por `revision` | `server.js:345-349`, incrementada em 6 pontos de mutação | Único mecanismo que impede dois clientes se sobrescreverem |
| Dedupe de in-flight (3 ocorrências) | `apps.js:66`, `:243-259`, mapa `loadInflight` | Evita fork/scan duplicado sob poll de 1500ms |
| Cache de ícone em 3 camadas | LRU `MEM_PNG_MAX=40`, disco `DISK_PNG_MAX=256` com poda por mtime | O PRD §10 exige ícones assíncronos e cacheáveis; isso já está pronto |
| Pipeline puro-JS de PNG | `apps.js:396-525` | Funciona sem alteração assim que receber um bitmap Windows |
| Startup captura `EADDRINUSE` limpo | `server.js:1034-1058` (handlers registrados **antes** do `listen`) | Mapeia direto para RF-11 ("porta ocupada" vira mensagem, não crash) |
| OBS degrada graceful | `obs-ws.js:20` devolve `null` sem password; toda rota `/api/obs/*` responde `{connected:false}` | OBS desconfigurado nunca bloqueia startup |

### 2.2 Auth e config (`auth.js`, `config.js`)

| Ativo | Evidência |
|---|---|
| `safeEqual` constant-time via digests SHA-256 | `auth.js:100-104` — evita vazamento de tamanho e short-circuit por byte |
| Sessão em disco guarda só `sha256(token)` + expiração | `auth.js:145-146` — arquivo roubado não dá login |
| Escrita atômica tmp+rename **com fallback** | `auth.js:129-141` (verificado: `catch` cai para `writeFile` direto) |
| Cookie legado de PIN cru é apagado a cada login | `auth.js:64-68`, aplicado em `server.js:429` |
| Migração condicional de config/PIN (copia, nunca sobrescreve) | `server.js:939-946`, `:950-954` — é o padrão a reusar no rebrand |
| Rotação de PIN revoga todas as sessões | `server.js:961-966` |

### 2.3 PWA companion (`public/index.html`)

| Ativo | Evidência |
|---|---|
| **Um único caminho de merge** para WS-push e HTTP-poll (`applyAppsPayload`) | `index.html:2302-2338` — zero divergência de tratamento |
| Motor de gestos com paridade de curva PWA↔WebView Android | `index.html:2593-2645` — bisseção de Newton em 8 iterações sobre `cubic-bezier(.22,1,.36,1)`, dirigindo `scrollLeft` por rAF. **Uma transição CSS não reproduz isso** |
| Reconexão WS com backoff 2s→30s, pausada com página oculta | `index.html:2371-2378` |
| SW network-first em navegação, cache-first em assets, `/api/*` bypass total | `sw.js:16,26-34,39-47` — evita kiosk preso em HTML velho |
| Slots posicionais e persistentes (não push-fill) | `renderLaunchpad`, `index.html:1647-1652` |

### 2.4 Host macOS (`mac/Sources/`) — a referência visual

| Ativo | Evidência |
|---|---|
| Preflight adopt-vs-conflict-vs-spawn antes de subir servidor | `ServerManager.swift:173-217`; só `ECONNREFUSED` conta como "porta livre" (`:282-294`) |
| Servidor adotado **nunca** é morto no shutdown | `ServerManager.swift:383-397` |
| Escrita otimista com rollback ao snapshot pré-mutação | `DockStore.swift:393-476` |
| Invalidação de cache de ícone por mudança de aparência do sistema | `DockStore.swift:88-119` |
| Grid 4×2 com aritmética auto-consistente | `4×80 + 3×22 + 2×32 = 450` = `carouselMinPageWidth` exato (`DockGridView.swift:16-23,195`) |
| Drag-reorder respeita `accessibilityReduceMotion` | `DockGridView.swift:364-411` (o jiggle **não** — ver backlog) |

### 2.5 Companion Android (`android/`)

| Ativo | Evidência |
|---|---|
| Guarda de supply-chain em 4 camadas antes de instalar APK | `MainActivity.kt:472-527` — package name, versionName, versionCode e **igualdade de certificado de assinatura** |
| Dois pontos independentes de consentimento humano | diálogo próprio de unknown-sources (`:439-449`) + instalador do OS (`:529-544`) |
| Toda URL passa por `ServerUrl.normalize` antes de storage ou `loadUrl` | `ServerUrl.kt:14-35` — rejeita `javascript:`, `file:`, userinfo, porta fora de faixa |
| `DokkeConnectionStore.read()` auto-cura prefs corrompido | `DokkeConnectionStore.kt:9-16` |
| Descoberta UDP bounded (~7-8s) e nunca na UI thread | `MainActivity.kt:298-341` |
| WebView endurecida | `allowFileAccess=false`, `allowContentAccess=false`, `javaScriptCanOpenWindowsAutomatically=false` (`:144-154`) |
| **Validação empírica em hardware real** | Galaxy S10e SM-G970F/Android 12/SDK 31: `assembleDebug` OK, 10/10 testes JUnit, install + foreground + zero crash/ANR |

### 2.6 Landing (`docs/`)

| Ativo | Evidência |
|---|---|
| Rampa de motion em 3 tempos no hero | 520ms idle → 140ms tracking → 90ms pressed (`style.css:171,174-177,179-183`) |
| Clamp de parallax ±4px / ±2deg | `main.js:404-406` — vivo sem ser enjoativo |
| Sombra colapsa em sincronia com o `scale(.95)` | `style.css:168,181` |
| Escrita coalescida por rAF, `will-change` só na janela de tracking | `main.js:358-360`, `style.css:177` |
| `.nav-shell` — o glass mais refinado do produto | `blur(17px)` + dual box-shadow (`style.css:71-83`) |

### 2.7 Harness de testes (`test/`)

| Ativo | Evidência |
|---|---|
| DI real no core server, testes rápidos e isolados | `port:0`, `config`, `configFile`, `trustLoopback`, `appTools`, `actions`, `obs` |
| Fixtures geradas por `mkdtemp`, zero binário commitado | inclusive PNGs sintetizados byte a byte com CRC32 real (`icon.test.mjs:358-380`) |
| Teste de paridade i18n cross-surface | `issue-19-i18n.test.mjs:418-428` — o único que trata i18n como contrato entre superfícies |
| Pins que **devem** quebrar num fork | `release-version.test.mjs` (versão em 5 arquivos), `brand-icon-assets.test.mjs` (5 hashes SHA-256) — são forcing functions corretas |

---

## 3. A decisão do host Windows e o que ela faz com o plano de 7 tasks

### 3.1 Decisão: **Electron**. Confiança alta.

Não porque o PRD já assumia — a premissa foi reaberta e testada em Windows 11 Pro
22631 — mas porque **a única vantagem real do Tauri (footprint) otimiza uma variável
que o PRD não restringe, e seu único ganho técnico genuíno (Rust falando Win32
direto) não alcança o código que precisa dele.**

**Os dois fatos que decidem:**

1. **O PRD não tem orçamento de tamanho nem de RAM.** §10 exige apenas descoberta e
   ícones assíncronos e cacheáveis; §14 mede instalação-até-servidor-online,
   companion conectado, falhas de ícone/foco e crashes. **Nenhuma métrica de MB.**
2. **O adaptador de plataforma vive em Node, por decisão de arquitetura já tomada**
   (`server.js:295-298`, `apps.js:559-573`, e Task 3 Step 3 manda trocar "somente o
   provider de plataforma"). Sob Tauri você ainda faria PowerShell/COM/FFI a partir
   do Node — a menos que mova o adaptador para o shell e invente IPC, o que viola o
   princípio 4 do PRD §6 e reescreve Tasks 1-3.

### 3.2 Critérios que o senso comum superpondera — desmontados

| Critério | Veredito | Evidência |
|---|---|---|
| **Glass/Mica** | Empate técnico, e **irrelevante** | Electron com `backgroundMaterial:'mica'` → `DWMWA_SYSTEMBACKDROP_TYPE(38)` lido do DWM: `hr=0 value=2` **[MEDIDO]**. Tauri tem equivalente **[DOC]**. Mas o app Mac tem só **5 call sites de glass**, todos com fallback plano obrigatório — **o fallback plano é o alvo real de paridade** |
| **Auto-update** | Não é critério | RF-10 diz literalmente que atualização automática silenciosa não é requisito do MVP |
| **Assinatura de código** | Idêntica | OV/EV ou Azure Trusted Signing + signtool + reputação SmartScreen. electron-builder suporta `win.sign type azure` **[DOC]**; Tauri usa `certificateThumbprint` **[DOC]** |
| **Embutir Node** | **Electron ganha decisivo** | `utilityProcess.fork` cria "a child process with Node.js and Message ports enabled" e a doc de process-model manda preferi-lo a `child_process.fork` **[DOC]** — custo marginal **zero byte**. Tauri exige `node.exe` de **90,74 MB [MEDIDO]**, ou `pkg` (última versão 5.8.1, sobre um repo ESM puro) ou SEA com `postject` em **1.0.0-alpha.6 [MEDIDO]** |
| **Testabilidade** | **Electron ganha mensurável** | `_electron.launch()` funciona com `PLAYWRIGHT_BROWSERS_PATH` apontando para diretório vazio; `chromium.launch()` falha no mesmo processo **[MEDIDO]**. Task 5 vira teste de DOM real, não regex sobre fonte |

### 3.3 A derrota honesta: footprint

O Tauri produz um app menor. Runtime Electron descompactado medido em dois apps
reais desta máquina: **257,8 MB** e **272,6 MB**; app mínimo ocioso **268,9 MB** em 4
processos **[MEDIDO]**. Mas a comparação justa inclui o sidecar: o piso de RAM do
produto é o servidor Node (**68,6–71,2 MB [MEDIDO]**), idêntico nas duas stacks, e
sob Tauri o `node.exe` de 90,74 MB apaga boa parte da vantagem de disco.
**Se aparecer orçamento explícito de footprint no PRD, esta decisão se reabre.**

### 3.4 Consequências para o plano de 7 tasks

| Task | Sob Electron | Sob Tauri v2 |
|---|---|---|
| 1 — contrato de plataforma | **sobrevive integral** | sobrevive integral |
| 2 — descoberta de apps | **sobrevive integral** | sobrevive integral |
| 3 — ícones/processos/ações | **sobrevive integral e mais barato** (ver §3.5) | sobrevive + travessia de IPC |
| 4 — shell desktop | **sobrevive e SIMPLIFICA** — `server-process.js` fica fino com `utilityProcess` (`child.pid`, `on('exit')`, `stdout`, MessagePort entregam direto os ganchos que a Task 4 testa) | **descartada** — vira `src-tauri/` Rust + sidecar + plugins |
| 5 — UI desktop | **sobrevive integral, e a validação fica MELHOR que o previsto** | HTML/CSS/JS sobrevive; **validação descartada** (tauri-driver + msedgedriver versionado) |
| 6 — empacotar/instalar | **sobrevive integral** | **descartada** — vira `tauri.conf.json` |
| 7 — docs | sobrevive | sobrevive |

**Electron: 7 de 7 sobrevivem, 1 simplifica. Tauri: 4 de 7.** Descartar ~40% de um
plano TDD aprovado para otimizar uma variável sem restrição é o argumento decisivo.

### 3.5 Duas correções a análises anteriores (não repassar as versões antigas)

1. **TEST-HARNESS §8 afirma que o ponto de injeção de ícone da Task 3 "may not exist
   yet". Ele existe.** Verificado nesta sessão: `iconService = realIconService()` em
   `server.js:298`, e `realIconService(deps)` em `apps.js:559-573` aceita
   `scan`/`findIcon`/`exec`/`cacheDir`/`iconHelper`, com comentário em
   `apps.js:562-563` citando Windows nominalmente. **Task 3 é mais barata que o
   estimado. Não colocar "verificar o seam de ícone" no backlog — está resolvido.**
2. **TEST-HARNESS implica que o defeito de `playwright install` no CI bloquearia a
   validação da Task 5. Não bloqueia, para Electron** (§3.2, medido). O defeito
   continua real para `test/ui.test.mjs`, que usa `chromium.launch()`, e deve ser
   corrigido — mas não está no caminho crítico do host Windows.

### 3.6 O trabalho Windows que ainda não tem solução escolhida

- **Ícones (RF-04).** `app.getFileIcon()` satura em **48×48 em `.exe` e 32×32 em
  `.lnk` [MEDIDO]**, abaixo dos ~136px que o dock Mac exige (68pt em Retina). O
  caminho que atende é `IShellItemImageFactory::GetImage` a 256×256 — **20/20
  sucesso, 43,2 ms/ícone, ~23 KB PNG [MEDIDO]** — ou seja ~5,3s para 122 apps, o que
  torna o requisito de assincronia do PRD §10 **obrigatório**. Mecanismo (N-API vs
  koffi vs pool de PowerShell) **não decidido**.
- **Descoberta (RF-03).** 182 `.lnk` enumerados em 8 ms; resolver cada um para o
  `.exe` alvo via COM `WScript.Shell` custa **2395 ms para 149 (~16 ms cada)
  [MEDIDO]**; dedupe por target path → 122 apps. Dois achados: entrou lixo real
  (`Uninstall DJI Assistant 2 → unins000.exe`), e **apps UWP/Store não aparecem**
  (`.lnk` não cobre `shell:AppsFolder`) — **caminho nunca implementado nem medido**.
- **Foco (RF-06).** `SetForegroundWindow` é restrito quando o chamador não tem
  foreground. A decisão do PRD §15 ("aceitar abrir nova instância quando foco
  falhar") está correta, mas precisa de **erro tipado** — hoje toda falha colapsa
  num 500 genérico, violando PRD §8.3 **inclusive no macOS**.

---

## 4. A design language, condensada

**Nome: "Warm Obsidian Glass."**

**O achado que muda o brief:** a percepção de "glass tipo iOS/macOS novo" está
correta, mas **o mecanismo não é o que parece — o glass do Dokke é PINTADO, não
borrado.** A superfície-assinatura `.aglass` (todo tile de todo screen do companion)
tem **zero `backdrop-filter`**. `backdrop-filter` aparece 6 vezes em 3113 linhas,
que são **4 superfícies únicas**, todas overlays transitórios que borram o conteúdo
do próprio app, nunca o desktop.

**Consequência para Windows:** o problema de paridade é **muito menor** que "Windows
não faz Liquid Glass". Os tiles são CSS e portam 1:1 com delta zero. Os 4 overlays
borrados funcionam idênticos no Chromium. As lacunas genuínas são (a) geometria da
área de caption e (b) a camada macOS-26 — e (b) **já tem fallback plano em produção,
que é ele próprio o alvo de paridade**.

**Oito características verificáveis:**

1. **Chão near-black quente, não neutro.** `#080301` (`index.html:38`) — enviesado
   para vermelho, nunca `#000`, nunca dark-theme azulado.
2. **Fonte de luz ember acima e atrás.** Radial full-bleed fixo, laranja a 46% alpha,
   ancorado em `50% -10%` (`index.html:61-72`). Tudo na UI é iluminado por ele.
3. **Um único ângulo de luz rasante: ~160°** em conteúdo, **165°** em chrome. Essa
   repetição é a razão mais forte de a UI ler como "glass".
4. **O glass é edge-lit, não borrado.** Todo surface pareia um `inset 0 1–1.5px 0
   rgba(255,255,255,.22–.35)` com uma borda quente de 1–1.5px.
5. **Raios proporcionais (squircle).** Tile = **29% da largura** via container
   queries (`--tile-r`, `index.html:164`/`:324`); macOS usa `.continuous` em tudo.
6. **Chrome content-first.** Sem rótulo sob os tiles no companion, sem scrollbar
   visível em lugar nenhum, title bar oculto no macOS, separadores hairline de 1px.
7. **Paleta de sistema Apple para semântica, laranja para o produto.**
8. **Motion curto (160-300ms), duas curvas apenas, contínuo ao gesto.**

**Contraste intencional que não pode ser "unificado":** canvas e tiles são **quentes**;
modais e chrome usam **near-black frio** (`rgba(2,4,10)`, `rgba(16,17,26)`,
`rgba(24,26,38)`, `rgba(28,34,54)`). O chrome lê como glass **acima** de um cômodo
quente.

### 4.1 Tabela de tokens (transcrita literal — provenance por `path:linha`)

```css
:root {
  /* ground */
  --dt-canvas:        #080301;                        /* index.html:38 */
  --dt-canvas-mac:    #292120;                        /* DokkeTheme.swift:4  — desktop host */
  --dt-page:          #1B1107;                        /* DokkeTheme.swift:5 */
  --dt-ember-1:       rgba(232,111,39,.46);           /* index.html:68 */
  --dt-ember-2:       rgba(184,76,20,.28);            /* index.html:69 */
  --dt-ground-top:    #241106;                        /* index.html:70 */
  --dt-ground-mid:    #150804;                        /* index.html:70 */

  /* ink */
  --dt-ink:           rgba(255,255,255,.94);          /* index.html:21 */
  --dt-ink-2:         rgba(255,255,255,.62);          /* index.html:22 */
  --dt-ink-3:         rgba(255,255,255,.50);          /* index.html:23 */

  /* semantic */
  --dt-accent:        #0a84ff;                        /* index.html:24 */
  --dt-accent-alt:    #0A63D9;                        /* DokkeTheme.swift:6 — mac selection */
  --dt-green:         #30d158;                        /* index.html:25 */
  --dt-amber:         #ffd60a;                        /* index.html:26 */
  --dt-red:           #ff453a;                        /* index.html:27 */
  --dt-red-text:      #ff837d;                        /* index.html:621 */

  /* glass */
  --dt-glass-angle:        160deg;                    /* index.html:253 — content */
  --dt-glass-angle-chrome: 165deg;                    /* index.html:622 — chrome   */
  --dt-glass-tile:    linear-gradient(160deg, rgba(255,255,255,.24), rgba(210,95,30,.18) 55%, rgba(35,16,8,.75));
  --dt-glass-border:  rgba(240,135,55,.40);           /* index.html:254 */
  --dt-glass-inset:   inset 0 1.5px 0 rgba(255,255,255,.35);  /* index.html:255 */
  --dt-glass-bloom:   0 0 18px rgba(210,95,30,.22);   /* index.html:255 */
  --dt-blur-chrome:   blur(18px) saturate(150%);      /* index.html:668 */
  --dt-blur-modal:    blur(24px) saturate(145%);      /* index.html:629 */
  --dt-blur-scrim:    blur(20px) saturate(150%);      /* index.html:700 */

  /* elevation */
  --dt-elev-1:        0 8px 18px rgba(0,0,0,.45);     /* index.html:255 */
  --dt-elev-2:        0 14px 40px rgba(0,0,0,.45);    /* index.html:671 */
  --dt-elev-3:        0 24px 60px rgba(0,0,0,.55);    /* index.html:627 */

  /* radii — proporcionais primeiro */
  --dt-r-tile:        0.29;    /* x largura do tile — index.html:164 */
  --dt-r-tile-icon:   0.19;    /* x largura do tile — index.html:166 */
  --dt-r-icon-scale:  0.84;    /* x largura do tile — index.html:165 */
  --dt-r-card:        40px;    /* DockGridView.swift:202 */
  --dt-r-tile-mac:    28px;    /* DockIcon.swift:477 */
  --dt-r-sidebar:     18px;    /* ContentView.swift:170 */
  --dt-r-modal:       28px;    /* index.html:625 */
  --dt-r-sheet:       30px;    /* index.html:594 */
  --dt-r-auth:        32px;    /* index.html:706 */
  --dt-r-control:     16px;    /* index.html:615 */
  --dt-r-row:         6px;     /* ContentView.swift:148 */

  /* spacing — base 2px */
  --dt-s-1: 4px;  --dt-s-2: 6px;  --dt-s-3: 8px;  --dt-s-4: 10px;
  --dt-s-5: 12px; --dt-s-6: 14px; --dt-s-7: 16px; --dt-s-8: 18px;
  --dt-s-9: 20px; --dt-s-10: 22px; --dt-s-11: 24px; --dt-s-12: 28px;
  --dt-s-13: 32px; --dt-s-14: 40px;

  /* motion */
  --dt-ease:          cubic-bezier(.22,.61,.36,1);    /* index.html:244 */
  --dt-ease-settle:   cubic-bezier(.22,1,.36,1);      /* index.html:2599 */
  --dt-dur-micro:     160ms;   /* index.html:320 */
  --dt-dur-fast:      180ms;   /* index.html:596 */
  --dt-dur-base:      220ms;   /* index.html:2703 */
  --dt-dur-snap:      250ms;   /* index.html:2574 */
  --dt-dur-press:     300ms;   /* index.html:244 */

  /* type */
  --dt-font-ui:       "Inter", -apple-system, "SF Pro Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
  --dt-font-display:  "Bricolage Grotesque", var(--dt-font-ui);
  --dt-font-mono:     ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace;
}
```

### 4.2 Geometria do host desktop (valores fixos do macOS — alvo de paridade)

```
pageSize 8   maxPageCount 5   tileSize 80   tileSpacing 22   pageHeight 288
carouselGap 24   carouselPeekRatio 0.55   carouselMaxPageWidth 458   carouselMinPageWidth 450
page card padding 32h / 29v    iconSize 68   iconCardSize 80   cornerRadius 20 (clip interno)
janela: min 840x540, default 980x628   sidebar 208pt   header 32pt   inset do chrome 8pt
picker sheet 480x620 sobre scrim black .48    QR 112x112    PIN digits 64x76
```

### 4.3 Duas curvas de easing, e elas não são a mesma

- `cubic-bezier(.22, .61, .36, 1)` — UI de produto: press do tile (300ms), rotação de
  ícone (180ms), slide de tela (220ms / 200ms no WebView Android).
- `cubic-bezier(.22, 1, .36, 1)` — snap horizontal do launchpad (resolvido
  numericamente em JS) e parallax do hero da landing (520ms).

`.22,1,.36,1` é easeOutQuint-like: sai rápido e assenta muito macio. **Não
substituir uma pela outra.**

### 4.4 Decisões já tomadas pela design language (não reabrir)

- **DEC-01 — Canvas.** O shell Windows usa **`#292120`** (`DokkeTheme.canvas`); o
  companion que ele serve mantém **`#080301`**. Os dois clientes nunca estão na tela
  juntos.
  > **Conflito interno nomeado:** a §11.1 de DESIGN-LANGUAGE recomenda
  > `backgroundColor: #080301` para a janela Electron, contradizendo a própria
  > DEC-01. **DEC-01 governa** (é a seção de decisões explícitas); o hex da §11.1 é
  > um lapso. Não inventar um terceiro valor.
- **DEC-02 — Raios.** Desktop usa os valores macOS (card 28/80 = 0.35, ícone
  20/68 = 0.29); o companion mantém 0.29/0.19 proporcionais. O que os dois
  **compartilham** é a razão de **tamanho** ícone/card, travada em **0.85** — é isso
  que faz o tile ler como o mesmo objeto nos dois clientes.
- **Mica é armadilha, não feature.** Mica e Acrylic amostram **o wallpaper do
  usuário**. Aplicá-los à janela principal **apaga a identidade do produto** — o
  ember canvas some. Default: `backgroundMaterial` em `none`, `backgroundColor`
  opaco, ember pintado em CSS exatamente como o companion faz. Também **não** usar
  `transparent: true`: no Electron isso mata sombra, resize e blur de sistema.

---

## 5. Backlog priorizado — todas as otimizações e lacunas, deduplicadas

Tags: **`blocks-windows-host`** · **`blocks-rebrand`** · **`quality`** ·
**`nice-to-have`**. Esforço: S (< 1 dia), M (1-3 dias), L (> 3 dias).
Ordenado por valor/esforço decrescente dentro de cada tag.

### 5.1 `blocks-windows-host`

| # | Item | Evidência | Esf. | Reportado por |
|---|---|---|---|---|
| W1 | **Cadeia de fallback de ícone morre no `sips` mesmo no último degrau** (`monogramPng` chama `sips` em `apps.js:549`, binário exclusivo macOS). Hoje em Windows a cadeia inteira falha silenciosa e o app fica **sem ícone nenhum** em vez de degradar para monograma. RF-04 não é satisfeito de graça. Fix: rasterizar o monograma em JS puro (o encoder PNG já existe em `apps.js:474-525`) | `apps.js:549` (verificado) | M | CORE-SERVER, WINDOWS-STACK §6.2 |
| W2 | **`platform/index.js` inexistente** — o único ponto sem injeção é o default de `iconHelper`, que ramifica em `process.platform === "darwin"` sem branch `win32` (`apps.js:571`). Criar a fábrica explícita que resolve `{listInstalledApps, listAppProcesses, activateApp, openWebsite, iconService}` por SO | `apps.js:571` (verificado) | S | CORE-SERVER, WINDOWS-STACK |
| W3 | **Falha de `activateApp` vira 500 genérico** — `fail()` (`server.js:133-137`) sempre devolve `{ok:false,error:"erro interno"}`. PRD §8.3/RF-06 exige mensagem compreensível no companion. **Já violado no macOS**; no Windows as falhas de foco serão de outra natureza (`SetForegroundWindow` restrito) | `server.js:133-137`, `actions.js:18-26` | M | CORE-SERVER, WINDOWS-STACK §6.3 |
| W4 | **Loopback trust assume single-user.** `trustLoopback` default `true` (`server.js:395,970`); qualquer processo local não-privilegiado, outro usuário interativo, ou sessão RDP no mesmo host tem acesso total a `/api/*` — incluindo `GET /api/pin`, que devolve o PIN em texto puro (`server.js:458`), numa superfície cujo propósito é lançar apps locais. **O Windows quebra a premissa estruturalmente** | `auth.js:58-62`, `server.js:395,458,970` | M | AUTH-CONFIG risco 1, WINDOWS-STACK risco 7 |
| W5 | **Mecanismo de ícone 256px não escolhido** — `app.getFileIcon` satura em 48x48 em `.exe` e 32x32 em `.lnk` [MEDIDO]; `IShellItemImageFactory` a 43,2ms/ícone atende mas precisa de N-API vs koffi vs pool PowerShell decidido antes da Task 3 | WINDOWS-STACK §6.2 | M | WINDOWS-STACK |
| W6 | **Enumeração de apps UWP/Store nunca implementada nem medida** — `.lnk` não cobre `shell:AppsFolder`; Calculadora/Fotos/Terminal ficam de fora. Trabalho de Fase 0 | WINDOWS-STACK §6.1 | M | WINDOWS-STACK |
| W7 | **Regra de exclusão de desinstaladores** — o scan medido trouxe `Uninstall DJI Assistant 2 → unins000.exe`. RF-03 precisa de exclusão, não só dedupe por target path | WINDOWS-STACK §6.1 [MEDIDO] | S | WINDOWS-STACK |
| W8 | **Resolução `.lnk` é o gargalo:** 16ms cada via COM, 2395ms para 149. Ler o binário `.lnk` direto em Node mataria isso — **não validado** | WINDOWS-STACK §6.1 | M | WINDOWS-STACK |
| W9 | **`config.js` não tem o fallback de rename atômico que `auth.js` tem.** `saveConfig` (`config.js:195-201`, verificado: `await rename(tmp, file)` sem `catch`) propaga a exceção e deixa `.tmp` órfão; no Windows `rename()` falha com EPERM/EBUSY sob AV/Indexer/OneDrive. `auth.js:135-138` já tem o padrão certo | `config.js:198-200` vs `auth.js:135-138` (verificados) | S | AUTH-CONFIG |
| W10 | **`chmod(0o600)` não protege nada no Windows** (só alterna o bit read-only); a proteção do `.j5-pin` depende inteiramente da ACL NTFS herdada, que inclui Administrators/SYSTEM. Precisa de ACL explícita (icacls) ou DPAPI | `auth.js:40,42,50,134` | M | AUTH-CONFIG |
| W11 | **`%APPDATA%` é Roaming** — em máquina domain-joined com perfis roaming, o PIN em texto puro replica para fora da máquina. `%LOCALAPPDATA%` é o alvo correto para segredo local-only | `server.js:930` (verificado) | S | AUTH-CONFIG |
| W12 | **Sem equivalente Windows de `readMacIconAppearance`** (`apps.js:281`, dark/light do ícone). O plano de 7 tasks **não lista** task para isso. Windows seria a chave `Personalize\AppsUseLightTheme` no HKCU | `apps.js:281-291` | M | CORE-SERVER, DESIGN-LANGUAGE §8 |
| W13 | **`opts.root` é overloaded** entre raiz estática (`makeApp`, `server.js:294`) e `pinRoot` (`startServer`, `server.js:949`). Se o shell Electron passar `opts.root` apontando para o diretório servido, `GET /.j5-pin` serve o PIN sem auth (o handler estático só guarda path traversal, não dotfiles). Footgun latente, **não exercitado por teste nenhum hoje** | `server.js:294,891-893,949` | S | AUTH-CONFIG risco 4 |
| W14 | **Geometria da área de caption não tem port mecânico.** macOS reserva clearance à **esquerda** (offset `+12/-10` dos traffic lights reais, `ContentView.swift:207-316`) e dispõe header e sidebar em torno disso. No Windows os botões são desenhados pelo sistema e ficam à **direita**. Precisa de design from-scratch | `ContentView.swift:60-80,119-131,207-316` | M | MACOS-APP, DESIGN-LANGUAGE §11.3 |
| W15 | **`ServerManager` adota servidor só com igualdade exata de string de versão** (`ServerManager.swift:255-280`) — qualquer drift de patch trata um servidor saudável do mesmo app como conflito. **Ao portar para a Task 4, não portar o bug**: usar comparação semântica | `ServerManager.swift:255-280` | S | MACOS-APP, WINDOWS-STACK risco 6 |
| W16 | **PWA precisa de bridge `window.DokkeWindows` ou no-ops explícitos** espelhando os 5 métodos de `window.DokkeAndroid` (o JS ramifica em `typeof` por chamada). `triggerHaptic()` cai em `navigator.vibrate` (no-op no desktop) sem uma branch | `index.html:1008,1047,1516,3029,3066-3072` | S | PWA-CLIENT |
| W17 | **Host Windows deve referenciar as regras `landscape` (4 col x 2 lin) do PWA, não o default portrait 2x4** | `index.html:493-511` vs `:168-200` | S | PWA-CLIENT, DESIGN-LANGUAGE D8 |
| W18 | **Fixture compartilhada do contrato visual PRD §7 não existe.** Mac e PWA codificam os mesmos invariantes em dois dialetos de regex independentes. Uma terceira cópia à mão para Windows é exatamente o drift que o §7 existe para prevenir. Extrair um JSON/JS consumido pelos três | TEST-HARNESS §8 Task 5 | M | TEST-HARNESS |
| W19 | **Metade dos bullets da tela Conectar do PRD §7 não tem teste de UI em plataforma nenhuma** (copiar/abrir URL, contagem de dispositivos, regeneração de PIN — só existe teste de servidor). Task 5 escreve cobertura net-new, não porta | TEST-HARNESS §9 | M | TEST-HARNESS |
| W20 | **Decidir e documentar se `test/windows-package.test.mjs` pula silenciosamente em runner não-Windows**, repetindo o padrão `macOnly` de `package-dmg.test.mjs:818` | TEST-HARNESS §8 Task 6 | S | TEST-HARNESS |
| W21 | **Copy do painel offline do Android não distingue "host não está rodando" de "host rodando, firewall bloqueando"** — e o PRD §15 já sinaliza Windows Firewall como bloqueador provável de UDP 3001/HTTP. No Windows a copy "O Dokke está fechado no computador" vai estar errada com frequência | `AndroidLanguage.kt:27-28,52-53`; PRD §15 | M | ANDROID, WINDOWS-STACK |
| W22 | **Endurecimento do Electron como critério da Task 4, com teste**: `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, preload mínimo via `contextBridge`, CSP estrita, `webSecurity` on. É onde o Tauri era genuinamente melhor | WINDOWS-STACK §10.1 | S | WINDOWS-STACK |

### 5.2 `blocks-rebrand`

| # | Item | Evidência | Esf. | Reportado por |
|---|---|---|---|---|
| R1 | **As strings de wire são contrato entre 3 implementações e quebram descoberta em todas as plataformas ao mesmo tempo se renomeadas em um lado só**: `DISCOVERY_MAGIC = "dokke:discover"` (`server.js:170`), o prefixo de resposta `dokke:<ip>:<port>` (`server.js:208`) e o corpo exato de `/health` (`{"ok":true,"service":"Dokke"}`, `server.js:377`) — este último é casado por **regex de match total** no Android (`DokkeDiscovery.kt:12,37`), não por parse de JSON. **Exige janela de dual-accept ou defer**, porque o APK já distribuído não se atualiza em lockstep | verificados: `server.js:170,208,377` | M | ANDROID §12, TEST-HARNESS §7a, CORE-SERVER, WINDOWS-STACK risco 5 |
| R2 | **`felipenalves/Dokke` hardcoded em 4 superfícies.** Se não repontado, **um build DeckTech se auto-atualiza para o upstream Dokke**: `DokkeUpdateManager.swift:33` (API de releases + asset `Dokke-macOS.dmg`), `MainActivity.kt:70` (base URL de APK + asset `dokke.apk`), `docs/src/main.js:4-5` (+ 7 links de nav/community), `server.js:85-95` (update check) | verificados via grep | S | MACOS-APP, ANDROID, LANDING, CORE-SERVER |
| R3 | **`%APPDATA%\Dokke` → DeckTech precisa de migração copy-if-absent, não rename.** Sem ela, PIN/config/sessões de quem já instalou o Dokke ficam órfãos. O padrão certo já existe no repo (`server.js:939-946` para config, `:950-954` para PIN, ambos "nunca sobrescreve"). **`schemaVersion` não pode dirigir isso**: é escrito (`config.js:5,182`) e ecoado (`server.js:334,781`) mas nunca faz `switch` — verificado | `server.js:930,939-954`; `config.js:182` | M | AUTH-CONFIG |
| R4 | **`test/brand-icon-assets.test.mjs:209-215` fixa SHA-256 de 5 PNGs de launcher Android.** Qualquer troca de ícone invalida os 5 — regenerar os hashes é **etapa de primeira classe do rebrand**, não efeito colateral. O teste está funcionando como projetado | TEST-HARNESS §7c | S | TEST-HARNESS |
| R5 | **`test/docs-hero-motion.test.mjs` fixa nomes de arquivo, o identificador JS `dokkeHeroIcon`, dimensões em px e breakpoints.** Renomear assets sem atualizar o teste no mesmo commit quebra CI. Caminho seguro: (a) manter os nomes e trocar só o conteúdo, ou (b) renomear tudo (arquivos + `main.js` + as duas linhas de `<link>` + o teste) num commit atômico | LANDING §4 | S | LANDING, TEST-HARNESS |
| R6 | **`test/release-version.test.mjs` fixa `0.2.8` / `versionCode 11` / `CFBundleVersion 10` em 5 arquivos simultaneamente.** Um fork que inicia sua própria linha de versão quebra este teste por design — atualizar no mesmo commit | TEST-HARNESS §4 | S | TEST-HARNESS |
| R7 | **`server.js` hardcoda `".j5-pin"` e `"j5-sessions.json"`** (`:950,952,953,958`) em vez de importar `PIN_FILE`/`SESSION_FILE` de `auth.js:8,10` — as constantes existem e não são usadas nesses 3 pontos. Duplicação real, não hipotética | `server.js:950-958` vs `auth.js:8,10` | S | AUTH-CONFIG |
| R8 | **Copy da landing é Mac-exclusiva estruturalmente, não cosmeticamente.** `downloads` tem só `mac` e `android` (`main.js:4-6`) — Windows precisa de 3ª chave, 3º `.primary-button`, SVG de plataforma, e uma **decisão de layout** no breakpoint 420px onde `.hero-actions` empilha dois botões e o separador `.cta-plus` não generaliza para três. `.windows-note` ("Em breve · Dokke para Windows") e `faq.6` ("Ainda não... Windows está planejado") são **estruturalmente obsoletos** — remover ou inverter, não traduzir | `main.js:4-6,86-98,234`; `style.css:832` | M | LANDING |
| R9 | **`docs/public/tutorial-dokke.html` narra a história de fundação específica do Dokke** (celular velho → produto). Não é find-and-replace: exige **conteúdo novo e verdadeiro** do DeckTech | LANDING §7 | L | LANDING |
| R10 | **`LANDING_LANGUAGE_KEY = "dokke_landing_lang"`** (`main.js:16`) — trocar a chave sem ler a antiga uma vez como fallback perde a preferência de idioma de todo visitante recorrente | `main.js:16` | S | LANDING |
| R11 | **Chave legada `"j5.baseURL"` em UserDefaults** (`DockStore.swift:14`) — artefato pré-Dokke ainda vivo na superfície persistida | `DockStore.swift:14` | S | MACOS-APP |
| R12 | Renames **seguros** do Android (sem coordenação cross-surface): `applicationId`/`namespace = com.dokke.app`, `rootProject.name`, `app_name`, props `DOKKE_RELEASE_*`, tag de Logcat, toda copy de `AndroidLanguage.kt`. Listado separado de R1 **de propósito**, para ninguém varrer os dois grupos no mesmo find-and-replace | ANDROID §12 | M | ANDROID |
| R13 | `service: "Dokke"` também é checado pelo preflight de adoção do Mac (`ServerManager.swift:232`) e pelo `/api/status` (`server.js:777`) — o mesmo literal em 3 lugares com 3 consumidores diferentes | verificados | S | MACOS-APP, CORE-SERVER |

### 5.3 `quality`

| # | Item | Evidência | Esf. | Reportado por |
|---|---|---|---|---|
| Q1 | **CI não roda em nenhum commit.** Ambos os workflows são `workflow_dispatch` only (verificado: `.github/workflows/test.yml:3-4`). Mudar para `push`/`pull_request` ou documentar que é manual por design | verificado | S | TEST-HARNESS |
| Q2 | **Falta `npx playwright install` no `test.yml`** antes do `npm test`. Desde Playwright 1.38 o pacote não baixa mais binários no `npm ci`; o repo fixa `^1.62.1` sem `postinstall`. Os 10 `chromium.launch()` de `ui.test.mjs` falhariam num runner limpo. **Não bloqueia testes Electron** (§3.5), mas bloqueia o maior arquivo de teste do repo | TEST-HARNESS Finding 1 | S | TEST-HARNESS |
| Q3 | **Inter é declarada e nunca carregada** na landing — `font-family: Inter, …` + `font-synthesis: none` (`style.css:11-12`) sem `@font-face` nem link do Google Fonts em lugar nenhum de `docs/` (confirmado contra o bundle deployado). Pesos 650/750 caem silenciosamente para o que o SO oferece. **Visitantes Windows são justamente quem cai em Segoe UI** — a maior lacuna de fidelidade visual do sistema, no público exato do DeckTech | `style.css:11-12`; bundle deployado | S | LANDING, DESIGN-LANGUAGE §6.1 |
| Q4 | **`sw.js` `CACHE` e o `?rev=` da registração são duas cópias editadas à mão da mesma string** (verificado hoje: ambas `dokke-v24`, `sw.js:1` e `index.html:3109`). Um deploy que bumpar uma e esquecer a outra quebra silenciosamente a propagação de update do SW. Gerar as duas de uma constante de build | verificados | S | PWA-CLIENT §9, DESIGN-LANGUAGE F-41 |
| Q5 | **Reduced-motion está incompleto nas três superfícies, cada uma de um jeito**: companion desabilita só `appPress` (`index.html:247-249`); macOS lê `accessibilityReduceMotion` mas o **jiggle, o spring de hover e os page dots ignoram**; landing usa um seletor universal que mata toda transição de hover do site. **O host Windows precisa gatear jiggle, hover scale/blur E transições de página** | `index.html:247-249`; `DockGridView.swift:6`; `style.css:789-795` | M | DESIGN-LANGUAGE D11, PWA-CLIENT, MACOS-APP, LANDING |
| Q6 | **Painel offline do Android leva ~90s para aparecer** (confirmado em hardware real) mesmo com a descoberta LAN bounded já sabendo em ~7-8s que ninguém respondeu — nenhum watchdog liga os dois | `MainActivity.kt:248-341,550-627` | S | ANDROID |
| Q7 | **`retryConnection()` não tem o guard `currentServerHealthy()`** que `onCreate` (`:249`) e o self-heal (`:190-195`) têm — o botão "Tentar novamente" pode adotar um respondedor descoberto mesmo com conexão saudável | `MainActivity.kt:636-638` | S | ANDROID |
| Q8 | **`onResume()` faz `web.reload()` completo toda vez que o usuário volta ao app estando online** — re-roda boot/auth/state da PWA a cada troca de app, não só depois de desconexão real | `MainActivity.kt:385-395` | S | ANDROID |
| Q9 | **`updateReceiver.onReceive` usa o `Cursor` sem null-check** antes de `moveToFirst()`; um `query()` nulo daria NPE, e o `finally { cursor.close() }` daria um segundo NPE em cima | `MainActivity.kt:78-103` | S | ANDROID |
| Q10 | **`watchScale()` roda `layoutDockScale()` num `setInterval` de 800ms para sempre**, inclusive com a página oculta (sem o guard `pageHidden()` que os loops de poll têm). Trocar por `ResizeObserver` | `index.html:1781-1786` | S | PWA-CLIENT |
| Q11 | **Badge "app rodando" é código morto, não decisão de design.** `updateStatuses()` calcula e escreve texto/classe em `.astatus` a cada poll, e o CSS esconde incondicionalmente (`display:none`, `index.html:335-337`, nunca sobrescrito para `.astatus.on`). Ou liga o CSS ou apaga o JS — **ressuscitar é melhor que reinventar para Windows** | `index.html:335-337,2412-2423` | S | PWA-CLIENT |
| Q12 | **`URL.createObjectURL(blob)` nunca pareado com `revokeObjectURL`** em `loadIcon()` — retenção não-limitada de blob URLs numa sessão kiosk longa | `index.html:1498` | S | PWA-CLIENT |
| Q13 | **Sem detecção de ack-timeout no cliente WS**: com `readyState === 1` sobre um TCP half-open, `loadApps()` fica mandando `{type:"ping"}` a cada 2500ms indefinidamente e nunca cai para HTTP | `index.html:2384-2388` | M | PWA-CLIENT |
| Q14 | **`ServerManager` spawna até 7 `node --version` bloqueantes no main actor** a partir do `init()`, antes do primeiro frame | `ServerManager.swift:48-49,129-143` | S | MACOS-APP |
| Q15 | **`DockHoverCoordinator` roda um `Timer` de 30Hz sempre ligado** enquanto qualquer tile do dock estiver montado, mesmo com o cursor parado | `DockIcon.swift:93-167` | M | MACOS-APP |
| Q16 | **Literais de slot (`0..<40`, `0...39`) ignoram o `maxPinnedPieces` que o servidor reporta e o store guarda**; as strings "Limite de 5 páginas" são hardcoded independente do limite real — mensagem incorreta ao usuário se o limite mudar | `DockStore.swift:166,390,531`; `LanguageStore.swift:77-78,98-99` | M | MACOS-APP |
| Q17 | **Código morto que lê como spec** (perigoso num doc de paridade): `DockStore.filteredInstalled`/`filter` (zero call sites), `ContentView.customTrafficLights` (nunca referenciado — **não transcrever essas cores**), `sidebarChromeRadius = 20` (o raio real é 18), `DockIcon.cornerRadius = 20` (só clipa a imagem interna; o card visível é 28) | `DockStore.swift:32,139-150`; `ContentView.swift:30,98-117`; `DockIcon.swift:471-473` | S | MACOS-APP |
| Q18 | **`fallbackIcon` do DockIcon renderiza o nome inteiro do app em `.title.bold()` num tile de 68x68** — transborda para qualquer nome com mais de ~3 chars. É bug de exibição, não estilo. O picker faz o certo (`String(app.name.prefix(1))`) — **padronizar no do picker** | `DockIcon.swift:641-651` vs `AppPickerSheet.swift:368` | S | MACOS-APP |
| Q19 | **Bugs reais e visíveis do i18n da landing**: o `<b>` do FAQ-5 é destruído a cada load (selector map sem flag `html`, cai no `textContent`); o `.version-badge` nunca traduz (a chave `roadmap.available` existe nos dois dicionários e **não é lida por código nenhum**); 2 de 3 linhas de pills visualmente idênticas não são traduzíveis. O rebrand é o momento natural de trocar o selector-map por algo que não perca markup silenciosamente | `main.js:234,294,306,144,183-193,116` | M | LANDING |
| Q20 | **Landing tem zero conteúdo server-rendered e zero meta social/SEO** — todo o DOM vem de um `innerHTML` (`main.js:51`); sem `og:*`, `twitter:card`, canonical ou JSON-LD. Para uma página cujo trabalho inteiro é receber um link compartilhado e gerar um download, é a maior fraqueza estrutural | `docs/index.html:1-16`; `main.js:51-253` | M | LANDING |
| Q21 | **Nav mobile some sem substituto**: `.nav-links { display: none }` em 760px ou menos, sem hambúrguer — Recursos/Comunidade/Docs ficam inalcançáveis, e "Docs" (link externo) não tem entrada nenhuma | `style.css:802` | S | LANDING |
| Q22 | **Escopo do reduced-motion da landing é largo demais**: o seletor universal com `transition-duration: .01ms !important` mata toda transição de hover do site, não só o parallax | `style.css:790` | S | LANDING |
| Q23 | **Os 4 testes JUnit reais do Android nunca rodam em automação nenhuma** — não há step de Gradle em `.github/workflows/` nem script no `package.json` | TEST-HARNESS Finding 3 | S | TEST-HARNESS |
| Q24 | **Extrair o padrão de dedupe de in-flight num helper** (`memoizeInflight`) — hoje duplicado manualmente 3x com pequenas variações de cache-key | `apps.js` (scanInflight, runningCache.promise, loadInflight) | S | CORE-SERVER |
| Q25 | **Rate limit de PIN é chaveado só por IP** (`auth.js:172`, `server.js:397`), sem limite global, CAPTCHA ou alerta. 5 tentativas/60s/IP contra 10.000 PINs = ~33h **por IP** — o atacante controla a chave (segunda máquina, IPv6 temporário, DHCP renew). Degrada de "impraticável" para "inconveniente" ao paralelizar a origem | `auth.js:172-202`, `server.js:57,397` | M | AUTH-CONFIG |
| Q26 | **HTTP puro por default** — HTTPS só com `HTTPS_CERT`/`HTTPS_KEY` setados (`server.js:14-25`). PIN e cookie de sessão trafegam em claro; sniffing passivo de Wi-Fi captura ambos. O vetor está dentro do modelo de ameaça declarado (LAN) | `server.js:14-25` | L | AUTH-CONFIG |
| Q27 | **Sessão de 180 dias sem idle timeout, sem rotação, sem revogação individual** (`auth.js:12,111-166`) — cookie roubado vale de qualquer lugar por até 6 meses; a única revogação é `setPin()` derrubando todas | `auth.js:12,111-166` | M | AUTH-CONFIG |
| Q28 | **Self-update do macOS é integridade, não autenticidade** — o SHA-256 vem da mesma resposta não-autenticada da API do GitHub que a URL de download; sem verificação de assinatura/notarização no `.app` extraído | `DokkeUpdateManager.swift:33,84-96,170-177` | M | MACOS-APP |
| Q29 | **`install-update.sh` apaga recursivamente o diretório de instalação vivo ANTES de confirmar que o `mv` deu certo** — falha entre as duas linhas deixa a máquina **sem app instalado**, sem rollback | `DokkeUpdateManager.swift:211-228` | S | MACOS-APP |
| Q30 | **`mkdirSync(dataDir)` engole o erro silenciosamente** (`server.js:935`, verificado: `catch (e) {}`) — se `%APPDATA%` estiver redirecionado por política de grupo ou negado, toda escrita subsequente falha sem diagnóstico | `server.js:935` (verificado) | S | AUTH-CONFIG |
| Q31 | **`prune()` dos pin-locks só roda dentro de `register()`** — IPs que erraram uma vez e nunca voltaram ficam para sempre no Map (vazamento lento, real num processo kiosk de vida longa) | `auth.js:176-181,188` | S | AUTH-CONFIG |
| Q32 | **`j5-sessions.json` não tem campo de versão/schema** — qualquer mudança de formato cai no `catch {}` mudo de `auth.js:127` e desloga toda a base, sem log e sem sinal | `auth.js:122,127` | S | AUTH-CONFIG |
| Q33 | **`directedBroadcast()` pega a primeira interface IPv4 ativa não-loopback** — num device com VPN/Tailscale enumerado primeiro (observado no device de teste real) mira a sub-rede errada, degradando o fallback em redes segmentadas | `DokkeDiscovery.kt:46-66` | S | ANDROID |
| Q34 | **Extra de Intent `server_url` no cold start é aceito com `persist=true` sem health check**, ao contrário do caminho mais estrito de `onNewIntent` — e a Activity é `exported=true`/`singleTask` | `MainActivity.kt:141` vs `:361-380` | S | ANDROID |
| Q35 | **`MainActivity.kt` (70% do código Kotlin da superfície) tem zero cobertura de teste**, e a aritmética de bits de `directedBroadcast()` também | ANDROID §13 | L | ANDROID |
| Q36 | **Tokens mortos que leem como spec**: `--glass` e `--edge` declarados (`index.html:28-29`) e referenciados zero vezes — o glass real é hardcoded por componente. `--purple` na landing (`style.css:8`), idem. Ou liga ou apaga | verificados nas análises | S | PWA-CLIENT, DESIGN-LANGUAGE D13 |
| Q37 | **Favicon de website faz scrape HTTP não-autenticado de qualquer URL que o usuário digitar** (fetch do HTML + até ~10 fetches de imagem com User-Agent spoofado), sem allowlist além de uma tabela hardcoded por domínio | `DockIcon.swift:280-335` | M | MACOS-APP |
| Q38 | **`dokke-icon.png` tem 269KB para um 512x512** — 13x o WebP do hero nas mesmas dimensões, e o teste não impõe limite de tamanho nele. Reencodar ao trocar a marca | LANDING §7 | S | LANDING |

### 5.4 `nice-to-have`

| # | Item | Evidência | Esf. |
|---|---|---|---|
| N1 | Decomposição da PWA em fontes + step de build que reconcatena. **Não pode virar ES modules em runtime nem stylesheet externo** se "byte-for-byte" é a barra: o `<style>` é render-blocking por design e o `<script>` é clássico, síncrono, medindo layout no mesmo frame em que o markup foi parseado (`IS_ANDROID_WEBVIEW` seta `.android-webview` em `<html>` antes do primeiro paint). Regra que torna o split seguro: **um único `state.js`** dono de todo mutável compartilhado (~15 `let` de módulo cruzando seções), e **`gesture-engine.js` fica um arquivo só** (~530 linhas coesas) | PWA-CLIENT §8 | L |
| N2 | Colapsar `DockStore.pinned: [String]` numa projeção computada de `pieces` em vez de ressincronizar à mão em 8+ call sites | `DockStore.swift:398,414,424,434,448,463,473,482` | M |
| N3 | `DockStore.nativeIcon(for:)` faz varredura linear `installed.first(where:)` de dentro do render path de uma View, por tile | `DockStore.swift:630` | S |
| N4 | `measure/*.mjs` (5 scripts Playwright de probe de jank/deck) não está ligado a `node --test` nem referenciado no `package.json`, e exige Chrome real instalado — decidir se vira harness de verdade ou fica documentado como diagnóstico | TEST-HARNESS §2 | S |
| N5 | `/api/probe` fica fora do wall de auth e loga querystring arbitrária da LAN (`server.js:378-382`) — risco real é crescimento não-limitado de log, não forjamento (`JSON.stringify` neutraliza newline) | `server.js:378-382` | S |
| N6 | Sugestão hardcoded `Documente → documenteclub.vercel.app` no picker de websites do Mac (`AppPickerSheet.swift:16-26`) e o módulo de cross-promo do mesmo produto na landing (`main.js:7,198-203`) — decisão de produto, não rename | verificados nas análises | S |
| N7 | Inconsistência de case: `Dokke` no Windows/macOS vs `dokke` minúsculo no Linux (`server.js:930-932`) — irrelevante no NTFS, real em Linux se algum script comparar strings | `server.js:930-932` | S |

---

## 6. Estrutura de fases proposta — derivada das dependências reais

**Isto não é o PRD §16 reescrito.** As arestas abaixo saíram do que as análises
efetivamente encontraram. O ponto central: **o rebrand não é uma fase única
paralelizável** — o subconjunto de wire strings está travado pelo APK já
distribuído, e o resto não está.

### Grafo de dependências (as arestas que importam)

```
F0 Prova técnica (ícone 256px, UWP, .lnk)
      |
      v
F1a platform/ (Tasks 1-3) --> F2 Shell Electron (Task 4) --> F3 UI desktop (Task 5) --> F4 Pacote (Task 6)
                                                                    ^
F1b Fixture §7 compartilhada ---------------------------------------|
F1c Design tokens + fix da fonte ------------------------------------|

F1d Rebrand não-wire  -- independente de tudo acima
F5  Rebrand wire      -- TRAVADO pelo APK distribuído (dual-accept ou defer)
F1e CI (triggers + playwright install) -- independente; NÃO no caminho crítico do Windows
```

### Fase 0 — Prova técnica (bloqueia F1a Task 3; não bloqueia Tasks 1-2)

Escopo mínimo, tudo já parcialmente medido:
- Escolher o mecanismo de ícone 256px (N-API / koffi / pool PowerShell) — **W5**
- Implementar e medir enumeração UWP/`shell:AppsFolder` — **W6**
- Validar leitura binária de `.lnk` em Node contra os 16ms/atalho do COM — **W8**
- Fixar a regra de exclusão de desinstaladores — **W7**
- Confirmar empiricamente se `test/auth.test.mjs:106` (`mode & 0o777 === 0o600`)
  passa em Windows nativo — se não passar, é um gate falso-negativo bloqueando um PR
  correto

### Fase 1 — Cinco trilhas que rodam **em paralelo**

| Trilha | Conteúdo | Depende de | Bloqueia |
|---|---|---|---|
| **F1a — `platform/`** (Tasks 1-3) | Contrato de plataforma, scanner Windows, ícones/processos/ações. **Zero dependência de UI.** Só a Task 3 precisa de F0 | F0 (só Task 3) | F2 |
| **F1b — Fixture §7** | Extrair os invariantes estruturais do PRD §7 num JSON/JS consumido pelos testes Mac, PWA e Windows. **Não depende de nada, destrava 3 arquivos de teste, cedo e barato** | — | F3 |
| **F1c — Design system** | Declarar os tokens da §4.1, carregar Inter de verdade (Q3), matar tokens mortos (Q36), unificar o par `sw.js`/`?rev=` (Q4) | — | F3 |
| **F1d — Rebrand não-wire** | R2 (repontar releases — **primeiro**, senão um build se auto-atualiza para o upstream errado), R3 (migração `%APPDATA%`), R4/R5/R6 (regenerar os pins de teste), R7, R8, R10, R11, R12 | — | F4 (instalador precisa da identidade final) |
| **F1e — CI** | Q1 (triggers), Q2 (`playwright install`), Q23 (step de Gradle) | — | nada do Windows; destrava `ui.test.mjs` |

> **Por que F1a e F1c são paralelas:** o adaptador de plataforma não toca em CSS e a
> UI não toca em `lsappinfo`. A única superfície comum é o contrato de shape
> (`{name,path,icon}`), que já está congelado.

### Fase 2 — Shell Electron (Task 4)

Depende de **F1a**. Inclui, como critério de aceite e não como afterthought: o
endurecimento W22, a comparação **semântica** de versão na adoção (W15, não portar o
bug do `ServerManager`), e o tratamento de `EADDRINUSE` que o `server.js` já entrega
pronto (`server.js:1034-1058`).

### Fase 3 — UI desktop (Task 5)

Depende de **F2 + F1b + F1c**. Aqui entram W14 (geometria de caption), W17 (usar as
regras landscape), W19 (cobertura net-new da tela Conectar), W16 (bridge
`DokkeWindows`), Q5 (reduced-motion completo — o host Windows é a primeira
superfície que deve acertar isso).
**Validação é Playwright `_electron` de DOM real**, não regex sobre fonte —
disponível independentemente do fix de CI (§3.5).

### Fase 4 — Empacotar e instalar (Task 6)

Depende de **F3 + F1d**. NSIS via electron-builder, dados fora da pasta de instalação
(já garantido por `server.js:928-933`), W20 (decidir a política de skip do teste de
pacote), e a política de desinstalação que o PRD §15/RF-12 deixou em aberto.

### Fase 5 — Rebrand de wire (paralela a tudo, mas com trava própria)

**R1 é a única coisa do rebrand que não pode ser feita unilateralmente.** Duas opções
honestas: (a) o servidor aceita **ambas** as magic strings e responde o `service`
antigo por uma janela de depreciação, ou (b) **defer** o rename de wire para depois
de o APK novo estar distribuído. Escolher (a) ou (b) é decisão de produto — §7.

### Fase 6 — Endurecimento e release

PRD §16 Fases 2-3. Aqui cabem os itens `quality` de segurança que não bloqueiam o
MVP mas compõem (W4, Q25, Q26, Q27), e a decisão sobre HTTPS por default.

---

## 7. Perguntas abertas e suposições não validadas

### 7.1 Perguntas que exigem decisão do usuário

1. **Rename de wire: dual-accept ou defer?** (R1) Trocar `dokke:discover` / o prefixo
   de resposta / `"service":"Dokke"` quebra a descoberta em **todas** as plataformas
   ao mesmo tempo, silenciosamente, porque o Android casa o corpo de `/health` por
   regex de match total. O APK já distribuído não se atualiza em lockstep.
2. **Estado vazio: conflito direto entre duas fontes.** `MACOS-APP` §7.7 é
   inequívoco — o grid Mac **não tem estado vazio**: com zero itens fixados ele
   mostra 5 páginas cheias de botões "+" e 5 page dots. O PRD §7 exige "estados
   equivalentes de ... vazio" e o próprio doc marca isso como conflito.
   `DESIGN-LANGUAGE` F-37 exige os cinco estados persistentemente representados.
   **A referência estrutural e a rubrica se contradizem.** O Windows copia o Mac
   (sem estado vazio) ou implementa o que o PRD pede (net-new, divergindo do Mac)?
3. **"Apps" ou "Slots"?** O PRD §7 e `mac/README.md:5` dizem "Apps"; a build em
   produção mostra **"Slots"** (`LanguageStore.swift:67`, `ContentView.swift:7`).
   Decidir qual é ground truth antes de a Task 5 congelar a string.
4. **Tipografia de marca.** Adotar Bricolage Grotesque nas três superfícies (hoje
   está em **2 elementos de uma superfície só**) ou abandonar e ir system-only como
   o app Mac?
5. **Tema claro.** Construir um, ou declarar formalmente o DeckTech dark-only e
   apagar o caminho de tracking de aparência de ícone no Windows (W12)?
6. **Geometria de caption: (A) espelhar ou (B) desenhar à mão?** Recomendação é (A)
   — sidebar à esquerda, título alinhado à borda de ataque da sidebar, botões de
   caption à direita com ~138px de clearance —, mas o PRD §7 restringe composição,
   então precisa de assinatura do dono. (B) custa acessibilidade, snap layouts e
   correção em alto contraste.
7. **Mica como opt-in?** O default está resolvido (nenhum material, ember pintado em
   CSS). Aberto é apenas se existe uma configuração "Combinar com o tema do Windows".
8. **Atribuição pessoal.** `felipenalves` (Instagram/X, "um produto de Felipe
   Natanael", `main.js:246-249`) é **autoria pessoal num fork MIT**, não branding de
   produto. Manter ou trocar é decisão de licenciamento/atribuição — **não pode ser
   varrido num find-and-replace junto com "Dokke"**.
9. **Política de desinstalação.** O PRD §15 lista isso como risco aberto e a RF-12
   exige decidir antes do release. Hoje o `dataDir` fica fora da pasta de instalação,
   então um desinstalador padrão preserva PIN e config **por acidente de localização,
   não por decisão** — e não há hook de desinstalação em superfície nenhuma.
10. **Windows 10 entra no suporte?** Sem `DWMWA_WINDOW_CORNER_PREFERENCE` no Win10 os
    cantos são quadrados — delta honesto e aceitável, ou gate em Win11?
11. **`%APPDATA%` (Roaming) ou `%LOCALAPPDATA%`?** (W11) Um PIN em texto puro
    replicando para fora da máquina em perfil roaming é uma decisão que ninguém tomou
    explicitamente.
12. **DeckTech reinicia a linha de versão?** `test/release-version.test.mjs` fixa
    `0.2.8` em 5 arquivos e quebra por design — é uma forcing function que precisa de
    resposta, não de silenciamento.
13. **A PWA vira multi-arquivo com build step?** (N1) É a única forma de decompor sem
    regredir o primeiro paint no WebView Android. É trabalho L e tem barra de
    verificação byte-a-byte.

### 7.2 Suposições não validadas que permanecem

| # | Suposição | Por que ainda não está validada |
|---|---|---|
| U1 | **Nenhum app Tauri foi construído ou medido.** Toda nota de footprint/RAM do Tauri é `[DOC]` ou estimativa. O próprio doc admite a assimetria e nomeia o desempate: uma prova técnica construindo o mesmo hello-world nas duas stacks **com o sidecar Node incluído**, medindo instalador e RSS. Recomendado **só se** aparecer orçamento de footprint | toolchain Rust completa fora do orçamento daquela investigação |
| U2 | **A falha de CI do Playwright é raciocinada, não observada.** Vem do conteúdo do workflow + a mudança confirmada de comportamento do Playwright 1.38+, **não de um log de falha real**. O checkout analisado não tinha `node_modules` | `npm ci`/`npm test` não foram executados naquela sessão |
| U3 | **`test/auth.test.mjs:106` (`mode & 0o777 === 0o600`) nunca rodou em Windows nativo.** No win32 o `fs.chmod` só alterna o bit read-only, então a igualdade exata provavelmente não vale — mas **ninguém verificou** | exige `npm ci` + `node --test` num checkout Windows |
| U4 | **Empacotamento `pkg`/SEA nunca validado ponta a ponta contra este `server.js` ESM.** `pkg` está em 5.8.1 e `postject` em `1.0.0-alpha.6` [MEDIDO] — ambos são apostas, não caminhos batidos. Irrelevante sob Electron; decisivo se a stack for reaberta | não construído |
| U5 | **Leitura binária de `.lnk` em Node (a otimização dos 16ms) não foi validada** | declarado explicitamente como não validado |
| U6 | **Enumeração UWP/`shell:AppsFolder` não foi implementada nem medida** | trabalho de Fase 0 |
| U7 | **Consumo de um processo WebView2 dedicado não foi medido nesta máquina** — por isso "RAM ociosa" ficou **sem nota** na matriz de decisão, em vez de receber um número inventado | idem U1 |
| U8 | **A rubrica que exige apenas as duas curvas de easing (F-27) é hoje inaplicável em CI.** `test/docs-hero-motion.test.mjs` foi lido inteiro (47 linhas) e **não** asserta a curva — asserta um `transition: transform` sem Bézier. As curvas de produto não têm teste nenhum. *(Isto corrige a caracterização "motion-curve substrings" que circula em resumos anteriores desse teste.)* | nenhum teste fixa as duas strings de easing |
| U9 | **As quatro perguntas em aberto da design language não têm decisão registrada.** Cada uma bloqueia uma superfície diferente; shipar sem responder significa que a resposta é dada implicitamente por quem escrever o código primeiro | — |
| U10 | **Cores semânticas do macOS (`.quaternary`, `.accentColor`) não têm valor literal no código-fonte.** Precisam ser amostradas de screenshot renderizado — e só o rendering **escuro** existe, porque o app é `.preferredColorScheme(.dark)` forçado. **Não inventar hex para elas** | são system colors resolvidas em runtime |
| U11 | **O app Mac é hard-locked em dark mode** (`ContentView.swift:51`) e o PRD **não menciona isso**. Um host Windows que respeite o tema claro do sistema diverge da referência sem que ninguém tenha decidido isso | omissão do PRD |

---

## Resumo em três linhas

O Dokke é um servidor Node com injeção de plataforma **já pronta** (`server.js:295-298`,
`apps.js:559-573`) servindo três clientes; o port Windows é substituir os providers
macOS, não reescrever protocolo — nenhuma rota HTTP ou mensagem WS muda.
**Electron**, porque o adaptador vive em Node (o que neutraliza a vantagem Rust do
Tauri), `utilityProcess` embute o Node a custo zero, e 7 de 7 tasks do plano
sobrevivem contra 4 de 7 — a única vitória do Tauri, footprint, otimiza uma variável
que o PRD não restringe.
O risco maior não é técnico: é o rename de wire (`dokke:discover` + `"service":"Dokke"`),
que quebra a descoberta em todas as plataformas simultaneamente e silenciosamente se
feito de um lado só, num APK que já está na mão de usuários.
