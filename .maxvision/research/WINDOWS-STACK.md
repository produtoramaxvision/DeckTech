# WINDOWS-STACK — Electron vs Tauri v2 para o host Windows do DeckTech

**Data:** 2026-09-17
**Escopo:** decidir a stack do host desktop Windows (PRD §11, plano de 7 tasks)
**Status:** recomendação — **Electron**, confiança **alta**
**Máquina de medição:** Windows 11 Pro 10.0.22631 (23H2), x64

> **Convenção de evidência.** Todo número neste documento é marcado como
> `[MEDIDO]` (executado nesta máquina, comando no Apêndice A) ou `[DOC]`
> (documentação oficial via context7, com a fonte). Nada aqui vem de memória.
> Onde não validei, digo **"não validei"** explicitamente.

---

## 1. Decisão

**Electron.** Não porque o PRD já o assumia — a premissa foi reaberta e testada —
mas porque **a única vantagem real do Tauri (footprint) otimiza uma variável que o
PRD não restringe, enquanto seu único ganho técnico genuíno (Rust falando Win32
direto) não alcança o código que precisa dele.**

Os dois fatos que decidem, ambos verificados:

1. **O PRD não tem orçamento de tamanho nem de RAM.** §10 (requisitos não
   funcionais) exige apenas que descoberta de apps e carga de ícones sejam
   *assíncronas e cacheáveis* e que a UI continue responsiva. §14 (métricas) mede
   instalação-até-servidor-online, conexão de companion, falhas de ícone/foco e
   crashes — nenhuma métrica de MB ou MB-RAM. Não existe requisito que o Tauri
   satisfaça e o Electron viole.

2. **O adaptador de plataforma vive em Node, por decisão de arquitetura já
   tomada.** Ver §3. Isso neutraliza a vantagem Rust do Tauri e move o custo dele
   para o lado errado da balança.

Onde a evidência é genuinamente equilibrada eu digo — ver §9 (tamanho é uma
derrota real e assumida) e §11 (o que quebraria o empate).

---

## 2. O que foi medido nesta máquina

