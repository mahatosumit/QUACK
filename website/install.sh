#!/usr/bin/env bash
# QUACK OS official installer (npm-primary distribution).
#
#   curl -fsSL https://quack.os/install.sh | bash
#
# Security rules this script MUST keep:
#   - fails closed on any unmet requirement (never "best effort" installs)
#   - installs exactly one package: @quack/os (plus its npm deps)
#   - never touches ~/.quack user data beyond `quack init`
#   - prints every action before taking it
set -euo pipefail

PACKAGE="@quack/os"
REQUIRED_NODE_MAJOR=22
REQUIRED_NODE_MINOR=5

say() { printf '%s\n' "$*"; }

say "Installing QUACK OS"
say ""

# --- 1. Detect platform and architecture -------------------------------------
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Linux) PLATFORM="linux" ;;
  Darwin) PLATFORM="macos" ;;
  *) say "Unsupported platform: $OS (this installer targets Linux/macOS; Windows: use install.ps1)"; exit 1 ;;
esac
case "$ARCH" in
  x86_64|amd64) ARCH_LABEL="x64" ;;
  aarch64|arm64) ARCH_LABEL="arm64" ;;
  *) say "Unsupported architecture: $ARCH"; exit 1 ;;
esac
say "Platform:      $PLATFORM ($ARCH)"

# --- 2. Verify Node.js runtime requirement -----------------------------------
if ! command -v node >/dev/null 2>&1; then
  say "Runtime:       Node.js NOT FOUND"
  say ""
  say "QUACK requires Node.js >= ${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR} (node:sqlite)."
  say "Install Node.js LTS from https://nodejs.org (or your package manager), then re-run this installer."
  exit 1
fi
NODE_VERSION="$(node --version)"
NODE_MAJOR="${NODE_VERSION#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
NODE_MINOR="${NODE_VERSION#*.}"; NODE_MINOR="${NODE_MINOR%%.*}"
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ] || { [ "$NODE_MAJOR" -eq "$REQUIRED_NODE_MAJOR" ] && [ "$NODE_MINOR" -lt "$REQUIRED_NODE_MINOR" ]; }; then
  say "Runtime:       Node.js $NODE_VERSION (TOO OLD)"
  say "QUACK requires Node.js >= ${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR}."
  say "Never silently installing a runtime - upgrade Node.js first, then re-run."
  exit 1
fi
say "Runtime:       Node.js $NODE_VERSION"

if ! command -v npm >/dev/null 2>&1; then
  say "npm not found - install Node.js with npm (https://nodejs.org) and re-run."
  exit 1
fi

# --- 3. Install QUACK globally via npm ----------------------------------------
say ""
say "Installing $PACKAGE globally (npm install -g $PACKAGE)..."
npm install -g "$PACKAGE"

# --- 4. Verify installation ----------------------------------------------------
if ! command -v quack >/dev/null 2>&1; then
  say ""
  say "Installed, but 'quack' is not on PATH."
  say "Add your global npm bin directory to PATH:"
  say "  $(npm bin -g 2>/dev/null || npm prefix -g)/bin"
  exit 1
fi
say ""
say "Installed:    quack $(quack --version)"

# --- 5. Health check ------------------------------------------------------------
say ""
say "Running health check (quack doctor)..."
if quack doctor; then
  say ""
  say "Installation complete."
  say ""
  say "Run:"
  say "  quack init"
else
  say ""
  say "quack doctor reported problems - follow its Fix lines, then re-run:"
  say "  quack doctor"
  exit 1
fi
