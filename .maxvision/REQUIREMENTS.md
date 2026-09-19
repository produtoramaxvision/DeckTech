# DeckTech — Requisitos v1

Derivado de `.maxvision/research/SUMMARY.md` (80 itens de backlog com evidência
`path:linha` verificada), do PRD herdado `docs/plans/2026-08-18-dokke-windows-host-prd.md`
e das decisões travadas em 2026-09-17.

**Stack decidida:** Electron. Confiança alta. Motivo decisivo: o adaptador de plataforma
vive em Node por decisão de arquitetura já tomada (`server.js:295-298`, `apps.js:559-573`),
o que neutraliza a única vantagem técnica do Tauri; `utilityProcess` embute o Node a custo
zero de bytes; e 7 de 7 tasks do plano TDD herdado sobrevivem contra 4 de 7.
**Reabre se aparecer orçamento explícito de footprint.**

---

## Decisões travadas

| # | Decisão | Consequência |
|---|---|---|
| D1 | ~~Strings de wire congeladas como `Dokke` no v1~~ **REVISADO por D19 em 2026-09-18.** Ver D19 e WIRE-01 | A justificativa original ("o APK distribuído não atualiza em lockstep") tratava compatibilidade de migração como se fosse requisito de protocolo. Investigação de 2026-09-18 mostrou que **um único** consumidor do literal está fora do nosso controle — o APK do Dokke já instalado em campo; todo o resto (`DokkeDiscovery.kt`, `DokkeDiscoveryTest.kt`, `ServerManager.swift:232`, `test/apps-api.test.mjs`, `test/smoke.test.mjs`) é código-fonte que o rebrand reescreve |
| D2 | Atribuição de Felipe Natanael **preservada** | Fora de qualquer find-and-replace. LICENSE MIT intacta |
| D3 | `%LOCALAPPDATA%`, nunca Roaming | PIN em texto puro não replica para fora da máquina |
| D4 | **"Slots"** é ground truth | Código shipado v0.2.8 vence o PRD de 2026-08-18 |
| D5 | DeckTech começa em **`0.1.0`** | `test/release-version.test.mjs` atualizado deliberadamente |
| D6 | Mica **desligado** por padrão, sem setting no v1 | O alvo de paridade é o fallback plano |
| D7 | Caption geometry **espelha** o Mac | (B) custaria acessibilidade e snap layouts |
| D8 | Desinstalador **preserva** dados + checkbox opt-in de remoção | Hoje preserva por acidente de localização |
| D9 | Tipografia **system-only** no chrome; Bricolage só no display da landing | Bricolage está em 2 elementos de 1 superfície — é drift |
| D10 | Mecanismo de ícone 256px decidido na **Fase 0 por medição** | `IShellItemImageFactory` é o caminho; falta a ponte |
| D11 | **Tema claro completo** *(decisão do usuário)* | DeckTech diverge do Mac, que é hard-locked em dark (`ContentView.swift:51`) |
| D12 | **Windows 11 only** no v1 *(decisão do usuário)* | Gate no instalador. Cantos arredondados e Mica disponíveis |
| D13 | **Estado vazio de verdade**, conforme PRD §7 *(decisão do usuário)* | O Mac não tem um (`DockGridView.swift:53-60` transforma todo slot livre em `.add`). DeckTech supera a referência. A rubrica F-37 fica válida |
| D14 | Monolito da PWA **intocado** no v1 *(decisão do usuário)* | 236 asserções leem `public/index.html` como texto. Decomposição vira fase do v2 |
| D15 | Arquitetura do servidor no host decidida **por medição na Fase 0** *(decisão do usuário)* | `utilityProcess.fork` vs servidor no main process do Electron. A pesquisa nunca avaliou a segunda. Ver PROOF-08 |
| D17 | **Observabilidade entra no v1** *(decisão do usuário)* | Log em arquivo rotativo + ação de exportar. `apps.js`, `auth.js`, `config.js` e `actions.js` têm zero `console.*` hoje. Ver OBS-01, OBS-02 |
| D19 | **Wire dual-accept, DeckTech primário** *(decisão do usuário, 2026-09-18)* | O DeckTech ganha identidade própria no protocolo já no v1 e continua atendendo a antiga, com data de morte declarada. Viável porque `MainActivity.kt:346` abre a conexão sem header nenhum: "ausência de header" é a assinatura do cliente legado. Ver WIRE-01 |
| D18 | **Check de update reaponta e fica desligado por flag** *(decisão do usuário)* | `gh release list` do DeckTech retorna vazio; só reapontar manda o updater para endereço sem releases. RF-10 diz que auto-update silencioso não é MVP. Ver BRAND-12 |
| D16 | **7 expansões aceitas** em revisão CEO, modo SELECTIVE EXPANSION *(decisão do usuário, 2026-09-17)* | PROOF-06, PROOF-07, PROOF-08, PLAT-09, PLAT-10, SHELL-08, UI-12, TEST-06, TEST-07. Total de requisitos v1: **76**, depois **79** com D17 e D18 |

---

## v1 Requirements

### Fase 0 — Prova técnica

