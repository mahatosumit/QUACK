#!/usr/bin/env bash
# QUACK OS Universal Shell Launcher for Linux & macOS

set -e

# Ensure Node.js is installed
if ! command -v node &> /dev/null; then
    echo "[QUACK] ❌ Node.js is not installed or not in PATH. Please install Node.js >= 20."
    exit 1
fi

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
node "$SCRIPT_DIR/start.js" "$@"
