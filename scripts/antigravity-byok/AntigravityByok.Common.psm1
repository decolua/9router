#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Actions=New-Object 'System.Collections.Generic.List[object]'
$script:Warnings=New-Object 'System.Collections.Generic.List[string]'
$script:ToolsRoot=$PSScriptRoot
$script:ReportsRoot=Join-Path $PSScriptRoot 'results'
$script:Config=$null

function Initialize-ByokControl([string]$SettingsPath) {
    $script:SettingsPath = [IO.Path]::GetFullPath($SettingsPath)
    $script:ToolsRoot = Split-Path -Parent $script:SettingsPath
    $script:ReportsRoot = Join-Path $script:ToolsRoot 'results'
    $script:Config = [IO.File]::ReadAllText($script:SettingsPath) | ConvertFrom-Json
    $script:identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if ($script:Config.schemaVersion -ne 1 -or $script:Config.ownerSid -ne $script:identity.User.Value) { throw 'Control settings belong to another user or an unsupported schema.' }
    $script:DataRoot = [IO.Path]::GetFullPath($script:Config.dataDir)
    $script:MitmRoot = Join-Path $script:DataRoot 'mitm'
    $script:RuntimeMitmRoot = Join-Path $script:DataRoot 'runtime\mitm'
    $script:AppExe = [IO.Path]::GetFullPath($script:Config.appPath)
    $script:AppRoot = Split-Path -Parent $script:AppExe
    if ([IO.Path]::GetFileName($script:AppExe) -ine 'Antigravity.exe' -or [IO.Path]::GetFileName($script:Config.nodePath) -ine 'node.exe') { throw 'Choose the Antigravity.exe desktop application and node.exe runtime.' }
    $script:InstallRoots = @([IO.Path]::GetFullPath($script:Config.installRoot))
    $script:TrustedRuntimes = @([IO.Path]::GetFullPath($script:Config.nodePath))
    $script:ReportsRoot = Join-Path $script:ToolsRoot 'results'
    $script:HostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
    $script:Domains = @('daily-cloudcode-pa.googleapis.com','cloudcode-pa.googleapis.com')
    $script:Actions = New-Object 'System.Collections.Generic.List[object]'
    $script:Warnings = New-Object 'System.Collections.Generic.List[string]'
    foreach ($path in @($script:SettingsPath,$script:Config.profilePath,$script:Config.manifestPath)) { $null = Assert-PlainPath $path $script:ToolsRoot }
    $null = Assert-PlainPath $script:MitmRoot $script:DataRoot
    $null = Assert-PlainPath $script:AppExe $script:AppRoot
    $null = Assert-PlainPath $script:TrustedRuntimes[0] (Split-Path -Parent $script:TrustedRuntimes[0])
    if ($script:Config.gatewayPort -lt 1024 -or $script:Config.gatewayPort -gt 65535) { throw 'Gateway port must be between 1024 and 65535.' }
    return $script:Config
}

function Read-ByokProfile([string]$Path) {
    $json = [IO.File]::ReadAllText($Path)
    if ($json -match '(?i)"(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization|private[_-]?key|secret|client[_-]?secret)"\s*:') { throw 'The routing profile must not contain credentials.' }
    try { $profile = $json | ConvertFrom-Json } catch { throw 'The routing profile is not valid JSON; its contents were not logged.' }
    foreach($property in $profile.PSObject.Properties){if($property.Name -notin @('enabled','mappings','auxiliaryMappings')){throw 'The routing profile contains unsupported properties.'}}
    if ($profile.enabled -ne $true -or -not $profile.mappings -or @($profile.mappings.PSObject.Properties).Count -eq 0) { throw 'Choose an explicitly enabled profile with at least one user-owned model route.' }
    foreach ($entry in $profile.mappings.PSObject.Properties) {
        if ($entry.Value -is [string]) { throw 'Primary mappings must provide target and label.' }
        foreach($property in $entry.Value.PSObject.Properties){if($property.Name -notin @('target','label')){throw 'Primary mappings may contain only target and label.'}}
        if (-not $entry.Value.target -or [string]$entry.Value.target -notmatch '^[A-Za-z0-9._-]+/[^\s]+$' -or -not $entry.Value.label) { throw 'Each primary mapping needs a registered-prefix/model target and a display label.' }
    }
    if($script:Config -and $script:Config.nodePath){
        $output=& $script:Config.nodePath (Join-Path $script:ToolsRoot 'Validate-Profile.cjs') $Path (Join-Path $script:Config.installRoot 'app\src\mitm\antigravityByok.js') 2>$null
        if($LASTEXITCODE -ne 0){throw 'The routing profile was rejected by the shared BYOK policy loader.'}
    }
    # This control profile stores routing metadata only. Provider credentials stay
    # in 9Router; do not copy API credentials into shortcut configuration files.
    return $profile
}

function Test-InstalledBundle {
    $manifest = [IO.File]::ReadAllText($script:Config.manifestPath) | ConvertFrom-Json
    $package = [IO.File]::ReadAllText((Join-Path $script:Config.installRoot 'package.json')) | ConvertFrom-Json
    if ($package.name -ne '9router' -or $package.version -ne $manifest.packageVersion) { throw 'The installed package changed. Re-run Bootstrap to review a new control installation.' }
    foreach ($entry in $manifest.files.PSObject.Properties) {
        $path = Assert-PlainPath (Join-Path $script:Config.installRoot $entry.Name) $script:Config.installRoot
        if ((Get-Sha256 ([IO.File]::ReadAllBytes($path))) -ine $entry.Value) { throw 'An installed build artifact changed; refusing to start an unverified build.' }
    }
    return $manifest
}

