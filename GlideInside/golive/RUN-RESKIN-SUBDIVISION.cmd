@echo off
rem Puts the new header and footer on the LIVE /subdivision/ page you downloaded. Reads and writes Downloads\sub\ only.
set "IN=%USERPROFILE%\Downloads\sub\index.html"
set "OUT=%USERPROFILE%\Downloads\sub\index.new.html"
set "TOOL=%~dp0..\pocket-architect-source\tools\reskin-subdivision.mjs"
if not exist "%IN%" (echo Download the live public_html\subdivision\index.html to %IN% first. & pause & exit /b 1)
if not exist "%TOOL%" (echo Missing %TOOL% . The package needs pocket-architect-source\tools\. & pause & exit /b 1)
node "%TOOL%" "%IN%" "%OUT%"
echo.
echo Look for a line starting WARNING other ABN above. Upload %OUT% to public_html/subdivision/ (UPLOAD-STEPS.md step 6).
pause
