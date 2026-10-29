# Custom Fork Installation on Windows

This runbook installs the `royanrosyad85/9router` custom fork directly from source on Windows and creates a global `router9` command. It is written so a coding agent can execute the installation end to end and verify the live server.

> [!IMPORTANT]
> This is a personal-fork deployment procedure. Do not open a pull request to the upstream `decolua/9router` repository. Secondary machines must follow `origin/fix/azure-custom-endpoint` and must never merge `upstream` themselves.

## Target state

A successful installation has all of the following:

- Repository branch: `fix/azure-custom-endpoint`
- The local fork is built from source; the public `9router` npm package is not installed globally
- Runtime data is stored outside the repository under `%APPDATA%\9router-custom`
- `router9` resolves from a fresh CMD and PowerShell terminal
- `router9` launches the local checkout with its root `.env`
- `GET /api/health` returns HTTP 200 with `{"ok":true}`
- `GET /api/version` reports the version in the checkout's root `package.json`
- No credentials are printed, committed, or copied into this document

## Safety rules for coding agents

1. Never run `npm install -g 9router`; that installs the public package instead of this fork.
2. Never print, read back, summarize, commit, or upload `.env` values.
3. Never merge the `upstream` remote from a Windows secondary machine. Pull only `origin/fix/azure-custom-endpoint` with fast-forward semantics.
4. Never discard local changes automatically. Stop when `git status --short` is not clean and ask the operator whether to commit, stash, or remove them.
5. Do not change source code or Git history during installation.
6. Do not expose port `20128` publicly. Bind to `127.0.0.1` unless the operator explicitly chooses a private Tailscale setup.
7. Do not start a second instance when port `20128` is already listening.
8. Report only verified results from commands and HTTP responses.

## Prerequisites

Install these before continuing:

- Windows 10 or Windows 11
- Git for Windows
- Node.js 20.9 or newer (Node 22 LTS recommended)
- npm
- PowerShell

Next.js in this checkout requires Node 20.9 or newer. Node 22 LTS is the conservative production choice. Newer Node versions may be used when dependency installation, tests, the production build, and live health checks all pass.

Open PowerShell and verify:

```powershell
node --version
npm --version
git --version
```

## 1. Clone or locate the checkout

The examples use:

```text
C:\Project\9router
```

For a fresh machine, create the parent directory and clone the personal fork over HTTPS:

```powershell
New-Item -ItemType Directory -Force C:\Project | Out-Null
git clone --branch fix/azure-custom-endpoint --single-branch https://github.com/royanrosyad85/9router.git C:\Project\9router
```

If the repository is already cloned, do not clone it again. Set the path once and enter it:

```powershell
$Repo = "C:\Project\9router"
Set-Location $Repo
```

Confirm the checkout is on the personal fork branch:

```powershell
git remote -v
git branch --show-current
git status -sb
git rev-parse --short HEAD
node -p "require('./package.json').version"
```

Required conditions:

- `origin` points to `royanrosyad85/9router`
- current branch is `fix/azure-custom-endpoint`
- no tracked modifications are present

Fail closed when the worktree contains any tracked or untracked changes:

```powershell
if (git status --porcelain) {
  throw "Working tree is not clean. Ask the operator whether to commit, stash, or remove each change."
}
```

If the branch is behind the personal fork:

```powershell
git fetch origin --prune
git switch fix/azure-custom-endpoint
git pull --ff-only origin fix/azure-custom-endpoint
```

Do not add or merge an upstream remote on this machine.

### Validate the protected Azure executor

Compare the working-tree Git blob with the committed blob. This is line-ending safe on Windows:

```powershell
$ExpectedBlob = git rev-parse HEAD:open-sse/executors/azure.js
$ActualBlob = git hash-object .\open-sse\executors\azure.js
if ($ExpectedBlob -ne $ActualBlob) {
  throw "Protected Azure executor differs from the committed fork"
}
"Azure executor blob verified: $ActualBlob"
```

Do not compare only `Get-FileHash` with a Linux SHA-256 baseline: a clean Windows checkout can use CRLF line endings while retaining identical Git content.

## 2. Create the runtime configuration

Detect whether `.env` already exists:

```powershell
$CreateEnv = -not (Test-Path .env)
```

Create an isolated data directory:

```powershell
$DataDir = Join-Path $env:APPDATA "9router-custom"
New-Item -ItemType Directory -Force $DataDir | Out-Null
```

