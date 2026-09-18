// design/lint.mjs
//
// Hardcoded-literal scanner for Phase 6 success criterion 1: "a test fails if
// a colour, radius or duration appears hardcoded outside [the token file] in
// the new surfaces". No Electron/Windows renderer exists yet (Phase 7 has not
// run), so `NEW_SURFACE_DIRS` currently names only the one real surface that
// does exist today — `design/` (the gallery). Phase 7 appends its renderer
// directory here when it lands; this module does not need to change shape,
// only the directory list.
//
// Scope: only CSS *style contexts* are scanned — `.css` files in full, and
// `<style>` blocks / `style="..."` attributes inside `.html` files. Plain
// text content (a swatch displaying "the dark value is #080301" as a label
// for a human to read) is deliberately NOT scanned; that is documentation,
// not a hardcoded style declaration, and the gallery's entire purpose is to
// display token values as text.

import { readdirSync, statSync, readFileSync } from "node:fs";
import path from "node:path";

export const NEW_SURFACE_DIRS = ["design"];

// Files that ARE the token source (or mechanically generated from it) are
// allowlisted by basename — they are definitionally full of the literals
// every other new surface must not hardcode.
export const ALLOWLISTED_FILENAMES = [
  "tokens.mjs",
  "tokens.generated.css",
  "build-gallery.mjs",
  "lint.mjs",
];

const SCANNABLE_EXT = new Set([".html", ".css", ".js", ".mjs"]);

const COLOR_LITERAL_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
const ANY_VAR_REF_RE = /var\(\s*--/;

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

function findViolationsInRegion(text) {
  const out = [];
  for (const m of text.matchAll(COLOR_LITERAL_RE)) {
    out.push({ category: "color", match: m[0] });
  }
  for (const m of text.matchAll(/border-radius\s*:\s*([^;"']+)[;"']/gi)) {
    const value = m[1];
    if (!ANY_VAR_REF_RE.test(value) && /[0-9]/.test(value)) {
      out.push({ category: "radius", match: m[0].trim() });
    }
  }
  for (const m of text.matchAll(/(?:transition|animation)(?:-duration)?\s*:\s*([^;"']+)[;"']/gi)) {
    const value = m[1];
    if (!ANY_VAR_REF_RE.test(value) && /\d+(\.\d+)?(ms|s)\b/.test(value)) {
      out.push({ category: "duration", match: m[0].trim() });
    }
  }
  return out;
}

function walk(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files; // surface directory doesn't exist yet — nothing to scan
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

/**
 * @param {string[]} absoluteDirs directories to walk (path.join'd by callers)
 * @returns {{file: string, category: "color"|"radius"|"duration", match: string}[]}
 */
export function scanForHardcodedTokenLiterals(absoluteDirs) {
  const violations = [];
  for (const dir of absoluteDirs) {
    for (const file of walk(dir)) {
      if (ALLOWLISTED_FILENAMES.includes(path.basename(file))) continue;
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
