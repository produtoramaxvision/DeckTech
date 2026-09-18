// Pool of persistent PowerShell worker processes (see pwsh/worker.ps1),
// each keeping its Add-Type-compiled COM interop code resident so the
// (large, one-time) JIT/compile cost is paid once per worker, not once per
// icon. This is the "pooled PowerShell" candidate's whole reason to exist —
// amortizing process + compile startup across many requests.
//
// Round-2 review finding 2 (major), fixed here: the previous version had
// NO timeout anywhere and NO 'exit'/'error' handler on the child process, so
// a worker that died or never started left every pending (and future)
// request's Promise permanently unsettled — a silent hang, not a reported
// failure, and a hang contributes no failure record, so "100% success"
// could not detect it. It also `catch {}`-dropped any non-JSON stdout line
// and never read the accumulated stderr buffer, so the actual cause was
// captured but unreachable. All four are fixed below: every request has a
// timeout that rejects with the app path + worker pid + stderr tail;
// `waitReady()` has its own timeout for the same reason; 'exit'/'error'
// handlers reject every pending promise (including a still-pending ready);
// non-JSON stdout is surfaced via an `onDiagnostic` callback instead of
// silently discarded.
import { spawn } from "node:child_process";
import readline from "node:readline";

const DEFAULT_READY_TIMEOUT_MS = 15000;
const DEFAULT_REQUEST_TIMEOUT_MS = 8000;
const STDERR_TAIL_CHARS = 2000;

export class PwshTimeoutError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "PwshTimeoutError";
    Object.assign(this, details);
  }
}

export class PwshWorkerDiedError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "PwshWorkerDiedError";
    Object.assign(this, details);
  }
}