function Invoke-ByokManager([string]$Action) {
    $output = & $script:Config.nodePath (Join-Path $script:ToolsRoot 'Manage-Byok.cjs') $script:SettingsPath $Action 2>$null
    $parsed=$null;try{$parsed=($output -join "`n")|ConvertFrom-Json}catch{}
    if ($LASTEXITCODE -ne 0) {
        $code=if($parsed -and $parsed.error -match '^[A-Z_]{1,60}$'){$parsed.error}else{'MANAGEMENT_FAILED'}
        throw "Local management action failed: $Action ($code)."
    }
    if(-not $parsed){throw 'Local management response was invalid.'}
    return $parsed
}

function Assert-ControlCertificateTrusted {
    # Read-only prerequisite: do not let native auto-start generate, rotate, or
    # trust a CA as a side effect of clicking Enable.
    $certPath=Assert-PlainPath (Join-Path $script:MitmRoot 'rootCA.crt') $script:MitmRoot
    $keyPath=Assert-PlainPath (Join-Path $script:MitmRoot 'rootCA.key') $script:MitmRoot
    if(-not(Test-Path -LiteralPath $certPath -PathType Leaf) -or -not(Test-Path -LiteralPath $keyPath -PathType Leaf)){throw 'Configure and trust the MITM certificate explicitly in 9Router first. Enable does not create or trust certificates.'}
    $certificate=$null;$store=$null
    try{
        $pem=[IO.File]::ReadAllText($certPath)
        if($pem -notmatch '(?s)^\s*-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\r\n]+)\s*-----END CERTIFICATE-----\s*$'){throw 'Invalid certificate.'}
        $certificate=New-Object Security.Cryptography.X509Certificates.X509Certificate2(,[Convert]::FromBase64String(($matches[1] -replace '\s','')))
        if($certificate.NotBefore.ToUniversalTime() -gt [DateTime]::UtcNow -or $certificate.NotAfter.ToUniversalTime() -lt [DateTime]::UtcNow.AddDays(30)){throw 'Certificate needs renewal.'}
        $store=New-Object Security.Cryptography.X509Certificates.X509Store('Root','LocalMachine')
        $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
        if(@($store.Certificates.Find([Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,$certificate.Thumbprint,$false)).Count -ne 1){throw 'Certificate is not trusted.'}
    }catch{throw 'Configure and trust a valid MITM certificate explicitly in 9Router first. Enable does not create, rotate, or trust certificates.'}
    finally{if($store){$store.Close()};if($certificate){$certificate.Dispose()}}
}

function Get-ControlPortListeners {
    return @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in @([int]$script:Config.gatewayPort,443) } | Select-Object LocalAddress,LocalPort,@{n='ProcessId';e={[int]$_.OwningProcess}})
}

function Get-NonBridgeHostsHash {
    $lines = @([IO.File]::ReadAllLines($script:HostsPath) | Where-Object { $_.Trim() -and $_ -notmatch '^\s*127\.0\.0\.1\s+(daily-cloudcode-pa|cloudcode-pa)\.googleapis\.com(?:\s*(?:#.*)?)?$' })
    return Get-Sha256 ([Text.Encoding]::UTF8.GetBytes(($lines -join "`n")))
}

function Get-ControlPaths {
    return [pscustomobject]@{ Config=$script:Config; DataRoot=$script:DataRoot; MitmRoot=$script:MitmRoot; ToolsRoot=$script:ToolsRoot; ReportsRoot=$script:ReportsRoot; AppExe=$script:AppExe; HostsPath=$script:HostsPath }
}

function Get-ControlActions { return @($script:Actions.ToArray()) }
function Add-ControlAction($Action) { $script:Actions.Add($Action) }

function Save-ControlReport($Value,[string]$Path) {
    $safe = Assert-PlainPath $Path $script:ReportsRoot
    if (-not (Test-Path -LiteralPath $script:ReportsRoot)) { $null = New-Item -ItemType Directory -Path $script:ReportsRoot }
    Write-NewBytes $safe ([Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 8))) $script:ReportsRoot
}

function Invoke-ControlElevation([string]$Driver,[string]$ResultPath,[string]$ExpectedUserSid) {
    if ($ExpectedUserSid -and $ExpectedUserSid -ne $script:identity.User.Value) { throw 'Elevation changed the Windows account; operation refused.' }
    $principal = New-Object Security.Principal.WindowsPrincipal($script:identity)
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { return }
    $driverPath = Assert-PlainPath $Driver $script:ToolsRoot
    $result = Assert-PlainPath $ResultPath $script:ReportsRoot
    $invocation = "& '$($driverPath.Replace("'","''"))' -SettingsPath '$($script:SettingsPath.Replace("'","''"))' -Apply -ExpectedUserSid '$($script:identity.User.Value)' -ResultPath '$($result.Replace("'","''"))'"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($invocation))
    $child = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-EncodedCommand',$encoded) -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    if (Test-Path -LiteralPath $result -PathType Leaf) { Write-Output ([IO.File]::ReadAllText($result)) }
    else { Write-Output (@{Status='Failed';Error='Elevated operation produced no result.'} | ConvertTo-Json) }
    exit $child.ExitCode
}

