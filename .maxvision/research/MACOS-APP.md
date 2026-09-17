# MACOS-APP — Surface Analysis (mac/Sources/*)

Scope: `mac/Sources/*.swift` (4023 lines across 11 files), `mac/Info.plist`, `mac/Package.swift`,
`mac/IconHelper/main.swift`, `mac/README.md`. This is the **visual contract source** for the
Windows host (per PRD §7). Every claim below is traced to `path:line`. Swift-tools 5.9,
`platforms: [.macOS(.v14)]` ([Package.swift:6](mac/Package.swift)), so every `#available(macOS 26, *)`
branch has a **defined, mandatory fallback for macOS 14–25** — that non-Liquid-Glass fallback is
the one Windows should target, not the Tahoe glass path. Stated once here so it doesn't need
repeating per widget below.

---

## 1. App shell and window lifecycle

- Entry point: `@main struct DokkeApp: App` ([DokkeApp.swift:76-108](mac/Sources/DokkeApp.swift)).
  Two scenes:
  - `Window("Dokke", id: "main")` wrapping `ContentView`, injecting four `@StateObject`
    environment objects: `DockStore`, `ServerManager`, `DokkeUpdateManager`, `LanguageStore`
    ([DokkeApp.swift:78-92](mac/Sources/DokkeApp.swift)).
  - `MenuBarExtra` showing `MenuBarView` with a hand-drawn glyph, see §7.
- Window sizing: `.frame(minWidth: 840, idealWidth: 980, minHeight: 540, idealHeight: 628)`,
  `.windowStyle(.hiddenTitleBar)`, `.windowResizability(.contentMinSize)`,
  `.defaultSize(width: 980, height: 628)` ([DokkeApp.swift:91-95](mac/Sources/DokkeApp.swift)).
- `WindowStyleConfigurator` (an `NSViewRepresentable`) sets, on mount:
  `titlebarAppearsTransparent = true`, `titleVisibility = .hidden`,
  `titlebarSeparatorStyle = .none`, `styleMask.insert(.fullSizeContentView)`
  ([DokkeApp.swift:4-25](mac/Sources/DokkeApp.swift)). This is what lets SwiftUI content draw
  under the traffic lights.
- App lifetime is tied to the menu-bar extra, not the window: closing the window does not quit
  (standard macOS `Window` scene behavior); quitting happens only via the menu-bar "Sair/Quit"
  item, which explicitly calls `server.stop()` before `NSApplication.shared.terminate(nil)`
  ([ContentView.swift:687-692](mac/Sources/ContentView.swift)).
- No explicit `NSApplicationDelegate` / dock-icon-hide logic exists in the read files — the app
  keeps a normal Dock presence plus a menu-bar extra (LSUIElement is not set in
  [Info.plist](mac/Info.plist)).

## 2. Node server supervision (`ServerManager.swift`)

`ServerManager` is an `ObservableObject` with `@Published var isRunning`, `@Published var
lastError`, private `Process?`, and a 3-state `ServerOwnership` enum (`none` / `owned` /
`adopted`) ([ServerManager.swift:6-27](mac/Sources/ServerManager.swift)).

- **Discovery**: `locateServer()` checks, in order: `DOKKE_SERVER` env var, `dokke.serverPath`
  UserDefaults key, `Bundle.main.resourceURL/Dokke/server.js`, `./server.js`, `../server.js`
  ([ServerManager.swift:68-82](mac/Sources/ServerManager.swift)). `locateNode()` checks a bundled
  `Contents/Resources/node-bin/node` first, then `DOKKE_NODE` env, `dokke.nodePath` UserDefaults,
  then `/opt/homebrew/bin/node`, `/usr/local/bin/node`, `/opt/local/bin/node`, `/usr/bin/node`
  ([ServerManager.swift:86-105](mac/Sources/ServerManager.swift)). Each Node candidate is
  validated by **actually spawning `node --version`** synchronously
  (`canRunNode`, [ServerManager.swift:129-143](mac/Sources/ServerManager.swift)) — up to 7
  blocking subprocess spawns from `init()` on the main thread/actor before the first UI frame
  (see §9, optimization).
- **Startup sequencing** (`start()`, [ServerManager.swift:173-217](mac/Sources/ServerManager.swift)):
  runs `preflightExistingServer()` (an async `GET /health` then `GET /api/version` against
  `http://127.0.0.1:3000`) before ever spawning a process. Three outcomes:
  - `.adopted(version)` — a compatible Dokke is already listening; the manager marks itself
    `.adopted` and `isRunning = true` without owning a `Process`
    ([ServerManager.swift:189-196](mac/Sources/ServerManager.swift)).
  - `.conflict(message)` — something answers on :3000 that is not a compatible Dokke (wrong
    `service` string, wrong/incompatible version, malformed body, or a non-ECONNREFUSED
    network error) → refuses to touch it, surfaces a localized error
    ([ServerManager.swift:197-204, 219-253](mac/Sources/ServerManager.swift)).
  - `.available` — `ECONNREFUSED`/`NSURLErrorCannotConnectToHost` on loopback is the **only**
    condition treated as "port free" ([ServerManager.swift:282-294](mac/Sources/ServerManager.swift));
    everything else stays a conflict. Then `launchOwnedServer` spawns `node server.js` with
    stdout/stderr piped to `/tmp/dokke-server.log` (capped at 1MB, truncated on overflow —
    [ServerManager.swift:107-120, 296-336](mac/Sources/ServerManager.swift)).
- **Version compatibility gate**: adoption requires an **exact** normalized `vMAJOR.MINOR.PATCH`
  match between the running server's `/api/version` `local.tag` and the bundle's
  `CFBundleShortVersionString` (fallback constant `"0.2.8"`,
  [ServerManager.swift:255-280, 34](mac/Sources/ServerManager.swift)) — not semver-compatible,
  exact string equality after normalization. **This is a wire contract, not styling**: renaming
  the bundle version scheme or the `service` string (`"Dokke"`, checked at
  [ServerManager.swift:232](mac/Sources/ServerManager.swift)) breaks adoption against any
  already-running server from the other platform/version.
- **Readiness confirmation**: after spawning, polls `preflightExistingServer()` up to 20× at
  200ms ([ServerManager.swift:38-39, 358-376](mac/Sources/ServerManager.swift)) waiting for the
  bind to succeed before flipping `isRunning = true`.
- **Crash recovery**: `terminationHandler` on the owned `Process` routes to `failOwnedAttempt` →
  `handleOwnedFailure`, which increments `restartFailures` and reschedules via
  `scheduleRestart()` after a fixed 3s delay, giving up after 5 consecutive failures
  ([ServerManager.swift:304-419](mac/Sources/ServerManager.swift)).
- **Shutdown**: `stop()` sets `intentionalStop = true` (suppressing any in-flight restart),
  cancels pending restart work, and only calls `proc.terminate()` if this instance **owns** the
  process — an adopted server is never killed ([ServerManager.swift:383-397](mac/Sources/ServerManager.swift)).
  Registered against `NSApplication.willTerminateNotification`
  ([ServerManager.swift:51-57](mac/Sources/ServerManager.swift)) and `deinit`
  ([ServerManager.swift:421-423](mac/Sources/ServerManager.swift)).
