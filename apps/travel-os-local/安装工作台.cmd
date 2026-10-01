@echo off
chcp 65001 >nul
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\install-workbench.ps1"
set "installStatus=%errorlevel%"
pause
exit /b %installStatus%
