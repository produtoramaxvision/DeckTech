// design/gallery-chrome.mjs
//
// Presentation constants for the gallery TOOL's own chrome — page
// background, card border, badge pill, swatch placeholder, and the
// light/dark caveat callout color. These are explicitly NOT DeckTech design
// tokens (kept out of design/tokens.mjs on purpose: the gallery is a devtool
// rendering the tokens, not a product surface that should ever cite itself
// as a design source) but they are still isolated in their own module,
// rather than declared inline in design/build-gallery.mjs, for one reason:
// so build-gallery.mjs needs NO lint allowlist exemption and stays subject
// to the exact same hardcoded-literal scan as every other new surface
// (round-2 review finding 2 — the prior allowlist entry for build-gallery.mjs
// let 11 hardcoded literals ship unlinted under a comment that didn't
// describe what was actually being exempted).
//
// This file IS allowlisted (design/lint.mjs ALLOWLISTED_PATHS) because it is
// definitionally the one place these tool-chrome literals are declared —
// the same relationship design/tokens.mjs has to the DeckTech tokens
// themselves.

export const CHROME_VARS = {
  "--gallery-chrome-page-bg": "#efefef",
  "--gallery-chrome-text": "#111111",
  "--gallery-chrome-lede": "#444444",
  "--gallery-chrome-card-bg": "rgba(127,127,127,.08)",
  "--gallery-chrome-border": "#dddddd",
  "--gallery-chrome-badge-bg": "#dddddd",
  "--gallery-chrome-swatch-base": "#808080",
  "--gallery-chrome-source": "#555555",
  "--gallery-chrome-pill-radius": "999px",
};

// Theme-scoped so the warning color keeps AA-ish contrast against BOTH the
// near-black dark panel and the near-white light panel, instead of one fixed
// hex compromising on both.
export const CHROME_CAVEAT_BY_THEME = {
  dark: "#ffb37a", // light amber on a near-black canvas
  light: "#7a3900", // burnt-amber on a near-white canvas
};
