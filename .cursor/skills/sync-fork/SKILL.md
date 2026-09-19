---
name: sync-fork
description: Sync this GitHub fork from the office upstream (parent repo). Use when the user types /sync-fork, says "sync from office", "pull upstream", "catch up fork", or /git-push --sync.
disable-model-invocation: true
---

# sync-fork

Bring `origin` (your fork) up to date with the **office** parent repo (`upstream`).

This repo is a fork of office: `decolua/9router` → `vitou-vitou/9router`.

status check → ensure upstream → fetch → merge → report. One shell call per step. Stop at first failure.

## When to run

- Before starting work that must track office
- After office landed fixes you need
- With `/git-push --sync` (git-push runs this skill first, then commit/push)

**Do not** run while you have uncommitted work you care about — stash or `/git-push` first.

## Steps

1. `git status --short`
   - Non-empty → stop. Reply: `dirty tree — commit (/git-push) or stash before sync-fork`.
   - Merge/rebase in progress → stop; use `/resolving-merge-conflicts`.

2. Detect office parent:

   ```powershell
   gh repo view --json parent,isFork,defaultBranchRef -q "{isFork:.isFork,parent:.parent.owner.login + \"/\" + .parent.name,branch:.defaultBranchRef.name}"
   ```

   - `isFork` false → stop: `not a fork — sync-fork N/A`.
   - Note `parent` (e.g. `decolua/9router`) and default branch (usually `master`).

3. Ensure `upstream` remote:

   ```powershell
   git remote get-url upstream
   ```

   - Missing or wrong → set it:

     ```powershell
     git remote remove upstream 2>$null
     git remote add upstream git@github.com:<parent>.git
     ```

     (HTTPS ok: `https://github.com/<parent>.git`)

4. Fetch office:

   ```powershell
   git fetch upstream
   ```

5. Merge office into current branch (default: checkout `master` / default branch first if needed):

   ```powershell
   git merge upstream/<default-branch>
   ```

   - Fast-forward or merge commit OK.
   - Conflicts → stop. Tell user to run `/resolving-merge-conflicts`. Never `--abort` unless they ask.
   - Never `--force`.

6. Push fork (so GitHub fork matches local):

   ```powershell
   git push origin HEAD
   ```

   - Rejected → stop, suggest `git pull --rebase` (do not force).

7. Report:

   ```
   synced: upstream/<branch> → origin/<branch>
   office: <parent>
   <short-sha> HEAD
   WHAT: merged office into fork. WHY: catch up with upstream.
   ```

## Rules

- Never force-push to `master` / default branch.
- Prefer **merge** over rebase for shared fork `master` (keeps history simple for GitHub).
- If user only wants fetch + status (no merge): run steps 1–4 then `git log --oneline HEAD..upstream/<branch>` and stop.
- Script helper (optional): `.cursor/skills/sync-fork/scripts/sync-fork.ps1 -RepoPath .`

## Example

```
$ /sync-fork
synced: upstream/master → origin/master
office: decolua/9router
a1b2c3d HEAD
WHAT: merged office into fork. WHY: catch up with upstream.
```
