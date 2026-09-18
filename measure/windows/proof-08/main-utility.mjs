// PROOF-08 — Approach A: utilityProcess.fork pointing at the REAL server.js.
// Electron main process entry, launched by run.mjs as `electron main-utility.mjs`.
// Driven entirely by env vars so run.mjs can repeat it and vary timings:
//   PROOF08_PORT              port server.js listens on
//   PROOF08_APPDATA           isolated %APPDATA% for both server.js and Electron itself
//   PROOF08_LOG_FILE          JSON-lines event log (appended)
//   PROOF08_HEARTBEAT_FILE    JSON snapshot overwritten every 200ms while main is alive
//   PROOF08_CRASH_AFTER_MS    if set, ms after server-ready to inject an unhandled
//                             throw inside the forked server process.
//   PROOF08_QUIT_AFTER_MS     if set, ms after server-ready at which this main process
//                             calls app.quit() on its own (clean-shutdown reps)
//
// EMPIRICAL NOTE: this originally forked server.js directly in BOTH the idle
// and crash sub-tests, injecting the crash via
// `execArgv: ["--import", "<crash-injector.mjs>"]`. That preload is silently
// never loaded — confirmed with a load-time console.error marker that never
// printed, while the forked server.js kept answering /health 200 for 19s+
// with the "scheduled" crash completely inert. utilityProcess.fork does not
// honor an injected `--import`/`--require` the way plain Node
// child_process.fork does. So the crash sub-test forks server-entry-crash.mjs
// instead — a thin wrapper that calls the real, unmodified `startServer`
// export and then throws — while the idle/cold-start sub-test still forks
// server.js directly, matching the task literally.
import { app, BrowserWindow, utilityProcess } from "electron";
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "..", "..", "server.js"); // repo root/server.js
const crashEntryPath = join(here, "server-entry-crash.mjs");

const PORT = Number(process.env.PROOF08_PORT || 3991);
const LOG_FILE = process.env.PROOF08_LOG_FILE;
const HEARTBEAT_FILE = process.env.PROOF08_HEARTBEAT_FILE;
const CRASH_AFTER_MS = process.env.PROOF08_CRASH_AFTER_MS;
const QUIT_AFTER_MS = process.env.PROOF08_QUIT_AFTER_MS ? Number(process.env.PROOF08_QUIT_AFTER_MS) : null;

function logEvent(event, extra = {}) {
  if (!LOG_FILE) return;
  appendFileSync(LOG_FILE, JSON.stringify({ t: Date.now(), event, ...extra }) + "\n");
}

let win = null;
let serverPid = null;
let serverAlive = false;

function writeHeartbeat() {
  if (!HEARTBEAT_FILE) return;
  try {
    writeFileSync(
      HEARTBEAT_FILE,
      JSON.stringify({
        t: Date.now(),
        approach: "utility-process",
        mainPid: process.pid,
        windowExists: !!win && !win.isDestroyed(),
        windowVisible: !!win && !win.isDestroyed() && win.isVisible(),
        serverPid,
        serverAlive,
      })
    );
  } catch {}
}

logEvent("main-module-start", { mainPid: process.pid, serverPath });

app.whenReady().then(() => {
  logEvent("app-ready");

  win = new BrowserWindow({
    width: 480,
    height: 300,
    show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL("data:text/html,<h1>DeckTech PROOF-08 (utilityProcess.fork)</h1>");
  logEvent("window-created", { windowId: win.id });

  const heartbeatTimer = setInterval(writeHeartbeat, 200);
  writeHeartbeat();

  const modulePath = CRASH_AFTER_MS ? crashEntryPath : serverPath;
  logEvent("server-start-begin", { port: PORT, modulePath });
  const child = utilityProcess.fork(modulePath, [], {
    env: {
      ...process.env,
      PORT: String(PORT),
      APPDATA: process.env.PROOF08_APPDATA || process.env.APPDATA,
      PROOF08_CRASH_AFTER_MS: CRASH_AFTER_MS || "",
    },
    stdio: "pipe",
  });
  serverPid = child.pid;
  serverAlive = true;
  logEvent("server-forked", { serverPid: child.pid, modulePath });

  const onOut = (buf) => logEvent("server-stdout", { line: buf.toString("utf8").trim() });
  const onErr = (buf) => logEvent("server-stderr", { line: buf.toString("utf8").trim() });
  child.stdout?.on("data", onOut);
  child.stderr?.on("data", onErr);

  child.on("exit", (code) => {
    serverAlive = false;
    logEvent("server-exit", { code, mainStillAlive: true, windowStillExists: !!win && !win.isDestroyed() });
    writeHeartbeat();
  });

  child.on("spawn", () => {
    logEvent("server-spawn-confirmed", { serverPid: child.pid });
  });

  if (CRASH_AFTER_MS) {
    logEvent("crash-scheduled", { afterMs: Number(CRASH_AFTER_MS), target: "utility-child" });
  }

  if (QUIT_AFTER_MS) {
    setTimeout(() => {
      logEvent("quitting", { windowStillExists: !!win && !win.isDestroyed(), serverAlive });
      clearInterval(heartbeatTimer);
      writeHeartbeat();
      app.quit();
    }, QUIT_AFTER_MS);
  }
});

app.on("window-all-closed", () => {
  logEvent("window-all-closed");
});

process.on("uncaughtException", (err) => {
  // Main process of approach A should never crash from the server's fault;
  // if it does, that is itself an important, reportable finding.
  logEvent("main-uncaught-exception", { message: err?.message, stack: err?.stack });
});
