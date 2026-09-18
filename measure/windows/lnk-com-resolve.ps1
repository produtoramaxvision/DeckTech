# measure/windows/lnk-com-resolve.ps1
#
# PROOF-03 baseline resolver: reads a JSON array of .lnk paths from
# -InputJsonPath, resolves each one's TargetPath/Arguments/WorkingDirectory
# through the WScript.Shell COM object (the same mechanism the original
# 2395ms/149-shortcut measurement in .maxvision/research/WINDOWS-STACK.md
# used), and writes a JSON report to -OutputJsonPath.
#
# The COM object is created ONCE outside the loop and reused for every
# shortcut, matching how a real caller (and the original measurement)
# would use it -- creating a fresh COM object per shortcut would measure
# COM instantiation overhead, not shortcut resolution.
#
# elapsedMs in the output is measured by a Stopwatch wrapped ONLY around
# the resolution loop itself (not process startup, not COM object
# creation, not JSON I/O) so it is comparable, per-item, to the "~16 ms
# each" baseline figure.

param(
    [Parameter(Mandatory = $true)][string]$InputJsonPath,
    [Parameter(Mandatory = $true)][string]$OutputJsonPath
)

$ErrorActionPreference = 'Stop'

$paths = Get-Content -LiteralPath $InputJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json

$shell = New-Object -ComObject WScript.Shell

$results = New-Object System.Collections.Generic.List[object]
$sw = [System.Diagnostics.Stopwatch]::StartNew()

foreach ($p in $paths) {
    $targetPath = $null
    $arguments = $null
    $workingDirectory = $null
    $errorMessage = $null
    try {
        $sc = $shell.CreateShortcut($p)
        $targetPath = $sc.TargetPath
        $arguments = $sc.Arguments
        $workingDirectory = $sc.WorkingDirectory
    }
    catch {
        $errorMessage = $_.Exception.Message
    }
    $results.Add([PSCustomObject]@{
        path              = $p
        targetPath        = $targetPath
        arguments         = $arguments
        workingDirectory  = $workingDirectory
        error             = $errorMessage
    }) | Out-Null
}

$sw.Stop()

[Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null

$output = [PSCustomObject]@{
    elapsedMs = $sw.Elapsed.TotalMilliseconds
    count     = $results.Count
    results   = $results
}

$output | ConvertTo-Json -Depth 6 | Out-File -LiteralPath $OutputJsonPath -Encoding UTF8
