// PROOF-08 shared helpers — process tree snapshot (Windows, via PowerShell CIM),
// HTTP health polling and isolated-env plumbing. No production file is imported
// here; server.js is only ever imported/forked by the two main-*.mjs probes.
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

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

/** One PowerShell round-trip snapshotting every OS process (pid, parent pid,
 * name, role, working-set bytes). Used to build the tree under a given root pid. */
function snapshotAllProcesses() {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,CommandLine | ConvertTo-Json -Compress",
      ],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        let data;
        try { data = JSON.parse(stdout); } catch (e) { return reject(e); }
        if (!Array.isArray(data)) data = [data];
        resolve(
          data.map((p) => ({
            pid: p.ProcessId,
            ppid: p.ParentProcessId,
            name: p.Name,
            role: chromiumRole(p.CommandLine),
            workingSetBytes: p.WorkingSetSize ?? 0,
          }))
        );
      }
    );
  });
}

async function processTreeOnce(rootPid) {
  const all = await snapshotAllProcesses();
  const byPpid = new Map();
  for (const p of all) {
    if (!byPpid.has(p.ppid)) byPpid.set(p.ppid, []);
    byPpid.get(p.ppid).push(p);
  }
  const byPid = new Map(all.map((p) => [p.pid, p]));
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
 * Retries once on an empty result: a `Get-CimInstance Win32_Process` snapshot
 * that comes back with zero nodes for a root we otherwise expect to be alive
 * is, on this machine, usually a transient WMI hiccup under load (this box
 * runs 100+ concurrent node.exe processes from unrelated sessions) rather
 * than a real "the process is gone" — confirmed by an immediate re-query
 * finding it present. A caller that genuinely expects the process to be gone
 * (e.g. right after an OS-level kill) still gets a correct [] once the retry
 * also comes back empty. */
export async function processTree(rootPid, { retries = 1, retryDelayMs = 250 } = {}) {
  let out = await processTreeOnce(rootPid);
  let attempt = 0;
  while (out.length === 0 && attempt < retries) {
    await new Promise((r) => setTimeout(r, retryDelayMs));
    out = await processTreeOnce(rootPid);
    attempt++;
  }
  return out;
}

export function sumRss(tree) {
  return tree.reduce((acc, p) => acc + p.workingSetBytes, 0);
}

export function mb(bytes) {
  return bytes / (1024 * 1024);
}

export async function isPidAlive(pid) {
  const all = await snapshotAllProcesses();
  return all.some((p) => p.pid === pid);
}

export function fmtTree(tree) {
  return tree
    .map((p) => `${"  ".repeat(p.depth)}${p.name} [${p.role}] (pid ${p.pid}) — ${mb(p.workingSetBytes).toFixed(1)} MB WS`)
    .join("\n");
}
