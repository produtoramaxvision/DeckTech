# Roadmap: DeckTech

## Overview

DeckTech sai de um fork do Dokke v0.2.8 — um servidor Node com injeção de plataforma já pronta
(`server.js:295-298`, `apps.js:559-573`) servindo três clientes macOS-only — e chega a um host
Windows de primeira classe instalável, sem que macOS, Android, PWA ou landing regridam.

A jornada tem três movimentos que se sobrepõem no tempo. **Medir antes de escolher:** a Fase 0
fecha por medição nesta máquina as quatro incógnitas que o plano herdado deixou abertas (ícone
256px, enumeração UWP, leitura de `.lnk`, exclusão de desinstaladores). **Trocar o provider, não
o protocolo:** o contrato de plataforma, os provedores Windows, o shell Electron e as três
camadas de UI sobem em ordem, sem que nenhuma rota HTTP ou mensagem WebSocket mude. **Rebrandar
sem se auto-destruir:** BRAND-01 reponta as quatro superfícies de update antes de qualquer outro
trabalho de marca, porque até lá um build DeckTech baixa e instala o Dokke upstream por cima de
si mesmo.

**Sobre a contagem de fases.** A granularidade `fine` sugere 8-12 fases; aqui são 14, porque 67
requisitos atravessam 5 superfícies (core Node, PWA, macOS, Android, landing) e 3 camadas
técnicas do host novo (adaptador, shell, UI) com contratos congelados entre elas. Comprimir
fundiria fronteiras de dependência reais — em especial a Fase 2, que existe separada
precisamente para não esperar a Fase 0.

**Sobre camadas horizontais.** A estratificação adaptador → shell → UI é deliberada, não o
anti-padrão. O contrato entre as camadas já está congelado e verificado (`{name,path,icon}` para
apps, `{name,pid,type}` para processos, PNG binário para ícone), e o próprio PRD herdado organiza
o trabalho assim. Cada camada é verificável isoladamente contra esse contrato.

**Revisado em 2026-09-18.** WIRE-01 saiu do v2 e entrou na Fase 1 como dual-accept (D19). O D1 original
e **não aparece neste roadmap**: o APK já distribuído casa o corpo de `/health` por regex
ancorada (`DokkeDiscovery.kt:12`) e não atualiza em lockstep. SEC-01..04, PWA-01, MAC-01/02,
PERF-01 e LAND-01 idem, por REQUIREMENTS.md §v2.

## Phases

**Phase Numbering:**
- Integer phases (0, 1, 2, ...): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

A Fase 0 conserva o número que REQUIREMENTS.md (`### Fase 0 — Prova técnica`) e
`research/SUMMARY.md §6` já usam, para não criar um off-by-one entre documentos irmãos.

- [ ] **Phase 0: Prova técnica Windows** - Fecha por medição nesta máquina as quatro incógnitas do plano herdado
- [ ] **Phase 1: Identidade de release e trava de auto-update** - Um build DeckTech para de se auto-atualizar para o Dokke upstream
- [ ] **Phase 2: Contrato de plataforma e erros tipados** - Fábrica explícita de providers por SO, sem mudar protocolo
- [ ] **Phase 3: Provedores Windows** - Apps, ícones 256px, processos e foco de janela no Windows
- [ ] **Phase 4: Dados do usuário no Windows** - PIN, config e sessões em `%LOCALAPPDATA%`, migrados e protegidos
- [ ] **Phase 5: Shell Electron** - App Windows que sobe, supervisiona e derruba o servidor embutido
- [ ] **Phase 6: Contrato visual — tokens e fixture §7** - Fonte única de design e de invariantes estruturais para as três superfícies
- [ ] **Phase 7: UI desktop — chrome e navegação** - Janela, sidebar, área de caption e harness de DOM real
- [ ] **Phase 8: UI desktop — dock, slots e picker** - O usuário monta seu dock a partir de um estado vazio de verdade
- [ ] **Phase 9: UI desktop — Conectar e estados** - O celular conecta pelo PIN e todo estado do sistema é legível
- [ ] **Phase 10: Empacotamento e instalador** - Instalador x64 sem exigir Node, com desinstalação que preserva dados
- [ ] **Phase 11: Paridade dos companions (Android e macOS)** - Rebrand seguro e os bugs que o hardware real expôs
- [ ] **Phase 12: Landing DeckTech** - Três plataformas de download e conteúdo verdadeiro
- [ ] **Phase 13: CI e automação de testes** - A suíte roda sozinha em cada commit, incluindo os testes Android
- [ ] **Phase 14: Controle de janela** - Um toque no celular foca, minimiza, fecha ou abre nova janela — e o cliente sabe qual é qual
- [ ] **Phase 15: Cliente PWA — responsividade e gestos** - A tela do celular se adapta à orientação e traduz os quatro gestos em ações
- [ ] **Phase 16: Ações do dock — a costura de Stream Deck** - Um tipo de botão novo é um módulo, não uma edição em seis arquivos

## Phase Details

### Phase 0: Prova técnica Windows
**Goal**: Nenhuma incógnita de mecanismo resta aberta — o adaptador Windows sabe, por medição
feita nesta máquina, como extrai ícone, como enumera apps e como resolve atalhos.
**Depends on**: Nothing (primeira fase; roda em paralelo com as Fases 1, 2, 6 e 13)
**Requirements**: PROOF-01, PROOF-02, PROOF-03, PROOF-04, PROOF-05, PROOF-06, PROOF-07, PROOF-08
**Success Criteria** (what must be TRUE):
  1. Um script de benchmark rodável imprime ms/ícone e taxa de sucesso para cada candidato
     (N-API, koffi, pool PowerShell) contra a linha de base medida de 43,2 ms do
     `IShellItemImageFactory`, e o vencedor está nomeado num ADR versionado.
  2. Executar o enumerador UWP imprime Calculadora, Fotos e Terminal — os três hoje ausentes do
     scan por `.lnk` — cada um com caminho de ativação e a contagem total do scan. **Desvio
     registrado (2026-09-18, PROOF-02 round 2):** Windows Terminal
     (`Microsoft.WindowsTerminal_8wekyb3d8bbwe`) não está instalado nesta máquina — verificado por
     três vias independentes (`Get-AppxPackage -Name "*Terminal*"` vazio, `where.exe wt.exe` não
     encontra, `winget list --id Microsoft.WindowsTerminal` sem pacotes). Por regra 1 (nunca
     instalar software só para fazer uma prova passar), o critério foi satisfeito com uma
     substituição no 3º slot: o PowerShell empacotado via Store (`Microsoft.PowerShell_8wekyb3d8bbwe`,
     confirmado instalado, mesmo formato de AUMID, mesmo caminho de código de classificação/ativação
     que o Terminal exerceria). Ver `docs/adr/0002-proof-02-uwp-app-enumeration.md` para a evidência
     completa. Critério considerado satisfeito com esta substituição nomeada.
  3. O leitor binário de `.lnk` em Node resolve os mesmos atalhos que o COM resolveu, com a
     lista de targets idêntica e o tempo total impresso lado a lado com os 2395 ms/149 medidos.
  4. Um scan completo desta máquina não retorna nenhuma entrada cujo target seja `unins*.exe`, e
     a regra que a exclui está em código com teste.
  5. `npm ci && node --test` foi executado neste Windows e a saída de `test/auth.test.mjs:106`
     (`mode & 0o777 === 0o600`) está registrada como pass ou fail nominal — U3 vira fato.
