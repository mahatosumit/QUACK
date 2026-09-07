param(
  [string]$InstallRoot = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
$resolved = (Resolve-Path -LiteralPath $InstallRoot).Path
$marker = Join-Path $resolved ".quack-install.json"
if (-not (Test-Path -LiteralPath $marker)) {
  throw "Refusing to remove '$resolved': QUACK OS install marker is missing."
}

$cleanup = Join-Path ([System.IO.Path]::GetTempPath()) ("quack-uninstall-" + [guid]::NewGuid().ToString("N") + ".ps1")
$escaped = $resolved.Replace("'", "''")
Set-Content -LiteralPath $cleanup -Encoding UTF8 -Value @"
Start-Sleep -Milliseconds 500
Remove-Item -LiteralPath '$escaped' -Recurse -Force
Remove-Item -LiteralPath `$PSCommandPath -Force
"@
Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $cleanup)
Write-Host "QUACK OS uninstall scheduled for $resolved"
