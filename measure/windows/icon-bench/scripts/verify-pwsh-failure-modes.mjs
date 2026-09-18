// Round-3 review promotion (finding 6, MINOR): the round-2 ADR's "Revisão
// round 2" section describes FOUR pwsh-pool failure scenarios as reproduced
// evidence for lib/pwsh-pool.mjs's timeout/death handling, but all four
// lived only as ad hoc scripts under the gitignored .tmp/ — unreproducible
// by anyone who clones the repo. Promoted here as one committed, runnable
// script that asserts (not just prints) each outcome and exits non-zero on
// an unexpected result, using __dirname-relative paths so it works from any
// cwd (the .tmp/ originals used bare "pwsh/worker.ps1" / ".tmp/..." — cwd
// dependence in a committed script is its own rule-5-flavored smell).
//
// Scenarios, each exercising a DIFFERENT code path in lib/pwsh-pool.mjs:
//   1. bad script path       -> process dies almost immediately, before READY
//   2. worker killed mid-request -> process dies while a request is pending
//   3. request timeout       -> worker is ALIVE but never responds to a request
//   4. ready timeout         -> worker is ALIVE but never signals READY
//   5. malformed request     -> worker responds with an error envelope and
//                                keeps serving real requests afterward
//
// Usage: node scripts/verify-pwsh-failure-modes.mjs
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PwshPool, PwshTimeoutError, PwshWorkerDiedError } from "../lib/pwsh-pool.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const scratchDir = path.join(rootDir, ".tmp", "pwsh-failure-modes");
rmSync(scratchDir, { recursive: true, force: true });
mkdirSync(scratchDir, { recursive: true });

const realWorkerScript = path.join(rootDir, "pwsh", "worker.ps1");
const neverRespondsScript = path.join(rootDir, "pwsh", "stub-worker-never-responds.ps1");
const neverReadyScript = path.join(rootDir, "pwsh", "stub-worker-never-ready.ps1");

let failures = 0;

function assert(cond, label, detail) {
  if (cond) {
    console.log(`[verify-pwsh-failure-modes] PASS: ${label}${detail ? " — " + detail : ""}`);
  } else {
    console.error(`[verify-pwsh-failure-modes] FAIL: ${label}${detail ? " — " + detail : ""}`);
    failures++;
  }
}

// -- 1. bad script path -----------------------------------------------------
async function scenarioBadScriptPath() {
  console.log("\n[verify-pwsh-failure-modes] === scenario 1: bad script path (process dies before READY) ===");
  const pool = new PwshPool(path.join(rootDir, "pwsh", "this-script-does-not-exist.ps1"), 1);
  const t0 = performance.now();
  try {
    await pool.start(5000);
    assert(false, "start() rejects for a nonexistent script path", "start() unexpectedly RESOLVED");
  } catch (err) {
    const elapsed = performance.now() - t0;
    console.log(`[verify-pwsh-failure-modes]   rejected after ${elapsed.toFixed(0)}ms, name=${err.name}`);
    assert(err instanceof PwshWorkerDiedError, "rejection is a PwshWorkerDiedError (process death, not a request timeout)", `got ${err.name}`);
    assert(elapsed < 5000, "rejected well before the 5000ms readyTimeoutMs (proves this is the death path, not the timeout path)", `${elapsed.toFixed(0)}ms`);
  } finally {
    pool.stop();
  }
}

// -- 2. worker killed mid-request -------------------------------------------
async function scenarioKillMidRequest() {
  console.log("\n[verify-pwsh-failure-modes] === scenario 2: worker killed mid-request ===");
  const pool = new PwshPool(realWorkerScript, 1);
  await pool.start();
  const pid = pool.worker(0).pid;
  console.log(`[verify-pwsh-failure-modes]   pool ready, pid=${pid}`);
  const out = path.join(scratchDir, "kill-test-out.png");
  const reqPromise = pool.worker(0).request("C:\\Windows\\System32\\notepad.exe", out, 256, 8000);
  const t0 = performance.now();
  setTimeout(() => {
    console.log(`[verify-pwsh-failure-modes]   killing worker pid=${pid} mid-request`);
    pool.worker(0).proc.kill();
  }, 5);
  try {
    await reqPromise;
    assert(false, "in-flight request() rejects when its worker is killed", "request() unexpectedly RESOLVED despite kill");
  } catch (err) {
    const elapsed = performance.now() - t0;
    console.log(`[verify-pwsh-failure-modes]   rejected after ${elapsed.toFixed(0)}ms, name=${err.name}`);
    assert(err instanceof PwshWorkerDiedError, "rejection is a PwshWorkerDiedError", `got ${err.name}`);
    assert(elapsed < 8000, "rejected well before the 8000ms request timeout (proves this is the death path, not the timeout path)", `${elapsed.toFixed(0)}ms`);
  } finally {
    pool.stop();
  }
}

