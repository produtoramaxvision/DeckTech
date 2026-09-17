# Android Companion — Surface Analysis

Repo: `decktech` (fork of Dokke v0.2.8). Surface owned: everything under `android/`.
All claims below are traced to `path:line` in files actually read with `Read`, or to
commands actually executed (build, unit tests, real-device install) on 2026-09-17.

## 1. What this app is

`android/app/src/main/java/com/dokke/app/MainActivity.kt` is a single-Activity,
no-framework (no Jetpack Compose, no Fragments) WebView shell. It loads the Dokke
PWA (`../public/index.html`, served by `server.js` on the host) full-screen and
adds native-only chrome: an offline/error panel, an app-update flow, haptics and
language bridging via a JS interface. Per `android/README.md`, "nenhum código da
UI é reescrito" — the dock UI itself lives entirely in the PWA, not in this
surface.

Files read in full:
- `android/app/src/main/java/com/dokke/app/MainActivity.kt` (669 lines)
- `android/app/src/main/java/com/dokke/app/DokkeDiscovery.kt` (72 lines)
- `android/app/src/main/java/com/dokke/app/ServerUrl.kt` (77 lines)
- `android/app/src/main/java/com/dokke/app/DokkeConnectionStore.kt` (27 lines)
- `android/app/src/main/java/com/dokke/app/AndroidLanguage.kt` (78 lines)
- `android/app/src/main/java/com/dokke/app/UpdateVersion.kt` (31 lines)
- `android/app/src/main/AndroidManifest.xml`
- `android/app/build.gradle`, `android/build.gradle`, `android/gradle.properties`,
  `android/gradle/wrapper/gradle-wrapper.properties`, `android/settings.gradle`
- `android/app/src/main/res/values/{strings,server_url,themes}.xml`
- All 4 files under `android/app/src/test/java/com/dokke/app/`
- `android/README.md`

Total Kotlin: 954 lines (`MainActivity.kt` 669, `AndroidLanguage.kt` 78,
`ServerUrl.kt` 77, `DokkeDiscovery.kt` 72, `UpdateVersion.kt` 31,
`DokkeConnectionStore.kt` 27).

## 2. WebView setup — every setting applied

All at `MainActivity.kt:113–155` (`onCreate`):

- `WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON` (:117) — screen stays awake
  only while the Activity window is visible (comment at :116 makes this explicit;
  no wake-lock survives backgrounding).
- Edge-to-edge + auto-hide system bars, swipe-to-reveal
  (`BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`, :118–122) — immersive fullscreen.
- `WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)` (:123) — chrome://inspect
  only in debug builds, correctly gated off `BuildConfig.DEBUG`, not a manual flag.
- `web.settings` block (:144–154):
  - `javaScriptEnabled = true`
  - `domStorageEnabled = true`
  - `cacheMode = WebSettings.LOAD_DEFAULT`
  - `useWideViewPort = true`, `loadWithOverviewMode = true`
  - `databaseEnabled = true`
  - `allowFileAccess = false`, `allowContentAccess = false` — no `file://`/content
    URI access from the page, standard WebView hardening.
  - `javaScriptCanOpenWindowsAutomatically = false`
- `web.setBackgroundColor(Color.BLACK)` (:155) — avoids a white flash before the
  PWA paints.
- `web.clearCache(true)` (:207) called unconditionally on every launch — the PWA
  never serves a stale cached asset across app restarts, at the cost of a full
  re-fetch every cold start (no explicit justification comment; likely deliberate
  given the "Dokke closed" auto-heal design, but it is a real cost on a LAN
  round-trip each time).
- `web.webViewClient` (:156–197) overrides `shouldOverrideUrlLoading` (both the
  `WebResourceRequest` and legacy `String` overloads), `onPageStarted`,
  `onPageFinished`, `onReceivedError` — see §4/§5 below.
- `web.webChromeClient` (:198–206): logs every console message to Logcat tag
  `Dokke` (`onConsoleMessage`, :199–202) and auto-confirms JS `confirm()` dialogs
  (`onJsConfirm`, :203–205) rather than blocking on a native dialog.
- JS bridge `DokkeAndroid` (`addJavascriptInterface`, :208–244) exposes 5 methods
  to page script: `hideKeyboard()`, `performHapticFeedback()`,
  `setLoginPortrait(enabled)`, `appVersion()`, `requestUpdate(version)`. This is
  the update-consent entry point (§7) and the haptics entry point (§6).

**Cleartext + bridge coupling.** `AndroidManifest.xml` sets
`android:usesCleartextTraffic="true"` application-wide (not scoped by a Network
Security Config `<domain-config>`), matching the app's LAN-HTTP design intent
(README: "Aceita cert local... para não travar em HTTP"). Navigation is
origin-locked (`ServerUrl.isSameOrigin`, used at `MainActivity.kt:168` and
`:272`), and `validateDownloadedApk` (:472–527) checks package name, version
name/code and signing-certificate equality before ever installing anything.
Given that, the practical residual risk is narrower than "cleartext WebView with
a JS bridge" sounds in isolation: an attacker would need to get script executing
*inside the already-authenticated Dokke origin* (e.g. via a compromised/malicious
host) to reach `DokkeAndroid.requestUpdate()` — at which point they could already
serve arbitrary dock content. Worth flagging, not urgent.

