@echo off
cd /d "%~dp0"

set "APP_URL=http://127.0.0.1:5173"
set "NODE_EXE=C:\Users\lewis\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "VITE_JS=node_modules\.pnpm\vite@7.3.6\node_modules\vite\bin\vite.js"

echo Checking Clearflow Tracker...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%APP_URL%' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"

if errorlevel 1 (
  echo Starting Clearflow Tracker...
  start "Clearflow Tracker" /min "%NODE_EXE%" "%VITE_JS%" --host 127.0.0.1
  timeout /t 3 >nul
) else (
  echo Clearflow Tracker is already running.
)

start "" "%APP_URL%"
echo.
echo Clearflow Tracker should now be open.
echo If it does not open, copy this into Chrome or Edge:
echo %APP_URL%
echo.
pause
