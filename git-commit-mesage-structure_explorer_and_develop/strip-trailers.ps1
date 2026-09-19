# Remove AI attribution trailers from the HEAD commit message.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File strip-trailers.ps1 -RepoPath .
# Prints one of: stripped <n> | clean | skipped: <reason>
# Never throws, never exits non-zero. Must never block a push.
param([string]$RepoPath = '.')

# ponytail: name list, not a catch-all. Stripping every Co-authored-by would erase
# real human pair-programming credit, which is what the field is for.
$aiNames = 'Cursor|Claude|Copilot|Devin|Codex|Aider|Windsurf|Cody'
$patterns = @(
    "^Co-authored-by:.*\b($aiNames)\b",
    '^Co-authored-by:.*@(cursor\.com|anthropic\.com)',
    '^(Generated with|Assisted-by:)',
    # matches the emoji form without putting a non-ASCII byte in this file
    '^.{0,4}Generated with'
)

try {
    $ErrorActionPreference = 'Stop'

    # repo check FIRST. On a non-repo path, git log's stderr trips the catch under
    # ErrorActionPreference=Stop, so a later guard would be dead code and the caller
    # would see 'skipped: error' instead of the real reason.
    # --absolute-git-dir, not --git-dir: the latter returns the bare string '.git',
    # relative to the repo rather than our cwd. Verified.
    $gitDir = (git -C $RepoPath rev-parse --absolute-git-dir 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $gitDir) { 'skipped: not a repo'; exit 0 }
    foreach ($marker in 'MERGE_HEAD', 'rebase-merge', 'rebase-apply') {
        if (Test-Path (Join-Path $gitDir $marker)) { 'skipped: merge in progress'; exit 0 }
    }

    $msg = git -C $RepoPath log -1 --pretty=%B 2>$null
    if ($LASTEXITCODE -ne 0 -or $null -eq $msg) { 'skipped: no commits'; exit 0 }

    # ponytail: amending a pushed commit changes its SHA and desyncs the branch.
    # Recovery needs a force-push, which SKILL.md forbids. So refuse.
    $remote = git -C $RepoPath branch -r --contains HEAD 2>$null
    if ($LASTEXITCODE -eq 0 -and $remote) { 'skipped: already pushed'; exit 0 }

    $lines = @($msg -split "`r?`n")
    $kept = @($lines | Where-Object {
        $line = $_
        -not ($patterns | Where-Object { $line -imatch $_ })
    })
    $removed = $lines.Count - $kept.Count
    if ($removed -eq 0) { 'clean'; exit 0 }

    # drop the blank lines that removal stranded at the end
    while ($kept.Count -gt 0 -and $kept[-1].Trim() -eq '') {
        $kept = $kept[0..($kept.Count - 2)]
    }
    if ($kept.Count -eq 0) { 'skipped: would empty the message'; exit 0 }

    # ponytail: -F not -m. PS 5.1 mangles multi-line strings passed as -m.
    # Write UTF-8 WITHOUT BOM. Set-Content -Encoding UTF8 in PS 5.1 writes a BOM,
    # and git -F would put that U+FEFF into the subject. Verified on this branch.
    $tmp = Join-Path $env:TEMP ('striptrailers-' + [guid]::NewGuid() + '.txt')
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($tmp, ($kept -join "`n"), $utf8)
    # --allow-empty is required: --amend refuses a commit that changed no files.
    git -C $RepoPath commit -q --amend --allow-empty -F $tmp 2>$null | Out-Null
    $code = $LASTEXITCODE
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    if ($code -ne 0) { 'skipped: amend failed'; exit 0 }

    "stripped $removed"
}
catch { 'skipped: error' }
exit 0
