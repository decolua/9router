#Requires -Version 5.1
<# Installs control shortcuts only. Build/install this fork and configure your
providers in 9Router first. Default is preview; credentials are never copied. #>
[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [Parameter(Mandatory=$true)][string]$ProfilePath,
    [string]$InstallRoot,
    [string]$NodePath,
    [string]$AppPath,
    [string]$DataDir=(Join-Path $env:APPDATA '9router'),
    [string]$ControlDir=(Join-Path $env:LOCALAPPDATA '9router\antigravity-byok'),
    [ValidateRange(1024,65535)][int]$GatewayPort=20128,
    [switch]$CreateShortcuts,
    [switch]$Apply,
    [switch]$DryRun
)
$execute=[bool]$Apply -and -not $DryRun -and -not $WhatIfPreference
$WhatIfPreference=$false
Import-Module (Join-Path $PSScriptRoot 'AntigravityByok.Common.psm1') -Force -DisableNameChecking
$ErrorActionPreference='Stop'
$result=[ordered]@{Tool='Antigravity BYOK Bootstrap';Mode=$(if($execute){'Apply'}else{'Preview'});Status='Failed'}
try{
    if(-not $InstallRoot){$command=Get-Command '9router.cmd' -CommandType Application -ErrorAction SilentlyContinue;if($command){$InstallRoot=Join-Path (Split-Path -Parent $command.Path) 'node_modules\9router'}}
    if(-not $InstallRoot){throw 'Pass -InstallRoot for a built, trusted 9Router CLI package.'}
    $InstallRoot=[IO.Path]::GetFullPath($InstallRoot);$null=Assert-PlainPath $InstallRoot $InstallRoot
    $packagePath=Assert-PlainPath (Join-Path $InstallRoot 'package.json') $InstallRoot
    $package=[IO.File]::ReadAllText($packagePath)|ConvertFrom-Json
    if($package.name -ne '9router' -or [string]$package.version -notmatch '^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$'){throw 'InstallRoot must be the built 9router CLI package, not an unbuilt source checkout.'}
    $bundle=Assert-PlainPath (Join-Path $InstallRoot 'app\src\mitm\server.js') $InstallRoot
    if(-not [IO.File]::ReadAllText($bundle).Contains('antigravity-byok-v1')){throw 'This installed build does not advertise antigravity-byok-v1. Build and install the compatible fork first.'}
    if(-not $NodePath){$command=Get-Command 'node.exe' -CommandType Application -ErrorAction Stop|Select-Object -First 1;$NodePath=$command.Path}
    $NodePath=[IO.Path]::GetFullPath($NodePath);$null=Assert-PlainPath $NodePath (Split-Path -Parent $NodePath)
    if([IO.Path]::GetFileName($NodePath) -ine 'node.exe'){throw 'NodePath must identify node.exe.'}
    $nodeVersion=& $NodePath --version
    if($LASTEXITCODE -ne 0 -or [version]($nodeVersion.Trim().TrimStart('v')) -lt [version]'20.18.1'){throw 'Node 20.18.1 or later is required; current Node 22+ is recommended.'}
    if(-not $AppPath){
        $candidates=@(@((Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'),(Join-Path $env:ProgramFiles 'Antigravity\Antigravity.exe'))|Where-Object{Test-Path -LiteralPath $_ -PathType Leaf})
        if($candidates.Count -ne 1){throw 'Pass -AppPath to select the Antigravity desktop application unambiguously.'};$AppPath=$candidates[0]
    }
    $AppPath=[IO.Path]::GetFullPath($AppPath);$null=Assert-PlainPath $AppPath (Split-Path -Parent $AppPath)
    if([IO.Path]::GetFileName($AppPath) -ine 'Antigravity.exe' -or -not(Test-Path -LiteralPath $AppPath -PathType Leaf)){throw 'AppPath must identify the installed Antigravity.exe desktop application.'}
    $ProfilePath=[IO.Path]::GetFullPath($ProfilePath);$null=Assert-PlainPath $ProfilePath (Split-Path -Parent $ProfilePath)
    $profile=Read-ByokProfile $ProfilePath
    $installedValidator=Assert-PlainPath (Join-Path $InstallRoot 'app\src\mitm\antigravityByok.js') $InstallRoot
    if(-not(Test-Path -LiteralPath $installedValidator -PathType Leaf)){throw 'The installed pure BYOK validator is missing; use the compatible built package.'}
    $validation=& $NodePath (Join-Path $PSScriptRoot 'Validate-Profile.cjs') $ProfilePath $installedValidator 2>$null
    if($LASTEXITCODE -ne 0){throw 'The routing profile was rejected by the shared BYOK policy loader.'}
    $ControlDir=[IO.Path]::GetFullPath($ControlDir);$null=Assert-PlainPath $ControlDir $ControlDir
    $DataDir=[IO.Path]::GetFullPath($DataDir);$null=Assert-PlainPath $DataDir $DataDir
    if($ControlDir.TrimEnd('\') -eq [IO.Path]::GetPathRoot($ControlDir).TrimEnd('\') -or $DataDir.TrimEnd('\') -eq [IO.Path]::GetPathRoot($DataDir).TrimEnd('\')){throw 'ControlDir and DataDir cannot be a volume root.'}
    $files=[ordered]@{}
    foreach($relative in @('package.json','app/custom-server.js','app/src/mitm/server.js','app/src/mitm/antigravityByok.js')){
        $file=Assert-PlainPath (Join-Path $InstallRoot $relative) $InstallRoot
        $files[$relative]=Get-Sha256 ([IO.File]::ReadAllBytes($file))
    }
    $chunks=Join-Path $InstallRoot 'app\.next-cli-build\server\chunks'
    if(-not(Test-Path -LiteralPath $chunks -PathType Container)){throw 'The compiled server chunks are missing; use a complete built CLI package.'}
    foreach($file in @(Get-ChildItem -LiteralPath $chunks -File -Filter '*.js')){
        $null=Assert-PlainPath $file.FullName $InstallRoot
        $relative=$file.FullName.Substring($InstallRoot.TrimEnd('\').Length+1).Replace('\','/')
        $files[$relative]=Get-Sha256 ([IO.File]::ReadAllBytes($file.FullName))
    }
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $settingsPath=Join-Path $ControlDir 'control-settings.json'
    $installationId=[guid]::NewGuid().ToString('N')
    if(Test-Path -LiteralPath $settingsPath){
        $old=[IO.File]::ReadAllText((Assert-PlainPath $settingsPath $ControlDir))|ConvertFrom-Json
        if($old.schemaVersion -ne 1 -or $old.ownerSid -ne $sid){throw 'An unknown control installation exists; choose another ControlDir.'}
        $installationId=$old.installationId
    }elseif((Test-Path -LiteralPath $ControlDir) -and @(Get-ChildItem -LiteralPath $ControlDir -Force).Count -gt 0){throw 'ControlDir is not empty and has no owned installation record; choose another directory.'}
    $settings=[ordered]@{schemaVersion=1;installationId=$installationId;ownerSid=$sid;installRoot=$InstallRoot;nodePath=$NodePath;appPath=$AppPath;dataDir=$DataDir;gatewayPort=$GatewayPort;profilePath=(Join-Path $ControlDir 'profile.json');manifestPath=(Join-Path $ControlDir 'build-manifest.json')}
    $manifest=[ordered]@{schemaVersion=1;packageName='9router';packageVersion=$package.version;feature='antigravity-byok-v1';files=$files}
    $payloads=@{}
    foreach($name in @('AntigravityByok.Common.psm1','Enable.ps1','Restore.ps1','Enable.cmd','Restore.cmd','Manage-Byok.cjs','Validate-Profile.cjs')){$payloads[$name]=[IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $name))}
    $utf8=New-Object Text.UTF8Encoding($false)
    $payloads['profile.json']=$utf8.GetBytes([IO.File]::ReadAllText($ProfilePath))
    $payloads['control-settings.json']=$utf8.GetBytes(($settings|ConvertTo-Json -Depth 5))
    $payloads['build-manifest.json']=$utf8.GetBytes(($manifest|ConvertTo-Json -Depth 5))
    foreach($name in $payloads.Keys){$destination=Assert-PlainPath (Join-Path $ControlDir $name) $ControlDir;if((Test-Path -LiteralPath $destination) -and (Get-Sha256 ([IO.File]::ReadAllBytes($destination))) -ne (Get-Sha256 $payloads[$name])){throw 'An existing control file differs. Choose a new ControlDir; unknown files are never overwritten.'}}
    $shortcutPlans=@()
    if($CreateShortcuts){
        $desktop=[Environment]::GetFolderPath('Desktop');$shell=New-Object -ComObject WScript.Shell
        try{foreach($mode in @('Enable','Restore')){
            $link=Join-Path $desktop ("9Router Antigravity BYOK - $mode.lnk");$target=Join-Path $ControlDir "$mode.cmd";$exists=Test-Path -LiteralPath $link
            if($exists -and $shell.CreateShortcut($link).TargetPath -ine $target){throw 'A desktop shortcut with this name belongs to another target; it was not overwritten.'}
            $shortcutPlans+=@{Path=$link;Target=$target;Exists=$exists}
        }}finally{$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($shell)}
    }
    $result.Plan=@{ControlDir=$ControlDir;InstallRoot=$InstallRoot;PackageVersion=$package.version;NodePath=$NodePath;AppPath=$AppPath;DataDir=$DataDir;GatewayPort=$GatewayPort;ModelCount=@($profile.mappings.PSObject.Properties).Count;CreateShortcuts=[bool]$CreateShortcuts;Files=@($payloads.Keys)}
    if(-not $execute){$result.Status='PreviewOnly'}else{
        if(-not(Test-Path -LiteralPath $ControlDir)){$null=New-Item -ItemType Directory -Path $ControlDir}
        foreach($name in $payloads.Keys){$destination=Assert-PlainPath (Join-Path $ControlDir $name) $ControlDir;if(-not(Test-Path -LiteralPath $destination)){Write-NewBytes $destination $payloads[$name] $ControlDir}}
        if($CreateShortcuts){
            $shell=New-Object -ComObject WScript.Shell
            try{foreach($item in $shortcutPlans){if(-not $item.Exists){$shortcut=$shell.CreateShortcut($item.Path);$shortcut.TargetPath=$item.Target;$shortcut.WorkingDirectory=$ControlDir;$shortcut.WindowStyle=7;$shortcut.Save()}}}finally{$null=[Runtime.InteropServices.Marshal]::ReleaseComObject($shell)}
        }
        $result.Status='Installed';$result.Note='No services were started. Configure your providers in 9Router before using Enable.'
    }
}catch{$result.Error=$_.Exception.Message;$result.ErrorAt=$_.ScriptStackTrace}
$result|ConvertTo-Json -Depth 6
if($result.Status -notin @('Installed','PreviewOnly')){exit 1}
