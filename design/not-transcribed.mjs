// design/not-transcribed.mjs
//
// DES-05 + DES-06 (Phase 6, .maxvision/ROADMAP.md success criterion 5;
// requirement text .maxvision/REQUIREMENTS.md:101-102) — the derivation
// record.
//
// This file exists because Dokke's Mac app (mac/Sources/*.swift) is dead
// code and drifted code alongside live code, and dead/drifted code reads
// exactly like specification to whoever ports it next. `design/tokens.mjs`
// is the single source of truth for values that WERE transcribed; this file
// is the matching record of values that were deliberately NOT — one entry
// per symbol named in ROADMAP.md Phase 6 criterion 5, plus two more
// (`DockStore.filteredInstalled` / `.filter`) the same requirement's prose
// calls out. Every claim below was re-verified against the current source
// during this task (see `test/des-05-06-derivation-record.test.mjs`, which
// greps the live mac/Sources files and fails if any of them drift) — none
// of it is copied from .maxvision/research/DESIGN-LANGUAGE.md without
// re-reading the cited line.
//
// `kind` distinguishes two different failure modes a reviewer must not
// conflate:
//   - "dead-code": the symbol has zero call sites (or, for `filter`, its
//     only reader has zero call sites). Transcribing it would bake in a
//     value nothing in the running app ever produces.
//   - "wrong-scope": the symbol IS live and DOES execute, but transcribing
//     its value under the name/role a skim-reader would assume ("the tile
//     radius") would be wrong — the value is real, just scoped to something
//     narrower than it looks.
//   - "unsamplable-semantic": the symbol is a macOS *semantic* SwiftUI
//     style, not a color literal. It carries no fixed value in source at
//     all — it resolves at runtime from environment/user state — so there
//     is no value to sample even in principle, not merely no value
//     available on this (Windows) machine.
//
// `literal` is the numeric/color literal DeckTech must NOT copy, or `null`
// when the whole point of the entry is that no literal exists to copy.
// Nothing in this file assigns a hex or rgb/rgba color value to
// `.quaternary` or `.accentColor` — see the guard test asserting exactly
// that.

/** @typedef {"dead-code"|"wrong-scope"|"unsamplable-semantic"} NotTranscribedKind */

/**
 * @typedef {Object} NotTranscribedEntry
 * @property {string} symbol
 * @property {string} source - repo-relative `path:line[-line]`
 * @property {NotTranscribedKind} kind
 * @property {number|string|null} literal - the value NOT to transcribe, or null
 * @property {string} reason
 */

