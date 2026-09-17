# TEST-HARNESS — Dokke/DeckTech test and measurement harness

Surface owner: TEST-HARNESS. Scope: `test/` (36 files), `measure/` (5 files),
`.github/workflows/test.yml`, `package.json` scripts. Every claim below cites
`path:line` from files actually read in this repo checkout
(`C:/Users/MaxVision/Desktop/cursor-oficial/decktech`).

All counts are approximate where noted — `grep -c "test("` and an anchored
`grep -n "^test("` disagree by one on `ui.test.mjs` (comments/strings contain
the literal substring `test(`); anchored counts are used throughout.

## 0. Headline findings (read this first)

1. **CI cannot run the harness it's supposed to gate.** Both workflows
   (`.github/workflows/test.yml:3-4`, `.github/workflows/pages.yml:3-4`) are
   `on: workflow_dispatch` only — nothing runs on push or pull_request. Even
   when manually dispatched, `test.yml:15-16` runs `npm ci` then `npm test`
   with **no `npx playwright install` step**. I confirmed via context7
   (`/microsoft/playwright` docs, "Version 1.38 breaking changes") that since
   Playwright 1.38 the `playwright` npm package **no longer downloads browser
   binaries on `npm install`/`npm ci`** — `npx playwright install` (or the
   `@playwright/browser-*` helper packages) is required. `package.json:16`
   pins `"playwright": "^1.62.1"`, well past that change, and there is no
   `postinstall` script (`package.json` has none) and no
   `@playwright/browser-chromium` dependency. Consequence: all 10
   `chromium.launch()` call sites in `test/ui.test.mjs` (lines 241, 287, 313,
   355, 389, 421, 498, 556, 609, 670) would fail with "executable doesn't
   exist" on a clean CI runner. `ui.test.mjs` is the single largest test file
   (47KB, ~17 tests) and is exactly the file that encodes the PWA half of the
   PRD §7 visual contract. **Not empirically re-run in this session** — this
   repo checkout has no `node_modules` (verified: `test -d node_modules` →
   `MISSING`), so I did not execute `npm ci`/`npm test` myself; the claim
   rests on the workflow file content plus the verified Playwright ≥1.38
   behavior change, not on an observed CI failure log.
2. **The macOS half of the visual contract is regex over Swift source text,
   not executed Swift.** `mac/Package.swift:8-20` declares only two
   `.executableTarget`s (`Dokke`, `DokkeIconHelper`) — **no `.testTarget`**,
   and no `.swift` file under `mac/` matches `*Test*`. All 13 `mac-*.test.mjs`
   files (`test/mac-app-slides-ui.test.mjs` 23 tests, `mac-connection-ui.test.mjs`
   16, `mac-slot-add.test.mjs` 7, `mac-performance-stability.test.mjs` 7,
   `server-manager.test.mjs` 6, `mac-native-icons.test.mjs` 5,
   `brand-icon-assets.test.mjs` 5, `mac-icon-appearance.test.mjs` 3,
   `mac-icon-helper.test.mjs` 3, `mac-picker-loading.test.mjs` 2,
   `mac-local-network.test.mjs` 1, plus icon/i18n files that also read `.swift`
   sources) work by `readFile`-ing a `.swift` file and asserting `assert.match`
   against a regex or a `String.slice` window (e.g.
   `test/mac-app-slides-ui.test.mjs:454-476` slices `DockGridView.swift` between
   `"var body: some View"` and `.overlay(alignment: .bottom"` and then regexes
   inside that substring). This never compiles, type-checks, or runs the
   SwiftUI code — it proves the string is present, not that the view renders,
   binds, or behaves as described. It is brittle to any refactor that
   preserves behavior but changes exact tokens (renaming a local, reformatting
   a modifier chain), and it gives zero evidence about actual rendering,
   layout math at runtime, or accessibility tree.
3. **Android has real unit tests that nothing runs.**
   `android/app/src/test/java/com/dokke/app/` contains four genuine Kotlin/JUnit
   test files (`DokkeConnectionStoreTest.kt`, `DokkeDiscoveryTest.kt`,
   `ServerUrlTest.kt`, `UpdateVersionTest.kt`) that would exercise real Kotlin
   logic via `./gradlew test`. `.github/workflows/` contains no Gradle step
   (`grep -rn "gradlew" .github/` → no matches) and `package.json` has no
   script that invokes Gradle. These tests exist and are real, but are
   orphaned from every automated path in this repo. Separately,
   `test/android-companion.spec.test.js` (6 tests, tags `@spec:AC-101..106`)
   and `test/android-haptics.test.mjs` (3 tests) do the same string-regex
   pattern as the mac-* files against `.kt` source text — they run under
   `node --test` (so they *do* execute in CI, unlike the Gradle tests) but
   prove the same shallow thing: substring presence, not compiled/executed
   Kotlin behavior.
