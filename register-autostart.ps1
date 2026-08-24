
$taskName   = "FB-Live-PM2-Autostart"
$pm2Cmd     = "C:\Users\dethp\AppData\Roaming\npm\pm2.cmd"
$backendDir = "D:\Screenshot_Based_Facebook_Live_Product_System\backend"

$action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$pm2Cmd`" resurrect" `
    -WorkingDirectory $backendDir

$trigger = New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName   $taskName `
    -Action     $action `
    -Trigger    $trigger `
    -Settings   $settings `
    -Description "Resurrects the FB-Live pm2 server when user logs in"

Write-Host "Task registered: $taskName" -ForegroundColor Green
