# Project State

## Project Reference

See: .maxvision/PROJECT.md (updated 2026-09-17)

**Core value:** Um usuário Windows instala o DeckTech, abre o host, conecta o celular pelo PIN e
aciona um app Windows pelo dock — tudo na primeira sessão, sem instalar Node.js.
**Current focus:** Phase 0 — Prova técnica Windows

## Current Position

Phase: 0 of 13 (Prova técnica Windows)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-09-17 — ROADMAP.md criado; 67/67 requisitos v1 mapeados em 14 fases (0-13)

Progress: [░░░░░░░░░░] 0%

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
