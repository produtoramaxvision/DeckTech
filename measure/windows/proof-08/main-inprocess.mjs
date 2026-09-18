// PROOF-08 — Approach B: server.js imported and started INSIDE the Electron
// main process. Electron main process entry, launched by run.mjs as
// `electron main-inprocess.mjs`. Same env-var contract as main-utility.mjs
// (see that file's header) except PROOF08_CRASH_AFTER_MS now schedules the
// injected throw directly in THIS process (the one hosting both the server
// and the window). PROOF08_INSTALL_UNCAUGHT_HANDLER controls whether this
// file installs an explicit `process.on('uncaughtException', ...)` (matched-
// handler reps) or leaves it unset so Electron's own documented main-process
// default (a blocking `dialog.showErrorBox` modal, never `process.exit`,
// source: electron/electron lib/browser/init.ts, fetched via context7 — see
// ADR §5) is what gets measured (default-behavior reps).
//
// EMPIRICAL NOTE (found while building this probe, not assumed): a top-level
// `await app.whenReady()` in an ESM (.mjs) Electron 44.4.1 main process hangs
// forever on this machine — `app.on('ready', ...)` never fires either. The
// `.then()` form works normally. Reproduced with a two-line minimal repro
// (see the ADR). This file therefore uses `.then()`, not top-level await,
// which is itself part of what "ESM in the main process" costs in practice.
//
// ROUND-2 FIX (major #3): PROOF08_APPDATA previously only redirected THIS
// process's own `process.env.APPDATA` (line below, kept — server.js reads it
// at runtime for its own storage, since it shares this process). That never
// touched Electron's own userData path: Chromium resolves it natively,
// before this module runs, from the real %APPDATA%. `app.setPath('userData',
// ...)` — called synchronously at module top level, before app is ready — is
// the actual fix, confirmed via context7 against Electron's own
// spec/fixtures/apps/set-path/main.js. Applied identically in main-utility.mjs.
import { app, BrowserWindow } from "electron";
import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "..", "..", "server.js"); // repo root/server.js

const PORT = Number(process.env.PROOF08_PORT || 3992);
const LOG_FILE = process.env.PROOF08_LOG_FILE;
const HEARTBEAT_FILE = process.env.PROOF08_HEARTBEAT_FILE;
const CRASH_AFTER_MS = process.env.PROOF08_CRASH_AFTER_MS ? Number(process.env.PROOF08_CRASH_AFTER_MS) : null;
const INSTALL_UNCAUGHT_HANDLER = !!process.env.PROOF08_INSTALL_UNCAUGHT_HANDLER;
const QUIT_AFTER_MS = process.env.PROOF08_QUIT_AFTER_MS ? Number(process.env.PROOF08_QUIT_AFTER_MS) : null;

if (process.env.PROOF08_APPDATA) {
  // Server-side isolation: this process shares its own %APPDATA% with
  // server.js's storage logic (they're the same OS process in Approach B).
  process.env.APPDATA = join(process.env.PROOF08_APPDATA, "server-appdata");
  mkdirSync(process.env.APPDATA, { recursive: true });
  // Electron-side isolation: the actual fix for the false self-isolation
  // claim — see the ROUND-2 FIX note above.
  const electronUserDataDir = join(process.env.PROOF08_APPDATA, "electron-userdata");
  mkdirSync(electronUserDataDir, { recursive: true });
  app.setPath("userData", electronUserDataDir);
}

if (INSTALL_UNCAUGHT_HANDLER) {
  process.on("uncaughtException", (err) => {
    logEvent("main-uncaught-exception-handled", { message: err?.message, stack: err?.stack });
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}

function logEvent(event, extra = {}) {
  if (!LOG_FILE) return;
  appendFileSync(LOG_FILE, JSON.stringify({ t: Date.now(), event, ...extra }) + "\n");
}

let win = null;
let serverAlive = false;
let heartbeatTimer = null;

function writeHeartbeat() {
  if (!HEARTBEAT_FILE) return;
  try {
    writeFileSync(
      HEARTBEAT_FILE,
      JSON.stringify({
        t: Date.now(),
        approach: "in-process",
        mainPid: process.pid,
        windowExists: !!win && !win.isDestroyed(),
        windowVisible: !!win && !win.isDestroyed() && win.isVisible(),
        serverPid: process.pid, // same process
        serverAlive,
      })
    );
  } catch (e) {
    // ROUND-2 FIX (major #6): see the identical fix/rationale in
    // main-utility.mjs's writeHeartbeat — a swallowed write failure here
    // must not look like "the event loop died".
    logEvent("heartbeat-write-failed", { code: e?.code, message: e?.message });
  }
}

logEvent("main-module-start", { mainPid: process.pid, serverPath });

app.whenReady().then(async () => {
  logEvent("app-ready");

  win = new BrowserWindow({
    width: 480,
    height: 300,
    show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL("data:text/html,<h1>DeckTech PROOF-08 (in-process)</h1>");
  logEvent("window-created", { windowId: win.id });

  heartbeatTimer = setInterval(writeHeartbeat, 200);
  writeHeartbeat();

  logEvent("server-start-begin", { port: PORT });
  // Dynamic import so the fetch/eval of server.js happens strictly after
  // app.whenReady(), in a deterministic, logged order. pathToFileURL is
  // required here: Node's ESM loader rejects a bare Windows filesystem path
  // (backslashes, drive letter) passed to import() — it needs a file:// URL.
  const { startServer } = await import(pathToFileURL(serverPath).href);
  const { close } = await startServer({ port: PORT });
  serverAlive = true;
  logEvent("server-ready", { port: PORT });
  writeHeartbeat();

  if (CRASH_AFTER_MS) {
    logEvent("crash-scheduled", {
      afterMs: CRASH_AFTER_MS,
      target: "main-process-itself",
      handlerInstalled: INSTALL_UNCAUGHT_HANDLER,
    });
    setTimeout(() => {
      // Unhandled by design: when INSTALL_UNCAUGHT_HANDLER is unset, no
      // try/catch and no process.on('uncaughtException') exists in this
      // file, so this measures Electron's DEFAULT behavior for an uncaught
      // exception in the process that also owns the BrowserWindow (see the
      // top-of-file note). When INSTALL_UNCAUGHT_HANDLER is set, the handler
      // registered above intercepts this instead — the "matched handler
      // policy" rep, see ADR §5.
      throw new Error("PROOF-08 injected crash: simulated unhandled error in-process (shares process with the window)");
    }, CRASH_AFTER_MS);
  }

  if (QUIT_AFTER_MS) {
    setTimeout(async () => {
      logEvent("quitting", { windowStillExists: !!win && !win.isDestroyed(), serverAlive });
      clearInterval(heartbeatTimer);
      writeHeartbeat();
      // ROUND-2 FIX (major #6): surface what close() swallowed instead of a
      // bare catch — a failed graceful shutdown here would otherwise be
      // indistinguishable from a clean one in the log.
      try {
        await close();
      } catch (e) {
        logEvent("server-close-failed", { code: e?.code, message: e?.message });
      }
      app.quit();
    }, QUIT_AFTER_MS);
  }
}).catch((err) => {
  logEvent("main-then-rejected", { message: err?.message, stack: err?.stack });
});

app.on("window-all-closed", () => {
  logEvent("window-all-closed");
});
