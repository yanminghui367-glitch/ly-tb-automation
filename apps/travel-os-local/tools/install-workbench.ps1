$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
try {
    $nodeCommand = Get-Command node.exe -ErrorAction Stop
    $npmCommand = Get-Command npm.cmd -ErrorAction Stop
    $pythonCommand = Get-Command python.exe -ErrorAction Stop
    & $nodeCommand.Source -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
    if ($LASTEXITCODE -ne 0) { throw '需要 Node.js 24 或更新版本。' }
    & $pythonCommand.Source -c 'import sys; assert sys.version_info >= (3,10)'
    if ($LASTEXITCODE -ne 0) { throw '需要 Python 3.10 或更新版本，并加入 PATH。' }
    $chromePaths = @('C:\Program Files\Google\Chrome\Application\chrome.exe','C:\Program Files (x86)\Google\Chrome\Application\chrome.exe')
    if (-not ($chromePaths | Where-Object { Test-Path -LiteralPath $_ })) { throw '请先安装 Google Chrome。' }
    foreach ($part in @('workbench','engine/v2')) {
        Write-Host "安装锁定依赖：$part"
        & $npmCommand.Source ci --prefix (Join-Path $appRoot $part) --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "$part 依赖安装失败，请检查网络后重试。" }
    }
    & $npmCommand.Source run check --prefix (Join-Path $appRoot 'workbench')
    if ($LASTEXITCODE -ne 0) { throw '源码语法检查失败。' }
    & $nodeCommand.Source (Join-Path $PSScriptRoot 'verify-installation.mjs')
    if ($LASTEXITCODE -ne 0) { throw '安装完整性检查失败。' }
    Write-Host '安装完成。有迁移包时，先将 ZIP 拖到“恢复业务数据.cmd”；再双击“启动上架工作台.vbs”。'
} catch {
    Write-Host "安装未完成：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
