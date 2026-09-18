// PROOF-08 — crash-test entry point for Approach A (utilityProcess.fork).
//
// WHY THIS FILE EXISTS (empirical finding, not a design preference): forking
// server.js directly and passing `execArgv: ["--import", <crash-injector>]`
// to utilityProcess.fork does NOT load the preload module — confirmed by
// running with a load-time console.error marker in crash-injector.mjs: it
// never printed, and the forked server.js kept answering /health 200
// continuously for 19+ seconds with the "crash" completely inert. Electron's
// utility process does not honor an injected `--import`/`--require` the way
// plain Node child_process.fork does (consistent with Electron restricting
// which Node CLI flags a forked utility process accepts).
//
// So for the crash sub-test only, we fork THIS wrapper instead of server.js
// directly. It calls the real, unmodified `startServer` export from the real
// server.js — same code, same behavior — and then throws, unhandled, from a
// timer callback exactly like crash-injector.mjs would have. The idle/cold-start
// sub-test still forks server.js directly (see main-utility.mjs), matching the
// task literally ("utilityProcess.fork pointing at server.js").
// ROUND-2 FIX (blocker #2): PROOF08_INSTALL_UNCAUGHT_HANDLER, when set,
// installs an explicit `process.on('uncaughtException', ...)` here instead
// of relying on Node's own default behavior for an uncaught exception in a
// plain (non-Electron-GUI) process — stack to stderr, exit 1. This is the
// "matched handler policy" arm: it lets the ADR compare A and B with the
// SAME explicit handler installed in whichever process actually takes the
// throw, instead of comparing Node's default (this process, a utility
// process — print + exit) against Electron's GUI default (main-inprocess.mjs
// — modal dialog, no exit), which is a different confound than "hosting
// location". See ADR §5.
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "..", "..", "server.js");

if (process.env.PROOF08_INSTALL_UNCAUGHT_HANDLER) {
  process.on("uncaughtException", (err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}

const { startServer } = await import(pathToFileURL(serverPath).href);
const port = Number(process.env.PORT);
await startServer({ port });
console.log(`[server-entry-crash] Dokke ouvindo em http://127.0.0.1:${port}`);

const delay = Number(process.env.PROOF08_CRASH_AFTER_MS);
if (Number.isFinite(delay) && delay > 0) {
  setTimeout(() => {
    throw new Error("PROOF-08 injected crash: simulated unhandled error in server process (utility, via entry wrapper)");
  }, delay);
}
