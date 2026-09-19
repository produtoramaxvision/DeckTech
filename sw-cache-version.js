/**
 * FIX-08: single source of truth for the service-worker cache-busting token.
 *
 * Before this file, `public/sw.js`'s `CACHE` constant and
 * `public/index.html`'s `?rev=` on `serviceWorker.register(...)` were two
 * hand-edited copies of the same literal ("dokke-v24"). A deploy that
 * bumped one and forgot the other broke SW update propagation silently —
 * no error anywhere, users just kept the stale cached UI.
 *
 * D14 keeps public/index.html a single 129KB file with no build step (no
 * bundler reconcatenating it from sources), so this can't be solved by
 * importing a shared module into two independently-served static files.
 * Instead: `public/sw.js` and `public/index.html` each carry the literal
 * placeholder token `SW_CACHE_TOKEN` in place of the version string, and
 * `server.js` substitutes it with `SW_CACHE_VERSION` when it serves those
 * two files — both of which it already sends with
 * `Cache-Control: no-cache, no-store, must-revalidate`, so the substituted
 * bytes are never served stale from HTTP caching and the ordinary SW
 * update algorithm (byte comparison of the fetched script) still fires on
 * every real version bump.
 *
 * Bump the version in exactly this one place; both files pick it up.
 */
// v25: primeiro bump do DeckTech. Dois motivos no mesmo passo — o cartao de
// login mudou (BRAND-14) e uma UI nova sem bump e exatamente o defeito que
// este arquivo existe pra impedir; e o proprio token era uma string de marca
// ("dokke-v24") servida ao cliente. O `activate` de public/sw.js apaga toda
// chave != CACHE, entao o cache antigo e evictado sozinho na troca.
export const SW_CACHE_VERSION = "decktech-v25";

/** Literal placeholder that must appear verbatim in public/sw.js and
 *  public/index.html wherever the cache version belongs. */
export const SW_CACHE_TOKEN = "__SW_CACHE_VERSION__";