**Validação nesta máquina**: integral. Esta fase **exige** Windows nativo e não pode ser feita
em outro lugar.
**Plans**: TBD

### Phase 1: Identidade de release e trava de auto-update
**Goal**: Um build DeckTech nunca baixa nem instala o Dokke upstream, e a linha de versão do
DeckTech começa em `0.1.0` com os pins de teste que a guardam atualizados no mesmo commit.
**Depends on**: Nothing (roda em paralelo com as Fases 0, 2, 6 e 13)
**Requirements**: BRAND-01, BRAND-03, BRAND-04, BRAND-05, BRAND-11, BRAND-12, WIRE-01
**Ordem interna obrigatória**: **BRAND-01 é o plano `01-01` desta fase.** Nenhum outro requisito
de rebrand — nesta fase ou em qualquer outra — começa antes de BRAND-01 estar mergeado. A
restrição é de requisito, não de fase: dependência de fase sozinha não a codifica.
**Success Criteria** (what must be TRUE):
  1. `grep -rn "felipenalves/Dokke" server.js docs/src/main.js mac/Sources android/` retorna zero
     ocorrências nas superfícies de update; as 4 (`DokkeUpdateManager.swift:33`,
     `MainActivity.kt:70`, `docs/src/main.js:4-5`, `server.js:85-95`) apontam para
     `produtoramaxvision/DeckTech`.
  2. `node --test test/release-version.test.mjs` passa com `0.1.0` fixado nos 5 arquivos e falha
     se um deles divergir — a forcing function continua funcionando, apontada para a linha nova.
  3. `node --test test/brand-icon-assets.test.mjs` passa contra os 5 novos PNGs de launcher; os
     5 SHA-256 antigos não aparecem mais em `test/brand-icon-assets.test.mjs:209-215`.
  4. `grep -n '"\.j5-pin"\|"j5-sessions\.json"' server.js` retorna vazio — os 3 call sites
     importam `PIN_FILE`/`SESSION_FILE` de `auth.js:8,10`.
  5. `LICENSE` mantém o copyright de Felipe Natanael byte a byte e o README exibe a atribuição de
     origem ao lado da do DeckTech — verificável por leitura, e nenhum find-and-replace tocou
     `felipenalves` como nome de pessoa.
**Validação nesta máquina**: parcial. Os greps e os `node --test` rodam aqui. O comportamento de
runtime das duas superfícies repontadas **não**: `DokkeUpdateManager.swift` não compila em Windows. **Correcao de 2026-09-17:** `MainActivity.kt` **e** validavel aqui — Gradle 8.5 via wrapper, Kotlin 1.9.20, SDK platforms android-34 e android-37.0, JDK 17.0.18, e `app-debug.apk` de 2.297.465 bytes ja construido. O Galaxy S10e esta conectado por adb wireless. Somente macOS segue bloqueado.
**Plans**: TBD

### Phase 2: Contrato de plataforma e erros tipados
**Goal**: O core Node resolve seus providers por SO através de uma fábrica explícita e devolve
erros de ação que o companion consegue exibir — sem que nenhuma rota HTTP ou mensagem WS mude.
**Depends on**: Nothing. **Esta fase não espera a Fase 0**: PLAT-01 não toca em ícones nem em
enumeração, e o seam de injeção que ela formaliza já existe e está verificado
(`server.js:295-298`, `apps.js:559-573`).
**Requirements**: PLAT-01, PLAT-06, PLAT-08, OBS-01
**Success Criteria** (what must be TRUE):
  1. `platform/index.js` existe e, num teste que força `process.platform` para `win32` e
     `darwin`, devolve os 5 membros do contrato (`listInstalledApps`, `listAppProcesses`,
     `activateApp`, `openWebsite`, `iconService`) para cada SO — sem o ramo `darwin` implícito
     que hoje sobra em `apps.js:571`.
  2. Uma falha de ação chega ao cliente como código tipado distinguível (`FOCUS_RESTRICTED` vs
     `APP_NOT_FOUND` vs `LAUNCH_FAILED`), não como o `{ok:false,error:"erro interno"}` de
     `server.js:133-137` — o mesmo teste verifica isso no macOS existente e no Windows futuro.
  3. Um teste de snapshot fixa a tabela de rotas HTTP e as chaves da mensagem WS `apps`
     (`pieces, revision, pinned, running, devices, v, limits`); ele falha se o port acrescentar,
     remover ou renomear qualquer uma.
  4. Os 36 arquivos de teste existentes passam sem nenhuma asserção **de rota, protocolo ou
     injeção** alterada — a troca é de provider, não de protocolo. Ficam **fora** deste critério
     os pins que outra fase muda de propósito: `release-version.test.mjs` e
     `brand-icon-assets.test.mjs` (Fase 1) e o gate `mode & 0o777 === 0o600` de
     `auth.test.mjs:106` (adjudicado por PROOF-05).
**Validação nesta máquina**: integral.
**Plans**: TBD

### Phase 3: Provedores Windows
**Goal**: Numa máquina Windows, o servidor lista os apps instalados com ícones de 256px, lista
processos e ativa janelas — pelo mesmo contrato que o macOS usa hoje.
**Depends on**: Phase 2 (contrato) e Phase 0 parcialmente — ver "Gating por requisito" abaixo
**Requirements**: PLAT-02, PLAT-03, PLAT-04, PLAT-05, PLAT-07, PLAT-09, PLAT-10
**Gating por requisito** (a Fase 0 não bloqueia esta fase inteira):
  - PLAT-03 ← PROOF-01 (mecanismo de ícone 256px) — **a única aresta que PROOF-01 cria**
  - PLAT-02 ← PROOF-02 (UWP), PROOF-03 (`.lnk`), PROOF-04 (exclusão de desinstaladores)
  - PLAT-04, PLAT-05, PLAT-07 ← nenhuma dependência da Fase 0
