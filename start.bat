@echo off
REM QUACK OS Universal Batch Launcher for Windows

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [QUACK] ❌ Node.js is not installed or not in PATH. Please install Node.js >= 20.
    pause
    exit /b 1
)

node "%~dp0start.js" %*
if %errorlevel% neq 0 (
    echo.
    echo Press any key to exit...
    pause >nul
)
