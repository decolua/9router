# 9Router Background Runner — Windows PowerShell (interactive, no args)
# Supports: -Action <Start|Stop|Status|Update> for non-interactive use

param (
    [string]$Action = ""
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..").Path
$logDir = Join-Path $root "logs"
$logFile = Join-Path $logDir "9router.log"
$errFile = Join-Path $logDir "9router.err.log"
$pidFile = Join-Path $logDir "9router.pid"
$port = 20128
if ($env:PORT) { $port = [int]$env:PORT }

# Headroom paths
$headroomDir = Join-Path $env:USERPROFILE ".9router\headroom"
$headroomPidFile = Join-Path $headroomDir "proxy.pid"
$headroomLogFile = Join-Path $headroomDir "proxy.log"
$headroomErrLogFile = Join-Path $headroomDir "proxy.err.log"
$headroomPort = 8787

function Ensure-HeadroomDir {
  if (-not (Test-Path $headroomDir)) { New-Item -ItemType Directory -Path $headroomDir -Force | Out-Null }
}

function Get-HeadroomPid {
  if (Test-Path $headroomPidFile) {
    try { $p = Get-Content $headroomPidFile -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { return [int]([string]$p).Trim() } } catch {}
  }
  return $null
}

function Test-HeadroomPort {
  try { $t = New-Object System.Net.Sockets.TcpClient; $t.Connect("127.0.0.1",$headroomPort); $t.Close(); return $true } catch { return $false }
}

function Find-HeadroomBinary {
  $candidates = @(
    "headroom",
    "$env:LOCALAPPDATA\Programs\Python\Python313\Scripts\headroom.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python312\Scripts\headroom.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\Scripts\headroom.exe",
    "$env:APPDATA\Python\Python313\Scripts\headroom.exe",
    "$env:USERPROFILE\.local\bin\headroom"
  )
  foreach ($c in $candidates) {
    try {
      $found = (Get-Command $c -ErrorAction SilentlyContinue).Source
      if ($found) { return $found }
    } catch {}
  }
  return $null
}

function Start-HeadroomProxy {
  Ensure-HeadroomDir
  $binary = Find-HeadroomBinary
  if (-not $binary) {
    Write-Host "Headroom CLI not found. Install with: pip install 'headroom-ai[proxy]'" -ForegroundColor Red
    return
  }
  if (Test-HeadroomPort) {
    Write-Host "Headroom proxy already running on port $headroomPort" -ForegroundColor Yellow
    return
  }
  $existingPid = Get-HeadroomPid
  if ($existingPid -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
    Write-Host "Headroom proxy already running (PID $existingPid)" -ForegroundColor Yellow
    return
  }
  $args = "proxy --port $headroomPort"
  Write-Host "Starting Headroom proxy on port $headroomPort..." -ForegroundColor Green
  
  $proc = Start-Process -FilePath $binary -ArgumentList $args -WorkingDirectory $headroomDir -RedirectStandardOutput $headroomLogFile -RedirectStandardError $headroomErrLogFile -WindowStyle Hidden -PassThru
  
  if (-not $proc) {
    Write-Host "Failed to start headroom proxy" -ForegroundColor Red
    return
  }
  $proc.Id | Set-Content $headroomPidFile
  Write-Host "Started Headroom proxy PID $($proc.Id)" -ForegroundColor Green
  Start-Sleep 3
  if (Test-HeadroomPort) {
    Write-Host "Headroom proxy is running and listening on port $headroomPort" -ForegroundColor Green
  } else {
    Write-Host "Warning: Headroom proxy started but port $headroomPort not listening yet" -ForegroundColor Yellow
  }
}

function Stop-HeadroomProxy {
  $proxyPid = Get-HeadroomPid
  if ($proxyPid -and (Get-Process -Id $proxyPid -ErrorAction SilentlyContinue)) {
    try { 
        Stop-Process -Id $proxyPid -Force -ErrorAction Stop
        Write-Host "Stopped Headroom proxy PID $proxyPid" -ForegroundColor Green 
    } catch { 
        Write-Host "Failed to stop PID $($proxyPid): $_" -ForegroundColor Red 
    }
  } else {
    Write-Host "Headroom proxy not running (no managed PID)" -ForegroundColor Yellow
  }
  if (Test-Path $headroomPidFile) { Remove-Item $headroomPidFile -Force -ErrorAction SilentlyContinue }
  
  # Fallback: kill any process on port 8787
  if (Test-HeadroomPort) {
    try {
      $conn = Get-NetTCPConnection -LocalPort $headroomPort -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($conn) { 
        $owner = $conn.OwningProcess
        Stop-Process -Id $owner -Force
        Write-Host "Killed port $headroomPort owner PID $owner" -ForegroundColor Green 
      }
    } catch {}
  }
}

function Show-HeadroomStatus {
  $installed = $false
  $binary = Find-HeadroomBinary
  if ($binary) { $installed = $true; Write-Host "Headroom CLI: INSTALLED ($binary)" -ForegroundColor Green } else { Write-Host "Headroom CLI: NOT INSTALLED" -ForegroundColor Red }
  $running = Test-HeadroomPort
  if ($running) { Write-Host "Headroom proxy: RUNNING on port $headroomPort" -ForegroundColor Green } else { Write-Host "Headroom proxy: STOPPED" -ForegroundColor Yellow }
  
  $proxyPid = Get-HeadroomPid
  if ($proxyPid) { Write-Host "Managed PID: $proxyPid" -ForegroundColor Cyan }
  
  if (Test-Path $headroomLogFile) {
    Write-Host "Log: $headroomLogFile"
    Get-Content $headroomLogFile -Tail 10 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
  }
}

function Ensure-LogDir {
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
  if (-not (Test-Path (Join-Path $logDir ".gitkeep"))) { New-Item -ItemType File -Path (Join-Path $logDir ".gitkeep") -Force | Out-Null }
}

function Get-RunningPid {
  if (Test-Path $pidFile) {
    try { $p = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { return [int]([string]$p).Trim() } } catch {}
  }
  return $null
}

function Test-PortListen {
  try {
    $c = Test-NetConnection -ComputerName "127.0.0.1" -Port $port -WarningAction SilentlyContinue -InformationLevel Quiet
    return $c
  } catch {
    try { $t = New-Object System.Net.Sockets.TcpClient; $t.Connect("127.0.0.1",$port); $t.Close(); return $true } catch { return $false }
  }
}

function Show-Status {
  $pidSaved = Get-RunningPid
  $listening = Test-PortListen
  $proc = $null
  if ($pidSaved) { $proc = Get-Process -Id $pidSaved -ErrorAction SilentlyContinue }
  Write-Host '=== 9Router Status ===' -ForegroundColor Cyan
  Write-Host "Port: $port"
  Write-Host "PID file: $pidFile"
  if ($pidSaved) { Write-Host "Saved PID: $pidSaved" } else { Write-Host "Saved PID: (none)" }
  if ($proc) { Write-Host "Process: running (bun PID $pidSaved)" -ForegroundColor Green } elseif ($pidSaved) { Write-Host "Process: NOT running (stale PID)" -ForegroundColor Yellow }
  if ($listening) { Write-Host "Port $port : LISTENING" -ForegroundColor Green } else { Write-Host "Port $port : NOT listening" -ForegroundColor Yellow }
  try {
    $h = Invoke-RestMethod -Uri "http://localhost:$port/api/health" -TimeoutSec 3 -ErrorAction Stop
    Write-Host "Health: $($h | ConvertTo-Json -Compress)" -ForegroundColor Green
  } catch { Write-Host "Health: unreachable ($($_.Exception.Message))" -ForegroundColor Yellow }
  if (Test-Path $logFile) { Write-Host "Log: $logFile ($( (Get-Item $logFile).Length ) bytes)"; Get-Content $logFile -Tail 6 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray } } else { Write-Host "Log: (none)" }
  Write-Host ""
}

