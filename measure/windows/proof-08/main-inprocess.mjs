// PROOF-08 — Approach B: server.js imported and started INSIDE the Electron
// main process. Electron main process entry, launched by run.mjs as
// `electron main-inprocess.mjs`. Same env-var contract as main-utility.mjs
// (see that file's header) except PROOF08_CRASH_AFTER_MS now schedules the
// injected throw directly in THIS process (the one hosting both the server
// and the window) — and this file deliberately installs NO uncaughtException
// handler, so Node's default behavior is what gets measured.
//
// EMPIRICAL NOTE (found while building this probe, not assumed): a top-level
// `await app.whenReady()` in an ESM (.mjs) Electron 44.4.1 main process hangs
// forever on this machine — `app.on('ready', ...)` never fires either. The
// `.then()` form works normally. Reproduced with a two-line minimal repro
// (see the ADR). This file therefore uses `.then()`, not top-level await,
// which is itself part of what "ESM in the main process" costs in practice.
import { app, BrowserWindow } from "electron";
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "..", "..", "server.js"); // repo root/server.js

const PORT = Number(process.env.PROOF08_PORT || 3992);
const LOG_FILE = process.env.PROOF08_LOG_FILE;
const HEARTBEAT_FILE = process.env.PROOF08_HEARTBEAT_FILE;
const CRASH_AFTER_MS = process.env.PROOF08_CRASH_AFTER_MS ? Number(process.env.PROOF08_CRASH_AFTER_MS) : null;
const QUIT_AFTER_MS = process.env.PROOF08_QUIT_AFTER_MS ? Number(process.env.PROOF08_QUIT_AFTER_MS) : null;

if (process.env.PROOF08_APPDATA) process.env.APPDATA = process.env.PROOF08_APPDATA;

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
  } catch {}
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
    logEvent("crash-scheduled", { afterMs: CRASH_AFTER_MS, target: "main-process-itself" });
    setTimeout(() => {
      // Deliberately unhandled: no try/catch, no process.on('uncaughtException').
      // This measures Electron/Node's DEFAULT behavior for an uncaught exception
      // in the process that also owns the BrowserWindow.
      throw new Error("PROOF-08 injected crash: simulated unhandled error in-process (shares process with the window)");
    }, CRASH_AFTER_MS);
  }

  if (QUIT_AFTER_MS) {
    setTimeout(async () => {
      logEvent("quitting", { windowStillExists: !!win && !win.isDestroyed(), serverAlive });
      clearInterval(heartbeatTimer);
      writeHeartbeat();
      try { await close(); } catch {}
      app.quit();
    }, QUIT_AFTER_MS);
  }
}).catch((err) => {
  logEvent("main-then-rejected", { message: err?.message, stack: err?.stack });
});

app.on("window-all-closed", () => {
  logEvent("window-all-closed");
});
