// design/lint.mjs
//
// Hardcoded-literal scanner for Phase 6 success criterion 1: "a test fails if
// a colour, radius or duration appears hardcoded outside [the token file] in
// the new surfaces". No Electron/Windows renderer exists yet (Phase 7 has not
// run), so `NEW_SURFACE_DIRS` currently names only the one real surface that
// does exist today — `design/` (the gallery). Phase 7 appends its renderer
// directory here when it lands; this module does not need to change shape,
// only the directory list. Every directory named here MUST exist and be
// readable: `walk()` throws on a missing/unreadable directory instead of
// treating it as "nothing to scan yet" (round-2 review finding 1) — a
// misspelled or stale NEW_SURFACE_DIRS entry is a bug to surface loudly, not
// a silent green suite that scanned zero files.
//
// Scope: only CSS *style contexts* are scanned — `.css` files in full, and
// `<style>` blocks / `style="..."` attributes inside `.html` files. Plain
// text content (a swatch displaying "the dark value is #080301" as a label
// for a human to read) is deliberately NOT scanned; that is documentation,
// not a hardcoded style declaration, and the gallery's entire purpose is to
// display token values as text.

import { readdirSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

export const NEW_SURFACE_DIRS = ["design"];

// Files that ARE the token source (or mechanically generated from it) are
// allowlisted — they are definitionally full of the literals every other new
// surface must not hardcode. `design/build-gallery.mjs` is deliberately NOT
// here: it is a generator/consumer of the tokens, not the token source
// itself, and its own tool-chrome literals (page background, badge pills,
// the caveat callout color) live in the allowlisted `gallery-chrome.mjs`
// instead (round-2 review finding 2), so build-gallery.mjs stays subject to
// this same scan like any other new-surface file.
//
// Matched by repo-relative path (forward-slash, computed from this file's
// own location via import.meta.url — never a basename compare), so a future
// surface directory containing a file that happens to share a basename with
// one of these (e.g. a nested "tokens.mjs") is NOT silently exempted.
export const ALLOWLISTED_PATHS = [
  "design/tokens.mjs",
  "design/tokens.generated.css",
  "design/gallery-chrome.mjs",
  "design/lint.mjs",
];

const SCANNABLE_EXT = new Set([".html", ".css", ".js", ".mjs"]);

// Not exported with its `g` flag intact for point-checks: a shared global
// regex object mutates `lastIndex` across `.test()` calls, which silently
// breaks repeated single-value checks (round-2 review advisory on finding 3).
// `findViolationsInRegion` below uses it only via `String.matchAll`, which
// the spec requires to clone the regex per call, so reuse there is safe;
// `hasColorLiteral` instead builds a fresh non-global regex per call.
// Round-3 review finding 3: the hex/rgb() alternation missed every other
// modern color-function syntax. hsl()/hsla(), oklch() and lab() are added
// here, free-floating like hex/rgb — their syntax (a function call with a
// fixed name immediately followed by `(`) is unambiguous enough that it does
// not need property-scoping the way bare named-color keywords do below.
const COLOR_LITERAL_SOURCE =
  "#[0-9a-fA-F]{3,8}\\b|rgba?\\([^)]*\\)|hsla?\\([^)]*\\)|oklch\\([^)]*\\)|lab\\([^)]*\\)";
const COLOR_LITERAL_RE = new RegExp(COLOR_LITERAL_SOURCE, "g");

/** True if `value` contains a #hex, rgb()/rgba(), hsl()/hsla(), oklch() or lab() color literal. Safe to call repeatedly. */
export function hasColorLiteral(value) {
  return new RegExp(COLOR_LITERAL_SOURCE).test(value);
}

// CSS Color Module Level 4 named-color keywords (the full extended/X11 set,
// "transparent" included, "currentcolor" excluded — it resolves to another
// property's computed value, not a hardcoded literal). Deliberately checked
// ONLY inside color-property declaration values (see COLOR_PROPERTY_RE
// below), never free-floating over a whole region: several of DeckTech's
// own real token names contain these words as substrings (`--dt-red`,
// `--dt-green`), and this codebase's own comments use prose like
// "near-black"/"near-white" — a free-floating `\b(red|white|...)\b` scan
// would false-positive on both (round-3 review finding 3 evidence).
const NAMED_COLORS = [
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black",
  "blanchedalmond", "blue", "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse",
  "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan",
  "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki", "darkmagenta",
  "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen",
  "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink",
  "deepskyblue", "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen",
  "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "grey", "green",
  "greenyellow", "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender",
  "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral", "lightcyan",
  "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink", "lightsalmon",
  "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue",
  "lightyellow", "lime", "limegreen", "linen", "magenta", "maroon", "mediumaquamarine",
  "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue",
  "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream",
  "mistyrose", "moccasin", "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange",
  "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise", "palevioletred",
  "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "purple", "rebeccapurple",
  "red", "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell",
  "sienna", "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow", "springgreen",
  "steelblue", "tan", "teal", "thistle", "tomato", "transparent", "turquoise", "violet", "wheat",
  "white", "whitesmoke", "yellow", "yellowgreen",
];
const NAMED_COLOR_RE = new RegExp(`\\b(?:${NAMED_COLORS.join("|")})\\b`, "i");

// Color-ish properties whose value is worth scanning for a bare named-color
// keyword. Longhand border-*-color forms are covered by `border[-a-z]*color`
// the same way the radius matcher covers border-*-radius longhands below.
const COLOR_PROPERTY_RE =
  /(?:^|[{;])\s*(?:color|background(?:-color)?|border[-a-z]*color|outline-color|fill|stroke|box-shadow|text-shadow)\s*:\s*([^;}"']+)/gi;

// Strips every `--custom-property-name` substring (not the whole var(...)
// call — a fallback literal like `var(--dt-token, red)` must stay scannable)
// before the named-color scan, so a token reference such as `var(--dt-red)`
// or `var(--dt-green)` — real DeckTech token names — is never mistaken for
// the literal keyword "red"/"green". `--dt-red-fallback` style names using
// other color words are covered the same way, uniformly, for both the bare
// and the fallback var() form.
const CUSTOM_PROP_NAME_RE = /--[a-zA-Z0-9-]+/g;

function stripCustomPropNames(value) {
  return value.replace(CUSTOM_PROP_NAME_RE, " ");
}

// Matches a bare `var(--token)` reference with NO fallback (no comma inside
// the parens). Used to strip legitimate var() usage out of a captured
// declaration value before checking what's left for a hardcoded literal.
// Deliberately does NOT strip `var(--token, <fallback>)`: a fallback value
// is itself a literal written directly into the surface, and stripping it
// would resurrect the exact "var() anywhere suppresses the whole value"
// escape this scanner exists to close (round-2 review finding 1).
const BARE_VAR_REF_RE = /var\(\s*--[a-zA-Z0-9-]+\s*\)/gi;

function stripBareVarRefs(value) {
  return value.replace(BARE_VAR_REF_RE, " ");
}

// A radius value left over after stripping var() refs that is only zeros
// ("0", "0px", "0%", "0 0", ...) carries no design literal worth flagging —
// e.g. `border-radius: var(--dt-r-control) var(--dt-r-control) 0 0;` is a
// fully token-driven declaration whose trailing corners are legitimately 0.
const BARE_ZERO_RE = /^(0(px|%)?\s*)+$/;

function extractStyleRegions(content, ext) {
  if (ext === ".css") return [content];
  if (ext === ".html") {
    const regions = [];
    for (const m of content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      regions.push(m[1]);
    }
    for (const m of content.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)) {
      regions.push(m[1]);
    }
    for (const m of content.matchAll(/\sstyle\s*=\s*'([^']*)'/gi)) {
      regions.push(m[1]);
    }
    return regions;
  }
  // .js/.mjs: a future surface could assemble CSS in a template string —
  // scan the whole file body.
  return [content];
}

// Declaration-value capture: everything after the property/colon up to the
// next `;`, the next `}`, or a quote — whichever comes first — or, absent
// any of those, the end of the region. Crucially this does NOT require a
// terminator to be present (the round-2 review's finding 1: the idiomatic
// single-line CSS form `.x { border-radius: 12px }` has no trailing `;`) and
// does NOT stop at a newline (a multi-line shorthand like
// `transition: var(--x) ease,\n  color 300ms ease;` must stay one capture,
// or the `300ms` on the second line is never examined at all).
const DECL_VALUE = "[^;}\"']+";

function findViolationsInRegion(text) {
  const out = [];
  for (const m of text.matchAll(COLOR_LITERAL_RE)) {
    out.push({ category: "color", match: m[0] });
  }
  // Round-3 review finding 3: the old `border-radius` literal missed every
  // longhand corner property (`border-top-left-radius`, ...) because those
  // insert "top-left"/etc. BETWEEN "border" and "radius", breaking the plain
  // substring match. `[-a-z]*border[-a-z]*radius` covers the shorthand, all
  // four logical/physical longhands, and vendor-prefixed forms
  // (`-webkit-border-radius`) in one pattern.
  for (const m of text.matchAll(new RegExp(`[-a-z]*border[-a-z]*radius\\s*:\\s*(${DECL_VALUE})`, "gi"))) {
    const stripped = stripBareVarRefs(m[1]).trim();
    if (stripped && !BARE_ZERO_RE.test(stripped) && /[0-9]/.test(stripped)) {
      out.push({ category: "radius", match: m[0].trim() });
    }
  }
  // Round-3 review finding 3: `-delay` added alongside `-duration` so
  // `transition-delay`/`animation-delay` are no longer invisible to the scan.
  for (const m of text.matchAll(
    new RegExp(`(?:transition|animation)(?:-duration|-delay)?\\s*:\\s*(${DECL_VALUE})`, "gi"),
  )) {
    const stripped = stripBareVarRefs(m[1]);
    if (/\d+(\.\d+)?(ms|s)\b/.test(stripped)) {
      out.push({ category: "duration", match: m[0].trim() });
    }
  }
  // Round-3 review finding 3: a bare CSS named-color keyword (`color: red;`)
  // was invisible — the old scan only matched #hex and rgb()/rgba(). Scoped
  // to color-ish properties (see COLOR_PROPERTY_RE) and with custom-property
  // names stripped first, so `var(--dt-red)` / `var(--dt-green)` — real
  // DeckTech token references — are never mistaken for the keyword.
  for (const m of text.matchAll(COLOR_PROPERTY_RE)) {
    const stripped = stripCustomPropNames(m[1]);
    if (NAMED_COLOR_RE.test(stripped)) {
      out.push({ category: "color", match: m[0].trim() });
    }
  }
  return out;
}

function walk(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    // A NEW_SURFACE_DIRS entry that doesn't resolve to a readable directory
    // is a configuration bug, not "nothing to scan yet". Every lint test
    // asserts `violations === []`, so silently returning `files` here would
    // make a renamed/mistyped directory pass as clean (round-2 review
    // finding 1's vacuity note) — throw instead.
    throw new Error(`design/lint.mjs: cannot read surface directory "${dir}": ${err.code || err.message}`);
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, files);
    } else if (SCANNABLE_EXT.has(path.extname(full))) {
      files.push(full);
    }
  }
  return files;
}

function isAllowlisted(file) {
  const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/");
  return ALLOWLISTED_PATHS.includes(rel);
}

/**
 * @param {string[]} absoluteDirs directories to walk (path.join'd by callers)
 * @returns {{file: string, category: "color"|"radius"|"duration", match: string}[]}
 */
export function scanForHardcodedTokenLiterals(absoluteDirs) {
  const violations = [];
  for (const dir of absoluteDirs) {
    for (const file of walk(dir)) {
      if (isAllowlisted(file)) continue;
      const content = readFileSync(file, "utf8");
      const ext = path.extname(file);
      for (const region of extractStyleRegions(content, ext)) {
        for (const v of findViolationsInRegion(region)) {
          violations.push({ file, ...v });
        }
      }
    }
  }
  return violations;
}
