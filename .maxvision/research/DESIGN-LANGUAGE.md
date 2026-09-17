# DeckTech — Design Language Specification

**Status:** extracted from shipping source, 2026-09-17. Every value below is transcribed from a
file in this repository or from the deployed bundle at `https://dokke.vercel.app`. No value is
recalled or inferred; each carries a `path:line`.

**Purpose:** (a) reproduce the look without seeing the original, (b) serve as a pass/fail review
rubric. Section 12 is the rubric. An implementation that violates a `FAIL` clause is not parity.

---

## 0. The finding that changes the brief

The user's description — *"lembra muito o novo iOS e aplicativo do macOS, com efeitos de glass e
interface fluida"* — is an accurate description of the **perceived** result and a misleading guide to
the **implementation**. The perception is correct; the mechanism is not what it looks like.

**The glass in Dokke is painted, not blurred.**

The signature surface, `.aglass` — every app tile on every screen of the companion — contains **zero
`backdrop-filter`**. It is a four-part paint job:

```
public/index.html:251-258
  background:   linear-gradient(160deg, rgba(255,255,255,.24), rgba(210,95,30,.18) 55%, rgba(35,16,8,.75));
  border:       1.5px solid rgba(240,135,55,.40);
  box-shadow:   inset 0 1.5px 0 rgba(255,255,255,.35),   /* top raking highlight */
                0 0 18px rgba(210,95,30,.22),            /* warm outer bloom     */
                0 8px 18px rgba(0,0,0,.45);              /* contact shadow       */
public/index.html:259-263
  ::before      linear-gradient(160deg, rgba(255,255,255,.28), transparent 45%)  /* sheen */
```

`backdrop-filter` appears exactly **6 times in 3113 lines** (`grep -c backdrop-filter
public/index.html` → 6), which is 4 unique surfaces once `-webkit-` duplicates are removed:
`.scrim.confirm-scrim` (589), `.sheet.confirm-sheet` (629), `.up-banner` (668), `.login-scrim` (700).
All four are **modal overlays that blur the app's own content**, never the desktop.

On macOS, every `glassEffect(...)` call is gated behind `#available(macOS 26, *)` against a macOS 14
deployment target:

| Call site | Glass branch | Shipping fallback (macOS 14–25) |
|---|---|---|
| `mac/Sources/ContentView.swift:169-177` | `.glassEffect(.regular, in: .rect(cornerRadius: 18))` | `RoundedRectangle(18).fill(Color.clear)` — **flat, fully transparent** |
| `mac/Sources/DockGridView.swift:199-206` | `.glassEffect(.regular, in: .rect(cornerRadius: 40))` | `RoundedRectangle(40).fill(DokkeTheme.page)` — **flat opaque #1B1107** |
| `mac/Sources/DockIcon.swift:203-214` | `.glassEffect(.clear[.interactive()], in: Circle())` | `.background(.ultraThinMaterial, in: Circle())` on a **22×22pt** chip |
| `mac/Sources/DockGridView.swift:213-226` | `GlassEffectContainer(spacing: 22)` | plain `LazyVGrid` |

The only real vibrancy in the entire macOS app is one `.ultraThinMaterial` on a 22×22-point hover
button (`DockIcon.swift:213`, sized at `:518`).

**Consequence for DeckTech on Windows.** The parity problem is far smaller than "Windows can't do
Liquid Glass." The tiles are CSS/paint and port 1:1 with zero delta. The four blurred overlays blur
in-page content, which Chromium's `backdrop-filter` does identically on Windows. The genuine gaps are
(a) window chrome geometry and (b) the macOS-26 glass layer — and (b) already has a shipping flat
fallback that is itself the parity target. See §11.

---

## 1. Naming the language

**Warm Obsidian Glass.** Eight characteristics, each verifiable:

1. **Near-black warm ground, not neutral.** `#080301` (`index.html:38`) — red-biased, not `#000`.
   macOS canvas is `#292120` (`DokkeTheme.swift:4`). Never a cool/blue-grey dark theme.
2. **Ember light source above and behind.** A fixed full-bleed radial wash, orange at 46% alpha,
   anchored at `50% -10%` (`index.html:61-72`). Everything in the UI is lit by it.
3. **A single raking-light angle: ~160°.** Every glass surface's gradient runs `160deg` (tiles,
   `:253`, `:261`) or `165deg` (overlays, `:622`, `:664`, `:707`). Top-left bright, bottom-right dark.
   This one angle, repeated, is what reads as "glass."
4. **Glass is edge-lit, not blurred.** Every glass surface pairs an `inset 0 1–1.5px 0 rgba(255,255,255,.22–.35)`
   top highlight with a warm 1–1.5px border. The highlight is the effect; the blur is optional.
5. **Squircle-proportional radii.** Tile radius is **29% of tile width** via container queries
   (`--tile-r: 0.29`, `index.html:164`, applied `:324` as `calc(100cqi * var(--tile-r))`), not a
   fixed pixel value. macOS uses `style: .continuous` (Apple squircle) on every `RoundedRectangle`.
6. **Content-first chrome.** No titles under tiles in the companion (`.aname{display:none}`, `:332`),
   no visible scrollbars anywhere, hidden title bar on macOS (`DokkeApp.swift:20-24`), hairline
   1px separators instead of panels.
7. **iOS system palette for semantics, brand orange for surfaces.** Blue/green/amber/red are literal
   Apple system colors (`index.html:24-27`); orange is the product.
8. **Motion is short, single-curve, and gesture-continuous.** 180–300ms, one easing family, and a
   gesture engine that hand-solves the same Bézier the CSS uses so finger-tracking and snap-settle
   are the same curve (`index.html:2599-2612`).

---

## 2. Surface authority — which file is the reference

| Concern | Reference | Reason |
|---|---|---|
| Color, glass recipe, radii, motion curves | **`public/index.html:19-747`** | The only surface with a complete, coherent, shipped token set. |
| Structure, hierarchy, density, navigation, states | **`mac/Sources/`** (flat, non-macOS-26 branch) | PRD §7 (`docs/plans/2026-08-18-dokke-windows-host-prd.md:78-96`) binds the Windows host to the Mac app's composition, not the PWA's. |
| Desktop grid geometry | **`index.html:493-508`** (`@media (orientation: landscape)`) + `DockGridView.swift:17-23` | Both are 4 columns × 2 rows. Portrait 2×4 is phone-only. |
| Marketing / light mode | `docs/src/style.css` | Deliberately a different, light product-marketing skin. Not a UI reference. |

**Do not port the portrait 2×4 grid to the desktop host.** `index.html:171` is phone-portrait;
`:496` is the desktop rule and matches `DockGridView.swift:213` (`count: 4`) and PRD §7's
"grid de 4 colunas por 2 linhas."

---

## 3. Color tokens — literal values

### 3.1 Companion (PWA) — `public/index.html:20-32`

| Token | Value | Line | Role |
|---|---|---|---|
| `--ink` | `rgba(255,255,255,.94)` | 21 | Primary text |
| `--ink-2` | `rgba(255,255,255,.62)` | 22 | Secondary text |
| `--ink-3` | `rgba(255,255,255,.5)` | 23 | Tertiary / disabled |
| `--accent` | `#0a84ff` | 24 | Apple systemBlue (dark) |
| `--green` | `#30d158` | 25 | Apple systemGreen (dark) |
| `--amber` | `#ffd60a` | 26 | Apple systemYellow (dark) |
| `--red` | `#ff453a` | 27 | Apple systemRed (dark) |
| `--glass` | `rgba(255,255,255,.07)` | 28 | **Declared, never referenced** — dead token |
| `--edge` | `rgba(255,255,255,.10)` | 29 | **Declared, never referenced** — dead token |
| `--app-tile` | `min(40vmin, max(21vw,21vh), 180px)` | 32 | Tile size, portrait phone |
| `--icon-turn` | `0deg` | 31 | Runtime-set icon rotation |