function Test-InRoot([string]$Path, [string]$Root) {
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    return $full.Equals($base, [StringComparison]::OrdinalIgnoreCase) -or
        $full.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Assert-PlainPath([string]$Path, [string]$Root) {
    # GetFullPath rejects traversal; reject junctions/symlinks as well, including
    # existing ancestors of a destination that has not been created yet.
    $full = [IO.Path]::GetFullPath($Path)
    if (-not (Test-InRoot $full $Root)) { throw 'Path is outside its allowed directory.' }
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'Refusing a symlink or junction in a control path.'
            }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor.TrimEnd('\'))
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
    return $full
}

function Get-Sha256([byte[]]$Bytes) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hasher.ComputeHash($Bytes)).Replace('-', '') }
    finally { $hasher.Dispose() }
}

function Get-HostsChange {
    $null = Assert-PlainPath $script:HostsPath (Join-Path $env:SystemRoot 'System32\drivers\etc')
    $bytes = [IO.File]::ReadAllBytes($script:HostsPath)
    $offset = 0
    $preamble = [byte[]]@()
    $encoding = New-Object Text.UTF8Encoding($false, $true)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {
        $offset = 3; $preamble = [byte[]]@(239,187,191)
    } elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 255 -and $bytes[1] -eq 254) {
        $offset = 2; $preamble = [byte[]]@(255,254); $encoding = [Text.Encoding]::Unicode
    } elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 254 -and $bytes[1] -eq 255) {
        $offset = 2; $preamble = [byte[]]@(254,255); $encoding = [Text.Encoding]::BigEndianUnicode
    }
    try { $text = $encoding.GetString($bytes, $offset, $bytes.Length - $offset) }
    catch {
        $encoding = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.ANSICodePage)
        $text = $encoding.GetString($bytes)
    }
    $kept = New-Object Text.StringBuilder
    $removed = New-Object 'System.Collections.Generic.List[object]'
    $skipped = New-Object 'System.Collections.Generic.List[object]'
    $lineNumber = 0
    $ownedPattern = '^\s*127\.0\.0\.1[ \t]+(?<host>daily-cloudcode-pa\.googleapis\.com|cloudcode-pa\.googleapis\.com)[ \t]+#[ \t]*9router-antigravity-byok:' + [regex]::Escape($script:Config.installationId) + '[ \t]*$'
    foreach ($match in [regex]::Matches($text, '[^\r\n]*(?:\r\n|\r|\n|$)')) {
        if ($match.Value.Length -eq 0) { continue }
        $lineNumber++
        $body = $match.Value.TrimEnd([char[]]@("`r", "`n"))
        $owned = [regex]::Match($body, $ownedPattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if ($owned.Success) {
            $removed.Add([pscustomobject]@{ Line = $lineNumber; Host = $owned.Groups['host'].Value.ToLowerInvariant(); Address = '127.0.0.1' })
        } else {
            $null = $kept.Append($match.Value)
            # Report the target name and line number, never unrelated hosts text.
            foreach ($domain in $script:Domains) {
                if ($body -notmatch '^\s*#' -and $body -match ('(?i)(?<![\w.-])' + [regex]::Escape($domain) + '(?![\w.-])')) {
                    $skipped.Add([pscustomobject]@{
                        Line = $lineNumber; Host = $domain
                        IsLoopbackRedirect = ($body -match '^\s*(?:127\.\d+\.\d+\.\d+|::1)[ \t]+')
                        Reason = 'Not an owned single-host 127.0.0.1 line; preserved.'
                    })
                }
            }
        }
    }
    $newBytes = [byte[]]($preamble + $encoding.GetBytes($kept.ToString()))
    return [pscustomobject]@{
        BeforeBytes = $bytes; AfterBytes = $newBytes; BeforeHash = Get-Sha256 $bytes
        Removed = @($removed.ToArray()); PreservedTargetLines = @($skipped.ToArray())
    }
}

function Get-CommandArguments([string]$CommandLine) {
    # These tokens are inspected only, never executed. A malformed/relative entry
    # fails closed. Quoted absolute Windows paths with spaces are supported.
    return @([regex]::Matches($CommandLine, '"([^"]*)"|(\S+)') | ForEach-Object {
        if ($_.Groups[1].Success) { $_.Groups[1].Value } else { $_.Groups[2].Value }
    })
}

