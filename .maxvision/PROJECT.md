# DeckTech

## What This Is

DeckTech é um gerenciador de dock cross-platform: um host roda no computador, descobre os
aplicativos instalados, e entrega um dock personalizado para celulares, tablets e navegadores
na mesma rede via WebSocket. É um fork otimizado do [Dokke](https://github.com/felipenalves/Dokke)
(MIT, Felipe Alves) que estende o produto para **Windows como host de primeira classe** — a
lacuna que o upstream especificou mas nunca implementou.

Para quem: pessoas que querem acionar seus apps mais usados a partir de outro dispositivo, sem
procurar janelas no computador. DeckTech remove a exigência de ter um Mac.

## Core Value

Um usuário Windows instala o DeckTech, abre o host, conecta o celular pelo PIN e aciona um app
Windows pelo dock — tudo na primeira sessão, sem instalar Node.js nem configurar serviço manual.

## Requirements

### Validated

<!-- Herdado do Dokke v0.2.8 — código existente, testado, em produção upstream. -->

- ✓ **CORE-01**: Servidor Node local serve dock e API HTTP — existente (`server.js`, 44KB)
- ✓ **CORE-02**: Sincronização de estado em tempo real via WebSocket — existente (`ws`, `obs-ws.js`)
- ✓ **CORE-03**: Autenticação por PIN com persistência entre reinstalações — existente (`auth.js`)
- ✓ **CORE-04**: Inventário de apps instalados com ícones — existente (`apps.js`, 26KB, macOS)
- ✓ **CORE-05**: Configuração persistente do dock — existente (`config.js`)
- ✓ **PWA-01**: Cliente PWA instalável com service worker offline — existente (`public/`)
- ✓ **MAC-01**: App host macOS nativo SwiftUI — existente (`mac/Sources/`, 10 arquivos)
- ✓ **AND-01**: Companion Android WebView com discovery LAN — existente (`android/`)
- ✓ **I18N-01**: Português e inglês com detecção automática — existente (PR #23)
- ✓ **SITE-01**: Landing page Vite — existente (`docs/`, deploy dokke.vercel.app)
- ✓ **TEST-01**: Suíte de 36 arquivos `node --test` + Playwright — existente (`test/`)

### Active

<!-- Escopo DeckTech v1: paridade total + host Windows. -->

- [ ] Host Windows instalável com paridade estrutural ao app macOS
- [ ] Adaptador de plataforma Windows: inventário, ícones, processos, foco de janela
- [ ] Shell desktop Windows com runtime embutido (zero dependência para o usuário)
- [ ] Bandeja do sistema e inicialização com o Windows, explícita e reversível
- [ ] Instalador x64 com desinstalador e dados fora da pasta de instalação
- [ ] Rebrand completo Dokke → DeckTech (identidade, ícones, domínios, strings)
- [ ] Otimização do monolito `public/index.html` (126KB em arquivo único)
- [ ] Refino de design na linha iOS/macOS moderna: glass, profundidade, fluidez
- [ ] Validação visual real em dispositivo físico (Galaxy S10e) e iPhone via PWA
- [ ] Paridade mantida em macOS e Android após o rebrand

### Out of Scope

<!-- Herdado do PRD Windows do upstream (§4) salvo onde indicado. -->

- Conta, login ou sincronização em nuvem — DeckTech é local-first por princípio
- Acesso remoto pela internet — LAN apenas; o usuário já tem Tailscale se quiser remoto
- Windows como companion — Windows é host; companion é celular/tablet/browser
- Sincronização entre múltiplos hosts — um host por rede no v1
- Microsoft Store como canal obrigatório — instalador direto
- Redesign da interface — DeckTech refina a linguagem existente, não a substitui
- Reescrever o companion Android/iPhone — o WebView e a PWA permanecem

## Context

**Origem.** Dokke v0.2.8 (MIT, 36 stars, 89 commits). Stack deliberadamente enxuta: Node ≥20,
dependência de produção única (`ws`), `node --test`, Playwright, zero framework frontend. O
autor escreveu dois documentos decisivos em 2026-08-18 que o DeckTech herda:

- `docs/plans/2026-08-18-dokke-windows-host-prd.md` — PRD aprovado, 14.5KB, com **contrato
  visual enumerado no §7** que serve como rubrica objetiva de revisão.
- `docs/plans/2026-08-18-dokke-windows-host-implementation-plan.md` — plano TDD de 7 tasks,
  stack Electron.

**Nunca implementado.** Validado por quatro fontes independentes: as 4 branches do upstream
(`main`, `develop`, `feature/issue-19-i18n`, `fix/release-v0.2.8`) não incluem trabalho de
Windows; nenhuma das 20 PRs trata do host Windows; o tree de `main` não tem `platform/` nem
`windows/`, só os dois `.md` de planejamento; a release v0.2.8 (2026-08-29) não tem artefato
Windows.

**Superfícies do código herdado.**

| Superfície | Arquivos | Peso |
|---|---|---|
| Core Node | `server.js`, `apps.js`, `auth.js`, `config.js`, `actions.js`, `obs.js`, `obs-ws.js` | ~90KB |
| PWA cliente | `public/index.html` (126KB monolito), `sw.js`, `manifest.webmanifest` | ~130KB |
| macOS SwiftUI | `mac/Sources/` — `ContentView`, `DockStore`, `DockIcon`, `ServerManager`, `LanguageStore`, `AppPickerSheet`, `DockGridView`, `DokkeUpdateManager` | ~150KB |
| Android | `MainActivity.kt` (28KB), `DokkeDiscovery`, `ServerUrl`, `DokkeConnectionStore`, `AndroidLanguage` | ~40KB |
| Landing | `docs/src/main.js`, `docs/src/style.css`, Vite | ~50KB |
| Testes | 36 arquivos `.test.mjs` (`ui.test.mjs` sozinho tem 46KB) | ~250KB |

**Ambiente de validação disponível.** Não é simulação — hardware real na mesma LAN:

- PC host: `maxvisionfpv`, Windows 11 Pro 22631, Tailscale 100.97.34.106
- Galaxy S10e `SM-G970F`, Android 12 (SDK 31), adb wireless `100.125.203.58:36403`, LAN
  direta `192.168.15.22`, ping 4ms — validação por `argent` (screenshot, describe, tap real)
- iPhone 13 Pro Max, Tailscale 100.80.167.96 — validação da PWA em iOS
- PC e celular na mesma LAN `192.168.15.0/24`, então o discovery do Dokke funciona de verdade

**Linguagem de design.** O Dokke segue a linha visual do iOS/macOS moderno — efeitos de vidro,
profundidade por camadas, interface fluida. O DeckTech mantém essa linha e a aprofunda; não
inventa uma identidade visual nova.

## Constraints

- **Licença**: MIT do upstream — `LICENSE` e o copyright de Felipe Alves permanecem no fork,
  com atribuição no README. Não é opcional; é condição da MIT.
- **Paridade visual**: PRD §7 é contrato, não sugestão — mesma estrutura, hierarquia, densidade,
  navegação e estados do app macOS. Diferenças permitidas apenas em bandeja, atalhos, firewall,
  caminhos e ícones do sistema.
- **Tech stack**: dependência de produção única (`ws`) é uma decisão de projeto do upstream.
  Toda dependência nova precisa justificar seu peso.
- **Zero dependência para o usuário**: Node embutido no instalador. O usuário não instala runtime.
- **Compatibilidade**: Node ≥20. macOS e Android não podem regredir com a entrada do Windows.
- **Validação**: macOS não compila nesta máquina (Windows 11). Android exige Gradle + SDK.
  Toda afirmação de "funciona" precisa de execução real ou é declarada como não validada.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork com histórico do upstream preservado (89 commits) | Atribuição MIT forte e rastreabilidade de origem; `git remote upstream` permite acompanhar correções | ✓ Bom |
| Repositório público `produtoramaxvision/DeckTech` | Decisão do usuário; consistente com origem MIT | ✓ Bom |
| Branch de trabalho `homolog`, default `main` | Regra do CLAUDE.md do usuário; `main` mantém comparabilidade com upstream | ✓ Bom |
| Escopo v1 = paridade total (Node + PWA + macOS + Android + landing + Windows) | Decisão do usuário; hardware de validação real disponível para Android e iOS | — Pendente |
| Stack do host Windows a decidir por pesquisa (Electron vs Tauri) | PRD do upstream diz Electron; Tauri reduz instalador de ~150MB para ~10MB. Decisão precisa de evidência, não de preferência | — Pendente |
| Loop de revisão sem teto fixo, com critério de convergência | Decisão do usuário: concluir só quando o revisor aprovar. Escalação quando uma rodada não produz delta mensurável, para não repetir rodada idêntica | — Pendente |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/maxvision-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/maxvision-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-17 after initialization*