**Success Criteria** (what must be TRUE):
  1. `GET /api/apps` nesta máquina devolve ≥122 apps, inclui pelo menos um app UWP (Calculadora)
     e nenhum target `unins*.exe`; a lista vem ordenada por nome e sem duplicata de target path.
  2. `GET /api/icon/:id` devolve PNG 256×256 para um app real; o segundo request ao mesmo id é
     servido do cache de disco com tempo visivelmente menor, e sair da página durante uma carga
     de 122 ícones cancela a fila sem deixar processo órfão no Gerenciador de Tarefas.
  3. Um app sem ícone extraível renderiza um monograma gerado em JS puro —
     `grep -n "sips" apps.js` não retorna nenhuma chamada alcançável no caminho `win32`, e o app
     nunca aparece sem ícone nenhum.
  4. Ativar um app já aberto traz a janela para frente; quando o Windows restringe
     `SetForegroundWindow`, uma nova instância abre e o cliente recebe o erro tipado da Fase 2,
     não um 500 genérico.
  5. Alternar o tema do Windows entre claro e escuro (`AppsUseLightTheme`) invalida o cache de
     aparência de ícone e a próxima carga traz a variante correta — o mesmo efeito observável que
     `readMacIconAppearance` (`apps.js:281`) produz no macOS.

> **PLAT-07 não é código morto.** Seu consumidor é o conjunto duplo de tokens da **Fase 6**
> (DES-02, D11 — tema claro completo). As duas fases rodam em paralelo sem aresta entre si: se a
> Fase 3 entregar antes da Fase 6, PLAT-07 emite um sinal que ainda ninguém consome. Isso é
> esperado, não defeito — não cortar o critério 5 por parecer sem uso. Se D11 fosse revertido
> para dark-only, PLAT-07 sairia do escopo junto (SUMMARY §7.1 pergunta 5).
**Validação nesta máquina**: integral. A rota `/api/apps` e `/api/icon` são exercitáveis aqui com
os 122 apps reais já medidos.
**Plans**: TBD

### Phase 4: Dados do usuário no Windows
**Goal**: PIN, config e sessões vivem em `%LOCALAPPDATA%\DeckTech`, sobrevivem a quem já tinha
Dokke instalado, e falham alto em vez de em silêncio.
**Depends on**: Phase 1, Phase 0
**Requirements**: BRAND-02, BRAND-13, PKG-03, FIX-01, FIX-02, FIX-03
**Gating por requisito**: a Fase 1 fixa o nome final da marca, que é o diretório de destino da
migração (BRAND-02). PROOF-05 determina o que FIX-02 precisa cobrir — se `chmod(0o600)` não
vale em Windows nativo, a ACL explícita ou DPAPI deixa de ser opcional.
**Success Criteria** (what must be TRUE):
  1. Com um `%APPDATA%\Dokke` populado, iniciar o DeckTech cria `%LOCALAPPDATA%\DeckTech` com o
     mesmo PIN e config, e o diretório Dokke original permanece intacto no disco — copy-if-absent
     no padrão de `server.js:939-954`, nunca rename.
  2. Um PIN alterado no DeckTech continua alterado depois de reiniciar com o diretório Dokke
     ainda presente — a migração nunca sobrescreve o que já existe.
  3. `icacls %LOCALAPPDATA%\DeckTech\.j5-pin` mostra ACL explícita restrita ao usuário atual (ou
     o arquivo está cifrado por DPAPI) — não a ACL herdada que inclui Administrators e SYSTEM.
  4. Com o `config.json` travado por outro processo (antivírus/Indexer/OneDrive simulado), salvar
     config não deixa `.tmp` órfão no diretório e não derruba o servidor: o fallback de escrita
     direta de `auth.js:135-138` entra.
  5. Com o diretório de dados negado por permissão, o servidor emite erro diagnosticável no log e
     na UI em vez de seguir adiante e falhar em toda escrita subsequente (`server.js:935` deixa
     de engolir o erro).
**Validação nesta máquina**: integral. Todos os cinco critérios são exercitáveis neste Windows.
**Plans**: TBD

### Phase 5: Shell Electron
**Goal**: O DeckTech abre como um app Windows que sobe, supervisiona e derruba o servidor Node
embutido, com bandeja, inicialização opcional e renderer endurecido.
**Depends on**: Phase 2, Phase 3, Phase 4
**Requirements**: SHELL-01, SHELL-02, SHELL-03, SHELL-04, SHELL-05, SHELL-06, SHELL-07, SHELL-08, OBS-02
**Success Criteria** (what must be TRUE):
  1. Abrir o DeckTech duas vezes foca a janela existente em vez de subir um segundo processo;
     fechar o app encerra o `utilityProcess` filho e nenhum `node.exe` fica órfão no Gerenciador
     de Tarefas.
  2. Com a porta ocupada por um servidor DeckTech de versão de patch diferente, o app **adota** o
     servidor e não o mata ao sair (comparação semântica de versão — o bug de igualdade exata de
     `ServerManager.swift:255-280` não é portado); com a porta ocupada por outra coisa, o app
     mostra a mensagem de porta ocupada em vez de crashar.
  3. O ícone na bandeja reflete o status do servidor em tempo real e os itens abrir/sair
     funcionam com a janela principal fechada.
  4. "Iniciar com o Windows" está desligada por padrão; ligá-la cria a entrada de startup e
     desligá-la a remove — verificável em `shell:startup` ou no registro, sem resíduo.
  5. Um teste falha se `contextIsolation`, `nodeIntegration`, `sandbox`, `webSecurity` ou a CSP
     saírem dos valores endurecidos; e `GET /.j5-pin` responde 404 mesmo com o shell passando
     `opts.root` apontando para o diretório servido.
**Validação nesta máquina**: integral.
**Plans**: TBD
**UI hint**: yes

### Phase 6: Contrato visual — tokens e fixture §7
**Goal**: Existe uma fonte única de verdade para cor/raio/motion e uma fixture única para os
invariantes estruturais do PRD §7, consumidas pelas três superfícies em vez de recopiadas à mão.
**Depends on**: Nothing (roda em paralelo com as Fases 0-5)
**Requirements**: DES-01, DES-02, DES-03, DES-04, DES-05, DES-06, FIX-08, TEST-01
**Success Criteria** (what must be TRUE):
  1. Os 63 tokens da pesquisa (a enumeração completa do §12 de DESIGN-LANGUAGE.md — "50" era uma
     estimativa anterior à transcrição; ver "COUNT DISCREPANCY" em `design/tokens.mjs`) existem
     num arquivo único com proveniência `path:linha`, e um teste falha se um valor de cor, raio ou
     duração aparecer hardcoded fora dele nas superfícies novas.
  2. Toda entrada de cor tem par claro e escuro; uma galeria de tokens renderiza os dois temas
     lado a lado e um teste falha se algum token de cor existir só num deles (D11).
  3. A landing carrega Inter de verdade — `@font-face` ou link presente em `docs/` — e o DevTools
     num Windows limpo mostra Inter ativa nos pesos 650/750 em vez do fallback Segoe UI.
  4. `grep -n -- "--glass\|--edge" public/index.html` e `grep -n -- "--purple" docs/src/style.css`
     retornam vazio; e `sw.js` `CACHE` e o `?rev=` da registração são gerados de uma constante
     única — mudar a versão num lugar muda nos dois.
  5. Os testes Mac, PWA e Windows importam a mesma fixture do §7: alterar um valor na fixture
     quebra os três. O registro de derivação nomeia explicitamente `.quaternary`, `.accentColor`,
     `customTrafficLights`, `sidebarChromeRadius=20` e `DockIcon.cornerRadius=20` como **não
     transcritos**, com a razão de cada um — nenhum hex inventado.
