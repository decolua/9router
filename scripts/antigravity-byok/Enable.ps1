#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess=$true)]
param([string]$SettingsPath=(Join-Path $PSScriptRoot 'control-settings.json'),[switch]$Apply,[switch]$DryRun,[string]$ExpectedUserSid,[string]$ResultPath)
$execute=[bool]$Apply -and -not $DryRun -and -not $WhatIfPreference
$WhatIfPreference=$false
Import-Module (Join-Path $PSScriptRoot 'AntigravityByok.Common.psm1') -Force -DisableNameChecking
$ErrorActionPreference='Stop'
$result=[ordered]@{Tool='Antigravity BYOK Enable';Status='Failed';Mode=$(if($execute){'Apply'}else{'Preview'});TimeUtc=[DateTime]::UtcNow.ToString('o')}
try {
    $config=Initialize-ByokControl $SettingsPath;$paths=Get-ControlPaths
    if(-not $ResultPath){$ResultPath=Join-Path $paths.ReportsRoot ('enable-'+[guid]::NewGuid().ToString('N')+'.json')}
    $ResultPath=Assert-PlainPath $ResultPath $paths.ReportsRoot
    $manifest=Test-InstalledBundle;$profile=Read-ByokProfile $config.profilePath
    if($execute){Invoke-ControlElevation $PSCommandPath $ResultPath $ExpectedUserSid;Enter-ByokSwitchLock}
    $targets=@(Get-OwnedRouterTargets);$listeners=@(Get-ControlPortListeners)
    foreach($listener in $listeners){if(@($targets|Where-Object ProcessId -eq $listener.ProcessId).Count -eq 0){throw 'A control port is occupied by an unowned process. No process was stopped.'}}
    $receipt=Read-ControlReceipt;$hosts=Get-HostsChange
    if($hosts.PreservedTargetLines.Count -gt 0){throw 'Existing unowned bridge-domain hosts entries were preserved. Resolve them before enabling.'}
    $active=Assert-PlainPath (Join-Path $paths.MitmRoot 'antigravity-byok.json') $paths.MitmRoot
    $bytes=[IO.File]::ReadAllBytes($config.profilePath);$policyHash=Get-Sha256 $bytes
    if(Test-Path -LiteralPath $active){$existingHash=Get-Sha256 ([IO.File]::ReadAllBytes($active));if($existingHash -ne $policyHash -and (-not $receipt -or $existingHash -ne $receipt.policySha256)){throw 'An existing policy is not owned by this installation; no process was stopped.'}}
    $result.Plan=@{Profile=$config.profilePath;ModelCount=@($profile.mappings.PSObject.Properties).Count;GatewayPort=$config.gatewayPort;AppPath=$config.appPath;Processes=$targets;ExistingListeners=$listeners}
    if(-not $execute){$result.Status='PreviewOnly'}else{
        $state=Test-ControlActive -RequireReceipt
        if($state.Passed){$result.Status='AlreadyEnabled';$result.Verification=$state}else{
            # Read-only preflight happens before starting 9Router, whose native
            # startup may restore saved DNS settings. Never touch another bridge.
            $null=Invoke-ByokManager 'inspect'
            Assert-ControlCertificateTrusted
            $outside=Get-NonBridgeHostsHash
            foreach($role in @('Launcher','Main','Mitm')){foreach($target in @($targets|Where-Object Role -eq $role)){Stop-VerifiedTarget $target}}
            if(@(Get-ControlPortListeners).Count -gt 0){throw 'A control port remains occupied.'}
            if(-not(Test-Path -LiteralPath $paths.MitmRoot)){$null=New-Item -ItemType Directory -Path $paths.MitmRoot}
            $active=Assert-PlainPath (Join-Path $paths.MitmRoot 'antigravity-byok.json') $paths.MitmRoot
            $bytes=[IO.File]::ReadAllBytes($config.profilePath);$policyHash=Get-Sha256 $bytes
            if(Test-Path -LiteralPath $active){
                $existingHash=Get-Sha256 ([IO.File]::ReadAllBytes($active))
                if($existingHash -ne $policyHash -and (-not $receipt -or $existingHash -ne $receipt.policySha256)){throw 'An existing policy is not owned by this installation; it was not overwritten.'}
                if($existingHash -ne $policyHash){Write-NewBytes (Join-Path $paths.MitmRoot ('antigravity-byok.json.before-enable-'+[guid]::NewGuid().ToString('N'))) ([IO.File]::ReadAllBytes($active)) $paths.MitmRoot}
            }
            Save-ControlReceipt $null $null $policyHash $outside
            [IO.File]::WriteAllBytes($active,$bytes)
            Add-ControlAction @{Action='ActivateProfile';Status='Written'}
            $main=Start-ControlMain
            $deadline=[DateTime]::UtcNow.AddSeconds(30);$ready=$false
            while([DateTime]::UtcNow -lt $deadline){try{$status=Invoke-ByokManager 'status';if($status.isAdmin){$ready=$true;break}}catch{};Start-Sleep -Milliseconds 400}
            if(-not $ready){throw 'The local router did not become ready.'}
            foreach($listener in @(Get-ControlPortListeners|Where-Object LocalPort -eq 443)){
                $mitm=Get-VerifiedRouterProcess $listener.ProcessId 'Mitm'
                if(-not $mitm -or (Get-Sha256 ([IO.File]::ReadAllBytes($mitm.EntryFile))) -ine $manifest.files.'app/src/mitm/server.js'){throw 'An unexpected bridge listener was preserved.'}
            }
            $null=Invoke-ByokManager 'start'
            Set-ControlHosts $outside
            $flush=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\ipconfig.exe') -ArgumentList '/flushdns' -WindowStyle Hidden -Wait -PassThru
            if($flush.ExitCode -ne 0){throw 'DNS flush failed.'}
            $mitmListener=@(Get-ControlPortListeners|Where-Object LocalPort -eq 443)
            if($mitmListener.Count -ne 1){throw 'Expected one bridge listener.'}
            $mitm=Get-VerifiedRouterProcess $mitmListener[0].ProcessId 'Mitm'
            Save-ControlReceipt $main $mitm $policyHash $outside
            $state=Test-ControlActive -RequireReceipt
            if(-not $state.Passed){$result.Verification=$state;throw 'Independent bridge readiness checks failed.'}
            $app=Restart-ControlApp;Add-ControlAction $app
            $result.Verification=Test-ControlActive -RequireReceipt
            if(-not $result.Verification.Passed){throw 'Bridge verification failed after App restart.'}
            $result.Status=if($app.Status -eq 'Started'){'Enabled'}else{$app.Status}
        }
    }
}catch{$result.Status=if($execute){'Partial'}else{'Failed'};$result.Error=$_.Exception.Message}
finally{Exit-ByokSwitchLock}
$result.Actions=@(Get-ControlActions);$result.ResultPath=$ResultPath
if($execute -and $ResultPath){Save-ControlReport $result $ResultPath}
$result|ConvertTo-Json -Depth 8
if($result.Status -notin @('Enabled','AlreadyEnabled','PreviewOnly')){exit 1}
