# ============================================================
#  Facebook Live Product System - Start All Services
#  - Starts the backend via pm2 (keeps running after close)
#  - Starts ngrok tunnel automatically
#  - Sets QR code to public URL so anyone can scan it
# ============================================================

$ErrorActionPreference = "Continue"
$root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Facebook Live Product System" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js not installed. Get it from https://nodejs.org" -ForegroundColor Red
    pause
    exit 1
}
Write-Host "[OK] Node.js $(node --version)" -ForegroundColor Green

# 2. Check / install pm2
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Write-Host "[INFO] Installing pm2..." -ForegroundColor Yellow
    npm install -g pm2
}
Write-Host "[OK] pm2 ready" -ForegroundColor Green

# 3. Install node_modules if missing
$modules = Join-Path $backend "node_modules"
if (-not (Test-Path $modules)) {
    Write-Host "[INFO] Installing dependencies..." -ForegroundColor Yellow
    Push-Location $backend
    npm install
    Pop-Location
}

# 4. Wait for MySQL (up to 30 seconds)
Write-Host ""
Write-Host "[INFO] Waiting for MySQL..." -ForegroundColor Yellow
$mysqlReady = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", 3306)
        $tcp.Close()
        $mysqlReady = $true
        break
    } catch {
        Start-Sleep -Seconds 1
    }
}
if ($mysqlReady) {
    Write-Host "[OK] MySQL is running" -ForegroundColor Green
} else {
    Write-Host "[WARN] MySQL not ready after 30s - server may fail to connect to DB." -ForegroundColor Yellow
    Write-Host "       Make sure MySQL / XAMPP / WAMP is started first." -ForegroundColor Yellow
}

# 5. Start backend via pm2
Write-Host ""
Write-Host "[INFO] Starting backend server..." -ForegroundColor Yellow
Push-Location $backend
$pmList = & pm2 jlist 2>$null | Out-String
if ($pmList -match "fb-live-server") {
    & pm2 restart fb-live-server --update-env | Out-Null
    Write-Host "[OK] fb-live-server restarted" -ForegroundColor Green
} else {
    & pm2 start ecosystem.config.js | Out-Null
    Write-Host "[OK] fb-live-server started" -ForegroundColor Green
}
& pm2 save | Out-Null
Pop-Location

# Wait for server to be ready
Write-Host "[INFO] Waiting for server..." -ForegroundColor Yellow
$serverReady = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    try {
        $h = (Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop).StatusCode
        if ($h -eq 200) {
            $serverReady = $true
            break
        }
    } catch {}
}
if ($serverReady) {
    Write-Host "[OK] Server is online" -ForegroundColor Green
} else {
    Write-Host "[WARN] Server health check timed out. Run: pm2 logs fb-live-server" -ForegroundColor Yellow
}

# 6. Start ngrok tunnel
$ngrokExe = "C:\ngrok\ngrok.exe"
if (-not (Test-Path $ngrokExe)) {
    $ngrokCmd = Get-Command ngrok -ErrorAction SilentlyContinue
    if ($ngrokCmd) {
        $ngrokExe = $ngrokCmd.Source
    } else {
        $ngrokExe = ""
    }
}

$ngrokUrl = ""

if ($ngrokExe -ne "" -and (Test-Path $ngrokExe)) {

    # Kill existing ngrok to get a fresh URL
    Get-Process -Name "ngrok" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1

    Write-Host ""
    Write-Host "[INFO] Starting ngrok tunnel..." -ForegroundColor Yellow
    Start-Process -FilePath $ngrokExe -ArgumentList "http 3000" -WindowStyle Hidden

    # Poll ngrok API for the public URL (up to 20s)
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 1
        try {
            $raw = (Invoke-WebRequest -Uri "http://127.0.0.1:4040/api/tunnels" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop).Content
            if ($raw -match '"public_url"\s*:\s*"(https://[^"]+)"') {
                $ngrokUrl = $Matches[1]
                break
            }
        } catch {}
    }

    if ($ngrokUrl -ne "") {
        Write-Host "[OK] ngrok tunnel: $ngrokUrl" -ForegroundColor Cyan

        # Write JSON to temp file and POST via curl (avoids PowerShell quoting issues)
        $tmpJson = Join-Path $env:TEMP "fb-live-qr.json"
        [System.IO.File]::WriteAllText($tmpJson, "{`"publicUrl`":`"$ngrokUrl`",`"qrMode`":`"public`"}")
        $result = curl.exe -s -X POST "http://localhost:3000/api/server-info/qr-config" -H "Content-Type: application/json" --data-binary "@$tmpJson"
        Remove-Item $tmpJson -Force -ErrorAction SilentlyContinue

        if ($result -match '"success":true') {
            Write-Host "[OK] QR code set to PUBLIC mode" -ForegroundColor Green
        } else {
            Write-Host "[WARN] Could not auto-set QR config. Paste URL manually in the OBS tab." -ForegroundColor Yellow
        }
    } else {
        Write-Host "[WARN] Could not detect ngrok URL. Open http://127.0.0.1:4040 in browser." -ForegroundColor Yellow
    }

} else {
    Write-Host ""
    Write-Host "[INFO] ngrok not found - QR code will use LAN URL only." -ForegroundColor Gray
    Write-Host "       To enable public QR: extract ngrok.exe to C:\ngrok\" -ForegroundColor Gray
}

# 7. Summary
$lanIP = ""
$ipInfo = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch "^(127\.|169\.)" } |
    Select-Object -First 1
if ($ipInfo) {
    $lanIP = $ipInfo.IPAddress
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  SERVER READY" -ForegroundColor Green
Write-Host ""
Write-Host "  Local:    http://localhost:3000" -ForegroundColor White
if ($lanIP -ne "") {
    Write-Host "  Network:  http://${lanIP}:3000" -ForegroundColor White
}
if ($ngrokUrl -ne "") {
    Write-Host "  Public:   $ngrokUrl" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "  Admin:    http://localhost:3000/admin/dashboard.html" -ForegroundColor White
Write-Host "  Cashier:  http://localhost:3000/cashier/live.html" -ForegroundColor White
Write-Host ""
Write-Host "  This window can be CLOSED - server keeps running." -ForegroundColor Green
Write-Host ""
Write-Host "  pm2 list                    check status" -ForegroundColor Gray
Write-Host "  pm2 logs fb-live-server     view logs" -ForegroundColor Gray
Write-Host "  pm2 restart fb-live-server  restart after changes" -ForegroundColor Gray
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
pause