**Validação nesta máquina**: parcial. Tokens, fixture, fonte e greps validam aqui. **DES-06 não**:
amostrar `.quaternary`/`.accentColor` exige um render macOS, e só existe o render escuro
(`ContentView.swift:51` força `.preferredColorScheme(.dark)`). O entregável de DES-06 é o
registro documentado de não-amostragem, não um valor.
**Plans**: TBD
**UI hint**: yes

### Phase 7: UI desktop — chrome e navegação
**Goal**: A janela do DeckTech abre com a sidebar, a área de caption e a ponte de plataforma do
host — e um harness de DOM real que prova isso em vez de regex sobre arquivo-fonte.
**Depends on**: Phase 5, Phase 6
**Requirements**: UI-01, UI-07, UI-08, UI-11, UI-12
**Success Criteria** (what must be TRUE):
  1. A suíte de UI sobe o app por `_electron.launch()` e lê o DOM real; nenhuma asserção de UI
     desta fase em diante é regex sobre código-fonte.
  2. A sidebar mostra **Slots** e **Conectar** (D4 — a build shipada vence o PRD), e o item
     selecionado tem o tratamento visual do Mac (raio 6, destaque de seleção) verificado no DOM.
  3. Com a janela em 840×540 e em 1400×900, os botões de caption do Windows não colidem com o
     título nem com a sidebar; o título permanece alinhado à borda de ataque da sidebar e passar
     o mouse no botão maximizar ainda abre os snap layouts do Windows.
  4. `window.DeckTechWindows` expõe os 5 métodos de `window.DokkeAndroid`; chamar cada um de
     dentro do renderer não lança, e os no-ops estão declarados explicitamente em vez de
     resolvidos por `typeof` ausente.
**Validação nesta máquina**: integral.
**Plans**: TBD
**UI hint**: yes

### Phase 8: UI desktop — dock, slots e picker
**Goal**: O usuário monta seu dock — vê um estado vazio de verdade na primeira abertura, adiciona
apps pelo picker, reordena e navega as páginas.
**Depends on**: Phase 7
**Requirements**: UI-02, UI-03, UI-04, UI-05
**Success Criteria** (what must be TRUE):
  1. Na primeira abertura, com zero apps fixados, a tela mostra ilustração, título, explicação e
     **uma única** chamada "Adicionar app" — não os 40 botões "+" sem texto que
     `DockGridView.swift:53-60` produz no Mac (D13; DeckTech supera a referência).
  2. O grid renderiza 4 colunas × 2 linhas por página, até 5 páginas / 40 slots, com peek lateral
     e indicadores de página; a largura mínima de página medida no DOM bate com
     `4×80 + 3×22 + 2×32 = 450`, seguindo as regras `landscape` da PWA
     (`index.html:493-511`), não o default portrait 2×4.
  3. O picker busca por nome, mostra o ícone real do app, marca "Adicionado" para o que já está
     no dock, e "Adicionar" coloca o app no primeiro slot livre.
  4. O modo de reordenação é explícito: o usuário entra nele por ação e sai por ação; fora dele,
     arrastar um tile não move nada.
  5. Remover um app deixa o slot vazio na posição em que estava — os vizinhos não deslizam para
     preencher (paridade com `renderLaunchpad`, `index.html:1647-1652`).
**Validação nesta máquina**: integral.
**Plans**: TBD
**UI hint**: yes

### Phase 9: UI desktop — Conectar e estados
**Goal**: O usuário conecta um celular ao host pelo PIN e sempre sabe em que estado o sistema
está — inclusive quando algo deu errado.
**Depends on**: Phase 7 (chrome e harness). Paralela à Phase 8.
**Requirements**: UI-06, UI-09, UI-10, TEST-02
**Success Criteria** (what must be TRUE):
  1. A tela Conectar mostra PIN, URL, QR Code e status do servidor; o Galaxy S10e na mesma LAN
     (`192.168.15.0/24`) lê o QR e conecta na primeira tentativa, e o iPhone 13 Pro Max abre a
     mesma URL pela PWA.
  2. "Copiar URL" coloca a URL na área de transferência do Windows e "Abrir URL" abre o navegador
     padrão — cada um com teste que verifica o **efeito**, não a existência do botão.
  3. A contagem de dispositivos sobe quando o celular conecta e desce quando ele desconecta;
     regenerar o PIN derruba a sessão do celular e ele volta a pedir PIN (cobertura net-new: hoje
     esses três bullets do PRD §7 não têm teste de UI em plataforma nenhuma).
  4. Carregando, vazio, offline, erro e sucesso são todos alcançáveis por ação do usuário e cada
     um oferece a próxima ação — nenhum é beco sem saída.
  5. Com reduced-motion ligado no Windows, o jiggle da reordenação, o hover scale/blur **e** as
     transições de página ficam desligados — as três, verificadas por teste. As três superfícies
     existentes acertam isso pela metade, cada uma de um jeito diferente.
**Validação nesta máquina**: integral, **e com hardware real** — S10e por adb wireless e iPhone
13 Pro Max por Tailscale, ambos alcançáveis desta LAN.
**Plans**: TBD
**UI hint**: yes

### Phase 10: Empacotamento e instalador
**Goal**: Um usuário Windows 11 baixa um instalador, instala sem ter Node, usa o app, e
desinstala sem perder seus dados a menos que peça.
**Depends on**: Phase 1 (identidade de release), Phase 4 (diretório de dados), Phase 8, Phase 9
**Requirements**: PKG-01, PKG-02, PKG-04, PKG-05, PKG-06
**Success Criteria** (what must be TRUE):
  1. Numa máquina Windows 11 sem Node instalado, o `.exe` NSIS x64 instala e o app abre com o
     servidor online — zero passo manual de runtime pelo usuário.
  2. Rodar o instalador no Windows 10 para com mensagem clara de requisito de versão em vez de
     instalar (D12, gate explícito).
  3. Desinstalar preserva `%LOCALAPPDATA%\DeckTech` por padrão; marcar o checkbox opt-in de
     remoção apaga o diretório — os dois caminhos verificados no disco depois da desinstalação
     (D8: preservar vira decisão, não acidente de localização).
  4. `test/windows-package.test.mjs` roda de verdade neste Windows e pula com razão registrada
     num runner não-Windows, seguindo o padrão `macOnly` de `package-dmg.test.mjs:818`.
  5. O pipeline de assinatura (OV/EV ou Azure Trusted Signing) está configurado e documentado, e
     com um certificado fornecido `signtool verify /pa` no artefato retorna sucesso. **Sem
     certificado disponível, o entregável é o pipeline documentado e o artefato explicitamente
     marcado como não assinado** — não uma afirmação de que o SmartScreen não avisa.