4. **The suite's own traceability convention (`@spec:AC-NNN`) has no ID
   allocated for Windows.** 59 unique `@spec:AC-*` tags exist across the
   suite, in four contiguous blocks: `AC-001..013`, `AC-101..106` (Android),
   `AC-301..322` (website pieces / pinned pieces), `AC-333..343` (mac
   window-manager / hover / icon-cache stability). The Windows PRD's 12
   MVP acceptance criteria (`docs/plans/2026-08-18-dokke-windows-host-prd.md:263-282`)
   have no corresponding `AC-4xx`/`AC-5xx` ids anywhere in `test/`. A
   Windows implementation that follows the existing convention needs a new
   block; nothing today enforces or even signals that PRD §13's 12 criteria
   map to specific tests.

## 1. Runner and conventions

- **Runner:** Node's built-in test runner, invoked as `"test": "node --test"`
  (`package.json:8`). No test framework dependency (no vitest/jest/mocha) —
  confirmed by `package.json` `dependencies`/`devDependencies`
  (`package.json:12-19`) listing only `ws` and `ds-store`+`playwright`.
- **Discovery:** default `node --test` conventions — every file under `test/`
  matching `*.test.{js,mjs}` or `*.spec.test.js` is picked up automatically;
  no explicit glob is passed. `test/android-companion.spec.test.js` uses the
  `.spec.test.js` variant and is still discovered (confirmed it imports
  `node:test` and runs via the same convention as the others, `test/android-companion.spec.test.js:1-2`).
- **Assertions:** `node:assert/strict` throughout — `assert.equal`,
  `assert.deepEqual`, `assert.match`, `assert.doesNotMatch` are the entire
  assertion vocabulary observed across all 36 files.
- **No `describe`/`before`/`after` nesting** in the vast majority of files —
  tests are flat top-level `test("name", async () => {...})` calls with
  inline setup/teardown per test (each server-touching test does its own
  `startServer(...)` / `try { ... } finally { await close(); }`, e.g.
  `test/apps-api.test.mjs:99-111`). `test/package-dmg.test.mjs:805` is the one
  file that uses `after` for a shared fixture teardown.
- **Two counting conventions live side by side in file names:** most files
  are `*.test.mjs`; one is `*.spec.test.js`
  (`test/android-companion.spec.test.js`). Both are picked up identically by
  `node --test`; the `.spec.` infix carries no special meaning to the runner,
  it just mirrors the `@spec:AC-*` tags used inside that file.

## 2. How Playwright is driven

- `test/ui.test.mjs` is the only file in `test/` that imports `playwright`
  (`test/ui.test.mjs:3` `import { chromium } from "playwright"`). Every
  Playwright-touching test launches its **own** browser instance —
  `chromium.launch({ headless: true })` — and closes it in a `finally` block;
  there is no shared browser fixture across tests, so the file pays browser
  startup cost ~10 times per run (`test/ui.test.mjs:241,287,313,355,389,421,498,556,609,670`).
- Viewport/device emulation is hand-rolled per test via `browser.newPage({...})`
  options, not Playwright's `devices[...]` preset registry: e.g.
  `test/ui.test.mjs:502-507` builds an iPhone profile manually
  (`viewport: {width:393,height:852}, deviceScaleFactor:3, isMobile:true,
  hasTouch:true, userAgent:"...iPhone OS 18_6..."`), and
  `test/ui.test.mjs:670-676` builds an iPad landscape profile the same way.
  This means device coverage is whatever string the test author typed, not a
  maintained Playwright device descriptor — a real device-profile drift risk
  (new iOS/Android UA strings age silently).
- **No `channel: "chrome"`** in `test/ui.test.mjs` — it uses Playwright's
  bundled Chromium, which is exactly what requires the missing
  `playwright install` step (see Finding 1).
- `measure/*.mjs` (5 files) are a **separate, uninstrumented Playwright
  harness**, not wired to `node --test` at all and not referenced by any
  `package.json` script (`grep -n "measure" package.json` → no match). All
  five (`deck-ab.mjs`, `deck-debug.mjs`, `deck-probe.mjs`, `jank.mjs`,
  `swiping-probe.mjs`) use `chromium.launch({ channel: "chrome", headless: true })`
  — i.e. they require a real Google Chrome install on the machine (not the
  Playwright-managed Chromium binary), and they all assume a server is
  **already running** at `http://127.0.0.1:3000` (none of them call
  `startServer`; they just `page.goto("http://127.0.0.1:3000")`). These are
  developer-run diagnostic/profiling scripts (drag-swipe jank measurement,
  deck-carousel A/B behavior probes) — `console.log`-based output, no
  assertions, no pass/fail. They are genuinely useful for interactively
  debugging the swipe/deck animation described in PRD §7's "grid... páginas,
  peek lateral e indicadores de página", but they are not tests and cannot
  regress CI.

## 3. Fixture and mocking strategy

The core-server surface (`server.js`, `auth.js`, `config.js`, `obs.js`,
`obs-ws.js`, `apps.js`, `actions.js`) is genuinely well-designed for testing:
`startServer(opts)` accepts dependency injection for essentially everything
that would otherwise be a real OS/network call:

- `port: 0` → random free port, so tests never collide (used in nearly every
  server test, e.g. `test/smoke.test.mjs:6`).
- `config` / `configFile` → in-memory config object or a temp-dir JSON file
  (`test/config-api.test.mjs:230-239` uses `mkdtemp(join(tmpdir(), "j5api-"))`).
