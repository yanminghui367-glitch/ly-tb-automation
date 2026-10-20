param(
  [Parameter(Mandatory=$true)][string]$Title,
  [Parameter(Mandatory=$true)][string]$Message,
  [Parameter(Mandatory=$true)][string]$Url
)

$ErrorActionPreference = 'Stop'
if ($Url -ne 'http://127.0.0.1:4318/travel-os.html#tasks') { exit 2 }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$icon = New-Object System.Windows.Forms.NotifyIcon
$context = New-Object System.Windows.Forms.ApplicationContext
$timer = New-Object System.Windows.Forms.Timer
$icon.Icon = [System.Drawing.SystemIcons]::Information
$icon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$icon.BalloonTipTitle = $Title
$icon.BalloonTipText = $Message
$icon.Text = '星途 Travel OS'
$icon.Visible = $true
$timer.Interval = 20000
$timer.Add_Tick({
  $timer.Stop()
  $icon.Visible = $false
  $icon.Dispose()
  $timer.Dispose()
  $context.ExitThread()
}.GetNewClosure())
$icon.add_BalloonTipClicked({
  Start-Process $Url
  $timer.Stop()
  $icon.Visible = $false
  $icon.Dispose()
  $timer.Dispose()
  $context.ExitThread()
}.GetNewClosure())
$timer.Start()
$icon.ShowBalloonTip(10000)
[System.Windows.Forms.Application]::Run($context)
