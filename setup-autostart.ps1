# ============================================================
#  setup-autostart.ps1
#  Registers a Windows Task Scheduler task so pm2 (and your
#  server) restarts automatically whenever Windows boots.
#
#  Run ONCE as Administrator:
#    Right-click PowerShell → "Run as administrator"
#    Then:  .\setup-autostart.ps1
# ============================================================

$taskName   = "FB-Live-PM2-Autostart"
$pm2Path    = (Get-Command pm2 -ErrorAction Stop).Source   # full path to pm2.cmd
$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Path | Join-Path -ChildPath "backend"

# The action: run  pm2 resurrect  at boot (restores the saved process list)
$action  = New-ScheduledTaskAction `
    -Execute    "cmd.exe" `
    -Argument   "/c `"$pm2Path`" resurrect" `
    -WorkingDirectory $backendDir

# Trigger: at system startup, with a 10-second delay so networking is up
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = "PT10S"

# Run as the current user, whether or not they are logged in
$principal = New-ScheduledTaskPrincipal `
    -UserId    $env:USERNAME `
    -LogonType Interactive `
    -RunLevel  Highest

# Settings: allow the task to run on battery, don't stop it, restart on failure
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit     (New-TimeSpan -Hours 0) `
    -RestartCount           3 `
    -RestartInterval        (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable     `
    -DisallowHardTerminate  `
    -MultipleInstances      IgnoreNew

# Register (or overwrite if it already exists)
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask `
    -TaskName   $taskName `
    -Action     $action `
    -Trigger    $trigger `
    -Principal  $principal `
    -Settings   $settings `
    -Description "Resurrects the FB-Live pm2 server on Windows boot"

Write-Host ""
Write-Host "✅  Task '$taskName' registered successfully." -ForegroundColor Green
Write-Host "    The server will auto-start 10 seconds after every Windows boot." -ForegroundColor Cyan
Write-Host ""
Write-Host "Other useful commands:" -ForegroundColor Yellow
Write-Host "  pm2 list              → check running processes"
Write-Host "  pm2 logs fb-live-server → view live logs"
Write-Host "  pm2 restart fb-live-server → restart after code changes"
Write-Host "  pm2 stop fb-live-server    → stop the server"
Write-Host "  pm2 save               → save process list after any changes"
