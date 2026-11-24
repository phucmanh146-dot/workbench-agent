@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-ai.ps1"
set "result=%errorlevel%"
if not "%result%"=="0" echo Configuration failed. Check the message above.
pause
exit /b %result%
