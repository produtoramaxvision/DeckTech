import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// DES-03 — "Actually load Inter on the landing page".
//
// Before this fix, docs/src/style.css declared `font-family: Inter, ...`
// together with `font-synthesis: none` but shipped no @font-face and no
// Google Fonts link anywhere in docs/. Weights 650 and 750 (used for
// headings across the page) silently fell back to whatever static weight
// cut the OS/browser happened to have for a font literally named "Inter" —
// or to the next font in the stack (Segoe UI on a clean Windows box) when
// it had none. Inter's static family only ships weights in steps of 100
// (100, 200, ..., 900), so 650/750 do not exist as real static cuts at
// all: only a *variable* font (wght axis) can render them as true weights
// instead of snapping to the nearest static neighbour.
//
// These assertions guard the three ways this fix can silently be a no-op:
//   1. the @font-face family name must be the one :root's font stack
//      actually requests (a name mismatch means the face never gets used)
//   2. the declared weight range must numerically cover 650 and 750 (a
//      single fixed weight, e.g. 400, would mean the whole premise of the
//      bug survives the "fix")
//   3. the font file the src: url() points at must exist on disk with
//      real bytes — a renamed/missing file is a fix that looks correct in
//      the CSS but 404s at runtime and falls straight back to the OS font

const stylePath = fileURLToPath(new URL("../docs/src/style.css", import.meta.url));

async function readStyle() {
  return readFile(stylePath, "utf8");
}

function extractFontFaceBlock(css) {
  const match = css.match(/@font-face\s*\{[^}]*\}/);
  assert.ok(match, "expected an @font-face rule in docs/src/style.css");
  return match[0];
}

function extractRootFontFamilyStack(css) {
  const rootBlock = css.match(/:root\s*\{[^}]*\}/);
  assert.ok(rootBlock, "expected a :root rule in docs/src/style.css");
  const familyLine = rootBlock[0].match(/font-family:\s*([^;]+);/);
  assert.ok(familyLine, "expected :root to declare font-family");
  return familyLine[1];
}

// path.join, not string concatenation, resolves the url() target relative
// to the stylesheet that references it — mirrors how a bundler (Vite) or a
// browser resolves a relative CSS url().
function resolveCssUrl(cssFilePath, cssUrlValue) {
  return path.join(path.dirname(cssFilePath), cssUrlValue);
}

test("DES-03: @font-face declares the exact family :root requests", async () => {
  const css = await readStyle();
  const face = extractFontFaceBlock(css);
  const stack = extractRootFontFamilyStack(css);

  const faceFamilyMatch = face.match(/font-family:\s*([^;]+);/);
  assert.ok(faceFamilyMatch, "expected @font-face to declare font-family");
  const faceFamily = faceFamilyMatch[1].trim().replace(/^["']|["']$/g, "");

  // The first entry in :root's font-family stack is the one browsers try
  // to match first — if @font-face names anything else, the declared font
  // never gets used and every element still falls back down the stack.
  const firstStackEntry = stack.split(",")[0].trim().replace(/^["']|["']$/g, "");
  assert.equal(
    faceFamily,
    firstStackEntry,
    `@font-face family ("${faceFamily}") must match the first entry of :root's font-family stack ("${firstStackEntry}"), or the face is never selected`,
  );
});

test("DES-03: @font-face weight range covers 650 and 750 (the weights the page actually uses)", async () => {
  const css = await readStyle();
  const face = extractFontFaceBlock(css);

  const weightMatch = face.match(/font-weight:\s*([^;]+);/);
  assert.ok(weightMatch, "expected @font-face to declare font-weight");
  const rawWeight = weightMatch[1].trim();

  const parts = rawWeight.split(/\s+/).map(Number);
  assert.ok(
    parts.length === 2 && parts.every((n) => Number.isFinite(n)),
    `expected a variable-font weight RANGE ("100 900"), got "${rawWeight}" — a single fixed weight cannot render both 650 and 750 as true weights`,
  );
  const [min, max] = parts;
  assert.ok(min <= 650 && 650 <= max, `declared weight range ${min}-${max} must cover 650`);
  assert.ok(min <= 750 && 750 <= max, `declared weight range ${min}-${max} must cover 750`);

  // Sanity: the page really does use 650 and 750 somewhere, so this test
  // is guarding a real requirement, not a hypothetical one.
  assert.match(css, /font-weight:\s*650;/, "expected at least one rule using font-weight: 650");
  assert.match(css, /font-weight:\s*750;/, "expected at least one rule using font-weight: 750");
});

test("DES-03: the font file referenced by @font-face's src url() exists on disk with real bytes", async () => {
  const css = await readStyle();
  const face = extractFontFaceBlock(css);

  const srcMatch = face.match(/src:\s*url\(["']?([^"')]+)["']?\)/);
  assert.ok(srcMatch, "expected @font-face to declare a src: url(...)");
  const cssUrlValue = srcMatch[1];

  const resolved = resolveCssUrl(stylePath, cssUrlValue);
  assert.ok(existsSync(resolved), `font file referenced by src: url() does not exist at ${resolved}`);
  const stats = statSync(resolved);
  assert.ok(stats.size > 0, `font file at ${resolved} is empty`);

  // It must actually be a woff2 (magic bytes "wOF2"), not e.g. a stray
  // placeholder or an accidental text file with the right name.
  const buf = await readFile(resolved);
  assert.equal(buf.subarray(0, 4).toString("ascii"), "wOF2", "font file is not a valid woff2 (bad magic bytes)");
});

test("DES-03: url() resolution uses path.join and survives a directory that contains a space", () => {
  // Real repo paths (docs/src/fonts) happen to contain no spaces, so this
  // exercises the same resolveCssUrl() logic against a synthetic layout
  // whose directory name DOES contain a space, proving the resolution is
  // built on path.join (platform separators handled correctly) and not on
  // a hardcoded "/" or "\\" concatenation that could mis-handle quoting.
  const base = mkdtempSync(path.join(tmpdir(), "des-03 space test "));
  const cssDir = path.join(base, "my styles", "src");
  mkdirSync(cssDir, { recursive: true });
  const fakeCssPath = path.join(cssDir, "style.css");
  const fontDir = path.join(cssDir, "fonts");
  mkdirSync(fontDir, { recursive: true });
  const fontPath = path.join(fontDir, "InterVariable.woff2");
  writeFileSync(fontPath, Buffer.from("wOF2-fake-bytes-for-test"));

  const resolved = resolveCssUrl(fakeCssPath, "./fonts/InterVariable.woff2");
  assert.equal(resolved, fontPath);
  assert.ok(base.includes(" "), "sanity check: the temp base path must actually contain a space");
  assert.ok(existsSync(resolved), `resolveCssUrl must find the file across a path segment containing a space: ${resolved}`);
});

test("DES-03: the redistributed font file ships its OFL license text", async () => {
  const licensePath = path.join(path.dirname(stylePath), "fonts", "Inter-LICENSE.txt");
  assert.ok(existsSync(licensePath), `expected ${licensePath} — redistributing Inter requires its OFL license text alongside it`);
  const text = await readFile(licensePath, "utf8");
  assert.match(text, /SIL Open Font License/);
});
