# PWA-CLIENT — Surface Analysis

Scope: `public/index.html` (3113 lines, 129 KB, single file: markup + CSS + JS), `public/sw.js`,
`public/manifest.webmanifest`, `public/version.json`. All line numbers below are from these files
as read on 2026-09-17. `version.json` is **not** read by this surface — see §7.

## 0. What this surface actually is (read before using it as a Windows reference)

This file is the **companion client** (phone/tablet/browser), not the Mac host UI. It renders:
a PIN login wall, an Apps screen (launchpad grid), a Recents screen ("apps abertos" horizontal
deck), an OBS Commander drawer, and toasts/modals/update-banner chrome.

It does **not** contain any of the following, which PRD §7 requires from the **Windows desktop
host**: a sidebar with "Apps"/"Conectar", a "Conectar" screen (PIN generation, QR code, URL,
device count, PIN regeneration), an app picker with search and "Adicionado"/"Adicionar" affordances,
or an explicit reorder mode. Confirmed by exhaustive read of the file — there is no markup, no
function, and no route call for any of these (`grep` for "Conectar", "QR", "picker", "reorder" all
return nothing in this file). **The Windows host's "Apps"+"Conectar" desktop UI cannot be adapted
from this file — it has to be built from the Mac SwiftUI app as the visual source of truth.** This
surface only tells you what the companion (phone-parity) piece must keep working.

---

## 1. File organization — real section boundaries

The file is one `<html>` document: a `<head>` with a single `<style>` block, then a `<body>` with a
handful of top-level containers and one classic (non-module) `<script>` IIFE. There are no
`<!-- -->` section-divider comments; boundaries below are inferred from `<style>`/`<script>`
open/close tags and from contiguous comment blocks the author left inside the JS (e.g. `// ----------
login wall`).

| Range | Content |
|---|---|
| 1–18 | `<head>`: meta, manifest link, icon links (light/dark), Google Fonts preconnect + stylesheet |
| 19–747 | `<style>` — the entire CSS design system (see §2) |
| 748–812 | `<body>` markup: `.bg`, `main > .screens > #screenApps/#screenRecents`, `.vdots`, `.toast`, login scrim, `.scrim/.sheet` modal host, `.up-banner`, `.drawer` (OBS) |
| 813–3111 | `<script>` — one `(() => { "use strict"; ... })()` IIFE, ~2300 lines |
| 3111–3113 | SW registration + `</body></html>` |

Inside the script IIFE, by function groups (line numbers are the first line of each group):