function Get-LocalVersion {
  $pkgFile = Join-Path $root "package.json"
  if (Test-Path $pkgFile) {
    try { $pkg = Get-Content $pkgFile -Raw | ConvertFrom-Json; return $pkg.version } catch { return $null }
  }
  return $null
}

function Get-LatestNpmVersion {
  try {
    $json = Invoke-RestMethod -Uri "https://registry.npmjs.org/9router/latest" -TimeoutSec 6 -ErrorAction Stop
    return $json.version
  } catch { return $null }
}

function Compare-Versions {
  param([string]$a, [string]$b)
  $pa = $a.Split('.') | ForEach-Object { [int]$_ }
  $pb = $b.Split('.') | ForEach-Object { [int]$_ }
  for ($i = 0; $i -lt 3; $i++) {
    if ($pa[$i] -gt $pb[$i]) { return 1 }
    if ($pa[$i] -lt $pb[$i]) { return -1 }
  }
  return 0
}

function Update-Router {
  $localVersion = Get-LocalVersion
  $latestVersion = Get-LatestNpmVersion

  Write-Host '=== 9Router Update ===' -ForegroundColor Cyan
  Write-Host "Local source version: v$localVersion"
  if ($latestVersion) { Write-Host "Latest npm version:   v$latestVersion" } else { Write-Host "Latest npm version:   (unreachable)" -ForegroundColor Yellow }

  $bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
  if (-not $bun) {
    Write-Host "bun not found on PATH — bun is mandatory for update." -ForegroundColor Red
    return
  }

  # 1. Stop router (release file locks before git pull/install)
  Write-Host ""
  Write-Host "Step 1/4: Stopping 9Router..." -ForegroundColor Green
  $portOwner = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
  if ($portOwner) { Stop-Router } else { Write-Host "Router not running, skipping stop." -ForegroundColor DarkGray }

  # 2. Sync local source via git pull --ff-only (with stash if dirty)
  Write-Host ""
  Write-Host "Step 2/4: Syncing local source (git pull --ff-only)..." -ForegroundColor Green
  if (Test-Path (Join-Path $root ".git")) {
    $stashed = $false
    $stashOut = & git -C $root stash push --include-untracked -m "9router-update-$(Get-Date -Format 'yyyyMMdd-HHmmss')" 2>&1
    if ($LASTEXITCODE -eq 0 -and $stashOut -notmatch 'No local changes') {
      $stashed = $true
      Write-Host "  Stashed local changes." -ForegroundColor DarkGray
    } elseif ($stashOut -match 'No local changes') {
      Write-Host "  No local changes to stash." -ForegroundColor DarkGray
    } else {
      Write-Host "  Warning: git stash failed: $stashOut" -ForegroundColor Yellow
    }

    $out = & git -C $root pull --ff-only 2>&1
    $out | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }

    if ($stashed) {
      $popOut = & git -C $root stash pop 2>&1
      if ($LASTEXITCODE -eq 0) {
        Write-Host "  Restored local changes." -ForegroundColor DarkGray
      } else {
        Write-Host "  Warning: git stash pop had conflicts. Stashed changes remain in stash list." -ForegroundColor Yellow
        $popOut | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
      }
    }

    if ($LASTEXITCODE -ne 0) {
      Write-Host "git pull failed. Aborting update to avoid dirty state." -ForegroundColor Red
      Start-Router
      return
    }
    $localVersion = Get-LocalVersion
    Write-Host "Source version now: v$localVersion" -ForegroundColor Green
  } else {
    Write-Host "  No .git directory — skipping source sync." -ForegroundColor Yellow
  }

  # 3. Update global 9router CLI via bun
  Write-Host ""
  Write-Host "Step 3/4: Updating global 9router CLI (bun add -g 9router@latest)..." -ForegroundColor Green
  $out = & $bun add -g 9router@latest --prefer-online 2>&1
  $out | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Global 9router update failed. See output above." -ForegroundColor Red
    Start-Router
    return
  }
  Write-Host "Global 9router updated." -ForegroundColor Green

  # 4. Refresh deps + restart
  Write-Host ""
  Write-Host "Step 4/4: Refreshing dependencies (bun install)..." -ForegroundColor Green
  $out = & $bun install 2>&1
  $out | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
  Write-Host ""
  Write-Host "Restarting 9Router..." -ForegroundColor Green
  Start-Router
}

