@echo off
title Mack Finances
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then double-click this file again. & pause & exit /b 1)
echo Installing packages (first run takes a minute)...
call npm install || (echo npm install failed - see the message above. & pause & exit /b 1)
echo.
echo Starting Mack Finances at http://localhost:5173  (close this window to stop it)
call npm run dev -- --open
pause