Non-tokenised literals that are nonetheless load-bearing:

| Value | Line | Role |
|---|---|---|
| `#080301` | 38, 42; `<meta theme-color>` :6 | Canvas / page ground |
| `rgba(232,111,39,.46)` | 68 | Primary ember wash |
| `rgba(184,76,20,.28)` | 69 | Secondary ember wash |
| `#241106 → #150804 → #080301` | 70 | Vertical ground gradient (0% / 55% / 100%) |
| `rgba(240,135,55,.40)` | 254 | Tile border (brand orange, 40%) |
| `rgba(210,95,30,.22)` | 255 | Tile bloom |
| `#ff837d` | 621, 737 | Error text on dark |
| `#ffb3ae` | 659 | Error text, toast variant |
| `rgba(94,92,230,…)` | 481, 553 | Apple systemIndigo, OBS accent pair |

### 3.2 macOS host — `mac/Sources/DokkeTheme.swift`

Swift `Color(red:green:blue:)` is sRGB 0–1. Converted to hex (×255, round):

| Token | Swift | Hex | Line |
|---|---|---|---|
| `DokkeTheme.canvas` | `(0.161, 0.129, 0.125)` | **`#292120`** | :4 |
| `DokkeTheme.page` | `(0.106, 0.067, 0.027)` | **`#1B1107`** | :5 |
| `DokkeTheme.selection` | `(0.039, 0.388, 0.851)` | **`#0A63D9`** | :6 |

Custom traffic lights (`ContentView.swift:99-113`) — drawn manually, never shown by default:
red `(0.96,0.23,0.21)` = `#F53B36`; yellow `(0.97,0.73,0.11)` = `#F7BA1C`;
green `(0.17,0.77,0.28)` = `#2BC447`; each 12×12 with `Circle().stroke(black .15, lineWidth: 0.6)`.

Recurring macOS alpha ladder on white: `.07` (icon card fill, `DockIcon.swift:483`), `.08`
(hover row + card border, `ContentView.swift:190`, `DockIcon.swift:478`), `.14` (sidebar border
`ContentView.swift:180`; icon fallback plate `DockIcon.swift:647`), `.22` (inactive page dot
`DockGridView.swift:178`), `.58` (unselected sidebar label `ContentView.swift:152`), `.92` (active
page dot `DockGridView.swift:178`), `.96` (website plate `DockIcon.swift:628`).

### 3.3 Landing — `docs/src/style.css:1-13`

| Token | Value | Line |
|---|---|---|
| `--ink` | `#1d1d1f` | 2 |
| `--muted` | `#77747d` | 3 |
| `--soft` | `#a9a6ad` | 4 |
| `--hero-orange` | `#ff8a38` | 5 |
| `--hero-orange-light` | `#fff1e6` | 6 |
| `--blue` | `#1633f9` | 7 |
| `--purple` | `#9653f4` | 8 |
| `--max-width` | `1120px` | 9 |
| `color-scheme` | `light` | 10 |

Verified identical in the deployed bundle `https://dokke.vercel.app/assets/style-DbfRKu8V.css`
(fetched 2026-09-17; 20 563 bytes). No drift between repo and production.

---

## 4. The glass recipe — exact, per surface

Four distinct recipes exist. Implementations must not collapse them into one.

### Recipe A — Tile Glass (`.aglass`) — the signature, **no blur**
`public/index.html:251-263`
```css
background:  linear-gradient(160deg, rgba(255,255,255,.24), rgba(210,95,30,.18) 55%, rgba(35,16,8,.75));
border:      1.5px solid rgba(240,135,55,.40);
box-shadow:  inset 0 1.5px 0 rgba(255,255,255,.35),
             0 0 18px rgba(210,95,30,.22),
             0 8px 18px rgba(0,0,0,.45);
overflow:    hidden;
/* ::before sheen, same 160deg, white .28 → transparent at 45% */
```
Empty-slot variant (`:215-220`): `background rgba(255,255,255,.035)`, `border-color rgba(240,135,55,.18)`,
`box-shadow inset 0 1px 0 rgba(255,255,255,.035), 0 0 0 1px rgba(0,0,0,.12)`, `::before` disabled.

Android-WebView degrade (`:226-229`): shadow collapses to
`inset 0 1px 0 rgba(255,255,255,.24), 0 2px 5px rgba(0,0,0,.24)` and `::before` is removed.
This is the existing precedent for a reduced-fidelity tier and is the model a Windows low-power tier
should copy rather than inventing one.

### Recipe B — Modal Glass (`.sheet.confirm-sheet`) — **the only heavy blur**
`public/index.html:622-635`
```css
background:       linear-gradient(165deg, rgba(255,255,255,.15), rgba(255,255,255,.05) 58%, rgba(210,95,30,.12));
border:           1px solid rgba(240,135,55,.30);
border-radius:    28px;
box-shadow:       inset 0 1px 0 rgba(255,255,255,.22),
                  0 24px 60px rgba(0,0,0,.55),
                  0 0 30px rgba(210,95,30,.14);
backdrop-filter:  blur(24px) saturate(145%);
```
Its scrim (`:585-591`): `background rgba(2,4,10,.70)` + `blur(18px) saturate(130%)`.

### Recipe C — Auth / Notification Glass
- `.login-scrim` (`:695-703`): `rgba(3,6,14,.34)` + `blur(20px) saturate(150%)`
- `.login-card` (`:705-711`): `linear-gradient(165deg, rgba(255,255,255,.18), rgba(255,255,255,.07) 55%, rgba(255,255,255,.12))`,
  border `rgba(255,255,255,.16)`, radius **32px**,
  `box-shadow: inset 0 1px 0 rgba(255,255,255,.22), inset 0 -1px 0 rgba(0,0,0,.28), 0 24px 60px rgba(0,0,0,.5)`.
  Note the **double inset** — a bottom dark inset as well as a top light one. No other surface has it.
- `.up-banner` (`:662-673`): `linear-gradient(165deg, rgba(255,255,255,.14), rgba(255,255,255,.05))`,
  border `rgba(255,255,255,.18)`, radius **18px**, `blur(18px) saturate(150%)`,
  `box-shadow 0 14px 40px rgba(0,0,0,.45)`.

### Recipe D — Opaque Panels (no glass at all)
- `.sheet` (`:592-598`): `rgba(24,26,38,.97)`, border `rgba(255,255,255,.12)`, radius **30px**
- `.drawer` (`:513-522`): `rgba(16,17,26,.96)`, `border-left rgba(255,255,255,.12)`
- `.toast` (`:648-657`): `rgba(28,34,54,.94)`, border `rgba(255,255,255,.14)`, radius 16px,
  `box-shadow 0 14px 40px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.12)`

> Recipes B/C/D use a **cool near-black** (`rgba(2,4,10)`, `rgba(16,17,26)`, `rgba(24,26,38)`,
> `rgba(28,34,54)`) while the canvas and tiles are **warm**. This is intentional contrast: chrome
> reads as glass sitting *above* a warm room. Do not unify them to the warm ground.

