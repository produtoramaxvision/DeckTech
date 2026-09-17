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
| D1 | Strings de wire **congeladas como `Dokke`** no v1 | `DISCOVERY_MAGIC`, prefixo `dokke:<ip>:<port>` e o corpo de `/health` não mudam. O APK distribuído casa por regex ancorada e não atualiza em lockstep |
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

---

## v1 Requirements

### Fase 0 — Prova técnica

- [ ] **PROOF-01**: Escolher o mecanismo de extração de ícone 256×256 por medição comparada — N-API vs koffi vs pool PowerShell — contra `IShellItemImageFactory` (43,2 ms/ícone medido). `app.getFileIcon()` satura em 48×48 e não atende. *(W5)*
- [ ] **PROOF-02**: Implementar e medir enumeração de apps UWP/Store via `shell:AppsFolder`. Hoje `.lnk` não cobre Calculadora, Fotos nem Terminal. *(W6)*
- [ ] **PROOF-03**: Validar leitura binária de `.lnk` em Node contra os 16 ms/atalho do COM (2395 ms para 149 atalhos, medido). *(W8)*
- [ ] **PROOF-04**: Fixar a regra de exclusão de desinstaladores do scan. O scan real trouxe `Uninstall DJI Assistant 2 → unins000.exe`. *(W7)*
- [ ] **PROOF-05**: Executar `npm ci && node --test` nesta máquina Windows e registrar se `test/auth.test.mjs:106` (`mode & 0o777 === 0o600`) passa. Converte U3 de suposição em fato. *(U3)*

### Adaptador de plataforma

- [ ] **PLAT-01**: Criar `platform/index.js` — fábrica explícita que resolve `{listInstalledApps, listAppProcesses, activateApp, openWebsite, iconService}` por SO. Hoje o único ponto sem injeção é o default de `iconHelper`, que ramifica em `darwin` sem branch `win32` (`apps.js:571`). *(W2)*
- [ ] **PLAT-02**: Descoberta de apps Windows — atalhos do Menu Iniciar, caminhos conhecidos, UWP, dedupe por target path, exclusão de desinstaladores, ordenação por nome, cache com invalidação.
- [ ] **PLAT-03**: Extração de ícone Windows a 256×256 com cache em disco, assíncrona e cancelável. A assincronia é **obrigatória**: 122 apps × 43,2 ms ≈ 5,3 s.
- [ ] **PLAT-04**: Rasterizar o monograma de fallback em JS puro. Hoje `monogramPng` chama `sips` (`apps.js:549`), binário exclusivo do macOS — no Windows a cadeia inteira falha em silêncio e o app fica **sem ícone nenhum**. *(W1)*
- [ ] **PLAT-05**: Listagem de processos e ativação de janela no Windows, com o fallback do PRD §15 (abrir nova instância quando `SetForegroundWindow` é restrito).
- [ ] **PLAT-06**: Erros tipados para falha de ação. Hoje `fail()` (`server.js:133-137`) colapsa tudo em `{ok:false,error:"erro interno"}`, violando PRD §8.3 **inclusive no macOS**. *(W3)*
- [ ] **PLAT-07**: Equivalente Windows de `readMacIconAppearance` (`apps.js:281`) lendo `HKCU\...\Personalize\AppsUseLightTheme`. Não existe task para isso no plano herdado. *(W12)*
- [ ] **PLAT-08**: Nenhuma rota HTTP nem mensagem WebSocket muda. O port é troca de provider, não de protocolo.

### Shell Electron