## 3. LAN discovery — protocol, ports, timeouts, retry

Implemented across `DokkeDiscovery.kt` (protocol) and `MainActivity.kt:298–359`
(orchestration). Verified against the **server-side** implementation in
`server.js` (repo root) — this is not a one-sided read:

| Aspect | Android client | Server (`server.js`) | Match |
|---|---|---|---|
| Discovery port | UDP `3001` (`MainActivity.kt:317`) | `DISCOVERY_PORT = 3001` (`server.js:169`) | yes |
| Magic string | `"dokke:discover"` (`DokkeDiscovery.kt:9`) | `DISCOVERY_MAGIC = "dokke:discover"` (`server.js:170`) | yes |
| Reply format | regex `^dokke:(ipv4):(\d{1,5})$` (`DokkeDiscovery.kt:11`) | `` `dokke:${ip}:${portHint}` `` (`server.js:203`) | yes |
| Health path | `GET /health`, only `/` or empty path accepted (`DokkeDiscovery.kt:24–32`) | `if (url.pathname === "/health") … {"ok":true,"service":"Dokke"}` (`server.js:377`) | yes |
| Health body | exact-match regex `^\{"ok":true,"service":"Dokke"\}$` (`DokkeDiscovery.kt:12`, whitespace-tolerant only around the literal characters) | `JSON.stringify({ ok: true, service: "Dokke" })` (`server.js:377`) — JS preserves key insertion order, so this always serializes to exactly `{"ok":true,"service":"Dokke"}` | yes, but brittle (see §9) |

Flow (`MainActivity.kt:298–341`, runs on a background `Thread`, never the UI
thread):
1. Bind a `DatagramSocket` with `soTimeout = 1500` ms, `broadcast = true`.
2. Build a target list: always `255.255.255.255`, plus
   `DokkeDiscovery.directedBroadcast()` (:311) if it resolves — the broadcast
   address of the **first active, non-loopback IPv4 interface** found by
   iterating `NetworkInterface.getNetworkInterfaces()` (`DokkeDiscovery.kt:46–66`).
3. For each target, up to 2 send attempts, each followed by a receive loop bounded
   by a 1500 ms deadline (:313–336).
4. Every reply is parsed by `DokkeDiscovery.parseReply` (regex + `isValidIpv4`,
   `DokkeDiscovery.kt:15–21`) and only accepted after a **separate** HTTP
   `GET /health` round trip (`verifyDokkeServer`, `MainActivity.kt:344–359`,
   `connectTimeout = 1200`, `readTimeout = 1200`) confirms the exact health
   contract. UDP alone never changes `serverUrl`.
5. Total worst-case discovery budget: 2 targets × 2 attempts × 1.5 s ≈ 6 s of UDP
   listening, plus up to ~1.2 s per health check — **≈ 7–8 s**, bounded and
   non-blocking of the UI thread.
6. `discoverServer` is invoked twice in normal flow: once unconditionally in
   `onCreate` (:248–250) and once in `retryConnection` (:636–638). In both cases
   its result reaches `acceptDiscoveredServer` (:285–295), which normalizes the
   candidate, and swaps `serverUrl` + persists it (§4) only if it differs from
   the current one, then calls `web.loadUrl(found)`.

**Asymmetric guard — confirmed by reading, not inferred.** The `onCreate` path
gates the swap behind `!currentServerHealthy()` (:249) — "an already-working
server should not be hijacked by a bogus LAN responder," per the code comment at
:246–247. `retryConnection`'s call (:636–638) has **no such guard** — it calls
`acceptDiscoveredServer(found)` unconditionally, even if the currently configured
`serverUrl` is fine. The self-heal path in `onReceivedError` (:190–195) *does*
carry the guard. So the guard is present in 2 of 3 call sites and silently
absent from the user-initiated "Tentar novamente" button — a real inconsistency,
though its blast radius is small (worst case: a spoofed local responder that also
passes the `/health` contract could redirect a user who explicitly taps retry
while already connected).

**Directed-broadcast risk, observed live on this device.** The validation device
(Galaxy S10e) is reached over Tailscale, i.e. it has a `tun`/VPN interface. If
`NetworkInterface.getNetworkInterfaces()` enumerates that interface before Wi-Fi,
`directedBroadcast()` (`DokkeDiscovery.kt:46–66`) computes a directed broadcast
address for the *wrong* subnet, and the deliberate second broadcast target
degrades to a no-op. This doesn't break discovery outright — the global
`255.255.255.255` target is always sent first and is typically enough on a flat
home LAN — but on a segmented/VLAN'd or VPN-carrying network it silently loses
the "networks that drop the global broadcast" fallback the code comment at
`MainActivity.kt:309` says it exists for.