**Validação nesta máquina**: parcial. PKG-01/02/04/06 validam aqui integralmente. **PKG-05 não**:
depende de um certificado OV/EV ou de uma assinatura Azure que pode não existir no momento da
execução.
**Plans**: TBD

### Phase 11: Paridade dos companions (Android e macOS)
**Goal**: macOS e Android não regridem com a entrada do Windows, o rebrand seguro deles acontece
sem tocar nas strings de wire, e os bugs que a validação em hardware real expôs saem.
**Depends on**: Phase 1. Paralela às Fases 3-10.
**Requirements**: BRAND-08, BRAND-09, FIX-04, FIX-05, FIX-06, FIX-07
**Gating por requisito**: BRAND-01 (Fase 1) precisa estar mergeado antes de qualquer item desta
fase — é a restrição de ordem do rebrand.
**Success Criteria** (what must be TRUE):
  1. Depois do rename, `grep -rn "dokke:discover\|\"service\":\"Dokke\"\|DISCOVERY_MAGIC" server.js android/`
     mostra as strings de wire **inalteradas** — D1 cumprido, o APK já distribuído continua
     descobrindo o host. `applicationId`, `namespace`, `rootProject.name`, `app_name`, props
     `DOKKE_RELEASE_*`, tag de Logcat e a copy de `AndroidLanguage.kt` mudaram; e
     `grep -n "j5.baseURL" mac/Sources/` retorna vazio.
  2. Num device com Tailscale ativo — o cenário observado no S10e real — o broadcast dirigido
     mira a sub-rede da LAN e não a da VPN, verificável pelo log da interface escolhida.
  3. Com o host desligado, o painel offline aparece em ~8 s (não ~90 s), ligado ao resultado da
     descoberta LAN bounded; e a copy distingue "host fechado" de "host rodando, firewall
     bloqueando".
  4. O tile de fallback do Mac mostra uma inicial e não o nome inteiro transbordando o tile de
     68×68 — mesmo comportamento de `AppPickerSheet.swift:368`.
  5. O caminho de migração do APK está decidido e escrito na nota de release. **Hazard
     verificado**: com `applicationId` mudando de `com.dokke.app`
     (`android/app/build.gradle:35`), a guarda `if (archive.packageName != packageName) return false`
     (`MainActivity.kt:486`) faz o APK DeckTech ser **rejeitado como update** e instalado lado a
     lado. `signaturesMatch` agrava — o fork não tem o keystore `DOKKE_RELEASE_*` do upstream.
     O critério é a decisão documentada, não um update in-place que não existe.
**Validação nesta máquina**: **parcial — corrigido em 2026-09-17.** `mac/Sources/` não compila em Windows 11 (`which swift swiftc xcodebuild` → nenhum), então os critérios de macOS seguem não validáveis aqui. **Android É validável**: Gradle 8.5 via wrapper, Kotlin 1.9.20, SDK platforms android-34 e android-37.0, JDK 17.0.18 LTS, e `app-debug.apk` de 2.297.465 bytes construído nesta máquina em 2026-09-17 07:59. Com o Galaxy S10e em adb wireless, um APK **novo** pode ser construído, instalado e exercitado aqui — o que torna BRAND-08 e FIX-04 verificáveis empiricamente por TEST-07, não só por leitura de código.
**Plans**: TBD
**UI hint**: yes

### Phase 12: Landing DeckTech
**Goal**: A landing apresenta o DeckTech com três plataformas de download e conteúdo verdadeiro,
sem perder a preferência de quem já visitou.
**Depends on**: Phase 1, Phase 10
**Requirements**: BRAND-06, BRAND-07, BRAND-10
**Gating por requisito**: BRAND-01 (Fase 1) precisa estar **mergeado** — ele e BRAND-06 editam o
mesmo literal `downloads` em `docs/src/main.js:4-6`, não apenas o mesmo arquivo. E o botão do
Windows precisa do artefato real produzido na Fase 10.
**Success Criteria** (what must be TRUE):
  1. O hero mostra três botões de download (macOS, Android, Windows) com SVG de plataforma; em
     1280px, 760px e 420px os três permanecem alcançáveis e o separador `.cta-plus` não quebra o
     layout no breakpoint em que hoje só dois botões empilham.
  2. `grep -rn "windows-note\|Em breve" docs/src/` retorna vazio e o FAQ-6 afirma que o Windows
     existe, em vez de dizer que está planejado.
  3. Um visitante que tinha `dokke_landing_lang` gravado abre a landing e vê o idioma que
     escolhera antes — a chave nova é gravada e a antiga é lida uma vez como fallback.
  4. `docs/public/tutorial-*.html` conta a história do DeckTech; nenhuma frase da narrativa
     pessoal de fundação do Dokke sobrou, e a atribuição a Felipe Natanael continua visível.
  5. Clicar o botão Windows baixa o instalador produzido na Fase 10.
**Validação nesta máquina**: integral. Vite builda em Windows e o iPhone 13 Pro Max alcança a
página para conferir a PWA e o layout em iOS.
**Plans**: TBD
**UI hint**: yes

### Phase 13: CI e automação de testes
**Goal**: A suíte de testes roda sozinha em cada commit, com os binários de que precisa,
incluindo os testes Android que hoje não rodam em lugar nenhum.
**Depends on**: Nothing (roda em paralelo com tudo; não está no caminho crítico do host Windows)
**Requirements**: TEST-03, TEST-04, TEST-05, TEST-06, TEST-07
**Success Criteria** (what must be TRUE):
  1. Abrir um PR dispara os workflows — hoje ambos são `workflow_dispatch` only
     (`.github/workflows/test.yml:3-4`) e não rodam em nenhum commit.
  2. Num runner limpo, os 10 `chromium.launch()` de `ui.test.mjs` passam porque o step de
     instalação de browser roda antes do `npm test`.
  3. Os 4 testes JUnit do Android executam no CI e o job fica vermelho se um deles quebrar.
  4. Um commit que quebra qualquer teste deixa o check vermelho visível no PR sem ninguém
     apertar nada.
**Validação nesta máquina**: parcial. O YAML é verificável aqui; a execução de fato (em especial
o step de Gradle do TEST-05) só se prova num runner com SDK Android.
**Plans**: TBD