### Recipe E — macOS shipping surfaces (the Windows parity target)
- Sidebar (`ContentView.swift:167-184`): `RoundedRectangle(18, .continuous).fill(.clear)` +
  `.strokeBorder(Color.white.opacity(0.14), lineWidth: 1)`, inset 8pt on all four sides.
  **It is a stroked outline over the bare canvas — no fill, no blur.**
- Page card (`DockGridView.swift:196-208`): `RoundedRectangle(40, .continuous).fill(DokkeTheme.page)`
  = flat `#1B1107`.
- Icon card (`DockIcon.swift:481-489`): `.fill(Color.white.opacity(0.07))` overlaid with
  `.fill(DokkeTheme.page.opacity(0.26))` overlaid with `.strokeBorder(Color.white.opacity(0.08), 1)`,
  all at `cornerRadius: 28, style: .continuous`.
- Connect-screen cards (`ContentView.swift:368-371`, `:420-423`): `RoundedRectangle(16).fill(.quaternary)`.

---

## 5. Geometry — radii, sizes, spacing

### 5.1 Corner radii

| Element | Value | Source |
|---|---|---|
| Companion tile glass | **29% of tile width** (`--tile-r: 0.29`) | `index.html:164`, `:313`, `:324` |
| Companion tile icon | **19% of tile width** (`--tile-in-r: 0.19`), size 84% (`--tile-in`) | `:165-166`, `:327-328` |
| Deck card glass (screen 2) | **24%**, icon 20% at 92% size | `:453`, `:456-459` |
| Website plate | **26%**, inner img 18% at 72% | `:271`, `:277`, `:283` |
| `.atile` hit area | 20px | `:204` |
| `.login-card` | 32px | `:706` |
| `.sheet` | 30px | `:594` |
| `.sheet.confirm-sheet` | 28px | `:625` |
| `.up-banner`, `.login-card .btn.connect` | 18px | `:666`, `:738` |
| `.robscard`, `.scene`(15), `.ctl`(17) | 18 / 15 / 17px | `:481`, `:544`, `:558` |
| `.btn` | 16px | `:615` |
| `.toast` | 16px | `:653` |
| macOS page card | **40 continuous** | `DockGridView.swift:202`, `:205` |
| macOS icon card | **28 continuous** | `DockIcon.swift:477`, `:482` |
| macOS icon clip | **20** (non-continuous) | `DockIcon.swift:473`, `:598` |
| macOS sidebar shell | **18 continuous** | `ContentView.swift:170`, `:179` |
| macOS sidebar row | **6 continuous** | `ContentView.swift:148` |
| macOS Connect cards | 16 | `ContentView.swift:369`, `:421` |
| macOS PIN digit box | 16 | `ContentView.swift:548` |
| macOS picker sheet card | 22 continuous | `AppPickerSheet.swift:345` |
| macOS picker rows | 10–11 continuous | `AppPickerSheet.swift:185`, `:252` |
| Landing pills / buttons / nav | `999px` | `style.css:79`, `:120`, `:243` |
| Landing feature card | 28px (→ 23px under 640px) | `style.css:351`, `:843` |

**Ratio check (deliberate, verify before porting):** macOS icon/card size = 68/80 = **0.85**, which
matches the companion's `--tile-in: 0.84` within 1%. But macOS card radius 28/80 = **0.35** vs
companion `0.29`, and icon radius 20/68 = **0.29** vs companion `0.19`. The *size* ratio agrees;
both *radius* ratios disagree. Treat macOS as reference for the desktop host (PRD §7) and the
companion as reference for phones; do not "harmonise" them silently.

### 5.2 Sizes

**Companion tile scale** (`--app-tile`), three breakpoints:
- default / portrait phone: `min(40vmin, max(21vw,21vh), 180px)` — `:32`
- `@media (min-width:700px)`: `min(max(22vw,22vh), min(30vw,30vh), 220px)` — `:192`
- `@media (orientation:landscape) and (pointer:coarse)`: `min(max(22vw,22vh), min(30vw,40vh), 200px)` — `:510`

**macOS dock geometry** (`DockGridView.swift:17-23`) — all fixed points, no scaling:
```
pageSize 8   maxPageCount 5   tileSize 80   tileSpacing 22   pageHeight 288
carouselGap 24   carouselVerticalOffset 22   carouselPeekRatio 0.55
carouselMaxPageWidth 458   carouselMinPageWidth 450
```
Peek width solves as `(availableWidth - 24) / 1.55`, clamped to [450, 458] (`:162-165`).
Page card padding: 32 horizontal, 29 vertical (`:195-196`).

**macOS icon** (`DockIcon.swift:471-474`): `iconSize 68`, `iconCardSize 80`, `cornerRadius 20`,
`hoverBlurRadius 4`. Icon padded 6pt inside the card (`:498`). Label frame 88pt wide (`:576`).
Whole tile = `80 × (80 + 24)` (`:580`).
Website tile: plate 56×56 radius 16, favicon frame 50×50 radius 12, image 40×40 radius 10, fallback
glyph 22pt (`:626-638`).

**macOS window** (`DokkeApp.swift:86-89`): min 840×540, ideal/default **980×628**.
Sidebar 208pt wide (`ContentView.swift:34`), header 32pt (`:28`), sidebar chrome inset 8pt all sides
(`:181-184`).

**macOS picker sheet** (`AppPickerSheet.swift:164`): fixed **480 × 620**; search field 164×32
radius 16 (`:110-111`); rows min-height 50, radius 10 (`:251-252`); scrim `Color.black.opacity(0.48)` (`:159`).

**Connect screen** (`ContentView.swift`): content max width 980 (`:325`), page padding 28 (`:497`),
top padding 40 (`:499`), section spacing 20 (`:329`), QR 112×112 (`:381`) on `.white` + radius 10 +
10pt padding (`:577-579`), PIN digits 64×76 (`:546`), status dot 9×9 (`:429`).

### 5.3 Spacing scale (observed, not declared)

There is **no declared spacing scale anywhere**. The de facto scale, ranked by frequency:

- Companion: `6, 8, 10, 12, 14, 16, 18, 20, 22, 24` px. Fluid where it matters:
  grid gap `clamp(20px, 3vw, 32px)` (`:184`), grid padding `clamp(8px,2vw,24px) clamp(12px,3vw,32px)`
  (`:186`), deck side padding `clamp(12px,3vw,32px)` (`:421`), deck gap `min(3vmin,14px)` (`:428`).
  Screen side gutter is a hard `14px` (`:85`).
- macOS: `4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32`.
- Landing: `9, 16, 24, 28, 32, 40` plus section padding `clamp(96px, 11vw, 145px)` (`:443`, `:525`)
  and `clamp(100px, 12vw, 160px)` (`:300`).

**DeckTech should declare the scale that is already being used** rather than invent one: a 2px base
with the steps `4 6 8 10 12 14 16 18 20 22 24 28 32 40`. See §12 token list.

---

## 6. Type scale

### 6.1 Families

| Surface | Declaration | Source |
|---|---|---|
| Companion body | `"Inter", -apple-system, "SF Pro Display", "SF Pro Text", system-ui, sans-serif` | `index.html:46` |
| Companion display | `"Bricolage Grotesque", sans-serif` — used on exactly 2 elements | `:394`, `:528`, `:631` |
| Both loaded from | Google Fonts, `Bricolage Grotesque` opsz 12..96 wght 400;700 + `Inter` 400;500;600;700, `display=swap` | `:18` |
| macOS | **System font exclusively.** Zero custom faces, zero `Font.custom` in 4023 lines. | `mac/Sources/**` |
| Landing | `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` + `font-synthesis: none` | `style.css:11-12` |

