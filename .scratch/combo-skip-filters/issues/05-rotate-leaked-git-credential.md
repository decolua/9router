# 05 — Rotate the GitHub token embedded in the git remote

**What to build:** The repository's `origin` remote URL contains a GitHub personal
access token in plaintext. Anyone who can read the working copy, a shell history, a
`git remote -v` in a screenshot, or a log capture holds a working credential for the
fork. Any command that prints remotes leaks it again.

Revoke the exposed token, issue a replacement, and move authentication out of the
remote URL into a credential helper or SSH key so the URL carries no secret. Then
confirm nothing left behind still holds it — the remote URL itself, any other clones
or checkouts on other machines, and CI or tooling configuration that was handed the
same token. Treat the old token as compromised regardless of whether misuse is
visible.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The exposed token is revoked at GitHub
- [ ] `git remote -v` shows no credential in any remote URL
- [ ] Push and fetch both work through a credential helper or SSH key
- [ ] Other clones and any CI/tooling configured with the old token are updated
