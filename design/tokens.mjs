// design/tokens.mjs
//
// DES-01 + DES-02 (Phase 6, .maxvision/ROADMAP.md) — single source of truth for
// DeckTech's design tokens.
//
// PROVENANCE RULE (regra zero — nunca afirmar sem validar):
//   - Every DARK value below is TRANSCRIBED, not re-derived, from
//     `.maxvision/research/DESIGN-LANGUAGE.md` §12 ("Tokens DeckTech should
//     standardise on"). `dark.source` is either the repo `path:line` already
//     cited inline next to the token in that section, or — for the handful of
//     tokens §12 declares without an inline citation (the glass-tile gradient,
//     the 14-step spacing scale, the 3 font stacks) — the DESIGN-LANGUAGE.md
//     section:line where the research document itself explains/authors that
//     value. No value here was recalled or invented from scratch.
//   - LIGHT values do not exist anywhere upstream. DESIGN-LANGUAGE.md §8 is
//     explicit: "There is no light/dark system. Every product surface is
//     hard-locked to dark... Option (b) [a real semantic token layer] is the
//     right long-term call but is net-new work with no upstream precedent —
//     do not let anyone claim it as a port." D11 (REQUIREMENTS.md) and DES-02
//     require a *complete* light theme precisely because none exists to
//     transcribe. Every `light.value` below is therefore AUTHORED, computed by
//     the single mechanical rule in `deriveLightFromDark()`: invert each color
//     literal's HSL lightness (L' = 1 - L), keep hue, saturation and alpha
//     unchanged. This is documented, reproducible, and applied uniformly —
//     no per-token aesthetic judgment. `light.basis` says so on every entry
//     instead of carrying a fabricated path:line.
//   - Known limitation, disclosed rather than hidden: mechanical lightness
//     inversion is the right move for ground/ink pairs (a warm near-black
//     canvas inverts to a warm near-white one) but produces a WHITE glow for
//     tokens that are conventionally dark in both themes (the three elevation
//     shadows, `--dt-glass-inset`, `--dt-glass-bloom`). That is flagged per
//     token below (`light.caveat`) and is a placeholder for a follow-up visual
//     design pass, not a claim that the light shadow ramp is final.
//
// COUNT DISCREPANCY (disclosed, not silently resolved): REQUIREMENTS.md DES-01
// and ROADMAP.md Phase 6 criterion 1 both say "the 50 tokens from the
// research". The actual §12 code block declares 63 distinct `--dt-*` custom
// properties (verified: `sed -n '687,759p' DESIGN-LANGUAGE.md | grep -oE
// -- '--dt-[a-z0-9-]+:' | sort -u | wc -l` → 63; of those, 45 carry an inline
// `/* path:line */` comment, 1 (`--dt-glass-tile`) is cited in prose in §0/§4
// instead, and 18 (the 14 spacing steps + 3 font stacks) are declared without
// a per-token citation because §5.3/§6.1 explain them as a single synthesized
// group rather than one citation each). All 63 are transcribed here as the
// single source of truth, because §12 presents itself as the complete,
// canonical list ("Tokens DeckTech should standardise on") and the roadmap
// goal is "uma fonte única de verdade" — splitting it would reintroduce the
// drift this phase exists to remove. The "50" figure is not reconciled by
// this file; it is called out here and in this task's `unresolved[]` output.

// ---------------------------------------------------------------------------
// Color math — the one mechanical rule used to derive every light value.
// ---------------------------------------------------------------------------

function clamp255(v) {
  return Math.min(255, Math.max(0, v));
}

function hexToRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3 || h.length === 4) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { r, g, b };
}

function rgbToHex({ r, g, b }) {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.round(clamp255(v)).toString(16).padStart(2, "0"))
      .join("")
  );
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  };
}

function invertHexLightness(hex) {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  return rgbToHex(hslToRgb(h, s, 1 - l));
}

