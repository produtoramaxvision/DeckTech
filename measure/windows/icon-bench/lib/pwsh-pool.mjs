// Pool of persistent PowerShell worker processes (see pwsh/worker.ps1),
// each keeping its Add-Type-compiled COM interop code resident so the
// (large, one-time) JIT/compile cost is paid once per worker, not once per
// icon. This is the "pooled PowerShell" candidate's whole reason to exist —
// amortizing process + compile startup across many requests.
import { spawn } from "node:child_process";
import readline from "node:readline";

class PwshWorker {
  constructor(scriptPath) {
    this.proc = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    this.pending = new Map();
    this.nextId = 1;
    this.stderrBuf = [];
    this.proc.stderr.on("data", (d) => this.stderrBuf.push(d.toString()));
    this.rl = readline.createInterface({ input: this.proc.stdout });
    this._readyResolve = null;
    this.readyPromise = new Promise((resolve) => {
      this._readyResolve = resolve;
    });
    this.rl.on("line", (line) => this._onLine(line));
  }

  _onLine(line) {
    const trimmed = line.trim();
    if (trimmed === "READY") {
      this._readyResolve();
      return;
    }
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }
    const pending = this.pending.get(msg.id);
    if (pending) {
      this.pending.delete(msg.id);
      pending.resolve(msg);
    }
  }

  waitReady() {
    return this.readyPromise;
  }

  request(targetPath, outFile, size) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const line = JSON.stringify({ id, path: targetPath, out: outFile, size });
      this.proc.stdin.write(line + "\n");
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
  /** @param {string} scriptPath @param {number} size */
  constructor(scriptPath, size) {
    this.workers = Array.from({ length: size }, () => new PwshWorker(scriptPath));
  }

  /** Spawns and waits for every worker to signal READY. Returns { startupMs, perWorkerMs }. */
  async start() {
    const t0 = performance.now();
    const perWorkerMs = await Promise.all(
      this.workers.map(async (w) => {
        const wt0 = performance.now();
        await w.waitReady();
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
