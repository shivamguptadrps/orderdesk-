@echo off
rem Starts everything for development: database, backend API, Expo.
rem Double-click this file, or run start-dev.cmd from the project folder.
cd /d "%~dp0"

echo Stopping old copies (if any)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop-dev.ps1"

echo Starting database (Docker Desktop must be open)...
docker compose -f deploy\docker-compose.yml up -d
if errorlevel 1 (
  echo.
  echo Could not start the database. Open Docker Desktop, wait until it says "Engine running", then run this again.
  pause
  exit /b 1
)

echo Updating database tables...
pushd backend
.venv\Scripts\python.exe -m alembic upgrade head
popd

echo Opening backend window (port 8000)...
start "OrderDesk BACKEND" cmd /k "cd /d %~dp0backend && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

echo Opening Expo window (port 8081)...
start "OrderDesk MOBILE (Expo)" cmd /k "cd /d %~dp0mobile && npx.cmd expo start"

echo.
echo Done. Keep both new windows open.
echo On your phone (same Wi-Fi), open Expo Go and scan the QR code in the Expo window.
echo If your laptop's Wi-Fi IP changed, update mobile\.env.local (run: ipconfig).
echo.
pause
