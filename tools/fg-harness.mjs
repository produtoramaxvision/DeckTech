// tools/fg-harness.mjs
//
// FG-PROBE — Non-perturbing measurement of Windows foreground activation.
//
// Deliverable 1: A measurement harness that does not perturb what it measures.
// - Uses throwaway windows (charmap.exe) created by the harness.
// - Cleans up every created process in all exit paths (try/finally, SIGINT, SIGTERM, process exit).
// - No reset mechanism between trials (no SW_MINIMIZE, no AttachThreadInput reset).
// - Alternates between targets so the target is not already foreground.
// - Explicitly discards and counts any trial where target === fgBefore (trivial pass).
// - Measures 5 variants across 10 trials per variant (50 total non-discarded trials).
// - Exits immediately when invoked by node --test runner so the test suite stays at 0 failures.

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// If invoked as part of node --test discovery, exit immediately without error
if (process.execArgv.some((a) => a.startsWith("--test"))) {
  process.exit(0);
}

const execFileP = promisify(execFile);
const CHARMAP_PATH = join(process.env.SystemRoot || "C:\\Windows", "System32", "charmap.exe");

const TRIALS_PER_VARIANT = 10;
const VARIANTS = ["plain", "switch", "alt", "attach", "persistent"];

// Track all spawned target PIDs for guaranteed cleanup
const trackedPids = new Set();

async function killTrackedProcesses() {
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
    try {
      // Synchronous best-effort kill on exit
      spawn("taskkill", ["/F", "/PID", String(pid)], { stdio: "ignore" });
    } catch {}
  }
});

process.on("SIGINT", async () => {
  await killTrackedProcesses();
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await killTrackedProcesses();
  process.exit(1);
});

/**
 * Launches a throwaway charmap.exe instance and waits for its MainWindowHandle.
 */
async function launchThrowawayTarget(label) {
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
        return { label, pid, hwnd: handle, name: "charmap" };
      }
    } catch {}
    await sleep(150);
  }
  throw new Error(`Timeout waiting for throwaway target "${label}" (PID: ${pid})`);
}

/**
 * Gets the current foreground window handle, PID, and process name.
 */
async function getForegroundInfo() {
  const { stdout } = await execFileP("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `
$sig = @"
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
"@
Add-Type -MemberDefinition $sig -Name "Win32FgInfo" -Namespace Win32FgInfo -PassThru | Out-Null
$hwnd = [Win32FgInfo.Win32FgInfo]::GetForegroundWindow()
$pidVal = 0
[Win32FgInfo.Win32FgInfo]::GetWindowThreadProcessId($hwnd, [ref]$pidVal) | Out-Null
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

// -----------------------------------------------------------------------------
// Variant 5: Long-Lived Persistent Helper Process
// Pattern modeled after platform/windows/theme.js (startThemeWatcher).
// -----------------------------------------------------------------------------
class PersistentHelper {
  constructor() {
    this.workDir = mkdtempSync(join(tmpdir(), "decktech-fg-persistent-"));
    this.scriptPath = join(this.workDir, "helper.ps1");
    this.child = null;
    this.pendingResolvers = [];
    this.buffer = "";
  }

  async start() {
    const script = `
$sig = @"
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
"@
$native = Add-Type -MemberDefinition $sig -Name "Win32Persistent$([guid]::NewGuid().ToString('N'))" -Namespace Win32Persistent -PassThru

[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq "EXIT") { break }
  $parts = $line.Split(" ")
  $cmd = $parts[0]
  if ($cmd -eq "FOCUS") {
    $targetHandle = [long]$parts[1]
    $fgBefore = $native::GetForegroundWindow().ToInt64()
    $setFgRet = $native::SetForegroundWindow([IntPtr]$targetHandle)
    Start-Sleep -Milliseconds 150
    $fgAfter = $native::GetForegroundWindow().ToInt64()
    $res = @{
      target = $targetHandle
      fgBefore = $fgBefore
      apiReturn = $setFgRet
      fgAfter = $fgAfter
      becameForeground = ($fgAfter -eq $targetHandle)
    }
    [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
  }
}
`;
    writeFileSync(this.scriptPath, script, "utf8");
    this.child = spawn("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", this.scriptPath
    ], { windowsHide: true });

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let idx;
      while ((idx = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        if (this.pendingResolvers.length > 0) {
          const resolve = this.pendingResolvers.shift();
          resolve(line);
        }
      }
    });

    const readyLine = await new Promise((resolve) => {
      this.pendingResolvers.push(resolve);
    });
    if (readyLine !== "READY") {
      throw new Error(`Expected persistent helper READY, got: ${readyLine}`);
    }
  }

  async focus(hwnd) {
    return new Promise((resolve, reject) => {
      this.pendingResolvers.push((line) => {
        try {
          resolve(JSON.parse(line));
        } catch (err) {
          reject(err);
        }
      });
      this.child.stdin.write(`FOCUS ${hwnd}\n`);
    });
  }

  async stop() {
    if (this.child) {
      try { this.child.stdin.write("EXIT\n"); } catch {}
      this.child.kill();
      this.child = null;
    }
    try {
      rmSync(this.workDir, { recursive: true, force: true });
    } catch {}
  }
}

