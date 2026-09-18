# PROOF-08 — ROUND-3 FIX (major finding #2). Enumerates every top-level
# Win32 window on this desktop session (pid, class, title, visibility) via
# EnumWindows/GetWindowThreadProcessId/GetClassName/GetWindowText/
# IsWindowVisible. This folds what round-2's ADR called "a small PowerShell
# probe, not committed — one-off verification" into a committed, reusable
# script that measure/windows/proof-08/lib.mjs's windowsForPids() shells out
# to and crash-timeline.mjs polls with, so the window-survival evidence in
# ADR §5 is reproducible from `node crash-timeline.mjs inprocess`, not just
# from a reviewer's own uncommitted session.
#
# Measured cost of this invocation on this machine (Add-Type recompiles the
# P/Invoke shim fresh every process launch — there is no way to cache it
# across a stateless execFile call): ~1.0s wall clock, `time powershell.exe
# -NoProfile -NonInteractive -File enum-windows.ps1` — see crash-timeline.mjs
# header for how this is disclosed as actual (not nominal) poll cadence.
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class ProofEightWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
}
"@

$results = New-Object System.Collections.ArrayList
$callback = {
  param($hWnd, $lParam)
  $procId = 0
  [ProofEightWin32]::GetWindowThreadProcessId($hWnd, [ref]$procId) | Out-Null
  $cls = New-Object System.Text.StringBuilder 256
  [ProofEightWin32]::GetClassName($hWnd, $cls, 256) | Out-Null
  $txt = New-Object System.Text.StringBuilder 256
  [ProofEightWin32]::GetWindowText($hWnd, $txt, 256) | Out-Null
  $vis = [ProofEightWin32]::IsWindowVisible($hWnd)
  # Non-empty title only, to cut noise from the hundreds of invisible/
  # titleless helper windows every process on this machine owns — the
  # caller (lib.mjs windowsForPids) filters by pid on top of this.
  if ($txt.ToString().Length -gt 0) {
    [void]$results.Add(@{ pid = [int]$procId; class = $cls.ToString(); title = $txt.ToString(); visible = [bool]$vis })
  }
  return $true
}
[ProofEightWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
$results | ConvertTo-Json -Compress
