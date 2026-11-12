# Release & upstream backport flow

Bane (item 49, 2026-09-22): "make sure we are making our releases into our main
branch and we keep back porting from the upstream origin so we get their features
plus our features and we will continue our fixes as we need to."

This document is the flow of record. It was written after measuring the actual
remote/branch/tag state on 2026-09-22; the numbers are reproduced verbatim so the
next reader can re-derive them.

## Topology

```
decolua/9router (upstream)          totalwindupflightsystems/9router (origin, OURS)
  master  ── tagged v0.5.x ──►         master   = PURE MIRROR of upstream/master
                                       federation = master + OUR 767-commit layer
                                                    (federation feature + fixes)
                                       releases are cut from `federation`
```

- `origin` = `https://github.com/totalwindupflightsystems/9router.git`
- `upstream` = `https://github.com/decolua/9router.git`
  (`git remote -v` proves both; do not remove or rename `upstream`.)
- **`master` is NOT ours to commit to.** It mirrors `upstream/master` 1:1 so the
  diff against upstream stays readable. Measured: `git rev-list --count origin/master..master` = 0
  and `git rev-list --count master..origin/master` = 31 — local `master` was a
  fast-forward behind and carried nothing of ours.
- **`federation` is the integration branch and the release branch.** Everything
  we ship (the federation layer + our fixes) lands here. Measured at
  6be6ca97: ahead of `upstream/master` by **767** commits, behind by **37**;
  merge-base `a8c9d380` (upstream `v0.5.81`, 2026-09-18).
- Upstream ships fast (~v0.5.85 on 2026-09-22, a tag every few days). Our layer
  is merge-based, NOT rebase-based, so replaying is a plain `git merge` — our
  767 commits never get rewritten.

## Sync procedure: pull upstream, keep our features

Run from a clean tree on `federation`:

```bash
cd ~/9router
git checkout federation
git pull origin federation            # our latest
git fetch upstream                    # their latest
git merge-base HEAD upstream/master   # note where we last synced
git rev-list --count HEAD..upstream/master   # how far behind (37 on 2026-09-22)
git rev-list --count upstream/master..HEAD   # how far ahead  (767)

git merge upstream/master --no-edit
# Conflicts: ours is the routing/federation layer in src/sse, src/lib/db,
# open-sse/, tests/federation. When a conflict is upstream vs our layer,
# keep our layer unless upstream fixes a real bug in the same lines.

# NEVER skip the gates:
npm run lint:gate                     # full-tree eslint vs committed baseline
npm test                              # vitest; then the regression gate:
node tests/__baseline__/verify-no-regression.mjs <results.json>
# (npm test inside CI / gitreins guard does this automatically against
#  tests/__baseline__/known-fails.txt — 81 catalogued failures are EXPECTED.)

git push origin federation
```

Cadence: **weekly, or immediately when an upstream release fixes something we
care about.** The 37-commit gap on 2026-09-22 was ~4 days of upstream drift —
small merges stay cheap; big ones do not.

## Release flow: cut releases from `federation`

Releases are OUR object now. Upstream's `v0.5.x` tags do not create releases we
consume; our releases must be cut from `federation` so they contain upstream
features + our features, which is the entire point of the backport flow.

```bash
# 1. sync upstream first (procedure above)
# 2. tag the release commit on federation
git tag -a v0.6.0-federation.1 -m "9router federation layer + upstream v0.5.8x"
git push origin v0.6.0-federation.1
# 3. the GitHub RELEASE is the deliverable — a tag alone is invisible:
gh release create v0.6.0-federation.1 \
  --repo totalwindupflightsystems/9router \
  --title "v0.6.0-federation.1" \
  --notes "Federation layer on upstream v0.5.8x. See CHANGELOG.md."
```

Naming: `v0.6.0-federation.N` (our minor, ours increments). Keep upstream's
`v0.5.x` namespace untouched so `git describe` against upstream stays legible.

## The tag-without-release gap — DECIDED: Option A, taken 2026-09-24

Measured 2026-09-22 (at decision time 2026-09-24: 88 tags, still zero releases):

```
$ git tag | wc -l
87
$ gh release list --repo totalwindupflightsystems/9router --limit 5
(no output — the fork has ZERO releases)
$ gh release list --repo decolua/9router --limit 1
v0.5.35  Latest  2026-07-16
```

So the review's "~50 tags without releases" was UNDERSTATED twice: our fork has
**87 tags and ZERO releases**, and even upstream has published releases only
through `v0.5.35` while its tag line has run on to `v0.5.85` (upstream simply
stopped publishing release objects; the tags point at upstream/master commits we
already mirror).

This is a decision, not an accident to quietly "fix":

- **Option A (recommended): start the line above.** Cut
  `v0.6.0-federation.1` from `federation` and publish it as a real GitHub
  release. Do NOT retro-publish the 87 old tags — they are upstream mirror
  points, and 87 auto-generated releases would be noise.
- **Option B: mirror upstream's release notes.** Automate a release per new
  upstream tag. Rejected by default: it publishes objects for code we did not
  ship and confuses "what does OUR layer contain".

DECIDED 2026-09-24 (REL-9ROUTER-001): **Option A is taken.** `v0.6.0-federation.1`
is cut from `federation` and published as the fork's first real GitHub release;
the 87 (now 88) mirror tags stay tag-only. Outcome recorded on board rows
REL-9ROUTER-001 + REVIEW-9ROUTER-001 (REVIEW-9ROUTER-004 never existed — drift
fixed this pass).
