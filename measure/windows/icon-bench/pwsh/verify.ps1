# Independent verification decoder for PROOF-01 (round-2 review finding 1,
# blocker fix). This is deliberately a SEPARATE, one-shot PowerShell process
# invoked by scripts/verify.mjs AFTER the benchmark — not the harness that
# wrote the PNGs, and not on the timing-critical path. It decodes every PNG
# with .NET's own decoder (System.Drawing.Bitmap), which is a code path none
# of the three benchmarked bridges (N-API addon, koffi FFI, pwsh's own
# encoder) go through to WRITE the files, and computes:
#   - per-app cross-bridge pixel agreement (max per-channel delta between
#     addon vs koffi, and addon vs pwsh, on the SAME app index)
#   - alpha-channel variance (a uniform/blank image has variance ~0)
#   - content bounding-box fill fraction (does non-transparent content reach
#     the edges of the 256x256 frame, or is it a tiny blob in the corner)
# These are properties the harness's own encodePng() call cannot fake: it
# does not control what pixels the OS handed back, only how they're
# serialized.
#
# Usage: powershell.exe -File verify.ps1 -InputJson <path> -OutputJson <path>
param(
    [Parameter(Mandatory = $true)][string]$InputJson,
    [Parameter(Mandatory = $true)][string]$OutputJson
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Decode-Bgra([string]$path) {
    $img = [System.Drawing.Bitmap]::FromFile($path)
    try {
        $w = $img.Width
        $h = $img.Height
        $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
        $data = $img.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $bytes = New-Object byte[] ($data.Stride * $h)
            [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
            return [PSCustomObject]@{ width = $w; height = $h; stride = $data.Stride; bytes = $bytes }
        } finally {
            $img.UnlockBits($data)
        }
    } finally {
        $img.Dispose()
    }
}

# Format32bppArgb's in-memory byte order on little-endian Windows is B,G,R,A
# per pixel (GDI+'s "Argb" naming describes channel semantics, not memory
# order). Both the addon/koffi encoder (lib/png.mjs, standard non-premultiplied
# RGBA PNG) and the pwsh worker (Bitmap.Save with Format32bppArgb, also
# non-premultiplied) decode consistently this way, so a direct byte-for-byte
# comparison across bridges is apples-to-apples: no premultiplication step
# on either side to introduce a spurious delta.
function Analyze-Image($decoded) {
    $bytes = $decoded.bytes
    $w = $decoded.width
    $h = $decoded.height
    $n = $w * $h
    $alphaSum = 0.0
    $alphaSumSq = 0.0
    $minX = $w; $maxX = -1; $minY = $h; $maxY = -1
    $ALPHA_THRESHOLD = 10
    for ($y = 0; $y -lt $h; $y++) {
        $rowBase = $y * $decoded.stride
        for ($x = 0; $x -lt $w; $x++) {
            $a = $bytes[$rowBase + $x * 4 + 3]
            $alphaSum += $a
            $alphaSumSq += ($a * $a)
            if ($a -gt $ALPHA_THRESHOLD) {
                if ($x -lt $minX) { $minX = $x }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    $alphaMean = $alphaSum / $n
    $alphaVariance = ($alphaSumSq / $n) - ($alphaMean * $alphaMean)
    $hasContent = $maxX -ge $minX
    $bboxFillFraction = 0.0
    if ($hasContent) {
        $bboxW = ($maxX - $minX + 1)
        $bboxH = ($maxY - $minY + 1)
        $bboxFillFraction = ($bboxW * $bboxH) / [double]($w * $h)
    }
    return [PSCustomObject]@{
        alphaMean         = [math]::Round($alphaMean, 3)
        alphaVariance      = [math]::Round($alphaVariance, 3)
        hasContent         = $hasContent
        bboxFillFraction   = [math]::Round($bboxFillFraction, 4)
    }
}

function MaxAbsDelta($a, $b) {
    $bytesA = $a.bytes
    $bytesB = $b.bytes
    $len = [Math]::Min($bytesA.Length, $bytesB.Length)
    $maxDelta = 0
    $sumDelta = 0.0
    for ($i = 0; $i -lt $len; $i++) {
        $d = [Math]::Abs([int]$bytesA[$i] - [int]$bytesB[$i])
        if ($d -gt $maxDelta) { $maxDelta = $d }
        $sumDelta += $d
    }
    return [PSCustomObject]@{
        maxAbsDelta  = $maxDelta
        meanAbsDelta = [math]::Round($sumDelta / $len, 4)
        comparedBytes = $len
    }
}

# Round-3 review fix (finding 3, MAJOR): same defect class as list-apps.mjs
# finding 2 — Get-Content -Raw with no -Encoding decodes with PS 5.1's ANSI
# default, not UTF-8, while scripts/verify.mjs writes $InputJson as UTF-8
# with no BOM. Any non-ASCII byte in a path this script is asked to decode
# (e.g. a cache directory under a non-ASCII account name, or a redirected
# %LOCALAPPDATA%) was mangled before [System.Drawing.Bitmap]::FromFile ever
# saw it, producing a decode error that verify.mjs's own bug (finding 1)
# then silently dropped instead of failing. Fixed by passing -Encoding UTF8
# explicitly, matching how the caller actually writes the file.
$req = Get-Content -Raw -Encoding UTF8 -Path $InputJson | ConvertFrom-Json
$results = @()

foreach ($item in $req.items) {
    $entry = [ordered]@{ index = $item.index; label = $item.label }
    $decoded = @{}
    # Round-3 fix: this used to be a single $decodeError string that a LATER
    # failing bridge silently overwrote, so if e.g. both koffi and pwsh
    # failed to decode for the same app, only pwsh's message survived in the
    # output and koffi's failure vanished without a trace. Collect one error
    # per failing bridge instead.
    $decodeErrors = @()
    foreach ($prop in $item.files.PSObject.Properties) {
        $bridge = $prop.Name
        $filePath = $prop.Value
        try {
            $decoded[$bridge] = Decode-Bgra $filePath
        } catch {
            $decodeErrors += "$bridge decode failed: $($_.Exception.Message)"
        }
    }
    if ($decodeErrors.Count -gt 0) {
        $entry.error = ($decodeErrors -join ' | ')
        $results += [PSCustomObject]$entry
        continue
    }

    $analyses = @{}
    foreach ($bridge in $decoded.Keys) {
        $analyses[$bridge] = Analyze-Image $decoded[$bridge]
    }
    $entry.analyses = $analyses

    $refBridge = $item.referenceBridge
    if ($refBridge -and $decoded.ContainsKey($refBridge)) {
        $deltas = @{}
        foreach ($bridge in $decoded.Keys) {
            if ($bridge -eq $refBridge) { continue }
            $deltas[$bridge] = MaxAbsDelta $decoded[$refBridge] $decoded[$bridge]
        }
        $entry.deltasVsReference = $deltas
        $entry.referenceBridge = $refBridge
    }

    $results += [PSCustomObject]$entry
}

($results | ConvertTo-Json -Depth 8) | Out-File -FilePath $OutputJson -Encoding utf8
