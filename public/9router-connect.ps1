param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("claude", "codex", "opencode")]
  [string]$Tool,

  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,

  [string]$Model = "",

  [string]$ApiKey = ""
)

$ErrorActionPreference = "Stop"

function Read-SecretText {
  param([string]$Prompt)

  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Backup-ConfigFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
  $backupPath = "$Path.9router-backup-$stamp"
  Copy-Item -LiteralPath $Path -Destination $backupPath
  "Backup: $backupPath"
}

function Read-JsonObject {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return [PSCustomObject]@{}
  }

  $content = [IO.File]::ReadAllText($Path)
  if ([string]::IsNullOrWhiteSpace($content)) {
    return [PSCustomObject]@{}
  }

  try {
    $value = $content | ConvertFrom-Json
  } catch {
    throw "Cannot safely update invalid JSON in ${Path}: $($_.Exception.Message)"
  }

  if ($null -eq $value -or $value -isnot [PSCustomObject]) {
    throw "Expected a JSON object in $Path"
  }
  return $value
}

function Set-ObjectProperty {
  param($Object, [string]$Name, $Value)

  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) {
    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
  } else {
    $property.Value = $Value
  }
}

function Write-JsonObject {
  param([string]$Path, $Value)

  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  $utf8 = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Path, (($Value | ConvertTo-Json -Depth 20) + [Environment]::NewLine), $utf8)
}

$BaseUrl = $BaseUrl.TrimEnd("/")
if (-not $BaseUrl.EndsWith("/v1")) {
  $BaseUrl = "$BaseUrl/v1"
}

$uri = [Uri]$BaseUrl
if ($uri.Scheme -notin @("http", "https")) {
  throw "The 9Router URL must start with http:// or https://"
}
if ($uri.Scheme -eq "http" -and $uri.Host -notin @("localhost", "127.0.0.1", "::1")) {
  $answer = Read-Host "This remote endpoint uses HTTP and may expose your API key. Continue? [y/N]"
  if ($answer -notmatch "^[Yy]$") {
    throw "Cancelled. Configure HTTPS on the remote 9Router server."
  }
}

if ([string]::IsNullOrWhiteSpace($ApiKey)) {
  $ApiKey = Read-SecretText "9Router API key"
}
if ([string]::IsNullOrWhiteSpace($ApiKey)) {
  throw "API key cannot be empty"
}
if ([string]::IsNullOrWhiteSpace($Model)) {
  $Model = Read-Host "9Router model or combo ID"
}
if ([string]::IsNullOrWhiteSpace($Model)) {
  throw "Model cannot be empty"
}

try {
  $headers = @{ Authorization = "Bearer $ApiKey" }
  $catalog = Invoke-RestMethod -Uri "$BaseUrl/models" -Headers $headers -Method Get
  $modelIds = @($catalog.data | ForEach-Object { $_.id })
  if ($Model -notin $modelIds) {
    throw "Model '$Model' was not returned by /v1/models"
  }
} catch {
  throw "Could not validate the API key and model: $($_.Exception.Message)"
}

if ($Tool -eq "claude") {
  $path = Join-Path $HOME ".claude\settings.json"
  $config = Read-JsonObject $path
  Backup-ConfigFile $path
  $envConfig = $config.PSObject.Properties["env"].Value
  if ($null -eq $envConfig) {
    $envConfig = [PSCustomObject]@{}
    Set-ObjectProperty $config "env" $envConfig
  }
  Set-ObjectProperty $envConfig "ANTHROPIC_BASE_URL" $BaseUrl
  Set-ObjectProperty $envConfig "ANTHROPIC_AUTH_TOKEN" $ApiKey
  Set-ObjectProperty $envConfig "ANTHROPIC_DEFAULT_OPUS_MODEL" $Model
  Set-ObjectProperty $envConfig "ANTHROPIC_DEFAULT_SONNET_MODEL" $Model
  Set-ObjectProperty $envConfig "ANTHROPIC_DEFAULT_HAIKU_MODEL" $Model
  Set-ObjectProperty $envConfig "API_TIMEOUT_MS" "600000"
  Set-ObjectProperty $config "hasCompletedOnboarding" $true
  Write-JsonObject $path $config
}
elseif ($Tool -eq "opencode") {
  $path = Join-Path $HOME ".config\opencode\opencode.json"
  $config = Read-JsonObject $path
  Backup-ConfigFile $path

  $providers = $config.PSObject.Properties["provider"].Value
  if ($null -eq $providers) {
    $providers = [PSCustomObject]@{}
    Set-ObjectProperty $config "provider" $providers
  }
  $provider = $providers.PSObject.Properties["9router"].Value
  if ($null -eq $provider) {
    $provider = [PSCustomObject]@{}
    Set-ObjectProperty $providers "9router" $provider
  }
  Set-ObjectProperty $provider "npm" "@ai-sdk/openai-compatible"

  $options = $provider.PSObject.Properties["options"].Value
  if ($null -eq $options) { $options = [PSCustomObject]@{} }
  Set-ObjectProperty $options "baseURL" $BaseUrl
  Set-ObjectProperty $options "apiKey" $ApiKey
  Set-ObjectProperty $provider "options" $options

  $models = $provider.PSObject.Properties["models"].Value
  if ($null -eq $models) { $models = [PSCustomObject]@{} }
  $modelConfig = [PSCustomObject]@{
    name = $Model
    modalities = [PSCustomObject]@{ input = @("text", "image"); output = @("text") }
  }
  Set-ObjectProperty $models $Model $modelConfig
  Set-ObjectProperty $provider "models" $models
  Set-ObjectProperty $config "model" "9router/$Model"
  Write-JsonObject $path $config
}
else {
  $directory = Join-Path $HOME ".codex"
  $configPath = Join-Path $directory "config.toml"
  $authPath = Join-Path $directory "auth.json"
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  Backup-ConfigFile $configPath
  Backup-ConfigFile $authPath

  $content = if (Test-Path -LiteralPath $configPath) { [IO.File]::ReadAllText($configPath) } else { "" }
  $content = [Regex]::Replace($content, "(?m)^\s*(model|model_provider)\s*=.*(?:\r?\n)?", "")
  $content = [Regex]::Replace($content, "(?ms)^\s*\[(model_providers\.9router|agents\.subagent)\]\s*.*?(?=^\s*\[|\z)", "")
  $escapedModel = $Model.Replace("\", "\\").Replace('"', '\"')
  $escapedUrl = $BaseUrl.Replace("\", "\\").Replace('"', '\"')
  $toml = @"
model = "$escapedModel"
model_provider = "9router"

$($content.Trim())

[model_providers.9router]
name = "9Router"
base_url = "$escapedUrl"
wire_api = "responses"

[agents.subagent]
model = "$escapedModel"
"@
  $utf8 = New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($configPath, $toml.Trim() + [Environment]::NewLine, $utf8)

  $auth = Read-JsonObject $authPath
  Set-ObjectProperty $auth "OPENAI_API_KEY" $ApiKey
  Set-ObjectProperty $auth "auth_mode" "apikey"
  Write-JsonObject $authPath $auth
  $path = $configPath
}

"Configured ${Tool}: $path"
"Remote endpoint: $BaseUrl"
"Model: $Model"
