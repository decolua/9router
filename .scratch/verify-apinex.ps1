# Verify APInex (and optional 9Router combo) model IDs.
# Usage:
#   $env:APINEX_KEY = "sk-apx..."
#   .\verify-apinex.ps1
# Optional:
#   $env:ROUTER_BASE = "https://router-uz2an.sevalla.app"
#   $env:NINEROUTER_KEY = "sk-..."
#   $env:COMBO_MODEL = "9r"
#   .\verify-apinex.ps1
#
# Or: copy apinex.env.example -> apinex.env, fill keys, then:
#   Get-Content .\apinex.env | % { if ($_ -match '^([^=]+)=(.*)$') { Set-Item "Env:$($Matches[1])" $Matches[2] } }
#   .\verify-apinex.ps1

$ErrorActionPreference = "Stop"
$apinexKey = $env:APINEX_KEY
if (-not $apinexKey) {
  Write-Error "Set APINEX_KEY first (paste into env or .scratch/apinex.env)."
}

$utf8 = New-Object System.Text.UTF8Encoding $false
$tmp = Join-Path $PSScriptRoot "_verify-body.json"

function Invoke-Chat([string]$Base, [string]$Key, [string]$Model, [string]$Label) {
  $body = @{
    model = $Model
    messages = @(@{ role = "user"; content = "Say hi in 3 words." })
    temperature = 0.4
    max_tokens = 32
    stream = $false
  } | ConvertTo-Json -Compress -Depth 5
  [System.IO.File]::WriteAllText($tmp, $body, $utf8)
  Write-Host ""
  Write-Host "=== $Label  model=$Model ==="
  $out = curl.exe -sS -w "`nHTTP:%{http_code}" "$Base/chat/completions" `
    -H "Authorization: Bearer $Key" `
    -H "Content-Type: application/json" `
    --data-binary "@$tmp"
  if ($out.Length -gt 500) {
    Write-Host ($out.Substring(0, 500) + "...[truncated]")
  } else {
    Write-Host $out
  }
  return $out
}

Write-Host "APInex key set: yes (len=$($apinexKey.Length))"

$cases = @(
  @{ Model = "gpt-5-6-terra";     Expect = "404";    Note = "Cursor hyphen slug - WRONG" },
  @{ Model = "gpt-5.6-terra";     Expect = "402|200"; Note = "paid dots id (needs balance)" },
  @{ Model = "free/gpt-5.6-luna"; Expect = "200";    Note = "free - should work at zero balance" },
  @{ Model = "gpt-5.6-luna";      Expect = "402|200"; Note = "paid luna" }
)

foreach ($c in $cases) {
  $null = Invoke-Chat "https://api.apinex.bond/v1" $apinexKey $c.Model "$($c.Note) [expect $($c.Expect)]"
}

$routerBase = $env:ROUTER_BASE
$routerKey = $env:NINEROUTER_KEY
$combo = if ($env:COMBO_MODEL) { $env:COMBO_MODEL } else { "9r" }

if ($routerBase -and $routerKey) {
  $base = $routerBase.TrimEnd("/")
  if (-not $base.EndsWith("/v1")) { $base = "$base/v1" }
  Write-Host ""
  Write-Host "--- 9Router path ($base) ---"
  $null = Invoke-Chat $base $routerKey $combo "combo name (Cursor custom model)"
  $null = Invoke-Chat $base $routerKey "apinex/free/gpt-5.6-luna" "direct provider/model"
  $null = Invoke-Chat $base $routerKey "gpt-5-6-terra" "Cursor slug via router (expect fail)"
} else {
  Write-Host ""
  Write-Host "(skip 9Router combo checks - set ROUTER_BASE + NINEROUTER_KEY to enable)"
  Write-Host "Cursor: Base URL = Sevalla host /v1 | API key = 9Router key | model = $combo"
}

Remove-Item $tmp -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "Done."