## 4. Connection persistence

`DokkeConnectionStore.kt` — the entire persistence surface is 27 lines wrapping
a plain `SharedPreferences("prefs", 0)` (`MainActivity.kt:62`) under one key,
`server_url` (`DokkeConnectionStore.kt:7`).

- `read()` (:9–16): reads the raw string, re-validates it through
  `ServerUrl.normalize`, and **self-heals a corrupt prefs entry** — if the stored
  value no longer normalizes, it is deleted from prefs on read (:12–14), not just
  ignored. Returns the canonical normalized form, never the raw stored string.
- `save()` (:18–26): normalizes first; `null` result removes the key instead of
  writing garbage (:20–22); otherwise persists the canonical form.
- Every write path in `MainActivity` funnels through `ServerUrl.normalize`
  (`ServerUrl.kt:14–35`) before it ever reaches storage or `WebView.loadUrl`:
  scheme restricted to `http`/`https` (:8), userinfo (`user:pass@`) rejected
  (:62), host required and lower-cased (:61,68–71), fragments rejected on the
  persisted form (`rejectFragment = true` at the `normalize` call, :16), raw
  input capped at 2048 chars (:15). This is the same class validated in
  `ServerUrlTest.kt` (javascript:, file://, credentials-in-URL, out-of-range
  port all rejected).
- Load order at startup (`MainActivity.kt:137–141`): baked-in
  `res/values/server_url.xml` fallback → overwritten by
  `DokkeConnectionStore.read()` if present → overwritten again by an
  `Intent` extra `server_url` if the launching Intent carries one (testable via
  `adb shell am start --es server_url ...`, explicitly called out in the README
  as intentional). The Intent-extra path is **not** blindly trusted for
  `onNewIntent` (§ below) but **is** blindly trusted (only URL-shape validated,
  no live health check) on the initial `onCreate` launch (:141,
  `applyServerUrl(it, persist = true)` — no `verifyDokkeServer` call in this
  branch). `onNewIntent` (:361–380) is stricter: it requires the live
  `verifyDokkeServer` health check before accepting an Intent-supplied URL,
  specifically to stop "qualquer activity exportada" from hijacking a saved
  connection (comment at :365–366). The asymmetry (unverified on cold start,
  verified on redelivery) is real but low severity — `MainActivity` is
  `exported=true` with `singleTask` launch mode (manifest), so a malicious app
  *can* cold-start it with an arbitrary `server_url` extra and have it loaded
  without a health check, though only `http(s)` URLs pass `ServerUrl.normalize`
  at all (no `javascript:`/`file:` scheme reaches `loadUrl`).

## 5. Offline screen and failure handling

Offline UI is built once, natively, in `buildOfflinePanel()`
(`MainActivity.kt:550–627`) — a `LinearLayout` with app icon, title, description,
a status pill, a "Tentar novamente" button and a hint line, all styled by hand
(no XML layout, no Material components) using `AndroidLanguage` strings.

Trigger path: `WebViewClient.onReceivedError` (:181–196) — only acts on
main-frame errors (`request?.isForMainFrame == true`, :185). On such an error it
(a) sets `mainFrameFailed = true` and calls `showOfflineScreen()` on the UI
thread, and (b) if the error code is one of `netErrors`
(`HOST_LOOKUP, CONNECT, TIMEOUT, UNKNOWN, BAD_URL` — `MainActivity.kt:107–111`)
and self-heal hasn't already run this session (`!healed`, :190), kicks off
`discoverServer` once to look for the server elsewhere on the LAN.

**Confirmed on real hardware — the offline screen is slow to appear, not
instant.** With no Dokke server reachable at the configured
`http://192.168.1.5:3000` (device is on a different network via Tailscale), 3
screenshots were taken: at launch (loader spinning), ~8 s later (still
spinning — by the code's own bounded budget (§3) the ~7 s discovery attempt
had already finished by then; Logcat at that point showed no `Dokke`-tagged
lines yet either way, so nothing — in the UI or in the log — reflected that
discovery had already given up), and ~90 s after launch, where Logcat showed
`E Dokke: WebView error: net::ERR_CONNECTION_TIMED_OUT (-8) url=http://192.168.1.5:3000/`
and the screen had switched to the "O Dokke está fechado no computador" panel
with the pt-BR strings correctly rendered.

**This is a real gap, not a hypothesis:** `discoverServer`'s own ~7–8 s bounded
result is never wired to the UI — `onResult` only flips `serverUrl` when a
server is actually found (`acceptDiscoveredServer`, :285), it does nothing on a
negative result at either `onCreate` (:248–250) or `retryConnection`
(:636–638) call site. There is no watchdog/timeout between `web.loadUrl()` and
`onReceivedError`; the user is left looking at an indeterminate spinner for
however long the OS/WebView networking stack takes to give up on an unroutable
RFC1918 address (observed here: on the order of a minute), even though the app
itself already knows within ~7 s that no Dokke server answered on the LAN.