function Get-VerifiedRouterProcess([int]$ProcessId, [string]$Role, [string]$ExpectedExe = '') {
    if ($ProcessId -le 4 -or $ProcessId -eq $PID) { return $null }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if (-not $process -or -not $process.ExecutablePath -or -not $process.CommandLine) { return $null }
    $exe = [IO.Path]::GetFullPath($process.ExecutablePath)
    if ($ExpectedExe -and [IO.Path]::GetFileName($exe) -ine $ExpectedExe) { return $null }
    $trusted = @($script:TrustedRuntimes | Where-Object { $_ -ieq $exe }).Count -gt 0
    if (-not $trusted) {
        foreach ($root in $script:InstallRoots) {
            if ((Test-InRoot $exe $root) -and [IO.Path]::GetFileName($exe) -match '^(node|bun)\.exe$') {
                try { $null = Assert-PlainPath $exe $root; $trusted = $true } catch { }
            }
        }
    }
    if (-not $trusted) { return $null }
    $entry = $null
    foreach ($argument in @(Get-CommandArguments $process.CommandLine)) {
        if ($argument -notmatch '(?i)^[a-z]:[\\/].*\.(?:c?js)$') { continue }
        $candidate = [IO.Path]::GetFullPath($argument)
        $allowed = $false
        if ($Role -eq 'Mitm') {
            $allowed = $candidate -ieq (Join-Path $script:RuntimeMitmRoot 'server.js')
        }
        foreach ($root in $script:InstallRoots) {
            if (-not (Test-InRoot $candidate $root)) { continue }
            if ($Role -eq 'Launcher' -and [IO.Path]::GetFileName($candidate) -match '^(cli|9router)\.c?js$') { $allowed = $true }
            if ($Role -eq 'Main' -and [IO.Path]::GetFileName($candidate) -match '^(custom-server|server)\.js$' -and $candidate -match '[\\/]app[\\/]') { $allowed = $true }
            if ($Role -eq 'Mitm' -and $candidate -match '[\\/]mitm[\\/]server\.js$') { $allowed = $true }
            if ($allowed) { $null = Assert-PlainPath $candidate $root; break }
        }
        if ($allowed -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            if (Test-InRoot $candidate $script:RuntimeMitmRoot) { $null = Assert-PlainPath $candidate $script:RuntimeMitmRoot }
            $entry = $candidate; break
        }
    }
    if (-not $entry) { return $null }
    return [pscustomobject]@{
        ProcessId = [int]$process.ProcessId; Role = $Role; ExecutablePath = $exe
        EntryFile = $entry; CreatedUtc = $process.CreationDate.ToUniversalTime().ToString('o')
    }
}

function Get-RecordedRouterProcesses {
    $found = New-Object 'System.Collections.Generic.List[object]'
    $launcherFile = Join-Path $script:DataRoot 'launcher.pid'
    if (Test-Path -LiteralPath $launcherFile -PathType Leaf) {
        $null = Assert-PlainPath $launcherFile $script:DataRoot
        try {
            $record = [IO.File]::ReadAllText($launcherFile) | ConvertFrom-Json
            $recordExe = $record.PSObject.Properties['exe']
            if (-not $recordExe -or [string]$recordExe.Value -notmatch '^(node|bun)\.exe$') {
                throw 'Launcher record does not name a recognized runtime.'
            }
            foreach ($pair in @(@('cliPid', 'Launcher'), @('serverPid', 'Main'))) {
                $property = $record.PSObject.Properties[$pair[0]]
                if (-not $property -or [string]$property.Value -notmatch '^\d+$') { continue }
                $candidate = Get-VerifiedRouterProcess ([int]$property.Value) $pair[1] ([string]$recordExe.Value)
                if ($candidate) { $found.Add($candidate) }
                else { $script:Warnings.Add("Recorded $($pair[1]) PID is absent or did not pass executable/entry validation; not targeted.") }
            }
        } catch { $script:Warnings.Add('Launcher PID record is unreadable or invalid; not targeted.') }
    }
    $mitmFile = Join-Path $script:MitmRoot '.mitm.pid'
    if (Test-Path -LiteralPath $mitmFile -PathType Leaf) {
        $null = Assert-PlainPath $mitmFile $script:MitmRoot
        $value = [IO.File]::ReadAllText($mitmFile).Trim()
        if ($value -match '^\d+$') {
            $candidate = Get-VerifiedRouterProcess ([int]$value) 'Mitm'
            if ($candidate) { $found.Add($candidate) }
            else { $script:Warnings.Add('Recorded MITM PID is absent or did not pass executable/entry validation; not targeted.') }
        } else { $script:Warnings.Add('MITM PID record is invalid; not targeted.') }
    }
    return @($found.ToArray() | Sort-Object ProcessId -Unique)
}

function Get-AppRestartProcesses {
    if (-not (Test-Path -LiteralPath $script:AppExe -PathType Leaf)) { return @() }
    $null = Assert-PlainPath $script:AppExe $script:AppRoot
    $all = @(Get-CimInstance Win32_Process)
    $mains = @($all | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath -ieq $script:AppExe -and
        $_.CommandLine -and $_.CommandLine -notmatch '(?i)(?:^|\s)--type(?:=|\s)'
    })
    $descendants = @{}
    foreach ($main in $mains) { $descendants[[int]$main.ProcessId] = 0 }
    do {
        $added = $false
        foreach ($process in $all) {
            if (-not $descendants.ContainsKey([int]$process.ProcessId) -and $descendants.ContainsKey([int]$process.ParentProcessId)) {
                $descendants[[int]$process.ProcessId] = [int]$descendants[[int]$process.ParentProcessId] + 1
                $added = $true
            }
        }
    } while ($added)
    $result = New-Object 'System.Collections.Generic.List[object]'
    foreach ($process in $all) {
        if (-not $descendants.ContainsKey([int]$process.ProcessId)) { continue }
        if (-not $process.ExecutablePath -or -not (Test-InRoot $process.ExecutablePath $script:AppRoot)) {
            $script:Warnings.Add("Antigravity descendant PID $($process.ProcessId) is outside the installed App directory or cannot be inspected; preserved.")
            continue
        }
        $null = Assert-PlainPath $process.ExecutablePath $script:AppRoot
        $result.Add([pscustomobject]@{
            ProcessId = [int]$process.ProcessId; Role = 'Antigravity'; ExecutablePath = $process.ExecutablePath
            CreatedUtc = $process.CreationDate.ToUniversalTime().ToString('o'); Depth = $descendants[[int]$process.ProcessId]
        })
    }
    return @($result.ToArray() | Sort-Object Depth -Descending)
}