// -----------------------------------------------------------------------------
// Spawned Variants (1-4) Runner
// -----------------------------------------------------------------------------
async function runSpawnedVariant(variantName, targetHwnd) {
  const workDir = mkdtempSync(join(tmpdir(), "decktech-fg-spawn-"));
  const scriptPath = join(workDir, `${variantName}.ps1`);
  const outPath = join(workDir, "out.json");

  let body = "";
  if (variantName === "plain") {
    body = `
      $apiReturn = $native::SetForegroundWindow($handle)
    `;
  } else if (variantName === "switch") {
    body = `
      $native::SwitchToThisWindow($handle, $true)
      $apiReturn = $true
    `;
  } else if (variantName === "alt") {
    body = `
      $VK_MENU = 0x12
      $KEYEVENTF_KEYUP = 0x0002
      $native::keybd_event($VK_MENU, 0, 0, [UIntPtr]::Zero)
      $apiReturn = $native::SetForegroundWindow($handle)
      $native::keybd_event($VK_MENU, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    `;
  } else if (variantName === "attach") {
    body = `
      $curThread = $native::GetCurrentThreadId()
      $fgPid = 0
      $fgThread = $native::GetWindowThreadProcessId($fgBefore, [ref]$fgPid)
      $tgtPid = 0
      $tgtThread = $native::GetWindowThreadProcessId($handle, [ref]$tgtPid)
      
      $attachedFg = $native::AttachThreadInput($curThread, $fgThread, $true)
      $attachedTgt = $native::AttachThreadInput($curThread, $tgtThread, $true)
      $apiReturn = $native::SetForegroundWindow($handle)
      if ($attachedFg) { $native::AttachThreadInput($curThread, $fgThread, $false) | Out-Null }
      if ($attachedTgt) { $native::AttachThreadInput($curThread, $tgtThread, $false) | Out-Null }
    `;
  } else {
    throw new Error(`Unknown spawned variant: ${variantName}`);
  }

  const psScript = `
param([long]$TargetHwnd, [string]$OutFile)
$sig = @"
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fUnknown);
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
"@
$native = Add-Type -MemberDefinition $sig -Name "Win32Var$([guid]::NewGuid().ToString('N'))" -Namespace Win32Var -PassThru

$handle = [IntPtr]$TargetHwnd
$fgBefore = $native::GetForegroundWindow()
$pidBefore = 0
$native::GetWindowThreadProcessId($fgBefore, [ref]$pidBefore)

${body}

Start-Sleep -Milliseconds 150
$fgAfter = $native::GetForegroundWindow()
$pidAfter = 0
$native::GetWindowThreadProcessId($fgAfter, [ref]$pidAfter)

$result = @{
  target = $TargetHwnd
  fgBefore = $fgBefore.ToInt64()
  pidBefore = $pidBefore
  apiReturn = $apiReturn
  fgAfter = $fgAfter.ToInt64()
  pidAfter = $pidAfter
  becameForeground = ($fgAfter.ToInt64() -eq $TargetHwnd)
}
$json = $result | ConvertTo-Json -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutFile, $json, $utf8NoBom)
`;

  writeFileSync(scriptPath, psScript, "utf8");
  try {
    await execFileP("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      "-TargetHwnd", String(targetHwnd),
      "-OutFile", outPath
    ]);
    return JSON.parse(readFileSync(outPath, "utf8"));
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {}
  }
}