**Verified defect:** the landing declares Inter and `font-synthesis: none`, uses `font-weight: 750`
and `650`, and ships **no `@font-face` and no Google Fonts link** — confirmed by fetching the
deployed CSS (`assets/style-DbfRKu8V.css`, `grep '@font-face'` → 0 matches) and the deployed HTML
(no font `<link>`). Inter therefore never loads; Windows visitors fall through to **Segoe UI**,
which has no 650/750 weights, and `font-synthesis: none` forbids faking them — so headings snap to
Semibold/Bold and the intended optical weight is lost. This is the single largest visual defect in
the whole system and it lands hardest on the exact audience DeckTech is being built for.

### 6.2 Companion scale — `public/index.html`

| Size | Weight | Family | Element | Line |
|---|---|---|---|---|
| 26px | 700 | Bricolage, `letter-spacing -.02em` | `.ttitle` (Recents heading) | 393-399 |
| 26px | 700 | Inter, `letter-spacing 12px`, tabular-nums | `.login-card input` (PIN) | 729-735 |
| 19px | 700 | Bricolage, `-.02em` | `.confirm-sheet h3` | 631 |
| 19px | 700 | Inter, `-.01em` | `.login-card h3` | 719 |
| 17px | 700 | Bricolage | `.drawer-head h2` | 528 |
| 17px | 700 | Inter | `.sheet h3` | 601 |
| 16px | 700 | Inter | `.login-card .btn.connect` | 738-739 |
| 15px | 700 | Inter | `.btn` | 616 |
| 14px | 700 | Inter | `.obstitle`, `.robscard .ot` | 541, 485 |
| 13.5px | 600 | Inter | `.toast`, `.up-banner .up-txt b` | 656, 679 |
| 13px | — | Inter, `line-height 1.5` | `.sheet .body`, `.login-card .body` | 602, 720 |
| 12.6px | — | Inter, `line-height 1.45` | `.login-card .lsteps p` | 727 |
| 12.5px | — | Inter, `line-height 1.5` | `.confirm-sheet .body` | 632 |
| 12px | 600 | Inter | `.ctl`, `.thint`, `.lerr` | 561, 474, 737 |
| 11px | 700 | Inter | `.sheet .srow .pin`, `.up-download` (11.5) | 611, 683 |
| 11px | — | Inter, `letter-spacing .02em` | `.login-card .lfoot` | 745 |

Letter-spacing is negative only on display text (`-.01em` to `-.02em`), positive only on the smallest
caption (`.02em`) and the PIN field (`12px`, an extreme literal for digit separation).

### 6.3 macOS scale — semantic `Font` + explicit points

Semantic: `.title.bold()` (Connect H1, `ContentView.swift:348`), `.headline` (section heads, `:356`),
`.headline.weight(.semibold)` (app title, `:71`), `.subheadline.weight(.semibold)`, `.caption`,
`.caption.weight(.semibold)`, `.caption2`.

Explicit points:

| Size / weight | Element | Line |
|---|---|---|
| 42 bold monospaced | PIN digit | `ContentView.swift:545` |
| 58 regular | QR placeholder glyph | `ContentView.swift:573` |
| 19 semibold / 18 bold | picker header glyphs | `AppPickerSheet.swift:75`, `:80` |
| 17 medium | sidebar toggle icon | `ContentView.swift:89` |
| 14 semibold monospaced | LAN URL | `ContentView.swift:386` |
| 13 medium | sidebar label | `ContentView.swift:142` |
| 13 semibold | reorder overlay glyph | `DockIcon.swift:555` |
| 12 semibold | **tile label** | `DockIcon.swift:573` |
| 12 medium / 11 medium | sidebar icon, grid hint | `ContentView.swift:139`; `DockGridView.swift:86-89` |
| 9 semibold | hover chip captions ("Remover"/"Mover") | `DockIcon.swift:522`, `:561` |

Zero explicit tracking anywhere in the Swift sources.

### 6.4 Landing scale — `docs/src/style.css`

| Size | Weight | Tracking | Element | Line |
|---|---|---|---|---|
| `clamp(48px, 6.7vw, 82px)` | **750** | `-.075em` | `h1` | 202-204 |
| `clamp(44px, 5.5vw, 72px)` | **750** | `-.075em` | section h2 | 326-328, 539-541 |
| `clamp(25px, 2.5vw, 35px)` | **650** | `-.055em` | card h3 | 383-385, 653-655 |
| — | **650** | `-.035em` | roadmap / FAQ titles | 512-513, 612-613 |
| 15px | — | — | body copy, `line-height 1.65` | 396-398 |
| 14px | 700 | `-.04em` | wordmark | 87-89 |
| 12px | — | — | nav links | 98 |
| 9–11px | 700 | `.1em`–`.16em` | eyebrows (uppercase) | 194-195, 316-317, 499-500, 644-645 |

The landing's `-.075em` on display type is **three times tighter** than anything in the product UI
(`-.02em` max). That is a deliberate marketing-vs-UI distinction, not drift.

---

## 7. Motion

### 7.1 Easing curves — there are exactly two, and they are not the same

| Curve | Where | Source |
|---|---|---|
| `cubic-bezier(.22, .61, .36, 1)` | Product UI: tile press (`appPress .30s`), icon rotation (`.18s`), screen slide (`.22s` / `.20s` Android) | `index.html:244`, `:298`, `:2702-2703`, `:2736-2737` |
| `cubic-bezier(.22, 1, .36, 1)` | Launchpad horizontal snap (solved numerically in JS); landing hero parallax `520ms` | `index.html:2599-2612`; `style.css:171` |

`.22,1,.36,1` is *easeOutQuint*-like — it leaves fast and settles very softly. `.22,.61,.36,1` is
gentler out of the gate. **Do not substitute one for the other.**

*Correction to a claim circulating in `LANDING.md`:* `test/docs-hero-motion.test.mjs` does **not**
assert the easing curve. Verified by reading all 47 lines: it asserts asset filenames and byte
ceilings (`:17-20`), the `dokkeHeroIcon` identifier (`:23`), pointer-event wiring (`:26-31`),
`transform: translate3d(var(--hero-mx …` and a bare `transition: transform` (`:33-34`), `scale(.95)`
(`:36`), icon dimensions 204px/124px (`:37-38`), three breakpoint values (`:39-42`) and the
reduced-motion `transform/transition: none !important` pair (`:43-46`). **Changing
`cubic-bezier(.22,1,.36,1)` on the landing does not break CI** — which is itself a gap: the one
motion token the design system depends on is the one thing this "motion" test does not pin.

The launchpad snap does not use CSS at all: it Newton-bisects x on `cubic-bezier(.22,1,.36,1)` over
8 iterations and drives `scrollLeft` per rAF (`index.html:2593-2612`, `:2627-2645`), specifically so
the PWA and the Android WebView produce identical settle motion. Any Windows host that re-implements
paging must reuse this function, not approximate it with a CSS transition.

### 7.2 Durations

