@echo off
rem Checks everything and a dry run. Changes NOTHING. Safe to run tonight.
cd /d "%~dp0"
title Glide Inside LIVE preflight (changes nothing)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-live.ps1" -PreflightOnly
echo.
echo Finished with exit code %ERRORLEVEL%  (0 = ready to deploy).
pause