Recovery paths, both re-entrant and idempotent:
- `retryConnection()` (:629–639): resets `healed`/`mainFrameFailed`, hides the
  panel, re-shows the loader, reloads `serverUrl` (or re-shows offline if empty),
  and re-runs discovery.
- `onResume()` (:385–395): on every resume after the first (`firstResume` flag,
  :384/393), if the offline panel is visible it calls `retryConnection()`;
  otherwise it unconditionally calls `web.reload()` — i.e. **every time the user
  backgrounds and returns to the app while online, the PWA does a full reload**,
  not just a re-render. This is a real cost (re-runs PWA boot/auth/state) on
  every app-switch return, not just after a genuine disconnect.
- `self-heal` flag `healed` (:64, set at :190, only reset in `retryConnection` at
  :630) — the automatic (non-button) self-heal via `onReceivedError` fires **at
  most once per process lifetime** unless the user taps retry.

**Copy is a known-risk mismatch, and the PRD itself already flags the cause.**
`offline.title`/`offline.description` (`AndroidLanguage.kt:27–28,52–53`) both
say the *computer* is closed / needs Dokke opened. The offline panel has no way
to distinguish "host app not running" from "host running but UDP/HTTP blocked by
firewall" — and the Windows-host PRD's own risk table (§8 below) explicitly
calls out Windows Firewall as a likely blocker for exactly this traffic. On
Windows, "closed on the computer" copy will often be wrong; the real cause will
be a firewall prompt the user hasn't approved.

## 6. Haptics

Single entry point: JS interface method `performHapticFeedback()`
(`MainActivity.kt:217–227`), callable from the PWA via
`DokkeAndroid.performHapticFeedback()`. Runs on the UI thread
(`runOnUiThread`), calls `web.performHapticFeedback(...)` with
`HapticFeedbackConstants.CONTEXT_CLICK` on API ≥ 23 (M) or
`VIRTUAL_KEY` as the pre-M fallback (:220–224). No native gesture triggers
haptics on their own — it's entirely PWA-driven, one-shot, no pattern/intensity
control (Android's `performHapticFeedback` API doesn't expose those on the
constants used).

## 7. Language detection

`AndroidLanguage.kt` — a hand-rolled two-locale (`pt-BR` / `en`) string table
used only for native-chrome copy (offline panel + update dialogs); the PWA itself
presumably has its own i18n, out of scope here.

`current(context)` (:69–77): reads `resources.configuration.locales[0]` on API
≥ 24 (N) or the deprecated single `.locale` below that, and buckets to `"pt-BR"`
if `locale.language.equals("pt", ignoreCase = true)`, else `"en"`. **Any**
Portuguese variant (`pt-PT`, `pt-AO`, etc.) is treated as `pt-BR` copy — not a
bug given the product's target market, but worth naming since the constant is
literally called `pt-BR`. `text()` (:59–67) resolves
`(if pt-BR then portuguese[key] else english[key]) ?: portuguese[key] ?: key`
(:61–63). Since both maps currently have identical key sets (verified by
reading both blocks in full), the `?: portuguese[key]` fallback is dead code
today — it can only fire when the primary lookup (`english[key]` on a
non-pt-BR device) returns `null`, which never happens while the key sets
match. It becomes a latent trap the day someone adds a key to `portuguese`
without adding the matching key to `english`: an English-locale user would
then silently get Portuguese copy instead of falling through to the raw key
string, with no build-time or test-time signal. Confirmed live on the S10e: the device's locale is pt-BR and the
captured offline screen shows the exact Portuguese strings from
`AndroidLanguage.kt:27–31` ("O Dokke está fechado no computador",
"Computador desconectado", "Tentar novamente", etc.) — this is a live,
on-device confirmation of the language path, not just a source read.

## 8. Update / APK consent flow

Driven from PWA → `DokkeAndroid.requestUpdate(version)` (`MainActivity.kt:241–243`)
→ `beginUpdate(version)` (:407–433):

1. Reject if a download is already in flight (`updateDownloadId != null`, :408).
2. `UpdateVersion.releaseTag(version)` (`UpdateVersion.kt:10–13`) validates the
   version string against `^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$`
   (`UpdateVersion.kt:4`) and canonicalizes to `vX.Y.Z`; anything else is
   rejected with `update.invalidVersion` copy.
3. `UpdateVersion.isNewer(versionName, BuildConfig.VERSION_NAME)` (:418) —
   numeric per-segment comparison (`compare`, `UpdateVersion.kt:15–24`), missing
   segments treated as 0. Rejects same-or-older versions with `update.current`.