- [ ] **PROOF-01**: Escolher o mecanismo de extração de ícone 256×256 por medição comparada — N-API vs koffi vs pool PowerShell — contra `IShellItemImageFactory` (43,2 ms/ícone medido). `app.getFileIcon()` satura em 48×48 e não atende. *(W5)*
- [ ] **PROOF-02**: Implementar e medir enumeração de apps UWP/Store via `shell:AppsFolder`. Hoje `.lnk` não cobre Calculadora, Fotos nem Terminal. *(W6)*
- [ ] **PROOF-03**: Validar leitura binária de `.lnk` em Node contra os 16 ms/atalho do COM (2395 ms para 149 atalhos, medido). *(W8)*
- [ ] **PROOF-04**: Fixar a regra de exclusão de desinstaladores do scan. O scan real trouxe `Uninstall DJI Assistant 2 → unins000.exe`. *(W7)*
- [ ] **PROOF-05**: ~~Executar `npm ci && node --test` nesta máquina Windows~~ **EXECUTADO em 2026-09-17.** Resultado: 283 testes, 265 passam, 5 falham. `test/auth.test.mjs:106` falha com `actual: 438` (`0o666`) vs `expected: 384` (`0o600`) — no Windows `fs.chmod` só alterna o bit read-only, então a igualdade exata não pode valer. **U3 confirmado como fato.** Gate falso-negativo, precisa de correção em FIX-02. *(U3)*
- [ ] **PROOF-06**: Destravar a instalação de dependências no Windows. `npm ci` aborta com `EBADPLATFORM` em `macos-alias@0.2.12` — darwin-only, dev, e **não marcado `optional`**, ao contrário de `fsevents`, que o npm pula sem reclamar. Chega via `ds-store`, usado só para o layout do DMG do macOS (`mac/write-dmg-ds-store.mjs`). Hoje um contribuidor Windows instala **zero** pacotes. *(achado empírico 2026-09-17)*
- [ ] **PROOF-07**: Gatear os testes macOS-only para que a suíte possa ficar verde no Windows. `test/icon.test.mjs` tem exatamente um guard de plataforma (linha 314) e ele protege outro teste; os que falham nas linhas 138, 199 e 295 rodam incondicionalmente — um deles se chama "prioriza NSWorkspace pelo path do bundle". O gate precisa distinguir "pulou por ser macOS" de "passou", seguindo o padrão `macOnly` de `test/package-dmg.test.mjs:818`. *(achado empírico 2026-09-17)*
- [ ] **PROOF-08**: Medir `utilityProcess.fork` contra hospedar o servidor no main process do Electron, com o `server.js` real, e decidir por número. Comparar RSS ocioso, cold start e comportamento no crash. O piso medido do servidor Node é 68,6–71,2 MB, então o desenho in-process elimina um processo inteiro — mas SHELL-03 (adotar servidor externo já rodando) continua exigindo o caminho de processo separado. A pesquisa nunca avaliou esta opção: comparou `utilityProcess` contra `child_process` e contra o sidecar do Tauri, nunca contra o main process. *(D15)*

### Adaptador de plataforma

- [ ] **PLAT-01**: Criar `platform/index.js` — fábrica explícita que resolve `{listInstalledApps, listAppProcesses, activateApp, openWebsite, iconService}` por SO. Hoje o único ponto sem injeção é o default de `iconHelper`, que ramifica em `darwin` sem branch `win32` (`apps.js:571`). *(W2)*
- [ ] **PLAT-02**: Descoberta de apps Windows — atalhos do Menu Iniciar, caminhos conhecidos, UWP, dedupe por target path, exclusão de desinstaladores, ordenação por nome, cache com invalidação.
- [ ] **PLAT-03**: Extração de ícone Windows a 256×256 com cache em disco, assíncrona e cancelável. A assincronia é **obrigatória**: 122 apps × 43,2 ms ≈ 5,3 s.
- [ ] **PLAT-04**: Rasterizar o monograma de fallback em JS puro. Hoje `monogramPng` chama `sips` (`apps.js:549`), binário exclusivo do macOS — no Windows a cadeia inteira falha em silêncio e o app fica **sem ícone nenhum**. *(W1)*
- [ ] **PLAT-05**: Listagem de processos e ativação de janela no Windows, com o fallback do PRD §15 (abrir nova instância quando `SetForegroundWindow` é restrito).
- [ ] **PLAT-06**: Erros tipados para falha de ação. Hoje `fail()` (`server.js:133-137`) colapsa tudo em `{ok:false,error:"erro interno"}`, violando PRD §8.3 **inclusive no macOS**. *(W3)*
- [ ] **PLAT-07**: Equivalente Windows de `readMacIconAppearance` (`apps.js:281`) lendo `HKCU\...\Personalize\AppsUseLightTheme`. Não existe task para isso no plano herdado. *(W12)*
- [ ] **PLAT-08**: Nenhuma rota HTTP nem mensagem WebSocket muda. O port é troca de provider, não de protocolo.
- [ ] **OBS-01**: Logging estruturado no core. Hoje `server.js` tem 7 chamadas `console.*` e `apps.js`, `auth.js`, `config.js` e `actions.js` tem **zero** — sem logger, sem nivel, sem sink. Instrumentar entrada, saida e cada ramo significativo dos caminhos que hoje falham em silencio: `mkdirSync` engolindo erro (`server.js:935`, Q30), a cadeia de icone morrendo sem ruido (W1) e falha de foco virando 500 generico (W3). **Nunca gravar o PIN nem o cookie de sessao.** **Atencao de escopo:** `apps.js`, `auth.js`, `config.js` e `actions.js` sao core compartilhado, nao codigo Windows. Instrumentar esses arquivos altera tambem o caminho macOS e Android. O efeito no macOS **nao e validavel nesta maquina** (sem Xcode) — mesma marca que a Fase 11 carrega. Manter a instrumentacao neutra de plataforma e verificar a nao-regressao do Android por TEST-07, em hardware real. *(D17)*
- [ ] **PLAT-09**: Cache de ícone persistente entre reinicializações, com warm em ociosidade e invalidação correta quando o app de origem é atualizado ou desinstalado. Hoje são 43,2 ms por ícone × 122 apps = 5,3 s medidos a cada scan. O PRD §10 já exige ícones assíncronos e cacheáveis; isso é cumprir o requisito por inteiro. *(E1, aceito 2026-09-17)*
- [ ] **PLAT-10**: Parser binário de `.lnk` em Node, **condicional ao resultado de PROOF-03**. Hoje resolver 149 atalhos via COM custa 2395 ms medidos (~16 ms cada). Se PROOF-03 confirmar o ganho, ship; se não confirmar, registrar a medição e manter o COM. *(E2, aceito 2026-09-17)*
- [ ] **PLAT-11**: **Enumeração por JANELA, não por processo.**
`platform/windows/actions.js:162` deduplica por PID (`seenPid.add(pid)`) e escreve
`type: "Foreground"` como literal. Duas consequências, ambas medidas em 2026-09-19:
o campo significa "tem janela" e não "está em foco"; e um app com duas janelas em dois
monitores aparece **uma vez só**, porque é um processo só.

