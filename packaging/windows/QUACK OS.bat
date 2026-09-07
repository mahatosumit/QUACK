@echo off
setlocal
where node.exe >nul 2>nul
if errorlevel 1 (
  echo [QUACK] Node.js 20 or newer is required. Install Node.js, then run this launcher again.
  exit /b 1
)
node.exe "%~dp0start.js" %*
exit /b %errorlevel%