### Phase 14: Controle de janela
**Goal**: Um toque no celular controla a janela no Windows de verdade — foca, minimiza, fecha ou
abre uma nova — e o cliente consegue saber, antes do toque, em que estado o app está.
**Depends on**: Phase 3 (reabre PLAT-05), Phase 2 (erros tipados)
**Requirements**: PLAT-05 (reaberta), PLAT-11, PLAT-12
**Por que esta fase existe**: o primeiro teste ponta-a-ponta com hardware real (Galaxy S10e, LAN,
2026-09-18) chegou até o último passo e parou. O pareamento por PIN, a descoberta na LAN e os
ícones de 256px funcionaram; tocar num app aberto devolveu
`FOCUS_RESTRICTED: focus restricted for "Firefox", opened new instance` e a janela não veio pra
frente. Medido: `setForegroundReturn: false` com handle válido e `ForegroundLockTimeout` já em
`0`; 0 de 5 ativações reais numa bateria fria. A promessa central do produto — acionar um app do
Windows pelo celular — não está de pé.
**Gating por requisito**: PLAT-05 vem primeiro e sozinha. Enquanto focar não funciona, "um toque
foca e o próximo minimiza" não tem o que alternar. A lane de investigação FG-PROBE
(worker Gemini 3.8 Flash high, revisor Grok 4.6, worktree `decktech-fg`) produz a medição que
decide o caminho: a decisão documentada em `platform/windows/actions.js:20-37` rejeitou
`AttachThreadInput` de propósito, e reverter isso exige evidência, não preferência. PLAT-11 pode
correr em paralelo com PLAT-05 — ela não depende do foco funcionar, só de conseguir LER quem está
em foco. PLAT-12 depende das duas.
**Success Criteria** (what must be TRUE):
  1. Com o Firefox aberto e em segundo plano, tocar nele pelo celular traz a janela pra frente:
     `GetForegroundWindow()` passa a devolver o handle do Firefox. Medido numa bateria de no
     mínimo 10 tentativas frias, com o alvo nunca sendo o foreground anterior, e a taxa de
     sucesso registrada. Uma taxa abaixo de 100% é resultado válido **se** vier com a explicação
     medida de quando falha.
  2. `listAppProcesses` distingue pelo menos três estados por processo — em foco, com janela em
     segundo plano, minimizado — e nenhum deles é literal no código.
  3. `minimizeApp` minimiza a janela e `listAppProcesses` passa a reportar o estado novo.
  4. `closeApp` fecha o app; um app com trabalho não salvo que abre o próprio diálogo de
     confirmação **não** é morto à força, e o cliente recebe erro tipado em vez de um 500.
  5. `activateApp` com modo explícito de nova instância abre uma janela nova **sem** passar pelo
     caminho de erro — hoje instância nova só existe como fallback de `FOCUS_RESTRICTED`.
  6. Os três providers do contrato (`darwin`, `win32`, fallback) respondem aos métodos novos ou
     devolvem o erro tipado `notImplemented` da Fase 2 — nenhum `undefined is not a function`.
**Validação nesta máquina**: integral para win32. O caminho macOS é verificável só por leitura —
`mac/Sources` não compila em Windows 11.
**Plans**: TBD

### Phase 15: Cliente PWA — responsividade e gestos
**Goal**: A tela do celular se adapta à orientação em que o aparelho está e traduz os quatro
gestos nas quatro ações da Fase 14, dizendo ao usuário o que cada toque vai fazer antes dele
tocar.
**Depends on**: Phase 14
**Requirements**: UI-13 (entregue), UI-14, OBS-03
**Por que esta fase existe**: UI-01 a UI-12 são todas do chrome do Electron — sidebar, geometria
da área de caption, bridge `window.DeckTechWindows`. O layout e os gestos do **cliente PWA** não
tinham requisito nem fase; o roadmap só dizia que a PWA não podia regredir. Os dois achados do
teste real de 2026-09-18 caíram exatamente nesse vão. UI-13 foi entregue em `5ff25f8` antes desta
fase existir, e está marcada como entregue em vez de reescrita como pendente.
**Success Criteria** (what must be TRUE):
  1. Em retrato, com mais apps abertos do que cabem numa linha, nenhum cartão fica fora da
     largura da tela e o eixo de toque acompanha o eixo de rolagem. **Já verdadeiro** — travado
     por `test/ui.test.mjs` (UI-13), com o caminho landscape medido byte-a-byte igual.
  2. Um toque num app que está em segundo plano o traz pra frente; um toque no app que **já**
     está em foco o minimiza. O cartão mostra em qual dos dois estados o app está **antes** do
     toque.
  3. Um toque duplo abre uma janela nova, e isso não dispara o caminho de erro.
  4. Um toque longo pede confirmação antes de fechar, no mesmo padrão que
     `test/ui.test.mjs:198` já usa pra remoção de fixo. Confirmar fecha; cancelar não fecha.
  5. Os quatro gestos não se atropelam: um toque não vira toque duplo, um arrasto do deck não
     vira toque, e o toque longo não dispara durante a rolagem. Verificado com Playwright contra
     DOM real, não por leitura de código.
  6. Com o OBS aberto e o servidor WebSocket dele desligado, a mensagem diz isso — não
     "abra o OBS". Com nenhuma senha configurada, diz isso. São causas diferentes e hoje o
     servidor responde `connected: false` para as duas.
**Validação nesta máquina**: integral. Playwright roda aqui e o S10e está na LAN.
**Plans**: TBD

### Phase 16: Ações do dock — a costura de Stream Deck
**Goal**: Um tipo de botão novo no dock é um módulo que se registra, não uma edição espalhada
por seis arquivos — e a primeira prova disso é uma cena do OBS virar botão ao lado do Firefox.
**Depends on**: Phase 15 (o cliente precisa despachar os gestos antes de despachar ações novas)
**Requirements**: ACT-01
**Por que esta fase existe**: o dock tem dois tipos de peça, `"app"` e `"website"`. O OBS já
está conectado e funcionando (14 cenas reais lidas em 2026-09-19), mas vive numa gaveta
separada — não dá pra pôr uma cena como botão. Um Stream Deck é exatamente isso: botões
arbitrários lado a lado. **O catálogo de ações é a decisão D20**; esta fase entrega a costura
e um tipo de prova, não o catálogo inteiro.
**Success Criteria** (what must be TRUE):
  1. Adicionar um tipo de peça novo toca **um** módulo novo mais o registro — não a validação
     do servidor, a rota, `publicCfg`, o renderizador, o despachante e o seletor, que é o que
     custa hoje.
  2. Uma cena do OBS pode ser fixada como botão do dock, aparece ao lado dos apps, e tocá-la
     troca a cena no OBS de verdade — verificado contra o OBS rodando nesta máquina, não
     contra mock.
  3. O botão de cena mostra estado ao vivo: a cena ativa é visivelmente a ativa, e muda quando
     alguém troca de cena pelo próprio OBS.
  4. Um cliente que não conhece o tipo novo recebe `MIXED_PIECES_REQUIRES_NEW_CLIENT`
     (`server.js:483`) em vez de renderizar errado ou quebrar.
  5. A migração de `schemaVersion` sobe e desce: uma config com o tipo novo lida por um servidor
     anterior não corrompe a config do usuário.
