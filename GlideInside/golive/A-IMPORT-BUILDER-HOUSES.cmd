@echo off
title Glide Inside: import builder houses (LIVE)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0import-builder-houses.ps1"
echo.
echo Log: %~dp0import-builder-houses.log
pause
