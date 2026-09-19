# Project State

## Project Reference

See: .maxvision/PROJECT.md (updated 2026-09-17)

**Core value:** Um usuário Windows instala o DeckTech, abre o host, conecta o celular pelo PIN e
aciona um app Windows pelo dock — tudo na primeira sessão, sem instalar Node.js.
**Current focus:** Fase 4 — Dados do usuario no Windows (Fases 0,1,2,3,6 COMPLETAS)

## Current Position

Phase: 5 de 14 fechadas (0, 1, 2, 3, 6) — Fase 4 desbloqueada pela Fase 1
Plan: marco de integracao fechado — o servidor DeckTech enumera apps Windows reais
Status: `homolog` = `d341fdb`, empurrado, suite verde
Last activity: 2026-09-18 — handshake READY do theme watcher; suite 651 tests / 636 pass / 0 fail / 15 skipped

Progress: [####______] 34/80 requisitos (43%)

### Fases fechadas

| Fase | Requisitos | Fecho |
|---|---|---|
| 0 Prova tecnica | 8 | ADR-0001 (N-API addon), ADR-0002 (`shell:AppsFolder`), ADR-0003 (parser binario `.lnk`), ADR-0004 (`utilityProcess.fork`). 100 agentes, ~19,6 M tokens |
| 1 Identidade + wire | 7 | `decktech:discover` com `dokke:discover` legado ate 2027-03-18; `/health` sem header continua byte-a-byte Dokke (`DokkeDiscovery.kt:12` casa) |
| 2 Contrato de plataforma | 4 | `createPlatform(platformName, deps)` em `platform/index.js:144`; erros tipados |
| 3 Provedores Windows | 7 | `platform/windows/{apps,icon,actions,theme}.js` + addon N-API |
| 6 Tokens + fixture | 8 | Fonte unica de cor/raio/motion; fixture dos invariantes do PRD §7 |

### Marco de integracao (2026-09-18)

Os quatro fios que ligavam a fabrica de plataforma ao servidor estavam **abertos** — a Fase 3
construiu os provedores, a Fase 2 construiu a fabrica, e `grep createPlatform server.js` devolvia
zero. O servidor subia com o fallback macOS e listava **1 app ("Finder")** nesta maquina Windows.
Quatro fases de review nao pegaram: cada teste exercitava sua propria peca isolada, e o criterio
PLAT-02 era satisfeito por injecao, nunca pelo caminho default.

Fios fechados em `6800857` + `4028448`:

```
server.js:423       platform = defaultPlatform()
server.js:424-425   appTools e actions derivados dele
server.js:427       iconService derivado dele
server.js:1211,1216 o mesmo buraco no feed de status WebSocket
platform/index.js:132 + server.js:1312   dispose do theme watcher (vazamento)
```

Medido com o servidor de pe, caminho default, sem injecao:

```
apps            : 152   em 1456ms   (criterio da Fase 3: >=122)
UWP             : 18     (ex.: "Backup do Windows")
"Finder"        : 0
unins*.exe      : 0
path com espaco : 71
```

Guarda: `test/plat-01-server-wiring.test.mjs`. Revertendo com
`git checkout 24310f1 -- server.js platform/index.js` o teste falha com o defeito literal
(`actual: [ { name: 'Finder', path: '/System/Library/CoreServices/Finder.app' } ]`).

**Licao incorporada ao contrato de review:** nenhuma fase fecha sem alguem SUBIR o servidor pelo
caminho default e olhar o numero. Criterio satisfeito por injecao nao e criterio satisfeito.

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisões completas em PROJECT.md (Key Decisions) e REQUIREMENTS.md (D1-D14). Afetando o trabalho
corrente:

- **D1 REVISADO POR D19** — o wire NAO ficou congelado. WIRE-01 entrou na Fase 1 e fechou:
  `decktech:discover` e o magic novo, `dokke:discover` continua aceito ate 2027-03-18, e
  `/health` SEM o header `x-decktech` responde `service: "Dokke"` byte-a-byte — verificado ao vivo
  contra a regex ancorada de `DokkeDiscovery.kt:12`, que casa o corpo sem header e rejeita o
  DeckTech. O APK ja instalado no S10e segue funcionando sem update.
- **Stack = Electron**, confiança alta. Não reabrir salvo orçamento explícito de footprint.
- **D10** — mecanismo de ícone 256px decidido na Fase 0 **por medição**, não por preferência.
- **D3/D8** — `%LOCALAPPDATA%` nunca Roaming; desinstalador preserva dados com checkbox opt-in.
- **D11/D13** — tema claro completo e estado vazio de verdade: DeckTech diverge do Mac de
  propósito nesses dois pontos.
- **Ordem travada** — BRAND-01 é o plano `01-01` da Fase 1 e precede todo o resto do rebrand.

### Pending Todos

Nenhum.

### Blockers/Concerns

- **[Fase 3 REABERTA — PLAT-05] Ativar um app ja aberto NAO traz a janela pra frente neste
  Windows.** Achado no primeiro teste ponta-a-ponta real (2026-09-18): o S10e pareou por PIN,
  achou o host pela LAN e mandou o toque; o servidor respondeu
  `FOCUS_RESTRICTED: focus restricted for "Firefox", opened new instance` e o foreground nao
  mudou. Nao e ruido: `focusWindowByPid` devolveu `hadProcess: true, hadWindow: true,
  setForegroundReturn: false, becameForeground: false` com handle valido, e
  `ForegroundLockTimeout` ja esta em `0`. Numa bateria fria de 6 tentativas, 0 de 5 ativacoes
  reais funcionaram (a 6a "passou" so porque o alvo ja era o foreground).

  O efeito pro usuario e pior que "nao focou": o fallback do PRD §15 abre uma instancia nova.
  (Escrevi antes que isso acumulou 15 `firefox.exe` -- ERRADO, e a contagem desmente: 1 processo
  principal + 14 de conteudo, que e o normal do Firefox. Nao ha medida do antes, entao nao ha
  claim sobre acumulo. O defeito nao precisa dele.)

  **NAO validado:** qual alternativa corrige. Medi `SwitchToThisWindow`, o truque do ALT e
  `AttachThreadInput` em tres harnesses e os resultados se contradizem (o mesmo `plain` deu 0/5
  num, 4/6 noutro). A variavel que domina e quem detem direito de foreground no momento, e meus
  harnesses a alteram ao tentar medi-la. Precisa de investigacao propria, com um harness que
  nao toque no foreground pra observa-lo. Nao aplicar `AttachThreadInput` sem essa prova: o
  comentario de `platform/windows/actions.js:20-37` rejeitou o bypass DE PROPOSITO, e reverter
  uma decisao documentada exige evidencia, nao preferencia.


- **[SEM DONO] Uma falha de suíte observada e NÃO identificada.** Em 2026-09-19, numa execução
  concorrente com a lane p14, `node --test` reportou `pass 643 / fail 1`. Eu não capturei a saída
  daquela execução, então **não sei qual teste foi**. Quatro execuções desde então deram
  `644 / 0`, incluindo uma deliberadamente sob a mesma carga da lane. Registrado aqui em vez de
  descartado: não posso afirmar que está corrigido nem que era ruído. Se reaparecer, capturar a
  saída inteira em arquivo ANTES de qualquer outra coisa. Classe provável: mesma família do
  PLAT-07 (`windows-theme-appearance`), que era sensível a carga até o handshake `READY` de
  `d341fdb` — mas isso é hipótese, não medição.

- **[Fase 15] Escala tipográfica do cliente PWA abaixo do mínimo legível.** Cinco regras de
  `public/index.html` usam `font-size: 11px` — `.robscard .os:537`, `.sheet .srow .pin:659`,
  `.up-banner .up-download:739`, `:773` e `.login-card .lfoot:793`. Todas herdadas do Dokke,
  nenhuma introduzida aqui. O limiar de legibilidade é 14px pra corpo de texto. Não corrigido
  agora de propósito: trocar a escala tipográfica do cliente inteiro é mudança de design system,
  precisa sair dos tokens da Fase 6 (`design/tokens.mjs`) em vez de seis números soltos, e é a
  Fase 15 que é dona do visual do cliente. Mesma família do achado aberto da Onda 1 sobre o `h2`
  da galeria em 13px sem tokens de escala. *(sinalizado pelo hook impeccable, 2026-09-19)*

- **[SEM FASE] Strings `Dokke` de runtime sem dono.** `server.js:1349` imprime
  `Dokke ouvindo em http://127.0.0.1:3000` no boot de um produto chamado DeckTech. Conferido:
  BRAND-01 cobre so as 4 superficies de auto-update, BRAND-03/04/05/11/12 cobrem hashes de icone,
  testes, imports de `auth.js`, atribuicao e o check de versao -- nenhum cobre texto de log. Nao e
  falha da Fase 1, e requisito que nunca foi escrito. `server.js:519` e `:962` continuam `Dokke`
  DE PROPOSITO (dual-accept do WIRE-01, nao mexer). `server.js:1163-1164` e da Fase 4 (BRAND-02).

- **[Fase 11] APK DeckTech não pode atualizar o APK Dokke in-place.** Verificado:
  `applicationId = "com.dokke.app"` (`android/app/build.gradle:35`) e a guarda
  `if (archive.packageName != packageName) return false` (`MainActivity.kt:486`). Mudar o
  `applicationId` faz o APK novo ser rejeitado como update e instalado lado a lado.
  `signaturesMatch` agrava — o fork não tem o keystore `DOKKE_RELEASE_*` do upstream. Precisa de
  decisão de produto e nota de release.
- **[Fase 11] Não validável nesta máquina.** `mac/Sources/` não compila em Windows 11;
  `android/` exige Gradle + SDK ausentes. O S10e conectado valida o APK já instalado, não um
  build novo.
- **[Fase 6] DES-06 não tem entregável de valor.** Amostrar `.quaternary`/`.accentColor` exige
  render macOS e só existe o render escuro (`ContentView.swift:51`). Entregável = registro
  documentado de não-amostragem. **Não inventar hex.**
- **[Fase 10] PKG-05 depende de certificado** OV/EV ou Azure Trusted Signing que pode não
  existir. Entregável sem certificado = pipeline documentado + artefato marcado como não
  assinado.
- **[Fases 3 ∥ 4] Colisão real em `server.js`** bloco `startServer` (`:928-958`): a Fase 3 injeta
  providers, a Fase 4 muda a resolução de diretório de dados. Ordenar os planos que tocam o
  bootstrap.
- **[Fases 8 ∥ 9] Colisão real** no CSS e no módulo de estado do renderer Electron. Dividir por
  arquivo de componente desde o primeiro plano.
- **[Fase 13] TEST-05 não validável aqui** — o step de Gradle só se prova em runner com SDK.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Wire | WIRE-01 — rename das strings de wire | v2 (D1) | 2026-09-17 |
| PWA | PWA-01 — decomposição do monolito de 129 KB | v2 (D14) | 2026-09-17 |
| Security | SEC-01..04 — HTTPS, rate limit global, sessão, `trustLoopback` | v2 | 2026-09-17 |
| macOS | MAC-01/02 — autenticidade do self-update, `install-update.sh` | v2 | 2026-09-17 |
| Perf | PERF-01 — `DockHoverCoordinator`, `ServerManager`, `watchScale()` | v2 | 2026-09-17 |
| Landing | LAND-01 — SEO e meta social | v2 | 2026-09-17 |

## Session Continuity

Last session: 2026-09-18
Stopped at: marco de integracao fechado e empurrado (`d341fdb`); worktree `decktech-f1` desfeito e
branch `f1-identity` apagada (mergeada em `24310f1`)
Resume file: None
Next action: teste ponta-a-ponta no S10e (`100.125.203.58:36403`, LAN `192.168.15.0/24`), depois
`/maxvision:plan-phase 4`