- **LAN IP**: `lanIPv4()` walks `getifaddrs`, filters to `en*` interfaces excluding `awdl` and
  `169.254.*` link-local addresses ([ServerManager.swift:146-171](mac/Sources/ServerManager.swift)) —
  used only by the Connect tab's QR/URL, not by the server process itself.

## 3. State store (`DockStore.swift`)

`@MainActor final class DockStore: ObservableObject`, 675 lines, is the single source of truth
for dock contents, connection status, and the app inventory.

- **Dual representation of pinned items**: `pieces: [DockPiece]` is the typed source of truth;
  `pinned: [String]` is a **legacy string-array projection** kept in sync by hand at 8+ call
  sites (`applyConfig`, `pin`, `unpin`, `reorderPinned`, `addWebsite` success/`removePiece`
  paths — [DockStore.swift:187-198, 396-398, 414, 424-425, 434-435, 447-448, 463-464, 472-473,
  481-482](mac/Sources/DockStore.swift)). See §9 for the simplification this implies.
- **Polling**: a 2.5s repeating `Timer` calls `pingStatus()` (`GET /api/status`, fallback
  `GET /health`) for `online`, `devices` count, and embedded `config`
  ([DockStore.swift:75-77, 248-326](mac/Sources/DockStore.swift)). A separate `debounceRefresh()`
  (600ms) guards `baseURL` edits from refreshing on every keystroke
  ([DockStore.swift:14-21, 50-57](mac/Sources/DockStore.swift)) — though no UI in the read files
  actually exposes a `baseURL` text field to type into.
- **Optimistic writes**: `pin`, `unpin`, `reorderPinned`, `addWebsite`, `removePiece` all mutate
  local `pieces` immediately, fire the network call, and **roll back to the pre-mutation snapshot**
  on any non-200 / non-`ok:true` response ([DockStore.swift:393-439, 441-476](mac/Sources/DockStore.swift)).
  A 409 with `code: "PINNED_LIMIT_REACHED"` is handled specially, re-applying server-reported
  limits via `applyPinnedLimits` ([DockStore.swift:169-175, 412-419](mac/Sources/DockStore.swift)).
- **Slot math is hardcoded**: `firstAvailablePosition` searches `0..<40`
  ([DockStore.swift:164-167](mac/Sources/DockStore.swift)); `pin(_:at:)` and `addWebsite` clamp
  target position to `0...39` ([DockStore.swift:390, 531](mac/Sources/DockStore.swift)) — these
  literals do **not** read `maxPinnedPieces`/`maxPinnedApps` (which the server *does* report and
  the store *does* store, [DockStore.swift:38-39, 169-175](mac/Sources/DockStore.swift)). All
  limit-reached user strings are also hardcoded to "Limite de 5 páginas" /
  "Limit of 5 pages" regardless of the actual server-reported limit
  ([LanguageStore.swift:77-78, 98-99](mac/Sources/LanguageStore.swift)).
- **`filteredInstalled` and `@Published var filter` are dead code**: declared at
  [DockStore.swift:32, 139-150](mac/Sources/DockStore.swift) but grepped with zero call sites —
  `AppPickerSheet` implements its own local `@State private var search` and its own filtering
  ([AppPickerSheet.swift:9, 32-42](mac/Sources/AppPickerSheet.swift)) instead of using the
  store's. Do not port `filteredInstalled`'s pinned-first sort semantics as if they were live.
- **Icon caching**: `nativeIcon(for:)` prefers AppKit's `NSWorkspace.icon(forFile:)` resolved
  through the real (symlink-resolved) app path — with a macOS-26-only branch that forces the
  **light/Aqua appearance** when fetching the icon, specifically because Tahoe's dark-appearance
  icon variants render "quase pretos" (near-black) against the app's dark canvas
  ([DockStore.swift:629-659](mac/Sources/DockStore.swift), comment at :640-643). Falls back to a
  server-fetched PNG via `/api/apps/{name}/icon` cached in `iconCache: [String: Image]`
  ([DockStore.swift:661-674](mac/Sources/DockStore.swift)). Cache is invalidated wholesale on
  `NSWorkspaceIconAppearanceConfigurationDidChangeNotification` and on
  `NSApplication.effectiveAppearance` KVO changes ([DockStore.swift:88-119](mac/Sources/DockStore.swift)).
- Legacy artifact: the `baseURL` UserDefaults key is `"j5.baseURL"`
  ([DockStore.swift:14](mac/Sources/DockStore.swift)) — a pre-rename ("j5") string that predates
  "Dokke" in the persisted-defaults namespace; flag for the DeckTech rebrand (§ rebrand points).

## 4. Update manager (`DokkeUpdateManager.swift`)

- Hits `https://api.github.com/repos/felipenalves/Dokke/releases/latest` — a **hardcoded upstream
  repo** ([DokkeUpdateManager.swift:33](mac/Sources/DokkeUpdateManager.swift)). Unless
  repointed, a DeckTech build self-updates into the **upstream Dokke** project, silently replacing
  itself. This is the single highest-priority rebrand fix in the whole surface.
- Looks for an asset literally named `Dokke-macOS.dmg` with a GitHub-computed `digest` field
  (`sha256:...`) ([DokkeUpdateManager.swift:84-96](mac/Sources/DokkeUpdateManager.swift)).
- **Integrity, not authenticity**: the SHA-256 used to verify the download
  ([DokkeUpdateManager.swift:170-177](mac/Sources/DokkeUpdateManager.swift)) comes from the same
  unauthenticated GitHub API response as the download URL itself — it protects against transport
  corruption, not against a compromised/malicious release. There is no code-signature or
  notarization check on the downloaded `.app` before it's copied into place.
- Install flow: download → move into a temp workspace → verify checksum → mount DMG (`hdiutil
  attach -nobrowse -readonly`) → copy `Dokke.app` out → detach → hand off to a generated shell
  script (`install-update.sh`, 0700 perms) that waits for the current PID to exit, then does
  `rm -rf "$TARGET.new"; ditto "$STAGED" "$TARGET.new"; rm -rf "$TARGET"; mv ...; open "$TARGET"`
  ([DokkeUpdateManager.swift:103-238](mac/Sources/DokkeUpdateManager.swift)). The `rm -rf` of the
  live install directory happens **before** confirming the replacement succeeded — a failure
  mid-script leaves no app installed. No rollback path exists.
- Version comparison is a naive dotted-integer compare, not semver
  ([DokkeUpdateManager.swift:157-168](mac/Sources/DokkeUpdateManager.swift)).

## 5. Language store / i18n (`LanguageStore.swift`)

- Two languages: `pt-BR` (default if `Locale.preferredLanguages.first` starts with "pt") and
  `en` ([LanguageStore.swift:4-33](mac/Sources/LanguageStore.swift)). Persisted to
  `UserDefaults` key `"dokke_language"`.
- `I18n.text(key:language:)` is a flat dictionary lookup with `{token}` interpolation
  ([LanguageStore.swift:45-55](mac/Sources/LanguageStore.swift)) — two large parallel string
  tables (~65 keys each, [LanguageStore.swift:65-105](mac/Sources/LanguageStore.swift)), no
  pluralization system beyond a manually-passed `suffix` token
  (`"sync.sent"`, [DockStore.swift:610-612](mac/Sources/DockStore.swift)). Missing keys fall back
  to returning the raw key string, not a placeholder.
