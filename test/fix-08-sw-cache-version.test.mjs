import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startServer } from "../server.js";
import { SW_CACHE_VERSION, SW_CACHE_TOKEN } from "../sw-cache-version.js";

// FIX-08 — "Unify the two hand-edited cache strings."
//
// Before this fix, public/sw.js's `CACHE` constant and public/index.html's
// `serviceWorker.register("/sw.js?rev=...")` were two independently
// hand-typed copies of the literal "dokke-v24". A deploy that bumped one
// and forgot the other broke service-worker update propagation SILENTLY —
// no error anywhere, the SW's own activate handler just never saw a CACHE
// name it recognized as new, so old caches (and the stale UI they served)
// never got evicted.
//
// D14 forbids solving this with a bundler (public/index.html stays a
// single 129KB file, no build step reconcatenating it from sources), so
// the fix is: both files ship the literal placeholder SW_CACHE_TOKEN
// instead of a version string, and server.js substitutes it with
// SW_CACHE_VERSION (sw-cache-version.js — the ONE place a real version
// bump is typed) on every response. Both files are already served
// `no-cache, no-store, must-revalidate`, so the substituted bytes are
// never served stale from HTTP caching.
//
// These tests guard both ends of that mechanism:
//   1. the raw files on disk carry the placeholder, never a hand-typed
//      "dokke-vNN" literal — this is what directly closes the "bumped one,
//      forgot the other" hole: if someone reverts to a hand-typed literal
//      in just ONE of the two files, this fails immediately, independent
//      of whether the server-side substitution still "happens to" work.
//   2. the values server.js actually SENDS over HTTP for /sw.js and
//      /index.html carry the identical version, and it is the one true
//      SW_CACHE_VERSION constant — not two independently-substituted values
//      that merely happen to match today.

const indexHtmlPath = fileURLToPath(new URL("../public/index.html", import.meta.url));
const swJsPath = fileURLToPath(new URL("../public/sw.js", import.meta.url));

// A hand-typed cache-busting literal in this codebase's history always
// looked like "dokke-v" followed by digits (dokke-v22, dokke-v24, ...).
// Depois do bump pra "decktech-v25" a regex antiga (/dokke-v\d+/) deixaria de
// guardar qualquer coisa: um literal "decktech-v25" digitado a mao em sw.js ou
// index.html passaria batido, que e o MESMO defeito com outro nome. Cobre as
// duas marcas.
const HAND_TYPED_LITERAL = /(?:dokke|decktech)-v\d+/i;

test("FIX-08: public/sw.js's CACHE constant is the shared placeholder, not a hand-typed literal", async () => {
  const sw = await readFile(swJsPath, "utf8");
  const constMatch = sw.match(/const CACHE\s*=\s*"([^"]+)"/);
  assert.ok(constMatch, "expected `const CACHE = \"...\";` in public/sw.js");
  assert.equal(
    constMatch[1],
    SW_CACHE_TOKEN,
    "public/sw.js's CACHE constant must be the SW_CACHE_TOKEN placeholder, substituted by server.js — a literal here is exactly the drift FIX-08 closes",
  );
  assert.doesNotMatch(sw, HAND_TYPED_LITERAL, "public/sw.js must not carry a hand-typed dokke-vNN literal");
});

test("FIX-08: public/index.html's registration ?rev= is the shared placeholder, not a hand-typed literal", async () => {
  const html = await readFile(indexHtmlPath, "utf8");
  const revMatch = html.match(/serviceWorker\.register\("\/sw\.js\?rev=([^"]+)"\)/);
  assert.ok(revMatch, 'expected navigator.serviceWorker.register("/sw.js?rev=...") in public/index.html');
  assert.equal(
    revMatch[1],
    SW_CACHE_TOKEN,
    "public/index.html's ?rev= must be the SW_CACHE_TOKEN placeholder, substituted by server.js — a literal here is exactly the drift FIX-08 closes",
  );
  assert.doesNotMatch(html, HAND_TYPED_LITERAL, "public/index.html must not carry a hand-typed dokke-vNN literal");
});

test("FIX-08: the served /sw.js and /index.html carry the SAME version, and it is the real SW_CACHE_VERSION (not the raw placeholder)", async () => {
  const { port, close } = await startServer(0);
  try {
    const swText = await (await fetch(`http://127.0.0.1:${port}/sw.js`)).text();
    const htmlText = await (await fetch(`http://127.0.0.1:${port}/index.html`)).text();

    const swMatch = swText.match(/const CACHE\s*=\s*"([^"]+)"/);
    assert.ok(swMatch, "served /sw.js must still declare `const CACHE = \"...\";`");
    const revMatch = htmlText.match(/serviceWorker\.register\("\/sw\.js\?rev=([^"]+)"\)/);
    assert.ok(revMatch, "served /index.html must still register with ?rev=...");

    assert.notEqual(swMatch[1], SW_CACHE_TOKEN, "served /sw.js must have the placeholder substituted, not raw");
    assert.notEqual(revMatch[1], SW_CACHE_TOKEN, "served /index.html must have the placeholder substituted, not raw");
    assert.equal(swMatch[1], SW_CACHE_VERSION, "served /sw.js CACHE must equal the single-source SW_CACHE_VERSION");
    assert.equal(revMatch[1], SW_CACHE_VERSION, "served /index.html ?rev= must equal the single-source SW_CACHE_VERSION");
    assert.equal(swMatch[1], revMatch[1], "served /sw.js CACHE and /index.html ?rev= must be identical — this is the whole point of FIX-08");
  } finally {
    await close();
  }
});
