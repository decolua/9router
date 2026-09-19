# Detect a repo's dominant commit-message style.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File classify.ps1 -RepoPath .
# Prints one of: conventional | imperative-caps | imperative-lower
# Never throws, never exits non-zero. On any failure: conventional.
param([string]$RepoPath = '.')

$fallback = 'conventional'
$verbs = 'add|update|remove|fix|bump|revert|use|move|change|make|set|allow|improve|clean|rename|apply|refactor|tweak|format|adjust|simplify|delete|drop|ignore'

try {
    $ErrorActionPreference = 'Stop'
    $subjects = git -C $RepoPath log -50 --format=%s 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $subjects) { $fallback; exit 0 }

    # ponytail: merges are dropped, not classified. laravel is 35.4% imperative with
    # them and 44.8% without -- the filter decides that repo's answer.
    $s = @($subjects | Where-Object { $_ -and $_ -notmatch '^Merge (pull request|branch)\b' })
    if ($s.Count -lt 5) { $fallback; exit 0 }

    $n = $s.Count
    $conventional = @($s | Where-Object { $_ -cmatch '^[a-z]+(\([^)]+\))?!?: ' }).Count
    if ($conventional / $n -ge 0.4) { 'conventional'; exit 0 }

    $capsVerbs = ($verbs -split '\|' | ForEach-Object { $_.Substring(0, 1).ToUpper() + $_.Substring(1) }) -join '|'
    $caps = @($s | Where-Object { $_ -cmatch "^($capsVerbs) " }).Count
    if ($caps / $n -ge 0.4) { 'imperative-caps'; exit 0 }

    $lower = @($s | Where-Object { $_ -cmatch "^($verbs) " }).Count
    if ($lower / $n -ge 0.4) { 'imperative-lower'; exit 0 }

    $fallback
}
catch { $fallback }
exit 0