- `appTools: { listAppProcesses, listInstalledApps }` — this is the seam a
  Windows platform adapter would plug into. `server.js:295` defaults it to
  the real macOS implementation
  (`import { listAppProcesses, listInstalledApps, realIconService } from "./apps.js"` at `server.js:26`),
  and `server.js:974-976` shows the override pattern:
  `listProcesses: (opts.appTools && opts.appTools.listAppProcesses) ? opts.appTools.listAppProcesses : listAppProcesses`.
  Tests inject a fake, e.g. `test/apps-api.test.mjs:102`
  `appTools: { listAppProcesses: async () => [{ name: "Chrome", pid: 9 }] }`.
- `actions: { activateApp }` — same pattern, injected in
  `test/actions-api.test.mjs:17` (`actions: { activateApp: async app => { called = app; } }`).
- `obs` — a hand-built fake OBS client object (`test/obs-api.test.mjs:712-723`
  `fakeObs()` returns `{ getState, switchScene, toggleRecord, toggleStream, stopAll }`
  stub methods plus a `calls` recorder) is injected directly, so the OBS
  WebSocket protocol tests (`test/obs-ws.test.mjs`, 7 tests) exercise the
  real `authResponse`/`buildIdentify` challenge-response math
  (`test/obs-ws.test.mjs:754-760`, verified against literal expected base64
  hashes) without a real OBS instance, while `test/obs.test.mjs` drives the
  `OBS` class against a `MockWS` that captures `send()` calls and replays
  `deliver()` responses (`test/obs.test.mjs:776-801`).
- `trustLoopback: false` — used to simulate a LAN client for the auth suite
  (`test/auth.test.mjs:171-181`), forcing every `/api/*` route through the
  cookie/session path that a loopback caller would otherwise skip.
- File-system fixtures throughout use `mkdtemp(join(tmpdir(), "<prefix>-"))`
  + `rm` cleanup — no fixture directory is committed to the repo; everything
  is generated per test run. `test/apps.test.mjs` builds fake `.app` bundle
  trees with `mkdir`/`symlink`/`writeFile` to exercise `scanAppsDirs` without
  touching the real `/Applications` (`test/apps.test.mjs:128-131` imports).

**Icon/PNG fixtures are hand-synthesized, not binary blobs checked into the
repo:** `test/icon.test.mjs:358-380` builds minimal valid PNGs byte-by-byte
(`pngChunk`, `rgbaPng` helpers computing real CRC32) rather than shipping
`.png` test fixtures — this keeps the repo small and the tests
platform-independent for the *PNG parsing* logic, but every icon *acquisition*
path it tests (`sips`, `NSWorkspace`, `.icns`, `LaunchServices`,
`CFBundleIconFile`) is macOS-only; `test/icon.test.mjs:66-356` names it
explicitly (`convertToPng chama sips`, `realIconService prioriza NSWorkspace`,
`findIconFile respeita CFBundleIconFile`). There is no equivalent Windows PNG
fixture story yet, though the same byte-synthesis helpers are directly
reusable for a `test/windows-*.test.mjs` icon test.

**One test file executes real subprocess/shell scripts:**
`test/package-dmg.test.mjs` (15 tests) `execFileSync`/`spawnSync`s the actual
`mac/package-dmg.sh` against a built `.app` fixture tree, and is explicitly
platform-gated: `test/package-dmg.test.mjs:818`
`const macOnly = process.platform === 'darwin' ? {} : { skip: 'DMG packaging requires macOS' };`.
On the Ubuntu CI runner (or a Windows dev box) these 15 tests **silently
skip** rather than fail — `npm test` output would show them as skipped, not
run. This is the exact pattern a future `test/windows-package.test.mjs`
(implementation plan Task 6) would need to avoid repeating unless it is
likewise gated to run only where the Windows installer toolchain exists.

## 4. What each test file asserts, grouped by surface

### Core server (HTTP/WS/config/auth) — well covered, real execution
| File | Tests | What it proves |
|---|---|---|
| `test/smoke.test.mjs` | 2 | `/health` 200 + `{ok,service}`; path-traversal → 404 |
| `test/auth.test.mjs` | 14 | PIN generation/lockout, session cookie roundtrip, loopback trust bypass, cross-origin mutation blocking, WS cookie auth, 5-strikes lockout (429) |
| `test/config.test.mjs` | 5 | pinned page/limit constants, load/save roundtrip |
| `test/config-api.test.mjs` | 13 | `/api/config`, `/api/config/pinned` CRUD, concurrent POST race safety, 40-item hard limit enforcement |
| `test/status-ws.test.mjs` | 10 | WS push protocol, ping/pong keepalive, dead-client eviction, cross-origin WS rejection, ping-flood throttling |
| `test/apps-api.test.mjs` | 8 | `/api/apps`, `/health` public-after-boot (`@spec:AC-336`) |
| `test/actions-api.test.mjs` | 9 | `/api/apps/:name/activate` route wiring to injected `actions` |
| `test/website-pieces-api.test.mjs` | 16 | mixed apps+website pieces API, optimistic-concurrency (`revision`), slot placement, open-by-id-only |
| `test/website-pieces-config.test.mjs` | 10 | URL normalization/validation, website piece creation |
| `test/obs-api.test.mjs` / `obs-ws.test.mjs` / `obs.test.mjs` | 13 / 7 / 8 | OBS WebSocket v5 auth challenge math, scene/record/stream control API |
| `test/discovery.test.mjs` | 2 | UDP discovery responds `dokke:<ip>:<port>` |
| `test/server-manager.test.mjs`* | 6 | *macOS-only* — `ServerManager.swift` ownership/adoption logic, regex-only |

