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
import {
  scanForHardcodedTokenLiterals,
  NEW_SURFACE_DIRS,
  ALLOWLISTED_PATHS,
  hasColorLiteral,
} from "../design/lint.mjs";

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
    assert.ok(ALLOWLISTED_PATHS.includes("design/tokens.mjs"));
    assert.ok(ALLOWLISTED_PATHS.includes("design/tokens.generated.css"));
    // build-gallery.mjs is deliberately NOT here (round-2 review finding 2):
    // its own tool-chrome literals moved to the allowlisted gallery-chrome.mjs
    // so build-gallery.mjs itself stays subject to the scan like any other file.
    assert.ok(ALLOWLISTED_PATHS.includes("design/gallery-chrome.mjs"));
    assert.ok(!ALLOWLISTED_PATHS.includes("design/build-gallery.mjs"));
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

  // ---------------------------------------------------------------------
  // Round-2 review finding 1 — discrimination proofs for every escape shape
  // the reviewer demonstrated against the terminator-requiring regexes:
  //   PROBE A/D: unterminated declaration, nothing follows (no `;`/`}` at all
  //              within the captured window before end-of-region/next rule)
  //   PROBE B/E: unterminated declaration followed by a compliant var() decl
  //              — the old greedy `[^;"']+` crossed the `}` into that var()
  //              call and got suppressed by it
  //   mixed shorthand + newline continuation: a compliant var() on one line
  //   and a hardcoded literal on the next line of the SAME declaration
  //   (the gap the round-2 review flagged as "shares this root cause")
  // Each fixture lives under a SPACED path (NON-NEGOTIABLE #4) and is run
  // directly against scanForHardcodedTokenLiterals — the same function the
  // real design/ scan uses — so this is not a regex unit test in isolation.
  // ---------------------------------------------------------------------

  function scanFixture(css) {
    const base = mkdtempSync(path.join(tmpdir(), "dt token lint bait "));
    const dir = path.join(base, "surface with space");
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "bait.css"), css, "utf8");
      return scanForHardcodedTokenLiterals([base]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }

  test("unterminated radius, nothing follows — `.x { border-radius: 12px }` (PROBE A shape)", () => {
    const violations = scanFixture(".lint-bait { border-radius: 12px }");
    assert.equal(violations.length, 1);
    assert.equal(violations[0].category, "radius");
  });

  test("unterminated radius followed by a compliant var() declaration — must NOT suppress the first (PROBE B shape)", () => {
    const violations = scanFixture(
      ".a { border-radius: 12px }\n.b { border-radius: var(--dt-r-card); }",
    );
    const radiusViolations = violations.filter((v) => v.category === "radius");
    assert.equal(radiusViolations.length, 1, "the hardcoded 12px must be reported despite the following var() rule");
  });

  test("unterminated duration, nothing follows — `.x { transition: 200ms }` (PROBE D shape)", () => {
    const violations = scanFixture(".lint-bait { transition: 200ms }");
    assert.equal(violations.length, 1);
    assert.equal(violations[0].category, "duration");
  });

  test("unterminated duration followed by a compliant var() declaration — must NOT suppress the first (PROBE E shape)", () => {
    const violations = scanFixture(
      ".a { transition: 200ms }\n.b { transition: var(--dt-dur-fast); }",
    );
    const durationViolations = violations.filter((v) => v.category === "duration");
    assert.equal(durationViolations.length, 1, "the hardcoded 200ms must be reported despite the following var() rule");
  });

  test("mixed shorthand: var() on one line, hardcoded duration on the next line of the SAME declaration", () => {
    const violations = scanFixture(
      [
        ".g {",
        "  transition: var(--dt-dur-fast) ease,",
        "               color 300ms ease;",
        "}",
      ].join("\n"),
    );
    const durationViolations = violations.filter((v) => v.category === "duration");
    assert.equal(durationViolations.length, 1, "the hardcoded 300ms sharing a declaration with a var() must still be caught");
  });

  test("var() WITH a hardcoded fallback is still a literal in the surface and must be caught", () => {
    const violations = scanFixture(".i { transition: var(--dt-dur-fast, 200ms); }");
    const durationViolations = violations.filter((v) => v.category === "duration");
    assert.equal(durationViolations.length, 1, "a var() fallback value is a literal written into this surface, not suppressed");
  });

  test("a fully token-driven shorthand with trailing zero corners is NOT a hardcoded radius", () => {
    const violations = scanFixture(
      ".swatch-preview { border-radius: var(--dt-r-control) var(--dt-r-control) 0 0; }",
    );
    assert.deepEqual(violations, [], "var() shorthand with bare-zero corners must not false-positive");
  });

  test("all escape shapes together in one fixture — proves the guard is not vacuous", () => {
    const violations = scanFixture(
      [
        ".a { background: #ff00aa; }",
        ".b { border-radius: 12px }",
        ".c { border-radius: var(--dt-r-card); }",
        ".d { transition: 200ms }",
        ".e { transition: var(--dt-dur-fast); }",
        ".f { border-radius: 9px; }",
        ".g {",
        "  transition: var(--dt-dur-fast) ease,",
        "               color 300ms ease;",
        "}",
        ".h { border-radius: var(--dt-r-control) var(--dt-r-control) 0 0; }",
        ".i { transition: var(--dt-dur-fast, 200ms); }",
      ].join("\n"),
    );
    const count = (cat) => violations.filter((v) => v.category === cat).length;
    assert.equal(count("color"), 1, "expected exactly 1 color violation (.a)");
    assert.equal(count("radius"), 2, "expected 2 radius violations (.b, .f) — .c compliant and .h bare-zero must not count");
    assert.equal(count("duration"), 3, "expected 3 duration violations (.d, .g, .i) — .e compliant must not count");
    assert.equal(violations.length, 6);
  });

  // Round-2 review finding 1 (vacuity): a misconfigured NEW_SURFACE_DIRS
  // entry must fail loudly, not silently scan zero files and report [].
  test("scanning a directory that does not exist throws, instead of silently reporting no violations", () => {
    const bogus = path.join(REPO_ROOT, `design-nonexistent-${Date.now()}`);
    assert.throws(() => scanForHardcodedTokenLiterals([bogus]));
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

  // Round-2 review finding 3: a token misclassified as non-color (e.g. a
  // color literal authored with `plain(..., TOKEN_KINDS.RADIUS, ...)` instead
  // of `color(...)`) would reach :root theme-independent and never get a
  // light pair, with nothing here catching it — TOKENS.length and the D11
  // pairing tests above don't look at non-color token VALUES at all.
  test("no non-color token's value contains a color literal (misclassification would ship an unpaired color)", () => {
    for (const t of NON_COLOR_TOKENS) {
      assert.equal(
        hasColorLiteral(t.value),
        false,
        `${t.name} is classified as ${t.kind} but its value "${t.value}" contains a color literal`,
      );
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