- `I18n.currentLanguage()` is a **static, UserDefaults-reading duplicate** of
  `LanguageStore`'s own resolution logic ([LanguageStore.swift:57-63](mac/Sources/LanguageStore.swift))
  — used by non-View code (`ServerManager`, `DockStore`) that has no access to the
  `@EnvironmentObject`. Two sources of truth for the same setting, kept manually consistent only
  because both read the same UserDefaults key.

## 6. App picker (`AppPickerSheet.swift`)

- Fixed sheet size **480×620** ([AppPickerSheet.swift:164](mac/Sources/AppPickerSheet.swift)),
  background `DokkeTheme.canvas`.
- Two tabs via a segmented `Picker` bound to a `String` (`"Apps"` / `"Website Links"`),
  labels hidden ([AppPickerSheet.swift:48-56](mac/Sources/AppPickerSheet.swift)).
- **Apps tab**: header icon 42×42 with `square.grid.2x2`/`globe` glyph on
  `Color.white.opacity(0.10)` r12 plate, title, search field (164×32, r16, accent-colored 1.2pt
  stroke) — rows list is `store.installed` sorted pinned-first then alphabetical (this is a
  **duplicate, locally-defined** sort, not `DockStore.filteredInstalled` — see §3)
  ([AppPickerSheet.swift:32-152](mac/Sources/AppPickerSheet.swift)). Each row: 34×34 icon (native
  first, then `AsyncImage` from `/api/apps/{name}/icon`), name, trailing either a green
  checkmark ("Added") or an `Add` `.borderedProminent` button disabled while `store.busyName ==
  app.name` or the pin limit is reached ([AppPickerSheet.swift:353-408](mac/Sources/AppPickerSheet.swift)).
  Row background `DokkeTheme.page.opacity(0.68)`, corner radius 10, min height 50.
- **Website Links tab**: URL text field + Add button (56pt-tall bar, r11, accent 1.5pt stroke)
  ([AppPickerSheet.swift:168-191](mac/Sources/AppPickerSheet.swift)), then 9 **hardcoded
  suggestion rows**: GitHub, YouTube, WhatsApp, Pinterest, Threads, TikTok, LinkedIn, ChatGPT, and
  a third-party site `Documente → https://documenteclub.vercel.app`
  ([AppPickerSheet.swift:16-26](mac/Sources/AppPickerSheet.swift)) — flag the last one for
  rebrand/removal review, it's not a generic productivity destination. Adding a suggestion or
  typed URL opens a **name-confirmation modal** (340pt wide, r22, canvas background, white
  0.20-opacity 1px border, shadow 22pt/y12) prompting for a short display title before the POST
  fires ([AppPickerSheet.swift:266-351](mac/Sources/AppPickerSheet.swift)).
- Favicon resolution (`WebsiteFaviconLoader`/`WebsiteFaviconSource`,
  [DockIcon.swift:218-405](mac/Sources/DockIcon.swift)) is a **client-side, unauthenticated HTML
  scrape**: fetches the target page with a spoofed `User-Agent: "Mozilla/5.0 Dokke/1.0"`, regexes
  `<link rel="icon"|"shortcut"|"apple-touch-icon">` tags out of the raw HTML (skipping SVG and
  `data:` URIs), scores by declared `sizes` + a +1000 bonus for apple-touch-icon, then falls back
  through a per-domain hardcoded table (GitHub, WhatsApp, YouTube, Pinterest, LinkedIn, TikTok),
  then `/apple-touch-icon.png`, `/favicon.ico`, and finally Google's `s2/favicons?domain=…&sz=128`
  proxy ([DockIcon.swift:218-393](mac/Sources/DockIcon.swift)). This makes every website-tile
  render depend on live outbound HTTP to third-party hosts, with no caching layer visible in this
  file (only in-memory `@Published private(set) var image` per `WebsiteFaviconLoader` instance).

## 7. Appearance — forensic detail

### 7.1 Color tokens (`DokkeTheme.swift`)

Three literal `Color(red:green:blue:)` constants, sRGB, traceable to hex:

| Token | RGB (0–1) | Hex | Used for |
|---|---|---|---|
| `canvas` | 0.161, 0.129, 0.125 | `#292120` | Window/page background |
| `page` | 0.106, 0.067, 0.027 | `#1B1107` | Dock page-card fill (and 68%-opacity row backgrounds in the picker) |
| `selection` | 0.039, 0.388, 0.851 | `#0A63D9` | Selected sidebar row, "reorder mode" pill |

([DokkeTheme.swift:3-7](mac/Sources/DokkeTheme.swift))

Everything else — the About tab's card backgrounds (`.quaternary`), the 4-digit access-code
boxes (`.quaternary`), the app-picker icon-fallback plate (`.quaternary`), the search-field/URL-field
borders (`Color.accentColor`), and all `.primary`/`.secondary` text — uses **macOS semantic system
colors with no literal value in source**
([ContentView.swift:370, 422, 548](mac/Sources/ContentView.swift), [AppPickerSheet.swift:114,
189, 367](mac/Sources/AppPickerSheet.swift)). These must be sampled from a rendered screenshot in
light *and* dark contexts on the reference build (recall the app is `.preferredColorScheme(.dark)`
forced, so only the dark rendering of `.quaternary`/`.accentColor` is ever actually shown to
users) — do not invent hex values for them.

The three custom traffic-light dot colors in `customTrafficLights`
([ContentView.swift:100-114](mac/Sources/ContentView.swift)) — red `(0.96, 0.23, 0.21)`, yellow
`(0.97, 0.73, 0.11)`, green `(0.17, 0.77, 0.28)` — are **dead code**. `customTrafficLights` is
declared but never referenced in `ContentView.body`; the real window uses AppKit's native traffic
lights, repositioned (see 7.3). Do not transcribe these colors into a Windows contract as if they
render.

### 7.2 Global chrome

- `.preferredColorScheme(.dark)` is forced on the whole `ContentView`
  ([ContentView.swift:51](mac/Sources/ContentView.swift)) — the app **never** renders in light
  mode regardless of system appearance. This is silent in PRD §7.
- Root layout: `HStack(spacing: 0)` of sidebar + detail, background `DokkeTheme.canvas`,
  `.ignoresSafeArea(.container, edges: .top)` so content draws under the (hidden-title) traffic
  lights ([ContentView.swift:32-58](mac/Sources/ContentView.swift)).
- Sidebar collapse: width animates between 208 and 0 via `.frame(width:)` +
  `.clipped()` + `.opacity()`, driven by `.animation(.easeOut(duration: 0.2), value:
  isSidebarVisible)` ([ContentView.swift:36-38, 52](mac/Sources/ContentView.swift)).

### 7.3 Titlebar / traffic-light handling