| ms | What | Source |
|---|---|---|
| 80 | Gesture cooldown after a commit (`COOLDOWN_MS`) | `index.html:2485` |
| 80 | Connect-button press (`transform .08s`) | `:743` |
| 150 | Connect-button opacity | `:743` |
| 160 | Icon fade-in on load | `:320` |
| 180 | `rise` sheet entry; toast in/out | `:596`, `:600`, `:656` |
| 180 | Icon rotation | `:298` |
| 200 | Dot state; macOS sidebar show/hide (`easeOut 0.2`) | `:350`, `:373`; `ContentView.swift:52`, `:84` |
| 200 / 220 | Screen slide — Android WebView / everything else | `:2702-2703` |
| 220 | Drawer slide | `:519` |
| 250 | **`H_SNAP_DURATION`** — launchpad page snap | `:2574` |
| 250 | macOS page-dot select (`easeOut 0.25`) | `DockGridView.swift:189` |
| 250 | macOS hover spring: `.spring(response: 0.25, dampingFraction: 0.7)` | `DockIcon.swift:602` |
| 250 | Update banner in/out | `:672` |
| 300 | Tile press (`appPress`) | `:244` |
| 280 ±20 | Jiggle half-cycle: `0.28 + (seed % 3) * 0.02`, repeatForever autoreverses | `DockGridView.swift:178-183` |
| 220 | Jiggle exit | `DockGridView.swift:180` |
| 520 | Landing hero parallax; 140 on hover, 90 on press | `style.css:171`, `:175`, `:182` |

### 7.3 Gesture thresholds — `public/index.html:2480-2574`

Vertical (Apps ↔ Recents):
```
AXIS_RATIO   1.2    // |dy| must exceed 1.2×|dx| to claim the vertical axis
VEL_INST     0.3    px/ms instantaneous
VEL_AVG      0.45   px/ms average
FLICK_MIN    16     px minimum travel for a flick
RUBBER       28     px overscroll limit in the direction with no next screen
COOLDOWN_MS  80
commitPx()       = max(34,  round(height * 0.06))   // :2496
wheelCommitPx()  = max(70,  round(height * 0.14))   // :2497
```
Horizontal (launchpad pager):
```
HV_FLICK          0.32   px/ms
H_FLICK_MIN       14     px
HPAGE_RATIO       0.18   // 18% of page width commits without a flick
H_SNAP_DURATION   250    ms
```

### 7.4 Named keyframes

| Name | Definition | Line |
|---|---|---|
| `appPress` | `1 → .95 @18% → .975 @48% → 1` — an overshoot-free double-settle | 236-241 |
| `rise` | `translateY(14px) opacity .4 → none / 1` | 600 |
| `pulse` | `box-shadow 0 0 0 0 → 0 0 0 9px` green `.55 → 0`, 1.8s infinite | 117-121 |
| `blink` | `opacity 1 (0–60%) → .35 (61–100%)`, 1s infinite | 571 |

### 7.5 Reduced motion

| Surface | Behaviour |
|---|---|
| Companion | `@media (prefers-reduced-motion: reduce)` disables **only** `appPress` (`:247-249`). The gesture engine sets snap duration to **1ms** when reduced (`:2663`). Screen slides are not gated. |
| macOS | `@Environment(\.accessibilityReduceMotion)` is read in `DockGridView.swift:6` and forwarded to `DropDelegate` only. The jiggle, hover spring and page-dot animations **ignore it**. |
| Landing | `style.css:789-795` sets `transition-duration: .01ms !important` globally — an over-broad override that also kills non-motion transitions (colour). |

**Gap to close in DeckTech:** no surface has a complete reduced-motion story. The Windows host must
gate jiggle, hover scale/blur, and page transitions.

---

## 8. Light / dark

**There is no light/dark system. Every product surface is hard-locked to dark; the landing is
hard-locked to light.**

| Surface | Lock | Source |
|---|---|---|
| Companion | `color-scheme: dark` + `background:#080301 !important` on both `html` and `body` | `index.html:38`, `:42-43` |
| macOS | `.preferredColorScheme(.dark)` on the root view | `ContentView.swift:51` |
| Landing | `color-scheme: light`, `background: #fff` | `style.css:10`, `:16-17` |

The only theme-reactive machinery in the entire repository:
1. Two favicon `<link media="(prefers-color-scheme: …)">` (`index.html:11-12`) — light/dark app icons.
2. `readMacIconAppearance` (`apps.js:281`), which tracks the macOS icon appearance so extracted app
   icons match the system theme. **It has no Windows equivalent and none is planned** in the
   implementation plan.

**Decision required for DeckTech, not inherited:** either (a) keep the dark lock and drop the
appearance-tracking icon path entirely on Windows, or (b) build a real semantic token layer. Option
(b) is the right long-term call but is net-new work with no upstream precedent — do not let anyone
claim it as a port. The token names in §12 are written so option (b) is possible later without
renaming anything.

---

## 9. Layering and elevation

Observed z-index / shadow ladder in the companion:

| Layer | z-index | Shadow | Source |
|---|---|---|---|
| `.bg` ember wash | 0 | none | `:61-72` |
| `main` | 1 | none | `:74-78` |
| Active screen | 1 (inactive 0) | none — `contain: paint` | `:97-114` |
| Tile glass | — | `0 0 18px` bloom + `0 8px 18px` contact | `:255` |
| `.vdots` | 30 | none, `isolation: isolate` | `:359-366` |
| `.scrim` | 50 | — | `:579` |
| `.drawer` | 55 | — | `:513` |
| `.toast` | 60 | `0 14px 40px rgba(0,0,0,.5)` | `:648-655` |
| `.login-scrim` | 90 | — | `:695` |
| `.up-banner` | 120 | `0 14px 40px rgba(0,0,0,.45)` | `:662-671` |
| Modals (`.sheet.confirm-sheet`, `.login-card`) | inside 50/90 | `0 24px 60px rgba(0,0,0,.5–.55)` | `:627`, `:709` |

Shadow tiers, deduplicated: **`0 8px 18px .45`** (resting tile) → **`0 14px 40px .45–.5`**
(floating chrome) → **`0 24px 60px .5–.55`** (modal). Three tiers. macOS adds a fourth at
`shadow(black .28, radius 22, y 12)` on the picker card (`AppPickerSheet.swift:350`) and a hover tier
at `radius 8, y 4` / resting `radius 4, y 2` on icons (`DockIcon.swift:600`).

For Windows, Microsoft's documented elevation scale (Windows 11 layering guidance, via context7:
`learn.microsoft.com/windows/apps/design/signature-experiences/layering`) is
**Windows/Dialogs 128 · Flyouts 32 · Tooltips 16 · Cards 8 · Controls 2 · Layers 1**. DeckTech's
three-tier ladder maps cleanly onto Cards(8) / Flyouts(32) / Dialogs(128) — use that mapping if a
native Windows control ever has to sit beside a DeckTech surface.

---

## 10. Drift ledger — where the three surfaces disagree

Each row: the disagreement, the reference, and the verdict.

