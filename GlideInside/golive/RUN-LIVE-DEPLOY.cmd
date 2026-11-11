@echo off
rem Glide Inside LIVE deploy. Run AFTER SET-LIVE-KEYS-TOMORROW.cmd. Log: golive-deploy.log (this folder).
cd /d "%~dp0"
title Glide Inside LIVE deploy
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-live.ps1" %*
echo.
echo Finished with exit code %ERRORLEVEL%  (0 = PASS). The log is golive-deploy.log in this folder.
pause
