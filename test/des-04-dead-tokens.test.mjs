import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// DES-04 — "Eliminate dead tokens that read as spec."
//
// public/index.html:root declared `--glass: rgba(255,255,255,.07)` and
// `--edge: rgba(255,255,255,.10)`, and docs/src/style.css:root declared
// `--purple: #9653f4`. None of the three had a single `var(...)` reference
// anywhere in their file — the real glass styling (`.aglass` in
// public/index.html) is hardcoded per component with different values
// entirely (a warm orange-tinted gradient, not a flat translucent white),
// so wiring the token up would have meant inventing a design the app does
// not actually ship. In a project whose whole Phase 6 goal is a single
// source of truth for design values (design/tokens.mjs), a declared-but-
// unused token reads as an authoritative spec to the next implementer —
// dangerous when it is actually just fork debris from upstream Dokke.
//
// Deletion, not wiring, is the fix: this guards against either token
// reappearing (a revert, or a copy-paste from the upstream fork) without
// anyone noticing it is once again dead weight.

const indexHtmlPath = fileURLToPath(new URL("../public/index.html", import.meta.url));
const styleCssPath = fileURLToPath(new URL("../docs/src/style.css", import.meta.url));

test("DES-04: public/index.html declares no --glass or --edge custom property", async () => {
  const html = await readFile(indexHtmlPath, "utf8");
  assert.doesNotMatch(
    html,
    /--glass\s*:/,
    "public/index.html must not declare a dead --glass token — the real glass styling is hardcoded in .aglass",
  );
  assert.doesNotMatch(
    html,
    /--edge\s*:/,
    "public/index.html must not declare a dead --edge token — the real border styling is hardcoded in .aglass",
  );
  // Belt-and-suspenders: neither name may appear at all (declaration OR a
  // var(--glass)/var(--edge) reference), matching the success criterion's
  // `grep -n -- "--glass\|--edge" public/index.html` returning empty.
  assert.doesNotMatch(html, /--glass\b/, "no occurrence of --glass may remain in public/index.html");
  assert.doesNotMatch(html, /--edge\b/, "no occurrence of --edge may remain in public/index.html");
});

test("DES-04: docs/src/style.css declares no --purple custom property", async () => {
  const css = await readFile(styleCssPath, "utf8");
  assert.doesNotMatch(
    css,
    /--purple\b/,
    "docs/src/style.css must not declare (or reference) a dead --purple token",
  );
});

test("DES-04: the tokens that ARE live in :root (--blue, --ink, --accent) are untouched — this isn't a blind wipe of :root", async () => {
  const html = await readFile(indexHtmlPath, "utf8");
  assert.match(html, /--ink:\s*rgba\(255,255,255,\.94\)/, "a real, referenced token must survive the cleanup");
  assert.match(html, /--accent:\s*#0a84ff/, "a real, referenced token must survive the cleanup");

  const css = await readFile(styleCssPath, "utf8");
  assert.match(css, /--blue:\s*#1633f9/, "docs/src/style.css's real, referenced --blue token must survive the cleanup");
});
