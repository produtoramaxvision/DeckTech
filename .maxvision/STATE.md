# Project State

## Project Reference

See: .maxvision/PROJECT.md (updated 2026-09-17)

**Core value:** Um usuário Windows instala o DeckTech, abre o host, conecta o celular pelo PIN e
aciona um app Windows pelo dock — tudo na primeira sessão, sem instalar Node.js.
**Current focus:** Phase 2 — Contrato de plataforma (Phase 0 COMPLETA)

## Current Position

Phase: 0 of 13 — **COMPLETA** em 2026-09-18
Plan: 7/7 lanes fechadas (PROOF-01..08; PROOF-05 executado, nao implementado)
Status: Fase 0 fechada; proxima onda = Phase 2 + Phase 6 em paralelo
Last activity: 2026-09-18 — PROOF-08 tee blocker fechado; suite 389 tests / 374 pass / 0 fail / 15 skipped / exit 0

Progress: [█░░░░░░░░░] 8/79 requisitos (10%)

### Fase 0 — resultado

| Lane | Rodadas | Fecho |
|---|---|---|
| PROOF-01 | 9 | APROVADO. ADR-0001: ponte de icone = **N-API addon**, koffi como fallback, pool PowerShell rejeitado |
| PROOF-02 | 3 | APROVADO. ADR-0002: enumeracao UWP via `shell:AppsFolder`, 3/3 apps-prova detectados, locale pt-BR tratado |
| PROOF-03 | 10 (exhausted) + sweep M4 | ADR-0003: parser binario `.lnk` **8,8x-16,4x** mais rapido que COM, zero divergencia em 182 atalhos |
| PROOF-04 | 8 + sweep M3 | ADR PROOF-04: regra de exclusao de desinstaladores, com mutation harness (17 killed / 1 survivor) |
| PROOF-06 | 1 + sweep M1/M2 | `ds-store` -> `optionalDependencies`; `npm ci` volta a funcionar no Windows; guarda de regressao em `test/package-dmg.test.mjs:226` |
| PROOF-07 | 2 | Testes macOS-only gateados; 15 skips com motivo impresso |
| PROOF-08 | 10 (exhausted) + sweep tee | ADR-0004: **`utilityProcess.fork`** decidido. D15 resolvido |

Custo: 86 + 10 + 4 = 100 agentes, ~19,6 M tokens de subagente, 0 erro.

Achado extra fora do escopo da fase: 2 testes de `test/ui.test.mjs` que **nunca passaram em lugar
nenhum** (arquivo inalterado desde o fork, CI upstream e `workflow_dispatch`-only sem Playwright).
Causa: o dock so preenche um tile quando a peca resolve contra `/api/apps/installed`, que no
Windows ainda devolve o fallback macOS. Corrigidos injetando `appTools` pelo seam `server.js:295`
e removendo `waitUntil: "networkidle"`, que a doc oficial do Playwright marca DISCOURAGED.

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

- **D1** — strings de wire congeladas como `Dokke` no v1. WIRE-01 **não está no roadmap**; o APK
  distribuído casa `/health` por regex ancorada (`DokkeDiscovery.kt:12`).
- **Stack = Electron**, confiança alta. Não reabrir salvo orçamento explícito de footprint.
- **D10** — mecanismo de ícone 256px decidido na Fase 0 **por medição**, não por preferência.
- **D3/D8** — `%LOCALAPPDATA%` nunca Roaming; desinstalador preserva dados com checkbox opt-in.
- **D11/D13** — tema claro completo e estado vazio de verdade: DeckTech diverge do Mac de
  propósito nesses dois pontos.
- **Ordem travada** — BRAND-01 é o plano `01-01` da Fase 1 e precede todo o resto do rebrand.

### Pending Todos

Nenhum.

### Blockers/Concerns

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

Last session: 2026-09-17
Stopped at: ROADMAP.md e STATE.md escritos; traceability de REQUIREMENTS.md preenchida com 67 linhas
Resume file: None
Next action: `/maxvision:plan-phase 0`