O usuário tem dois monitores e quer tratar cada janela como um botão próprio: a janela do
Firefox do monitor 1 e a do monitor 2 são coisas diferentes, cada uma com suas abas, e um
toque tem que agir **naquela** janela. Isso não é possível com PID.

Os dados existem e foram verificados nesta máquina via `EnumWindows` — cada janela visível
com título devolve `pid`, `hwnd`, `MonitorFromWindow`, `IsIconic` e o título:

    42120 | hwnd 2232068 | mon 65539 | min False | 9Router — Mozilla Firefox
    10868 | hwnd 133676  | mon 65539 | min False | (75) WhatsApp - Google Chrome

O contrato passa a devolver uma entrada por janela com: identidade estável (`hwnd`), app de
origem, título, monitor, e estado em **três** valores — em foco / segundo plano / minimizada.
O `hwnd` é reciclável pelo Windows, então a identidade exposta ao cliente precisa sobreviver a
isso sem apontar pra janela errada depois que a original fecha. O macOS precisa do equivalente
(`CGWindowListCopyWindowInfo`) ou de degradação declarada — não de um `undefined`.
*(revisado 2026-09-19 a pedido do usuário; antes dizia "por processo")*
- [ ] **PLAT-12**: **Ações de janela, endereçadas por janela.** O contrato de
`platform/index.js` expõe `listInstalledApps`, `listAppProcesses`, `activateApp`,
`openWebsite` e `iconService` — e nada mais. Não há minimizar, não há fechar, e "instância
nova" só existe como *fallback de erro* de `activateApp` (PRD §15), nunca como intenção.

Adiciona `focusWindow`, `minimizeWindow`, `closeWindow` e `openNewWindow`, os três primeiros
endereçados pela identidade de janela de PLAT-11 e **não** por nome de app — focar "Firefox"
é ambíguo quando existem duas janelas dele; focar *aquela* janela não é. Erros tipados da
Fase 2 nos quatro. `openNewWindow` continua por app, porque uma janela que ainda não existe
não tem identidade.

**Fechar é destrutivo e pode perder trabalho não salvo.** Nunca `Stop-Process -Force`: manda
`WM_CLOSE`, deixa o app abrir o próprio diálogo de "salvar?", e se ele não fechar, o cliente
recebe erro tipado em vez de um app morto. A confirmação no cliente é UI-14.
*(revisado 2026-09-19: era por nome de app)*
### Shell Electron