function invertRgbaLiteral(literal) {
  const inner = literal.slice(literal.indexOf("(") + 1, literal.lastIndexOf(")"));
  const parts = inner.split(",").map((s) => s.trim());
  const [r, g, b] = parts.slice(0, 3).map(Number);
  const alpha = parts.length > 3 ? parts[3] : null;
  const { h, s, l } = rgbToHsl(r, g, b);
  const inv = hslToRgb(h, s, 1 - l);
  const rr = Math.round(clamp255(inv.r));
  const gg = Math.round(clamp255(inv.g));
  const bb = Math.round(clamp255(inv.b));
  return alpha !== null ? `rgba(${rr},${gg},${bb},${alpha})` : `rgb(${rr},${gg},${bb})`;
}

// Matches every #hex / rgb()/rgba() literal in a CSS value string.
const COLOR_LITERAL_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

/**
 * Derive a light-theme value from a dark-theme CSS value by inverting the
 * HSL lightness of every color literal it contains (hue, saturation and
 * alpha are preserved). Non-color text (gradient angles, "inset", px
 * offsets, "55%" stops) passes through unchanged.
 */
export function deriveLightFromDark(darkValue) {
  return darkValue.replace(COLOR_LITERAL_RE, (literal) =>
    literal.startsWith("#") ? invertHexLightness(literal) : invertRgbaLiteral(literal),
  );
}

// ---------------------------------------------------------------------------
// Token kinds
// ---------------------------------------------------------------------------

export const TOKEN_KINDS = Object.freeze({
  COLOR: "color", // value contains a color literal — requires light+dark pair (D11)
  ANGLE: "angle",
  BLUR: "blur",
  RADIUS: "radius",
  SPACE: "space",
  EASING: "easing",
  DURATION: "duration",
  FONT: "font",
});

const LIGHT_BASIS =
  "authored-for-light (DES-02/D11) — HSL lightness invert (L'=1-L, hue/saturation/alpha " +
  "preserved) of the transcribed dark value; no upstream light-theme source exists " +
  "(DESIGN-LANGUAGE.md:506-525, §8: \"There is no light/dark system\")";

const DL = ".maxvision/research/DESIGN-LANGUAGE.md";

/**
 * @typedef {Object} ColorToken
 * @property {string} name
 * @property {"color"} kind
 * @property {{value: string, source: string}} dark
 * @property {{value: string, basis: string, caveat?: string}} light
 *
 * @typedef {Object} PlainToken
 * @property {string} name
 * @property {string} kind
 * @property {string} value
 * @property {string} source
 */

function color(name, darkValue, darkSource, opts = {}) {
  return {
    name,
    kind: TOKEN_KINDS.COLOR,
    dark: { value: darkValue, source: darkSource },
    light: {
      value: deriveLightFromDark(darkValue),
      basis: LIGHT_BASIS,
      ...(opts.caveat ? { caveat: opts.caveat } : {}),
    },
  };
}

function plain(name, kind, value, source) {
  return { name, kind, value, source };
}

const SHADOW_CAVEAT =
  "mechanical lightness-invert turns a dark contact shadow into a light glow; " +
  "shadows conventionally stay dark-based in both themes — revisit in a design-polish pass, not shipped as final";

// ---------------------------------------------------------------------------
// The 63 tokens declared in DESIGN-LANGUAGE.md §12 (see COUNT DISCREPANCY above)
// ---------------------------------------------------------------------------

