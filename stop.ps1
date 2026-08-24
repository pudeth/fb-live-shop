# Stop all Facebook Live Product System services

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Facebook Live - Stopping Services" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Stop the backend server
Write-Host "[INFO] Stopping backend server..." -ForegroundColor Yellow
& pm2 stop fb-live-server 2>$null | Out-Null
Write-Host "[OK] Server stopped" -ForegroundColor Green

# Kill ngrok
$ngrok = Get-Process -Name "ngrok" -ErrorAction SilentlyContinue
if ($ngrok) {
    $ngrok | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] ngrok tunnel closed" -ForegroundColor Green
} else {
    Write-Host "[OK] ngrok was not running" -ForegroundColor Gray
}

Write-Host ""
Write-Host "  All services stopped." -ForegroundColor Green
Write-Host "  Run start.bat to start again." -ForegroundColor Gray
Write-Host ""
pause