- [ ] **SHELL-01**: Processo principal com single instance, janela principal e ciclo de vida do servidor via `utilityProcess.fork`.
- [ ] **SHELL-02**: Supervisão do servidor — encerramento limpo, porta ocupada (`server.js:1034-1058` já entrega o tratamento), log de erro, eventos de saúde para a UI.
- [ ] **SHELL-03**: Adoção de servidor existente por comparação **semântica** de versão. Não portar o bug do `ServerManager.swift:255-280`, que exige igualdade exata de string e trata patch drift como conflito. *(W15)*
- [ ] **SHELL-04**: Bandeja do sistema com abrir, status e sair.
- [ ] **SHELL-05**: Inicialização com o Windows explícita e reversível, desligada por padrão.
- [ ] **SHELL-06**: Endurecimento como critério de aceite, com teste — `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, preload mínimo via `contextBridge`, CSP estrita, `webSecurity` on. *(W22)*
- [ ] **SHELL-07**: Corrigir o overload de `opts.root` entre raiz estática e `pinRoot`. Se o shell passar `opts.root` apontando para o diretório servido, `GET /.j5-pin` entrega o PIN sem auth. *(W13)*
- [ ] **SHELL-08**: Detectar bloqueio do Windows Firewall na primeira execução e oferecer criar a regra, em vez de deixar o usuário com um erro. O PRD §15 já nomeia o Firewall como bloqueador provável de UDP 3001 e HTTP. Complementa FIX-06, que explica a causa; aqui o app resolve. A criação da regra exige elevação UAC, então o fluxo precisa de consentimento explícito e caminho de recusa que não quebre o app. *(E4, aceito 2026-09-17)*
- [ ] **OBS-02**: Sink de log em arquivo rotativo em `%LOCALAPPDATA%\DeckTech\logs`, com politica de retencao declarada, e acao na bandeja que abre a pasta. Sem isso o stdout do `utilityProcess` nao chega a lugar nenhum que o usuario alcance, e um bug reportado tres semanas depois nao tem artefato para pedir. *(D17)*
- [ ] **OBS-03**: **Diagnóstico honesto do OBS e superfície de configuração.** O cartão mostra
"OBS offline" e o drawer diz "abra o OBS para liberar as cenas". Medido em 2026-09-18 com o OBS
Studio ABERTO: a mensagem estava errada nas duas pontas. As causas reais eram outras duas, ambas
válidas ao mesmo tempo — `obs-ws.js:20` devolve `null` sem nem tentar conectar quando
`OBS_WS_PASSWORD` não está definida, e nada escutava na porta 4455 porque o servidor WebSocket do
OBS estava desligado. O servidor também não distingue os dois casos: `server.js:1077,1084,1105`
respondem `connected: false` para qualquer um. Este requisito faz o servidor reportar a causa e o
cliente dizer qual é, e dá ao usuário um lugar para configurar a senha que não seja variável de
ambiente. *(achado no teste ponta-a-ponta de 2026-09-18)*


- [ ] **ACT-01**: **Costura de extensão de ações — o que torna o DeckTech um Stream Deck.**
Hoje o dock tem exatamente **dois** tipos de peça: `"app"` e `"website"`
(`server.js:723,786,939`; `public/index.html:1342,1428,1608`). O OBS existe, mas como uma
gaveta separada, não como botão do dock — então não dá pra pôr "cena 03 · Tela cheia" ao lado
do Firefox, que é o comportamento que define um Stream Deck.

Adicionar um tipo hoje custa edição em pelo menos seis lugares: validação no servidor, rota de
criação, `publicCfg`, o renderizador do cliente, o despachante de toque e o seletor. Este
requisito troca isso por um **registro**: um tipo novo passa a ser um módulo que declara como
se valida, como se renderiza, o que faz ao ser acionado e se tem estado ao vivo.

Inclui a migração de `schemaVersion` e o caminho de cliente antigo — `server.js:483` já tem
`MIXED_PIECES_REQUIRES_NEW_CLIENT` pra configuração mista, e o tipo novo tem que passar por ele
em vez de quebrar um cliente que não conhece o tipo.

**Quais ações entram é decisão D20, não deste requisito.** ACT-01 entrega a costura mais UM
tipo de prova (`obs-scene`), porque uma costura sem segundo consumidor não é costura, é um
`if`. *(pedido do usuário, 2026-09-19)*

### UI desktop

- [ ] **UI-01**: Sidebar com **Slots** e **Conectar**, item selecionado com o tratamento visual do Mac.
- [ ] **UI-02**: Grid 4×2, 5 páginas, 40 slots, peek lateral e indicadores de página, seguindo as regras `landscape` da PWA (`index.html:493-511`), não o default portrait 2×4. *(W17)*
- [ ] **UI-03**: **Estado vazio de verdade** na primeira abertura — ilustração, título, explicação e uma chamada única "Adicionar app". Substitui o comportamento do Mac, que mostra 40 botões "+" sem texto. *(D13)*
- [ ] **UI-04**: Modo explícito de reordenação.
- [ ] **UI-05**: App picker com busca, ícone, estado "Adicionado" e ação "Adicionar".
- [ ] **UI-06**: Tela Conectar com PIN, URL, QR Code, copiar URL, abrir URL, status do servidor, contagem de dispositivos e regeneração de PIN.
- [ ] **UI-07**: Geometria da área de caption espelhando o Mac — sidebar à esquerda, título alinhado à borda de ataque da sidebar, botões de caption à direita com clearance. Sem port mecânico possível: o macOS reserva clearance à esquerda. *(W14, D7)*
- [ ] **UI-08**: Bridge `window.DeckTechWindows` espelhando os 5 métodos de `window.DokkeAndroid`, ou no-ops explícitos. O JS ramifica em `typeof` por chamada. *(W16)*
- [ ] **UI-09**: Reduced-motion completo — gatear jiggle, hover scale/blur e transições de página. As três superfícies existentes acertam isso pela metade, cada uma de um jeito. O host Windows é a primeira a fazer certo. *(Q5)*
- [ ] **UI-10**: Estados de carregando, vazio, offline, erro e sucesso, todos acionáveis.
- [ ] **UI-11**: Validação por Playwright `_electron` contra DOM real, não regex sobre fonte.
- [ ] **UI-12**: Harness de screenshot golden com **baseline capturada do Dokke real**, não inventada. A primeira captura já existe: `.maxvision/research/baseline-pwa-landscape.png`, feita em 2026-09-17 com `node server.js` rodando no Windows sem modificação, viewport 844×390 — mostra o grid 4×2 landscape, os tiles squircle, o ember de fundo e os 5 page dots. Tolerância percentual calibrada contra 3 builds consecutivas antes de virar trava, porque ClearType, escala de DPI e sombra de janela do Windows produzem diferença de pixel sem mudança de design. O chrome do desktop (sidebar, área de caption) **não tem baseline capturável nesta máquina** — o app macOS não compila aqui, então essa parte depende de aprovação única de um render. *(E6, aceito 2026-09-17)*
- [x] **UI-13**: **Responsividade da tela "Apps abertos" no cliente PWA.** A fila horizontal de
altura travada (`.deck`) é o dock do Dokke e está certa numa tela larga. Em retrato, medido num
viewport 390x844 com 6 apps abertos, dava 6 cartões em 1 linha, 2 fora da tela, e 479px mortos
abaixo. Em retrato a mesma marcação vira grade que embrulha, ancorada no topo, sem tocar o
caminho landscape (a baseline de UI-12 continua byte-a-byte a mesma). **Entregue em `5ff25f8`**,
antes de existir fase dona — a fase foi escrita depois para não deixar a entrega sem
rastreabilidade. *(achado no teste ponta-a-ponta de 2026-09-18)*
- [ ] **UI-14**: **Modelo de toque do cliente PWA, um cartão por JANELA.** Hoje só existe um
gesto: um toque chama `activateApp` por nome. Passa a ser:
  - **um toque** — traz aquela janela pra frente; se ela **já** está em foco, minimiza (alterna)
  - **toque duplo** — abre uma janela nova daquele app
  - **toque longo** — ícone de lixeira **ou** toast de confirmação antes de fechar; confirmar
    fecha, cancelar não fecha. O padrão de toque longo já existe no cliente pra remoção de fixo
    (`test/ui.test.mjs:198`) — reaproveitar, não inventar outro
  - **um cartão por janela**, não por app: duas janelas do Firefox são dois cartões, cada um
    dizendo de qual monitor é e com qual título, senão o usuário não sabe qual ele vai tocar
  - o estado (em foco / segundo plano / minimizada) é **visível no cartão antes do toque**
  - os quatro gestos não podem se atropelar: um toque não vira duplo, arrasto do deck não vira
    toque, toque longo não dispara durante rolagem
Depende de PLAT-11 (ler janelas e estados) e PLAT-12 (as ações existirem).
*(revisado 2026-09-19: era um cartão por app)*
### Design system

- [ ] **DES-01**: Declarar os tokens extraídos da pesquisa (63 tokens com proveniência `path:linha` — a enumeração completa do §12 de DESIGN-LANGUAGE.md, transcrita em `design/tokens.mjs`; "50" era uma estimativa anterior à transcrição, ver cabeçalho "COUNT DISCREPANCY" em `design/tokens.mjs`) como fonte única.
- [ ] **DES-02**: **Tema claro completo** além do escuro — cada token de cor duplicado, os 5 call sites de glass revisados, ambos os temas testados em toda superfície. *(D11)*
- [ ] **DES-03**: Carregar Inter de verdade na landing. Hoje é declarada com `font-synthesis: none` e **nunca carregada** (`style.css:11-12`), então os pesos 650/750 caem para o que o SO oferece — e quem cai em Segoe UI é justamente o público Windows. *(Q3)*
- [ ] **DES-04**: Eliminar tokens mortos que leem como spec: `--glass` e `--edge` (`index.html:28-29`), `--purple` (`style.css:8`), todos com zero referências. *(Q36)*
- [ ] **DES-05**: Não transcrever como spec o código morto do Mac — `customTrafficLights`, `sidebarChromeRadius = 20` (o raio real é 18), `DockIcon.cornerRadius = 20` (o card visível é 28). *(Q17)*
- [ ] **DES-06**: Cores semânticas do macOS (`.quaternary`, `.accentColor`) precisam ser amostradas de render, não inventadas. Só existe render escuro. *(U10)*

### Empacotamento

- [ ] **PKG-01**: Instalador x64 NSIS via electron-builder, sem exigir Node do usuário.
- [ ] **PKG-02**: Gate explícito de Windows 11 no instalador. *(D12)*
- [ ] **PKG-03**: Dados do usuário em `%LOCALAPPDATA%`, fora da pasta de instalação. *(D3, W11)*
- [ ] **PKG-04**: Desinstalador que preserva dados por decisão, com checkbox opt-in de remoção. *(D8)*
- [ ] **PKG-05**: Assinatura de código — OV/EV ou Azure Trusted Signing.
- [ ] **PKG-06**: Decidir e documentar se `test/windows-package.test.mjs` pula em runner não-Windows, seguindo o padrão `macOnly` existente. *(W20)*

### Rebrand

- [ ] **BRAND-01**: **Repontar as 4 superfícies de update primeiro.** `DokkeUpdateManager.swift:33`, `MainActivity.kt:70`, `main.js:4-5`, `server.js:85-95` apontam para `felipenalves/Dokke`. Sem isso, um build DeckTech se auto-atualiza para o upstream. *(R2 — bloqueia todo o resto do rebrand)*
- [ ] **BRAND-02**: Migração `%APPDATA%\Dokke` → DeckTech por copy-if-absent, nunca rename. O padrão correto já existe em `server.js:939-954`. `schemaVersion` não pode dirigir isso: é escrito e ecoado, mas nunca faz `switch`. *(R3)*
- [ ] **BRAND-03**: Regenerar os 5 SHA-256 de `test/brand-icon-assets.test.mjs:209-215` como etapa de primeira classe, não efeito colateral. *(R4)*
- [ ] **BRAND-04**: Atualizar `test/docs-hero-motion.test.mjs` e `test/release-version.test.mjs` no mesmo commit da troca. *(R5, R6, D5)*
- [ ] **BRAND-05**: Importar `PIN_FILE`/`SESSION_FILE` de `auth.js:8,10` em `server.js:950-958`, onde os literais estão duplicados. *(R7)*
- [ ] **BRAND-06**: Landing ganha terceira chave de download, terceiro botão e SVG do Windows; resolver o breakpoint 420px onde `.hero-actions` empilha dois botões e o separador `.cta-plus` não generaliza para três. Remover `.windows-note` e inverter `faq.6`. *(R8)*
- [ ] **BRAND-07**: Ler a chave antiga `dokke_landing_lang` uma vez como fallback ao migrar. Sem isso, todo visitante recorrente perde a preferência de idioma. *(R10)*
- [ ] **BRAND-08**: Renames seguros do Android — `applicationId`, `namespace`, `rootProject.name`, `app_name`, props de release, tag de Logcat, copy de `AndroidLanguage.kt`. Mantidos **separados** das strings de wire de propósito. *(R12)*
- [ ] **BRAND-09**: Limpar a chave legada `"j5.baseURL"` em UserDefaults (`DockStore.swift:14`). *(R11)*
- [ ] **BRAND-10**: Conteúdo novo e verdadeiro para `docs/public/tutorial-dokke.html`, que hoje narra a história de fundação pessoal do Dokke. Não é find-and-replace. *(R9)*
- [ ] **BRAND-11**: Atribuição a Felipe Natanael preservada e visível; DeckTech soma a sua ao lado. *(D2)*
- [ ] **WIRE-01**: Identidade de protocolo dual-accept, DeckTech primário *(D19)*. Três pontos de acoplamento, todos verificados em 2026-09-18:
  1. **Magic UDP** — `server.js:207` compara `msg.trim() !== DISCOVERY_MAGIC` (igualdade exata). Aceitar `dokke:discover` **e** `decktech:discover`.
  2. **Resposta UDP** — `server.js:208` emite `` `dokke:${ip}:${portHint}` ``, casado por regex ancorado em `DokkeDiscovery.kt:11`. Responder com o prefixo **que foi perguntado**, nunca o outro.
  3. **Corpo de `/health`** — `server.js:377` emite `{"ok":true,"service":"Dokke"}`, casado por regex de **corpo inteiro** em `DokkeDiscovery.kt:12`, que rejeita qualquer chave a mais. Cliente DeckTech manda header próprio e recebe `"service":"DeckTech"`; requisição sem o header recebe o corpo legado byte a byte.
  Idem `server.js:777` (`/api/status`), consumido por `ServerManager.swift:232`.
  A PWA **não** é ponto de acoplamento: `public/index.html:2251` valida só `r.data.ok === true`, nunca o campo `service` — verificado.
  O ramo legado nasce com **data de remoção declarada em comentário no código**, não "algum dia". Teste obrigatório: um cliente sem header recebe o corpo legado byte a byte e o regex ancorado do Android casa; um cliente com header recebe DeckTech. Os dois provados por asserção que falha se o ramo sumir.
- [ ] **BRAND-12**: Reapontar o check de versao para o DeckTech **e mante-lo desligado por flag ate a primeira release existir**. `server.js:90,97,98` apontam hoje para `felipenalves/Dokke/releases/latest` e o asset `dokke.apk`; `gh release list --repo produtoramaxvision/DeckTech` retorna vazio, entao so reapontar manda o updater para um endereco sem releases. A RF-10 do PRD diz que atualizacao automatica silenciosa nao e requisito de MVP. Religar a flag e etapa da primeira release, registrada como tal. *(D18)*
- [ ] **BRAND-13**: **Strings `Dokke` de runtime.** `server.js:1349` imprime
`Dokke ouvindo em http://127.0.0.1:3000` no boot de um produto chamado DeckTech. Nenhum requisito
da Fase 1 cobria texto de log: BRAND-01 cobre as 4 superfícies de auto-update e
BRAND-03/04/05/11/12 cobrem hashes de ícone, testes, imports de `auth.js`, atribuição e o check de
versão. `server.js:519` e `:962` continuam `Dokke` **de propósito** (dual-accept do WIRE-01, não
mexer); `server.js:1163-1164` é BRAND-02, da Fase 4. *(achado em 2026-09-18)*


