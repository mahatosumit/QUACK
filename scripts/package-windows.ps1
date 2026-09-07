param(
  [string]$OutputRoot = (Join-Path $PSScriptRoot "..\release")
)

$ErrorActionPreference = "Stop"
$stagingScript = Join-Path $PSScriptRoot "public-release.mjs"
$stagingResult = & node $stagingScript stage $OutputRoot --windows
if ($LASTEXITCODE -ne 0) { throw "Public release staging failed." }
$staging = $stagingResult | ConvertFrom-Json
$stage = $staging.destination
$zip = Join-Path $staging.runDirectory "quack-os-windows-portable.zip"

Push-Location -LiteralPath $stage
try {
  npm.cmd ci --omit=dev --ignore-scripts --workspaces=false --prefer-offline --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed while assembling runtime dependencies." }
} finally {
  Pop-Location
}

& node $stagingScript verify $stage
if ($LASTEXITCODE -ne 0) { throw "Public release validation failed." }

$payload = @(Get-ChildItem -LiteralPath $stage -Force | Select-Object -ExpandProperty FullName)
Compress-Archive -LiteralPath $payload -DestinationPath $zip -CompressionLevel Optimal
$hashAlgorithm = [System.Security.Cryptography.SHA256]::Create()
$zipStream = [System.IO.File]::OpenRead($zip)
try {
  $hash = [System.BitConverter]::ToString($hashAlgorithm.ComputeHash($zipStream)).Replace("-", "").ToLowerInvariant()
} finally {
  $zipStream.Dispose()
  $hashAlgorithm.Dispose()
}
Set-Content -LiteralPath "$zip.sha256" -Encoding ASCII -Value "$hash  $(Split-Path -Leaf $zip)"
Write-Host "Created $zip"
Write-Host "SHA256 $hash"