| # | Concern | PWA | macOS | Landing | Reference | Verdict |
|---|---|---|---|---|---|---|
| D1 | Accent blue | `#0a84ff` (`:24`) | `#0A63D9` (`DokkeTheme.swift:6`) | `#1633f9` (`style.css:7`) | **`#0a84ff`** (Apple systemBlue, matches the semantic set) | macOS `#0A63D9` is drift; landing `#1633f9` is an intentional marketing colour — keep, but never in product UI. |
| D2 | Canvas | `#080301` | `#292120` | `#fff` | **`#080301`** | macOS canvas is ~4× lighter. Either is defensible; they cannot both be "the canvas." Pick one for DeckTech and state it. |
| D3 | Raking angle | `160deg` tiles / `165deg` overlays | n/a (flat) | n/a | **`160deg`** for tiles, **`165deg`** for overlays | Not drift — a deliberate 5° distinction between content and chrome. Document it so no one "fixes" it. |
| D4 | Tile radius ratio | 0.29 of width | 0.35 (28/80) | n/a | macOS for desktop, PWA for phone | Real drift. Resolve explicitly. |
| D5 | Icon radius ratio | 0.19 of width | 0.29 (20/68) | n/a | same | Real drift. |
| D6 | Icon/card size ratio | 0.84 | 0.85 (68/80) | n/a | either | Agrees. Lock at **0.85**. |
| D7 | Display typeface | Bricolage Grotesque (2 elements) | none | none (Inter declared, never loaded) | **Bricolage Grotesque** | The brand face exists on one surface only. A DeckTech identity must either adopt it across all three or drop it. |
| D8 | Grid | 2×4 portrait / 4×2 landscape | 4×2 fixed | n/a | **4×2** for desktop | PRD §7 binds the host to 4×2. |
| D9 | Page dots | 6px dot, active `14×6` pill, white `.35`/`#fff` (`:345-357`) | 7pt circle, white `.22`/`.92`, spacing 7, no pill (`DockGridView.swift:170-182`) | n/a | **macOS** for desktop | Real drift. Windows must match macOS (circles, no elongation). |
| D10 | Blur strength | 18–24px, saturate 130–150% | one `.ultraThinMaterial` | 17px, no saturate | **PWA** | Landing's missing `saturate()` makes its nav read greyer. Minor, fixable. |
| D11 | Reduced motion | partial | ignored | over-broad | none | All three are wrong differently. Net-new work. |
| D12 | Light/dark | dark lock | dark lock | light lock | — | No system exists. See §8. |
| D13 | Dead tokens | `--glass`, `--edge` declared (`:28-29`), referenced zero times | — | — | — | Delete or wire up. They read as spec and are not. |

---

## 11. Windows 11 — per-treatment parity

API facts below were retrieved via context7 from `learn.microsoft.com` and `electronjs.org` on
2026-09-17, not recalled.

### 11.1 The Mica trap — recommend **against** it

`Mica` and `Desktop Acrylic` are *system backdrops*: they sample **the user's desktop wallpaper**
and tint it. Electron exposes them as `win.setBackgroundMaterial('mica' | 'acrylic' | 'tabbed' |
'auto' | 'none')`, **Windows 11 22H2 and up** (electronjs.org/docs/latest/api/base-window). WinUI 3
exposes the same via `MicaController` / `DesktopAcrylicController` with a `MicaController.IsSupported()`
guard (learn.microsoft.com/windows/apps/develop/ui/system-backdrops).

Applying Mica to the DeckTech main window would **delete the product's identity**: the warm ember
canvas (`radial-gradient(130% 65% at 50% -10%, rgba(232,111,39,.46), …)` over `#241106 → #150804 →
#080301`, `index.html:61-72`) would be replaced by whatever wallpaper the user happens to have.
Mica is the native-feeling tool and the wrong tool here.

**Recommendation: `backgroundMaterial: 'none'`, opaque `backgroundColor: '#080301'`, and paint the
ember canvas in CSS exactly as the companion does.** Offer Mica only as an opt-in "Match Windows
theme" setting, never as the default.

### 11.2 Treatment-by-treatment

| # | Treatment | macOS/PWA mechanism | Windows equivalent | Honest delta |
|---|---|---|---|---|
| W1 | Tile glass (`.aglass`) | CSS gradients + border + 3 shadows, **no blur** | Identical CSS in Chromium | **Zero.** Byte-for-byte. Counted, not estimated: this recipe paints **every tile on every screen**, against **4** blur-dependent surfaces total (all of them transient overlays). |
| W2 | Ember canvas (`.bg`) | CSS radial + linear gradients | Identical CSS | **Zero.** Do **not** substitute Mica (§11.1). |
| W3 | Modal blur (`.confirm-sheet` 24/145%, `.confirm-scrim` 18/130%, `.login-scrim` 20/150%, `.up-banner` 18/150%) | `backdrop-filter: blur() saturate()` over **in-app content** | Same property, Chromium/WebView2 | **Zero.** These never blurred the desktop on macOS either. |
| W4 | macOS `.ultraThinMaterial` on 22×22 hover chip (`DockIcon.swift:213`) | AppKit vibrancy over app content | `backdrop-filter: blur(20px) saturate(150%)` + `rgba(255,255,255,.10)` | **Negligible.** 22×22 points. No one will perceive the difference in noise/exclusion-blend. |
| W5 | macOS-26 `glassEffect(.regular)` on sidebar & page card | Liquid Glass (specular, refraction, motion-reactive) | Not reproducible — no Windows API and no CSS offers refraction | **N/A — don't try.** These are already gated `#available(macOS 26, *)` with a mandatory flat fallback (`ContentView.swift:174-176`, `DockGridView.swift:204-206`). **The flat fallback is the Windows target**, and it is flat by design, not by limitation. |
| W6 | macOS `glassEffect(.clear.interactive())` on hover chip | Pointer-reactive glass | `backdrop-filter` + a `transform: scale()` on hover | Minor: loses pointer-tracked specular. 22×22 again. |
| W7 | Real desktop-behind blur (nothing in Dokke uses this) | — | `backgroundMaterial: 'acrylic'` | Not needed. Listed only to close the question: it exists, and DeckTech should not use it. |
| W8 | Rounded window corners | macOS system | `DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE /* =33 */, DWMWCP_ROUND /* =2 */)`; in Electron, the `roundedCorners` BrowserWindow option (default `true`, supported on all platforms as of Electron 43) | **Zero on Win11, but not automatic — see below.** |
| W9 | Window chrome / traffic lights | Manual: `titlebarAppearsTransparent`, `titleVisibility .hidden`, `.fullSizeContentView` (`DokkeApp.swift:20-24`), and a header/sidebar layout driven by `trafficLightsClearance` + `trafficLightsMidY` (`ContentView.swift:60-77`, `:120-127`) | `titleBarStyle: 'hidden'` + `titleBarOverlay: true` (electronjs.org/docs/latest/tutorial/custom-title-bar) | **This is the real gap.** See §11.3. |

### 11.3 The genuine structural gap: caption-area geometry

macOS reserves clearance on the **left** for traffic lights and lays the entire header out around it:
the header begins with `Color.clear.frame(width: isSidebarVisible ? 208 : trafficLightsClearance)`
(`ContentView.swift:62-64`) and is vertically centred with `.offset(y: trafficLightsMidY -
headerHeight/2)` (`:76`). The sidebar repeats the same clearance at `:120-127`.

On Windows the caption buttons are system-drawn and sit on the **right**. `titleBarOverlay: true`
gives back a draggable region but inverts the reserved side. There is no mechanical port.

PRD §7 (`docs/plans/2026-08-18-dokke-windows-host-prd.md:94-96`) permits *"ícones do sistema"* as an
allowed difference but forbids redesigning the composition. **Flag this as an open decision, not a
solved one.** Two candidate resolutions:
- **(A)** Mirror: sidebar stays left, title left-aligned at the sidebar's leading edge, caption
  buttons right. Sidebar's 8pt inset (`ContentView.swift:181-184`) stays; header's left clearance
  becomes 0 and a right clearance of ~138px (3 × 46px caption buttons) is added.
- **(B)** Custom-draw caption buttons Windows-style (`frame: false` + `-webkit-app-region: drag`),
  keeping full control. Costs accessibility, snap-layouts on hover, and high-contrast correctness.

Recommend **(A)**. It preserves structure, hierarchy and density (PRD §6.1) while honouring platform
convention, and it keeps native snap layouts.