- [x] **BRAND-14**: **Strings de marca do cliente PWA.** `public/index.html` é a tela que o
usuário vê no celular e dizia "Conectar ao Dokke", "Conecte o aparelho ao seu **Mac**" e
"Dokke by Felipe Natanael" — num produto chamado DeckTech cujo diferencial é o host Windows.
BRAND-11 cobria `LICENSE`, `README` e `docs/src/main.js`; BRAND-01 cobria as quatro superfícies
de auto-update. Nenhum dos dois olhava o cliente.

Entregue: título, cartão de login e avisos de update passam a dizer DeckTech nos dois idiomas;
"Mac" vira "computador" porque o host é Windows; o rodapé é `DeckTech by Produtora MaxVision`
com link pra `https://www.produtoramaxvision.com.br` (`target="_blank" rel="noopener noreferrer"`),
com a linha de origem preservada e **visível** logo acima dela — a D2 exige isso e a última linha
do cartão continua sendo a do DeckTech, como pedido.

**Achado dentro deste requisito: existe uma QUINTA superfície de update que BRAND-01 não listou.**
`public/index.html:3152,3161` tinha dois fallbacks hardcoded pra
`felipenalves/Dokke/releases/latest`. Hoje estão inertes porque `ENABLE_VERSION_CHECK=false`
(`server.js:89`) faz `rel` vir vazio, mas no dia em que BRAND-12 ligasse a flag um `rel.apkUrl`
ausente mandava o celular baixar o APK do **Dokke upstream** por cima do DeckTech. Repontados.

