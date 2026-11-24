#Requires -Version 5.1
# Fixture-only installation tests. Never starts a service/App, writes hosts,
# elevates, or creates a desktop shortcut. Temporary fixtures are retained.
$ErrorActionPreference='Stop'
if(-not $env:SystemRoot){Write-Output '{"skipped":"Windows only"}';exit 0}
$sourceRoot=Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $sourceRoot 'AntigravityByok.Common.psm1') -Force -DisableNameChecking
$appForceRejected=$false;try{Stop-VerifiedTarget @{Role='Antigravity'}}catch{$appForceRejected=$_.Exception.Message -match 'Only verified router helper roles'}
if(-not $appForceRejected){throw 'The App force-stop guard did not reject the request.'}
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('9router-byok-helper-test-'+[guid]::NewGuid().ToString('N'))
$install=Join-Path $fixture 'package';$data=Join-Path $fixture 'data';$control=Join-Path $fixture 'control'
$null=New-Item -ItemType Directory -Path (Join-Path $install 'app\src\mitm')
$null=New-Item -ItemType Directory -Path (Join-Path $install 'app\.next-cli-build\server\chunks')
$null=New-Item -ItemType Directory -Path $data
$utf8=New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $install 'package.json'),'{"name":"9router","version":"1.2.3"}',$utf8)
[IO.File]::WriteAllText((Join-Path $install 'app\src\mitm\server.js'),'/* fixture antigravity-byok-v1 */',$utf8)
[IO.File]::WriteAllBytes((Join-Path $install 'app\src\mitm\antigravityByok.js'),[IO.File]::ReadAllBytes((Join-Path $sourceRoot '..\..\src\mitm\antigravityByok.js')))
[IO.File]::WriteAllText((Join-Path $install 'app\custom-server.js'),'/* fixture: never executed */',$utf8)
[IO.File]::WriteAllText((Join-Path $install 'app\.next-cli-build\server\chunks\fixture.js'),'/* fixture */',$utf8)
$app=Join-Path $fixture 'Antigravity.exe';[IO.File]::WriteAllText($app,'not executable: fixture only',$utf8)
$profile=Join-Path $fixture 'profile.json'
[IO.File]::WriteAllText($profile,'{"enabled":true,"mappings":{"user-slot":{"target":"user-provider/example-model","label":"My model (BYOK)"}}}',$utf8)
$node=(Get-Command node.exe -CommandType Application -ErrorAction Stop|Select-Object -First 1).Path
$engine=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$bootstrap=Join-Path $sourceRoot 'Bootstrap.ps1'
function Invoke-FixtureBootstrap([string]$Destination,[string]$Mode){
    $invoke="`$ProgressPreference='SilentlyContinue'; & '$($bootstrap.Replace("'","''"))' -ProfilePath '$($profile.Replace("'","''"))' -InstallRoot '$($install.Replace("'","''"))' -NodePath '$($node.Replace("'","''"))' -AppPath '$($app.Replace("'","''"))' -DataDir '$($data.Replace("'","''"))' -ControlDir '$($Destination.Replace("'","''"))' -Apply $Mode"
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($invoke))
    return ((& $engine -NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded) -join "`n"|ConvertFrom-Json)
}
$preview=Invoke-FixtureBootstrap $control '-WhatIf'
if($preview.Status -ne 'PreviewOnly' -or (Test-Path -LiteralPath $control)){throw ('Fixture preview failed: '+$preview.Error+' '+$preview.ErrorAt)}
$applied=Invoke-FixtureBootstrap $control ''
if($applied.Status -ne 'Installed'){throw 'Fixture bootstrap failed.'}
$settingsPath=Join-Path $control 'control-settings.json'
$settings=Initialize-ByokControl $settingsPath
$manifest=Test-InstalledBundle
if($manifest.packageVersion -ne '1.2.3' -or $settings.gatewayPort -ne 20128){throw 'Generated manifest/settings did not round-trip.'}
$invalidPolicy=Join-Path $fixture 'invalid-policy.json'
[IO.File]::WriteAllText($invalidPolicy,'{"enabled":true,"mappings":{"user-slot":{"target":"user-provider/example-model","label":"bad\nlabel"}}}',$utf8)
$loaderRejected=$false;try{$null=Read-ByokProfile $invalidPolicy}catch{$loaderRejected=$_.Exception.Message -eq 'The routing profile was rejected by the shared BYOK policy loader.'}
if(-not $loaderRejected){throw 'The installed JS policy loader did not reject the invalid label.'}
$certRejected=$false;try{Assert-ControlCertificateTrusted}catch{$certRejected=$_.Exception.Message -match 'explicitly in 9Router'}
if(-not $certRejected){throw 'Missing certificate prerequisite did not fail read-only.'}
[IO.File]::AppendAllText((Join-Path $install 'app\custom-server.js'),' changed',$utf8)
$rejected=$false;try{$null=Test-InstalledBundle}catch{$rejected=$true}
if(-not $rejected){throw 'Changed build artifact was not rejected.'}
$unknown=Join-Path $fixture 'unknown-control';$null=New-Item -ItemType Directory -Path $unknown
$sentinel=Join-Path $unknown 'keep.txt';[IO.File]::WriteAllText($sentinel,'leave unchanged',$utf8)
$denied=Invoke-FixtureBootstrap $unknown ''
if($denied.Status -ne 'Failed' -or [IO.File]::ReadAllText($sentinel) -ne 'leave unchanged'){throw 'Unknown installation was modified.'}
$secretProfile=Join-Path $fixture 'secret-profile.json'
[IO.File]::WriteAllText($secretProfile,'{"enabled":true,"apiKey":"synthetic-sensitive","mappings":{}}',$utf8)
$secretRejected=$false;try{$null=Read-ByokProfile $secretProfile}catch{$secretRejected=$_.Exception.Message -notmatch 'synthetic-sensitive'}
if(-not $secretRejected){throw 'Credential profile was not rejected safely.'}
@{Passed=$true;Fixture=$fixture;ServicesStarted=$false;HostsWritten=$false;DesktopWritten=$false;Cases=@('app-force-stop-refused','preview-is-inert','fixture-install','dynamic-manifest','shared-validator-rejects-invalid-label','certificate-prerequisite','changed-build-rejected','unknown-directory-preserved','credential-profile-rejected')}|ConvertTo-Json -Depth 3
