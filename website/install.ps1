# QUACK OS official installer for Windows (npm-primary distribution).
#
#   irm https://quack.os/install.ps1 | iex
#
# Security rules this script MUST keep:
#   - fails closed on any unmet requirement (never "best effort" installs)
#   - installs exactly one package: @quack/os (plus its npm deps)
#   - never touches ~\.quack user data beyond `quack init`
#   - prints every action before taking it
$ErrorActionPreference = "Stop"

$Package = "@quack/os"
$RequiredMajor = 22
$RequiredMinor = 5

Write-Host "Installing QUACK OS" -ForegroundColor Cyan
Write-Host ""

# --- 1. Detect platform and architecture ---------------------------------------
$Platform = if ($IsWindows -or $env:OS -eq "Windows_NT") { "windows" } else { "unsupported" }
if ($Platform -ne "windows") { Write-Host "This installer targets Windows; Linux/macOS: use install.sh"; exit 1 }
$Arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  "AMD64" { "x64" }
  "ARM64" { "arm64" }
  default { Write-Host "Unsupported architecture: $($env:PROCESSOR_ARCHITECTURE)"; exit 1 }
}
Write-Host "Platform:      windows ($Arch)"

# --- 2. Verify Node.js runtime requirement -------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Runtime:       Node.js NOT FOUND" -ForegroundColor Red
  Write-Host ""
  Write-Host "QUACK requires Node.js >= $RequiredMajor.$RequiredMinor (node:sqlite)."
  Write-Host "Install the Node.js LTS from https://nodejs.org, then re-run this installer."
  exit 1
}
$nodeVersion = (& node --version).Trim()
$parts = $nodeVersion.TrimStart("v").Split(".")
$major = [int]$parts[0]; $minor = [int]$parts[1]
if ($major -lt $RequiredMajor -or ($major -eq $RequiredMajor -and $minor -lt $RequiredMinor)) {
  Write-Host "Runtime:       Node.js $nodeVersion (TOO OLD)" -ForegroundColor Red
  Write-Host "QUACK requires Node.js >= $RequiredMajor.$RequiredMinor."
  Write-Host "Never silently installing a runtime - upgrade Node.js first, then re-run."
  exit 1
}
Write-Host "Runtime:       Node.js $nodeVersion"

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { Write-Host "npm not found - reinstall Node.js LTS from https://nodejs.org"; exit 1 }

# --- 3. Install QUACK globally via npm ------------------------------------------
Write-Host ""
Write-Host "Installing $Package globally (npm install -g $Package)..."
& npm install -g $Package
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed."; exit 1 }

# --- 4. Verify installation -------------------------------------------------------
$quack = Get-Command quack -ErrorAction SilentlyContinue
if (-not $quack) {
  Write-Host ""
  Write-Host "Installed, but 'quack' is not on PATH. Add the npm global bin to PATH:"
  Write-Host "  $(& npm prefix -g)"
  exit 1
}
Write-Host ""
Write-Host "Installed:    quack $(& quack --version)"

# --- 5. Health check ---------------------------------------------------------------
Write-Host ""
Write-Host "Running health check (quack doctor)..."
& quack doctor
if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "Installation complete." -ForegroundColor Green
  Write-Host ""
  Write-Host "Run:"
  Write-Host "  quack init"
} else {
  Write-Host ""
  Write-Host "quack doctor reported problems - follow its Fix lines, then re-run quack doctor."
  exit 1
}
