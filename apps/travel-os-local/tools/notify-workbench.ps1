param(
  [Parameter(Mandatory=$true)][string]$Title,
  [Parameter(Mandatory=$true)][string]$Message,
  [Parameter(Mandatory=$true)][string]$Url
)

$ErrorActionPreference = 'Stop'
# Accept only the local workbench and scoped read-only task location fields.
try {
  $taskUri = [Uri]$Url
  if ($taskUri.Scheme -ne 'http' -or $taskUri.Host -ne '127.0.0.1' -or $taskUri.Port -ne 4318 -or $taskUri.UserInfo -or $taskUri.AbsolutePath -ne '/travel-os.html' -or $taskUri.Fragment -ne '#tasks') { exit 2 }
  $locationFields = @{}
  if ($taskUri.Query) {
    foreach ($pair in $taskUri.Query.TrimStart('?').Split('&')) {
      $parts = $pair.Split('=',2)
      $field = [Uri]::UnescapeDataString($parts[0])
      $value = if ($parts.Count -eq 2) { [Uri]::UnescapeDataString($parts[1]) } else { '' }
      if ($field -cnotin @('shop','round','window','item') -or $locationFields.ContainsKey($field) -or $value -cnotmatch '^[\w:.-]{1,256}$') { exit 2 }
      $locationFields[$field] = $value
    }
    if (-not $locationFields.ContainsKey('shop')) { exit 2 }
    if ($locationFields.ContainsKey('window') -ne $locationFields.ContainsKey('item')) { exit 2 }
    if ($locationFields.ContainsKey('window') -and -not $locationFields.ContainsKey('round')) { exit 2 }
  }
} catch { exit 2 }
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
[Console]::Out.WriteLine('TRAVEL_OS_NOTIFICATION_READY')
[System.Windows.Forms.Application]::Run($context)