**Não renomear `window.DokkeAndroid`** (`public/index.html:1070,1109,1587,3100+`): é o nome da
bridge injetada pelo APK já instalado no aparelho. Renomear quebra o APK em campo — mesmo
espírito do dual-accept do WIRE-01. UI-08 adiciona `window.DeckTechWindows` **ao lado**.
Travado por `test/brand-14-client-strings.test.mjs`. *(achado do usuário, 2026-09-19)*

### Testes e CI

- [ ] **TEST-01**: Extrair os invariantes do PRD §7 numa fixture compartilhada consumida pelos testes Mac, PWA e Windows. Hoje Mac e PWA codificam os mesmos invariantes em dois dialetos de regex independentes; uma terceira cópia à mão é exatamente o drift que o §7 existe para prevenir. *(W18)*
- [ ] **TEST-02**: Cobertura net-new da tela Conectar. Metade dos bullets do PRD §7 não tem teste de UI em plataforma nenhuma — copiar/abrir URL, contagem de dispositivos, regeneração de PIN. *(W19)*
- [ ] **TEST-03**: CI passa a rodar em `push`/`pull_request`. Hoje ambos os workflows são `workflow_dispatch` only — **não rodam em nenhum commit**. *(Q1)*
- [ ] **TEST-04**: Adicionar `npx playwright install` antes do `npm test` no CI. Desde Playwright 1.38 o pacote não baixa binários no `npm ci`, e os 10 `chromium.launch()` de `ui.test.mjs` falhariam num runner limpo. *(Q2)*
- [ ] **TEST-05**: Ligar os 4 testes JUnit do Android a automação. Hoje não rodam em lugar nenhum. *(Q23)*
- [ ] **TEST-06**: Orçamento de performance como critério de sucesso verificável, não como intenção. Ligar os 5 scripts de `measure/` (`deck-ab.mjs`, `deck-debug.mjs`, `deck-probe.mjs`, `jank.mjs`, `swiping-probe.mjs`) a `node --test` e ao `package.json` — hoje existem no repo e não estão em nenhum dos dois (item N4). Fixar números para cold start, tempo até o dock pintar e RSS ocioso. Calibrar contra baseline medido **antes** de virar trava, senão reprova build correta. *(E3 + N4, aceito 2026-09-17)*
- [ ] **TEST-07**: E2E em hardware real no Galaxy S10e. Toolchain confirmado nesta máquina em 2026-09-17: Gradle 8.5 via wrapper, Kotlin 1.9.20, SDK platforms android-34 e android-37.0, JDK 17.0.18 LTS, e `app-debug.apk` de 2.297.465 bytes já construído. Device por adb wireless em `100.125.203.58:36403`, LAN direta `192.168.15.22`, mesma sub-rede do host. Cobre: instalar o APK, conectar pelo PIN, acionar um app Windows, e **provar empiricamente** o hazard de `applicationId` (BRAND-08) e o bug do `directedBroadcast` com Tailscale (FIX-04), hoje ambos dedução de leitura de código. Teste dependente de aparelho físico não roda em CI — documentar como gate manual, não fingir que é automático. *(E5, aceito 2026-09-17)*

