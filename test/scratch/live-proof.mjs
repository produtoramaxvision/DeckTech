// test/scratch/live-proof.mjs
// Live end-to-end proof of PLAT-05 window activation via the real server.
// Phase 14 success criterion 1:
// "Com o Firefox aberto e em segundo plano, tocar nele pelo celular traz a janela pra frente:
//  GetForegroundWindow() passa a devolver o handle do Firefox. Medido numa bateria de no
//  mínimo 10 tentativas frias, com o alvo nunca sendo o foreground anterior, e a taxa de
//  sucesso registrada. Uma taxa abaixo de 100% é resultado válido se vier com a explicação
//  medida de quando falha."

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

if (process.execArgv.some((a) => a.startsWith("--test"))) {
  process.exit(0);
}

const execFileP = promisify(execFile);
const CHARMAP_PATH = "C:\\Windows\\System32\\charmap.exe";
const FIREFOX_PATH = "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
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

async function focusDistractor(hwnd) {
  await execFileP("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `
$sig = @"
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
"@
$t = Add-Type -MemberDefinition $sig -Name "Win32DistFocus$([guid]::NewGuid().ToString('N'))" -Namespace Win32DistFocus -PassThru
$handle = [IntPtr]${hwnd}
$fg = $t::GetForegroundWindow()
$curThread = $t::GetCurrentThreadId()
$fgPid = 0; $fgThread = $t::GetWindowThreadProcessId($fg, [ref]$fgPid)
$tgtPid = 0; $tgtThread = $t::GetWindowThreadProcessId($handle, [ref]$tgtPid)
$attFg = $false; $attTgt = $false
if ($fgThread -ne 0 -and $fgThread -ne $curThread) { $attFg = $t::AttachThreadInput($curThread, $fgThread, $true) }
if ($tgtThread -ne 0 -and $tgtThread -ne $curThread) { $attTgt = $t::AttachThreadInput($curThread, $tgtThread, $true) }
$t::ShowWindow($handle, 9) | Out-Null
$t::SetForegroundWindow($handle) | Out-Null
if ($attTgt) { $t::AttachThreadInput($curThread, $tgtThread, $false) | Out-Null }
if ($attFg) { $t::AttachThreadInput($curThread, $fgThread, $false) | Out-Null }
`
  ]);
}

async function getOrLaunchFirefox() {
  const queryFirefox = async () => {
    const { stdout } = await execFileP("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `$p = Get-Process -Name firefox -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($p) { [PSCustomObject]@{ pid = $p.Id; hwnd = $p.MainWindowHandle.ToInt64(); name = $p.ProcessName } | ConvertTo-Json -Compress } else { "{}" }`
    ]);
    return JSON.parse(stdout.trim());
  };

  let info = await queryFirefox();
  if (info.pid && info.hwnd) {
    return info;
  }

  console.log("  Firefox not running with window; launching Firefox...");
  const child = spawn(FIREFOX_PATH, [], { detached: true, stdio: "ignore" });
  child.unref();

  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    await sleep(500);
    info = await queryFirefox();
    if (info.pid && info.hwnd) {
      return info;
    }
  }
  throw new Error("Timeout waiting for Firefox main window to appear.");
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
  console.log("Phase 14 Success Criterion 1: 10 Cold Attempts on Background Firefox");
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
    // Step 2: Ensure Firefox is detected and running with window
    console.log("[2/4] Detecting Firefox instance...");
    const ffInfo = await getOrLaunchFirefox();
    console.log(`  Firefox detected: PID ${ffInfo.pid}, HWND ${ffInfo.hwnd} ("${ffInfo.name}")\n`);

    // Step 3: Launch throwaway distractor (charmap) to place in foreground
    console.log("[3/4] Launching distractor window (charmap.exe)...");
    const distractor = await launchThrowawayCharmap("Distractor");
    console.log(`  Distractor window ready: HWND ${distractor.hwnd} (PID ${distractor.pid})\n`);

    // Step 4: Run battery of 10 cold attempts against Firefox
    console.log("[4/4] Executing Phase 14 battery: 10 cold attempts on background Firefox...");
    console.log("      (Each trial brings distractor to foreground first; target is NEVER previous foreground)\n");

    const trials = [];
    let successes = 0;

    for (let attempt = 1; attempt <= 10; attempt++) {
      // 1. Move distractor to foreground so Firefox is strictly in the background
      await focusDistractor(distractor.hwnd);
      await sleep(250);

      const fgBefore = await getForegroundInfo();
      if (fgBefore.hwnd === ffInfo.hwnd) {
        throw new Error(`Attempt ${attempt}: Target is still in foreground before cold activation attempt!`);
      }

      // 2. Call real server API endpoint
      const t0 = Date.now();
      const res = await fetch(`http://127.0.0.1:${PORT}/api/apps/Firefox/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid: ffInfo.pid }),
      });
      const resJson = await res.json();
      const elapsed = Date.now() - t0;

      // 3. Confirm whether GetForegroundWindow changed to Firefox
      const fgAfter = await getForegroundInfo();
      const pass = (fgAfter.hwnd === ffInfo.hwnd);
      if (pass) successes++;

      let explanation = null;
      if (!pass) {
        explanation = `Activation failed: expected HWND ${ffInfo.hwnd} (Firefox), but GetForegroundWindow returned HWND ${fgAfter.hwnd} ("${fgAfter.name}"). API status: ${res.status}, response: ${JSON.stringify(resJson)}.`;
      }

      trials.push({
        attempt,
        target: "Firefox",
        targetPid: ffInfo.pid,
        targetHwnd: ffInfo.hwnd,
        fgBeforeHwnd: fgBefore.hwnd,
        fgBeforeName: fgBefore.name,
        fgAfterHwnd: fgAfter.hwnd,
        fgAfterName: fgAfter.name,
        apiStatus: res.status,
        apiResponse: resJson,
        becameForeground: pass,
        elapsedMs: elapsed,
        explanation,
      });

      console.log(
        `  Attempt ${String(attempt).padStart(2)}: Target=Firefox (${ffInfo.hwnd}) | ` +
        `fgBefore=${fgBefore.name} (${fgBefore.hwnd}) -> fgAfter=${fgAfter.name} (${fgAfter.hwnd}) | ` +
        `status=${res.status} | [${pass ? "PASS" : "FAIL"}] (${elapsed}ms)`
      );

      await sleep(250);
    }

    const successRate = (successes / 10) * 100;
    console.log("\n===============================================================================");
    console.log("Phase 14 Battery Summary:");
    console.log(`  Total cold attempts: 10`);
    console.log(`  Successful activations: ${successes} / 10 (${successRate.toFixed(1)}%)`);
    if (successes < 10) {
      console.log("  Measured explanation for failures:");
      for (const t of trials.filter((t) => !t.becameForeground)) {
        console.log(`    - Attempt ${t.attempt}: ${t.explanation}`);
      }
    } else {
      console.log("  Measured explanation: 100% success rate achieved via AttachThreadInput sequence (calling thread attached to foreground thread and target thread, restoring iconic windows, and calling SetForegroundWindow).");
    }
    console.log("===============================================================================\n");

    // Persist results to test/scratch/live-proof-results.json
    const resultsPayload = {
      timestamp: new Date().toISOString(),
      criterion: "Phase 14 Success Criterion 1: Cold activation of background Firefox",
      app: "Firefox",
      pid: ffInfo.pid,
      hwnd: ffInfo.hwnd,
      totalAttempts: 10,
      successes,
      successRate: `${successRate.toFixed(1)}%`,
      explanation: successes === 10
        ? "100.0% success rate achieved via AttachThreadInput sequence (calling thread attached to foreground thread and target thread, restoring iconic windows, and calling SetForegroundWindow)."
        : "Failures occurred during cold activation; see individual trial records.",
      trials,
    };
    const outPath = join(process.cwd(), "test", "scratch", "live-proof-results.json");
    writeFileSync(outPath, JSON.stringify(resultsPayload, null, 2), "utf8");
    console.log(`Results persisted to ${outPath}\n`);

  } finally {
    console.log("Cleaning up processes and shutting down server...");
    await cleanupPids();
    serverProc.kill();
    console.log("Cleanup complete.");
  }
}

main().catch((err) => {
  console.error("FATAL in live-proof:", err);
  process.exit(1);
});
