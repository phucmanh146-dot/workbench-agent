@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "result=%errorlevel%"
if "%result%"=="0" (
    echo.
    echo Installation complete. Double-click the launch BAT to open the workbench.
) else (
    echo.
    echo Installation failed. Check the error above and rerun this installer.
)
pause
exit /b %result%