**W8 in full.** Corner rounding on Windows 11 is a DWM *attribute an app sets*, not an unconditional
system behaviour: `DWMWA_WINDOW_CORNER_PREFERENCE` (value 33) accepts `DWMWCP_DEFAULT 0`,
`DWMWCP_DONOTROUND 1`, `DWMWCP_ROUND 2`, `DWMWCP_ROUNDSMALL 3`
(learn.microsoft.com/windows/apps/desktop/modernize/ui/apply-rounded-corners). The attribute exists
precisely because apps opt in or out. Electron's own docs are explicit that for frameless windows
*"rounded corners are supported by default but depend on OS version and desktop environment
support"* (electronjs.org/docs/latest/api/base-window → Frameless Window Settings), and Electron 43
made `roundedCorners` a cross-platform option defaulting to `true`
(electronjs.org/docs/latest/breaking-changes).

Two follow-ons the implementer must handle, neither of which is automatic:
- On Win10 there is no corner preference at all — corners are square. Either accept it or gate
  DeckTech at Win11 (which the 22H2 `backgroundMaterial` floor would anyway suggest, if Mica were
  used — it isn't, per §11.1, so Win10 support stays viable and square corners are the honest delta).
- `thickFrame: false` on Windows removes the standard frame **and its shadow and animations, and
  disables edge-resize** (same Electron page). Do not set it; keep `thickFrame` default so the window
  keeps its drop shadow and resize handles under `titleBarStyle: 'hidden'`.

### 11.4 Two constraints implementers will hit

1. **Electron transparency kills system blur.** From the Electron docs (custom-window-styles →
   Transparent windows → Limitations): transparent windows *"do not support system-level blur effects
   for content behind the window"*, are generally not resizable, cannot be clicked through, and lose
   transparency while DevTools is open. So `transparent: true` and `backgroundMaterial` are mutually
   defeating. Since §11.1 already rejects Mica, use an **opaque window** and get resizability,
   shadows and correct sub-pixel antialiasing for free.
2. **WebView2 alpha is binary.** If DeckTech is ever built on WebView2 instead of Electron,
   `ICoreWebView2Controller2::put_DefaultBackgroundColor` accepts **only alpha 0 or 255** — any other
   value returns `E_INVALIDARG`. Transparent (alpha 0) makes the host's content the background;
   semi-transparent is impossible. Set it via the `WEBVIEW2_DEFAULT_BACKGROUND_COLOR` environment
   variable rather than the API, because the API path still permits a white flash before it takes
   effect. For an opaque `#080301` window that is `0xFF080301`.

### 11.5 Font parity

Inter must actually be **bundled** (self-hosted `@font-face`, `font-display: swap`), not linked from
Google Fonts and not left to fall through. Bricolage Grotesque likewise, if the display face is kept.
Weights required: Inter 400/500/600/700 (`index.html:18`); the landing additionally wants 650/750,
which are **variable-font weights** — a static Inter cannot serve them and `font-synthesis: none`
forbids faking them. Either ship Inter Variable or round the landing to 600/700.

---

## 12. Tokens DeckTech should standardise on

Names are written so a future light theme can be added without renaming anything.

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

  /* radii — proportional first */
  --dt-r-tile:        0.29;    /* × tile width  — index.html:164 */
  --dt-r-tile-icon:   0.19;    /* × tile width  — index.html:166 */
  --dt-r-icon-scale:  0.84;    /* × tile width  — index.html:165 */
  --dt-r-card:        40px;    /* DockGridView.swift:202 */
  --dt-r-tile-mac:    28px;    /* DockIcon.swift:477 */
  --dt-r-sidebar:     18px;    /* ContentView.swift:170 */
  --dt-r-modal:       28px;    /* index.html:625 */
  --dt-r-sheet:       30px;    /* index.html:594 */
  --dt-r-auth:        32px;    /* index.html:706 */
  --dt-r-control:     16px;    /* index.html:615 */
  --dt-r-row:         6px;     /* ContentView.swift:148 */

  /* spacing — 2px base */
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

---

## 13. Review rubric — pass/fail

An implementation **fails** if any clause below is true. Each is mechanically checkable.

### Colour
- **F-01** Canvas is not `#080301` (companion) or `#292120` (desktop host), or is a neutral/cool grey.
- **F-02** The ember wash is absent, or is not two radials (`50% -10%` at 46%, `85% 45%` at 28%) over a
  three-stop vertical `#241106 / #150804 / #080301`.
- **F-03** Tile border is not a *warm orange* at ~40% alpha. A white or grey border is a fail.
- **F-04** Accent blue is not `#0a84ff` in companion UI. `#1633f9` in product UI is a fail.
- **F-05** Any semantic colour deviates from the Apple dark-system set (`#30d158 #ffd60a #ff453a`).

### Glass
- **F-06** `.aglass` (or its port) uses `backdrop-filter`. The tile is **painted**, not blurred.
- **F-07** The tile lacks its top inset highlight (`inset 0 1.5px 0 rgba(255,255,255,.35)`).
- **F-08** The gradient angle is not 160° on content surfaces / 165° on chrome surfaces (±2°).
- **F-09** Any of the four blur surfaces drops `saturate()` or uses a radius outside its spec
  (scrim 18/130%, modal 24/145%, banner 18/150%, login-scrim 20/150%).
- **F-10** A modal or chrome surface uses the **warm** near-black instead of the cool
  (`rgba(2,4,10)` / `rgba(16,17,26)` / `rgba(24,26,38)` / `rgba(28,34,54)`).
- **F-11** **Mica or Acrylic is applied to the main window by default.** The ember canvas must be
  painted, not sampled from wallpaper.
- **F-12** The window is created with `transparent: true` (defeats system blur, shadows and resize —
  and is unnecessary once F-11 holds).

### Geometry
- **F-13** Companion tile radius is a fixed px value instead of `calc(100cqi * 0.29)` — it must scale
  with the tile.
- **F-14** Desktop page card radius ≠ 40, or is not a continuous/squircle curve.
- **F-15** Desktop icon card ≠ 80×80 with radius 28 continuous; icon ≠ 68×68 with radius 20; icon
  padded ≠ 6pt inside the card.
- **F-16** Desktop grid is not 4 columns × 2 rows, `tileSpacing` ≠ 22, `pageHeight` ≠ 288, page card
  padding ≠ 32 h / 29 v.
- **F-17** Lateral peek is absent, or page width falls outside `[450, 458]`, or `carouselGap` ≠ 24.
- **F-18** Page dots are not 7pt **circles** at white `.92` (active) / `.22` (inactive) with spacing 7.
  Elongated pill dots are the *phone* treatment and are a fail on desktop.
- **F-19** Sidebar ≠ 208pt wide, or lacks its 18-radius 1px `white .14` stroked outline, or the
  outline is filled with anything on the non-macOS-26 path.
- **F-20** Sidebar row height ≠ 28, radius ≠ 6, selected fill ≠ `#0A63D9`, hover fill ≠ `white .08`,
  unselected label ≠ `white .58`.
- **F-21** Tile label is not 12pt semibold in an 88pt-wide single-line frame with tail truncation.

### Type
- **F-22** Inter is loaded from a remote CDN rather than bundled, or fails to load at all.
- **F-23** `font-synthesis: none` is set alongside weights (650/750) that the loaded face cannot serve.
- **F-24** Display text uses tracking looser than `-.01em` or tighter than `-.02em` in product UI.
- **F-25** The PIN field is not 26px/700 with `letter-spacing: 12px` and `font-variant-numeric: tabular-nums`.
- **F-26** Desktop PIN digits are not 42pt bold monospaced in 64×76 boxes at radius 16.

### Motion
- **F-27** Any product transition uses an easing other than `cubic-bezier(.22,.61,.36,1)`
  (UI) or `cubic-bezier(.22,1,.36,1)` (settle/snap). Linear, `ease`, or a third custom curve is a fail.
- **F-28** Page snap duration ≠ 250ms, or the snap is a CSS transition rather than the solved-Bézier
  rAF driver (visually detectable: a CSS transition will not match the Android WebView).
- **F-29** Any gesture threshold deviates: `AXIS_RATIO 1.2`, `VEL_INST 0.3`, `VEL_AVG 0.45`,
  `FLICK_MIN 16`, `RUBBER 28`, `HV_FLICK 0.32`, `H_FLICK_MIN 14`, `HPAGE_RATIO 0.18`, `COOLDOWN_MS 80`.
- **F-30** Tile press is not the three-stop `appPress` (`1 → .95 @18% → .975 @48% → 1`) over 300ms.
- **F-31** Hover on a desktop icon does not apply *all four* of: `scale 1.08`, `blur 4`,
  `shadow radius 8 y 4`, spring `response .25 dampingFraction .7`.
- **F-32** `prefers-reduced-motion` / `accessibilityReduceMotion` does not disable jiggle, hover
  scale/blur **and** page transitions. (All three upstream surfaces fail this; DeckTech must not.)

### Structure (PRD §7, `docs/plans/2026-08-18-dokke-windows-host-prd.md:78-96`)
- **F-33** Sidebar does not contain exactly **Apps/Slots** and **Conectar**.
- **F-34** Connect screen lacks any of: PIN (4 digits), LAN URL, QR code, Copy URL, Open URL,
  online/offline status dot (9×9), device count, PIN regeneration with a destructive confirmation.
- **F-35** App picker is not a fixed 480×620 sheet over a `black .48` scrim, with search, per-app
  icon, an "Adicionado" state and an "Adicionar" action.
- **F-36** There is no **explicit** reorder mode (a toggle, not drag-always-on).
- **F-37** Loading, empty, offline, error and success states are not all persistently represented.
  A transient toast does not satisfy "offline" or "loading".
- **F-38** The header reserves **left** clearance for traffic lights that do not exist on Windows
  (i.e. `trafficLightsClearance` was ported as a literal), or the app title is not left-aligned at
  the sidebar's leading edge, or less than ~138px (3 × 46px caption buttons) of right clearance is
  reserved. This is the mechanical form of §11.3 resolution (A).
- **F-39** `roundedCorners` is explicitly disabled, or `thickFrame: false` is set (which silently
  removes the window's drop shadow and edge-resize).

### Hygiene
- **F-40** Dead tokens `--glass` / `--edge` are carried forward unreferenced.
- **F-41** `sw.js` `CACHE` and `index.html`'s `?rev=` are still two independently edited copies of the
  same version string. (Verified today: `public/sw.js:1` = `"dokke-v24"`, `public/index.html:3109` =
  `"/sw.js?rev=dokke-v24"`. Two literals, no enforcement they move together.)

### Process gates (repo-state, not implementation — run once per PR, not per screen)
These two are **not** mechanically checkable against a running build. They are listed separately so a
reviewer working the rubric above does not hit an unrunnable clause.

- **G-01** No test asserts the two literal easing curve strings. `test/docs-hero-motion.test.mjs`
  asserts a bare `transition: transform` and nothing about the Bézier (verified, §7.1); the product
  curves are untested entirely. Until such a test exists, **F-27 is unenforceable in CI**.
- **G-02** §14's four still-open questions have no recorded decision. Each blocks a different surface;
  shipping without answering them means the answer gets made implicitly by whoever writes the code.

---

## 14. Decisions and open questions

### Decided here (this document owns the design language; these are not open)

- **DEC-01 — Canvas.** The Windows host shell uses **`#292120`** (`DokkeTheme.canvas`); the companion
  it serves keeps **`#080301`**. This is not a compromise: §2 already assigns macOS as the structural
  reference for the desktop host and the companion as the colour reference for the phone client, and
  the two clients are never on screen together. D2 is closed. Both values stay in §12 as
  `--dt-canvas-mac` and `--dt-canvas`; the ember wash overlays whichever is active, unchanged.
- **DEC-02 — Radius ratios.** Desktop host uses the **macOS** values (card 28/80 = 0.35, icon
  20/68 = 0.29); the companion keeps **0.29 / 0.19** proportional. §5.1 already states this; D4 and
  D5 are closed. The one value both must share is the icon/card **size** ratio, locked at **0.85**
  (D6), because that is what makes a tile read as the same object on both clients.

### Still open — genuine product calls, not design-language calls

1. **Brand typeface.** Adopt Bricolage Grotesque across all three surfaces, or drop it and go
   system-only like the macOS app? (D7)
2. **Light theme.** Build one, or formally declare DeckTech dark-only and delete the icon-appearance
   path on Windows? (§8)
3. **Caption geometry.** Mirror (A) or custom-draw (B)? (§11.3) — recommendation is (A); it needs an
   owner's signature because PRD §7 constrains it.
4. **Mica opt-in.** Ship a "Match Windows theme" setting, or refuse it outright? (§11.1) — the
   default is settled (`'none'`); only the opt-in toggle is open.

---

## 15. Sources

**Read directly in this session:**
`public/index.html:1-760, 1456, 2196-2223, 2480-2760, 3030-3090` ·
`mac/Sources/DokkeTheme.swift` (all) · `mac/Sources/DokkeApp.swift` (all) ·
`mac/Sources/ContentView.swift:1-200, 320-585` · `mac/Sources/DockGridView.swift:1-270` ·
`mac/Sources/DockIcon.swift:150-660` · `mac/Sources/AppPickerSheet.swift` (grepped, all visual values) ·
`docs/src/style.css:1-864` · `docs/plans/2026-08-18-dokke-windows-host-prd.md:64-132` ·
`test/docs-hero-motion.test.mjs` (all 47 lines) · `public/sw.js:1-5` · `apps.js:281`

**Claims from sibling research docs that were re-verified here rather than passed through:**
`sw.js`/`?rev=` duplication (**confirmed**, both `dokke-v24`); `readMacIconAppearance` at
`apps.js:281` (**confirmed**); macOS page-dot spec (**confirmed**, `DockGridView.swift:168-182`);
landing ships no `@font-face` (**confirmed** against the deployed bundle);
`test/docs-hero-motion.test.mjs` asserts the motion curve (**refuted** — see §7.1).

**Fetched live 2026-09-17:** `https://dokke.vercel.app/` (HTML),
`/assets/index-6B9cYvRo.js` (29 133 B), `/assets/style-DbfRKu8V.css` (20 563 B).
Confirmed: production tokens are byte-identical to `docs/src/style.css`; **no `@font-face` in the
shipped bundle**; only one `backdrop-filter` (`blur(17px)`, `.nav-shell`).

**Context7 (`learn.microsoft.com`, `electronjs.org`), 2026-09-17:**
system backdrops (`MicaController` / `DesktopAcrylicController` / `MicaKind.BaseAlt`);
Windows 11 layering elevation scale (128/32/16/8/2/1);
acrylic composition (background → blur → exclusion blend → tint → noise) and `AcrylicBrush`
`TintOpacity` / `TintLuminosityOpacity`; in-app acrylic blurs only in-app content;
Electron `win.setBackgroundMaterial` (Win11 22H2+), `titleBarStyle: 'hidden'` + `titleBarOverlay`,
transparent-window limitations; WebView2 `put_DefaultBackgroundColor` binary-alpha constraint and
the `WEBVIEW2_DEFAULT_BACKGROUND_COLOR` environment variable.
