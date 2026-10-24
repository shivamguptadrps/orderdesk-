@echo off
rem Stops the backend and Expo started by start-dev.cmd (the database keeps running in Docker).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\stop-dev.ps1"
pause