### Correções de qualidade que entram no v1

- [ ] **FIX-01**: Fallback de rename atômico em `config.js:195-201`. Hoje `await rename(tmp, file)` não tem `catch`, propaga a exceção e deixa `.tmp` órfão; no Windows falha com EPERM/EBUSY sob antivírus, Indexer ou OneDrive. `auth.js:135-138` já tem o padrão certo. *(W9)*
- [ ] **FIX-02**: ACL NTFS explícita (icacls) ou DPAPI para o arquivo de PIN. `chmod(0o600)` no Windows só alterna o bit read-only; a proteção depende da ACL herdada, que inclui Administrators e SYSTEM. *(W10)*
- [ ] **FIX-03**: `mkdirSync(dataDir)` não pode mais engolir o erro em silêncio (`server.js:935`). Com `%APPDATA%` redirecionado por política de grupo, toda escrita seguinte falha sem diagnóstico. *(Q30)*
- [ ] **FIX-04**: `directedBroadcast()` do Android não pode pegar a primeira interface IPv4 não-loopback. Com Tailscale enumerado primeiro — **observado no dispositivo de teste real** — mira a sub-rede errada. *(Q33)*
- [ ] **FIX-05**: Watchdog ligando a descoberta LAN bounded (que sabe em ~7-8 s que ninguém respondeu) ao painel offline, que hoje leva ~90 s para aparecer. *(Q6)*
- [ ] **FIX-06**: Copy do painel offline distinguindo "host fechado" de "host rodando, firewall bloqueando". O PRD §15 já sinaliza o Firewall do Windows como bloqueador provável. *(W21)*
- [ ] **FIX-07**: `fallbackIcon` do `DockIcon.swift:641-651` renderiza o nome inteiro do app em `.title.bold()` num tile de 68×68 e transborda com mais de ~3 caracteres. Padronizar no comportamento correto do picker (`AppPickerSheet.swift:368`). *(Q18)*
- [ ] **FIX-08**: Unificar `sw.js` `CACHE` e o `?rev=` da registração, hoje duas cópias editadas à mão da mesma string (`dokke-v24`). Um deploy que bumpar uma e esquecer a outra quebra a propagação de update em silêncio. *(Q4)*

---

## v2 — Deferido com motivo

- **PWA-01**: Decomposição do monolito de 129 KB em fontes + build step que reconcatena. 236 asserções leem o arquivo como texto; o `<style>` é render-blocking por design e o `<script>` é síncrono, medindo layout no mesmo frame. *(N1, D14)*
- **SEC-01**: HTTPS por padrão. Hoje PIN e cookie de sessão trafegam em claro; sniffing passivo de Wi-Fi captura ambos. *(Q26)*
- **SEC-02**: Rate limit de PIN com limite global, não só por IP. 5 tentativas/60 s/IP contra 10.000 PINs dá ~33 h **por IP**, e o atacante controla a chave. *(Q25)*
- **SEC-03**: Sessão com idle timeout, rotação e revogação individual. Hoje são 180 dias sem nenhum dos três. *(Q27)*
- **SEC-04**: `trustLoopback` deixa de assumir single-user. No Windows a premissa quebra estruturalmente — outro usuário interativo ou sessão RDP tem acesso total a `/api/*`, incluindo `GET /api/pin` em texto puro. *(W4)*
- **MAC-01**: Autenticidade no self-update do macOS. O SHA-256 vem da mesma resposta não-autenticada que a URL. *(Q28)*
- **MAC-02**: `install-update.sh` não pode apagar o diretório vivo antes de confirmar o `mv`. *(Q29)*
- **PERF-01**: `DockHoverCoordinator` com `Timer` de 30 Hz sempre ligado *(Q15)*; `ServerManager` spawnando até 7 `node --version` bloqueantes no main actor antes do primeiro frame *(Q14)*; `watchScale()` num `setInterval` de 800 ms eterno, sem guard de página oculta *(Q10)*.
- **LAND-01**: SEO e meta social da landing. Todo o DOM vem de um `innerHTML`; sem `og:*`, `twitter:card`, canonical ou JSON-LD, numa página cujo trabalho é receber link compartilhado. *(Q20)*

## Out of Scope

- Conta, login ou sincronização em nuvem — DeckTech é local-first por princípio *(PRD §4)*
- Acesso remoto pela internet — LAN apenas; o usuário já tem Tailscale se quiser remoto *(PRD §4)*
- Windows como companion — Windows é host *(PRD §4)*
- Sincronização entre múltiplos hosts *(PRD §4)*
- Microsoft Store como canal obrigatório *(PRD §4)*
- Redesign da interface — DeckTech refina a linguagem existente *(PRD §4)*
- Reescrever o companion Android/iPhone *(PRD §4)*
- **Windows 10** — gate explícito no v1. Sem `DWMWA_WINDOW_CORNER_PREFERENCE` os cantos ficam quadrados *(D12)*
- **Tauri** — reabre apenas se surgir orçamento explícito de footprint *(§3.3 da pesquisa)*

---

## Traceability

Preenchido pelo roadmap.

