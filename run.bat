@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -OpenBrowser
set "result=%errorlevel%"
if not "%result%"=="0" (
    echo.
    echo The workbench stopped with an error. Check the message above.
    pause
)
exit /b %result%