| Lines | Section |
|---|---|
| 817–827 | Capability probe — fires `fetch("/api/probe?...")` once with `CSS.supports` flags and orientation info (telemetry-ish device fingerprint, fire-and-forget) |
| 831–947 | i18n: `I18N` dict (`pt-BR`, `en`), `t()`, `renderLanguage()` |
| 949–971 | Palette/monogram helpers: `appGrad`, `mono`, `giconEl` (fallback icon generation) |
| 973–981 | `toast()` |
| 983–1069 | Login wall: viewport/keyboard handling, `showLogin/hideLogin`, `doLogin()` → `POST /api/auth` |
| 1071–1113 | Orientation detection, pinned-limits state, i18n error-code mapping |
| 1115–1138 | `req()`/`post()` — fetch wrapper with `AbortController` timeout, 401→`showLogin()` |
| 1140–1153 | `state` object (single shared mutable store, see §1.1) |
| 1155–1260 | Input primitives: `bindTap`, `preventTouchFocusScroll`, `bindHold` (long-press), `makeBtn` (a11y button wiring) |
| 1262–1360 | Server actions: `activateApp`, `activatePiece`, `pinApp`, `unpinApp`, `unpinPiece`, modal open/close |
| 1362–1444 | Confirm-remove sheet (`favLong`) and long-press router (`tileLong`) |
| 1446–1786 | **Launchpad (Apps screen) rendering** — icon loading/caching, `buildTile`, `renderLaunchpad`, dots, `layoutDockScale` (landscape GPU-scale), orientation/icon-rotation helpers |
| 1801–1972 | **Recents screen + horizontal deck** — `deckQueue`, `makeDeckCard`, `renderDeck`, `bindDeckGestures`, `renderRecents` |
| 1974–2035 | Pin sheet (add/remove favorites list — the closest thing to an "app picker", but it is a bottom sheet, not PRD's dedicated picker screen) |
| 2037–2153 | OBS Commander panel (`renderObs`, `confirmStopAll`, `doObs`) |
| 2175–2186 | `maybeReloadForUi` — forced `location.reload()` when server pushes a new UI version over WS/poll |
| 2188–2338 | Polling engine: wake lock, adaptive backoff `loadHealth`/`loadApps`, `applyAppsPayload` (single source-of-truth merge for pieces/pinned/running) |
| 2340–2378 | **WebSocket client** (`connectStatusWs`, `scheduleWsReconnect`) |
| 2380–2439 | `loadApps` HTTP fallback, `updateStatuses`, `loadInstalled` |
| 2441–2473 | Drawer open/close, `renderVDots`/`syncVDots`, `goScreen` |
| 2475–3004 | **Vertical screen-transition gesture engine** (Apps ↔ Recents swipe/wheel/vdots) — by far the largest single block, ~530 lines |
| 3016–3094 | Update-banner logic (`checkVersion`, `showUpBanner`, `cmpVer`) |
| 3097–3110 | `boot()`, initial `checkVersion()`/`loadHealth()`/`boot()` calls, SW registration |

### 1.1 Shared mutable state (why a naive split breaks)

Everything above closes over one `state` object (1141–1151: `online, screen, pieces, revision,
pinned, running, installed, maxPinned*, installedReady, obs, obsTimer`) plus ~15 loose module-level
`let`s that are written and read across sections that otherwise look independent:

- `suppressClickUntil` — written in `bindHold` (1230) and in the gesture engine's `endPointer`
  (2885, 2900); read in `bindTap` (1159). Couples the tap primitive to the swipe engine.
- `deckPid` — written in `bindDeckGestures` (1886) and in the vertical gesture engine
  (2843, 2862); read in `renderRecents` (1909) and `applyAppsPayload` (2280). Couples the deck's
  own pointer handling to the screen-swipe engine so a deck-drag doesn't get hijacked as a
  vertical swipe.
- `pages`, `pageGridScale`, `iconCache`, `iconInflight`, `statusWs`, `wsRetry`, `coolUntil`,
  `settling` — each read/written from 2–4 non-adjacent function groups.

This is the central fact any decomposition must respect (see §8).

---

## 2. CSS design system actually in use

### 2.1 Declared custom properties (`:root`, 20–34)

| Token | Value | Consumers found |
|---|---|---|
| `--ink` | `rgba(255,255,255,.94)` | `body` color (49) |
| `--ink-2` | `rgba(255,255,255,.62)` | secondary text (many: 396, 475, 488, 545, 561…) |
| `--ink-3` | `rgba(255,255,255,.5)` | tertiary/disabled text (468, 725) |
| `--accent` | `#0a84ff` | focus ring, links, `.astatus.on` (338), login input focus (736) |
| `--green` | `#30d158` | OBS "on" LED (539), toast/pulse |
| `--amber` | `#ffd60a` | OBS error LED (540), pinned-limit warning text |
| `--red` | `#ff453a` | danger buttons, record/stream "on" state |
| `--glass` | `rgba(255,255,255,.07)` | **declared, never consumed** — `.aglass` (254–256) hardcodes its own gradient instead |
| `--edge` | `rgba(255,255,255,.10)` | **declared, never consumed** — borders are hardcoded per-component (e.g. `rgba(240,135,55,.40)` at 255, `rgba(255,255,255,.12)` at 595) |
| `--dokke-safe-top/-bottom` | `env(safe-area-inset-*)` | used throughout for notch/home-indicator clearance |
| `--app-tile` | `min(40vmin, max(21vw,21vh), 180px)` | drives `--tile` (163), redefined per breakpoint (192, 510) |
| `--icon-turn` | `0deg` | set by `syncIconOrientation()` (1771) — dead rotation hook, always `0deg` |

**Only 7 of 13 declared tokens are actually consumed as design-system values.** `--glass`/`--edge`
should be treated as intended-but-abandoned tokens, not as "the glass system" — the real glass
look is hardcoded per-component gradient/border/shadow triads (below). Any refinement pass should
either wire them up or delete them; right now they're misleading documentation-by-code.

### 2.2 Color language (hardcoded, not tokenized)

Two families, used consistently but not centralized:
- **Orange/ember accent** (brand): `rgba(240,135,55,*)` borders, `rgba(210,95,30,*)` glow/shadow,
  used on `.aglass` (254–256), `.atile.empty .aglass` (217), `.confirm-sheet` (626–628, 634).
  This is the *background* gradient family too (69–71: `#e86f27` → `#b84c14` → `#241106` → `#080301`).
- **Blue accent** (interactive/system): `#0a84ff` / `rgba(10,132,255,*)` — login connect button
  (740–743), focus rings (736), OBS scene-active state (552–554).
- Status colors are Apple's system palette values inlined directly (`#ff453a` red, `#30d158`
  green, `#ffd60a` amber) — not derived from any token beyond the 3 `:root` vars above.

### 2.3 Glass / blur effects

Two distinct glass recipes, not one system:
1. **Tile glass** (`.aglass`, 251–263): gradient + border + box-shadow only, **no `backdrop-filter`**
   — this is a fake-glass look (gradient + inset highlight + outer glow), cheap on mobile GPUs.
2. **Real backdrop blur**, used only for full-screen overlays: `.confirm-scrim`
   (`blur(18px) saturate(130%)`, 589), `.confirm-sheet` (`blur(24px) saturate(145%)`, 629),
   `.login-scrim` (`blur(20px) saturate(150%)`, 700), `.up-banner` (`blur(18px) saturate(150%)`,
   668). Each duplicates the `blur(Npx) saturate(M%)` pair with its own N/M rather than sharing a
   token — 4 near-identical declarations, values 18–24px / 130–150%.

### 2.4 Shadows

No shadow tokens; each component declares its own stack, e.g.:
- Tile: `inset 0 1.5px 0 rgba(255,255,255,.35), 0 0 18px rgba(210,95,30,.22), 0 8px 18px rgba(0,0,0,.45)` (256)
- Sheet/modal: `0 24px 60px rgba(0,0,0,.55), 0 0 30px rgba(210,95,30,.14)` (628)
- Toast: `0 14px 40px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.12)` (654)
- Login card: `inset 0 1px 0 …, inset 0 -1px 0 …, 0 24px 60px rgba(0,0,0,.5)` (709)