- [ ] **SHELL-01**: Processo principal com single instance, janela principal e ciclo de vida do servidor via `utilityProcess.fork`.
- [ ] **SHELL-02**: Supervisão do servidor — encerramento limpo, porta ocupada (`server.js:1034-1058` já entrega o tratamento), log de erro, eventos de saúde para a UI.
- [ ] **SHELL-03**: Adoção de servidor existente por comparação **semântica** de versão. Não portar o bug do `ServerManager.swift:255-280`, que exige igualdade exata de string e trata patch drift como conflito. *(W15)*
- [ ] **SHELL-04**: Bandeja do sistema com abrir, status e sair.
- [ ] **SHELL-05**: Inicialização com o Windows explícita e reversível, desligada por padrão.
- [ ] **SHELL-06**: Endurecimento como critério de aceite, com teste — `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, preload mínimo via `contextBridge`, CSP estrita, `webSecurity` on. *(W22)*
- [ ] **SHELL-07**: Corrigir o overload de `opts.root` entre raiz estática e `pinRoot`. Se o shell passar `opts.root` apontando para o diretório servido, `GET /.j5-pin` entrega o PIN sem auth. *(W13)*

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

### Design system

- [ ] **DES-01**: Declarar os tokens extraídos da pesquisa (50 tokens com proveniência `path:linha`) como fonte única.
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

### Testes e CI

- [ ] **TEST-01**: Extrair os invariantes do PRD §7 numa fixture compartilhada consumida pelos testes Mac, PWA e Windows. Hoje Mac e PWA codificam os mesmos invariantes em dois dialetos de regex independentes; uma terceira cópia à mão é exatamente o drift que o §7 existe para prevenir. *(W18)*
- [ ] **TEST-02**: Cobertura net-new da tela Conectar. Metade dos bullets do PRD §7 não tem teste de UI em plataforma nenhuma — copiar/abrir URL, contagem de dispositivos, regeneração de PIN. *(W19)*
- [ ] **TEST-03**: CI passa a rodar em `push`/`pull_request`. Hoje ambos os workflows são `workflow_dispatch` only — **não rodam em nenhum commit**. *(Q1)*
- [ ] **TEST-04**: Adicionar `npx playwright install` antes do `npm test` no CI. Desde Playwright 1.38 o pacote não baixa binários no `npm ci`, e os 10 `chromium.launch()` de `ui.test.mjs` falhariam num runner limpo. *(Q2)*
- [ ] **TEST-05**: Ligar os 4 testes JUnit do Android a automação. Hoje não rodam em lugar nenhum. *(Q23)*

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

- **WIRE-01**: Rename das strings de wire (`dokke:discover`, prefixo de resposta, corpo de `/health`), com janela de dual-accept. Travado pelo APK já distribuído, que casa por regex ancorada de match total. *(R1, D1)*
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
| PROOF-01 | Fase 0 | Pendente |
| PROOF-02 | Fase 0 | Pendente |
| PROOF-03 | Fase 0 | Pendente |
| PROOF-04 | Fase 0 | Pendente |
| PROOF-05 | Fase 0 | Pendente |
| PLAT-01 | Fase 2 | Pendente |
| PLAT-02 | Fase 3 | Pendente |
| PLAT-03 | Fase 3 | Pendente |
| PLAT-04 | Fase 3 | Pendente |
| PLAT-05 | Fase 3 | Pendente |
| PLAT-06 | Fase 2 | Pendente |
| PLAT-07 | Fase 3 | Pendente |
| PLAT-08 | Fase 2 | Pendente |
| SHELL-01 | Fase 5 | Pendente |
| SHELL-02 | Fase 5 | Pendente |
| SHELL-03 | Fase 5 | Pendente |
| SHELL-04 | Fase 5 | Pendente |
| SHELL-05 | Fase 5 | Pendente |
| SHELL-06 | Fase 5 | Pendente |
| SHELL-07 | Fase 5 | Pendente |
| UI-01 | Fase 7 | Pendente |
| UI-02 | Fase 8 | Pendente |
| UI-03 | Fase 8 | Pendente |
| UI-04 | Fase 8 | Pendente |
| UI-05 | Fase 8 | Pendente |
| UI-06 | Fase 9 | Pendente |
| UI-07 | Fase 7 | Pendente |
| UI-08 | Fase 7 | Pendente |
| UI-09 | Fase 9 | Pendente |
| UI-10 | Fase 9 | Pendente |
| UI-11 | Fase 7 | Pendente |
| DES-01 | Fase 6 | Pendente |
| DES-02 | Fase 6 | Pendente |
| DES-03 | Fase 6 | Pendente |
| DES-04 | Fase 6 | Pendente |
| DES-05 | Fase 6 | Pendente |
| DES-06 | Fase 6 | Pendente |
| PKG-01 | Fase 10 | Pendente |
| PKG-02 | Fase 10 | Pendente |
| PKG-03 | Fase 4 | Pendente |
| PKG-04 | Fase 10 | Pendente |
| PKG-05 | Fase 10 | Pendente |
| PKG-06 | Fase 10 | Pendente |
| BRAND-01 | Fase 1 | Pendente |
| BRAND-02 | Fase 4 | Pendente |
| BRAND-03 | Fase 1 | Pendente |
| BRAND-04 | Fase 1 | Pendente |
| BRAND-05 | Fase 1 | Pendente |
| BRAND-06 | Fase 12 | Pendente |
| BRAND-07 | Fase 12 | Pendente |
| BRAND-08 | Fase 11 | Pendente |
| BRAND-09 | Fase 11 | Pendente |
| BRAND-10 | Fase 12 | Pendente |
| BRAND-11 | Fase 1 | Pendente |
| TEST-01 | Fase 6 | Pendente |
| TEST-02 | Fase 9 | Pendente |
| TEST-03 | Fase 13 | Pendente |
| TEST-04 | Fase 13 | Pendente |
| TEST-05 | Fase 13 | Pendente |
| FIX-01 | Fase 4 | Pendente |
| FIX-02 | Fase 4 | Pendente |
| FIX-03 | Fase 4 | Pendente |
| FIX-04 | Fase 11 | Pendente |
| FIX-05 | Fase 11 | Pendente |
| FIX-06 | Fase 11 | Pendente |
| FIX-07 | Fase 11 | Pendente |
| FIX-08 | Fase 6 | Pendente |

**Cobertura: 67 / 67 requisitos v1 mapeados.** Nenhum órfão, nenhum requisito em duas fases.
Distribuição por fase: 0→5, 1→5, 2→3, 3→5, 4→5, 5→7, 6→8, 7→4, 8→4, 9→4, 10→5, 11→6, 12→3, 13→3.

Os itens de §v2 (WIRE-01, PWA-01, SEC-01..04, MAC-01/02, PERF-01, LAND-01) **não** aparecem nesta
tabela: estão fora do v1 por decisão registrada e não têm fase atribuída.