function Stop-VerifiedTarget($Target) {
    if($Target.Role -notin @('Launcher','Main','Mitm')){throw 'Only verified router helper roles may be force-stopped. Close Antigravity normally.'}
    # Recheck immediately before stopping: stale/reused PIDs are never sufficient.
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($Target.ProcessId)" -ErrorAction SilentlyContinue
    if (-not $current) { $script:Actions.Add([pscustomobject]@{ Action = 'StopProcess'; ProcessId = $Target.ProcessId; Role = $Target.Role; Status = 'AlreadyStopped' }); return }
    if ($current.ExecutablePath -ine $Target.ExecutablePath -or $current.CreationDate.ToUniversalTime().ToString('o') -ne $Target.CreatedUtc) {
        throw "PID $($Target.ProcessId) changed identity; refused to stop it."
    }
    if (-not (Get-VerifiedRouterProcess $Target.ProcessId $Target.Role)) {
        throw "PID $($Target.ProcessId) failed the second ownership check."
    }
    # No taskkill /T or blanket node termination: only this validated PID.
    Stop-Process -Id $Target.ProcessId -Force -ErrorAction Stop
    $script:Actions.Add([pscustomobject]@{ Action = 'StopProcess'; ProcessId = $Target.ProcessId; Role = $Target.Role; Status = 'Stopped' })
}

function Write-NewBytes([string]$Path, [byte[]]$Bytes, [string]$Root) {
    $safePath = Assert-PlainPath $Path $Root
    $stream = [IO.File]::Open($safePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($Bytes, 0, $Bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}

function Apply-HostsChange($Change, [string]$BackupPath) {
    if ((Get-Sha256 $Change.AfterBytes) -eq $Change.BeforeHash) { return }
    $null = Assert-PlainPath $BackupPath $script:MitmRoot
    # The open handle prevents another writer between the comparison and update.
    $stream = [IO.File]::Open($script:HostsPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
    try {
        $actual = New-Object byte[] $stream.Length
        $read = $stream.Read($actual, 0, $actual.Length)
        if ($read -ne $actual.Length -or (Get-Sha256 $actual) -ne $Change.BeforeHash) { throw 'Hosts changed after preview; rerun the tool.' }
        Write-NewBytes $BackupPath $actual $script:MitmRoot
        try {
            $stream.Position = 0; $stream.Write($Change.AfterBytes, 0, $Change.AfterBytes.Length)
            $stream.SetLength($Change.AfterBytes.Length); $stream.Flush($true)
        } catch {
            $stream.Position = 0; $stream.Write($actual, 0, $actual.Length)
            $stream.SetLength($actual.Length); $stream.Flush($true)
            throw
        }
    } finally { $stream.Dispose() }
    $script:Actions.Add([pscustomobject]@{ Action = 'UpdateOwnedHosts'; Removed = $Change.Removed; BackupPath = $BackupPath; Status = 'Restored' })
}

function Initialize-ProcessTokenInspector {
    if ('ByokRestore.ProcessTokenInspector' -as [type]) { return }
    # Query-only Win32 calls: no token duplication, process creation, or UI input.
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace ByokRestore {
    public static class ProcessTokenInspector {
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
        [DllImport("advapi32.dll", SetLastError=true)]
        private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError=true)]
        private static extern bool GetTokenInformation(IntPtr token, int infoClass, IntPtr data, int length, out int needed);
        [DllImport("advapi32.dll")] private static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
        [DllImport("advapi32.dll")] private static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        public static uint WindowProcessId(IntPtr hwnd) {
            uint pid; GetWindowThreadProcessId(hwnd, out pid); return pid;
        }
        public static bool TryRead(uint pid, out bool elevated, out int integrity) {
            elevated=true; integrity=Int32.MaxValue;
            IntPtr process=IntPtr.Zero, token=IntPtr.Zero, buffer=IntPtr.Zero;
            try {
                process=OpenProcess(0x1000, false, pid);
                if (process==IntPtr.Zero || !OpenProcessToken(process, 0x0008, out token)) return false;
                int needed;
                buffer=Marshal.AllocHGlobal(4);
                if (!GetTokenInformation(token, 20, buffer, 4, out needed)) return false;
                elevated=Marshal.ReadInt32(buffer)!=0;
                Marshal.FreeHGlobal(buffer); buffer=IntPtr.Zero;
                GetTokenInformation(token, 25, IntPtr.Zero, 0, out needed);
                if (needed<=0 || needed>65536) return false;
                buffer=Marshal.AllocHGlobal(needed);
                if (!GetTokenInformation(token, 25, buffer, needed, out needed)) return false;
                IntPtr sid=Marshal.ReadIntPtr(buffer);
                byte count=Marshal.ReadByte(GetSidSubAuthorityCount(sid));
                if (count==0) return false;
                integrity=Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count-1)));
                return true;
            } catch { return false; }
            finally {
                if (buffer!=IntPtr.Zero) Marshal.FreeHGlobal(buffer);
                if (token!=IntPtr.Zero) CloseHandle(token);
                if (process!=IntPtr.Zero) CloseHandle(process);
            }
        }
    }
}
'@
}

