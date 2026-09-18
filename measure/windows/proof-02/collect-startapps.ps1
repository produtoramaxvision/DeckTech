<#
  PROOF-02 support script — collects the raw data needed to enumerate UWP/Store
  apps and cross-verify them against the authoritative AppX package list.

  Writes a single UTF-8 (no BOM) JSON file to -OutFile. Writing to a file
  instead of stdout is deliberate: PowerShell's console output encoding on a
  pt-BR machine can mangle accented display names ("Configurações",
  "Legendas ao vivo") when captured through a child_process pipe, and this
  scan explicitly must not break on localized names.
#>
param(
  [Parameter(Mandatory = $true)][string]$OutFile
)
$ErrorActionPreference = 'Stop'

# Get-StartApps reads the same Start-menu index Windows Search uses: every
# item a user can type Win+S to find, packaged (UWP/Store) and unpackaged
# (.lnk-based) alike, keyed by whatever AppUserModelID Windows resolved for
# it, with Name already localized to the shell's display-name resource.
$startApps = Get-StartApps | Select-Object Name, AppID

# Get-AppxPackage is the authoritative registry of installed MSIX/UWP
# packages. It is the ground truth used to confirm a Get-StartApps row is
# genuinely packaged, instead of trusting an AppID string shape.
$appxPackages = Get-AppxPackage | Select-Object Name, PackageFamilyName

$result = [ordered]@{
  collectedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  culture        = (Get-Culture).Name
  startApps      = $startApps
  appxPackages   = $appxPackages
}

$json = $result | ConvertTo-Json -Depth 6 -Compress
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutFile, $json, $utf8NoBom)
