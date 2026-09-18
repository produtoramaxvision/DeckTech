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
 * which carries no --type flag — but ONLY when `name` is actually
 * electron.exe.
 *
 * ROUND-4 FIX (minor finding #6): the previous version returned
 * "browser (main)" for ANY process with no --type= flag, Electron or not.
 * The round-3 reviewer's reproduction of finding #1 printed
 * `RiotClientServices.exe [browser (main)] pid=18248` inside a contaminated
 * tree — a third-party process actively mislabeled as an Electron browser
 * process, which is exactly the shape of anomaly a reader scanning fmtTree()
 * output for contamination needs surfaced, not camouflaged. This is a
 * labeling safety net only, not the fix for the contamination itself (that
 * is the CreationDate-based ppid-staleness guard in processTreeOnce below) —
 * a legitimately-spawned non-Electron child must still show up in the tree,
 * just under an honest label. */
function chromiumRole(commandLine, name) {
  if (!name || name.toLowerCase() !== "electron.exe") {
    return `non-Electron (${name || "unknown name"})`;
  }
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

// ROUND-2 claim, FALSIFIED in round-4 (major finding #2) — kept here,
// crossed out in prose rather than deleted, because the base64 encoding it
// motivated is still the right design (see below) even though the reason
// given for it was wrong. The round-2 comment asserted, as measured fact,
// that "Windows PowerShell 5.1's ConvertTo-Json does not reliably escape
// every control character ... it emits the raw byte inside the JSON string
// literal". Round-4's reviewer disproved this directly: feeding all 32
// control characters 0x00-0x1F through `ConvertTo-Json -Compress` on this
// same machine (PSVersion 5.1.22621.6133), via both a hashtable and a
// PSCustomObject, produces every one correctly escaped as \u00xx, with zero
// raw control characters in the output — reproduced independently in this
// round (see measure/windows/proof-08/, git history for the throwaway
// verification script; ADR §6 quotes the exact output). The reviewer also
// replayed the actual pre-fix command (`Get-CimInstance Win32_Process |
// Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,CommandLine |
// ConvertTo-Json -Compress`) five times under 797-813 concurrent processes:
// 5/5 JSON.parse OK, zero raw control characters every time. Reproduced
// again in this round, same result. A `JSON.parse` failure WAS observed
// live in round 2 — that is not disputed — but its mechanism was never
// actually isolated; the control-character explanation was a plausible
// guess that turned out to be wrong.
//
// The base64 encoding below is kept anyway, for the reason round-4's
// reviewer named in finding #3: `enum-windows.ps1`'s round-trip of raw
// window titles through this exact PowerShell-to-JSON-to-Node pipe is
// corrupted not by a control-character escaping bug but by a CONSOLE OUTPUT
// ENCODING mismatch — `[Console]::OutputEncoding` on this machine is
// `ibm850`/cp850 (confirmed: `[Console]::OutputEncoding.WebName` ->
// "ibm850"), not UTF-8, while Node decodes `execFile`'s stdout as UTF-8. Any
// non-ASCII byte PowerShell writes to stdout under cp850 is silently
// mis-decoded on the Node side. Base64 output is pure ASCII by construction,
// so it is immune to that mismatch regardless of console code page — this is
// the actual reason to keep encoding CommandLine (and, now, window titles —
// see enum-windows.ps1) as base64, not the falsified control-character
// claim.
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
          "CreatedMs = if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { $null }; " +
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
              // CreationDate is absent (null) for a small number of
              // protected/system processes this account cannot query. Those
              // processes never legitimately appear as a child of ours, so
              // treating "no CreationDate" as "cannot be validated, don't
              // block on it" (see processTreeOnce) is safe — it only ever
              // widens what's accepted, never narrows what's rejected.
              createdMs: p.CreatedMs ?? null,
              role: chromiumRole(commandLine, p.Name),
              workingSetBytes: p.WorkingSetSize ?? 0,
            };
          })
        );
      }
    );
  });
}