class PwshWorker {
  /**
   * @param {string} scriptPath
   * @param {{onDiagnostic?: (line: string, worker: PwshWorker) => void}} [opts]
   */
  constructor(scriptPath, opts = {}) {
    this.scriptPath = scriptPath;
    this.onDiagnostic = opts.onDiagnostic || (() => {});
    this.proc = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    this.pid = this.proc.pid;
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.nextId = 1;
    this.dead = false;
    this.deadReason = null;
    this.stderrBuf = [];
    this.proc.stderr.on("data", (d) => {
      const s = d.toString();
      this.stderrBuf.push(s);
    });
    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line) => this._onLine(line));

    this._readyResolve = null;
    this._readyReject = null;
    this.readyPromise = new Promise((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
    });

    // 'exit'/'error' handlers: reject EVERY pending promise for this worker
    // (including a still-pending ready) with the exit code and stderr tail,
    // instead of letting them hang forever. This is what closes the two
    // reproduced hangs: (a) a bad script path -> the process exits non-zero
    // almost immediately, before READY, so readyPromise now rejects instead
    // of the caller waiting past its own timeout; (b) a worker killed
    // mid-run -> every in-flight request() promise now rejects immediately
    // on the 'exit' event instead of waiting out its full per-request
    // timeout.
    const onDeath = (reason) => {
      if (this.dead) return;
      this.dead = true;
      this.deadReason = reason;
      const stderrTail = this.stderrBuf.join("").slice(-STDERR_TAIL_CHARS);
      const err = new PwshWorkerDiedError(`pwsh worker (pid=${this.pid}) died: ${reason}; stderr tail: ${JSON.stringify(stderrTail)}`, {
        pid: this.pid,
        reason,
        stderrTail,
      });
      if (this._readyReject) {
        this._readyReject(err);
        this._readyReject = null;
      }
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
    };
    this.proc.on("exit", (code, signal) => onDeath(`exit code=${code} signal=${signal}`));
    this.proc.on("error", (err) => onDeath(`spawn/process error: ${err.message}`));
  }

  _onLine(line) {
    const trimmed = line.trim();
    if (trimmed === "READY") {
      if (this._readyResolve) {
        this._readyResolve();
        this._readyResolve = null;
        this._readyReject = null;
      }
      return;
    }
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      // Round-2 fix: previously `catch {}` silently dropped this line even
      // though it might be the ONLY evidence of what went wrong (e.g. a
      // PowerShell terminating error printed to stdout instead of stderr).
      // Surfaced via onDiagnostic instead of discarded.
      this.onDiagnostic(trimmed, this);
      return;
    }
    if (msg.id === null || msg.id === undefined) {
      // worker.ps1's malformed-request error envelope (no id recoverable
      // from unparsable request JSON) — cannot resolve any pending promise
      // by id, but must not be dropped silently either.
      this.onDiagnostic(`worker reported malformed-request error (no id to pair): ${trimmed}`, this);
      return;
    }
    const pending = this.pending.get(msg.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(msg.id);
      pending.resolve(msg);
    } else {
      this.onDiagnostic(`response for unknown/already-settled id=${msg.id}: ${trimmed}`, this);
    }
  }

  /** Resolves once READY is seen; rejects on timeout OR if the process dies first. */
  waitReady(timeoutMs = DEFAULT_READY_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const stderrTail = this.stderrBuf.join("").slice(-STDERR_TAIL_CHARS);
        reject(
          new PwshTimeoutError(`pwsh worker (pid=${this.pid}) did not signal READY within ${timeoutMs}ms; stderr tail: ${JSON.stringify(stderrTail)}`, {
            pid: this.pid,
            timeoutMs,
            stderrTail,
            phase: "ready",
          })
        );
      }, timeoutMs);
      this.readyPromise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  /** Sends one request; resolves/rejects within timeoutMs no matter what happens to the worker. */
  request(targetPath, outFile, size, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    if (this.dead) {
      return Promise.reject(
        new PwshWorkerDiedError(`pwsh worker (pid=${this.pid}) is already dead (${this.deadReason}); cannot send request for ${targetPath}`, {
          pid: this.pid,
          app: targetPath,
        })
      );
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const stderrTail = this.stderrBuf.join("").slice(-STDERR_TAIL_CHARS);
        reject(
          new PwshTimeoutError(
            `pwsh request timed out after ${timeoutMs}ms: app=${targetPath} worker pid=${this.pid} stderr tail=${JSON.stringify(stderrTail)}`,
            { pid: this.pid, app: targetPath, timeoutMs, stderrTail, phase: "request" }
          )
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const line = JSON.stringify({ id, path: targetPath, out: outFile, size });
      try {
        this.proc.stdin.write(line + "\n");
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new PwshWorkerDiedError(`failed to write request to pwsh worker (pid=${this.pid}) stdin: ${err.message}`, { pid: this.pid, app: targetPath }));
      }
    });
  }

  kill() {
    try {
      this.proc.stdin.end();
    } catch {}
    try {
      this.proc.kill();
    } catch {}
  }
}

export class PwshPool {
  /**
   * @param {string} scriptPath @param {number} size
   * @param {{onDiagnostic?: (line: string, workerPid: number) => void}} [opts]
   */
  constructor(scriptPath, size, opts = {}) {
    const onDiagnostic = opts.onDiagnostic || ((line, worker) => console.error(`[pwsh-pool] diagnostic (pid=${worker.pid}): ${line}`));
    this.workers = Array.from({ length: size }, () => new PwshWorker(scriptPath, { onDiagnostic }));
  }

  /**
   * Spawns and waits for every worker to signal READY, or rejects (does NOT
   * hang) if any worker times out or dies first. Returns { startupMs, perWorkerMs }.
   */
  async start(readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS) {
    const t0 = performance.now();
    const perWorkerMs = await Promise.all(
      this.workers.map(async (w) => {
        const wt0 = performance.now();
        await w.waitReady(readyTimeoutMs);
        return performance.now() - wt0;
      })
    );
    const startupMs = performance.now() - t0;
    return { startupMs, perWorkerMs };
  }

  /** Round-robin dispatch of one request; caller picks the worker index. */
  worker(index) {
    return this.workers[index % this.workers.length];
  }

  get size() {
    return this.workers.length;
  }

  stop() {
    for (const w of this.workers) w.kill();
  }
}