4. Install-permission gate: `canInstallPackages()` (:435–437) —
   `SDK_INT < O (26)` is always true (pre-Oreo had no such permission), else
   `packageManager.canRequestPackageInstalls()`. If false, the request is
   deferred (`pendingUpdateVersion`) behind a native `AlertDialog` asking the
   user to open Settings (`ACTION_MANAGE_UNKNOWN_APP_SOURCES`, :439–449) —
   this **is** the human consent gate the task asks about: no download starts
   without either (a) the OS already granting install-from-unknown-sources for
   this app, or (b) the user explicitly following the dialog to Settings and
   granting it, after which `onResume()` (:387–392) resumes the pending update
   automatically once permission is detected.
5. `enqueueUpdate(version)` (:451–470): uses Android's `DownloadManager` (not a
   hand-rolled downloader) to fetch
   `https://github.com/felipenalves/Dokke/releases/download/<tag>/dokke.apk`
   (`updateApkBaseUrl` at :70, concatenated at :458) into
   app-external-files `Downloads/dokke-update-<version>.apk`, with a visible
   system download notification (`VISIBILITY_VISIBLE_NOTIFY_COMPLETED`).
6. On `DownloadManager.ACTION_DOWNLOAD_COMPLETE` (`updateReceiver`, :72–105,
   registered `RECEIVER_NOT_EXPORTED` on both the Tiramisu API and the
   `ContextCompat` back-compat path, :397–405 — correctly non-exported, no other
   app can spoof this broadcast), the receiver checks download status, then
   calls `validateDownloadedApk(uri)` (:472–527) before ever installing:
   - copies the downloaded content into `cacheDir` to get a real file path
     (:474–476);
   - reads the archive's manifest via `getPackageArchiveInfo` with
     `GET_SIGNING_CERTIFICATES` (P+) / `GET_SIGNATURES` (legacy) (:478–484);
   - rejects if `packageName != packageName` (:485), i.e. protects against a
     malicious/mismatched APK being served at that URL;
   - rejects if the archive isn't actually newer than the installed
     `VERSION_NAME` (:487–488) and if it doesn't match the version the app
     itself requested (`updateExpectedVersion`, :489–491);
   - rejects if `archiveCode <= installedCode` by version **code**, not just
     name (:494–506);
   - finally, `signaturesMatch()` (:516–527) requires the downloaded APK's
     signer set to equal the installed app's signer set — **this is a real
     supply-chain guard**: even a byte-identical-looking APK with a different
     signing key is rejected before install.
7. Only after all of the above does `installDownloadedApk(uri)` (:529–544) fire
   `Intent.ACTION_VIEW` with `FLAG_GRANT_READ_URI_PERMISSION` — handing off to
   the **stock Android package installer UI**, which is itself another,
   OS-level user-consent screen. So the flow has two independent consent points:
   the app's own unknown-sources dialog (step 4) and the OS installer's own
   confirmation (step 7); DeckTech's code never silently installs anything.

**Found while reading, not previously flagged:** `updateReceiver.onReceive`
(:72–105) calls `manager.query(...)` and immediately does
`cursor.moveToFirst()` without null-checking the `Cursor` itself (:78–81); if
`query()` ever returns `null` (documented as possible, if unlikely, for a
`ContentResolver`-backed query), this throws `NullPointerException` on
`moveToFirst()`, and the `finally { cursor.close() }` (:101–103) would then
throw a second NPE on top of it. Low likelihood (this is a system content
provider, not user input), but there is no guard here at all.

## 9. Permissions requested

