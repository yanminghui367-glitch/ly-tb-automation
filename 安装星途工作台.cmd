@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0apps\travel-os-local\tools\install-workbench.ps1"
pause