**Validação nesta máquina**: integral. OBS Studio conectado, 4455 escutando.
**Plans**: TBD

---

## Paralelismo

`config.json` tem `parallelization: true`. Estes são os conjuntos que podem rodar juntos e a
superfície compartilhada que torna cada um arriscado.

### Conjunto A — do dia zero: Fases 0, 1, 2, 6, 13

| Par | Superfície compartilhada | Risco |
|---|---|---|
| 1 ∥ 2 | `server.js` | Regiões distintas do mesmo arquivo (F1: `:85-95`, `:950-958`; F2: `:133-137`, `:292-300`). Conflito de merge, não de semântica |
| 1 ∥ 6 | `docs/src/main.js`, `docs/src/style.css` | F1 toca a atribuição (`main.js:246-249`); F6 toca `style.css:8,11-12`. Literais distintos, arquivos adjacentes |
| 0 ∥ todos | **nenhuma** | A Fase 0 só escreve scripts de medição e um ADR. Zero risco |
| 13 ∥ todos | `.github/workflows/` apenas | Zero sobreposição com código de produção |

### Conjunto B — depois das dependências: Fases 3, 4, 11

| Par | Superfície compartilhada | Risco |
|---|---|---|
| 3 ∥ 4 | `server.js` bloco `startServer` (`:928-958`) | **Risco real.** F3 injeta providers; F4 muda a resolução de diretório de dados. As duas mexem no bootstrap. Ordenar os planos que tocam `startServer` |
| 11 ∥ 3, 4, 5 | **nenhuma** | F11 vive só em `android/` e `mac/Sources/` |

### Conjunto C — depois da Fase 7: Fases 8, 9

| Par | Superfície compartilhada | Risco |
|---|---|---|
| 8 ∥ 9 | CSS e módulo de estado do renderer Electron | **Risco real.** As duas montam telas na mesma janela e consomem os tokens da Fase 6. Mitigação: dividir por arquivo de componente desde o primeiro plano, com um único dono do estado compartilhado |

### Não paralelizáveis

Fase 5 (precisa de 2+3+4), Fase 7 (precisa de 5+6), Fase 10 (precisa de 1+4+8+9),
Fase 12 (precisa de 1+10).

---

## Validação nesta máquina

Windows 11 Pro 22631. macOS/SwiftUI **não compila aqui**; Android **não builda aqui** (sem Gradle
+ SDK). Galaxy S10e SM-G970F (SDK 31) por adb wireless e iPhone 13 Pro Max por Tailscale **estão
alcançáveis** — runtime Android do APK já instalado e comportamento da PWA em iOS são validáveis
em hardware real.

| Fase | Validável aqui | O que não valida |
|---|---|---|
| 0 | **Integral** — exige Windows nativo | — |
| 1 | Parcial | Runtime de `DokkeUpdateManager.swift` e `MainActivity.kt` |
| 2 | Integral | — |
| 3 | Integral | — |
| 4 | Integral | — |
| 5 | Integral | — |
| 6 | Parcial | **DES-06** — amostra de `.quaternary`/`.accentColor` exige render macOS |
| 7 | Integral | — |
| 8 | Integral | — |
| 9 | **Integral + hardware real** (S10e, iPhone) | — |
| 10 | Parcial | **PKG-05** — depende de certificado OV/EV ou Azure |
| 11 | **parcial** | Android validável aqui (Gradle 8.5 + SDK + S10e); só os critérios macOS exigem outra máquina |
| 12 | Integral | — |
| 13 | Parcial | **TEST-05** — step de Gradle só se prova em runner com SDK |

---

## Progress

**Execution Order:**
As fases executam em ordem numérica (0 → 1 → 2 → … → 13), respeitando os conjuntos de
paralelismo acima. Fases decimais inseridas aparecem entre seus inteiros vizinhos.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Prova técnica Windows | 0/TBD | Not started | - |
| 1. Identidade de release e trava de auto-update | 0/TBD | Not started | - |
| 2. Contrato de plataforma e erros tipados | 0/TBD | Not started | - |
| 3. Provedores Windows | 0/TBD | Not started | - |
| 4. Dados do usuário no Windows | 0/TBD | Not started | - |
| 5. Shell Electron | 0/TBD | Not started | - |
| 6. Contrato visual — tokens e fixture §7 | 0/TBD | Not started | - |
| 7. UI desktop — chrome e navegação | 0/TBD | Not started | - |
| 8. UI desktop — dock, slots e picker | 0/TBD | Not started | - |
| 9. UI desktop — Conectar e estados | 0/TBD | Not started | - |
| 10. Empacotamento e instalador | 0/TBD | Not started | - |
| 11. Paridade dos companions (Android e macOS) | 0/TBD | Not started | - |
| 12. Landing DeckTech | 0/TBD | Not started | - |
| 13. CI e automação de testes | 0/TBD | Not started | - |

---

## Cobertura de requisitos

**67 de 67 requisitos v1 mapeados. Nenhum órfão, nenhum duplicado.**

| Fase | Requisitos | Qtd |
|---|---|---|
| 0 | PROOF-01, PROOF-02, PROOF-03, PROOF-04, PROOF-05 | 5 |
| 1 | BRAND-01, BRAND-03, BRAND-04, BRAND-05, BRAND-11 | 5 |
| 2 | PLAT-01, PLAT-06, PLAT-08 | 3 |
| 3 | PLAT-02, PLAT-03, PLAT-04, PLAT-05, PLAT-07 | 5 |
| 4 | BRAND-02, PKG-03, FIX-01, FIX-02, FIX-03 | 5 |
| 5 | SHELL-01, SHELL-02, SHELL-03, SHELL-04, SHELL-05, SHELL-06, SHELL-07 | 7 |
| 6 | DES-01, DES-02, DES-03, DES-04, DES-05, DES-06, FIX-08, TEST-01 | 8 |
| 7 | UI-01, UI-07, UI-08, UI-11 | 4 |
| 8 | UI-02, UI-03, UI-04, UI-05 | 4 |
| 9 | UI-06, UI-09, UI-10, TEST-02 | 4 |
| 10 | PKG-01, PKG-02, PKG-04, PKG-05, PKG-06 | 5 |
| 11 | BRAND-08, BRAND-09, FIX-04, FIX-05, FIX-06, FIX-07 | 6 |
| 12 | BRAND-06, BRAND-07, BRAND-10 | 3 |
| 13 | TEST-03, TEST-04, TEST-05 | 3 |
| | **Total** | **67** |

**Fora deste roadmap por decisão registrada:** WIRE-01 (D1), PWA-01 (D14), SEC-01, SEC-02,
SEC-03, SEC-04, MAC-01, MAC-02, PERF-01, LAND-01 — todos em REQUIREMENTS.md §v2.

---

## Arestas alteradas em relação a `research/SUMMARY.md` §6