### Auth/config — same table above; no separate surface split in the repo.

### PWA (`public/index.html`) — mixed depth
- `test/ui.test.mjs` (17 tests): two-screen layout markers (`#screens`,
  `#screenApps`, `#screenRecents`), login-card gradient/opacity regex,
  manifest/service-worker headers, 5-page grid with empty slots, keyboard-avoid
  login repositioning, Wake Lock acquire/release lifecycle, landscape/portrait
  safe-area CSS regexes, update-banner platform gating (Android vs Mac host
  banner). **All of it is string/regex assertion against the served HTML
  text**, not DOM interaction assertions — there is no `page.click()` +
  `expect(locator)` pattern anywhere in this file; every check is
  `assert.match(html, /regex/)` on the raw response body or on a script
  string extracted from it (e.g. `test/ui.test.mjs:1079-1084` slices
  `renderLaunchpad` out of the HTML text and regexes inside it). This is
  functionally closer to the mac-*.test.mjs regex pattern than to real
  Playwright interaction testing, **except** for the handful of tests that do
  drive `page.mouse`/`page.evaluate` (e.g. the Wake Lock and keyboard-avoid
  tests navigate a real page and read live `document.*` state).
- `test/pinned-limit-ui.test.mjs` (2), `test/website-pieces-ui.test.mjs` (14):
  same regex-over-served-HTML pattern.
- `test/issue-19-i18n.test.mjs` (9) / `issue-19-error-i18n.test.mjs` (4):
  cross-checks that every `REQUIRED_I18N_KEYS` / `ERROR_CODES` entry appears
  in the PWA HTML **and** in `obs.js`, `docs/src/main.js`,
  `mac/Sources/DockGridView.swift`, `mac/Sources/ContentView.swift`,
  `mac/Sources/DokkeApp.swift`, `README.md`/`README.en.md` — this is the one
  file in the suite that treats i18n coverage as a genuine cross-surface
  contract rather than testing one surface at a time
  (`test/issue-19-i18n.test.mjs:418-428`).

### macOS (SwiftUI app) — regex-only, see Finding 2
13 files, ~100 `test()` cases total, zero compiled/executed Swift.

### Android — split between real-but-unrun and shallow-but-run, see Finding 3
4 real Gradle/JUnit files (never run by CI) + 2 `node --test` regex files
(`android-companion.spec.test.js` 6, `android-haptics.test.mjs` 3) that run
in CI but only prove Kotlin source text contains expected tokens (e.g.
`test/android-haptics.test.mjs:74-77` regexes for
`fun performHapticFeedback()`, `HapticFeedbackConstants.CONTEXT_CLICK`, and
separately asserts the manifest does **not** declare
`android.permission.VIBRATE` — a real, valuable assertion about permission
hygiene, still done via regex on manifest XML text rather than a parsed
manifest).

### Landing/docs site (`docs/`) — thin
- `test/docs-hero-motion.test.mjs` (1 test, `docs-hero-motion.test.mjs:324`):
  a single test bundling ~10 assertions (asset byte-size bounds, favicon
  link tag, pointer-motion JS hooks, reduced-motion escape hatch). One test
  covering one hero interaction; no coverage of the rest of `docs/src/` (nav,
  other pages, build output) beyond what `issue-19-i18n.test.mjs` incidentally
  touches (`docs/src/main.js`, `docs/src/style.css`).
- `docs/` has its own `package.json`/`package-lock.json` and is built by
  `.github/workflows/pages.yml`, entirely separate from the root `node --test`
  harness (`pages.yml:22-26` runs `npm run build` inside `docs/`, no test
  step at all).

### Release/branding metadata — pins that must move together
- `test/release-version.test.mjs` (1 test, `release-version.test.mjs:874-882`):
  hard-pins `0.2.8` / `versionCode 11` / `versionName "0.2.8"` /
  `CFBundleShortVersionString 0.2.8` / `CFBundleVersion 10` /
  `## v0.2.8` across `package.json`, `public/version.json`,
  `android/app/build.gradle`, `mac/Info.plist`, `CHANGELOG.md` in one test.
  Any fork re-pin (e.g. DeckTech starting its own version line) breaks this
  single test predictably and by design — it is meant to be a forcing
  function, not a false positive.
- `test/brand-icon-assets.test.mjs` (5 tests): pins **SHA-256 hashes** of five
  Android launcher PNGs (`test/brand-icon-assets.test.mjs:209-215`, one hash
  per mipmap density). This is the most brittle test in the suite by
  construction — it is *designed* to fail the instant the icon changes, which
  is correct for catching accidental icon corruption but means a DeckTech
  rebrand must regenerate all five hashes as a first-class step, not a side
  effect.

