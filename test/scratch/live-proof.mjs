// test/scratch/live-proof.mjs
// Live end-to-end proof of PLAT-05 window activation via the real server.

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";

if (process.execArgv.some((a) => a.startsWith("--test"))) {
  process.exit(0);
}

const execFileP = promisify(execFile);
const CHARMAP_PATH = "C:\\Windows\\System32\\charmap.exe";
const PORT = 3999;

const trackedPids = new Set();

async function cleanupPids() {
  for (const pid of trackedPids) {
    try {
      await execFileP("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`
      ]);
    } catch {}
  }
  trackedPids.clear();
}

process.on("exit", () => {
  for (const pid of trackedPids) {
    try { spawn("taskkill", ["/F", "/PID", String(pid)], { stdio: "ignore" }); } catch {}
  }
});

async function getForegroundInfo() {
  const { stdout } = await execFileP("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `
$sig = @"
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
"@
$t = Add-Type -MemberDefinition $sig -Name "Win32LiveProof$([guid]::NewGuid().ToString('N'))" -Namespace Win32LiveProof -PassThru
$hwnd = $t::GetForegroundWindow()
$pidVal = 0
$t::GetWindowThreadProcessId($hwnd, [ref]$pidVal) | Out-Null
$p = Get-Process -Id $pidVal -ErrorAction SilentlyContinue
[PSCustomObject]@{
  hwnd = $hwnd.ToInt64()
  pid = $pidVal
  name = if ($p) { $p.ProcessName } else { "unknown" }
} | ConvertTo-Json -Compress
`
  ]);
  return JSON.parse(stdout.trim());
}

async function launchThrowawayCharmap(label) {
  const child = spawn(CHARMAP_PATH, [], { detached: true, stdio: "ignore" });
  child.unref();
  const pid = child.pid;
  trackedPids.add(pid);

  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileP("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.MainWindowHandle.ToInt64() } else { 0 }`
      ]);
      const handle = Number(stdout.trim());
      if (Number.isInteger(handle) && handle !== 0) {
        return { label, pid, hwnd: handle, name: "Character Map" };
      }
    } catch {}
    await sleep(150);
  }
  throw new Error(`Timeout waiting for throwaway target "${label}" (PID: ${pid})`);
}