/** @type {NotTranscribedEntry[]} */
export const NOT_TRANSCRIBED = [
  {
    symbol: "DockStore.filteredInstalled",
    source: "mac/Sources/DockStore.swift:139-150",
    kind: "dead-code",
    literal: null,
    reason:
      "Computed property (sorts `installed` pinned-first, then filters by " +
      "`filter`). Declared once at line 139 and never read anywhere else in " +
      "mac/Sources — no view, no other computed property, nothing calls " +
      "`store.filteredInstalled`. It ships in the binary but nothing on " +
      "screen is driven by it; transcribing its pin-first sort behaviour " +
      "into DeckTech's app picker would bake in an ordering rule the Mac " +
      "app itself never actually applies.",
  },
  {
    symbol: "DockStore.filter",
    source: "mac/Sources/DockStore.swift:32",
    kind: "dead-code",
    literal: null,
    reason:
      "`@Published var filter` has exactly one reader in the whole file: " +
      "`filteredInstalled` (line 140, `filter.trimmingCharacters(...)`). " +
      "Nothing else reads or writes it, and its one reader is itself dead " +
      "(see `DockStore.filteredInstalled` above) — so `filter` is " +
      "transitively dead, not independently unreferenced. Precise framing " +
      "matters: `grep filter mac/Sources/DockStore.swift` also matches " +
      "the live `.filter { ... }` Array method call at line 149, which is " +
      "an unrelated Swift stdlib call, not a second use of this property.",
  },
  {
    symbol: "ContentView.customTrafficLights",
    source: "mac/Sources/ContentView.swift:98-117",
    kind: "dead-code",
    literal: null,
    reason:
      "A hand-drawn HStack of 3 colored circles (close/minimize/zoom) with " +
      "tap gestures wired to `NSApp.keyWindow`. Declared once at line 98 " +
      "and never referenced by `body` or by anything else in the file — " +
      "the window's real traffic lights are the OS-drawn ones (the app " +
      "only reserves clearance for them via TrafficLightsClearanceReader). " +
      "DO NOT transcribe the three RGB literals this view fills its " +
      "circles with: they were never rendered by the shipped app, so they " +
      "are not evidence of a chosen color for anything, let alone for " +
      "Windows caption buttons which have no macOS-traffic-light analog.",
  },
  {
    symbol: "ContentView.sidebarChromeRadius",
    source: "mac/Sources/ContentView.swift:30",
    kind: "wrong-scope",
    literal: 20,
    reason:
      "`private let sidebarChromeRadius: CGFloat = 20` is declared once at " +
      "line 30 and never read anywhere else in ContentView.swift — the " +
      "sidebar's actual chrome shape hardcodes the literal 20 nowhere and " +
      "the literal 18 in four separate places instead: `RoundedRectangle" +
      "(cornerRadius: 18, ...)` at lines 170 and 174, `.glassEffect(.regular, " +
      "in: .rect(cornerRadius: 18))` at line 172 (macOS 26+ branch), and " +
      "`RoundedRectangle(cornerRadius: 18, ...).strokeBorder(...)` at " +
      "lines 179-180 (the visible 1px outline in both branches). So this " +
      "isn't dead code in the usual sense — the sidebar chrome DOES render " +
      "a rounded rect — it's a same-file naming trap: a property named " +
      "for exactly this purpose exists, is never wired up, and quietly " +
      "disagrees with the four literals that actually draw the shape. The " +
      "real, rendered sidebar-chrome radius is 18, not the 20 this " +
      "property's name and declared value would suggest to a reader who " +
      "greps for `sidebarChromeRadius` instead of for what `body` draws.",
  },
  {
    symbol: "DockIcon.cornerRadius",
    source: "mac/Sources/DockIcon.swift:473 (declaration); :598, :647 (use)",
    kind: "wrong-scope",
    literal: 20,
    reason:
      "Unlike the two entries above, this one is LIVE: `private let " +
      "cornerRadius: CGFloat = 20` (line 473) clips the 68pt inner app " +
      "icon image at line 598 (`iconWithEffects`: `.frame(width: iconSize, " +
      "height: iconSize).clipShape(RoundedRectangle(cornerRadius: " +
      "cornerRadius))`, iconSize = 68 at line 471) and the fallback " +
      "initial-letter tile at line 647. It executes on every render. But " +
      "it is NOT the radius of the card a user actually perceives as 'the " +
      "icon': the visible 80x80 card (iconCardSize, line 472) is drawn by " +
      "`iconCardSurface`/`iconCardBorder`, which hardcode the literal 28 " +
      "independently at lines 477, 482, 485, 506 and 547 — never reading " +
      "`cornerRadius` either. The 68pt inner image sits inside the 80pt " +
      "card with 6pt padding (68 + 6 + 6 = 80), so 20 rounds the corners " +
      "of artwork the user sees through a further 28-radius mask; the two " +
      "numbers describe two different, nested shapes. Transcribing 20 as " +
      "\"the DeckTech tile radius\" would apply the inner-image value to " +
      "the outer card DeckTech actually needs to match — the visible card " +
      "radius is 28.",
  },
  {
    symbol: ".quaternary",
    source:
      "mac/Sources/AppPickerSheet.swift:367; " +
      "mac/Sources/ContentView.swift:370,422,547",
    kind: "unsamplable-semantic",
    literal: null,
    reason:
      "`.quaternary` is `HierarchicalShapeStyle.quaternary` (SwiftUI docs, " +
      "developer.apple.com/documentation/swiftui/shapestyle/" +
      "quaternary-swift.type.property, via context7 " +
      "/websites/developer_apple_swiftui): it 'maps to the fourth level of " +
      "the current foreground style, or to the fourth level of the default " +
      "foreground style if you haven't set a foreground style in the " +
      "view's environment.' There is no color literal anywhere in Dokke's " +
      "source for it to carry — it is defined as a relationship to " +
      "whatever foreground style is active at each of its 4 call sites, " +
      "which can legitimately resolve differently at each site and changes " +
      "with system appearance/accessibility settings (e.g. Increase " +
      "Contrast) independent of light/dark mode. A single sampled pixel " +
      "from one screenshot would capture one resolved instance at one " +
      "call site under one system configuration, not the token.",
  },
  {
    symbol: ".accentColor",
    source: "mac/Sources/AppPickerSheet.swift:114 (opacity .8), :189 (opacity .85)",
    kind: "unsamplable-semantic",
    literal: null,
    reason:
      "`Color.accentColor` resolves to the app's accent color, and Apple's " +
      "own docs for the `accentColor(_:)` view modifier (context7 " +
      "/websites/developer_apple_swiftui) state: 'In macOS, SwiftUI only " +
      "applies accent color customization if the user selects Multicolor " +
      "under General > Accent color in System Preferences' — i.e. absent " +
      "an override, it tracks the SIGNED-IN USER'S system preference, not " +
      "a value the app author picked. This repo confirms Dokke never " +
      "overrides it: no `AccentColor` entry in any `.xcassets` asset " +
      "catalog (there is no `.xcassets` anywhere under mac/) and no " +
      "`.tint(...)` modifier anywhere in mac/Sources (verified by grep). " +
      "That makes `.accentColor` unsamplable IN PRINCIPLE, not merely " +
      "unavailable on this Windows machine: even a macOS screenshot only " +
      "ever captures one particular user's current accent-color choice at " +
      "capture time, never a fixed design value. The only transcribable " +
      "part of these two call sites is the opacity multiplier applied on " +
      "top (`.opacity(0.8)` / `.opacity(0.85)`), not the base color.",
  },
];

/**
 * @param {string} needle - substring to match against `symbol`
 * @returns {NotTranscribedEntry|undefined}
 */
export function findNotTranscribed(needle) {
  return NOT_TRANSCRIBED.find((e) => e.symbol.includes(needle));
}
