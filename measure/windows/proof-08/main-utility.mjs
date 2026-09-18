// PROOF-08 — Approach A: utilityProcess.fork pointing at the REAL server.js.
// Electron main process entry, launched by run.mjs as `electron main-utility.mjs`.
// Driven entirely by env vars so run.mjs can repeat it and vary timings:
//   PROOF08_PORT                     port server.js listens on
//   PROOF08_APPDATA                  isolated root dir for this rep. Two
//                                    DIFFERENT subdirectories are carved out
//                                    of it (see ROUND-2 FIX below) — one for
//                                    server.js's own %APPDATA%-equivalent
//                                    storage, one for Electron's own
//                                    userData — so the two never collide and
//                                    neither ever touches the real profile.
//   PROOF08_LOG_FILE                 JSON-lines event log (appended)
//   PROOF08_HEARTBEAT_FILE           JSON snapshot overwritten every 200ms while main is alive
//   PROOF08_CRASH_AFTER_MS           if set, ms after server-ready to inject an unhandled
//                                    throw inside the forked server process.
//   PROOF08_INSTALL_UNCAUGHT_HANDLER if set, the forked server-entry-crash.mjs
//                                    installs an explicit
//                                    `process.on('uncaughtException', ...)`
//                                    (stack to stderr, exit 1) instead of
//                                    relying on Node's own default utility-
//                                    process behavior — see ADR §5 "matched
//                                    handler policy" reps.
//   PROOF08_QUIT_AFTER_MS            if set, ms after server-ready at which this main process
//                                    calls app.quit() on its own (clean-shutdown reps)
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
//
// ROUND-2 FIX (major #3): the previous version's header claimed
// PROOF08_APPDATA was "isolated %APPDATA% for ... Electron itself" but never
// actually redirected Electron's own userData path — Chromium resolves
// chrome::DIR_USER_DATA natively from the real %APPDATA% before this JS
// module even runs, so mutating process.env.APPDATA here would have been a
// no-op for Electron regardless. The only supported way to redirect it is
// `app.setPath('userData', <dir>)`, called synchronously at module top
// level before the app is ready (confirmed via context7 against Electron's
// own test fixture spec/fixtures/apps/set-path/main.js, which does exactly
// this). Done below, identically in main-inprocess.mjs.
import { app, BrowserWindow, utilityProcess } from "electron";
import { appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "..", "..", "server.js"); // repo root/server.js
const crashEntryPath = join(here, "server-entry-crash.mjs");

const PORT = Number(process.env.PROOF08_PORT || 3991);
const LOG_FILE = process.env.PROOF08_LOG_FILE;
const HEARTBEAT_FILE = process.env.PROOF08_HEARTBEAT_FILE;
const CRASH_AFTER_MS = process.env.PROOF08_CRASH_AFTER_MS;
const INSTALL_UNCAUGHT_HANDLER = !!process.env.PROOF08_INSTALL_UNCAUGHT_HANDLER;
const QUIT_AFTER_MS = process.env.PROOF08_QUIT_AFTER_MS ? Number(process.env.PROOF08_QUIT_AFTER_MS) : null;

// Electron's own profile (GPU/shader caches, Local/Session Storage,
// Preferences, ...) redirected BEFORE app is ready — must happen at module
// top level, synchronously, per the Electron fixture cited above.
const SERVER_APPDATA_DIR = process.env.PROOF08_APPDATA ? join(process.env.PROOF08_APPDATA, "server-appdata") : null;
const ELECTRON_USERDATA_DIR = process.env.PROOF08_APPDATA ? join(process.env.PROOF08_APPDATA, "electron-userdata") : null;
if (ELECTRON_USERDATA_DIR) {
  mkdirSync(ELECTRON_USERDATA_DIR, { recursive: true });
  app.setPath("userData", ELECTRON_USERDATA_DIR);
}
if (SERVER_APPDATA_DIR) mkdirSync(SERVER_APPDATA_DIR, { recursive: true });

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
  } catch (e) {
    // ROUND-2 FIX (major #6): a swallowed write failure here (e.g. EBUSY/EPERM
    // while crash-timeline.mjs's poll loop is reading the same file) is
    // byte-identical, from the outside, to "the event loop is dead" — the
    // exact ambiguity the ADR's crash evidence depends on not having. Record
    // it as a distinguishable event instead of silently doing nothing.
    logEvent("heartbeat-write-failed", { code: e?.code, message: e?.message });
  }
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
      APPDATA: SERVER_APPDATA_DIR || process.env.APPDATA,
      PROOF08_CRASH_AFTER_MS: CRASH_AFTER_MS || "",
      PROOF08_INSTALL_UNCAUGHT_HANDLER: INSTALL_UNCAUGHT_HANDLER ? "1" : "",
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