- `TrafficLightsClearanceReader` is an `NSViewRepresentable` that, every layout pass and on
  window resize, reads the real `NSWindow.standardWindowButton` frames for close/miniaturize/zoom
  and **shifts them by (dx: +12, dy: -10)** from their original AppKit position
  ([ContentView.swift:207-316](mac/Sources/ContentView.swift), offsets at :290-291). It then
  publishes a `trafficLightsClearance` (≈ zoom button's max-X + 10, floor > 40) and a
  `trafficLightsMidY` (close button's vertical center) back to SwiftUI state, which the custom
  `header` view and the sidebar's top row both offset against
  ([ContentView.swift:60-80, 119-131](mac/Sources/ContentView.swift)). This is the mechanism that
  makes "Dokke" title text and the sidebar toggle button visually align with the (real, moved)
  traffic lights. **A Windows host has no equivalent native chrome to reposition** — this whole
  subsystem needs a from-scratch caption-area layout, not a port.
- `header` height is a fixed `32pt` constant ([ContentView.swift:29, 78](mac/Sources/ContentView.swift)).

### 7.4 Sidebar

- Width 208pt when visible, collapses to 0.
- Structure top→bottom: a toggle-button row (only rendered inside the sidebar when
  `!isSidebarVisible` is false — actually the in-sidebar toggle button always renders, the
  header's toggle only shows when the sidebar is hidden,
  [ContentView.swift:66-68, 126-127](mac/Sources/ContentView.swift)), then two nav rows (Slots /
  Conectar), then a `Spacer()`.
- Each row: `HStack` with SF Symbol (12pt medium, 14×14 frame) + label (13pt medium), height 28,
  horizontal padding 10, clipped to `RoundedRectangle(cornerRadius: 6)`. Selected row background
  = `DokkeTheme.selection` (#0A63D9); hovered-not-selected = `Color.white.opacity(0.08)`; neither
  = transparent ([ContentView.swift:133-192](mac/Sources/ContentView.swift)). Text color:
  selected → solid white; unselected → `white.opacity(0.58)`.
- Sidebar container: `RoundedRectangle(cornerRadius: 18)` — glass-filled on macOS 26+
  (`.glassEffect(.regular, in: .rect(cornerRadius: 18))`), **flat `Color.clear` fill (no
  background) on macOS 14–25** — plus a `strokeBorder(Color.white.opacity(0.14), lineWidth: 1)`
  applied on **both** branches ([ContentView.swift:168-181](mac/Sources/ContentView.swift)).
  Outer padding: 8pt on all four sides ([ContentView.swift:182-185](mac/Sources/ContentView.swift)).
  Note: the pre-Tahoe fallback sidebar has **no fill at all**, only the 14%-white 1px border —
  the canvas color shows through. This is the path Windows should copy.
- `sidebarChromeRadius = 20` ([ContentView.swift:30](mac/Sources/ContentView.swift)) is declared
  but never referenced — the real corner radius used everywhere in the sidebar is the literal
  `18`. Do not use 20.

### 7.5 Sidebar items

Two cases only: `.apps` (label "Slots", icon `square.grid.2x2.fill`) and `.about` (label
"Conectar", icon `info.circle`) ([ContentView.swift:6-18](mac/Sources/ContentView.swift)). **The
enum case name is `.apps` but its localized label is "Slots"**, and the second tab's enum case is
`.about` but its label is "Conectar" ("Connect") — the internal naming and the PRD's own naming
("Apps"/"Conectar") do not match the shipped strings (see §8, PRD conflict #1).

### 7.6 Header title bar

`HStack`: leading spacer sized to `trafficLightsClearance` (or the sidebar width when visible),
conditionally a sidebar-toggle button (only when the sidebar is hidden), then "Dokke" in
`.headline.weight(.semibold)`, white, left-padded 6pt, non-interactive
(`.allowsHitTesting(false)`) so window drag-to-move still works underneath
([ContentView.swift:60-80](mac/Sources/ContentView.swift)). Fixed height 32pt, vertically centered
on `trafficLightsMidY`.

### 7.7 Dock grid — carousel and pages (`DockGridView.swift`)

- **Grid is 4 columns × 2 rows = 8 slots per page** — `LazyVGrid(columns: 4 flexible,
  spacing: 22)`, `pageSize = 8` ([DockGridView.swift:14, 210-211](mac/Sources/DockGridView.swift)).
  Confirms PRD §7's "grid 4×2" claim.
- **Always exactly 5 pages**: `maxPageCount = 5`, `slotCount = pageSize * maxPageCount = 40`,
  `pageCount = ceil(40/8) = 5` regardless of how many pieces are pinned
  ([DockGridView.swift:15, 45-65](mac/Sources/DockGridView.swift)). Empty slots render as
  `.add(index)` tiles (the dashed "+" button), so **the grid has no true empty state** — with
  zero pinned items it still shows 5 full pages of add-buttons and 5 page dots. This contradicts
  PRD §7's "estados equivalentes de... vazio" requirement (see §8).
- Tile geometry constants: `tileSize = 80`, `tileSpacing = 22`, `pageHeight = 288`,
  `carouselGap = 24` (between page cards), `carouselVerticalOffset = 22`,
  `carouselPeekRatio = 0.55`, `carouselMaxPageWidth = 458`, `carouselMinPageWidth = 450`
  ([DockGridView.swift:16-23](mac/Sources/DockGridView.swift)).
- **Arithmetic self-checks** (verify a Windows port against these, don't eyeball them):
  - Page-card width lower bound: `4×80 + 3×22 = 320 + 66 = 386`... plus horizontal padding
    32×2 = 64 → `450` matches `carouselMinPageWidth` exactly
    (`appGrid` padding at [DockGridView.swift:195](mac/Sources/DockGridView.swift): `.padding(.horizontal,
    32).padding(.vertical, 29)`).
  - Page height: `2×80 (tiles) + 22 (row gap) + 2×29 (vertical pad) + ~ label row allowance =
    288` (`pageHeight` constant) — internally consistent with `iconCardSize + 24` per tile
    label allowance ([DockIcon.swift:472, 580](mac/Sources/DockIcon.swift)).
  - Page width formula: `min(458, max(450, (availableWidth - 24) / 1.55))`
    ([DockGridView.swift:162-165](mac/Sources/DockGridView.swift)) — at the app's own default
    width (980, minus sidebar 208 minus padding) the detail area is wide enough that this
    **saturates at 458 in practice**. Treat "peek lateral" as "page card is 450–458pt wide with a
    fixed 24pt gap to the next, next page visibly peeking," not as a literal 55% computation a
    Windows implementer needs to reproduce pixel-for-pixel.
- **Page card**: `RoundedRectangle(cornerRadius: 40)` filled `DokkeTheme.page` (#1B1107), glass
  effect only on macOS 26+, **flat fill only on 14–25** ([DockGridView.swift:192-208](mac/Sources/DockGridView.swift)).
- **Trailing fade mask**: the horizontal `ScrollView` is masked with a `LinearGradient` that stays
  opaque until `1 - 16/width` then fades to clear over the last 16pt — the carousel deliberately
  bleeds/clips at the right edge ([DockGridView.swift:124, 142-152](mac/Sources/DockGridView.swift)).
- **Outer content padding is asymmetric**: leading 20, top 8, bottom 18, **no trailing padding
  specified** ([DockGridView.swift:79-81](mac/Sources/DockGridView.swift)) — deliberate, so the
  fade mask handles the right edge instead of a hard padding stop.
- **Page indicators**: row of `Circle()` dots, 7×7pt, spacing 7, active = `white.opacity(0.92)`,
  inactive = `white.opacity(0.22)`, tappable to jump pages with `.easeOut(duration: 0.25)`
  ([DockGridView.swift:167-190](mac/Sources/DockGridView.swift)).
- **Scroll behavior**: `.scrollTargetBehavior(.viewAligned)` + `.scrollPosition(id: $currentPage,
  anchor: .leading)` — native paged/snap horizontal scroll, one page-card per "page"
  ([DockGridView.swift:127-141](mac/Sources/DockGridView.swift)).
- **Reorder mode**: toggled by a pill button bottom-right, "Reorganizar apps" ↔ "Concluir". While
  active: capsule background `DokkeTheme.selection` when active else `white.opacity(0.14)`, text
  13pt semibold, horizontal padding 20 / vertical 11
  ([DockGridView.swift:278-294](mac/Sources/DockGridView.swift)). A caption
  ("Arraste para mover um ícone de posição.") with a drag-handle SF Symbol appears bottom-left
  only while reordering ([DockGridView.swift:86-99](mac/Sources/DockGridView.swift)).
- **Drag-and-drop**: `onDrag`/`onDrop(of: [.text])` with a `DropDelegate` struct that computes
  optimistic `draftPositions` on `dropEntered` (swap displaced item into the dragged item's old
  slot) with a `.snappy(duration: 0.24, extraBounce: 0.02)` animation (skipped entirely when
  `accessibilityReduceMotion` is on), and persists via `PUT /api/config/pieces/order` on
  `performDrop`, reverting the draft with a `.smooth(duration: 0.2)` animation on save failure
  ([DockGridView.swift:364-411](mac/Sources/DockGridView.swift)).
- **Offline state**: `ContentUnavailableView` with `wifi.slash` glyph, title "Servidor Offline" /
  description prompting to check the Connect tab, `foregroundStyle(.white.opacity(0.85))`
  ([DockGridView.swift:313-321](mac/Sources/DockGridView.swift)) — this *is* the one real empty/error
  state in the grid (server unreachable), distinct from "zero pinned pieces" which has no distinct
  treatment (see above).

### 7.8 Dock tile (`DockIcon.swift`)

- **Card**: `iconCardSize = 80`, `cornerRadius: CGFloat = 20` is declared but **only used to clip
  the inner icon image** ([DockIcon.swift:471-473, 598](mac/Sources/DockIcon.swift)); the visible
  card shape everywhere else is `RoundedRectangle(cornerRadius: 28)` — `iconCardSurface` (fill
  `white.opacity(0.07)` + an overlay of `DokkeTheme.page.opacity(0.26)` + a 1px
  `white.opacity(0.08)` border) and every hover/remove/move overlay reuse radius 28
  ([DockIcon.swift:476-489, 506, 547](mac/Sources/DockIcon.swift)). **Use 28, not 20, for the
  tile card radius.**
- **Icon image** itself: 68×68 (`iconSize`), clipped to radius 20, inset 6pt inside the 80×80 card
  ([DockIcon.swift:471, 494-499, 596-598](mac/Sources/DockIcon.swift)).
- **Label**: below the card, 12pt semibold, 1 line, truncates tail, fixed width 88pt, centered,
  `.primary` foreground ([DockIcon.swift:572-579](mac/Sources/DockIcon.swift)). Total tile frame:
  80 wide × 104 tall (`iconCardSize + 24`).
- **Hover treatment** (`iconWithEffects`, [DockIcon.swift:593-603](mac/Sources/DockIcon.swift)):
  simultaneously applies **blur radius 4**, drop shadow opacity 0.18/radius 8/y 4 (vs 0.1/4/2 at
  rest), and **scale 1.08**, animated with `.spring(response: 0.25, dampingFraction: 0.7)`. This
  is a deliberate, distinctive treatment — blurring the icon on hover, not just scaling it.
- **Remove overlay** (shown on hover when `allowsRemoval`): full-card dark scrim
  (`black.opacity(0.10)`) + border, centered 22×22 black-64%-opacity circle with a white 10×2pt
  minus-capsule, glass-effect on macOS 26 / `.ultraThinMaterial` fallback (the **only**
  `.ultraThinMaterial` use in the whole app surface), plus a "Remover"/"Remove" 9pt semibold label
  below ([DockIcon.swift:199-216, 500-534](mac/Sources/DockIcon.swift)).
- **Move overlay** (reordering mode + hover, non-interactive): same scrim/border pattern but with
  a move-cross SF Symbol instead of minus, and "Mover"/"Move" label, `.allowsHitTesting(false)`
  ([DockIcon.swift:544-570](mac/Sources/DockIcon.swift)).
- **Jiggle**: while `isReordering`, every tile rotates ±2.2° in a repeating ease-in-out
  (0.28s + a per-tile stagger of up to 0.06s derived from `abs(seed) % 3`), with an initial launch
  delay up to 0.266s derived from `abs(seed) % 7 × 0.038`, where `seed = piece.id.hashValue`
  ([DockIcon.swift:169-197, 596](mac/Sources/DockIcon.swift)). **This jiggle does not check
  `accessibilityReduceMotion`** — the grid-level drag animations do respect it, but
  `JiggleModifier` never reads the environment key. `piece.id.hashValue` is process-unstable
  (Swift's default `Hashable` salts per process), so the jiggle phase differs run-to-run even for
  the same dock; screenshot-diffing a reordering grid must tolerate phase, not lock to it.
- **Fallback icon glyph is a display bug, not intentional style**: `fallbackIcon`
  ([DockIcon.swift:641-651](mac/Sources/DockIcon.swift)) renders the **entire app name** (not an
  initial) at `.title.bold()` inside a 68×68 tile on `white.opacity(0.14)` — for any name longer
  than ~2-3 characters this overflows/clips. Compare the *correctly*-scoped fallback in the picker
  row, which uses `String(app.name.prefix(1))` ([AppPickerSheet.swift:368](mac/Sources/AppPickerSheet.swift)).
  Do not standardize on the DockIcon behavior for Windows; use the picker's single-initial pattern.
- **Website tiles are visibly smaller than app tiles**: a 56×56 white-96%-opacity `RoundedRectangle`
  plate (r16) containing a 40×40 favicon clipped to r10 (`WebsiteFaviconView`), vs the 68×68 icon
  used for apps — both sit inside the same 80×80 outer card, so website icons read as noticeably
  more padded/smaller ([DockIcon.swift:624-639](mac/Sources/DockIcon.swift)).
- **Hover detection is custom AppKit, not SwiftUI `.onHover` alone**: `AppKitHoverTracker` +
  `DockHoverCoordinator` (a process-wide singleton) run an **always-on 30Hz `Timer`** plus a local
  event monitor (mouse move/drag/scroll/click) to recompute hover state for every registered tile
  whenever any of those tools' views is on-window, tearing the monitor/timer down only when the
  registered-view set is empty ([DockIcon.swift:93-167](mac/Sources/DockIcon.swift)). This exists
  because plain SwiftUI `.onHover` inside a `LazyVGrid`/`ScrollView` can miss hover state during
  scroll/drag; it's a real cost (constant 30Hz timer while any dock view is visible) worth flagging
  in the optimizations list.

### 7.9 Add-slot button

`RoundedRectangle(cornerRadius: 28)` 80×80, fill `white.opacity(hovered ? 0.12 : 0.05)`, border
`white.opacity(hovered ? 0.18 : 0.08)` 1px; centered `plus` glyph (18pt semibold,
`white.opacity(0.88)`) appears **only on hover**; below it a label that is either "Adicionar"/"Add"
(on hover) or a space-character placeholder (13pt height reserved) to avoid layout jump
([DockGridView.swift:324-362](mac/Sources/DockGridView.swift)).

### 7.10 About/"Conectar" tab (`AboutView`)

- Scroll view, content max-width 980 centered, top padding 40, outer padding 28,
  vertical spacing 20 between sections ([ContentView.swift:327-506](mac/Sources/ContentView.swift)).
- **Language picker**: menu-style `Picker` bound to `DokkeLanguage`, top-right of the tab
  ([ContentView.swift:330-344](mac/Sources/ContentView.swift)).
- **Title block**: "Conectar" title `.title.bold()`, description `.subheadline` `.secondary`.
- **Access code card**: `.quaternary`-filled `RoundedRectangle(cornerRadius: 16)`, padding 16,
  containing 4 digit boxes (`AccessCodeView`): each `64×76`, `42pt bold monospaced`, background
  `.quaternary`, corner radius 16, spacing 10; missing digits render as `"—"` (em dash) when
  `pinCode` is nil or short ([ContentView.swift:354-372, 528-559](mac/Sources/ContentView.swift)).
  Below: instruction caption (`.subheadline.weight(.semibold)`, `.secondary`) and a `.link`-style
  "Gerar novo código" button that opens a `.confirmationDialog`
  ([ContentView.swift:512-519](mac/Sources/ContentView.swift)).
- **Open-on-other-device card**: same `.quaternary` r16 card. Contains a **112×112 QR code**
  (`QRCodeView`, generated via `CIFilter.qrCodeGenerator()` at 8× scale, `correctionLevel: "M"`,
  rendered on a white background inside `RoundedRectangle(cornerRadius: 10)` with 10pt padding,
  `.interpolation(.none)` to keep hard module edges — [ContentView.swift:561-593](mac/Sources/ContentView.swift)),
  next to the local URL (`http://{lanIPv4}:3000`) shown in 14pt semibold monospaced (selectable,
  1-line, min-scale 0.7), with "Copiar URL"/"Copy URL" and "Abrir"/"Open" bordered buttons, and a
  caption about same-network requirement / HTTPS tunnel note for iPhone/iPad
  ([ContentView.swift:373-424](mac/Sources/ContentView.swift)). If no LAN IPv4 is found, shows
  "Sem IP de rede detectado (offline?)" instead of the QR block.
- **Status row**: 9×9 `Circle` colored green (`store.online`) or `red.opacity(0.85)`, "Servidor
  online/offline" label, device count, pinned count — all `.caption` `.secondary`
  ([ContentView.swift:425-439](mac/Sources/ContentView.swift)).
- **Updates card**: title + inline `ProgressView` while `updater.state == .checking`. When a
  release is available: orange `arrow.down.circle.fill` label with the new version tag, a
  "Mudanças"/"Changes" bordered button opening a sheet, and a "Baixar e instalar"/"Download and
  install" prominent button (disabled while `updater.isBusy`). Otherwise shows the installed
  version and a "Verificar atualizações"/"Check for updates" bordered button. A status caption
  below switches color: `.secondary` when idle/checking/up-to-date, `.orange` when an update
  is pending ([ContentView.swift:446-499](mac/Sources/ContentView.swift)).
- **Release notes sheet**: fixed 560×420, markdown-rendered `AttributedString` (falls back to
  plain text on parse failure), scrollable, selectable, header with version + a bordered "Fechar"
  close button ([ContentView.swift:595-631](mac/Sources/ContentView.swift)).
- **Reset-PIN confirmation**: native `.confirmationDialog` with a destructive "Gerar novo código"
  action and a message warning connected devices will need the new code
  ([ContentView.swift:512-519](mac/Sources/ContentView.swift)).

### 7.11 Menu bar extra (`MenuBarView` + glyph)

- Glyph: **not** an SF Symbol — a hand-drawn 18×18 `NSImage` built from two 5×5 pixel-grid
  "glyphs" (a stylized double-diamond/hourglass pixel pattern, 9 filled cells per glyph out of 25,
  cell size derived from `min(width/12.5, height/5)`), rendered as `isTemplate = true` so it tints
  with menu-bar appearance ([DokkeApp.swift:27-74](mac/Sources/DokkeApp.swift)). **`mac/README.md:9`'s
  claim that the tray icon is `square.grid.2x2` is stale/wrong** — the actual glyph is this custom
  bitmap. Do not use an SF Symbol grid glyph for the Windows tray icon and call it faithful; if a
  literal reproduction of the pixel art is out of scope, at minimum flag the mismatch, don't
  silently substitute a system icon.
- Menu content: device/pinned counts caption row, optional `lastSyncNote` caption, divider,
  "Abrir Dokke"/"Open Dokke" (opens window "main"), "Sincronizar agora"/"Sync now"
  (`store.refreshAll()`), conditionally an update section (version-available text + "Baixar e
  instalar" or "Verificar atualizações" button), divider, "Sair"/"Quit" (stops server then
  terminates app), divider, a disabled two-column footer row showing version left / "Dokke" name
  right, fixed 250pt width ([ContentView.swift:633-714](mac/Sources/ContentView.swift)). Menu
  `.padding(8)`, `.frame(minWidth: 250)`.

### 7.12 Icon rendering helper (`IconHelper/main.swift`)

Separate executable target `DokkeIconHelper` ([Package.swift:16-20](mac/Package.swift)), CLI:
`DokkeIconHelper <app-path> <output-png> <max-pixels>` (16–2048 clamp)
([IconHelper/main.swift:5-26, 87-103](mac/IconHelper/main.swift)). Resolves symlinks before
fetching the icon (same Safari-Cryptex-badge avoidance reasoning as `DockStore.nativeIcon`,
comment at [IconHelper/main.swift:29-31](mac/IconHelper/main.swift)), draws into an offscreen
`NSBitmapImageRep` at the app's **current effective appearance** (not forced light — unlike
`DockStore.nativeIcon`'s macOS-26 light-forcing branch; this is presumably server-side icon
generation for the served PWA/companions, not the desktop dock, so no such consistency issue
was addressed here) ([IconHelper/main.swift:28-85](mac/IconHelper/main.swift)), writes PNG.
`application.setActivationPolicy(.prohibited)` keeps this headless CLI out of the Dock/switcher
([IconHelper/main.swift:87-89](mac/IconHelper/main.swift)).

---

## 8. Cross-reference against PRD §7 ("Contrato visual obrigatório")

PRD text ([docs/plans/2026-08-18-dokke-windows-host-prd.md:78-96](docs/plans/2026-08-18-dokke-windows-host-prd.md)):
> janela principal com título Dokke; sidebar com **Apps** e **Conectar**; item selecionado com o
> tratamento visual do app Mac; tela Apps com dock em grid de 4 colunas por 2 linhas, páginas,
> peek lateral e indicadores de página; módulo para adicionar app; modo explícito para reordenar
> itens; app picker com busca, ícone, estado "Adicionado" e ação "Adicionar"; tela Conectar com
> PIN, URL, QR Code, copiar URL, abrir URL, status do servidor, número de dispositivos e
> regeneração do PIN; estados equivalentes de carregando, vazio, offline, erro e sucesso.

| # | PRD §7 item | Code reality | Verdict |
|---|---|---|---|
| 1 | Window titled "Dokke" | `Window("Dokke", id: "main")` | Covered |
| 2 | Sidebar with **"Apps"** and "Conectar" | Shipped label is **"Slots"**, not "Apps" ([LanguageStore.swift:67](mac/Sources/LanguageStore.swift), [ContentView.swift:7](mac/Sources/ContentView.swift)) | **Conflict** — PRD names the wrong label; `mac/README.md:5` also says "Apps / Sobre," equally stale |
| 3 | Selected item gets Mac's visual treatment | Solid `DokkeTheme.selection` (#0A63D9) fill, r6 row | Covered, needs the exact color/radius from this doc, PRD gives none |
| 4 | 4×2 grid, pages, peek, page indicators | Confirmed: `pageSize = 8` (4×2), 5 pages, 450–458pt cards with 24pt gap, 7pt dots | Covered, PRD omits every number |
| 5 | Add-app module | `AddSlotButton`, dashed hover-reveal plus glyph | Covered |
| 6 | Explicit reorder mode | Reorder pill + jiggle + drag/drop, PRD doesn't mention jiggle | Covered but under-specified |
| 7 | App picker: search, icon, "Added" state, "Add" action | Confirmed in `AppPickerSheet` | Covered — **PRD is silent on the entire Website Links tab** (favicon scraping, suggestion list, name-prompt modal) which is half the picker's UI |
| 8 | Connect screen: PIN, URL, QR, copy, open, server status, device count, PIN regen | All present in `AboutView` | Covered, PRD gives no metrics (112px QR, 64×76 digit boxes, etc.) |
| 9 | Loading / empty / offline / error / success states | Loading: `ProgressView` in picker. Offline: `ContentUnavailableView`. Error: red caption text. Success: implicit. **Empty: does not exist** — the grid always shows 5 full pages of add-slots (§7.7) | **Conflict** — PRD requires an empty state the code never renders distinctly from "not yet filled" |
| — | (not in §7) | App is **hard-locked to dark mode** (`.preferredColorScheme(.dark)`) | **Omission** — a Windows host that respects system light theme diverges from the Mac reference |
| — | (not in §7) | Window chrome: hidden-title-bar + AppKit traffic-light repositioning (+12,−10) driving a custom header/sidebar offset | **Omission** — no native equivalent on Windows; needs its own spec, PRD doesn't acknowledge the gap |
| — | (not in §7) | Language switcher (pt-BR/English) in the About tab | **Omission** |
| — | (not in §7) | Release-notes sheet (560×420, markdown) | **Omission** |
| — | (not in §7) | Menu-bar/tray glyph, tray menu contents | **Omission** ("Diferenças permitidas: menu da bandeja do Windows" waves this off explicitly, which is reasonable, but the *shape* of the Mac tray menu — sync-now, update shortcut, version footer — isn't described either) |

**Net**: PRD §7 correctly captures the coarse structure (sidebar, 4×2 grid, picker, connect
screen) but is silent on essentially all *metrics* (colors, radii, spacing, animation timings),
contains two outright label/state conflicts (Apps-vs-Slots, empty-state existence), and omits two
structurally significant surfaces present in the Mac app: the Website Links half of the picker,
and forced dark mode. A Windows implementer following §7 literally, without this document, would
build a materially different-looking and differently-labeled app.

---

## 9. Optimization opportunities (secondary, not the task's focus)

| # | Finding | Effort | Risk |
|---|---|---|---|
| 1 | `ServerManager.locateNode()` spawns up to 7 blocking `Process` calls (`node --version`) synchronously from `init()` on the main actor before first frame ([ServerManager.swift:48-49, 129-143](mac/Sources/ServerManager.swift)) | S | low |
| 2 | Collapse `DockStore.pinned: [String]` into a computed projection of `pieces` instead of manually resyncing at 8+ call sites ([DockStore.swift:398, 414, 424, 434, 448, 463, 473, 482](mac/Sources/DockStore.swift)) | S–M | low |
| 3 | Remove dead code: `DockStore.filteredInstalled`/`filter` (never called, [DockStore.swift:32, 139-150](mac/Sources/DockStore.swift)), `ContentView.customTrafficLights` (never referenced, [ContentView.swift:98-117](mac/Sources/ContentView.swift)), `sidebarChromeRadius` (never referenced, [ContentView.swift:30](mac/Sources/ContentView.swift)), `DockIcon.cornerRadius = 20` misleadingly named (only clips the inner image, not the card) | S | low |
| 4 | `DockHoverCoordinator`'s always-on 30Hz `Timer` runs for the entire time any dock tile is mounted, even with the cursor stationary ([DockIcon.swift:93-167](mac/Sources/DockIcon.swift)) | M | low |
| 5 | `DockStore.nativeIcon(for:)` does a linear `installed.first(where:)` scan from inside a View's render path per tile ([DockStore.swift:630](mac/Sources/DockStore.swift)) | S | low |
| 6 | Hardcoded slot-limit literals (`0..<40`, `0...39`) ignore server-reported `maxPinnedPieces`; matching hardcoded "Limite de 5 páginas" strings regardless of actual limit ([DockStore.swift:166, 390, 531](mac/Sources/DockStore.swift), [LanguageStore.swift:77-78, 98-99](mac/Sources/LanguageStore.swift)) | S–M | medium (user-facing incorrect message if server limit ever changes) |

---

## 10. Rebrand points (Dokke → DeckTech)

- `felipenalves/Dokke` GitHub releases endpoint hardcoded in the update manager
  ([DokkeUpdateManager.swift:33](mac/Sources/DokkeUpdateManager.swift)) — **must be repointed**,
  or a DeckTech build will self-update into upstream Dokke.
- Wire-contract strings that must be **coordinated, not casually renamed**: the adoption preflight
  requires `health["service"] == "Dokke"` ([ServerManager.swift:232](mac/Sources/ServerManager.swift))
  and exact-match versioning against `CFBundleShortVersionString`
  ([ServerManager.swift:255-280](mac/Sources/ServerManager.swift)) — changing either breaks
  adoption of/by any server still identifying as "Dokke" v0.2.8-style during a mixed-fleet
  migration.
- `CFBundleIdentifier` `app.dokke.mac`, `CFBundleExecutable`/`CFBundleName`/`CFBundleDisplayName`
  all `Dokke` ([Info.plist:6-16](mac/Info.plist)).
- Package name `"Dokke"`, executable targets `Dokke` / `DokkeIconHelper`
  ([Package.swift:5-18](mac/Package.swift)).
- Legacy UserDefaults key `"j5.baseURL"` ([DockStore.swift:14](mac/Sources/DockStore.swift)) — a
  pre-Dokke codename artifact still live in the persisted-defaults surface.
- Literal `"Dokke"` strings throughout: window title, menu-bar accessibility label, About tab
  version footer, release-notes sheet title, log paths (`/tmp/dokke-server.log`), User-Agent
  strings (`"Mozilla/5.0 Dokke/1.0"`, `"Dokke/\(currentVersion)"`), i18n error strings referencing
  "Dokke" by name.
- `mac/README.md` itself is stale against the current code on two points (tray icon glyph,
  sidebar tab naming) and should not be used as a spec — this document supersedes it for those
  two facts.

---

## 11. Risks

- **Unsigned/unauthenticated self-update path**: SHA-256 verification uses a checksum sourced
  from the same unauthenticated GitHub API call as the download URL — protects against transport
  corruption only, not a compromised release or MITM on a spoofed DNS. No notarization/codesign
  check on the extracted `.app` before installation
  ([DokkeUpdateManager.swift:33, 84-96, 170-177](mac/Sources/DokkeUpdateManager.swift)).
- **Destructive-before-confirmed install script**: `install-update.sh` does `rm -rf "$TARGET"`
  before the `mv` of the new staged app is confirmed to have succeeded — a failure between those
  two lines leaves the machine with **no installed app**
  ([DokkeUpdateManager.swift:211-228](mac/Sources/DokkeUpdateManager.swift)).
- **Favicon fetch is unauthenticated outbound HTTP to arbitrary user-entered hosts** (any website
  URL a user types triggers an HTML fetch + up to ~10 follow-up image fetches with a spoofed
  User-Agent) — acceptable for a personal-LAN dock tool, but worth naming as an outbound-request
  surface with no allowlist beyond the hardcoded per-domain table
  ([DockIcon.swift:280-335](mac/Sources/DockIcon.swift)).
- **Version-adoption gate is exact-string-equality**, not semver range — any patch-level drift
  between a running server and a newly-launched host causes the host to treat a healthy same-app
  server as a **conflict** rather than adopting it, refusing to serve until the mismatch is
  resolved ([ServerManager.swift:255-280](mac/Sources/ServerManager.swift)).

---

## 12. Visual contract checklist

Every item below is phrased as an observable, numeric, screenshot-checkable fact — not an
implementation detail — and tagged against PRD §7 coverage: **[§7]** = PRD names this generically,
**[§7-silent]** = PRD says nothing about it, **[§7-conflict]** = PRD's own text contradicts the
code.

**Window & chrome**
1. [§7] Window title reads "Dokke".
2. [§7-silent] Default window size 980×628; minimum 840×540; sidebar column is exactly 208pt wide
   when open, 0pt when collapsed, with a ~0.2s ease-out width/opacity transition.
3. [§7-silent] The app renders **only in dark appearance**, regardless of the OS light/dark
   setting — no light-mode screenshot should ever be the reference.
4. [§7-silent] Window background color is uniform `#292120` (canvas) behind both sidebar and
   detail panes.

**Sidebar**
5. [§7-conflict] Sidebar's first item label reads **"Slots"** (not "Apps") in the reference build;
   confirm which label the Windows build is supposed to ship before treating "Apps" as ground
   truth.
6. [§7-silent] Sidebar container corner radius is 18pt, with a 1px border at 14% white opacity and
   **no fill/backdrop** on the non-Tahoe rendering path (canvas color shows through) — do not add
   a translucent panel fill unless deliberately choosing the Liquid-Glass variant.
7. [§7] Selected sidebar row background is solid `#0A63D9`, corner radius 6pt, full white text;
   hovered-unselected row is 8%-white fill; unselected/idle row has no fill and 58%-white text.
8. [§7-silent] Sidebar row icon is 14×14pt at 12pt medium weight; label text is 13pt medium.

**Dock grid**
9. [§7] Grid is 4 columns × 2 rows per page (8 tiles/page).
10. [§7-silent] There are always exactly 5 pages (40 total slots) regardless of how many items
    are pinned; empty slots render as visible dashed "+" add-buttons, not blank space.
11. [§7-conflict] There is no visually distinct "zero items pinned" empty state distinct from
    "40 empty add-slots across 5 pages" — confirm intentionally before building a different
    empty state for Windows.
12. [§7] Page cards are 450–458pt wide × 288pt tall, corner radius 40pt, fill `#1B1107`, separated
    by a fixed 24pt gap, with the next page visibly peeking at the trailing edge (masked by a
    16pt-wide fade at the scroll container's right edge).
13. [§7] Page indicator dots: 7×7pt circles, 7pt spacing, active = 92%-white, inactive =
    22%-white; row is tappable to jump pages.
14. [§7-silent] Reorder-mode toggle is a capsule pill bottom-right: idle = 14%-white fill / 90%-white
    text reading "Reorganizar apps"; active = `#0A63D9` fill / white text reading "Concluir",
    horizontal padding 20pt, vertical padding 11pt.
15. [§7] While reordering, every tile jiggles ±2.2° continuously with per-tile phase offset (do
    not expect two runs of the same dock to jiggle in visual sync — phase is randomized per
    process).

**Dock tile**
16. [§7-silent] Tile card is 80×80pt, corner radius **28**pt (not 20), fill 7%-white with an
    `#1B1107`-at-26%-opacity overlay and a 1px 8%-white border.
17. [§7-silent] App icon image inside the card is 68×68pt, corner radius 20pt, inset 6pt from the
    card edges.
18. [§7-silent] Tile label is centered below the card, 12pt semibold, single line, truncates with
    an ellipsis, fixed 88pt width.
19. [§7-silent] On hover (non-reordering), the icon image blurs (radius 4), scales to 1.08×, and
    its drop shadow deepens (opacity 0.1→0.18, radius 4→8, y-offset 2→4) — this is a **blur**
    effect, not just a scale/shadow change.
20. [§7-silent] On hover with removal allowed, a dark scrim covers the tile with a circular
    minus-button (22×22pt, translucent/glass) and a "Remover"/"Remove" 9pt label.
21. [§7-silent] Website tiles render their favicon inside a 56×56pt white (96% opacity) plate,
    corner radius 16pt — visibly smaller/more inset than the 68×68pt app-icon treatment.
22. [§7-silent] Add-slot button: 80×80pt, corner radius 28pt, 5%-white fill / 8%-white border at
    rest; on hover, fill rises to 12%-white, border to 18%-white, and a centered "+" glyph and
    "Adicionar"/"Add" label appear (both are hover-only, invisible at rest).

**App picker**
23. [§7] Picker sheet is a fixed 480×620pt modal with a top segmented control switching "Apps" /
    "Website Links".
24. [§7] Apps tab: search field top-right (164×32pt, corner radius 16pt, colored accent border);
    each app row shows a 34×34pt icon, name, and either a green checkmark ("Added") or an
    "Add" filled button.
25. [§7-silent] Website Links tab exists and shows a URL entry field plus 9 pre-populated
    suggestion rows (GitHub, YouTube, WhatsApp, Pinterest, Threads, TikTok, LinkedIn, ChatGPT, and
    one third-party productivity site) — PRD §7 does not mention this tab at all; confirm scope
    before treating "app picker" as apps-only.
26. [§7-silent] Adding a website opens a secondary 340pt-wide confirmation modal prompting for a
    short display name before committing.

**Connect tab**
27. [§7] Access code is shown as 4 separate digit boxes, 64×76pt each, 42pt bold monospaced text,
    corner radius 16pt, with "—" placeholders for missing digits; a "Gerar novo código" link
    below triggers a confirmation dialog.
28. [§7] QR code is 112×112pt on a white plate (corner radius 10pt, 10pt padding), generated with
    hard (non-interpolated) module edges; paired with the plain-text local URL, a "Copiar URL"
    button, and an "Abrir" button.
29. [§7] Server status row shows a 9×9pt colored dot (green=online, red=offline), device count,
    and pinned-item count, all in small secondary-styled text.
30. [§7-silent] A language switcher (Português/English) sits top-right of this tab — not mentioned
    in §7 at all.
31. [§7-silent] An "Atualizações"/"Updates" card sits below the status row, with a "Mudanças"
    button opening a fixed 560×420pt markdown release-notes sheet.

**Tray/menu-bar**
32. [§7-silent, permitted divergence] Tray glyph is a custom 18×18pt hand-drawn pixel-grid bitmap
    (two stylized diamond glyphs), template-tinted — not a system/SF Symbol icon. `mac/README.md`
    claims it's `square.grid.2x2`; that claim is stale and should not be used as the Windows
    reference.
