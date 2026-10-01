@echo off
chcp 65001 >nul
if "%~1"=="" (
  echo 请将 TravelOS 业务数据 ZIP 拖到这个文件上。安装完成后、首次启动前恢复。
  pause
  exit /b 1
)
node.exe "%~dp0tools\migration-data.mjs" restore --archive "%~1" --root "%~dp0"
pause