// ROUND-4 FIX (blocker finding #1). Round-3's guard validated ONLY the
// ROOT's process name (expectedRootName, below) — every descendant was
// admitted on ParentProcessId alone. Windows does not clear a process's
// recorded ParentProcessId when that parent dies, and recycles pids
// aggressively under this machine's process churn, so an orphaned process
// whose STALE ParentProcessId happens to collide with one of our live pids
// gets summed straight into "idle RSS, whole process tree". Reproduced by
// the round-4 reviewer: RiotClientServices.exe (pid 18248, created a day
// before the run, real parent long dead) got adopted into an Approach-A
// idle tree because its stale ParentProcessId matched the round's Electron
// main pid, corrupting one rep's idle-RSS reading by +64.5 MB (2 of 41
// measured trees affected, systematic scan) and collapsing the ADR's
// central A-vs-B delta into noise (delta 57.8 MB fell INSIDE A's own spread
// of 74.3 MB once the contaminated rep was included).
//
// Fix — the canonical Windows ppid-staleness guard: a process's own
// CreationDate is authoritative and immutable; a REAL parent-child
// relationship requires the parent to have been created at or before the
// child (a child cannot be created before the process that spawned it
// exists). During the tree walk, a candidate child whose CreatedMs is
// strictly earlier than the node being walked into it from is refused —
// its ParentProcessId is stale (recycled), not real, and it is excluded
// from the tree (and, correctly, from further recursion under it) rather
// than silently summed into the total. A child with unknown CreatedMs
// (null — see snapshotAllProcesses) is NOT refused on that basis alone;
// only a POSITIVE creation-time inversion is treated as proof of staleness.
async function processTreeOnce(rootPid, expectedRootName, notBeforeMs) {
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
  // ROUND-4 FIX (minor finding #7). A name-only guard cannot distinguish OUR
  // electron.exe from any other electron.exe on the machine (another
  // Electron app, or a concurrent proof-08 run) that happens to recycle
  // rootPid — round-3's ADR §5.2 overclaimed "is not at risk" for exactly
  // this residual case. Compare the root's own CreatedMs against the
  // timestamp the caller recorded when IT spawned this process
  // (notBeforeMs, threaded through from run.mjs's spawnTs /
  // crash-timeline.mjs's t0) — a reused pid whose process predates our own
  // spawn call cannot be the process we started, regardless of name match.
  if (notBeforeMs != null && rootNode.createdMs != null && rootNode.createdMs < notBeforeMs) return [];
  const byPpid = new Map();
  for (const p of all) {
    if (!byPpid.has(p.ppid)) byPpid.set(p.ppid, []);
    byPpid.get(p.ppid).push(p);
  }
  const out = [];
  const visit = (pid, depth, parentCreatedMs) => {
    const node = byPid.get(pid);
    if (!node) return;
    // The ppid-staleness guard itself (see function header comment above).
    if (parentCreatedMs != null && node.createdMs != null && node.createdMs < parentCreatedMs) return;
    out.push({ ...node, depth });
    for (const child of byPpid.get(pid) || []) visit(child.pid, depth + 1, node.createdMs);
  };
  visit(rootPid, 0, null);
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
 * empty, non-erroring results — see below).
 *
 * `notBeforeMs` (ROUND-4 FIX, minor finding #7): the caller's own
 * `Date.now()` timestamp from just before it spawned rootPid, so a recycled
 * pid whose process predates that spawn is refused rather than trusted on
 * name match alone — see processTreeOnce's header comment. Callers that
 * omit it (none currently do — run.mjs and crash-timeline.mjs both pass
 * their recorded spawn timestamp) get the weaker, name-only guard. */
export async function processTree(rootPid, { retries = 3, retryDelayMs = 250, expectedRootName = "electron.exe", notBeforeMs = null } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    try {
      const out = await processTreeOnce(rootPid, expectedRootName, notBeforeMs);
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
// ROUND-4 FIX (minor finding #7, same upgrade as processTree): name match
// alone cannot tell our electron.exe apart from any other electron.exe (or
// a concurrent proof-08 run) that recycles `pid`. `notBeforeMs`, when
// given, additionally requires the matched process's own CreatedMs to be at
// or after the caller's recorded spawn time.
export async function isPidAlive(pid, { retries = 3, retryDelayMs = 250, expectedName = "electron.exe", notBeforeMs = null } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    try {
      const all = await snapshotAllProcesses();
      return all.some((p) =>
        p.pid === pid &&
        (!expectedName || p.name.toLowerCase() === expectedName.toLowerCase()) &&
        (notBeforeMs == null || p.createdMs == null || p.createdMs >= notBeforeMs)
      );
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
// ROUND-4 FIX (major finding #3): enum-windows.ps1 now emits titleB64/
// classB64 (base64, immune to this machine's cp850 console output encoding
// — see enum-windows.ps1's header) instead of raw title/class text. Decode
// here, once, so every caller still sees plain `title`/`class` strings.
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
        if (!Array.isArray(data)) data = [data];
        resolve(
          data.map((w) => ({
            pid: w.pid,
            class: w.classB64 ? Buffer.from(w.classB64, "base64").toString("utf8") : w.class ?? "",
            title: w.titleB64 ? Buffer.from(w.titleB64, "base64").toString("utf8") : w.title ?? "",
            visible: w.visible,
          }))
        );
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
// "bound" success line, because startDiscovery (server.js:202-215) only
// ever logs on ITS OWN bind error (`sock.on("error", ...)`, server.js:212 —
// ROUND-4 FIX, minor finding #8: this comment previously cited server.js:212
// as the span's own line and left the span itself as 202-212; the function
// is 202-215 and the reply-log line it must NOT be confused with is 210);
// there is no
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