## 5. What CI actually runs

- `.github/workflows/test.yml`: `workflow_dispatch` trigger only (manual),
  Ubuntu runner, Node 22, `npm ci` → `npm test`. No Playwright browser
  install step (Finding 1). No Gradle step. No Swift/Xcode step (would fail
  anyway — Ubuntu has neither).
- `.github/workflows/pages.yml`: `workflow_dispatch` only, builds and deploys
  the `docs/` Vite site to GitHub Pages. No test step.
- Net effect: **on this repository as configured, no test ever runs
  automatically on any commit or PR.** A human must click "Run workflow" in
  the Actions tab, and even then the Playwright-backed third of `test/` would
  fail for the reason in Finding 1 (not validated by an actual CI run in this
  session — reasoning from file content + confirmed Playwright behavior
  change, not an observed failure log).

## 6. Coverage map

| Surface | Well covered | Shallow | Not tested at all |
|---|---|---|---|
| Core server (HTTP/WS, config, auth) | Route contracts, PIN lockout/session lifecycle, concurrency safety on config writes, OBS WS auth math, UDP discovery reply format | `userDataDir()` win32/darwin/linux branch (`server.js:928-932`) — every test injects `root`/`configFile` directly, so the platform-detection branch itself is never exercised on any OS | Real multi-client WS fan-out under load; actual firewall/network-adapter failure paths (PRD §8.1's "explain when LAN is blocked") |
| Auth/config file semantics | Cookie/PIN roundtrip, revision-conflict handling | POSIX file-mode assertion (`test/auth.test.mjs:106` `stat(...).mode & 0o777 === 0o600`) — reasoning-only, not run in this session: Node's `fs.chmod` on win32 only toggles the read-only attribute, so this exact equality is unlikely to hold on Windows; needs an actual `node --test test/auth.test.mjs` run on a Windows box to confirm | — |
| PWA | Manifest/SW headers, i18n key parity, grid/page markers via regex | DOM interaction (click/tap → state change) — only a few tests drive real page interaction (Wake Lock, keyboard-avoid); most are regex-on-served-HTML | Real touch-gesture behavior (swipe-to-page, deck carousel drag) — that lives only in unasserted `measure/*.mjs` probe scripts, never in `node --test` |
| macOS (SwiftUI) | Extremely high *textual* density — every recent feature (hover tracker, icon cache, reorder mode, sidebar) has a dedicated regex test | Everything — it's all regex, so "well covered" and "shallow" are the same bucket here; nothing here proves compiled behavior | Actual SwiftUI rendering, layout at runtime, accessibility tree, window-resize behavior beyond what the regex encodes (no `.testTarget` exists to test this even in principle) |
| Android | Permission-hygiene regex (no VIBRATE), orientation-lock regex, discovery reply-parsing regex | Same regex-only caveat as macOS for `android-companion`/`android-haptics.test.mjs` | The four real Gradle/JUnit tests (`DokkeConnectionStoreTest.kt`, `DokkeDiscoveryTest.kt`, `ServerUrlTest.kt`, `UpdateVersionTest.kt`) — real but never run by any automation in this repo |
| Landing (`docs/`) | Hero motion asset-size + reduced-motion hook (1 test), i18n key cross-check | Rest of the docs site's structure/behavior | Actual Vite build output, other pages, navigation, the `docs/public/tutorial-dokke.html` referenced by the Windows plan's Task 7 |
| Release/branding | Version-string cross-file pin, Android icon hash pin | — | macOS `.icns`/Icon-Composer byte-level correctness (only structural presence is checked, `test/mac-icon-appearance.test.mjs:521-525`) |

## 7. Rebrand impact — Dokke → DeckTech

137 occurrences of `Dokke`/`dokke` across 21 of 36 test files
(`grep -ro "[Dd]okke" test/*.mjs test/*.js | wc -l`). Zero occurrences in
`measure/*.mjs`. Grouped by *how* a rename breaks them, not just where:

**a) Brand string in a product artifact — breaks the instant the source
string changes, fix is a 1:1 string edit:**
- `service: "Dokke"` — `server.js:377`, `server.js:777`; asserted in
  `test/smoke.test.mjs:926`, `test/apps-api.test.mjs:118` (`@spec:AC-336`),
  `test/android-companion.spec.test.js:1126`.
- `<title>Dokke</title>` — asserted `test/ui.test.mjs:988`.
- Discovery protocol magic string `"dokke:discover"` /
  `"dokke:<ip>:<port>"` — `server.js:170,208`, asserted
  `test/discovery.test.mjs:310-316`, and independently re-derived on the
  Android side (`DokkeDiscovery.kt`, asserted
  `test/android-companion.spec.test.js:1113-1119`). **This one is not purely
  cosmetic** — it is a wire-protocol constant shared by three independent
  implementations (server, Mac client presumably, Android client). Renaming
  it means updating the UDP magic string in lockstep across `server.js`,
  `android/.../DokkeDiscovery.kt`, and (implicitly) any Windows
  implementation, or breaking discovery between old and new companions.

