#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess=$true)]
param([string]$SettingsPath=(Join-Path $PSScriptRoot 'control-settings.json'),[switch]$Apply,[switch]$DryRun,[string]$ExpectedUserSid,[string]$ResultPath)
$execute=[bool]$Apply -and -not $DryRun -and -not $WhatIfPreference
$WhatIfPreference=$false
Import-Module (Join-Path $PSScriptRoot 'AntigravityByok.Common.psm1') -Force -DisableNameChecking
$ErrorActionPreference='Stop'
$result=[ordered]@{Tool='Antigravity BYOK Restore';Status='Failed';Mode=$(if($execute){'Apply'}else{'Preview'});TimeUtc=[DateTime]::UtcNow.ToString('o')}
try{
    $config=Initialize-ByokControl $SettingsPath;$paths=Get-ControlPaths
    if(-not $ResultPath){$ResultPath=Join-Path $paths.ReportsRoot ('restore-'+[guid]::NewGuid().ToString('N')+'.json')}
    $ResultPath=Assert-PlainPath $ResultPath $paths.ReportsRoot
    if($execute){Invoke-ControlElevation $PSCommandPath $ResultPath $ExpectedUserSid;Enter-ByokSwitchLock}
    $targets=@(Get-OwnedRouterTargets);$hosts=Get-HostsChange;$receipt=Read-ControlReceipt
    $active=Assert-PlainPath (Join-Path $paths.MitmRoot 'antigravity-byok.json') $paths.MitmRoot
    $disable=$false
    if(Test-Path -LiteralPath $active){
        $hash=Get-Sha256 ([IO.File]::ReadAllBytes($active))
        if($receipt -and ($hash -eq $receipt.policySha256 -or $hash -eq (Get-Sha256 ([IO.File]::ReadAllBytes($config.profilePath))))){$disable=$true}
        else{throw 'The active policy is not recorded as owned; it was not moved.'}
    }
    $result.Plan=@{Processes=$targets;OwnedHostsEntries=$hosts.Removed;DisableOwnedProfile=$disable;RestartApp=$config.appPath}
    if(-not $execute){$result.Status='PreviewOnly'}else{
        $outside=Get-NonBridgeHostsHash
        if($disable){$backup=Assert-PlainPath (Join-Path $paths.MitmRoot ('antigravity-byok.json.disabled-'+[guid]::NewGuid().ToString('N'))) $paths.MitmRoot;Move-Item -LiteralPath $active -Destination $backup;Add-ControlAction @{Action='DisableOwnedProfile';BackupPath=$backup}}
        Apply-HostsChange $hosts (Join-Path $paths.MitmRoot ('hosts.before-restore-'+[guid]::NewGuid().ToString('N')+'.bak'))
        foreach($role in @('Launcher','Main','Mitm')){foreach($target in @($targets|Where-Object Role -eq $role)){Stop-VerifiedTarget $target}}
        $flush=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\ipconfig.exe') -ArgumentList '/flushdns' -WindowStyle Hidden -Wait -PassThru
        if($flush.ExitCode -ne 0){throw 'DNS flush failed.'}
        $remaining=@();foreach($target in $targets){$p=Get-CimInstance Win32_Process -Filter "ProcessId=$($target.ProcessId)";if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq $target.CreatedUtc){$remaining+=$target.ProcessId}}
        $current=Get-HostsChange;$listeners=@(Get-ControlPortListeners)
        $verified=-not(Test-Path -LiteralPath $active) -and $current.Removed.Count -eq 0 -and $current.PreservedTargetLines.Count -eq 0 -and $remaining.Count -eq 0 -and @($listeners|Where-Object{$_.ProcessId -in @($targets|ForEach-Object ProcessId)}).Count -eq 0 -and (Get-NonBridgeHostsHash) -eq $outside
        $result.Verification=@{Passed=$verified;ConfigInactive=(-not(Test-Path -LiteralPath $active));OwnedHostsRemaining=$current.Removed.Count;RemainingOriginalProcesses=$remaining;NonBridgeHostsPreserved=((Get-NonBridgeHostsHash) -eq $outside)}
        if(-not $verified){throw 'Independent restore checks failed.'}
        $app=Restart-ControlApp;Add-ControlAction $app
        $result.Status=if($app.Status -eq 'Started'){'Restored'}else{$app.Status}
    }
}catch{$result.Status=if($execute){'Partial'}else{'Failed'};$result.Error=$_.Exception.Message}
finally{Exit-ByokSwitchLock}
$result.Actions=@(Get-ControlActions);$result.ResultPath=$ResultPath
if($execute -and $ResultPath){Save-ControlReport $result $ResultPath}
$result|ConvertTo-Json -Depth 8
if($result.Status -notin @('Restored','PreviewOnly')){exit 1}
