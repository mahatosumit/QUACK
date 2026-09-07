param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "Programs\QUACK OS")
)

$ErrorActionPreference = "Stop"
$sourceRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$installParent = Split-Path -Parent $InstallRoot
$stagingRoot = Join-Path $installParent "QUACK OS.installing"
$backupRoot = Join-Path $installParent "QUACK OS.previous"

if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot "dist\cli.js"))) {
  throw "This installer must be run from a complete QUACK OS portable bundle."
}

New-Item -ItemType Directory -Force -Path $installParent | Out-Null
foreach ($path in @($stagingRoot, $backupRoot)) {
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}

New-Item -ItemType Directory -Path $stagingRoot | Out-Null
Get-ChildItem -LiteralPath $sourceRoot -Force |
  Where-Object { $_.Name -notin @("install.ps1", "uninstall.ps1") } |
  Copy-Item -Destination $stagingRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "uninstall.ps1") -Destination $stagingRoot
@{ product = "QUACK OS"; installedAt = (Get-Date).ToUniversalTime().ToString("o"); source = $sourceRoot } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stagingRoot ".quack-install.json") -Encoding UTF8

if (Test-Path -LiteralPath $InstallRoot) { Move-Item -LiteralPath $InstallRoot -Destination $backupRoot }
try {
  Move-Item -LiteralPath $stagingRoot -Destination $InstallRoot
  if (Test-Path -LiteralPath $backupRoot) { Remove-Item -LiteralPath $backupRoot -Recurse -Force }
} catch {
  if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
  if (Test-Path -LiteralPath $backupRoot) { Move-Item -LiteralPath $backupRoot -Destination $InstallRoot }
  throw
}

Write-Host "QUACK OS installed at $InstallRoot"
Write-Host "Run: `"$(Join-Path $InstallRoot 'QUACK OS.bat')`""
