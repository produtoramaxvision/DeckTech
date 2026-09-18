// test/design-tokens.test.mjs
//
// Phase 6 (DES-01 + DES-02) success criteria, enforced mechanically:
//   1. The tokens transcribed from DESIGN-LANGUAGE.md §12 live in a single
//      file with path:line provenance, and a hardcoded color/radius/duration
//      literal outside that file, in a new DeckTech surface, fails the suite.
//   2. Every color token has both a light and a dark entry (D11); a token
//      missing either fails the suite.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOKENS, COLOR_TOKENS, NON_COLOR_TOKENS, TOKEN_KINDS, findToken } from "../design/tokens.mjs";
import { scanForHardcodedTokenLiterals, NEW_SURFACE_DIRS, ALLOWLISTED_FILENAMES } from "../design/lint.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

// ---------------------------------------------------------------------------
// Criterion 1a — single source, path:line provenance for every token
// ---------------------------------------------------------------------------

describe("design tokens — single source of truth", () => {
  test("every token has a non-empty name, kind and provenance", () => {
    assert.equal(TOKENS.length, 63, "token count drifted from the transcribed §12 set");
    for (const t of TOKENS) {
      assert.match(t.name, /^--dt-[a-z0-9-]+$/, `bad token name: ${t.name}`);
      assert.ok(Object.values(TOKEN_KINDS).includes(t.kind), `bad kind for ${t.name}`);
      if (t.kind === TOKEN_KINDS.COLOR) {
        assert.ok(t.dark.source && t.dark.source.length > 0, `${t.name}.dark missing source`);
        assert.ok(t.light.basis && t.light.basis.length > 0, `${t.name}.light missing basis`);
      } else {
        assert.ok(t.source && t.source.length > 0, `${t.name} missing source`);
      }
    }
  });

  test("dark provenance cites a real path — repo-relative sources point at files that exist", () => {
    for (const t of TOKENS) {
      const source = t.kind === TOKEN_KINDS.COLOR ? t.dark.source : t.source;
      const m = source.match(/^([a-zA-Z0-9_./-]+\.(?:swift|html|css|mjs|md)):/);
      if (!m) continue; // composite/prose citations (spacing, fonts) — not a bare path:line
      const candidate = path.join(REPO_ROOT, m[1]);
      assert.doesNotThrow(
        () => readFileSync(candidate),
        `${t.name} cites ${m[1]} which does not exist in the repo`,
      );
    }
  });

  test("findToken resolves a known token", () => {
    const tile = findToken("--dt-r-tile");
    assert.equal(tile.value, "0.29");
    assert.equal(tile.source, "public/index.html:164");
  });
});

// ---------------------------------------------------------------------------
// Criterion 1b — hardcoded literal outside the token file fails, in new surfaces
// ---------------------------------------------------------------------------