From `AndroidManifest.xml` (full file read):
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
```
- `INTERNET` — required for the WebView and the UDP/HTTP discovery sockets.
- `ACCESS_NETWORK_STATE` — declared, but `grep -rn "ConnectivityManager\|NetworkInfo\|activeNetwork\|ACCESS_NETWORK_STATE" android/app/src/main/java/` (run against all 6 Kotlin files) returns no matches: nothing in this surface's own code calls `ConnectivityManager` or reads network-state APIs. Likely present for WebView-internal use or as a forward-looking declaration, not exercised by any code in `android/`.
- `REQUEST_INSTALL_PACKAGES` — the normal-protection-level permission backing
  `packageManager.canRequestPackageInstalls()` (§8); no dangerous/runtime
  permissions (camera, location, storage, notifications) are requested anywhere.
  No runtime permission-request flow exists in the code because none is needed
  under this permission set.

Manifest also declares `android:usesCleartextTraffic="true"` app-wide (§2) and
the single Activity as `exported="true"`, `launchMode="singleTask"`,
`configChanges="orientation|screenSize|keyboardHidden"` (so rotation doesn't
recreate the Activity/WebView — orientation lock for login is handled instead
via the JS-bridge `setLoginPortrait` at `MainActivity.kt:228–237`).

## 10. Compatibility facts — read directly from Gradle, not inferred

From `android/app/build.gradle`:
- `compileSdk = 34`
- `minSdk = 21`, `targetSdk = 34`
- `versionCode = 11`, `versionName = "0.2.8"`
- `sourceCompatibility`/`targetCompatibility` = `JavaVersion.VERSION_17`,
  `kotlinOptions.jvmTarget = "17"`

From `android/build.gradle`:
- Android Gradle Plugin `8.2.2`
- Kotlin `1.9.22`

From `android/gradle/wrapper/gradle-wrapper.properties`:
- Gradle `8.5`

### Does this build and run on a Galaxy S10e / Android 12 (SDK 31)?

**Yes — empirically verified on this exact machine and this exact connected
device, not inferred from the version numbers alone.**

- Device identity, read live via `adb shell getprop`:
  `ro.product.model=SM-G970F`, `ro.product.manufacturer=samsung`,
  `ro.build.version.release=12`, `ro.build.version.sdk=31` — this **is** the
  Galaxy S10e on Android 12 / SDK 31 the task named, connected wirelessly at
  `100.125.203.58:36403` (Tailscale-routed adb, `adb devices` showed
  `device` state, i.e. authorized and ready).
- `minSdk 21 ≤ 31 ≤ targetSdk 34` — inside the declared support range, no
  manifest `<uses-sdk>` override.
- `cd android && ./gradlew assembleDebug` — **BUILD SUCCESSFUL in 1m 4s, 35
  actionable tasks: 35 executed.** (Required first setting `JAVA_HOME` to the
  installed JDK 17 at `C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot` — the
  machine's default `JAVA_HOME` pointed at a JDK 8 install, which this project
  cannot compile with given `jvmTarget = "17"` — and `ANDROID_HOME` to
  `C:\Users\MaxVision\AppData\Local\Android\Sdk`, which was unset in this shell.
  Gradle then auto-downloaded SDK Platform 34 and Build-Tools 34.0.0, since only
  `android-37.0` was pre-installed.)
- `./gradlew testDebugUnitTest` — **BUILD SUCCESSFUL**; JUnit XML results read
  directly from `app/build/test-results/testDebugUnitTest/*.xml`: **10 tests, 0
  failures, 0 errors** across `DokkeConnectionStoreTest` (1),
  `DokkeDiscoveryTest` (3), `ServerUrlTest` (3), `UpdateVersionTest` (3).
- `adb install -r app/build/outputs/apk/debug/app-debug.apk` on the S10e →
  `Success`.
- `adb shell am start -n com.dokke.app/.MainActivity` → launched;
  `dumpsys activity activities` confirmed
  `mResumedActivity: ActivityRecord{... com.dokke.app/.MainActivity ...}` —
  the app is the actual foreground/resumed activity on the real device, not
  just "installed."
- `logcat` filtered for `AndroidRuntime:E` and for `dokke.app` + `fatal|crash|ANR`
  over the whole session: **no crash, no ANR.** The only `dokke.app`-tagged
  lines were Play Protect's routine `Finsky` verification scan.
- 3 screenshots taken over ~90 s (see §5) show the expected UI states in order
  — indeterminate loader → still loading → offline panel with correct pt-BR
  copy — with no visual corruption, no blank/black-only frame beyond the
  initial load, and the app icon, title, description, status pill and retry
  button all rendering as coded in `buildOfflinePanel()`.

This is as close to "proven" as a same-session check gets: real hardware, real
install, real foreground state, real logcat, real screenshots — not a
simulator and not a version-number inference.

## 11. What a Windows host changes for this surface

**Verified against the actual PRD and implementation plan, and against the
actual shared server code — not assumed.**

- PRD `docs/plans/2026-08-18-dokke-windows-host-prd.md` §4 (non-goals) states
  explicitly: "substituir ou reescrever o companion Android/iPhone" is *not*
  part of this product. §RF-07 (Conexão) states the host "deve manter HTTP
  local, WebSocket, descoberta UDP e autenticação por PIN compatíveis com o
  protocolo atual do Dokke. O companion não deve precisar de um fluxo Windows
  específico." This is a direct requirement that the Android surface needs
  **zero code changes** for Windows-host support.
- That requirement is credible, not aspirational: the discovery/health
  implementation Android talks to (`server.js` at repo root — magic string,
  port 3001, reply format, `/health` body, all read and cross-checked in §3) is
  the **same cross-platform Node file** the Windows implementation plan modifies
  in place (`docs/plans/.../implementation-plan.md` lists `Modify: server.js`
  twice, never "replace" or "new Windows-only server"). It uses only Node
  built-ins (`dgram`, `os.networkInterfaces()`), nothing macOS-specific, so the
  wire contract Android depends on is architecturally OS-agnostic already.
- The one real, PRD-acknowledged risk that **does** touch this surface: PRD §15
  risk table, row "Firewall": "UDP/HTTP podem ser bloqueados por perfil de
  rede" on Windows. If Windows Firewall (or a corporate/AV firewall profile)
  blocks inbound UDP 3001 or the chosen HTTP port until the user approves a
  prompt, Android's discovery (§3) and even a manually-entered
  `server_url` will both fail identically to "server unreachable," and the
  companion will show the "fechado no computador" copy (§5) even though the
  host app is running — a real, user-facing incorrect-diagnosis risk that
  belongs to this surface even though the fix (firewall prompt UX, or a
  clearer offline-copy state that distinguishes "not running" from
  "unreachable") lives partly on the Windows-host side and partly in
  `AndroidLanguage.kt`/the offline-panel logic.
- No code in `android/` references macOS-specific paths, cert stores, or
  APIs — everything is plain WebView + `java.net`/`java.io`. No changes needed
  in `ServerUrl.kt`, `DokkeDiscovery.kt`, or `DokkeConnectionStore.kt` for a
  Windows host per se; §9's `assembleRelease`/signing story
  (`DOKKE_RELEASE_*` env/Gradle properties, checked in `app/build.gradle`) is
  also host-OS-independent — it's a Windows *developer machine* building the
  Android APK, which is exactly what this analysis just did successfully (§10).

## 12. Rebrand points (Dokke → DeckTech) on this surface

Split explicitly by coupling, because one class of rename silently breaks the
wire protocol and the other doesn't:

**Safe / local-only (rename freely, no cross-surface coordination needed):**
- `applicationId`/`namespace = "com.dokke.app"` (`app/build.gradle:34,36`) and
  the package directory `android/app/src/main/java/com/dokke/app/`
- `rootProject.name = "Dokke"` (`settings.gradle`)
- `app_name` string = `"Dokke"` (`res/values/strings.xml`)
- Release signing property names `DOKKE_RELEASE_STORE_FILE`,
  `DOKKE_RELEASE_STORE_PASSWORD`, `DOKKE_RELEASE_KEY_ALIAS`,
  `DOKKE_RELEASE_KEY_PASSWORD` (`app/build.gradle:9-14`)
- Logcat tag `"Dokke"` used throughout `MainActivity.kt` (e.g. :184, :261, :281,
  :291, :375, :509)
- All `AndroidLanguage.kt` copy — both language maps say "Dokke" in every string
- `themes.xml` name `AppTheme` — cosmetic, unaffected either way

**Requires coordinated dual-accept migration (breaks discovery if renamed on
only one side):**
- `DokkeDiscovery.MAGIC = "dokke:discover"` (`DokkeDiscovery.kt:9`) — must match
  `DISCOVERY_MAGIC` in `server.js:170` exactly, byte-for-byte, on the wire.
- The `replyPattern` prefix `^dokke:` (`DokkeDiscovery.kt:11`) — must match the
  `` `dokke:${ip}:${port}` `` template in `server.js:203`.
- `healthPattern`'s literal `"service":"Dokke"` value
  (`DokkeDiscovery.kt:12`) — must match `service: "Dokke"` in the server's
  `/health` response (`server.js:377`) **exactly**, because the regex is a
  full-string exact match (`healthPattern.matches(body)`,
  `DokkeDiscovery.kt:37`), not a substring/JSON-parse check. Renaming the
  service label to `"DeckTech"` on the server without updating this regex (or
  vice versa) makes every Android client stop recognizing any host as a valid
  Dokke/DeckTech server, silently, with no error surfaced beyond the generic
  offline panel.
- `updateApkBaseUrl = "https://github.com/felipenalves/Dokke/releases/download"`
  (`MainActivity.kt:70`) and the fixed asset filename `dokke.apk`
  (`MainActivity.kt:458`, `"$updateApkBaseUrl/$releaseTag/dokke.apk"`) — both
  hardcode the upstream GitHub org/repo and artifact name; a DeckTech fork needs
  this pointed at its own release repo/asset name, or the entire in-app update
  flow (§8) silently 404s.

A safe migration path for the coupled group: have the server (and any future
Windows host) accept **both** the old and new magic string / health `service`
value for a deprecation window, or ship the string as a value the client reads
from `/health` itself rather than hardcoding a regex against it — out of scope
to design here, but the two-tier list above is what a rename plan needs to
start from.

## 13. Test coverage — what's covered, what isn't

The 4 test files under `android/app/src/test/java/com/dokke/app/` are plain
JVM unit tests (JUnit 4, `testImplementation("junit:junit:4.13.2")` in
`app/build.gradle`) with zero Android framework or Robolectric dependency —
they only exercise pure-Kotlin logic classes:

- `ServerUrlTest.kt` — normalization, rejection of unsafe schemes/URLs,
  same-origin checks, external-URL classification. Good coverage of the
  security-relevant surface in `ServerUrl.kt`.
- `DokkeDiscoveryTest.kt` — reply parsing (valid/invalid), health URL/contract
  matching, and a dedicated regression test
  (`healthPatternEscapesClosingObjectBraceForAndroidIcu`) asserting the regex
  source literally contains an escaped `\}` — a real prior Android-ICU
  regex-engine bug being guarded against via reflection on the private field.
- `DokkeConnectionStoreTest.kt` — save/read round-trip and invalid-value
  cleanup, via a hand-written `FakePreferences`/`FakeEditor` (no
  Robolectric/instrumentation needed).
- `UpdateVersionTest.kt` — version comparison and release-tag canonicalization.

**Not covered by any test:** all of `MainActivity.kt` (669 of the surface's 954
lines, 70%) — WebView configuration, the offline-panel lifecycle, the
update-download/consent/validation pipeline, the update-receiver, haptics,
language-bridge wiring, and the discovery-orchestration/retry logic living
outside `DokkeDiscovery`/`ServerUrl` (e.g. the `currentServerHealthy()` guard
asymmetry found in §3). `DokkeDiscovery.directedBroadcast()`'s bit-manipulation
(`DokkeDiscovery.kt:46-66`) — the single most error-prone piece of arithmetic on
this surface — has no unit test either. There is no instrumentation
(`androidTest`) suite and no Robolectric dependency in `app/build.gradle`, so
none of the `MainActivity` behavior can currently be exercised without a real
or emulated device (which is exactly what §10 did manually, once, for this
report).

## Visual contract checklist

PRD §7 ("Contrato visual obrigatório") is written entirely about the **Windows
host window** (title, sidebar, Apps grid, app picker, Connect screen) — it does
not enumerate Android-native requirements. It is included here only to the
extent it's traceable to this surface:

- [x] "estados equivalentes de carregando, vazio, offline, erro e sucesso"
      (PRD §7, last bullet) — Android provides a native **loading** state
      (`ProgressBar` loader, `MainActivity.kt:126`) and a native **offline/error**
      state (`buildOfflinePanel()`, :550–627), both confirmed rendering
      correctly on real hardware (§5, §10). "Vazio" and "sucesso" states are
      the PWA's dock UI itself (grid/app-picker/Connect screen), loaded inside
      the WebView and **out of scope for this surface** — the PRD's own §7
      preamble and the README ("nenhum código da UI é reescrito") both confirm
      Android does not implement or duplicate that chrome; it only hosts it.
- [ ] Sidebar (Apps/Conectar), 4×2 app grid, page indicators, app picker,
      Connect screen (PIN/URL/QR/device count) — **not applicable to this
      native surface.** These are PRD §7 requirements on the **Windows host's
      own window**, rendered by the PWA when loaded on any client including
      Android's WebView; nothing here is coded natively in `android/`.
- [x] Immersive full-screen chrome consistent with the product's dark theme —
      `themes.xml` background `#0a0a12`, `WebView` background `Color.BLACK`
      (`MainActivity.kt:155`), system bars hidden with swipe-to-reveal
      (:118–122) — visually confirmed in all 3 device screenshots (§5, §10).
- [x] Offline panel matches the product's dark/orange accent language — icon,
      title, description, status pill (dark red/orange, `roundedBackground`,
      :594), retry button (orange fill `#ef6c43`, :607) — all confirmed
      rendering as coded in the screenshot taken at ~90 s post-launch (§5).
- [ ] **Gap found, not in PRD but relevant to "estados equivalentes":** there is
      no intermediate "still trying / discovery finished, server not found"
      state between the loader and the eventual OS-timeout-triggered offline
      panel (§5) — a real UX gap in the loading→offline transition that the
      PRD's "estados equivalentes" bullet implicitly calls for but this surface
      doesn't yet deliver within a reasonable time bound.

## Summary of the strongest findings

1. **Confirmed on real hardware, not just read:** the offline panel can take on
   the order of a minute to appear even though the app's own bounded LAN
   discovery already knows within ~7–8 s that no server answered — no watchdog
   ties the two together (`MainActivity.kt:248-250, 298-341, 550-627`).
2. **`retryConnection()`'s discovery-accept path lacks the
   `currentServerHealthy()` guard** that `onCreate`'s and the self-heal path
   have (`MainActivity.kt:636-638` vs. `:248-250` and `:190-195`) — an
   inconsistency in an otherwise carefully-guarded flow.
3. **The wire protocol (`dokke:discover`, port 3001, exact `/health` body) is
   cross-verified against `server.js`, the same file the Windows-host
   implementation plan modifies in place** — this is strong, direct evidence
   that RF-07's "companion needs zero Windows-specific changes" claim holds,
   not just PRD text taken on faith.
4. **The update pipeline's supply-chain guard is real and layered:**
   package-name, version-name, version-code, and **signing-certificate**
   equality are all checked before any install intent fires
   (`MainActivity.kt:472-527`), on top of the stock Android installer's own
   confirmation — two independent consent/verification layers, not one.
5. **Rename risk is asymmetric and must be split**: `applicationId`,
   `app_name`, and all `AndroidLanguage` copy are safe local renames; the UDP
   magic string, reply prefix, and the exact `/health` JSON body are a shared
   wire contract with `server.js` that breaks discovery silently if only one
   side is renamed (§12).
6. **Build/test/device validation is empirical, on this exact task's named
   device:** `assembleDebug` succeeded, all 10 JUnit tests passed (0
   failures), and the APK installed, launched, stayed resumed, and rendered
   correctly with zero crashes/ANRs on the connected Galaxy S10e (SM-G970F,
   Android 12, SDK 31) over adb.
