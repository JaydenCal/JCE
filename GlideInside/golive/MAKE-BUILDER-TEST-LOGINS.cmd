@echo off
title Glide Inside: builder test logins (LIVE)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-builder-test-logins.ps1" > "%~dp0..\builder-test-logins-console.log" 2>&1
