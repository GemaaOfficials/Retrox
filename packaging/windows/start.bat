@echo off
setlocal
cd /d "%~dp0"
title ReEditX Portable Launcher

if not exist "%~dp0ReEditX.exe" (
  echo ReEditX.exe was not found.
  echo Please extract the entire ZIP folder before running start.bat.
  pause
  exit /b 1
)
if not exist "%~dp0resources\app-server\server.js" (
  echo The ReEditX engine files are missing.
  echo Please extract the entire ZIP again and do not delete any files.
  pause
  exit /b 1
)
if not exist "%~dp0resources\app-server\.next\BUILD_ID" (
  echo The ReEditX production engine is incomplete.
  echo Please download the ZIP again and extract all files.
  pause
  exit /b 1
)

echo Starting ReEditX...
start "" "%~dp0ReEditX.exe"
exit /b 0
