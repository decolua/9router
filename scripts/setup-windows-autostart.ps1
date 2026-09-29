# PowerShell setup script for 9router Windows 11 Watchdog & Autostart
# Compatible with PowerShell 5.1 and 7+

param(
    [ValidateSet("Enable", "Disable", "Status", "Start", "Stop")]
    [string]$Action = "Status"
)

$ErrorActionPreference = "Stop"

$StartupDir = [System.IO.Path]::Combine($env:APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
$VbsPath = [System.IO.Path]::Combine($StartupDir, "9router.vbs")
$RepoRoot = Split-Path -Parent $PSScriptRoot
$CliPath = [System.IO.Path]::Combine($RepoRoot, "cli", "cli.js")
$GlobalCliPath = [System.IO.Path]::Combine($env:APPDATA, "npm", "node_modules", "9router", "cli.js")
if (-not (Test-Path ([System.IO.Path]::Combine($RepoRoot, "cli", "app"))) -and (Test-Path $GlobalCliPath)) {
    $CliPath = $GlobalCliPath
}
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue

if (-not $NodeCmd) {
    Write-Error "node.exe not found in PATH."
    exit 1
}
$NodePath = $NodeCmd.Source

function Get-WatchdogContent {
    @"
Set WshShell = CreateObject("WScript.Shell")
Do
  ret = WshShell.Run("""$NodePath"" ""$CliPath"" --tray --skip-update", 0, True)
  If ret = 0 Then Exit Do
  WScript.Sleep 3000
Loop
"@
}

switch ($Action) {
    "Status" {
        $enabled = Test-Path $VbsPath
        $runningProcesses = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*9router*" }
        $vbsWatchdog = Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*9router.vbs*" }

        Write-Host "=== 9Router Windows Autostart Status ===" -ForegroundColor Cyan
        Write-Host "Autostart configured : $(if ($enabled) { 'YES' } else { 'NO' })" -ForegroundColor $(if ($enabled) { 'Green' } else { 'Yellow' })
        Write-Host "Watchdog file        : $VbsPath"
        Write-Host "Active node process  : $(if ($runningProcesses) { 'RUNNING (PID: ' + ($runningProcesses.ProcessId -join ', ') + ')' } else { 'STOPPED' })"
        Write-Host "Active watchdog      : $(if ($vbsWatchdog) { 'RUNNING (PID: ' + ($vbsWatchdog.ProcessId -join ', ') + ')' } else { 'STOPPED' })"
    }

    "Enable" {
        if (-not (Test-Path $StartupDir)) {
            New-Item -ItemType Directory -Path $StartupDir -Force | Out-Null
        }
        $content = Get-WatchdogContent
        [System.IO.File]::WriteAllText($VbsPath, $content, [System.Text.Encoding]::ASCII)
        Write-Host "[OK] 9Router watchdog enabled at: $VbsPath" -ForegroundColor Green
        Write-Host "Starts silently on Windows login with 3-second crash recovery."
    }

    "Disable" {
        if (Test-Path $VbsPath) {
            Remove-Item $VbsPath -Force
            Write-Host "[OK] 9Router autostart disabled (removed $VbsPath)." -ForegroundColor Green
        } else {
            Write-Host "[INFO] 9Router autostart is already disabled." -ForegroundColor Yellow
        }
    }

    "Start" {
        if (-not (Test-Path $VbsPath)) {
            $content = Get-WatchdogContent
            [System.IO.File]::WriteAllText($VbsPath, $content, [System.Text.Encoding]::ASCII)
        }
        Start-Process "wscript.exe" -ArgumentList "`"$VbsPath`"" -WindowStyle Hidden
        Write-Host "[OK] 9Router watchdog launched in background." -ForegroundColor Green
    }

    "Stop" {
        $vbsWatchdogs = Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*9router.vbs*" }
        foreach ($w in $vbsWatchdogs) {
            Stop-Process -Id $w.ProcessId -Force
            Write-Host "Stopped watchdog PID: $($w.ProcessId)" -ForegroundColor Yellow
        }
        $nodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*9router*" }
        foreach ($n in $nodes) {
            Stop-Process -Id $n.ProcessId -Force
            Write-Host "Stopped node PID: $($n.ProcessId)" -ForegroundColor Yellow
        }
        Write-Host "[OK] 9Router processes stopped." -ForegroundColor Green
    }
}
