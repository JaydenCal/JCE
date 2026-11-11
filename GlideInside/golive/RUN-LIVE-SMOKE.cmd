@echo off
rem Live smoke test of the API and the 8 key pages. Use after the site upload and the cache purge.
cd /d "%~dp0"
title Glide Inside LIVE smoke test
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0smoke-live.ps1" -Pages
echo.
echo Finished with exit code %ERRORLEVEL%  (0 = all PASS).
pause