// -- 3. request timeout (worker alive, never responds) ----------------------
async function scenarioRequestTimeout() {
  console.log("\n[verify-pwsh-failure-modes] === scenario 3: request timeout (worker alive, never responds) ===");
  const pool = new PwshPool(neverRespondsScript, 1);
  await pool.start();
  console.log(`[verify-pwsh-failure-modes]   stub worker ready, pid=${pool.worker(0).pid}`);
  const out = path.join(scratchDir, "timeout-test-out.png");
  const t0 = performance.now();
  try {
    await pool.worker(0).request("C:\\Windows\\System32\\notepad.exe", out, 256, 1000);
    assert(false, "request() rejects with PwshTimeoutError when the worker never responds", "request() unexpectedly RESOLVED");
  } catch (err) {
    const elapsed = performance.now() - t0;
    console.log(`[verify-pwsh-failure-modes]   rejected after ${elapsed.toFixed(0)}ms, name=${err.name}`);
    assert(err instanceof PwshTimeoutError, "rejection is a PwshTimeoutError (not a process-death error)", `got ${err.name}`);
    assert(err.timeoutMs === 1000, "error carries the configured timeoutMs", `got ${err.timeoutMs}`);
    assert(elapsed >= 950 && elapsed <= 3000, "elapsed time is close to the configured 1000ms timeout, not instant and not indefinite", `${elapsed.toFixed(0)}ms`);
  } finally {
    pool.stop();
  }
}

// -- 4. ready timeout (worker alive, never signals READY) -------------------
async function scenarioReadyTimeout() {
  console.log("\n[verify-pwsh-failure-modes] === scenario 4: ready timeout (worker alive, never signals READY) ===");
  const pool = new PwshPool(neverReadyScript, 1);
  const t0 = performance.now();
  try {
    await pool.start(1000);
    assert(false, "start() rejects with PwshTimeoutError when a worker never signals READY", "start() unexpectedly RESOLVED");
  } catch (err) {
    const elapsed = performance.now() - t0;
    console.log(`[verify-pwsh-failure-modes]   rejected after ${elapsed.toFixed(0)}ms, name=${err.name}`);
    assert(err instanceof PwshTimeoutError, "rejection is a PwshTimeoutError", `got ${err.name}`);
    assert(elapsed >= 950 && elapsed <= 3000, "elapsed time is close to the configured 1000ms readyTimeoutMs", `${elapsed.toFixed(0)}ms`);
  } finally {
    pool.stop();
  }
}

// -- 5. malformed request (worker survives, keeps serving) ------------------
async function scenarioMalformedRequest() {
  console.log("\n[verify-pwsh-failure-modes] === scenario 5: malformed request (worker survives, keeps serving) ===");
  const diagnostics = [];
  const pool = new PwshPool(realWorkerScript, 1, { onDiagnostic: (line) => diagnostics.push(line) });
  await pool.start();
  console.log("[verify-pwsh-failure-modes]   pool ready");
  pool.worker(0).proc.stdin.write("{this is not valid json\n");
  await new Promise((r) => setTimeout(r, 500));
  console.log(`[verify-pwsh-failure-modes]   diagnostics captured: ${JSON.stringify(diagnostics)}`);
  assert(diagnostics.length > 0, "malformed stdin line is surfaced via onDiagnostic, not silently dropped");
  const out = path.join(scratchDir, "malformed-test-out.png");
  try {
    const resp = await pool.worker(0).request("C:\\Windows\\System32\\notepad.exe", out, 256, 8000);
    assert(resp.ok === true, "worker is still alive and serves a REAL request after the malformed one", JSON.stringify(resp));
  } catch (err) {
    assert(false, "worker is still alive and serves a REAL request after the malformed one", `request() threw: ${err.message}`);
  } finally {
    pool.stop();
  }
}

async function main() {
  await scenarioBadScriptPath();
  await scenarioKillMidRequest();
  await scenarioRequestTimeout();
  await scenarioReadyTimeout();
  await scenarioMalformedRequest();
  rmSync(scratchDir, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n[verify-pwsh-failure-modes] FATAL: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\n[verify-pwsh-failure-modes] PASS: all 5 pwsh-pool failure scenarios behave as lib/pwsh-pool.mjs documents (2 process-death paths, 2 distinct timeout paths, 1 malformed-request-survives path).");
}

main().catch((err) => {
  console.error("[verify-pwsh-failure-modes] FATAL (unhandled):", err);
  process.exit(1);
});