When `$CreateEnv` is true, generate three independent secrets locally. Do not print them in an agent response:

```powershell
if ($CreateEnv) {
  $JwtSecret = node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))"
  $ApiKeySecret = node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))"
  $MachineSalt = node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))"
}
```

When `$CreateEnv` is true, ask the operator to enter the initial dashboard password through a masked prompt. Restrict it to dotenv-safe characters so it cannot inject another setting or be silently changed by parsing:

```powershell
if ($CreateEnv) {
  do {
    $SecurePassword = Read-Host "Choose a 12-128 character dashboard password (letters, digits, !@`$%^&*()_+=.- only)" -AsSecureString
    $Bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
    try {
      $InitialPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Bstr)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Bstr)
    }
  } until ($InitialPassword -match '^[A-Za-z0-9!@$%^&*()_+=.-]{12,128}$')
}
```

When `$CreateEnv` is true, write `.env` without displaying its contents. Never overwrite an existing `.env`:

```powershell
if ($CreateEnv) {
  $DataDirEnv = $DataDir.Replace('\', '/')
  $EnvLines = @(
  "JWT_SECRET=$JwtSecret"
  "INITIAL_PASSWORD=$InitialPassword"
  "DATA_DIR=$DataDirEnv"
  "PORT=20128"
  "HOSTNAME=127.0.0.1"
  "NODE_ENV=production"
  "API_KEY_SECRET=$ApiKeySecret"
  "MACHINE_ID_SALT=$MachineSalt"
  "BASE_URL=http://127.0.0.1:20128"
  "CLOUD_URL=https://9router.com"
  "NEXT_PUBLIC_BASE_URL=http://127.0.0.1:20128"
  "NEXT_PUBLIC_CLOUD_URL=https://9router.com"
  "ENABLE_REQUEST_LOGS=false"
  "OBSERVABILITY_ENABLED=true"
  "AUTH_COOKIE_SECURE=false"
    "REQUIRE_API_KEY=true"
  )
  [IO.File]::WriteAllLines((Join-Path $Repo ".env"), $EnvLines, [Text.UTF8Encoding]::new($false))
  Remove-Variable JwtSecret, ApiKeySecret, MachineSalt, InitialPassword, SecurePassword -ErrorAction SilentlyContinue
}
```

Restrict access to the secrets and runtime directory to the current user and SYSTEM (best effort; stop if this fails on a shared machine):

```powershell
$Principal = "$env:USERDOMAIN\$env:USERNAME"
icacls .env /inheritance:r /grant:r "${Principal}:(F)" "SYSTEM:(F)"
icacls $DataDir /inheritance:r /grant:r "${Principal}:(OI)(CI)(F)" "SYSTEM:(OI)(CI)(F)"
```

Whether `.env` was just created or already existed, validate only the presence of required keys:

```powershell
node --env-file=.env -e "for (const k of ['JWT_SECRET','INITIAL_PASSWORD','DATA_DIR','PORT','HOSTNAME','API_KEY_SECRET','MACHINE_ID_SALT']) console.log(k, process.env[k] ? 'OK' : 'MISSING')"
```

Every key must report `OK`. Never print the values.

## 3. Install dependencies

From the repository root:

```powershell
npm install
npm install --prefix tests
```

Warnings about blocked optional install scripts or audit findings do not by themselves prove the build is broken. Do not run `npm audit fix --force` during installation because it can rewrite dependency versions.

This fork currently ignores npm lockfiles, so `npm ci` is not an available reproducible-install path. `npm install` resolves dependency ranges at installation time; record the source commit, Node/npm versions, and successful build/health results in the final report. Do not commit newly generated lockfiles as part of installation.

## 4. Run the fork smoke tests

```powershell
Push-Location tests
try {
  npx vitest run unit/azure-executor.test.js unit/tunnel-healthcheck.test.js
} finally {
  Pop-Location
}
```

The fork currently has one known baseline mismatch:

```text
AzureExecutor > removes reasoning_effort when its value is none
```

Proceed only when that is the sole failure and the remaining nine tests pass. Stop on any additional failure.

## 5. Build the production server

```powershell
npm run build
```

The build must exit successfully and end with standalone asset messages including:

```text
[standalone-assets] Copied static assets ...
[standalone-assets] Copied public assets ...
[standalone-assets] Copied custom-server.js ...
```

Verify required artifacts exist:

```powershell
$RequiredArtifacts = @(
  ".next\BUILD_ID"
  ".next\standalone\custom-server.js"
  ".next\standalone\.next\static"
  ".next\standalone\public"
)
foreach ($Path in $RequiredArtifacts) {
  if (-not (Test-Path $Path)) { throw "Missing build artifact: $Path" }
}
```

## 6. Create the global `router9` command

The wrapper must invoke this checkout, not the public npm package.

```powershell
$Repo = (Resolve-Path "C:\Project\9router").Path
$NpmCmd = (Get-Command npm.cmd).Source
$GlobalBin = (npm prefix -g).Trim()
if (-not $GlobalBin) { throw "Could not resolve npm global prefix" }
New-Item -ItemType Directory -Force $GlobalBin | Out-Null

$Wrapper = @"
@echo off
cd /d "$Repo"
"$NpmCmd" run router
"@
[IO.File]::WriteAllText((Join-Path $GlobalBin "router9.cmd"), $Wrapper, [Text.ASCIIEncoding]::new())
```

Ensure the npm global directory is present in the user PATH without duplicating or overwriting existing entries:

```powershell
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$Parts = @($UserPath -split ';' | Where-Object { $_ })
if ($Parts -notcontains $GlobalBin) {
  $NewUserPath = (($Parts + $GlobalBin) | Select-Object -Unique) -join ';'
  [Environment]::SetEnvironmentVariable("Path", $NewUserPath, "User")
}
```

Update the current PowerShell process so verification does not require waiting for a new terminal:

```powershell
if (($env:Path -split ';') -notcontains $GlobalBin) {
  $env:Path += ";$GlobalBin"
}
Get-Command router9
```

The wrapper's expected path is usually:

```text
%APPDATA%\npm\router9.cmd
```

## 7. Start exactly one verification instance

First confirm the port is free:

```powershell
$Existing = Get-NetTCPConnection -LocalPort 20128 -State Listen -ErrorAction SilentlyContinue
if ($Existing) {
  throw "Port 20128 is already in use by PID $($Existing.OwningProcess). Stop or reuse that instance; do not start a second one."
}
```

Launch the wrapper in a background process and save the PID:

```powershell
$RouterProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "router9" -PassThru -WindowStyle Hidden
$RouterPid = $RouterProcess.Id
"Started router9 verification instance as PID $RouterPid"
```

Wait for real readiness rather than sleeping blindly:

```powershell
$Deadline = (Get-Date).AddMinutes(2)
$Healthy = $false
do {
  try {
    $Health = Invoke-RestMethod http://127.0.0.1:20128/api/health -TimeoutSec 5
    if ($Health.ok -eq $true) { $Healthy = $true; break }
  } catch {}
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $Deadline)
if (-not $Healthy) {
  & taskkill.exe /PID $RouterPid /T /F 2>$null | Out-Null
  if (Get-NetTCPConnection -LocalPort 20128 -State Listen -ErrorAction SilentlyContinue) {
    throw "Verification failed and a child process still owns port 20128; stop and inspect it manually"
  }
  throw "9Router did not become healthy within two minutes"
}
```

## 8. Verify the live installation

```powershell
$Health = Invoke-RestMethod http://127.0.0.1:20128/api/health -TimeoutSec 10
$Version = Invoke-RestMethod http://127.0.0.1:20128/api/version -TimeoutSec 10
$ExpectedVersion = node -p "require('./package.json').version"

if ($Health.ok -ne $true) { throw "Health response was not ok" }
if ($Version.currentVersion -ne $ExpectedVersion) {
  throw "Live version $($Version.currentVersion) does not match source version $ExpectedVersion"
}

"Health: HTTP 200, ok=true"
"Live version: $($Version.currentVersion)"
"Dashboard: http://127.0.0.1:20128"
```

Open the dashboard and sign in with the initial password:

```powershell
Start-Process http://127.0.0.1:20128
```

Configure provider credentials manually in the dashboard. Do not pass provider secrets through an agent chat.

## 9. Verify from fresh CMD and PowerShell terminals

A coding agent should launch clean child shells and verify resolution:

```powershell
cmd.exe /d /c "where router9"
powershell.exe -NoProfile -Command "(Get-Command router9).Source"
```

Both must resolve the same local wrapper. Do not start another server during this check.

## 10. Optional: private Tailscale access

Keep `HOSTNAME=127.0.0.1`. If Tailscale is installed and private remote access is wanted, inspect existing mappings first:

```powershell
tailscale serve status
```

Only after confirming the HTTPS root is unused on this new laptop:

```powershell
tailscale serve --bg 20128
tailscale serve status
```

Keep `REQUIRE_API_KEY=true` before enabling Tailscale Serve, and ensure tailnet ACLs restrict access to trusted principals. Do not use Tailscale Funnel unless public internet exposure is explicitly requested.

## 11. Optional: start automatically at user logon

Do this only after the foreground/background verification above succeeds.

Create a launcher script outside the repo secrets. It rotates the previous log at startup so output cannot grow forever:

```powershell
$Launcher = Join-Path $env:APPDATA "9router-custom\start-router9.ps1"
$LauncherBody = @"
`$ErrorActionPreference = 'Stop'
if (-not (Get-NetTCPConnection -LocalPort 20128 -State Listen -ErrorAction SilentlyContinue)) {
  `$Log = '$(Join-Path $env:APPDATA "9router-custom\router9.log")'
  `$OldLog = "`$Log.1"
  if (Test-Path `$OldLog) { Remove-Item `$OldLog -Force }
  if (Test-Path `$Log) { Move-Item `$Log `$OldLog -Force }
  & '$(Join-Path (npm prefix -g).Trim() "router9.cmd")' *>> `$Log
}
"@
[IO.File]::WriteAllText($Launcher, $LauncherBody, [Text.UTF8Encoding]::new($false))
icacls $Launcher /inheritance:r /grant:r "${Principal}:(F)" "SYSTEM:(F)"
```

Register a Scheduled Task for the current user:

```powershell
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -File `"$Launcher`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "Router9 Custom Fork" -Action $Action -Trigger $Trigger -Settings $Settings -Description "Run the local royanrosyad85/9router custom fork" -Force
```

Verify the task without launching a duplicate server:

```powershell
Get-ScheduledTask -TaskName "Router9 Custom Fork"
```

## Updating this Windows installation

This machine follows the personal fork only.

1. Stop the running process or Scheduled Task.
2. Ensure the worktree is clean.
3. Fast-forward from `origin/fix/azure-custom-endpoint`.
4. Reinstall dependencies, test, and build.
5. Restart and repeat live health/version verification.

```powershell
Set-Location C:\Project\9router

git status --short
if (git status --porcelain) {
  throw "Uncommitted changes detected. Commit or stash them before updating."
}

git fetch origin --prune
git switch fix/azure-custom-endpoint
git pull --ff-only origin fix/azure-custom-endpoint

npm install
npm install --prefix tests
Push-Location tests
try {
  npx vitest run unit/azure-executor.test.js unit/tunnel-healthcheck.test.js
} finally {
  Pop-Location
}
npm run build
```

If a Scheduled Task owns the process, stop the task and identify the listener before terminating anything. Refuse to kill an unrelated executable:

```powershell
Stop-ScheduledTask -TaskName "Router9 Custom Fork" -ErrorAction SilentlyContinue
$Listener = Get-NetTCPConnection -LocalPort 20128 -State Listen -ErrorAction SilentlyContinue
if ($Listener) {
  $Owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($Listener.OwningProcess)"
  if ($Owner.Name -notin @('node.exe','cmd.exe','powershell.exe')) {
    throw "Refusing to stop unrelated port owner: $($Owner.Name) PID $($Owner.ProcessId)"
  }
  & taskkill.exe /PID $Listener.OwningProcess /T /F | Out-Null
}
Start-ScheduledTask -TaskName "Router9 Custom Fork"
```

Otherwise start `router9` manually. Then repeat `/api/health` and `/api/version` checks.

## Rollback and recovery

Before a future update, copy `%APPDATA%\9router-custom\db\data.sqlite` into a timestamped backup directory while the server is stopped. If a build fails, the existing `.next` build may be incomplete, so do not restart until a successful rebuild.

To return source code to the last known commit without destroying uncommitted work, stop and ask the operator. Never run `git reset --hard` automatically.

## Final coding-agent report

At completion, report only:

- repository path, branch, short commit, and source version
- protected Azure Git blob verification result
- wrapper absolute path
- fresh CMD and PowerShell command-resolution results
- verification-process PID and whether it was intentionally left running
- health response status
- live version and expected source version
- dashboard URL
- optional Scheduled Task and Tailscale status
- any warnings or skipped optional steps

Never include `.env` values, dashboard passwords, provider credentials, API keys, or auth tokens.