function Test-StandardUserProcess($Process) {
    if (-not $Process -or [int]$Process.SessionId -ne [Diagnostics.Process]::GetCurrentProcess().SessionId) { return $false }
    $owner = Invoke-CimMethod -InputObject $Process -MethodName GetOwnerSid -ErrorAction Stop
    if ($owner.ReturnValue -ne 0 -or $owner.Sid -ne $identity.User.Value) { return $false }
    $elevated = $true; $integrity = [int]::MaxValue
    $read = [ByokRestore.ProcessTokenInspector]::TryRead([uint32]$Process.ProcessId, [ref]$elevated, [ref]$integrity)
    return $read -and -not $elevated -and $integrity -ge 0x2000 -and $integrity -lt 0x3000
}

function Start-StandardUserAntigravity {
    $failure = [ordered]@{ Action='RestartAntigravity'; Status='NeedsManualAppLaunch'; ExecutablePath=$script:AppExe }
    if (-not (Test-Path -LiteralPath $script:AppExe -PathType Leaf)) {
        $failure.Reason = 'Installed Antigravity executable was not found.'; return [pscustomobject]$failure
    }
    $shell = $null; $windows = $null; $desktop = $null; $desktopApplication = $null
    try {
        Initialize-ProcessTokenInspector
        $null = Assert-PlainPath $script:AppExe $script:AppRoot
        $shell = New-Object -ComObject Shell.Application
        $windows = $shell.Windows()
        $desktopHwnd = 0
        # SWC_DESKTOP=8, SWFO_NEEDDISPATCH=1. Use the existing desktop Explorer
        # dispatch, not Shell.Application.ShellExecute from this elevated process.
        $desktop = $windows.FindWindowSW(0, 0, 8, [ref]$desktopHwnd, 1)
        if (-not $desktop -or $desktopHwnd -eq 0) { throw 'No existing desktop shell dispatch.' }
        $explorerId = [ByokRestore.ProcessTokenInspector]::WindowProcessId([IntPtr]$desktopHwnd)
        $explorer = Get-CimInstance Win32_Process -Filter "ProcessId=$explorerId" -ErrorAction Stop
        $expectedExplorer = Assert-PlainPath (Join-Path $env:SystemRoot 'explorer.exe') $env:SystemRoot
        if (-not $explorer -or $explorer.ExecutablePath -ine $expectedExplorer -or -not (Test-StandardUserProcess $explorer)) {
            throw 'Desktop shell is not a verified same-user non-elevated Explorer.'
        }
        $desktopApplication = $desktop.Document.Application
        $launchedAfter = (Get-Date).ToUniversalTime().AddSeconds(-1)
        # Only launches the program. This does not automate any application UI.
        # Show=1 is the user's desktop App; background helpers still start hidden.
        $desktopApplication.ShellExecute($script:AppExe, '', $script:AppRoot, 'open', 1)
        for ($attempt=0; $attempt -lt 10; $attempt++) {
            if ($attempt -gt 0) { Start-Sleep -Milliseconds 250 }
            $apps = @(Get-CimInstance Win32_Process -Filter "Name='Antigravity.exe'" -ErrorAction Stop |
                Where-Object { $_.ExecutablePath -ieq $script:AppExe -and $_.CreationDate.ToUniversalTime() -ge $launchedAfter })
            foreach ($app in $apps) {
                if (Test-StandardUserProcess $app) {
                    return [pscustomobject]@{ Action='RestartAntigravity'; Status='Started'; ExecutablePath=$script:AppExe; ProcessId=[int]$app.ProcessId; ExplorerProcessId=[int]$explorerId; Elevated=$false }
                }
            }
        }
        $failure.Reason = 'Explorer accepted the launch, but a new non-elevated App process was not verified; open Antigravity manually.'
    } catch {
        $failure.Reason = 'A safe same-user non-elevated desktop shell launch could not be verified; open Antigravity manually.'
    } finally {
        foreach ($comObject in @($desktopApplication,$desktop,$windows,$shell)) {
            if ($null -ne $comObject -and [Runtime.InteropServices.Marshal]::IsComObject($comObject)) {
                try { $null = [Runtime.InteropServices.Marshal]::ReleaseComObject($comObject) } catch { }
            }
        }
    }
    return [pscustomobject]$failure
}