export const TOKENS = [
  // --- ground -----------------------------------------------------------
  color("--dt-canvas", "#080301", "public/index.html:38"),
  color("--dt-canvas-mac", "#292120", "mac/Sources/DokkeTheme.swift:4"),
  color("--dt-page", "#1B1107", "mac/Sources/DokkeTheme.swift:5"),
  color("--dt-ember-1", "rgba(232,111,39,.46)", "public/index.html:68"),
  color("--dt-ember-2", "rgba(184,76,20,.28)", "public/index.html:69"),
  color("--dt-ground-top", "#241106", "public/index.html:70"),
  color("--dt-ground-mid", "#150804", "public/index.html:70"),

  // --- ink ----------------------------------------------------------------
  color("--dt-ink", "rgba(255,255,255,.94)", "public/index.html:21"),
  color("--dt-ink-2", "rgba(255,255,255,.62)", "public/index.html:22"),
  color("--dt-ink-3", "rgba(255,255,255,.50)", "public/index.html:23"),

  // --- semantic -------------------------------------------------------------
  color("--dt-accent", "#0a84ff", "public/index.html:24"),
  color("--dt-accent-alt", "#0A63D9", "mac/Sources/DokkeTheme.swift:6"),
  color("--dt-green", "#30d158", "public/index.html:25"),
  color("--dt-amber", "#ffd60a", "public/index.html:26"),
  color("--dt-red", "#ff453a", "public/index.html:27"),
  color("--dt-red-text", "#ff837d", "public/index.html:621"),

  // --- glass ----------------------------------------------------------------
  plain("--dt-glass-angle", TOKEN_KINDS.ANGLE, "160deg", "public/index.html:253"),
  plain(
    "--dt-glass-angle-chrome",
    TOKEN_KINDS.ANGLE,
    "165deg",
    "public/index.html:622",
  ),
  color(
    "--dt-glass-tile",
    "linear-gradient(160deg, rgba(255,255,255,.24), rgba(210,95,30,.18) 55%, rgba(35,16,8,.75))",
    "public/index.html:251-258",
  ),
  color("--dt-glass-border", "rgba(240,135,55,.40)", "public/index.html:254"),
  color(
    "--dt-glass-inset",
    "inset 0 1.5px 0 rgba(255,255,255,.35)",
    "public/index.html:255",
    { caveat: SHADOW_CAVEAT },
  ),
  color("--dt-glass-bloom", "0 0 18px rgba(210,95,30,.22)", "public/index.html:255", {
    caveat: SHADOW_CAVEAT,
  }),
  plain(
    "--dt-blur-chrome",
    TOKEN_KINDS.BLUR,
    "blur(18px) saturate(150%)",
    "public/index.html:668",
  ),
  plain(
    "--dt-blur-modal",
    TOKEN_KINDS.BLUR,
    "blur(24px) saturate(145%)",
    "public/index.html:629",
  ),
  plain(
    "--dt-blur-scrim",
    TOKEN_KINDS.BLUR,
    "blur(20px) saturate(150%)",
    "public/index.html:700",
  ),

  // --- elevation --------------------------------------------------------------
  color("--dt-elev-1", "0 8px 18px rgba(0,0,0,.45)", "public/index.html:255", {
    caveat: SHADOW_CAVEAT,
  }),
  color("--dt-elev-2", "0 14px 40px rgba(0,0,0,.45)", "public/index.html:671", {
    caveat: SHADOW_CAVEAT,
  }),
  color("--dt-elev-3", "0 24px 60px rgba(0,0,0,.55)", "public/index.html:627", {
    caveat: SHADOW_CAVEAT,
  }),

  // --- radii — proportional first ----------------------------------------------
  plain("--dt-r-tile", TOKEN_KINDS.RADIUS, "0.29", "public/index.html:164"),
  plain("--dt-r-tile-icon", TOKEN_KINDS.RADIUS, "0.19", "public/index.html:166"),
  plain("--dt-r-icon-scale", TOKEN_KINDS.RADIUS, "0.84", "public/index.html:165"),
  plain("--dt-r-card", TOKEN_KINDS.RADIUS, "40px", "mac/Sources/DockGridView.swift:202"),
  plain("--dt-r-tile-mac", TOKEN_KINDS.RADIUS, "28px", "mac/Sources/DockIcon.swift:477"),
  plain(
    "--dt-r-sidebar",
    TOKEN_KINDS.RADIUS,
    "18px",
    "mac/Sources/ContentView.swift:170",
  ),
  plain("--dt-r-modal", TOKEN_KINDS.RADIUS, "28px", "public/index.html:625"),
  plain("--dt-r-sheet", TOKEN_KINDS.RADIUS, "30px", "public/index.html:594"),
  plain("--dt-r-auth", TOKEN_KINDS.RADIUS, "32px", "public/index.html:706"),
  plain("--dt-r-control", TOKEN_KINDS.RADIUS, "16px", "public/index.html:615"),
  plain("--dt-r-row", TOKEN_KINDS.RADIUS, "6px", "mac/Sources/ContentView.swift:148"),

  // --- spacing — 2px base, authored by the research doc itself (§5.3) --------------
  plain("--dt-s-1", TOKEN_KINDS.SPACE, "4px", `${DL}:323-324`),
  plain("--dt-s-2", TOKEN_KINDS.SPACE, "6px", `${DL}:323-324`),
  plain("--dt-s-3", TOKEN_KINDS.SPACE, "8px", `${DL}:323-324`),
  plain("--dt-s-4", TOKEN_KINDS.SPACE, "10px", `${DL}:323-324`),
  plain("--dt-s-5", TOKEN_KINDS.SPACE, "12px", `${DL}:323-324`),
  plain("--dt-s-6", TOKEN_KINDS.SPACE, "14px", `${DL}:323-324`),
  plain("--dt-s-7", TOKEN_KINDS.SPACE, "16px", `${DL}:323-324`),
  plain("--dt-s-8", TOKEN_KINDS.SPACE, "18px", `${DL}:323-324`),
  plain("--dt-s-9", TOKEN_KINDS.SPACE, "20px", `${DL}:323-324`),
  plain("--dt-s-10", TOKEN_KINDS.SPACE, "22px", `${DL}:323-324`),
  plain("--dt-s-11", TOKEN_KINDS.SPACE, "24px", `${DL}:323-324`),
  plain("--dt-s-12", TOKEN_KINDS.SPACE, "28px", `${DL}:323-324`),
  plain("--dt-s-13", TOKEN_KINDS.SPACE, "32px", `${DL}:323-324`),
  plain("--dt-s-14", TOKEN_KINDS.SPACE, "40px", `${DL}:323-324`),

  // --- motion --------------------------------------------------------------------
  plain(
    "--dt-ease",
    TOKEN_KINDS.EASING,
    "cubic-bezier(.22,.61,.36,1)",
    "public/index.html:244",
  ),
  plain(
    "--dt-ease-settle",
    TOKEN_KINDS.EASING,
    "cubic-bezier(.22,1,.36,1)",
    "public/index.html:2599",
  ),
  plain("--dt-dur-micro", TOKEN_KINDS.DURATION, "160ms", "public/index.html:320"),
  plain("--dt-dur-fast", TOKEN_KINDS.DURATION, "180ms", "public/index.html:596"),
  plain("--dt-dur-base", TOKEN_KINDS.DURATION, "220ms", "public/index.html:2703"),
  plain("--dt-dur-snap", TOKEN_KINDS.DURATION, "250ms", "public/index.html:2574"),
  plain("--dt-dur-press", TOKEN_KINDS.DURATION, "300ms", "public/index.html:244"),

  // --- type --------------------------------------------------------------------
  plain(
    "--dt-font-ui",
    TOKEN_KINDS.FONT,
    '"Inter", -apple-system, "SF Pro Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
    `public/index.html:46; docs/src/style.css:11-12; mac/Sources/** (system-only) — synthesized, see ${DL}:330-338 (§6.1 Families)`,
  ),
  plain(
    "--dt-font-display",
    TOKEN_KINDS.FONT,
    '"Bricolage Grotesque", var(--dt-font-ui)',
    `public/index.html:394,528,631 — see ${DL}:330-338 (§6.1 Families)`,
  ),
  plain(
    "--dt-font-mono",
    TOKEN_KINDS.FONT,
    'ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace',
    `${DL}:758 — authored directly in §12; no per-surface mono-font-family citation exists ` +
      "elsewhere in the research (monospace USAGE is cited at public/index.html:729-735 and " +
      "mac/Sources/ContentView.swift:386,545, but not a font-family stack)",
  ),
];

export const COLOR_TOKENS = TOKENS.filter((t) => t.kind === TOKEN_KINDS.COLOR);
export const NON_COLOR_TOKENS = TOKENS.filter((t) => t.kind !== TOKEN_KINDS.COLOR);

export function findToken(name) {
  return TOKENS.find((t) => t.name === name);
}