| Medição | Valor | Como |
|---|---|---|
| `node.exe` v25.5.0 em disco | **90,74 MB** `[MEDIDO]` | `Get-Item (Get-Command node).Source` |
| Servidor Dokke ocioso (`node server.js`) | **68,6–71,2 MB** working set / 62–66 MB private `[MEDIDO]` | processo isolado, `APPDATA` redirecionado, `PORT=3999`, medido em t=7s e t=22s |
| Runtime Electron 44.4.1 descompactado | **367,7 MB** (`electron.exe` sozinho 234,9 MB — build de dev, não-strippado) `[MEDIDO]` | soma de `node_modules/electron/dist` |
| App Electron empacotado real, runtime sem código do app | **257,8 MB** e **272,6 MB** `[MEDIDO]` | dois apps Electron instalados nesta máquina (total do diretório menos `resources/`) |
| App Electron mínimo ocioso (janela visível, mica ligado) | **268,9 MB** total em 4 processos `[MEDIDO]` | main 81,9 + gpu 84,0 + utility 40,2 + renderer 62,8 MB; estável entre t=12s e t=22s |
| WebView2 Runtime instalado | **presente, 153.0.4234.32** `[MEDIDO]` | `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-…}` + `C:\Program Files (x86)\Microsoft\EdgeWebView\Application\153.0.4234.32` |
| Atalhos `.lnk` no Menu Iniciar (machine + user) | **182**, enumerados em **8 ms** (Node) / 52 ms (PowerShell) `[MEDIDO]` | walk recursivo dos dois diretórios |
| Resolução de `.lnk` → `.exe` via COM `WScript.Shell` | **149 resolvidos em 2395 ms** (~16 ms cada) `[MEDIDO]` | gargalo real |
| Apps únicos após dedupe por target path | **122** `[MEDIDO]` | inclui lixo: `Uninstall DJI Assistant 2 → unins000.exe` |
| `app.getFileIcon()` do Electron sobre `.lnk` | **40/40 OK**, 4,1 ms/ícone a frio, ~0 ms com cache `[MEDIDO]` | resolve o atalho sozinho |
| Teto de resolução do `app.getFileIcon()` | **48×48 em `.exe`; 32×32 em `.lnk`** `[MEDIDO]` | 3 processos limpos, ordem de requisição variada para descartar cache: `.exe` honra small/normal/large = 16/32/**48**; `.lnk` satura em 32 mesmo com `large` |
| Ícone 256×256 via `IShellItemImageFactory::GetImage` | **20/20 OK, 43,2 ms/ícone, ~23 KB PNG** `[MEDIDO]` | COM do shell, Windows PowerShell 5.1 |
| Mica real na janela Electron | **`DWMWA_SYSTEMBACKDROP_TYPE` = 2 (Mica), hr=0** `[MEDIDO]` | lido do DWM na janela viva + screenshot |
| Playwright `_electron.launch()` sem browser baixado | **funciona** (título e `textContent('h1')` lidos) `[MEDIDO]` | `PLAYWRIGHT_BROWSERS_PATH` vazio; `chromium.launch()` falhou no mesmo processo |

Não medido (declarado): footprint de um app Tauri v2 real e o consumo de um
processo WebView2 dedicado. Construir um Tauri exigiria a toolchain Rust
completa, fora do orçamento desta investigação. Os números de Tauri em §9 são
`[DOC]`/estimativa e estão marcados como tal. **Isto é uma assimetria conhecida
deste documento** — ver §11.

---

## 3. O discriminador: o adaptador de plataforma vive em Node

Esta é a razão central, e ela é estrutural, não de gosto.

O `server.js` já expõe os pontos de injeção que o host Windows precisa:

- `makeApp(deps)` em [server.js:292](../../server.js) recebe
  `appTools = { listAppProcesses, listInstalledApps }` ([server.js:295](../../server.js)),
  `actions = { activateApp, openWebsite }` ([server.js:296](../../server.js)) e
  `iconService = realIconService()` ([server.js:298](../../server.js)).
- `realIconService(deps)` em [apps.js:559](../../apps.js) aceita `findIcon`,
  `exec`, `iconHelper` e `cacheDir`. O comentário em
  [apps.js:562-563](../../apps.js) **antecipa Windows textualmente**: *"o futuro
  Windows poderá injetar um resolvedor de .exe/.lnk sem mudar a API HTTP."*

O plano herdado constrói exatamente em cima disso: Task 1 cria
`platform/platform-contract.js`, `platform/windows/apps.js`,
`platform/windows/actions.js` e *modifica* `server.js`; Task 3 Step 3 diz
preservar as rotas existentes **"trocando somente o provider de plataforma"**.

**Consequência:** a varredura do Menu Iniciar, a extração de ícone, a enumeração
de processos e o `SetForegroundWindow` são **módulos Node**, sob qualquer shell.

Portanto a vantagem legítima do Tauri — Rust chamando `SHGetFileInfo`,
`IShellItemImageFactory`, `EnumWindows` e `SetForegroundWindow` via a crate
`windows`, sem shell-out — **não alcança esse código**. Para usá-la você teria que
mudar o adaptador de plataforma para o shell e inventar um contrato de IPC entre
o shell Rust e o servidor Node. Isso viola o princípio 4 do PRD §6 ("a camada
Windows cuida de aplicativos, ícones, processos, bandeja, caminhos e instalação;
**o protocolo do Dokke permanece compartilhado**") e joga fora a arquitetura de
Tasks 1–3. Sem essa mudança, sob Tauri você faria exatamente o que faria sob
Electron: PowerShell/COM a partir do Node, ou FFI (koffi/N-API).

O Electron, além de não perder nada aqui, **ganha** um atalho que o Tauri não tem:
`app.getFileIcon()` é nativo, resolve `.lnk` sozinho e custou **4,1 ms/ícone a
frio** `[MEDIDO]` — contra 43,2 ms do caminho COM. Ele **não** substitui o caminho
256 px, porque satura em 48×48 (ver §6.2), mas serve de fallback rápido e
garantido para RF-04.

---

## 4. Três critérios que o enunciado superpondera — desmontados com evidência

### 4.1 Glass/blur não é diferencial. Verificado nos dois lados.

`[DOC]` Electron: `win.setBackgroundMaterial(material)` e a opção de construtor
`backgroundMaterial` aceitam `'auto' | 'none' | 'mica' | 'acrylic' | 'tabbed'`,
*"Supported on Windows 11 22H2 and up"*
(electronjs.org/docs/latest/api/base-window). A máquina-alvo é 22631 = 23H2.

`[MEDIDO]` Não confiei na doc. Subi um Electron 44.4.1 com
`backgroundMaterial: 'mica'` + `backgroundColor: '#00000000'` e li o atributo
direto do compositor:

```
DWMWA_SYSTEMBACKDROP_TYPE(38): hr=0 value=2   [1=None 2=Mica 3=Acrylic 4=Tabbed]
```

É Mica real do DWM, não uma imitação em CSS. Screenshot em
`…/scratchpad/etest/mica.png`.

`[DOC]` Tauri v2 oferece o equivalente (`setEffects`, `Effect.Mica`,
`Effect.Acrylic`, `TabbedLight`; config `windowEffects`) — tauri.app/reference/config.
A própria doc do Tauri avisa que *Acrylic e Blur podem ter problemas de
performance ao redimensionar/arrastar a janela em certos builds*.

**Empate técnico.** E a análise MACOS-APP já havia concluído o que importa mais:
o app Mac tem **exatamente 5 call sites de glass** —
[ContentView.swift:172](../../mac/Sources/ContentView.swift),
[DockGridView.swift:202](../../mac/Sources/DockGridView.swift),
[DockIcon.swift:206, 209, 213](../../mac/Sources/DockIcon.swift) — e **todos têm
fallback plano obrigatório** (o `else` em ContentView.swift:173), porque o app
tem como alvo macOS 14+. Esse fallback plano *é* o alvo de paridade Windows.
Glass não decide nada.

### 4.2 Auto-update não é critério

O PRD **RF-10** diz literalmente: *"Atualização automática silenciosa não é
requisito do MVP"* — basta caminho de instalador e versão visível. Comparar
`electron-updater` com `tauri-plugin-updater` é resolver um problema que o MVP
não tem.

*(Ortogonal, mas registre: [DokkeUpdateManager.swift:33](../../mac/Sources/DokkeUpdateManager.swift)
tem `felipenalves/Dokke` hardcoded como origem de release. Se o DeckTech herdar
isso sem repontar, um build se auto-atualiza para o upstream errado. Não pesa na
escolha de stack; pesa no release.)*

### 4.3 Assinatura de código é idêntica nos dois

Certificado OV/EV em token de hardware **ou** Azure Trusted Signing, `signtool`, e
reputação SmartScreen que se acumula por assinante — independente de stack.
`[DOC]` electron-builder suporta Azure Trusted Signing nativamente
(`win.sign: { type: "azure", endpoint, codeSigningAccountName, certificateProfileName }`);
`[DOC]` Tauri usa `bundle.windows.certificateThumbprint` + `timestampUrl`.
Uma linha, seguimos.

---

## 5. Como cada stack embute o Node

Este é o requisito mais concreto do PRD (§6 princípio 3, §10, RF-01: *"sem
instalar Node.js"*), e é onde as duas stacks divergem de verdade.

### Electron — custo marginal zero

`[DOC]` `utilityProcess.fork(modulePath, args, options)` cria *"a child process
with Node.js and Message ports enabled"*, e a doc de process-model é explícita:
*"Electron apps should prefer the UtilityProcess API over Node.js
`child_process.fork`"* (electronjs.org/docs/latest/api/utility-process e
/tutorial/process-model).

O `server.js` roda **dentro do runtime que o app já embarca**. Não existe
`node.exe` extra, não existe `ELECTRON_RUN_AS_NODE`, não existe empacotador de
binário. O `server.js` e o `public/` vão em `extraResources` do electron-builder,
fora do asar, e o `utilityProcess` aponta para eles. `child.pid`, `child.on('exit')`,
`child.stdout` e `MessagePort` dão exatamente os ganchos que a Task 4 pede
(single instance, start, shutdown limpo, porta ocupada, log de erro).

Isto é o análogo direto do que o app Mac já faz — ele embute um `node` em
`Contents/Resources/node-bin` ([ServerManager.swift:86-90](../../mac/Sources/ServerManager.swift)) —
só que sem o binário extra.

### Tauri — custo real e desagradável

`[DOC]` O mecanismo é `bundle.externalBin` + o plugin `shell`, com permissão
explícita (`shell:allow-execute` com `sidecar: true`) e nome sufixado pelo
target triple (`my-sidecar-x86_64-pc-windows-msvc.exe`). A partir do JS:
`Command.sidecar('binaries/my-sidecar', args)` (tauri.app/develop/sidecar e
/learn/sidecar-nodejs).

Duas saídas, ambas ruins:

1. **Enviar `node.exe`.** `[MEDIDO]` **90,74 MB** (v25.5.0 nesta máquina; o LTS 20
   é menor — **não medi**). Isso sozinho consome a maior parte da vantagem de
   tamanho do Tauri.
2. **Compilar para binário único.** `[DOC]` O guia oficial do Tauri para sidecar
   Node usa `pkg index.ts --output my-sidecar`. `[MEDIDO]` A última versão
   publicada de `pkg` no npm é **5.8.1**. Este repositório é **ESM puro**
   (`"type": "module"` em `package.json`), o cenário mais frágil para `pkg`. A
   alternativa moderna é o SEA nativo do Node, mas `postject` — a ferramenta que
   ele exige — está em **1.0.0-alpha.6** `[MEDIDO]`. **Não validei** nenhum dos
   dois caminhos de empacotamento de ponta a ponta contra este `server.js`; o
   registro é o de que ambos são apostas, não caminhos batidos.

Some-se: o servidor sidecar fica num processo separado com ciclo de vida
gerenciado via plugin `shell`, o que é mais frágil do que `utilityProcess` para
os cenários exatos que a Task 4 testa (encerramento limpo, órfãos após crash do
shell).

### WebView2 — não é problema, mas foi verificado

`[MEDIDO]` Runtime **153.0.4234.32 presente** nesta máquina. O Evergreen Runtime
vem de fábrica no Windows 11, e o alvo do PRD (§10) é Windows x64 moderno, com
versões mínimas a fechar na prova técnica. **Se** o suporte for ampliado para
Windows 10, o bootstrapper Evergreen (~2 MB, exige rede na instalação) ou o
Fixed Version Runtime (~180 MB, some com a vantagem de tamanho do Tauri) entram
na conta. Para o alvo declarado, é não-assunto.

---

## 6. Integração nativa — o que cada stack precisa de fato

### 6.1 Inventário de aplicativos (RF-03)

Idêntico nas duas stacks, porque roda em Node (§3). O caminho validado aqui:

`[MEDIDO]` Varrer `%ProgramData%\Microsoft\Windows\Start Menu\Programs` e
`%APPDATA%\Microsoft\Windows\Start Menu\Programs` → **182 `.lnk` em 8 ms**.
Resolver cada `.lnk` para o alvo `.exe` é o gargalo: **2395 ms para 149** via COM
`WScript.Shell` (~16 ms cada). Dedupe por target path normalizado → **122 apps**.

Dois achados que o PRD §15 previu e que a medição confirma:

- **Lixo real na lista:** `Uninstall DJI Assistant 2 → unins000.exe` entrou no
  resultado. RF-03 ("evitar duplicatas") precisa também de uma regra de exclusão
  de desinstaladores/ferramentas, não só de dedupe.
- **Apps UWP/Store não aparecem.** `.lnk` não cobre `shell:AppsFolder`. Calculadora,
  Fotos, Terminal etc. exigem enumeração separada. **Não implementei nem medi
  esse caminho** — é trabalho de Fase 0 e vale igual para as duas stacks.

Vale ler `.lnk` binário direto em Node (sem COM) para matar os 16 ms/atalho.
Não validei essa otimização.

### 6.2 Ícones (RF-04) — o achado mais importante da investigação

[apps.js:17](../../apps.js) define `ICON_MAX_PX = 512`, e o dock Mac renderiza
ícone a 68 pt ([DockIcon.swift:471](../../mac/Sources/DockIcon.swift)) — ou seja
~136 px em Retina.

`[MEDIDO]` O `app.getFileIcon()` do Electron tem teto baixo, e o teto **depende do
tipo de entrada**. Medi em três processos limpos, variando qual tamanho é pedido
primeiro, justamente para descartar contaminação de cache:

| entrada | `small` | `normal` | `large` |
|---|---|---|---|
| `notepad.exe` | 16×16 | 32×32 | **48×48** |
| atalho `.lnk` do Menu Iniciar | 16×16 | 32×32 | **32×32** (satura) |

*(Correção de uma medição anterior desta mesma investigação: eu havia registrado
"`large` devolve 32×32" como regra geral. É verdade só para `.lnk`; em `.exe` o
`large` entrega 48×48. A conclusão abaixo não muda — fica mais precisa.)*

**Nem 48×48 nem 32×32 atendem ao contrato visual.** O dock Mac desenha o ícone a
68 pt, ~136 px em Retina; escalar 48 px para lá borra e quebra a paridade da §7.

`[MEDIDO]` O caminho que atende: `IShellItemImageFactory::GetImage` a 256×256 —
**20/20 sucesso, 43,2 ms/ícone, ~23 KB PNG**. Para 122 apps isso é ~5,3 s, o que
torna o requisito do PRD §10 (assíncrono + cacheável) **obrigatório, não
opcional**. A boa notícia: a infraestrutura de cache já existe e é reaproveitável
— `memPng`, `DISK_PNG_MAX = 256`, TTL e `pruneIconCache` em `apps.js`, e todo o
pipeline puro de PNG (`decodeRgbaPng`, `normalizePngIcon`, `pngChunk`) funciona
sem alteração assim que receber um bitmap.

**Nas duas stacks esse trabalho é o mesmo.** Sob Tauri o `IShellItemImageFactory`
estaria em Rust — mais elegante — **mas o `iconService` que o consome está em
Node** ([server.js:298](../../server.js)), então você pagaria uma travessia de IPC
para chegar lá. Sob Electron: addon N-API, koffi, ou PowerShell com pool. Nenhum
é grátis; nenhum favorece uma stack.

Nota de degradação: hoje a última etapa de fallback do `apps.js` ainda chama
`sips` ([apps.js:549](../../apps.js)), binário exclusivo do macOS. No Windows a
cadeia inteira falha silenciosa e o app fica **sem ícone nenhum** em vez de
degradar para monograma. RF-04 não é satisfeito de graça por nenhuma stack.

### 6.3 Processos, abertura e foco (RF-06)

Substituir `lsappinfo` ([apps.js:11](../../apps.js)) e `osascript`
([actions.js:22](../../actions.js)). Em Node: enumeração de processos/janelas e
`SetForegroundWindow` via FFI ou PowerShell. Idêntico nas duas stacks.

O Electron dá de brinde `shell.openPath`/`shell.openExternal` para o caso de
lançar-quando-não-há-instância; o Tauri dá o plugin `opener`. Empate.

Aviso do PRD §15 que a medição reforça: `SetForegroundWindow` é restrito pelo
Windows quando o chamador não tem foreground. A decisão do PRD ("aceitar abrir
nova instância quando foco falhar") é a correta, e precisa de erro tipado — hoje
toda falha de `activateApp` colapsa num 500 genérico, o que já viola PRD §8.3
**inclusive no macOS**.

### 6.4 Bandeja, startup, instância única

| | Electron | Tauri v2 |
|---|---|---|
| Bandeja | `Tray` no core | `tray-icon` no core `[DOC]` |
| Run-at-startup | `app.setLoginItemSettings` no core | `tauri-plugin-autostart` `[DOC]` |
| Instância única | `app.requestSingleInstanceLock()` no core | `tauri-plugin-single-instance` `[DOC]` |

Paridade funcional. Diferença: no Tauri os três são registrados em Rust
(`app.handle().plugin(...)` em `lib.rs`), o que significa que qualquer ajuste de
comportamento de bandeja é uma mudança em Rust + recompilação.

### 6.5 Instalador, dados do usuário e firewall

`[DOC]` electron-builder: alvo NSIS com `oneClick`, `perMachine` (default
`false` = por usuário), `allowElevation`, `createStartMenuShortcut`,
`runAfterFinish`; o desinstalador é gerado por um stub NSIS compilado e **é
assinado** junto. Atende RF-12 e §10.

`[MEDIDO]` A política de dados já está correta e não depende da stack:
[server.js:928-930](../../server.js) resolve `%APPDATA%\Dokke` no Windows. Rodando
o servidor com `APPDATA` redirecionado, ele criou exatamente
`…\Dokke\.j5-pin` (5 bytes) e `…\Dokke\config.json` (18 bytes) — fora da pasta de
instalação, como §10 exige. **Nenhuma das duas stacks precisa tocar nisso.**

Firewall (PRD §8.1/§15): os dois bundlers permitem script NSIS customizado —
electron-builder via `include`/`script`, Tauri via
`bundle.windows.nsis.installerHooks` com macros `NSIS_HOOK_POSTINSTALL` `[DOC]`.
Empate.

---

## 7. Testes — aqui o Electron ganha de forma mensurável

A análise TEST-HARNESS registrou que `test/ui.test.mjs` é inexecutável em CI
porque falta `playwright install` nos workflows. A conclusão natural seria que um
`windows-desktop-ui.test.mjs` herdaria o mesmo defeito. **Isso está errado para
Electron, e eu verifiquei.**

`[DOC]` `_electron.launch()` do Playwright usa *"the default Electron executable
located at `node_modules/.bin/electron`"* — o binário do próprio app, não um
Chromium baixado.

`[MEDIDO]` Rodei com `PLAYWRIGHT_BROWSERS_PATH` apontando para um diretório
vazio:

```
ELECTRON_OK title=mica appVersion=44.4.1
DOM h1=Mica backdrop probe
CHROMIUM_FAILS_AS_EXPECTED: browserType.launch: Executable doesn't exist at …\empty-browsers\chromium_headless_shell-1243\…
```

No mesmo processo: Electron sobe e responde a asserções reais de DOM
(`textContent('h1')`); `chromium.launch()` falha. **Prova que o defeito de CI não
bloqueia testes de UI Electron.** Além disso, `electronApp.evaluate()` roda no
processo main — dá para asserir ciclo de vida do servidor, bandeja e single
instance (Task 4) no mesmo harness, sem mocks.

Do lado Tauri: a via oficial é `tauri-driver` + WebdriverIO sobre
`msedgedriver`, cuja versão precisa acompanhar a do WebView2 — um acoplamento de
manutenção que o Electron não tem, porque carrega o próprio Chromium. **Não
validei o caminho Tauri nesta máquina.**

Consequência direta para a Task 5: sob Electron as validações estruturais da §7
(sidebar Apps/Conectar, grid 4×2, indicadores de página, app picker, modo de
reordenação, tela Conectar) viram **testes de DOM de verdade**, não regex sobre
fonte como os testes Mac/Android fazem hoje. Isso é um upgrade real de qualidade
de verificação, não uma porta lateral.

---

## 8. Matriz de decisão

Pesos derivados do PRD, não do gosto: requisito explícito = 3, requisito
implícito = 2, não-requisito = 1. Notas 0–5.

| Critério | Peso | Electron | Tauri v2 | Por quê |
|---|---:|---:|---:|---|
| Embutir Node sem o usuário instalar (RF-01, §6.3) | 3 | **5** | 2 | `utilityProcess` custa 0 byte extra; Tauri exige `node.exe` de 90,74 MB `[MEDIDO]` ou `pkg`/SEA sobre um projeto ESM |
| Sobrevivência do plano de 7 tasks | 3 | **5** | 2 | Tasks 4 e 6 são Electron-shaped; validação da Task 5 muda de ferramenta |
| Integração nativa Windows (RF-03/04/06) | 3 | 4 | 4 | Empate: o adaptador vive em Node nos dois casos (§3). Electron leva +1 por `app.getFileIcon` a 4,1 ms `[MEDIDO]`; Tauri leva +1 por Rust idiomático se o adaptador migrar |
| Contrato visual §7 incl. glass | 3 | **5** | 5 | Mica verificado no DWM no Electron `[MEDIDO]`; Tauri equivalente `[DOC]`. Alvo real é o fallback plano |
| Instalador assinado + desinstalador + dados fora da pasta (RF-10/12, §10) | 3 | **5** | 4 | NSIS maduro + desinstalador assinado nos dois; electron-builder tem mais superfície documentada |
| Testabilidade / verificação automatizada (RF-02, §13.12) | 2 | **5** | 2 | `_electron` funciona sem browser baixado `[MEDIDO]`; Tauri exige tauri-driver + msedgedriver versionado |
| Bandeja, startup opt-in, instância única (RF-09) | 2 | **5** | 4 | Paridade; Tauri exige Rust para cada ajuste |
| Velocidade de entrega com o time atual (JS/TS) | 2 | **5** | 2 | Tauri adiciona Rust + cargo ao caminho crítico e ao CI |
| Diagnóstico e logs (RF-11) | 2 | **4** | 4 | Empate |
| Footprint de instalador | 1 | 1 | **5** `[DOC]` | Derrota real e assumida (§9). **A nota 5 do Tauri não é medida** — repousa na doc, não num instalador que eu tenha construído. Do lado Electron o runtime foi medido (258–273 MB descompactado) mas o instalador também não |
| RAM ociosa | 1 | — | — | **Não pontuado: não medi um app Tauri nem um processo WebView2 dedicado** (§2, §9). O que medi é o piso comum — 68,6–71,2 MB do servidor Node — e o shell Electron a 268,9 MB. Pontuar o Tauri aqui seria inventar número |
| Superfície de segurança | 2 | 3 | **4** | Tauri tem allowlist de permissões por capability; Electron depende de disciplina (`contextIsolation`, sem `nodeIntegration`) |
| **Total ponderado** (26 de peso pontuável) | **26** | **117** | **88** | conferido por script, não a olho |

Leitura honesta da matriz: o Tauri vence em 2 critérios pontuados (footprint,
segurança) e provavelmente venceria o terceiro (RAM), que deixei **sem nota por
falta de medição**. Footprint e RAM somam **peso 2 de 27** porque o PRD não os
restringe — e mesmo dando ao Tauri **nota 5 também em RAM**, ele chega a 93
contra 119 do Electron. A diferença não fecha. O critério de segurança é real e
mitigável por configuração (§10).

A matriz não é o argumento; §3 e §12 são. Ela existe para mostrar que nenhuma
combinação plausível de notas inverte o resultado enquanto não existir orçamento
de footprint (§11).

---

## 9. Footprint: a derrota honesta

Não vou maquiar. **O Tauri produz um app menor e o Electron é pesado.**

`[MEDIDO]` Runtime Electron descompactado nesta máquina: **257,8 MB** e
**272,6 MB** em dois apps empacotados reais. Instalador NSIS comprime bastante —
**não medi um instalador do DeckTech porque ele não existe ainda**; a estimativa
de 80–110 MB é derivada de razão de compressão típica e está marcada como
**estimativa, não medição**.

`[MEDIDO]` App Electron mínimo ocioso: **268,9 MB** em 4 processos.

Mas a comparação justa não é "Electron vs Tauri". É:

| | Electron | Tauri v2 |
|---|---|---|
| Shell | Chromium embutido, ~258–273 MB `[MEDIDO]` | binário Rust + WebView2 do sistema, poucos MB `[DOC]` |
| Runtime Node | **0 byte extra** (`utilityProcess`) | `node.exe` **90,74 MB** `[MEDIDO]` ou `pkg`/SEA |
| RAM: servidor Dokke | **68,6–71,2 MB** `[MEDIDO]` — **piso comum às duas** | idem |
| RAM: shell | ~269 MB `[MEDIDO]` | processos WebView2, **não medido nesta máquina** |

O piso de RAM do produto é o servidor Node, e ele é idêntico nos dois. A diferença
é só o shell. E o sidecar apaga boa parte da diferença de disco.

**Se o produto tivesse orçamento de footprint, esta seção viraria a decisão.**
Ele não tem.

---

## 10. Riscos de escolher Electron, e as mitigações

1. **Superfície de ataque do renderer.** É o ponto onde o Tauri é genuinamente
   melhor. Mitigação obrigatória, não opcional: `contextIsolation: true`,
   `nodeIntegration: false`, `sandbox: true`, preload com API mínima via
   `contextBridge`, CSP estrita e `webSecurity` ligado. Isso precisa entrar como
   critério da Task 4, com teste.
2. **Cadência de atualização do Chromium.** Vulnerabilidade no Chromium vira
   obrigação de rebuild. Com RF-10 dispensando auto-update silencioso, isso vira
   dívida operacional de release, não risco de MVP — mas é dívida real.
3. **Instalador grande.** Aceito conscientemente (§9). Se virar problema de
   conversão, medir com usuários reais antes de reabrir a stack.
4. **`app.getFileIcon` não resolve RF-04.** `[MEDIDO]` Teto de 48×48 em `.exe` e
   32×32 em `.lnk` — abaixo dos ~136 px que a §7 exige. Não deixar a Task 3
   assumir que ele basta; ela precisa do caminho 256 px medido em §6.2. O
   `getFileIcon` continua útil como fallback rápido e garantido, não como fonte
   primária.
5. **Contrato de wire compartilhado.** A magic string `dokke:discover`, o prefixo
   de resposta e o corpo de `/health` são contrato com o APK Android já
   distribuído. `[MEDIDO]` `/health` responde `{"ok":true,"service":"Dokke"}` —
   renomear para DeckTech em um lado só quebra descoberta em todas as
   plataformas ao mesmo tempo. Independe da stack; registre no rebrand.
6. **Ao portar o `ServerManager`, não portar o bug.** A adoção de servidor em
   [ServerManager.swift:255-280](../../mac/Sources/ServerManager.swift) exige
   igualdade exata de string de versão, o que trata um servidor saudável do mesmo
   app como conflito. A Task 4 deve usar comparação semântica.
7. **Multiusuário/RDP.** O bypass de loopback do `server.js` assume single-user.
   No Windows, qualquer processo local não privilegiado do mesmo host alcança
   `/api/*`, incluindo `GET /api/pin`. Independe da stack, mas o host Windows é
   onde isso deixa de ser teórico.

---

## 11. O que quebraria o empate — e o que quebraria a decisão

**Isto inverte para Tauri se:**

- Aparecer **orçamento explícito de footprint** no PRD (ex.: "instalador < 40 MB"
  ou "RAM ociosa < 150 MB"). Hoje §10 e §14 não têm nada disso; é a única
  variável em que o Tauri vence e ela está irrestrita.
- Decidir-se **mover o adaptador de plataforma para o shell** e aceitar um
  contrato de IPC shell↔servidor. Aí o Rust passa a alcançar o código que
  importa, e Tasks 1–3 são reescritas de qualquer forma — o custo de migração
  cai muito.
- Surgir requisito de **distribuição pela Microsoft Store** com limite de tamanho
  de pacote (hoje explicitamente não-objetivo, §4).

**Isto não inverte:** glass (§4.1, verificado nos dois), auto-update (§4.2,
dispensado por RF-10), assinatura (§4.3, idêntico), disponibilidade de WebView2
(§5, presente `[MEDIDO]`).

**Lacuna deste documento:** não medi um app Tauri real. Se a decisão for
contestada com base em footprint, o desempate honesto é uma prova técnica de
Fase 0 construindo o mesmo hello-world nas duas stacks **com o sidecar Node
incluído** e medindo instalador e RSS. Estimo que isso custa menos de um dia e
eu recomendaria fazê-lo **apenas se** um orçamento de footprint aparecer.

---

## 12. Custo de migração contra o plano de 7 tasks

O plano herdado é valor real. Contabilizando task a task:

| Task | Sob Electron | Sob Tauri v2 |
|---|---|---|
| 1 — contrato de plataforma (`platform/*`, `server.js`) | **sobrevive integral** | **sobrevive integral** |
| 2 — descoberta de apps Windows | **sobrevive integral** | **sobrevive integral** |
| 3 — ícones, processos, ações | **sobrevive integral** (e o seam `iconService` já existe — ver §13) | sobrevive, mas ganha travessia de IPC se o provider migrar para Rust |
| 4 — shell desktop (`windows/src/main.js`, `preload.js`, `server-process.js`) | **sobrevive**; `server-process.js` fica mais simples com `utilityProcess` | **descartada** — vira `src-tauri/` em Rust, sidecar e plugins |
| 5 — UI desktop (`index.html`, `styles.css`, `app.js`) | **sobrevive integral**, e a validação Playwright fica **melhor** que o previsto (§7) | HTML/CSS/JS sobrevive; **a validação é descartada** (tauri-driver/WebDriver) |
| 6 — empacotar/instalar (`electron-builder.yml`) | **sobrevive integral** | **descartada** — vira `tauri.conf.json` + bundler NSIS/WiX |
| 7 — fechar release (docs) | sobrevive | sobrevive |

**Electron: 7 de 7 sobrevivem** (Task 4 simplifica).
**Tauri: 4 de 7 sobrevivem**, 2 descartadas, 1 com validação descartada — e o
time passa a precisar de Rust no caminho crítico e no CI.

Descartar ~40% de um plano TDD aprovado para otimizar uma variável sem
restrição é o argumento decisivo.

---

## 13. Correções aos documentos de pesquisa anteriores

Duas afirmações das análises de superfície não se sustentam ao ler o código, e
elas mudam a matemática acima:

1. **TEST-HARNESS** diz que o ponto de injeção de ícone da Task 3 *"may not exist
   yet"*. **Ele existe.** `makeApp` aceita `iconService` em
   [server.js:298](../../server.js), e `realIconService(deps)` em
   [apps.js:559](../../apps.js) aceita `findIcon`, `exec`, `cacheDir` e
   `iconHelper`, com um comentário em [apps.js:562-563](../../apps.js) que cita
   Windows nominalmente. A Task 3 é mais barata do que estimado — nas duas stacks.

2. **TEST-HARNESS** implica que o defeito de `playwright install` no CI
   bloquearia a validação da Task 5. **Não bloqueia, para Electron.** Verificado
   empiricamente em §7: `_electron.launch()` funciona com
   `PLAYWRIGHT_BROWSERS_PATH` vazio. O defeito continua real para
   `test/ui.test.mjs` (que usa `chromium.launch()`) e deve ser corrigido — mas
   não é um custo da stack Windows.

---

## Apêndice A — reprodução

Todos os comandos rodaram em Windows 11 Pro 22631, x64.

```powershell
# node.exe em disco
[math]::Round((Get-Item (Get-Command node).Source).Length/1MB,2)      # 90,74

# WebView2 Runtime
Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'

# Mica real: 38 = DWMWA_SYSTEMBACKDROP_TYPE, 2 = Mica
DwmGetWindowAttribute($hwnd, 38, [ref]$v, 4)                          # hr=0 value=2
```

```bash
# servidor ocioso, isolado (não toca no %APPDATA% real)
APPDATA="<scratch>/appdata" PORT=3999 node server.js     # 68,6–71,2 MB WS

# ícones do Electron: latência
electron.exe iconbench.js            # 40/40, 4,1 ms a frio

# ícones do Electron: teto de resolução (3 processos limpos, ordem variada)
electron.exe icon3.js large          # .lnk -> 32x32 ; notepad.exe -> 48x48
electron.exe icon3.js small          # confirma que não é cache
electron.exe icon3.js normal

# ícone 256px real (Windows PowerShell 5.1, IShellItemImageFactory)
powershell.exe -File jumbo.ps1       # 20/20, 43,2 ms/ícone, 256x256

# Playwright sem browser baixado
PLAYWRIGHT_BROWSERS_PATH="<vazio>" node pwtest.mjs       # Electron OK, Chromium falha
```

Artefatos em
`C:\Users\MaxVision\AppData\Local\Temp\claude\C--Users-MaxVision-Desktop-cursor-oficial-decktech\dee2ff8f-958c-4c0d-81af-9a26ac75f01a\scratchpad\etest\`
(`main.js`, `iconbench.js`, `icon3.js`, `icon3.out.*.txt`, `pwtest.mjs`,
`mica.png`) e `…/scratchpad/jumbo.ps1`.

**Efeito colateral no repositório — revertido:** `node_modules/` estava ausente,
então rodei `pnpm add ws@^8.21.1 --prod` para conseguir subir o `server.js`. O
pnpm reformatou o bloco `portless` e subiu `ws` para `^8.21.3` no
`package.json`, e gerou um `pnpm-lock.yaml`. **Ambos foram desfeitos**
(`git checkout -- package.json`, lockfile removido); `git status` ficou com
`.maxvision/research/` como única entrada. O `node_modules/` (gitignored) foi
mantido, porque `node --test` precisa dele.

---

## Apêndice B — alternativas descartadas

- **Wails v3 (Go).** Mesmo problema de sidecar do Tauri, sem a maturidade de
  ecossistema, e adiciona Go ao caminho crítico. Descartado pela mesma lógica
  do §3 mais ecossistema menor.
- **Neutralinojs.** Runtime fino demais; não entrega bandeja, controle de área de
  caption e materiais de janela no nível que a §7 exige. Descartado.
- **Electron Forge.** Mesmo runtime, empacotador diferente. Não é decisão de
  stack; é escolha dentro do Electron. `electron-builder` fica por causa do
  suporte NSIS/Azure Trusted Signing já documentado e porque o plano herdado já
  o nomeia (Task 6). Uma linha.
- **Navegador do sistema em `--app` mode.** Sem bandeja, sem controle de caption,
  sem ciclo de vida próprio. Falha a §7 e a RF-09. Descartado.
- **WinUI 3 + WebView2 (C#/.NET).** A única alternativa genuinamente *melhor* no
  nativo: Mica de graça e verdadeira, Win32 direto sem FFI, integração de
  bandeja/startup de primeira classe, e o menor footprint de shell dos
  candidatos. Morre no custo, não no mérito: descarta Tasks 4, 5 e 6 inteiras,
  adiciona .NET + toolchain Windows ao CI, exige um segundo runtime ao lado do
  Node, e abandona a premissa de UI compartilhada em HTML/CSS que sustenta tanto
  o plano quanto a paridade da §7 (o `public/index.html` e a UI desktop passariam
  a ser dois mundos, não um). Só faria sentido num projeto que tratasse Windows
  como plataforma primária e macOS como porta — o oposto deste.