| REQ-ID | Fase | Status |
|---|---|---|
| PROOF-01 | Fase 0 | Concluída |
| PROOF-02 | Fase 0 | Concluída |
| PROOF-03 | Fase 0 | Concluída |
| PROOF-04 | Fase 0 | Concluída |
| PROOF-05 | Fase 0 | Concluída — executada, não implementada |
| PROOF-06 | Fase 0 | Concluída |
| PROOF-07 | Fase 0 | Concluída |
| PROOF-08 | Fase 0 | Concluída |
| BRAND-01 | Fase 1 | Concluída |
| BRAND-03 | Fase 1 | Concluída |
| BRAND-04 | Fase 1 | Concluída |
| BRAND-05 | Fase 1 | Concluída |
| BRAND-11 | Fase 1 | Concluída |
| BRAND-12 | Fase 1 | Concluída |
| WIRE-01 | Fase 1 | Concluída |
| PLAT-01 | Fase 2 | Concluída |
| PLAT-06 | Fase 2 | Concluída com achado aberto — `onStatusChange` não dispara em `FOCUS_RESTRICTED` |
| PLAT-08 | Fase 2 | Concluída |
| OBS-01 | Fase 2 | Concluída |
| PLAT-02 | Fase 3 | Concluída |
| PLAT-03 | Fase 3 | Concluída |
| PLAT-04 | Fase 3 | Concluída |
| PLAT-07 | Fase 3 | Concluída |
| PLAT-09 | Fase 3 | Concluída |
| PLAT-10 | Fase 3 | Concluída |
| BRAND-02 | Fase 4 | Pendente |
| BRAND-13 | Fase 4 | Pendente |
| BRAND-14 | Fase 4 | **Concluída** — entregue antes da Fase 4 |
| PKG-03 | Fase 4 | Pendente |
| FIX-01 | Fase 4 | Pendente |
| FIX-02 | Fase 4 | Pendente |
| FIX-03 | Fase 4 | Pendente |
| SHELL-01 | Fase 5 | Pendente |
| SHELL-02 | Fase 5 | Pendente |
| SHELL-03 | Fase 5 | Pendente |
| SHELL-04 | Fase 5 | Pendente |
| SHELL-05 | Fase 5 | Pendente |
| SHELL-06 | Fase 5 | Pendente |
| SHELL-07 | Fase 5 | Pendente |
| SHELL-08 | Fase 5 | Pendente |
| OBS-02 | Fase 5 | Pendente |
| DES-01 | Fase 6 | Concluída |
| DES-02 | Fase 6 | Concluída |
| DES-03 | Fase 6 | Concluída |
| DES-04 | Fase 6 | Concluída |
| DES-05 | Fase 6 | Concluída |
| DES-06 | Fase 6 | Concluída — registro de não-amostragem |
| FIX-08 | Fase 6 | Concluída |
| TEST-01 | Fase 6 | Concluída |
| UI-01 | Fase 7 | Pendente |
| UI-07 | Fase 7 | Pendente |
| UI-08 | Fase 7 | Pendente |
| UI-11 | Fase 7 | Pendente |
| UI-12 | Fase 7 | Pendente |
| UI-02 | Fase 8 | Pendente |
| UI-03 | Fase 8 | Pendente |
| UI-04 | Fase 8 | Pendente |
| UI-05 | Fase 8 | Pendente |
| UI-06 | Fase 9 | Pendente |
| UI-09 | Fase 9 | Pendente |
| UI-10 | Fase 9 | Pendente |
| TEST-02 | Fase 9 | Pendente |
| PKG-01 | Fase 10 | Pendente |
| PKG-02 | Fase 10 | Pendente |
| PKG-04 | Fase 10 | Pendente |
| PKG-05 | Fase 10 | Pendente |
| PKG-06 | Fase 10 | Pendente |
| BRAND-08 | Fase 11 | Pendente |
| BRAND-09 | Fase 11 | Pendente |
| FIX-04 | Fase 11 | Pendente |
| FIX-05 | Fase 11 | Pendente |
| FIX-06 | Fase 11 | Pendente |
| FIX-07 | Fase 11 | Pendente |
| BRAND-06 | Fase 12 | Pendente |
| BRAND-07 | Fase 12 | Pendente |
| BRAND-10 | Fase 12 | Pendente |
| TEST-03 | Fase 13 | Pendente |
| TEST-04 | Fase 13 | Pendente |
| TEST-05 | Fase 13 | Pendente |
| TEST-06 | Fase 13 | Pendente |
| TEST-07 | Fase 13 | Pendente |
| PLAT-05 | Fase 3 → Fase 14 | **REABERTA** — não traz a janela pra frente |
| PLAT-11 | Fase 14 | Pendente |
| PLAT-12 | Fase 14 | Pendente |
| UI-13 | Fase 15 | **Concluída** em `5ff25f8` |
| UI-14 | Fase 15 | Pendente |
| OBS-03 | Fase 15 | Pendente |
| ACT-01 | Fase 16 | Pendente |

Total de requisitos únicos: 88 em 17 fases. Fechados: Fases 0, 1, 2, 3 e 6 = 34,
mais UI-13, entregue antes de a Fase 15 existir. PLAT-05 conta como fechada na Fase 3 e
REABERTA na Fase 14 — aparece uma vez só, com as duas fases na mesma linha.
Esta tabela é gerada do ROADMAP, então as duas não podem divergir em silêncio.
mais UI-13 entregue fora de fase.
A tabela é gerada do ROADMAP, então as duas não podem divergir em silêncio.
A tabela ficava com 67 linhas: BRAND-12, OBS-01, OBS-02, PLAT-09, PLAT-10, PROOF-06, PROOF-07,
PROOF-08, SHELL-08, TEST-06, TEST-07, UI-12 e WIRE-01 entraram depois dela e nunca foram
adicionados. Agora ela é gerada do ROADMAP, então as duas não podem divergir de novo.

Os itens de §v2 (PWA-01, SEC-01..04, MAC-01/02, PERF-01, LAND-01) **não** aparecem nesta
tabela: estão fora do v1 por decisão registrada e não têm fase atribuída.