describe("design tokens — hardcoded literal lint over new surfaces", () => {
  test("the real design/ surface (gallery + generated css) is currently clean", () => {
    const violations = scanForHardcodedTokenLiterals(NEW_SURFACE_DIRS.map((d) => path.join(REPO_ROOT, d)));
    assert.deepEqual(
      violations,
      [],
      `unexpected hardcoded literal(s) in a new surface:\n${JSON.stringify(violations, null, 2)}`,
    );
  });

  test("the token source files themselves are allowlisted, not scanned", () => {
    assert.ok(ALLOWLISTED_FILENAMES.includes("tokens.mjs"));
    assert.ok(ALLOWLISTED_FILENAMES.includes("tokens.generated.css"));
  });

  // NON-NEGOTIABLE #4: exercise path.join over a path containing a space.
  test("the scanner walks a directory whose path contains a space (path.join, not string concat)", () => {
    const base = mkdtempSync(path.join(tmpdir(), "dt token lint "));
    const spacedDir = path.join(base, "new surface dir");
    try {
      mkdirSync(spacedDir, { recursive: true });
      writeFileSync(
        path.join(spacedDir, "clean.css"),
        ":root { --x: var(--dt-canvas); border-radius: var(--dt-r-control); transition: var(--dt-dur-fast); }",
        "utf8",
      );
      const violations = scanForHardcodedTokenLiterals([base]);
      assert.deepEqual(violations, [], "clean fixture under a spaced path must not report violations");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Criterion 2 — every color token has BOTH a light and a dark entry (D11)
// ---------------------------------------------------------------------------

describe("design tokens — light/dark pair completeness (D11)", () => {
  test("every color token has both dark and light, each non-empty", () => {
    assert.ok(COLOR_TOKENS.length > 0, "no color tokens found — classification broke");
    for (const t of COLOR_TOKENS) {
      assert.ok(t.dark && typeof t.dark.value === "string" && t.dark.value.length > 0, `${t.name} missing dark.value`);
      assert.ok(
        t.light && typeof t.light.value === "string" && t.light.value.length > 0,
        `${t.name} missing light.value`,
      );
      assert.notEqual(t.dark.value, t.light.value, `${t.name} light and dark are identical — not a real pair`);
    }
  });

  test("no color token exists in only one theme — every token name pairs with itself", () => {
    // Simulates the fixture a reviewer would build: a per-theme map keyed by
    // token name, exactly what the gallery iterates over per panel.
    const darkNames = new Set(COLOR_TOKENS.map((t) => t.name));
    const lightNames = new Set(
      COLOR_TOKENS.filter((t) => t.light && t.light.value).map((t) => t.name),
    );
    const onlyDark = [...darkNames].filter((n) => !lightNames.has(n));
    const onlyLight = [...lightNames].filter((n) => !darkNames.has(n));
    assert.deepEqual(onlyDark, [], `color token(s) with a dark value but no light value: ${onlyDark}`);
    assert.deepEqual(onlyLight, [], `color token(s) with a light value but no dark value: ${onlyLight}`);
  });

  test("non-color tokens are theme-independent by design (radius/space/motion/type never pair)", () => {
    for (const t of NON_COLOR_TOKENS) {
      assert.equal(t.kind === TOKEN_KINDS.COLOR, false);
      assert.ok(!("dark" in t) && !("light" in t), `${t.name} is non-color but carries a theme pair`);
    }
  });
});

// ---------------------------------------------------------------------------
// Gallery renders both themes side by side
// ---------------------------------------------------------------------------

describe("design tokens — gallery is a real, viewable artifact", () => {
  const galleryPath = path.join(REPO_ROOT, "design", "gallery.html");
  const galleryHtml = readFileSync(galleryPath, "utf8");

  test("gallery.html exists and is not a JSON dump", () => {
    assert.match(galleryHtml, /<!doctype html>/i);
    assert.doesNotMatch(galleryHtml.trim(), /^[{[]/, "gallery must be HTML, not a JSON file");
  });

  test("both theme panels are present, side by side (not a toggle)", () => {
    assert.match(galleryHtml, /data-theme="dark"/);
    assert.match(galleryHtml, /data-theme="light"/);
    // Both panels must appear in the same document render, not behind a
    // client-side switch: assert neither panel is inside a <template> or
    // hidden by a display:none literal.
    assert.doesNotMatch(galleryHtml, /display:\s*none/i);
  });

  test("every color token appears in both the dark and light panel markup", () => {
    const darkPanelStart = galleryHtml.indexOf('<div class="theme-panel" data-theme="dark">');
    const lightPanelStart = galleryHtml.indexOf('<div class="theme-panel" data-theme="light">');
    assert.ok(darkPanelStart !== -1, "dark panel not found");
    assert.ok(lightPanelStart !== -1, "light panel not found");
    assert.ok(darkPanelStart < lightPanelStart, "panels are not in dark-then-light order");
    const darkSection = galleryHtml.slice(darkPanelStart, lightPanelStart);
    const lightSection = galleryHtml.slice(lightPanelStart);
    for (const t of COLOR_TOKENS) {
      assert.match(
        darkSection,
        new RegExp(`data-token="${t.name}" data-theme="dark"`),
        `${t.name} missing from dark panel`,
      );
      assert.match(
        lightSection,
        new RegExp(`data-token="${t.name}" data-theme="light"`),
        `${t.name} missing from light panel`,
      );
    }
  });

  test("gallery.html contains zero hardcoded color/radius/duration literals (it is itself a new surface)", () => {
    const violations = scanForHardcodedTokenLiterals([path.join(REPO_ROOT, "design")]);
    assert.deepEqual(violations, []);
  });
});