**b) Path/package identity — requires moving files or renaming an
identifier, not editing a string literal:**
- `assets/branding/dokke-icon/` directory name, referenced by
  `test/brand-icon-assets.test.mjs:198` and `test/mac-icon-appearance.test.mjs:517`.
- Android package `com.dokke.app` — the actual Kotlin package/bundle id,
  referenced by path in `test/android-companion.spec.test.js:1108`,
  `test/android-haptics.test.mjs:70-71`, `test/issue-19-error-i18n.test.mjs:389-390`.
  Renaming this is an Android application-id change (affects installed-app
  identity on real devices), not just a test fixture edit.
- `mac/dist/Dokke.app` bundle name — `test/package-dmg.test.mjs:632`.
- `public/dokke.apk` — `test/package-dmg.test.mjs:820` (`expectedPublicFiles`),
  and `server.js:98` (`apkUrl: "...download/dokke.apk"`).
- `DokkeIconHelper.app` — `apps.js:13`
  (`const MAC_ICON_HELPER = join(import.meta.dirname, "bin", "DokkeIconHelper.app")`),
  a compiled helper binary name baked into the install/package scripts
  (`test/mac-icon-helper.test.mjs`, `test/mac-performance-stability.test.mjs:632`
  references `mac/install.sh` which builds this).