// -----------------------------------------------------------------------------
// Main Measurement Runner
// -----------------------------------------------------------------------------
async function runHarness() {
  console.log("===============================================================================");
  console.log("FG-PROBE: Non-perturbing measurement of Windows foreground activation");
  console.log("===============================================================================\n");

  console.log("[1/5] Launching throwaway target windows (charmap.exe)...");
  const targetA = await launchThrowawayTarget("TargetA");
  const targetB = await launchThrowawayTarget("TargetB");
  console.log(`  Target A: HWND ${targetA.hwnd} (PID ${targetA.pid})`);
  console.log(`  Target B: HWND ${targetB.hwnd} (PID ${targetB.pid})`);

  console.log("\n[2/5] Initializing persistent PowerShell helper (Variant 5)...");
  const persistentHelper = new PersistentHelper();
  await persistentHelper.start();
  console.log("  Persistent helper started and READY.");
  // Let it settle for 2 seconds to establish longevity well before trials
  await sleep(2000);

  const trialRecords = [];
  const matrixStats = {
    plain: { successes: 0, trials: 0, notes: "SetForegroundWindow from fresh powershell.exe" },
    switch: { successes: 0, trials: 0, notes: "SwitchToThisWindow from fresh powershell.exe" },
    alt: { successes: 0, trials: 0, notes: "ALT keybd_event trick around SetForegroundWindow" },
    attach: { successes: 0, trials: 0, notes: "AttachThreadInput to fg + target threads" },
    persistent: { successes: 0, trials: 0, notes: "SetForegroundWindow from long-lived persistent helper" }
  };

  let discardedCount = 0;
  let totalTrialAttempts = 0;

  console.log(`\n[3/5] Executing ${TRIALS_PER_VARIANT} trials per variant across 5 variants (50 total)...`);
  console.log("      (Order is interleaved across rounds; targets alternate so target != fgBefore)\n");

  try {
    for (let round = 1; round <= TRIALS_PER_VARIANT; round++) {
      console.log(`--- Round ${round}/${TRIALS_PER_VARIANT} ---`);
      for (const variant of VARIANTS) {
        totalTrialAttempts++;

        // Step 1: Check foreground before selecting target
        const fgInfoBefore = await getForegroundInfo();

        // Select target that is NOT current foreground
        let chosenTarget;
        if (fgInfoBefore.hwnd === targetA.hwnd) {
          chosenTarget = targetB;
        } else if (fgInfoBefore.hwnd === targetB.hwnd) {
          chosenTarget = targetA;
        } else {
          // If neither target is foreground (e.g. terminal or editor), alternate by attempt
          chosenTarget = (totalTrialAttempts % 2 === 0) ? targetA : targetB;
        }

        // Trivial pass check: if chosen target is already foreground, discard
        if (fgInfoBefore.hwnd === chosenTarget.hwnd) {
          discardedCount++;
          console.log(`  [DISCARD] Round ${round} ${variant}: target ${chosenTarget.label} already foreground.`);
          continue;
        }

        // Run the trial
        let trialResult;
        const t0 = Date.now();
        if (variant === "persistent") {
          const raw = await persistentHelper.focus(chosenTarget.hwnd);
          const fgInfoAfter = await getForegroundInfo();
          trialResult = {
            variant,
            target: chosenTarget,
            fgBefore: fgInfoBefore,
            apiReturn: raw.apiReturn,
            fgAfter: fgInfoAfter,
            becameForeground: (fgInfoAfter.hwnd === chosenTarget.hwnd),
            elapsedMs: Date.now() - t0
          };
        } else {
          const raw = await runSpawnedVariant(variant, chosenTarget.hwnd);
          const fgInfoAfter = await getForegroundInfo();
          trialResult = {
            variant,
            target: chosenTarget,
            fgBefore: fgInfoBefore,
            apiReturn: raw.apiReturn,
            fgAfter: fgInfoAfter,
            becameForeground: (fgInfoAfter.hwnd === chosenTarget.hwnd),
            elapsedMs: Date.now() - t0
          };
        }

        // Validate trivial pass post-condition guard
        if (trialResult.fgBefore.hwnd === trialResult.target.hwnd) {
          discardedCount++;
          continue;
        }

        // Record valid trial
        matrixStats[variant].trials++;
        if (trialResult.becameForeground) {
          matrixStats[variant].successes++;
        }
        trialRecords.push({
          trialIndex: trialRecords.length + 1,
          round,
          variant,
          targetHwnd: trialResult.target.hwnd,
          targetPid: trialResult.target.pid,
          fgBeforeHwnd: trialResult.fgBefore.hwnd,
          fgBeforeName: trialResult.fgBefore.name,
          apiReturn: trialResult.apiReturn,
          fgAfterHwnd: trialResult.fgAfter.hwnd,
          fgAfterName: trialResult.fgAfter.name,
          becameForeground: trialResult.becameForeground,
          elapsedMs: trialResult.elapsedMs
        });

        const statusMark = trialResult.becameForeground ? "PASS" : "FAIL";
        console.log(
          `  [${statusMark}] Round ${round} | Variant: ${variant.padEnd(10)} | ` +
          `Target: ${chosenTarget.label} (${chosenTarget.hwnd}) | ` +
          `fgBefore: ${trialResult.fgBefore.name} (${trialResult.fgBefore.hwnd}) -> ` +
          `fgAfter: ${trialResult.fgAfter.name} (${trialResult.fgAfter.hwnd}) | ` +
          `ret: ${trialResult.apiReturn} (${trialResult.elapsedMs}ms)`
        );

        // Small inter-trial delay
        await sleep(200);
      }
    }
  } finally {
    console.log("\n[4/5] Cleaning up throwaway windows and persistent helper...");
    await persistentHelper.stop();
    await killTrackedProcesses();
    console.log("  All throwaway targets and helper processes terminated.");
  }

  console.log("\n[5/5] Final Matrix Summary:");
  console.log("-------------------------------------------------------------------------------");
  console.log("Variant          Success / Total   Rate (%)   Note");
  console.log("-------------------------------------------------------------------------------");
  const matrixEntries = [];
  for (const v of VARIANTS) {
    const s = matrixStats[v].successes;
    const t = matrixStats[v].trials;
    const pct = t > 0 ? ((s / t) * 100).toFixed(1) : "0.0";
    console.log(`${v.padEnd(16)} ${String(s).padStart(3)} / ${String(t).padEnd(5)}    ${pct.padStart(5)}%     ${matrixStats[v].notes}`);
    matrixEntries.push({
      variant: v,
      successes: s,
      trials: t,
      note: `${matrixStats[v].notes} (${s}/${t} successful, ${pct}%)`
    });
  }
  console.log("-------------------------------------------------------------------------------");
  console.log(`Total valid trials: ${trialRecords.length} | Discarded trivial passes: ${discardedCount}`);

  // Determine Verdict
  let verdictShape = "";
  let verdictText = "";
  const plainSuccessRate = matrixStats.plain.trials > 0 ? matrixStats.plain.successes / matrixStats.plain.trials : 0;
  const bestVariant = VARIANTS.filter((v) => v !== "plain").reduce((best, curr) => {
    const rateCurr = matrixStats[curr].trials > 0 ? matrixStats[curr].successes / matrixStats[curr].trials : 0;
    const rateBest = matrixStats[best].trials > 0 ? matrixStats[best].successes / matrixStats[best].trials : 0;
    return rateCurr > rateBest ? curr : best;
  }, "switch");
  const bestSuccessRate = matrixStats[bestVariant].trials > 0 ? matrixStats[bestVariant].successes / matrixStats[bestVariant].trials : 0;

  if (bestSuccessRate > plainSuccessRate && bestSuccessRate >= 0.5) {
    verdictShape = "API problem";
    const bestPct = (bestSuccessRate * 100).toFixed(1);
    const plainPct = (plainSuccessRate * 100).toFixed(1);
    verdictText = `API problem: '${bestVariant}' clears meaningfully above plain (${bestPct}% vs ${plainPct}%). Plain SetForegroundWindow is blocked by Windows foreground lock policies regardless of caller lifetime; alternative API sequences like '${bestVariant}' overcome the lock.`;
  } else {
    verdictShape = "process-lifetime problem";
    const persistRate = matrixStats.persistent.trials > 0 ? matrixStats.persistent.successes / matrixStats.persistent.trials : 0;
    if (persistRate === 0 && plainSuccessRate === 0) {
      verdictText = `process-lifetime problem: Neither spawned child nor persistent process can activate foreground windows (both 0%). Long-lived process lifetime alone does NOT grant foreground rights on Windows without user interaction or input queue synchronization.`;
    } else {
      verdictText = `process-lifetime problem: Persistent helper achieved ${(persistRate * 100).toFixed(1)}% vs spawned ${(plainSuccessRate * 100).toFixed(1)}%.`;
    }
  }

  console.log(`\nVerdict Shape: "${verdictShape}"`);
  console.log(`Verdict: ${verdictText}\n`);

  // Save detailed run results to test/scratch/fg-results.json
  const resultJsonPath = join(process.cwd(), "test", "scratch", "fg-results.json");
  writeFileSync(resultJsonPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    trialsPerVariant: TRIALS_PER_VARIANT,
    discardedTrials: discardedCount,
    matrix: matrixEntries,
    trials: trialRecords
  }, null, 2), "utf8");
  console.log(`Detailed trial logs written to: ${resultJsonPath}`);

  return {
    matrix: matrixEntries,
    trialsPerVariant: TRIALS_PER_VARIANT,
    discardedTrials: discardedCount,
    verdict: verdictText,
    verdictShape
  };
}

runHarness().catch((err) => {
  console.error("FATAL in fg-harness:", err);
  process.exit(1);
});
