# ============================================================
#  start-ngrok.ps1
#  Starts the permanent ngrok tunnel for FB Live Shop.
#  Domain: scuba-cloud-parsley.ngrok-free.dev  (never changes)
#  Auto-saves URL to server and sets QR mode to Public.
# ============================================================

$NgrokExe      = "C:\Users\dethp\AppData\Local\ngrok\ngrok.exe"
$PublicDomain  = "scuba-cloud-parsley.ngrok-free.dev"
$PublicUrl     = "https://$PublicDomain"
$ServerUrl     = "http://localhost:3000"

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  FB Live Shop — Public QR Tunnel" -ForegroundColor Cyan
Write-Host "  Domain: $PublicDomain" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# ── Check server is running ──────────────────────────────────
Write-Host "Checking backend server..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$ServerUrl/health" -TimeoutSec 5
    if ($health.success) {
        Write-Host "  Backend is running on port 3000" -ForegroundColor Green
    }
} catch {
    Write-Host "  Backend not running! Start it first with start.bat" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# ── Kill any existing ngrok process ─────────────────────────
$existing = Get-Process -Name "ngrok" -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "  Stopping existing ngrok..." -ForegroundColor Yellow
    $existing | Stop-Process -Force
    Start-Sleep -Seconds 1
}

# ── Start ngrok using named tunnel (fixed domain) ───────────
Write-Host ""
Write-Host "Starting permanent tunnel..." -ForegroundColor Yellow
Start-Process -FilePath $NgrokExe -ArgumentList "start fblive" -WindowStyle Minimized

# ── Wait for ngrok API ──────────────────────────────────────
Write-Host "  Waiting for tunnel" -NoNewline -ForegroundColor Yellow
$ready    = $false
$attempts = 0
while (-not $ready -and $attempts -lt 20) {
    Start-Sleep -Milliseconds 800
    Write-Host "." -NoNewline -ForegroundColor Yellow
    $attempts++
    try {
        $tunnels = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -TimeoutSec 3 -ErrorAction Stop
        $t = $tunnels.tunnels | Where-Object { $_.public_url -like "*$PublicDomain*" } | Select-Object -First 1
        if ($t) { $ready = $true }
    } catch { }
}
Write-Host ""

if (-not $ready) {
    Write-Host "  Tunnel did not start in time." -ForegroundColor Red
    Write-Host "  Check http://localhost:4040 for details." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# ── Push URL to server ──────────────────────────────────────
Write-Host ""
Write-Host "Saving public URL to server..." -ForegroundColor Yellow
try {
    $body   = "{`"publicUrl`":`"$PublicUrl`",`"qrMode`":`"public`"}"
    $result = Invoke-RestMethod -Uri "$ServerUrl/api/server-info/qr-config" `
                -Method POST -Body $body -ContentType "application/json" -TimeoutSec 10
    if ($result.success) {
        Write-Host "  QR mode  : PUBLIC" -ForegroundColor Green
        Write-Host "  QR base  : $($result.baseUrl)" -ForegroundColor Green
    }
} catch {
    Write-Host "  Warning: could not auto-save URL to server." -ForegroundColor Red
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  TUNNEL ACTIVE" -ForegroundColor White
Write-Host ""
Write-Host "  Public URL:" -ForegroundColor White
Write-Host "  $PublicUrl" -ForegroundColor Green
Write-Host ""
Write-Host "  Customers scan QR codes pointing to:" -ForegroundColor White
Write-Host "  $PublicUrl/customer/product.html?code=..." -ForegroundColor Green
Write-Host ""
Write-Host "  Ngrok dashboard: http://localhost:4040" -ForegroundColor Gray
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Keep this window open while streaming." -ForegroundColor Yellow
Write-Host "  Close it to stop the tunnel." -ForegroundColor Gray
Write-Host ""

# ── Block until window is closed, then revert ───────────────
try {
    while ($true) { Start-Sleep -Seconds 30 }
} finally {
    Write-Host ""
    Write-Host "Tunnel stopped. Reverting QR to LAN mode..." -ForegroundColor Yellow
    try {
        $body = "{`"qrMode`":`"lan`"}"
        Invoke-RestMethod -Uri "$ServerUrl/api/server-info/qr-config" `
            -Method POST -Body $body -ContentType "application/json" -TimeoutSec 5 | Out-Null
        Write-Host "  Reverted to LAN." -ForegroundColor Green
    } catch { }
    Get-Process -Name "ngrok" -ErrorAction SilentlyContinue | Stop-Process -Force
    Write-Host "  ngrok stopped." -ForegroundColor Green
}
