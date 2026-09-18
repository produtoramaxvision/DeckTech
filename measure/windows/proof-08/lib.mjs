// PROOF-08 shared helpers — process tree snapshot (Windows, via PowerShell CIM),
// HTTP health polling and isolated-env plumbing. No production file is imported
// here; server.js is only ever imported/forked by the two main-*.mjs probes.
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const here = dirname(fileURLToPath(import.meta.url));
const ENUM_WINDOWS_SCRIPT = join(here, "enum-windows.ps1");

/** Fresh, isolated %APPDATA%-equivalent dir per run so repeated runs never
 * share a PIN/config/session file and never touch the real user profile. */
export function isolatedAppData(tag) {
  return mkdtempSync(join(tmpdir(), `decktech-proof08-${tag}-`));
}

function httpGetStatus(port, path, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
  });
}

/** Polls GET /health until it answers 200, returns elapsed ms from the moment
 * this function was called (NOT from process spawn — caller subtracts). */
export async function waitForHttp200(port, { path = "/health", intervalMs = 40, timeoutMs = 30000 } = {}) {
  const t0 = process.hrtime.bigint();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await httpGetStatus(port, path, 1500);
    if (status === 200) return Number(process.hrtime.bigint() - t0) / 1e6;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timeout waiting for HTTP 200 on ${path} at 127.0.0.1:${port}`);
}

/** Derives a human-meaningful role from an Electron/Chromium process's
 * command line (`--type=gpu-process`, `--utility-sub-type=node.mojom...` for
 * our forked server, etc.). Falls back to "browser (main)" for the root,
 * which carries no --type flag. */
function chromiumRole(commandLine) {
  if (!commandLine) return "browser (main)";
  const typeMatch = commandLine.match(/--type=([\w-]+)/);
  if (!typeMatch) return "browser (main)";
  const type = typeMatch[1];
  if (type === "utility") {
    const subType = commandLine.match(/--utility-sub-type=([\w.]+)/);
    if (subType && /node/i.test(subType[1])) return "utility (Node — our forked server.js)";
    return `utility (${subType ? subType[1] : "unknown sub-type"})`;
  }
  return type; // gpu-process, renderer, crashpad-handler, etc.
}

// ROUND-2 FIX (blocker #1): the previous version piped raw CommandLine text
// straight through `Select-Object ...,CommandLine | ConvertTo-Json -Compress`.
// Windows PowerShell 5.1's ConvertTo-Json does not reliably escape every
// control character (bare 0x0A/0x0B/etc. that can legitimately appear inside
// a process's own command line) when it serializes a string — it emits the
// raw byte inside the JSON string literal, which is not valid JSON and makes
// `JSON.parse` throw `SyntaxError: Bad control character in string literal`.
// With 100+ concurrent processes on this machine, some process's CommandLine
// containing a stray control character is a when-not-if, so this reliably
// broke the ENTIRE battery on the first `processTree()` call it hit,
// regardless of which of our own processes was the root being queried.
//
// Fix: never round-trip free-form CommandLine text through ConvertTo-Json.
// PowerShell base64-encodes it (Base64 is pure ASCII by construction, so
// ConvertTo-Json cannot mis-serialize it no matter what bytes it started as)
// and this file decodes it back on the JS side before deriving the role.
function snapshotAllProcesses() {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | ForEach-Object { " +
          "[PSCustomObject]@{ " +
          "ProcessId = $_.ProcessId; " +
          "ParentProcessId = $_.ParentProcessId; " +
          "Name = $_.Name; " +
          "WorkingSetSize = $_.WorkingSetSize; " +
          "CommandLineB64 = if ($_.CommandLine) { [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($_.CommandLine)) } else { $null } " +
          "} " +
          "} | ConvertTo-Json -Compress",
      ],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        let data;
        try { data = JSON.parse(stdout); } catch (e) { return reject(e); }
        if (!Array.isArray(data)) data = [data];
        resolve(
          data.map((p) => {
            const commandLine = p.CommandLineB64
              ? Buffer.from(p.CommandLineB64, "base64").toString("utf8")
              : null;
            return {
              pid: p.ProcessId,
              ppid: p.ParentProcessId,
              name: p.Name,
              role: chromiumRole(commandLine),
              workingSetBytes: p.WorkingSetSize ?? 0,
            };
          })
        );
      }
    );
  });
}

async function processTreeOnce(rootPid, expectedRootName) {
  const all = await snapshotAllProcesses();
  const byPid = new Map(all.map((p) => [p.pid, p]));
  // ROUND-3 FIX (self-found during this round's own smoke-testing, not one
  // of the reviewer's 9 findings — same discipline as round-2's
  // isPidAlive-retry fix, disclosed here for the same reason). Windows
  // recycles pids aggressively under this machine's 800+ concurrent process
  // churn. A snapshot taken shortly after our own Electron process has
  // genuinely exited can find `rootPid` already reused by a completely
  // unrelated process — REPRODUCED LIVE while smoke-testing this round's
  // code: a B-matched crash rep's post-crash processTree() call returned a
  // non-empty tree rooted at the exited main pid, but that tree was
  // `bash.exe -> conhost.exe/bash.exe/python3.exe` — an unrelated shell
  // process that had grabbed the pid, not our Electron process. Trusting
  // the pid alone would have printed "process tree after crash: (non-empty)"
  // for what is actually the correct "gone" case, directly contradicting
  // §5.2's central "process tree empty, root process gone" claim on
  // whichever rep got unlucky. Fix: verify the root node's own process name
  // matches what we spawned (always "electron.exe" — see run.mjs/
  // crash-timeline.mjs, which both `spawn(electronPath, ...)`) before
  // trusting it as "still alive"; a pid match with a name mismatch is
  // treated identically to "not found" (returns []).
  const rootNode = byPid.get(rootPid);
  if (!rootNode) return [];
  if (expectedRootName && rootNode.name.toLowerCase() !== expectedRootName.toLowerCase()) return [];
  const byPpid = new Map();
  for (const p of all) {
    if (!byPpid.has(p.ppid)) byPpid.set(p.ppid, []);
    byPpid.get(p.ppid).push(p);
  }
  const out = [];
  const visit = (pid, depth) => {
    const node = byPid.get(pid);
    if (!node) return;
    out.push({ ...node, depth });
    for (const child of byPpid.get(pid) || []) visit(child.pid, depth + 1);
  };
  visit(rootPid, 0);
  return out;
}

/** Depth-first process tree rooted at rootPid, each node annotated with depth
 * and workingSetBytes. Returns [] if rootPid is genuinely gone.
 *
 * Retries on an empty result AND on a thrown error from the snapshot itself
 * (e.g. a PowerShell/JSON hiccup) — up to `retries` times. An empty snapshot
 * for a root we otherwise expect to be alive is, on this machine, usually a
 * transient WMI hiccup under load (this box runs 100+ concurrent node.exe
 * processes from unrelated sessions) rather than a real "the process is
 * gone" — confirmed by an immediate re-query finding it present. A caller
 * that genuinely expects the process to be gone (e.g. right after an
 * OS-level kill) still gets a correct [] once the retries are exhausted with
 * only empty (not erroring) results.
 *
 * ROUND-2 FIX (blocker #1): the previous version only retried on
 * `out.length === 0` — a thrown `SyntaxError` from `processTreeOnce()`
 * propagated straight past the retry and killed the whole battery (see the
 * comment on `snapshotAllProcesses` for the root cause, now fixed there
 * too). This loop now catches thrown errors the same way it handles empty
 * results, and only rethrows once retries are exhausted on an erroring
 * attempt.
 *
 * Default `retries` raised from 1 to 3 after observing, live on this
 * machine (791 concurrent processes from other sessions at the time), that
 * `Get-CimInstance` can genuinely fail (a real nonzero-exit PowerShell
 * error, not just malformed output) two attempts in a row under sustained
 * load — not the JSON bug (already fixed), a separate, load-induced
 * transient. 3 attempts with a 250ms backoff absorbs that without masking a
 * real "process is gone" (still resolved correctly once retries exhaust on
 * empty, non-erroring results — see below). */
export async function processTree(rootPid, { retries = 3, retryDelayMs = 250, expectedRootName = "electron.exe" } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    try {
      const out = await processTreeOnce(rootPid, expectedRootName);
      lastErr = null;
      if (out.length > 0 || attempt === retries) return out;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

export function sumRss(tree) {
  return tree.reduce((acc, p) => acc + p.workingSetBytes, 0);
}

export function mb(bytes) {
  return bytes / (1024 * 1024);
}

// ROUND-2 FIX: this had NO retry at all — a single transient
// `Get-CimInstance` failure under this machine's heavy concurrent load (see
// processTree's comment above) would throw straight out of here uncaught.
// crash-timeline.mjs calls this every ~300ms inside its main polling loop —
// exactly the load-bearing data blocker #1 was about — so it gets the same
// retry protection as processTree, not a bare single attempt.
// ROUND-3 FIX (self-found, same pid-reuse defect as processTreeOnce above):
// a bare pid match is not enough on this machine — verify the name too, or
// a reused pid reports "alive" for a completely unrelated process.
export async function isPidAlive(pid, { retries = 3, retryDelayMs = 250, expectedName = "electron.exe" } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    try {
      const all = await snapshotAllProcesses();
      return all.some((p) => p.pid === pid && (!expectedName || p.name.toLowerCase() === expectedName.toLowerCase()));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export function fmtTree(tree) {
  return tree
    .map((p) => `${"  ".repeat(p.depth)}${p.name} [${p.role}] (pid ${p.pid}) — ${mb(p.workingSetBytes).toFixed(1)} MB WS`)
    .join("\n");
}

// ROUND-3 FIX (major finding #2). Round-2's window-survival evidence for
// "B, default handler" (ADR §5 box) rested on "a small PowerShell probe, not
// committed — one-off verification" — a reader of the ADR had no way to
// reproduce it. enum-windows.ps1 (this directory) is that probe, committed;
// this wraps it with the same retry tolerance every other PowerShell-backed
// helper in this file has, and does the pid filtering on the JS side so the
// PS script itself stays a flat, reusable "every titled window on this
// desktop" dump.
function enumAllWindows() {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-File", ENUM_WINDOWS_SCRIPT],
      { maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        let data;
        try { data = JSON.parse(stdout || "[]"); } catch (e) { return reject(e); }
        resolve(Array.isArray(data) ? data : [data]);
      }
    );
  });
}

/** Every titled Win32 window owned by any pid in `pids`. Retries like
 * processTree/isPidAlive: EnumWindows recompiles its Add-Type P/Invoke shim
 * on every invocation (~0.8–1.1 s measured on this machine — see
 * enum-windows.ps1's header and crash-timeline.mjs's actual-cadence
 * logging), so a transient PowerShell hiccup under this machine's
 * concurrent load gets the same tolerance as the CIM-based probes rather
 * than crashing the whole poll loop. */
export async function windowsForPids(pids, { retries = 2, retryDelayMs = 250 } = {}) {
  const wanted = new Set(pids);
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    try {
      const all = await enumAllWindows();
      return all.filter((w) => wanted.has(w.pid));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ROUND-3 FIX (major finding #1c). Positive evidence for whether
// startDiscovery(3001)'s UDP bind actually succeeded for OUR forked child,
// via Get-NetUDPEndpoint's OwningProcess — never by scraping stdout for a
// "bound" success line, because startDiscovery (server.js:202-212) only
// ever logs on ITS OWN bind error (`sock.on("error", ...)`); there is no
// success log line to scrape. A machine-state-dependent ambient process can
// hold the port instead of us (observed live on this machine — see ADR §4),
// so the log text alone ("no EADDRINUSE seen") cannot distinguish "we
// bound" from "we never got far enough to try".
export async function discoveryBindOwner(port, { retries = 2, retryDelayMs = 200 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    try {
      const owner = await new Promise((resolve, reject) => {
        execFile(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `$e = Get-NetUDPEndpoint -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1; if ($e) { $e.OwningProcess } else { -1 }`,
          ],
          { maxBuffer: 1024 * 1024 },
          (err, stdout) => {
            if (err) return reject(err);
            const n = Number(String(stdout).trim());
            resolve(Number.isFinite(n) ? n : -1);
          }
        );
      });
      return owner; // -1 = nobody is bound to this port right now
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
