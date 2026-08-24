$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    py -3.12 -m venv .venv
}

& ".venv\Scripts\python.exe" -m pip install -r requirements-dev.lock
& ".venv\Scripts\python.exe" -m pip install --no-build-isolation --no-deps -e "."

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Warning "已创建 .env。正式使用前请修改 LYTB_SECRET_KEY。"
}

& ".venv\Scripts\python.exe" -m ly_tb_automation.cli
