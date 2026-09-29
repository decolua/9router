# Sync fork from office (upstream)

param(
    [string]$RepoPath = "."
)

$ErrorActionPreference = "Stop"
Set-Location $RepoPath

$status = git status --short
if ($status) {
    Write-Output "dirty tree — commit (/git-push) or stash before sync-fork"
    exit 2
}

$metaJson = gh repo view --json parent,isFork,defaultBranchRef | ConvertFrom-Json
if (-not $metaJson.isFork) {
    Write-Output "not a fork — sync-fork N/A"
    exit 3
}

$parent = "{0}/{1}" -f $metaJson.parent.owner.login, $metaJson.parent.name
$branch = $metaJson.defaultBranchRef.name
if (-not $branch) { $branch = "master" }

$upstreamUrl = $null
try { $upstreamUrl = git remote get-url upstream 2>$null } catch {}
$want = "git@github.com:{0}.git" -f $parent
if (-not $upstreamUrl) {
    git remote add upstream $want
} elseif ($upstreamUrl -notmatch [regex]::Escape($parent)) {
    git remote remove upstream
    git remote add upstream $want
}

git fetch upstream
git merge ("upstream/{0}" -f $branch)
if ($LASTEXITCODE -ne 0) {
    Write-Output "merge conflict — run /resolving-merge-conflicts"
    exit 4
}

git push origin HEAD
if ($LASTEXITCODE -ne 0) {
    Write-Output "push rejected — git pull --rebase then retry (no force)"
    exit 5
}

$sha = git rev-parse --short HEAD
Write-Output ("synced: upstream/{0} → origin/{0}" -f $branch)
Write-Output ("office: {0}" -f $parent)
Write-Output ("{0} HEAD" -f $sha)
Write-Output "WHAT: merged office into fork. WHY: catch up with upstream."