- `/tmp/dokke-server.log` hardcoded log path — `test/server-manager.test.mjs:893`
  asserts the literal string `private static let logPath = "/tmp/dokke-server.log"`
  inside `ServerManager.swift`. A Windows equivalent obviously cannot reuse
  `/tmp`; this specific assertion is macOS-only and won't transfer at all, but
  the *pattern* (log path is a literal the test pins) will repeat for
  whatever Windows chooses (likely under `%APPDATA%\DeckTech\`).

**c) Guaranteed breakage regardless of care — content-derived, not
string-derived:**
- `test/brand-icon-assets.test.mjs:209-215` pins **SHA-256 hashes** of five
  Android `ic_launcher.png` files. Any icon replacement (which a rebrand
  necessarily requires) invalidates all five hashes; they must be
  regenerated as a first-class rebrand step. The test is not "wrong" here —
  it is working as designed to force exactly this regeneration — but it will
  show as 5 failing tests until someone updates the map.

**d) Fork re-pin — version metadata, breaks by design on any version bump:**
- `test/release-version.test.mjs` pins `0.2.8`/`versionCode 11`/
  `CFBundleVersion 10` across five files simultaneously (see §4). A DeckTech
  fork starting its own version line must update this test in the same
  commit as the version bump, or it fails immediately and correctly.

**e) Cosmetic fixture values that do *not* break the assertion, only the
literal string in test output:**
- `createWebsitePiece("Dokke", "dokke.app")` — `test/website-pieces-api.test.mjs:1010`.
  This is test *fixture data* (a sample website piece named "Dokke" pointing
  at dokke.app), not a product assertion. I checked whether any test asserts
  the derived `website:<sha256-of-url>` id literal — it does not; ids are
  compared for round-trip equality, not against a hardcoded hash
  (`test/website-pieces-config.test.mjs:1057` only regexes the *shape*
  `^website:[a-f0-9]{64}$`, not a specific value). Safe to leave, rename, or
  repurpose without breaking anything else.

**f) Rebrand point the harness touches but doesn't directly assert on
literal strings:**
- `server.js:90-98` hardcodes `https://github.com/felipenalves/Dokke/releases/...`
  update-check URLs. `test/ui.test.mjs:387-449` has two tests
  ("Android atualizado não exibe o banner...", "falha ao ler versão do
  Android não cai no banner...") that exercise the update-banner *logic*
  around this endpoint without asserting the URL string itself — so renaming
  the repo/org here doesn't break these two tests directly, but the
  *feature* (update check) silently points at the wrong (or now-404)
  upstream repo until someone updates it; nothing in the suite would catch
  that mid-rebrand.

**Tests that encode the visual contract and must be extended, not
replaced, under a DeckTech rebrand:** `test/mac-app-slides-ui.test.mjs`,
`test/mac-connection-ui.test.mjs`, `test/ui.test.mjs`,
`test/website-pieces-ui.test.mjs`, `test/pinned-limit-ui.test.mjs` — none of
these assert the string "Dokke" as part of their layout/behavior claims
(their `[Dd]okke` hits, where present, are incidental file-path references,
not layout assertions). PRD §7 explicitly requires DeckTech Windows to
reproduce this same structural contract, so these tests are the closest thing
the repo has to an executable spec for that contract and should gain Windows
siblings, not be rewritten.

## 8. Windows host — test files needed, mapped to the 7-task plan

Source: `docs/plans/2026-08-18-dokke-windows-host-implementation-plan.md`.
None of the files below exist yet (`find . -iname "platform" -o -iname "windows"` →
no matches; `ls test/ | grep -i windows` → no matches, verified in this
session).

| Task | New/modified test file(s) | What it must prove | Reusable seam already in the repo |
|---|---|---|---|
| 1 — platform contract | `test/windows-platform.test.mjs` (new); `server.js` modified | `listInstalledApps`, `listAppProcesses`, `getIconPng`, `activateApp` contract shape; dedup; action failure doesn't crash server | `appTools`/`actions` injection points already exist at `server.js:295,974-976` and `server.js` actions param (mirrors `test/apps-api.test.mjs:102`, `test/actions-api.test.mjs:17` patterns exactly) — **directly reusable pattern** |
| 2 — app discovery | `test/windows-app-discovery.test.mjs` (new) | Start-menu shortcuts, known paths, dedup identity, cache invalidation, no destructive commands run | `test/apps.test.mjs`'s `mkdtemp`+fake bundle tree pattern (`test/apps.test.mjs:128-155`) is directly portable to fake `.lnk`/Start Menu fixtures |
| 3 — icons/processes/actions | `test/windows-actions.test.mjs` (new); `platform/windows/apps.js`, `platform/windows/actions.js`, `server.js` modified | Resolved-path open, PID-invalid falls back to open, focus failure doesn't kill server; routes `/api/apps`, `/api/apps/installed`, `/api/apps/:name/icon`, `/api/apps/:name/activate` preserved | **Open question, not yet resolved by the codebase:** is the icon provider (`realIconService`, imported `server.js:26`) injectable the same way `appTools`/`actions` are? I did not find an `iconService` override parameter on `startServer` in the lines I read (`server.js:295` only lists `appTools`) — Task 3's "trocando somente o provider de plataforma" for icons may need a new injection seam that doesn't exist today. This should be verified against the full `startServer` option list before Task 3 starts, since it's a plan/code gap, not just a missing test. `test/icon.test.mjs`'s byte-exact PNG-synthesis helpers (`pngChunk`, `rgbaPng`, `:358-380`) are directly reusable for Windows icon-extraction fixtures even though none of the macOS-specific tests (sips/.icns/NSWorkspace) are |
| 4 — Electron shell lifecycle | `test/windows-host.test.mjs` (new) | Single-instance lock, server start/stop, port-in-use handling, error logging, main window open | No direct precedent in `test/` — closest analog is the *regex-only* `test/server-manager.test.mjs` (macOS `ServerManager.swift` lifecycle), which cannot be ported as-is because it never executes anything. Because this is a Node/Electron main process, this test file *can* be written as real executed-behavior tests (unlike the Swift equivalent) if `windows/src/main.js`/`server-process.js` accept injected `childProcess.spawn`/port-check functions — the team should deliberately choose real execution here over the mac-* regex pattern, since nothing forces the regex approach for JS |
| 5 — desktop UI visual parity | `test/windows-desktop-ui.test.mjs` (new) | Sidebar Apps/Conectar, grid 4×2, page indicators, app picker, reorder mode, Conectar screen elements (PIN/QR/URL/copy/open/status/device-count/regenerate) | **No shared, machine-readable representation of PRD §7 exists today** — see §9 below. `test/mac-app-slides-ui.test.mjs` and `test/mac-connection-ui.test.mjs` encode the same invariants in Swift-regex form; `test/ui.test.mjs` encodes the PWA's version in HTML-regex form. A third independent encoding in Electron-DOM form is exactly the drift risk PRD §7 is trying to prevent — recommend extracting a shared JSON/JS fixture (grid dimensions, sidebar item list, Conectar element list) that all three test files import and assert against, rather than hand-copying the regex pattern a third time |
| 6 — packaging/installer | `test/windows-package.test.mjs` (new); `windows/electron-builder.yml` (new) | Installer metadata (name/version/arch/icon), user-data-outside-install-dir policy, uninstaller | `test/package-dmg.test.mjs`'s pattern (execute the real packaging script, assert on `dist/` output) is the right model *except* for its `macOnly` skip-gate (`test/package-dmg.test.mjs:818`) — a Windows equivalent must not silently skip on non-Windows CI runners without the team explicitly deciding that's acceptable, since it repeats the exact blind spot Finding 2/3 already document for two other platforms |
| 7 — release doc close-out | No new test file — plan specifies `npm test` + `git diff --check` only | Full suite passes; no whitespace inconsistency | N/A — but per Finding 1, "`npm test` passes" is not currently a meaningful CI gate signal (would need the Playwright-install fix first) |

## 9. Visual contract checklist (PRD §7 → existing test → gap)

PRD §7 (`docs/plans/2026-08-18-dokke-windows-host-prd.md:78-96`) enumerates
9 bullets DeckTech Windows must reproduce structurally. Mapping each to the
nearest existing test:

| PRD §7 bullet | Nearest existing test | Coverage |
|---|---|---|
| Janela principal com título Dokke | none found for the *native window* title (only the PWA `<title>` tag, `test/ui.test.mjs:988`) | Gap — no test asserts the macOS window's title bar text |
| Sidebar com Apps e Conectar | `test/mac-connection-ui.test.mjs:24` ("tela de conexão prioriza o código..."), sidebar slice at `test/mac-connection-ui.test.mjs:490-493` | Present (regex-only, macOS) |
| Item selecionado com tratamento visual do Mac | `test/mac-app-slides-ui.test.mjs:65` ("sidebar replica a seleção discreta da referência") | Present (regex-only) |
| Dock grid 4×2, páginas, peek lateral, indicadores de página | `test/mac-app-slides-ui.test.mjs:109` ("paginação continua baseada em oito apps por slide"), `:165` ("slide principal domina a viewport com peek de 55%") | Present (regex-only); PWA side covered separately and independently by `test/ui.test.mjs:273` ("PWA exibe cinco páginas completas...") — **two independent encodings already, confirming the §9 drift risk** |
| Módulo para adicionar app | `test/mac-slot-add.test.mjs:684` | Present (regex-only) |
| Modo explícito para reordenar itens | `test/mac-app-slides-ui.test.mjs:72` ("reordenação fica explícita no modo Reorganizar apps") | Present (regex-only) |
| App picker: busca, ícone, "Adicionado", "Adicionar" | `test/website-pieces-ui.test.mjs:1096` (`@spec:AC-320`, picker keeps Apps + adds Website Links); `test/mac-picker-loading.test.mjs` covers loading state only | Partial — no test explicitly asserts a *search* affordance in the picker |
| Conectar: PIN | `test/mac-connection-ui.test.mjs:34` (PIN reload timing) | Present, narrow (reload timing only, not initial display) |
| Conectar: QR Code | `test/mac-connection-ui.test.mjs:202` (QR/code card spacing parity only) | Shallow — layout spacing only, not QR content/correctness |
| Conectar: URL, copiar URL, abrir URL | none found (`grep -rn "copyURL\|copiar\|abrirURL\|openURL" test/mac-*.test.mjs` → no matches) | **Gap** |
| Conectar: status do servidor, número de dispositivos | API-level only (`test/config-api.test.mjs:61` "GET /api/status retorna devices e pinned") — no Mac/PWA **UI** test asserts these are displayed | Gap at UI layer |
| Conectar: regeneração do PIN | Server-level only (`test/auth.test.mjs:227` "POST /api/pin regenera e invalida sessão antiga") — no UI test for the regenerate button/action | Gap at UI layer |
| Estados: carregando, vazio, offline, erro, sucesso | `test/mac-picker-loading.test.mjs` (loading only), `test/pinned-limit-ui.test.mjs` (limit-reached error state only) | Partial — no single test enumerates all five states for any one screen |

**Implication for Task 5:** roughly half of PRD §7's Conectar-screen bullets
(copy/open URL, device count, PIN regen, full state matrix) have **no**
existing UI-level test on any platform to port from — `test/windows-desktop-ui.test.mjs`
would be writing net-new coverage for those, not translating an existing Mac
test, and the PRD's RF-02 requirement ("comparar estrutura e estados com o
app Mac, não somente existência de textos") is currently unenforceable for
those specific bullets because the Mac side itself doesn't test them at that
depth yet.

## 10. Public contracts the harness depends on

- `startServer(opts)` injection surface, all confirmed by direct usage across
  test files: `port`, `root` (`test/auth.test.mjs:173`), `config`,
  `configFile` (`test/config-api.test.mjs:234`), `trustLoopback`
  (`test/auth.test.mjs:177`), `appTools` (`test/apps-api.test.mjs:102`),
  `actions` (`test/actions-api.test.mjs:17`), `obs` (`test/obs-api.test.mjs:727`),
  `wsHeartbeatMs` (referenced in `server.js:915-918`). This is the seam any
  new platform adapter (Windows) integrates through.
- `@spec:AC-NNN` tag-in-test-name convention — traceability from PRD/issue
  acceptance criteria to `node --test` output, informally enforced (no
  lint/CI check verifies every `@spec:AC-*` in a plan doc has a matching
  test, or vice versa).
- `node --test` / `*.test.mjs` (and one `*.spec.test.js`) file-discovery
  convention — no custom test config file exists (no `.node-test.config`
  equivalent), so this is purely Node's built-in default behavior.
- UDP discovery wire format `"dokke:discover"` → `"dokke:<ip>:<port>"`
  (`server.js:170,208`) — shared, tested contract between server and Android
  client, and the one wire-protocol string a Windows implementation must
  match byte-for-byte to interoperate with existing companions.

## 11. Recommended follow-ups (not requested as deliverables, noted for the
record)

1. Add `npx playwright install --with-deps chromium` to `test.yml` before
   `npm test` (Finding 1) — otherwise Task 5's `test/windows-desktop-ui.test.mjs`
   would be the *second* Playwright-only file to be structurally unrunnable in
   CI as configured.
2. Change both workflow triggers from `workflow_dispatch`-only to also run on
   `push`/`pull_request`, or explicitly document that this repo's CI is
   manual-only by design.
3. Before Task 5, extract PRD §7's structural invariants (grid dims, sidebar
   items, Conectar element list) into one shared fixture consumed by the
   Mac-regex tests, the PWA-regex tests, and the new Windows tests, instead
   of a third hand-copied encoding (§8, Task 5 row).
4. Confirm empirically (not just by reasoning) whether
   `test/auth.test.mjs:106`'s `mode & 0o777 === 0o600` assertion passes on
   Windows before relying on it as a cross-platform contract test — this
   requires `npm ci` + `node --test test/auth.test.mjs` on an actual Windows
   checkout, which this session did not perform (no `node_modules` present;
   installing was out of scope for a read-only harness analysis).