A §6 declara que suas arestas "saíram do que as análises efetivamente encontraram". Estas são as
que mudei ao validá-las contra REQUIREMENTS.md, com a razão de cada mudança.

**1. `F0 → F1a` refinada: de "só a Task 3" para "Tasks 2 e 3, por requisito distinto".**
A §6 diz *"Fase 0 — Prova técnica (bloqueia F1a Task 3; não bloqueia Tasks 1-2)"*, mas o escopo
que a própria §6 dá à Fase 0 inclui W6 (UWP), W7 (exclusão de desinstaladores) e W8 (`.lnk`) — os
três são conteúdo da Task 2, não da Task 3. A §6 é internamente inconsistente aqui.
REQUIREMENTS.md:49 resolve: PLAT-02 é definido literalmente como *"atalhos do Menu Iniciar,
caminhos conhecidos, **UWP**, dedupe por target path, **exclusão de desinstaladores**"* — ou
seja, PLAT-02 consome os entregáveis de PROOF-02 e PROOF-04, e PROOF-03 decide sua estratégia de
resolução de `.lnk`. **Aresta acrescentada: PROOF-02/03/04 → PLAT-02.**
A restrição não negociável fica intacta: **PROOF-01 continua gatando apenas PLAT-03**. O que
mudou é que "Fase 0" deixou de ser sinônimo de "ícones". E PLAT-01, que de fato não depende de
nada da Fase 0, foi isolado numa fase própria (Fase 2) que roda em paralelo com a Fase 0.

**2. Aresta nova: `F0 → Fase 4` (dados do usuário).**
A §6 não liga a Fase 0 a nada de persistência. PROOF-05 mede se `test/auth.test.mjs:106`
(`mode & 0o777 === 0o600`) passa em Windows nativo; W10 diz que `chmod(0o600)` só alterna o bit
read-only. O resultado do PROOF-05 define o que FIX-02 (ACL icacls ou DPAPI) precisa cobrir e se
o teste é um gate falso-negativo. É dependência de conteúdo, não de conveniência.

**3. `F1d` (rebrand não-wire) quebrada em três fases, com aresta de ordem explícita.**
A §6 trata R2…R12 como um bloco único e independente. Mas (a) a restrição de ordem exige
BRAND-01 antes de **todo** o resto do rebrand, e um bloco paralelizável não codifica isso — por
isso BRAND-01 é o plano `01-01` da Fase 1, com a ordem declarada no nível do requisito; e (b) R2
(BRAND-01, `docs/src/main.js:4-5`) e R8 (BRAND-06, `docs/src/main.js:4-6`) editam **o mesmo
literal `downloads`**, não apenas o mesmo arquivo. **Aresta acrescentada: Fase 1 → Fase 12.**

**4. Aresta `F1d → F4` (instalador) substituída e parcialmente invertida.**
A §6 diz *"F1d bloqueia F4 (instalador precisa da identidade final)"*. Só parte de F1d bloqueia:
a identidade de release (BRAND-01/03/04) e o diretório de dados (BRAND-02). BRAND-06/07/10
(landing) e BRAND-08/09 (companions) **não** bloqueiam o instalador — no caso da landing a
direção é a oposta, o botão de download precisa do artefato. **Substituída por: Fase 1 → Fase 10,
Fase 4 → Fase 10, e Fase 10 → Fase 12.**

**5. Aresta nova: `Fase 4 → Fase 5`.**
A §6 não tem fase de persistência e liga F1a direto a F2. Mas o shell é quem estabelece o
diretório de dados no start, e SHELL-07 (`opts.root` overloaded, W13) é exatamente o ponto em que
o shell pode expor `GET /.j5-pin` sem auth. O shell precisa do diretório e da ACL resolvidos
antes, não depois.

**6. `F1b` (fixture §7) e `F1c` (design system) fundidas numa fase só (Fase 6).**
Não é mudança de aresta, é de fronteira: as duas produzem artefatos de contrato único consumidos
pelas três superfícies e bloqueiam exatamente a mesma coisa (a UI desktop). Mantê-las separadas
criava duas fases que nunca divergem em dependência.

**7. `F3` (UI desktop) dividida em três fases (7, 8, 9), com o harness na primeira.**
A §6 trata a Task 5 como fase única. UI-11 (`_electron` contra DOM real) é pré-condição de toda
asserção de UI, então foi para a Fase 7; as Fases 8 e 9 consomem o harness e podem rodar em
paralelo entre si.

**8. `F5` (rebrand de wire) removida do v1 inteiro.**
A §6 a lista como *"paralela a tudo, mas com trava própria"*, com duas opções honestas
(dual-accept ou defer). **D1 escolheu defer** e WIRE-01 está em REQUIREMENTS.md §v2. A fase não
existe aqui, e a Fase 11 tem um critério de aceite que verifica que as strings de wire
permaneceram inalteradas depois do rename do Android.

**9. `F6` (endurecimento e release) removida do v1 inteiro.**
A §6 a define como *"os itens `quality` de segurança que não bloqueiam o MVP (W4, Q25, Q26,
Q27)"*. Os quatro são SEC-04, SEC-02, SEC-01 e SEC-03 — todos em REQUIREMENTS.md §v2. Nenhum
requisito v1 mapeia para ela.

---
*Criado em 2026-09-17 a partir de PROJECT.md, REQUIREMENTS.md (67 requisitos v1) e
research/SUMMARY.md.*

## MAXVISION ORCHESTRATION REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/maxvision:plan-ceo-review` | Scope & strategy | 1 | CLEAR | SELECTIVE EXPANSION: 8 propostas, 8 aceitas, 0 deferidas; 67 -> 79 requisitos, 79/79 mapeados |
| Eng Review | `/maxvision:plan-eng-review` | Architecture & tests (required) | 0 | — | nao executado |
| Design Review | `/maxvision:plan-design-review` | UI/UX gaps | 0 | — | nao executado |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | nao executado |
| DX Review | `/maxvision:plan-devex-review` | Developer experience gaps | 0 | — | nao executado |

**CEO:** duas lacunas de baseline encontradas executando o projeto de verdade no Windows
(`npm ci` aborta com EBADPLATFORM em `macos-alias@0.2.12`; `test/icon.test.mjs` tem testes
macOS-only sem gate). Ambas absorvidas pela Fase 0. Duas lacunas de produto nao cobertas pelo
backlog de 80 itens: observabilidade (OBS-01, OBS-02) e caminho de atualizacao (BRAND-12).
Correcao de audit: o toolchain Android **esta** disponivel nesta maquina (Gradle 8.5, SDK 34/37,
JDK 17, APK construido), ao contrario do que o roadmap afirmava; somente macOS segue bloqueado.

**CROSS-MODEL:** nao aplicavel — outside voice nao executado.

**UNRESOLVED:** 0.

**VERDICT:** CEO CLEARED. Eng review required antes de implementar.