function Start-Router {
  Ensure-LogDir
  if (Test-PortListen) { Write-Host "Port $port already in use — stop first." -ForegroundColor Yellow; Show-Status; return }
  $pidSaved = Get-RunningPid
  if ($pidSaved -and (Get-Process -Id $pidSaved -ErrorAction SilentlyContinue)) { Write-Host "Already running PID $pidSaved" -ForegroundColor Yellow; return }
  if (-not (Test-Path (Join-Path $root ".env"))) { Write-Host ".env not found — copy from .env.example first" -ForegroundColor Red; return }
  
  if ($env:NODE_ENV -eq "production") { 
    Write-Host "Removing NODE_ENV=production for dev (Turbopack)" -ForegroundColor DarkGray
    Remove-Item Env:\NODE_ENV -ErrorAction SilentlyContinue 
  }
  
  $env:PORT = "$port"
  $env:NEXT_PUBLIC_BASE_URL = "http://localhost:$port"
  Write-Host "Starting 9Router (Turbopack) on http://localhost:$port ..." -ForegroundColor Green
  if (Test-Path $pidFile) { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue }
  $proc = Start-Process -FilePath "bun" -ArgumentList "--bun","next","dev","--port","$port" -WorkingDirectory $root -RedirectStandardOutput $logFile -RedirectStandardError $errFile -WindowStyle Hidden -PassThru
  if ($proc) { $proc.Id | Set-Content $pidFile }
  Write-Host "Started PID $($proc.Id) → logs/9router.log" -ForegroundColor Green
  Start-Sleep 2
  Show-Status
}

