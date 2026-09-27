# Upgrading this fork

This repository is a fork of **[decolua/9router](https://github.com/decolua/9router)** carrying
features that are not upstream. This document is how you take a new upstream release without
losing them.

What the fork adds — in full in [FORK-CHANGELOG.md](FORK-CHANGELOG.md):

| | |
|---|---|
| `claude-cli` (`ccli`) | Routes through the local `claude -p` binary instead of replaying an OAuth token, which is what makes the plain `claude` provider a ban risk |
| Auto-ping cron | Scheduled keepalive pings ("Only Hi") on a cron, per connection, optionally sent via the Claude Code CLI |
| Agent skills | Install a third-party `SKILL.md` by URL and toggle it per request; injected into the routed prompt |
| Docker packaging | The router image bundles Claude Code, so one install covers it |
| Bridge sign-in console | The router serves the bridge's noVNC window on its own origin behind the dashboard session, so signing in needs no `kubectl port-forward` |
| API Key Usage page | Per-key time series + CSV export at Dashboard → API Key Usage, plus a fix so a raw API key never reaches the browser as a JSON property name from `/api/usage/stats` |

**The short version**

```bash
node scripts/fork/upgrade-fork.mjs --dry-run    # see what is coming
node scripts/fork/upgrade-fork.mjs              # take the newest upstream tag
```

---

## How the fork is shaped

This matters more than any script: **most of the fork is new files, and new files never conflict.**

- **55 added files** — providers, executors, configs, components, API routes, agent-skill
  storage and injection, local-provider accounts, the bridge's Docker image and its sign-in
  console proxy, the API Key Usage page and its data layer, tests, this tooling.
  Upstream does not know they exist, so an upgrade cannot break them. They only need to still be
  there afterwards.
- **32 edited upstream files** — almost all of them a handful of lines that *register* the new
  files (an import, a map entry, an array item). These are the only places a conflict can happen.
  The exceptions worth knowing about are `custom-server.js` (it hosts the sign-in console's
  WebSocket, which a Next route handler cannot serve), `src/dashboardGuard.js` (local-only
  routes have to stay reachable inside a container), and `src/lib/db/repos/usageRepo.js` (the
  API Key Usage feature's re-keying is a real bug fix layered into upstream's own aggregation
  logic, not just a registration point — see its row below).
- **2 generated snapshots** — `tests/__baseline__/*.json`. Upstream adds providers too, so
  these conflict on most releases and are **regenerated, never merged**.

`scripts/fork/fork-manifest.mjs` is the machine-readable version of that list and is what every
script below reads. If you add to the fork, add to the manifest.

**What a normal upgrade looks like.** Rehearsed against a synthetic v0.5.82 that bumped the
version, added a provider to both registration files, and edited `custom-server.js` — i.e. it
touched the fork's own conflict surface on purpose:

```
1 upstream commit(s) to take
2 fork commit(s) to replay
✗ merge stopped on conflicts:
  open-sse/providers/registry/index.js
      → ...take upstream's list, then re-add the two fork imports...
42/42 added files present
```

One file needed hands. `package.json`, `custom-server.js` and `open-sse/executors/index.js`
merged cleanly because the edits sat in different regions — that will not always hold, and when it
does not, the tool names each file with its own hint.

---

## First-time setup

Only needed once, and only if the fork's work is not yet on a branch.

```bash
# 1. upstream remote
git remote add upstream https://github.com/decolua/9router
git fetch upstream --tags

# 2. commit the work
git add -A ':!.omc'
git commit -m "feat: claude-cli provider and cron auto-ping"

# 3. prove it
node scripts/fork/verify-fork.mjs
```

This repo keeps the fork on `master`, with upstream as a remote — so
`git log master ^upstream/master` answers "what is mine?". A separate branch
works equally well; set `FORK_BRANCH` in the manifest to whichever you use.
The scripts do not depend on the name (see below).

---

## Routine upgrade

```bash
node scripts/fork/upgrade-fork.mjs --dry-run      # what would be taken, nothing touched
node scripts/fork/upgrade-fork.mjs                # newest upstream tag
node scripts/fork/upgrade-fork.mjs --to v0.6.0    # a specific release
node scripts/fork/upgrade-fork.mjs --to upstream/master
node scripts/fork/upgrade-fork.mjs --rebase       # replay linearly instead of merging
```

The script:

1. refuses to run on a dirty tree or off the fork branch,
2. fetches upstream and shows the incoming commits,
3. creates a rollback branch `fork-backup/<timestamp>`,
4. merges (or, with `--rebase`, replays) — **this is the real work, and it is git's 3-way merge, not a text patcher**,
5. regenerates the baselines and the derived provider icons,
6. runs `verify-fork.mjs` and refuses to call it a success if the fork is not intact.

Rolling back is always `git reset --hard fork-backup/<timestamp>`.

### When it stops on a conflict

The script prints the conflicted files with the per-file hint from the table below, then:

```bash
# resolve the files, then
git add <files>
git commit                     # or: git rebase --continue   (if you used --rebase)
node scripts/fork/upgrade-fork.mjs --finish
```

`--finish` does steps 5 and 6 — regenerate and verify — for a conflict you resolved by hand.

To give up: `git merge --abort` (or `git rebase --abort` with `--rebase`).

---

### Merge, not rebase, by default

The fork arrives on `master` as a merge commit, so the history shows it as one
reviewable change rather than commits pushed straight onto upstream. Rebase
would replay those commits and **drop that merge commit** — git flattens merges
when it replays them — so merging is the default and `--rebase` opts out.

---

## Conflict guidance, file by file

Every one of these is "keep both sides": upstream's change **and** the fork's registration. The
fork almost never replaces upstream code — the one exception is called out.

| File | What the fork put there | On conflict |
|---|---|---|
| `open-sse/providers/registry/index.js` | 1 import + 1 entry in the default-export array | Despite the `Auto-generated` header **there is no generator** — it is hand-maintained. Take upstream's list, then re-add `./claude-cli.js` with a free `pN` index and append it to the array. A collision here is silent at merge time and fatal at boot: two `pN` imports with the same name stop the whole registry loading. |
| `open-sse/executors/index.js` | 1 import + 2 map entries (`claude-cli`, `ccli`) | Keep both next to upstream's. |
| `open-sse/handlers/chatCore/sseToJsonHandler.js` | **Replaces** the final `const finalBody = …` ternary with an if/else that also converts for non-OpenAI clients | The one real replacement. Keep the fork's block; upstream's ternary is what it supersedes. This is a genuine upstream bug fix — see *Sending things upstream* below. |
| `src/shared/services/quotaAutoPing.js` | The whole cron layer: `cronMatcher` import, `sendClaudeCliPing`, `sendPingViaCli` on the claude handler, `readCronEntry`/`runCronPing`, the cron branch in the tick, `deps.providerHandlers` | Largest edit, but purely additive. Keep upstream's changes to the reset-based path and re-add the cron pieces around them. |
| `src/shared/constants/config.js` | `cronPingText`, `cronMaxExpressions`, `cronFailureCooldownMs`, `cronCatchUpMinutes`, `cliPingTimeoutMs`, `cliPingModel` inside `QUOTA_AUTOPING_CONFIG` | Additive keys. Keep both sides. |
| `src/shared/services/initializeApp.js` | `hasQuotaAutoPingEnabled` also returns true for cron-only setups | Without it a cron schedule does not survive a restart. |
| `src/dashboardGuard.js` | 2 entries in `LOCAL_ONLY_PATHS` | **Security-relevant.** One route spawns a process, the other fetches a URL and can open a window on the host. Dropping them exposes both when `requireLogin` is false. |
| `src/app/api/cli-tools/all-statuses/route.js` | 2 imports + 2 `STATUS_GETTERS` entries | Keep both. |
| `src/shared/constants/cliTools.js` | 2 `CLI_TOOLS` entries before `devin:` | Keep both. |
| `src/shared/components/index.js` | 3 re-exports | Keep both. |
| `…/providers/[id]/ConnectionRow.js` | `autoPingSchedule` prop, its Schedule button, tooltip, propTypes | Keep both. |
| `…/providers/[id]/page.js` | Imports, `cronScheduleTarget` state, `cron` in the auto-ping state and settings load, `handleAutoPingSchedule`, the `autoPingSchedule` prop, the modal, and the two status cards in the `isFreeNoAuth` branch | Most touch points of any file; work through them one at a time. |
| `src/lib/db/repos/usageRepo.js` | Imports `apiKeyBucketId`/`deletedKeyLabel` from `apiKeyUsageRepo.js` and re-keys `stats.byApiKey` away from the raw API key on all three code paths that build it (daily rollup, `usageHistory` overlay, 24h/today), plus the deleted-key `keyName` label | **The one entry on this table that is a real bug fix, not a registration point** — before it, every raw API key ever used reached the browser as a JSON property name on every `/api/usage/stats` poll. Keep all three re-keyed call sites plus upstream's changes nearby. Do **not** re-key the stored composite in `usageDaily.data.byApiKey` (still `${rawApiKey}|${model}|${provider}`, deliberately) — that would orphan every day already accumulated; only the value this function *returns* is re-keyed. Do **not** resolve the `maskApiKey` duplication (below) by importing it from here into `apiKeyUsageRepo.js` — this file already imports from there, so the reverse import closes a cycle. |
| `src/shared/components/UsageStats.js` | `sortData`, `groupDataByKey`, `API_KEY_COLUMNS`, and the API-key table's two render functions moved from private/inline to exported module scope | The API Key Usage page renders the exact same table through these exports rather than a copy. Keep them; the `case "apiKey":` branch in this file still calls the render functions by reference. |
| `src/shared/components/Sidebar.js` | One nav entry, `/dashboard/api-key-usage` | Keep both. |
| `tests/unit/security-audit.test.js` | AUDIT-002's assertion checks for `apiKeyBucketId(r.apiKey, apiKeyMap)` in `usageRepo.js`'s source, in step with the re-keying above | Keep the fork's assertion text if upstream also edits this file's AUDIT-002 test — it is the source-guard companion to the behavioral `tests/unit/usage-stats-no-raw-keys.test.js`. |

`CHANGELOG.md` is deliberately **not** in this list. The fork's entries live in
`FORK-CHANGELOG.md` precisely so upstream's changelog never conflicts.

---

## No fork branch? (fresh clone, or a machine without the history)

```bash
# on the machine that has the fork
node scripts/fork/export-patch.mjs --base v0.5.81     # writes fork.patch

# on the fresh upstream checkout
git apply --3way fork.patch
node scripts/fork/verify-fork.mjs
```

`--3way` is required: a plain `git apply` needs exact context and fails the moment upstream edits a
line near one of ours, while `--3way` does the same merge a rebase would.

`export-patch.mjs` refuses to run while fork files are untracked, because an untracked file is
silently omitted — producing a patch that applies cleanly and still leaves the fork broken.

---

## Verifying

```bash
node scripts/fork/verify-fork.mjs           # structure + registry + fork tests
node scripts/fork/verify-fork.mjs --quick   # skip the test run
node scripts/fork/verify-fork.mjs --live    # also the live `claude -p` tests
```

It checks, in order: every added file is present; every integration marker is still in its upstream
file (and no conflict markers are left behind); the built registry really exposes `claude-cli` and
the fork's five test files pass; the
baselines list both providers.

File presence alone would pass on a half-resolved merge — that is why the registry and test steps
are there.

Beyond the fork's own checks, the repo's normal gates still apply:

```bash
node tests/__baseline__/verify-providers.mjs
node tests/__baseline__/verify-alias.mjs
node tests/__baseline__/verify-oauth-urls.mjs
npx eslint .
```

The full suite is **not** green on a plain checkout (~122 failures upstream, unrelated to the
fork) — see `CLAUDE.md`. Judge a release by whether the failure set *changed*, not by zero.

### The branch name is not load-bearing

`FORK_BRANCH` in the manifest records which branch carries the fork, but
`upgrade-fork.mjs` only refuses a detached HEAD, or a branch with no commits of
its own. Any layout works: the fork on `master` with upstream as a remote (what
this repo does), or on a separate branch. A name that differs from the manifest
is reported, not refused.

### This procedure was rehearsed, not just written

Against a synthetic `v0.5.99` release that edits the same lines the fork does
(a new executor next to ours, a new `LOCAL_ONLY_PATHS` entry, a new autoping key,
and a rewritten `CHANGELOG.md`):

- `upgrade-fork.mjs` stopped on exactly two conflicts — `open-sse/executors/index.js`
  and `src/dashboardGuard.js` — and printed this document's hint for each.
- Both were "keep both sides". After `git rebase --continue`, `--finish` rebuilt the
  baselines and verification passed.
- The patch route was rehearsed too: a patch exported at v0.5.81 applied onto the
  v0.5.99 tree with `git apply --3way` — everything clean but the same two files,
  which `verify-fork.mjs` then refused to pass until they were resolved.

Every conflict seen so far has been additive. If you ever hit one that is not,
the file-by-file table above says which side owns that code.

---

## Things that are rebuilt, not merged

Run automatically by `upgrade-fork.mjs`; here they are for a manual upgrade:

```bash
node tests/__baseline__/snapshot-providers.mjs           # providers-baseline.json
node tests/__baseline__/verify-alias.mjs --snapshot      # alias-baseline.json
cp public/providers/claude.png public/providers/claude-cli.png
```

The baselines are snapshots of "every provider the app knows". Upstream adds providers in most
releases, so merging them is meaningless — rebuild and commit.

---

## Configuration the fork adds

| Variable | Default | Meaning |
|---|---|---|
| `CLI_CLAUDE_BIN` | auto-detected | Path to the `claude` binary |
| `CLI_CLAUDE_MAX_CONCURRENCY` | `4` | Concurrent `claude -p` processes; each is ~230 MB |

---

## Sending things upstream

The smaller the fork, the cheaper every upgrade. One change here is not fork-specific and belongs
upstream:

- **`sseToJsonHandler.js`** — a non-streaming Claude-format client of any `forceStream` provider
  (opencode, zed, codebuddy, …) receives an OpenAI `chat.completion` body it cannot parse. The fix
  reuses the existing shared translator. Covered by `tests/unit/forced-sse-client-format.test.js`.
- **`usageRepo.js`'s raw-API-key re-keying** — the bug (`stats.byApiKey` keyed by the raw API key,
  which then rides along in every `/api/usage/stats` response) is entirely upstream's; nothing
  fork-specific caused it. `apiKeyBucketId`/`deletedKeyLabel` (`apiKeyUsageRepo.js`) are the fix and
  would need to move too, since `usageRepo.js` imports them — the API Key Usage page's own use of
  `apiKeyBucketId` for its chart series would stay fork-side either way.

If upstream takes either, drop it from the fork and from `PATCHED_FILES` in the manifest — one less
file that can ever conflict.

---

## Keeping this document true

`scripts/fork/fork-manifest.mjs` is the source of truth. When the fork gains a file or an
integration point, add it there first — `verify-fork.mjs` then enforces it, and this document's
tables should be updated to match.