Pattern: every "elevated" surface gets an `inset 0 1px 0 rgba(255,255,255,~.2-.35)` top highlight
plus a large soft drop shadow. That inset-highlight convention *is* a real, consistent system
choice even though it's not expressed as a variable.

### 2.5 Radii

No radius scale/tokens. Observed values cluster loosely: `12–20px` for small controls (buttons,
scene tiles), `16–20px` mid controls, `28–32px` for sheets/cards (`.sheet` 30px/593, `.login-card`
32px/706, `.confirm-sheet` 28px/625), and **percentage-based** radii on tiles for responsive
scaling (`border-radius: 29%` on `.atile .aglass`, 313; `24%` on `.dcard .aglass`, 453; `18%`/`20%`
on icon insets). Where `@supports (width: 1cqi)` is available (323–331), tile radii switch to
container-query units (`calc(100cqi * var(--tile-r))`) for pixel-perfect scaling — a deliberate
progressive-enhancement fallback, not an oversight.

### 2.6 Spacing

No spacing scale. Ad hoc values throughout, with `clamp()` used for the handful of places that
need to be genuinely responsive: grid gap `clamp(20px, 3vw, 32px)` (184), grid padding
`clamp(8px, 2vw, 24px) clamp(12px, 3vw, 32px)` (186), deck padding `0 clamp(12px, 3vw, 32px) 22px`
(421). Most chrome (sheets, toasts, buttons) uses fixed px (14/16/18/20/22px).

### 2.7 Typography

Two font families, both Google Fonts, loaded via one `<link>` (18):
- **Bricolage Grotesque** (variable, opsz 12–96, weights 400/700) — display/heading use only:
  `.ttitle` (394), `.obstitle`... actually `.sheet h3`/`.login-card h3`/`.confirm-sheet h3`/`.drawer-head h2` (601, 719, 640, 528).
- **Inter** (400/500/600/700) — body font (`body { font-family: "Inter", -apple-system, "SF Pro
  Display", "SF Pro Text", system-ui, sans-serif }`, 48), with an explicit Apple-system fallback
  chain — a deliberate "feel native on iOS/Mac, degrade gracefully on Android" choice.
- Sizes are all literal px (11px footers up to 26px PIN input), no type scale/tokens.
- `font-variant-numeric: tabular-nums` on the PIN input (732) for stable digit width.

### 2.8 Transitions & easing curves — two distinct curves, must not be conflated

1. **`cubic-bezier(.22,.61,.36,1)`** — used for discrete UI feedback: `.atile.is-activating`
   press animation (244), the vertical screen-settle transition (2702, 2736: `"transform .20s|
   .22s cubic-bezier(.22,.61,.36,1)"`, Android WebView gets 0.20s, PWA gets 0.22s).
2. **`cubic-bezier(.22,1,.36,1)`** — used for the horizontal page-snap and *solved numerically at
   runtime* by `smoothSnapProgress()` (2595–2610, an 8-iteration bisection against the Bézier X
   coordinate) so the JS-driven `scrollLeft` animation matches the same motion feel as a native
   CSS transition would give. This is the more interesting engineering choice in the file: the
   comment at 2599 says explicitly this exists so "the same motion token is used by the PWA and by
   the Android WebView assentamento [settling]" — i.e. cross-platform curve parity was a deliberate
   goal already, which is directly relevant to Windows parity work.