function Stop-Router {
  $pidSaved = Get-RunningPid
  $killed = $false
  if ($pidSaved) {
    $p = Get-Process -Id $pidSaved -ErrorAction SilentlyContinue
    if ($p) { try { Stop-Process -Id $pidSaved -Force -ErrorAction Stop; Write-Host "Stopped PID $pidSaved" -ForegroundColor Green; $killed=$true } catch { Write-Host "Failed to kill $pidSaved $_" -ForegroundColor Red } }
    else { Write-Host "Stale PID $pidSaved (not running)" -ForegroundColor Yellow }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  }
  # Fallback: kill any bun next dev on that port
  if (-not $killed) {
    $procs = Get-Process -Name "bun" -ErrorAction SilentlyContinue
    foreach ($pr in $procs) {
      try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($pr.Id)" -ErrorAction SilentlyContinue).CommandLine
        if ($cmd -and $cmd -match "next dev.*$port") { Stop-Process -Id $pr.Id -Force; Write-Host "Killed fallback bun PID $($pr.Id)" -ForegroundColor Green; $killed=$true }
      } catch {}
    }
  }
  if (-not $killed) {
    try {
      $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($conn) { $owner = $conn.OwningProcess; Stop-Process -Id $owner -Force; Write-Host "Killed port owner PID $owner" -ForegroundColor Green; $killed=$true }
    } catch {}
  }
  if (-not $killed) { Write-Host "No running 9Router found" -ForegroundColor Yellow }
  Start-Sleep 1
  Show-Status
}

# --- NON-INTERACTIVE MODE DISPATCHER ---
if ($Action) {
  switch ($Action) {
    "Start"           { Start-Router; Start-HeadroomProxy }
    "Stop"            { Stop-HeadroomProxy; Stop-Router }
    "Status"          { Show-Status; Show-HeadroomStatus }
    "Update"          { Update-Router; Start-HeadroomProxy }
    default           { Write-Host "Unknown Action: $Action" -ForegroundColor Red }
  }
  return
}

# --- INTERACTIVE MENU ---
while ($true) {
  Write-Host ""
  Write-Host '9Router — pilih aksi:' -ForegroundColor Cyan
  Write-Host "  [1] Start + Headroom (9Router dev + proxy)"
  Write-Host "  [2] Stop  + Headroom (hentikan keduanya)"
  Write-Host "  [3] Status + Headroom"
  Write-Host "  [4] Update 9Router (git pull + bun add -g)"
  Write-Host '  [0] Keluar'
  
  $choice = Read-Host 'Masukkan angka'
  switch ($choice) {
    "1" { Start-Router; Start-HeadroomProxy }
    "2" { Stop-HeadroomProxy; Stop-Router }
    "3" { Show-Status; Show-HeadroomStatus }
    "4" { Update-Router; Start-HeadroomProxy }
    "0" { Write-Host 'Selesai.'; return } # <-- Perbaikan di sini (break diubah menjadi return)
    default { Write-Host 'Pilihan tidak valid' -ForegroundColor Red }
  }
}