function Enter-ByokSwitchLock {
    $lockName='Local\9Router-Antigravity-ByokSwitch-'+[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $switchLock=New-Object Threading.Mutex($false,$lockName)
    $acquired=$false
    try { $acquired=$switchLock.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $acquired=$true }
    if(-not $acquired){$switchLock.Dispose();throw 'Another BYOK switch is still running; wait for it to finish.'}
    $script:ByokSwitchLock=$switchLock
}

function Exit-ByokSwitchLock {
    $lockVariable=Get-Variable -Name ByokSwitchLock -Scope Script -ErrorAction SilentlyContinue
    if($lockVariable -and $lockVariable.Value){
        $lockVariable.Value.ReleaseMutex(); $lockVariable.Value.Dispose(); $script:ByokSwitchLock=$null
    }
}

function Read-ControlReceipt {
    $path = Assert-PlainPath (Join-Path $script:ToolsRoot 'owned-state.json') $script:ToolsRoot
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    $receipt = [IO.File]::ReadAllText($path) | ConvertFrom-Json
    if ($receipt.installationId -ne $script:Config.installationId) { throw 'An unknown control receipt exists; it was not overwritten.' }
    return $receipt
}

function Get-OwnedRouterTargets {
    $targets = @()
    $legacy = @(Get-RecordedRouterProcesses)
    if($legacy.Count -gt 0){
        # Legacy 9Router PID files have no creation time. Require the configured
        # data directory's local authentication to succeed before adopting them.
        # A stale PID alone cannot claim another profile's router instance.
        try{$null=Invoke-ByokManager 'status';$targets=$legacy}catch{}
    }
    $receipt = Read-ControlReceipt
    if ($receipt) {
        foreach ($target in @($receipt.main,$receipt.mitm)) {
            if (-not $target) { continue }
            $live = Get-VerifiedRouterProcess $target.ProcessId $target.Role
            if ($live -and $live.CreatedUtc -eq $target.CreatedUtc -and @($targets | Where-Object ProcessId -eq $live.ProcessId).Count -eq 0) { $targets += $live }
        }
    }
    return $targets
}

function Save-ControlReceipt($Main,$Mitm,[string]$PolicyHash,[string]$OutsideHash) {
    $null = Read-ControlReceipt
    $path = Assert-PlainPath (Join-Path $script:ToolsRoot 'owned-state.json') $script:ToolsRoot
    $value = @{installationId=$script:Config.installationId; main=$Main; mitm=$Mitm; policySha256=$PolicyHash; outsideHostsHash=$OutsideHash}
    [IO.File]::WriteAllText($path,($value | ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
}

function Set-ControlHosts([string]$OutsideHash) {
    if ((Get-NonBridgeHostsHash) -ne $OutsideHash) { throw 'Unrelated hosts content changed during startup; refusing to rewrite it.' }
    $change = Get-HostsChange
    # A freshly started, verified 9Router may restore its own two legacy DNS
    # rows. Adopt only exact single-host rows; reject aliases/custom comments.
    $text = [IO.File]::ReadAllText($script:HostsPath,(New-Object Text.UTF8Encoding($false,$true)))
    foreach ($line in [IO.File]::ReadAllLines($script:HostsPath)) {
        if ($line -notmatch '^\s*#' -and $line -match '(?i)(?<![\w.-])(?:daily-cloudcode-pa|cloudcode-pa)\.googleapis\.com(?![\w.-])') {
            if ($line -notmatch '^\s*127\.0\.0\.1\s+(?:daily-cloudcode-pa|cloudcode-pa)\.googleapis\.com\s*$' -and $line -notmatch ('#\s*9router-antigravity-byok:'+[regex]::Escape($script:Config.installationId)+'\s*$')) { throw 'A custom bridge-domain hosts row was preserved; setup requires manual review.' }
        }
    }
    $kept = [regex]::Replace($text,'(?im)^\s*127\.0\.0\.1[ \t]+(?:daily-cloudcode-pa|cloudcode-pa)\.googleapis\.com(?:[ \t]+#[ \t]*9router-antigravity-byok:[A-Za-z0-9-]+)?[ \t]*(?:\r\n|\r|\n|$)','')
    if ($kept.Length -gt 0 -and -not $kept.EndsWith("`n") -and -not $kept.EndsWith("`r")) { $kept += "`r`n" }
    foreach ($domain in $script:Domains) { $kept += "127.0.0.1 $domain # 9router-antigravity-byok:$($script:Config.installationId)`r`n" }
    # Preserve the original BOM/encoding for existing non-ASCII hosts files.
    $reader = New-Object IO.StreamReader($script:HostsPath,$true)
    try { $null=$reader.ReadToEnd(); $encoding=$reader.CurrentEncoding } finally { $reader.Dispose() }
    $oldBytes=[IO.File]::ReadAllBytes($script:HostsPath)
    $preamble=$encoding.GetPreamble()
    $hasBom=$oldBytes.Length -ge $preamble.Length -and $preamble.Length -gt 0
    for($i=0;$hasBom -and $i -lt $preamble.Length;$i++){if($oldBytes[$i] -ne $preamble[$i]){$hasBom=$false}}
    $prefix=if($hasBom){$preamble}else{[byte[]]@()}
    $change.AfterBytes=[byte[]]($prefix+$encoding.GetBytes($kept))
    $backup=Join-Path $script:MitmRoot ('hosts.before-enable-'+[guid]::NewGuid().ToString('N')+'.bak')
    Apply-HostsChange $change $backup
}

function Start-ControlMain {
    $server = Assert-PlainPath (Join-Path $script:Config.installRoot 'app\custom-server.js') $script:Config.installRoot
    $policy = Join-Path $script:MitmRoot 'antigravity-byok.json'
    $environment = @{NODE_ENV='production';HOSTNAME='127.0.0.1';PORT=[string]$script:Config.gatewayPort;DATA_DIR=$script:DataRoot;ANTIGRAVITY_BYOK_CONFIG=$policy;ANTIGRAVITY_AUDIT_ONLY='0';MITM_BIND_HOST='127.0.0.1';MITM_SKIP_KILL_PORT='1'}
    $saved=@{}
    try {
        foreach($name in $environment.Keys){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process');[Environment]::SetEnvironmentVariable($name,$environment[$name],'Process')}
        if(-not(Test-Path -LiteralPath $script:ReportsRoot)){$null=New-Item -ItemType Directory -Path $script:ReportsRoot}
        $run=[guid]::NewGuid().ToString('N')
        $process=Start-Process -FilePath $script:Config.nodePath -ArgumentList @('--max-old-space-size=6144',('"'+$server+'"')) -WorkingDirectory (Split-Path -Parent $server) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $script:ReportsRoot "router-$run.out.log") -RedirectStandardError (Join-Path $script:ReportsRoot "router-$run.err.log") -PassThru
    } finally {foreach($name in $saved.Keys){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}}
    $target=Get-VerifiedRouterProcess $process.Id 'Main'
    if(-not $target){throw 'The started router identity could not be verified.'}
    # Record immediately, before readiness can fail. Restore can recover a
    # partially started server without overwriting 9Router's launcher.pid.
    Save-ControlReceipt $target $null (Get-Sha256 ([IO.File]::ReadAllBytes($policy))) (Get-NonBridgeHostsHash)
    return $target
}

function Restart-ControlApp {
    $targets=@(Get-AppRestartProcesses)
    $roots=@($targets|Where-Object{$_.ExecutablePath -ieq $script:AppExe -and $_.Depth -eq 0})
    foreach($target in $roots){
        $live=Get-CimInstance Win32_Process -Filter "ProcessId=$($target.ProcessId)" -ErrorAction Stop
        if(-not $live){continue}
        if($live.ExecutablePath -ine $target.ExecutablePath -or $live.CreationDate.ToUniversalTime().ToString('o') -ne $target.CreatedUtc){throw 'An App PID changed identity; no close request was sent.'}
        $process=Get-Process -Id $target.ProcessId -ErrorAction Stop
        if($process.MainWindowHandle -ne [IntPtr]::Zero){$null=$process.CloseMainWindow()}
    }
    $deadline=[DateTime]::UtcNow.AddSeconds(12)
    do{
        $remaining=@()
        foreach($target in $targets){$live=Get-CimInstance Win32_Process -Filter "ProcessId=$($target.ProcessId)" -ErrorAction Stop;if($live -and $live.CreationDate.ToUniversalTime().ToString('o') -eq $target.CreatedUtc){$remaining+=$target.ProcessId}}
        if($remaining.Count -eq 0){return Start-StandardUserAntigravity}
        Start-Sleep -Milliseconds 300
    }while([DateTime]::UtcNow -lt $deadline)
    return [pscustomobject]@{Action='RestartAntigravity';Status='NeedsManualAppRestart';Reason='Save your work, finish running tasks, close Antigravity normally, and open it again. No App process was force-terminated.'}
}

function Test-ControlActive([switch]$RequireReceipt) {
    $checks=[ordered]@{Policy=$false;Hosts=$false;Loopback=$false;Processes=$false;RuntimeBundle=$false;Health=$false;UnrelatedHosts=$false}
    if($RequireReceipt){$checks.Receipt=$false}
    try {
        $manifest=Test-InstalledBundle
        $policyHash=Get-Sha256 ([IO.File]::ReadAllBytes($script:Config.profilePath))
        $active=Join-Path $script:MitmRoot 'antigravity-byok.json'
        $checks.Policy=(Test-Path -LiteralPath $active -PathType Leaf) -and (Get-Sha256 ([IO.File]::ReadAllBytes($active))) -eq $policyHash
        $hosts=Get-HostsChange
        $checks.Hosts=@($hosts.Removed|Select-Object -ExpandProperty Host -Unique).Count -eq 2 -and $hosts.PreservedTargetLines.Count -eq 0
        $listeners=@(Get-ControlPortListeners)
        $mains=@($listeners|Where-Object LocalPort -eq $script:Config.gatewayPort);$mitms=@($listeners|Where-Object LocalPort -eq 443)
        $checks.Loopback=$mains.Count -eq 1 -and $mitms.Count -eq 1 -and @($listeners|Where-Object LocalAddress -ne '127.0.0.1').Count -eq 0
        if($checks.Loopback){
            $main=Get-VerifiedRouterProcess $mains[0].ProcessId 'Main';$mitm=Get-VerifiedRouterProcess $mitms[0].ProcessId 'Mitm'
            $checks.Processes=[bool]$main -and [bool]$mitm
            if($mitm){$checks.RuntimeBundle=(Get-Sha256 ([IO.File]::ReadAllBytes($mitm.EntryFile))) -ieq $manifest.files.'app/src/mitm/server.js'}
            $health=Invoke-ByokManager 'health'
            $checks.Health=$health.ok -eq $true -and $health.byok -eq $true -and $health.feature -eq 'antigravity-byok-v1' -and $health.pid -eq $mitms[0].ProcessId
            $receipt=Read-ControlReceipt
            if($receipt){
                $checks.UnrelatedHosts=(Get-NonBridgeHostsHash) -eq $receipt.outsideHostsHash
                if($RequireReceipt){$checks.Receipt=$receipt.policySha256 -eq $policyHash -and $main.CreatedUtc -eq $receipt.main.CreatedUtc -and $main.ProcessId -eq $receipt.main.ProcessId -and $mitm.CreatedUtc -eq $receipt.mitm.CreatedUtc -and $mitm.ProcessId -eq $receipt.mitm.ProcessId}
            }
        }
    }catch{}
    return [pscustomobject]@{Passed=(@($checks.Values|Where-Object{$_ -ne $true}).Count -eq 0);Checks=[pscustomobject]$checks}
}

Export-ModuleMember -Function *