Other transitions: icon fade-in `opacity .16s ease` (320), icon rotation `.18s cubic-bezier(.22,
.61,.36,1)` (298, same curve as #1), toast `opacity .18s ease, transform .18s ease` (656), up-banner
`opacity .25s ease, transform .25s ease` (672), sheet rise `@keyframes rise` `.18s ease` (596, 600),
drawer slide `transform .22s ease` (519). `@media (prefers-reduced-motion: reduce)` disables the
tile press animation only (247–249) — not the screen-transition or deck animations.

---

## 3. Every UI state — audited against PRD §7's "carregando, vazio, offline, erro, sucesso"

**Only 2 of the 5 PRD-required states have a persistent visual representation. The other 3 are
either transient (toast, 2.5s) or entirely absent.** This is the single most important finding for
Windows-host parity work, since §7 requires "estados equivalentes" and this surface is the nearest
behavioral reference for what "equivalent" has meant so far.

| PRD state | Implementation | Verdict |
|---|---|---|
| **Carregando (loading)** | `renderLaunchpad()` (1621–1678): if `!state.pieces.length && !state.installedReady` (1624), it clears the track and dots and returns (1625–1628) — **no skeleton, spinner, or placeholder is ever rendered.** The screen is simply blank until the first `/api/apps` + `/api/apps/installed` responses land. | **Absent.** |
| **Vazio (empty)** | Real and styled: `.atile.empty` (211–220, dimmed glass card, `pointer-events:none`, no tap target) for unfilled grid slots; `.rempty` (466–470) centered muted text `t("recents.empty")` for the Recents screen with zero running apps. | **Present.** |
| **Offline** | `state.online` is tracked by `loadHealth()` (2244–2258, polling `/health` every 15s–60s with backoff) but the *only* surface is a 2.5s toast on the online→offline transition (2254, `t("toast.macDisconnected")`). The code comment at 2401 (`/* offline: keep last view */`) confirms this is intentional: stale tiles stay on screen and stay tappable, and taps will just fail with another toast (`activateApp` catch at 1272). There is no persistent banner, dimmed state, or "reconnecting…" indicator. | **Absent as a state — present only as a transient event.** |
| **Erro (error)** | Toasts only, styled via `.toast.err` (659, red border/text). Server error codes are mapped through `serverErrorMessage()` (1108–1113) into localized strings (`PINNED_LIMIT_REACHED`, `REVISION_CONFLICT`, `INVALID_PIECE_POSITION`, etc., 857–865/900–908). OBS has one persistent error surface: `.obsplaceholder` (573, amber-toned) shown when `o.error` is true (2042). | **Present but transient**, except OBS which has a real persistent error state. |
| **Sucesso (connected)** | A 2.5s toast on offline→online transition (2255, `t("toast.deviceConnected")`); OBS "on" LED with pulse animation (`led.on .d`, 539, `@keyframes pulse` 117–121) while `o.connected`. Per-tile "running" status text/dot exists in the DOM (`buildTile` 1583–1586, `updateStatuses` 2412–2423) but is **permanently invisible**: `.atile .astatus{ display: none; }` (335–337) is never overridden for `.astatus.on` (338 only sets `color`, not `display`) — the JS faithfully computes and writes the running-state text/class on every poll, and CSS hides it unconditionally, for every device and every screen reader (it's `display:none`, not visually-hidden-but-announced). This is dead code, not a design choice with a comment explaining it. | **Present only as a transient toast; the intended persistent "app is running" badge is inert CSS.** |

Two more state-adjacent behaviors worth carrying into the Windows work:
- **Auth/session state**: a 401 on any `req()` call re-shows the login wall (1125, `showLogin()`),
  independent of the online/offline polling loop — so "session expired" and "server unreachable"
  are two different code paths that can both leave the user looking at a frozen grid until the next
  poll or tap.
- **Forced-reload state**: `maybeReloadForUi()` (2179–2186) triggers `toast(t("toast.updated"))`
  then `location.reload()` 600ms later whenever the server's UI version (`v`, sent over WS `apps`/
  `online` messages or `/api/apps` response) changes mid-session. This is a 6th, PRD-unlisted state
  ("stale client") that silently reloads the whole app.

---

## 4. Dock grid — columns, rows, paging, peek, indicators

- **Grid**: `.page-grid` is CSS Grid. **Portrait (default)**: `grid-template-columns: repeat(2,
  var(--tile))`, `grid-template-rows: repeat(4, var(--tile))` (171–172) — **2 columns × 4 rows**.
  **Landscape** (`@media (orientation: landscape)`, 493–498): flips to `repeat(4, var(--tile))`
  columns × `repeat(2, var(--tile))` rows — **4 columns × 2 rows**. `pageSize()` (1089) is a
  hardcoded `8` regardless of orientation — the grid shape changes, the slot count per page does
  not. **PRD §7's "grid em 4 colunas por 2 linhas" matches this PWA's landscape layout, not its
  portrait default** — a desktop host window (landscape-shaped) should reference the landscape
  rules (493–511), not 168–200.
- **Paging**: `pageCount = max(1, state.maxPinnedPages || 5)` (1645, server-driven limit, default
  5), `slotCount = pageCount * 8`. Pages are built as an array of fixed-length chunks
  (`renderLaunchpad`, 1647–1652) — slots are **positional and persistent** (server assigns
  `piece.position`, 1635), not a simple push-fill list; empty slots render as `.atile.empty`
  in place, not compacted.
- **Peek**: **none.** `.launchpad` uses native `scroll-snap-type: x mandatory` +
  `scroll-snap-stop: always` (138–139) and each `.page` has `overflow: hidden` with the explicit
  comment (158–160) "Cada slide é uma página fechada: o pager não deve revelar slots da página
  seguinte enquanto a página atual está em foco" (each slide is a closed page; the pager must not
  reveal the next page's slots while the current page has focus). Grep for "peek" across the file
  returns zero hits. If a "peek lateral" affordance is wanted for the Windows host, it has no
  precedent here and must be designed net-new against the Mac app, not ported from this file.
- **Indicators**: `.dots` (340–356, horizontal, bottom of Apps screen) — one dot per page, only
  rendered when `pages.length > 1` (`renderDots`, 1680–1688), active dot widens from a 6px circle
  to a 14×6px pill. A second, unrelated indicator — `.vdots` (358–375, vertical, screen-edge) —
  tracks which of the two *screens* (Apps vs Recents) is active, not which page. Don't conflate the
  two: `.dots` = horizontal pager within Apps; `.vdots` = Apps↔Recents screen indicator.
- **Motion**: horizontal paging is driven manually in JS (`hTo`/`hFlush`/`hCommit`/
  `animateHorizontalSnap`, 2575–2666), not by native scroll-snap physics — native snap is
  temporarily disabled during a drag (`scrollSnapType: "none"`, 2660) so the code can decide
  commit vs. cancel using velocity + distance heuristics (`hDecide`, 2586–2594: flick threshold
  `HV_FLICK=0.32`, min distance `H_FLICK_MIN=14px`, or ≥18% of page width `HPAGE_RATIO`), then
  animates the settle itself via the bisected Bézier curve (§2.8).
- **Landscape scaling**: `layoutDockScale()` (1712–1748) measures the rendered grid's content
  height against the available `.launchpad` height and applies a CSS `scale()` transform on the
  grid (not on the tiles) if it overflows — a GPU-cheap way to keep 2 rows fully visible in short
  landscape viewports without recomputing `--app-tile`. It re-runs on resize, orientation change,
  `visibilitychange`, and a defensive `setInterval` poll every 800ms (`watchScale`, 1780–1786) "in
  case" — see §9 for why that poll is a real (if minor) cost, not a state concern.

---

## 5. Touch/gesture handling and haptics

Three independent gesture systems coexist in the same pointer-event space and must not fight:

1. **Vertical screen swipe** (Apps ↔ Recents, 2475–2988, the largest block in the file). Custom
   pointer-capture state machine, not CSS scroll-snap: `pointerdown` records origin + decides
   whether the gesture started inside `.launchpad` or `.deck` (`hOriginInLaunchpad`/
   `hOriginInDeck`, 2804–2806); `pointermove` picks an axis once `DRAG=4px` of movement has
   occurred, using `AXIS_RATIO=1.2` to disambiguate horizontal-vs-vertical intent (2831); commit
   decision blends instantaneous velocity (EMA-smoothed, `instVel = instVel*0.35 + v*0.65`, 2821)
   and average velocity over the whole gesture (`decideDir`, 2774–2787: flick if `instVel≥0.3px/ms`
   or `avg≥0.45px/ms` and `|dy|≥16px`, else a `commitPx()` distance threshold of `max(34, 6% of
   viewport height)`, 2496). "Rubber-banding" past the edges is capped at 28px (`RUBBER`, 2484,
   `rubberDy`, 2499–2510). A `COOLDOWN_MS=80` window after any commit prevents re-triggering
   mid-settle (2665, 2676, 2759).
2. **Horizontal page swipe** (within `.launchpad`, nested inside the same pointer handlers via
   axis detection) — separate velocity/threshold constants (`HV_FLICK=0.32`, `H_FLICK_MIN=14`,
   `HPAGE_RATIO=0.18`, 2571–2573) and its own settle animation (§2.8, §4).
3. **Deck (Recents) native horizontal scroll** (`bindDeckGestures`, 1874–1906) — deliberately
   *not* hijacked by the vertical engine: `hOriginInDeck`/`nativeDeckGesture` flags (2805–2806,
   2835, 2841–2846) let native `overflow-x: auto` scrolling own the gesture unless the move turns
   out to be vertical, in which case pointer capture is reclaimed mid-gesture (2841–2847).

**Long-press** (`bindHold`, 1221–1240): 550ms timer, 10px move-cancels-hold tolerance, sets
`suppressClickUntil = now + 700ms` on fire so the subsequent `pointerup`'s synthetic `click` doesn't
also fire the tap handler (`bindTap` checks `Date.now() < suppressClickUntil`, 1159). Long-press on
a tile routes through `tileLong()` (1437–1444) to either the "add to favorites" or the "confirm
remove" flow depending on current pinned state.

**`preventTouchFocusScroll`** (1164–1220) is a defensive workaround, not a gesture feature: on
touch pointerdown inside a scroller, it restores `scrollLeft/scrollTop` if focus attempts to
auto-scroll the container into view (Safari/WebView focus-scroll behavior), only when the pointer
didn't actually move ≥8px.

**Haptics** (`triggerHaptic`, 1515–1526): tries `window.DokkeAndroid.performHapticFeedback()`
first (native bridge, §7), falls back to `navigator.vibrate(8)` for web/iOS PWA contexts (iOS
Safari ignores `vibrate` silently — no further fallback exists for iOS). Fired on every
`pointerdown` inside `pressFeedback()` (1527–1535, called from `makeBtn`, 1251), which also drives
the `.is-activating` press-scale animation (§2.8 curve #1). **There is no Windows/desktop
equivalent path** — a mouse-driven Electron shell will need its own `triggerHaptic()` branch (likely
a no-op) plus a decision on whether `pressFeedback`'s visual animation alone is sufficient without
haptic feedback on desktop.

---

## 6. Service-worker caching strategy and update flow

`public/sw.js` (48 lines) — a hand-written, no-framework SW:

- **Cache name**: `"dokke-v24"` (sw.js:1) — a single flat cache, no runtime/precache split.
  Bumping it is how the SW invalidates old assets on `activate` (sw.js:8–12 deletes every cache
  key that isn't the current `CACHE`).
- **Precache list** (sw.js:2): `/`, `/index.html`, `/icon-192.png`, `/icon-192-dark.png`,
  `/icon-512.png`, `/manifest.webmanifest`. `sw.js` itself is deliberately excluded from precache
  and from the fetch handler's cache-first path (sw.js:19, with the comment "O script do Service
  Worker nunca pode ficar preso no cache antigo" — the SW script itself must never get stuck in an
  old cache).
- **Routing** (sw.js:14–48), three branches:
  1. `/api/*` and `/health` — **bypassed entirely**, `return` with no `respondWith` (sw.js:16) —
     always hits the network, never cached, never served stale.
  2. **Navigation requests** (`mode:"navigate"` or path `/`/`/index.html`) — **network-first**,
     `fetch(..., {cache:"no-store"})`, writes a fresh copy to cache on 200/basic responses
     (sw.js:26–29), and only falls back to the cache (then to `/index.html`) on network failure
     (sw.js:32–34). The inline comment names the reason: prevents a WebView kiosk from getting
     stuck serving an old cached HTML shell indefinitely (referenced bug "dots/layout antigos no
     J5").
  3. **Everything else** (icons, manifest) — **cache-first**, network fallback that also
     populates the cache (sw.js:39–47), final fallback to `/index.html` on total failure — which is
     a latent bug for non-navigation asset requests (an icon 404/offline would resolve to HTML
     bytes), but low-impact since the asset list is small and stable.
- **Update flow, three independent mechanisms that don't share state**:
  1. **SW-level**: `navigator.serviceWorker.register("/sw.js?rev=dokke-v24")` (index.html:3109).
     The `?rev=` query string is a **second, independently-maintained copy** of the same version
     string as `CACHE` in sw.js:1 — both currently read `dokke-v24`, but nothing enforces they move
     together. If a deploy bumps one and not the other, the browser won't see the registration URL
     change and won't re-fetch/re-install the new SW script.
  2. **App-shell reload**: `maybeReloadForUi()` (index.html:2179–2186) — server-pushed UI version
     (`v` field on WS messages or `/api/apps`) differing from the first value seen this session
     triggers a toast + `location.reload()` after 600ms. This exists because the SW's network-first
     navigation strategy already serves fresh HTML on next load, but a long-lived kiosk tab won't
     naturally reload itself — this is the mechanism that forces it to.
  3. **Release-update banner**: `checkVersion()` (index.html:3048–3094) — unrelated to the SW/app
     version above; compares this device's installed release (`v.local`, from `/api/version`,
     server-read `version.json`, §7) against the latest GitHub release (`v.latest`), with
     divergent behavior for Android (`window.DokkeAndroid.requestUpdate()`, opens the APK download)
     vs. Mac/web (opens the GitHub release page). This is about the *native app* being outdated,
     not the PWA's own JS/CSS — a Windows host would plug into this same endpoint contract but with
     its own installer-update mechanism instead of `DokkeAndroid.requestUpdate`.

---

## 7. WS client and reconnection

- **Endpoint**: `ws(s)://<host>/ws` (index.html:2348), opened only when `authed === true`
  (2344) — i.e. never before a successful PIN login.
- **Guard against duplicate sockets**: `connectStatusWs()` no-ops if an existing socket is
  `CONNECTING` or `OPEN` (2345).
- **Messages handled** (`onmessage`, 2352–2364): `{type:"online", online, v}` updates
  `state.online` and checks for a forced-reload version bump; `{type:"apps", pieces|pinned,
  running, limits, revision, v}` is the live-push equivalent of an `/api/apps` poll response,
  merged through the same `applyAppsPayload()` used by the HTTP path (2302–2338) — **single
  code path for WS-pushed and HTTP-polled state**, no divergent handling.
- **Reconnection**: exponential backoff starting at `wsRetry=2000ms`, doubling on every `onclose`
  up to a 30000ms ceiling (`scheduleWsReconnect`, 2371–2378), reset to 2000ms on a successful
  `onopen` (2351). Reconnect is skipped while the page is hidden (`if (!pageHidden())
  connectStatusWs()`, 2375) and re-attempted immediately on `visibilitychange` (2407–2409).
  `onerror` just force-closes the socket (2369) to route through the same `onclose` → backoff path
  — no separate error-state handling.
- **Fallback / hybrid with polling**: `loadApps()` (2380–2405) is not purely a fallback — when the
  socket is open it sends a lightweight `{type:"ping"}` (2385) on its own timer instead of an HTTP
  request, at the fast `APPS_OK=2500ms` cadence; when the socket is down, it does the real
  `GET /api/apps` at an adaptively-doubling backoff (`appsBackoff`, up to `POLL_MAX=60000ms`,
  2402) and calls `connectStatusWs()` again on failure (2404). `loadHealth()` (2244–2258) is fully
  independent of the WS/apps machinery — its own `/health` poll (15s base, doubling to 60s ceiling)
  drives only the online/offline toast.
- **Backgrounding**: both poll loops check `pageHidden()` and switch to a slow `POLL_HIDDEN=30000ms`
  cadence rather than stopping outright (2246, 2382) — chosen so a backgrounded PWA still notices
  reconnection reasonably fast without burning CPU/radio at foreground rates.

---

## 8. Decomposition proposal — same visual output, real module boundaries

**Hard constraint, stated up front: this cannot become runtime ES modules or an external
stylesheet if "byte-for-byte visual output" is the bar.** Two concrete reasons in this file:

1. The `<style>` block (19–747) is inline and render-blocking by design; a `<link rel=stylesheet>`
   introduces a FOUC window on first paint that doesn't exist today.
2. The `<script>` (813) is a classic script executing synchronously right after the body markup,
   before any `defer`/`module` timing would apply. `renderVDots()` (3006), `checkOrientation()`
   (3009), and `boot()` (3106) all run inline, measuring layout state (`window.innerWidth`,
   `matchMedia`) in the same frame the markup was parsed. `type="module"` defers execution to after
   parsing — different timing, different first-paint. Worse: `IS_ANDROID_WEBVIEW` sets
   `.android-webview` on `<html>` (index.html:1457) synchronously, and CSS rules depending on that
   class (226–235: shadow/touch-action overrides for WebView) currently apply before first paint;
   a deferred module would risk a frame where they don't — a visible regression on exactly the
   platform (Android WebView) the project must keep at parity with.

So the decomposition has to be **source-split + a build step that concatenates back into one
`index.html`**, not a runtime-modular rewrite. Concretely:

```
public-src/
  index.html.tmpl        # head boilerplate + <style>{{CSS}}</style> + body + <script>{{JS}}</script>
  styles/
    tokens.css            # :root custom properties (19-34) — audit --glass/--edge before keeping
    base.css               # reset, html/body, .bg, main/.screens/.screen (35-116)
    launchpad.css           # .stage/.launchpadwrap/.launchpad/.page/.page-grid/.atile/.aglass/.dots (123-356, 492-511)
    recents.css             # .vdots/.recents/.thead/.deck*/.dcard/.rempty/.robscard (358-490)
    drawer-obs.css           # .drawer/.obs* (512-576)
    sheet-modal.css          # .scrim/.sheet/.btns/.btn/.confirm-* (578-646)
    toast-update.css         # .toast/.up-banner (647-693)
    login.css                # .login-scrim/.login-card (694-745)
  scripts/
    i18n.js                  # I18N dict, t(), renderLanguage() (831-947)
    net.js                    # req(), post() (1115-1138)
    state.js                  # the shared `state` object + the ~15 module-level lets from §1.1 — SINGLE FILE, explicitly the seam every other module imports
    icons.js                  # appGrad/mono/giconEl/iconPath/loadIcon/primeIcon/iconCache (949-971, 1459-1514)
    input-primitives.js        # bindTap/bindHold/makeBtn/preventTouchFocusScroll/pressFeedback/triggerHaptic (1155-1260, 1515-1536)
    login.js                   # showLogin/hideLogin/doLogin (983-1069)
    launchpad.js                # buildTile/renderLaunchpad/dots/layoutDockScale/orientation (1446-1799)
    recents-deck.js              # deckQueue/makeDeckCard/renderDeck/bindDeckGestures/renderRecents (1801-1972)
    pin-sheet.js                  # openPinSheet + favLong/tileLong confirm flows (1362-1444, 1974-2035)
    obs.js                         # renderObs/doObs/confirmStopAll/loadObs (2037-2153)
    sync.js                         # applyAppsPayload/loadHealth/loadApps/loadInstalled/wake-lock (2188-2439)
    ws-client.js                    # connectStatusWs/scheduleWsReconnect (2340-2378)
    gesture-engine.js                # the vertical swipe + horizontal pager + wheel state machine (2475-3004) — largest module, keep as one unit, do not split further (see below)
    update-banner.js                 # checkVersion/showUpBanner/cmpVer (3016-3094)
    boot.js                           # boot(), initial calls, SW registration (3097-3111)
  build/
    assemble.js               # concatenates styles/*.css into the <style> slot in file order above (cascade order is part of the contract — @supports (width:1cqi) at 323 must stay after 311-322), concatenates scripts/*.js in dependency order into the <script> slot, writes public/index.html
```

Rules that make the split safe:

- **`state.js` is the one shared-mutable module.** Every other module reads/writes through it —
  no module keeps its own private copy of anything currently in `state` or in the loose
  module-level `let`s (`suppressClickUntil`, `deckPid`, `pages`, `iconCache`, `statusWs`,
  `coolUntil`, `settling`, etc., §1.1). This avoids the circular-import trap the advisor flagged:
  input-primitives.js and gesture-engine.js both touch `suppressClickUntil`/`deckPid`; without a
  single owner they'd need to import each other.
- **`gesture-engine.js` stays one file.** It's ~530 lines but its internal closures over `hGest`,
  `hStartPage`, `settling`, `coolUntil`, `dragRaf`, `hSnapRaf` etc. are tightly coupled (pointerdown
  sets up state that pointermove/pointerup/wheel all read); splitting it by "vertical" vs
  "horizontal" concern would require lifting ~10 more variables into `state.js` for no benefit —
  the file's own internal cohesion is already a boundary, not a smell.
- **CSS concatenation order is part of the contract, not incidental.** The cascade currently
  depends on source order in a few places: the `@supports (width: min(1px,2px))` grid-gap override
  (180–188) must land after the base `.page-grid` rule (168–179); the `@supports (width: 1cqi)`
  radius override (323–331) must land after `.atile .aglass` (311–322); the landscape media query
  (492–511) must land after the portrait base grid (168–200). `assemble.js` must preserve the file
  list order above verbatim, not alphabetize it.
- **Fonts/preconnect/manifest links (1–18) and the body markup shell (748–812) stay in the
  template**, not extracted — they're small, static, and splitting them buys nothing.
- **Verification for "byte-for-byte"**: after wiring the build step, diff the assembled
  `public/index.html` byte-for-byte against the current committed file (`diff <(node
  build/assemble.js --stdout) public/index.html`) before trusting the split. Any difference other
  than intentional whitespace at module-join points is a regression.

---

## 9. Optimizations found while reading (not requested, but cheap and low-risk)

| Finding | Effort | Risk |
|---|---|---|
| `watchScale()` (index.html:1781–1786) runs `layoutDockScale()` on a bare 800ms `setInterval` forever, including while backgrounded/hidden (no `pageHidden()` guard, unlike the poll loops) — pure defensive polling for a layout that already has resize/orientation/visibility listeners. Replace with a `ResizeObserver` on `.launchpad`. | S | low |
| `updateStatuses()` (2412–2423) walks every `.atile` on every apps update to set `textContent`/`classList` on `.astatus`, which is `display:none` unconditionally (335–337, see §3) — fully inert work every poll/WS tick. Either wire up the CSS to show it, or delete the JS. | S | low |
| `URL.createObjectURL(blob)` in `loadIcon()` (index.html:1498) is never paired with `URL.revokeObjectURL` — over a long-lived kiosk session with many distinct app names, this is unbounded blob-URL retention. Low real-world impact (bounded by distinct app count) but a genuine leak pattern. | S | low |
| `sw.js:1` `CACHE = "dokke-v24"` and `index.html:3109` `?rev=dokke-v24` are two independently-hand-edited copies of the same release tag. A deploy that bumps one and forgets the other silently breaks SW update propagation (the registration URL not changing means the browser won't re-check `sw.js` promptly). Generate both from one build-time constant. | S | low |
| When `statusWs.readyState === 1` but the server-side connection is actually dead (half-open TCP), `loadApps()` (2384–2388) keeps sending `{type:"ping"}` on the fast 2500ms cadence indefinitely and never falls back to HTTP polling — there's no ack-timeout/heartbeat-miss detection on the client side. | M | low |

---

## Visual contract checklist (PRD §7 items this surface can and cannot answer)

- [x] Estados equivalentes de vazio — present (`.atile.empty`, `.rempty`).
- [ ] Estados equivalentes de carregando — **absent**, blank screen only (§3).
- [ ] Estados equivalentes de offline — **absent as a persistent state**, transient toast only (§3).
- [~] Estados equivalentes de erro — present but transient (toast), except OBS (persistent, present).
- [~] Estados equivalentes de sucesso — present only as transient toast; the coded-but-CSS-dead
      "running" badge (§3) should be revived rather than reinvented for Windows.
- [x] Dock em grid — present, but **portrait 2×4 / landscape 4×2**, not a fixed 4×2 (§4); Windows
      host (landscape-shaped window) should mirror the landscape rules specifically.
- [ ] Peek lateral — **not implemented anywhere in this surface**, and deliberately suppressed by
      CSS/comment (§4). Must be designed against the Mac app, not ported from here.
- [x] Indicadores de página — present (`.dots`), plus an unrelated screen-indicator (`.vdots`) —
      don't conflate the two when porting.
- [ ] Sidebar Apps/Conectar — **not part of this surface** (§0).
- [ ] Tela Conectar (PIN/URL/QR/copiar/abrir/status/dispositivos/regenerar) — **not part of this
      surface** (§0); this file only *consumes* a PIN via a 4-digit login wall, it never generates
      or displays one.
- [ ] App picker com busca/"Adicionado"/"Adicionar" — **not part of this surface**; the closest
      analog is the pin-sheet "favorite this installed app" list (§1, §5), which has no search and
      is a bottom sheet, not a dedicated screen.
- [ ] Modo explícito de reordenar — **not implemented in this surface** at all.

---

## Cross-surface contracts this file exposes (do not rename/break unilaterally)

- **`window.DokkeAndroid`** bridge, called at index.html:1008 (`setLoginPortrait`), 1047
  (`hideKeyboard`), 1516 (`performHapticFeedback`), 3029/3066–3072 (`requestUpdate`,
  `appVersion`). This is the Android WebView's native-JS bridge contract; a Windows/Electron host
  would need an equivalent `window.DokkeWindows`-style bridge (or explicit no-ops) rather than
  reusing this name, since the JS branches on `typeof android.X === "function"` per-call.
- **HTTP/WS endpoints consumed**: `/api/auth` (POST, PIN login), `/api/apps`, `/api/apps/installed`,
  `/api/apps/:name/icon`, `/api/apps/:name/activate`, `/api/pieces/:id/open`,
  `/api/config/pinned` (POST/DELETE), `/api/config/pieces/:id` (DELETE, revision-guarded),
  `/api/obs/state`, `/api/obs/:kind`, `/api/version`, `/api/probe`, `/health`, `wss://…/ws`.
  A Windows host consuming the same server (per the PRD's shared-protocol requirement) inherits
  this exact contract for the companion piece.
- **`version.json`** is read server-side only (`server.js:387`, exposed via `GET /api/version`) —
  this PWA never fetches `/version.json` directly (it calls `/api/version`). Don't attribute
  version.json's shape to this surface; it's a server-owned file this surface has zero direct
  coupling to.

---

## Rebrand points (Dokke → DeckTech) found in this surface

- `<title>Dokke</title>` (index.html:15).
- `manifest.webmanifest`: `"name": "Dokke"`, `"short_name": "Dokke"`,
  `"description": "Dock do Mac — apps e OBS Commander"` (manifest.webmanifest:2–4).
- Footer string `"footer.brand": "Dokke by Felipe Natanael"` in both locales
  (index.html:873, 916).
- Hardcoded GitHub URLs pointing at `felipenalves/Dokke` for release/APK fallback
  (index.html:3081, 3090).
- Cache name `"dokke-v24"` (sw.js:1) and SW registration query `?rev=dokke-v24`
  (index.html:3109) — cosmetic string, but any rebrand-driven cache bust should change these
  together (see §9 finding on the same pair).
- `version.json`: `{"tag": "v0.2.8", "apkVersion": "0.2.8"}` — no brand string itself, but its
  consumer-facing UI strings (`update.macTitle`, `update.available`, etc.) don't currently
  mention "Dokke" by name, so a rebrand only needs the four items above plus the manifest icons
  (`icon-192.png`, etc. — not renamed here since filenames weren't part of the in-scope files).
