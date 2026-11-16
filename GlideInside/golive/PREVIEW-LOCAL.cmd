@echo off
cd /d "%~dp0.."
start "" http://localhost:8100/plan-studio/app/?mode=commercial
node golive\preview-local.mjs 8100
pause