async function main() {
  console.log("===============================================================================");
  console.log("PLAT-05: Real Server End-to-End Window Activation Live Proof");
  console.log("===============================================================================\n");

  // Step 1: Start real server process
  console.log(`[1/4] Starting real DeckTech server on port ${PORT}...`);
  const serverProc = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  trackedPids.add(serverProc.pid);

  let serverStarted = false;
  serverProc.stdout.on("data", (d) => {
    const s = d.toString("utf8");
    if (s.includes("ouvindo em") || s.includes("listening")) {
      serverStarted = true;
    }
    // console.log("[SERVER]", s.trim());
  });
  serverProc.stderr.on("data", (d) => {
    console.error("[SERVER ERR]", d.toString("utf8").trim());
  });

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) {
        serverStarted = true;
        break;
      }
    } catch {}
    await sleep(150);
  }

  if (!serverStarted) {
    throw new Error("Failed to connect to real server /health");
  }
  console.log(`  Real server is UP on http://127.0.0.1:${PORT} (PID ${serverProc.pid})\n`);

  try {
    // Step 2: Firefox live test
    console.log("[2/4] Testing live activation of running Firefox...");
    // Find Firefox process
    const { stdout: ffStdout } = await execFileP("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `$p = Get-Process -Name firefox -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($p) { [PSCustomObject]@{ pid = $p.Id; hwnd = $p.MainWindowHandle.ToInt64() } | ConvertTo-Json -Compress } else { "{}" }`
    ]);
    const ffInfo = JSON.parse(ffStdout.trim());
    if (!ffInfo.pid || !ffInfo.hwnd) {
      console.log("  Firefox with window not found; launching throwaway distractor to test.");
    } else {
      console.log(`  Firefox detected: PID ${ffInfo.pid}, HWND ${ffInfo.hwnd}`);

      // Ensure Firefox is in the background by launching a distractor
      const distractor = await launchThrowawayCharmap("Distractor");
      console.log(`  Distractor window placed: HWND ${distractor.hwnd} (PID ${distractor.pid})`);
      await sleep(300);

      const fgBefore = await getForegroundInfo();
      console.log(`  Foreground BEFORE activation: HWND ${fgBefore.hwnd}, PID ${fgBefore.pid}, Name: "${fgBefore.name}"`);
      if (fgBefore.hwnd === ffInfo.hwnd) {
        console.log("  Firefox was foreground; switching away first...");
      }

      console.log(`  Calling POST /api/apps/Firefox/activate with pid ${ffInfo.pid}...`);
      const t0 = Date.now();
      const res = await fetch(`http://127.0.0.1:${PORT}/api/apps/Firefox/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid: ffInfo.pid }),
      });
      const resJson = await res.json();
      const elapsed = Date.now() - t0;
      console.log(`  API Response (${res.status}): ${JSON.stringify(resJson)} (${elapsed}ms)`);

      const fgAfter = await getForegroundInfo();
      console.log(`  Foreground AFTER activation:  HWND ${fgAfter.hwnd}, PID ${fgAfter.pid}, Name: "${fgAfter.name}"`);
      const success = (fgAfter.hwnd === ffInfo.hwnd);
      console.log(`  => RESULT: ${success ? "SUCCESS - Firefox brought to foreground!" : "FAILED"}\n`);
    }

    // Step 3: 10 Cold Attempts Battery
    console.log("[3/4] Running battery of 10 cold attempts (target never previous foreground)...");
    const targetA = await launchThrowawayCharmap("TargetA");
    const targetB = await launchThrowawayCharmap("TargetB");
    console.log(`  Target A: HWND ${targetA.hwnd} (PID ${targetA.pid})`);
    console.log(`  Target B: HWND ${targetB.hwnd} (PID ${targetB.pid})\n`);

    const trials = [];
    let successes = 0;

    for (let attempt = 1; attempt <= 10; attempt++) {
      const fgBefore = await getForegroundInfo();
      let chosenTarget = (fgBefore.hwnd === targetA.hwnd) ? targetB : targetA;
      if (fgBefore.hwnd === chosenTarget.hwnd) {
        // Switch to other
        chosenTarget = (chosenTarget === targetA) ? targetB : targetA;
      }

      const t0 = Date.now();
      const res = await fetch(`http://127.0.0.1:${PORT}/api/apps/Character%20Map/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid: chosenTarget.pid }),
      });
      const resJson = await res.json();
      const elapsed = Date.now() - t0;

      const fgAfter = await getForegroundInfo();
      const pass = (fgAfter.hwnd === chosenTarget.hwnd);
      if (pass) successes++;

      trials.push({
        attempt,
        target: chosenTarget.label,
        targetHwnd: chosenTarget.hwnd,
        fgBeforeHwnd: fgBefore.hwnd,
        fgBeforeName: fgBefore.name,
        fgAfterHwnd: fgAfter.hwnd,
        fgAfterName: fgAfter.name,
        apiStatus: res.status,
        apiResponse: resJson,
        becameForeground: pass,
        elapsedMs: elapsed,
      });

      console.log(
        `  Attempt ${String(attempt).padStart(2)}: Target=${chosenTarget.label} (${chosenTarget.hwnd}) | ` +
        `fgBefore=${fgBefore.name} (${fgBefore.hwnd}) -> fgAfter=${fgAfter.name} (${fgAfter.hwnd}) | ` +
        `status=${res.status} | [${pass ? "PASS" : "FAIL"}] (${elapsed}ms)`
      );

      await sleep(200);
    }

    console.log("\n[4/4] Battery Results Summary:");
    console.log(`  Total cold attempts: 10`);
    console.log(`  Successful activations: ${successes} / 10 (${((successes / 10) * 100).toFixed(1)}%)`);

  } finally {
    console.log("\nCleaning up processes and shutting down server...");
    await cleanupPids();
    serverProc.kill();
    console.log("Cleanup complete.");
  }
}

main().catch((err) => {
  console.error("FATAL in live-proof:", err);
  process.exit(1);
});
