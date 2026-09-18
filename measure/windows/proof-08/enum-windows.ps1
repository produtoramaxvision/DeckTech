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
#
# ROUND-4 FIX (major finding #3). This script used to put the raw
# GetWindowText/GetClassName result straight into the emitted object, piped
# through `ConvertTo-Json -Compress` with no encoding control on stdout.
# [Console]::OutputEncoding on this machine is ibm850/cp850 (confirmed:
# `[Console]::OutputEncoding.WebName` -> "ibm850"), not UTF-8, while
# lib.mjs's execFile call decodes stdout as UTF-8 — any non-ASCII character
# PowerShell wrote out got silently mis-decoded on the Node side.
# Demonstrated live on this machine WITHOUT even needing a synthetic input:
# a real OS window title, "Alternância de Tarefas" (Windows 11 pt-BR Task
# Switching), came back through the pre-fix pipe as "Altern?ncia de
# Tarefas" — see docs/adr/0004-...md §9 for the captured before/after. This
# is squarely the "Windows assumption that would fail on a machine with a
# different locale" criterion: on a non-pt-BR Windows install, ANY
# accented/non-ASCII window title (including a localized Electron crash
# dialog's own title — "Erro", "Fehler", "Erreur") would come back mangled,
# corrupting the exact evidence ADR §5 rests on.
#
# Fix: base64-encode Title/Class here (base64 is pure ASCII by construction,
# so it is immune to the console code page no matter what the original
# console encoding claims to be) — matching lib.mjs's existing CommandLine
# handling exactly — and decode in lib.mjs's enumAllWindows() before this
# data reaches any caller.
#
# ROUND-5 FIX (major finding #2). GetClassName below used to be declared with
# NO CharSet, so .NET's P/Invoke default (CharSet.Ansi) applied and the import
# bound to GetClassNameA, not GetClassNameW — while this file's own header
# above, crash-timeline.mjs's header comment, and the ADR all asserted three
# times that this script calls GetClassNameW. GetWindowText next to it was
# already correctly declared `CharSet=CharSet.Auto` (-> GetWindowTextW on this
# NT-based OS); GetClassName had no such declaration and silently took the
# ANSI entry point instead. Proven on this machine with an identically-
# undeclared-vs-declared pair (GetWindowText with no CharSet vs
# CharSet=Auto, both called on the same live windows):
#   ANSI-decl = "? DeckTech análise e otimização do Dokke"
#   UNICODE-decl = "◑ DeckTech análise e otimização do Dokke"
# The loss happens at the P/Invoke marshaling boundary, inside this process,
# before the base64 encoding above ever sees the string — so the base64 fix
# protects the cp850 console pipe (lib.mjs -> Node) but cannot recover a
# character GetClassNameA already destroyed marshaling the Win32 API result
# into this process. This had not yet corrupted a measurement because Win32
# class names are ASCII by convention in practice (`#32770`,
# `Chrome_WidgetWin_1`, …), not because the declaration was correct — a
# latent defect, not a demonstrated corruption. Fixed by declaring the
# GetClassName import the same way, explicitly targeting the W entry point
# rather than relying on CharSet.Auto's OS-dependent resolution.
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class ProofEightWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="GetClassNameW")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
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
  # ROUND-4 FIX (major finding #3): titleB64/classB64 instead of raw text —
  # see the file header comment for why (console output encoding mismatch,
  # not the JSON-escaping issue the base64 fix in lib.mjs's CommandLine
  # handling was originally (and wrongly) attributed to).
  if ($txt.ToString().Length -gt 0) {
    $titleB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($txt.ToString()))
    $classB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($cls.ToString()))
    [void]$results.Add(@{ pid = [int]$procId; classB64 = $classB64; titleB64 = $titleB64; visible = [bool]$vis })
  }
  return $true
}
[ProofEightWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
$results | ConvertTo-Json -Compress
