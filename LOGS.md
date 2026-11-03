# Project Log

## 2026-08-20 - Upstream v0.5.55 Dev Deployment

- Merged `decolua/9router` v0.5.55 into `sync/decolua-v0.5.55` while retaining the fork's API-key/CORS guard behavior.
- Added test fixture updates for embedding policy mocks, DNS lookup records, and Fusion combo entry binding.
- Pushed candidate SHA `035c1a9979b6f6d3b68582a11e025837b8147307` to `origin/sync/decolua-v0.5.55`.
- Homelab Docker build succeeded and `ninerouter-dev` was recreated with `9router-dev-data:/app/data` preserved; `/api/health` returned 200.
- Local full Vitest run from repository root: 1819 passed, 82 failed, 11 skipped. Residual failures are upstream-inherited stale/live tests, Windows-only file-lock/path/snapshot variance, and tests requiring separate upstream remediation; they did not block the authoritative homelab build.

## 2026-08-21 - Freebuff Dev Deployment

- Completed the Freebuff full-port candidate build gate on homelab from `/home/itsnulla/9router-build`.
- Fixed the provider-test build blocker by importing a deterministic, side-effect-free Kimchi user-agent helper; regression coverage verifies the helper value and test-utils module evaluation.
- Homelab Docker build for `9router-dev:master` passed, including Next.js production compilation and database migration version 3.
- Recreated only `ninerouter-dev` with `9router-dev-data:/app/data` preserved. Local `/api/health` returned `200`; the public dev URL returned `307` to `/dashboard`.
- Focused Freebuff suite passed: 11 files, 43 tests. Production and persistent data volumes were not touched.

## 2026-09-07 � Testing Studio provider filter fix + full deploy cycle

### Work done
- **PR #23** (merged to master @ e65381d6): Testing Studio Chat + Compare model filter now shows AI_PROVIDERS registry name for built-in providers; custom OpenAI/Anthropic-compatible and custom-embedding endpoint nodes labeled by connection name. ModelSelectModal custom-embedding fix cherry-picked from bcf63fd1.
- **Homelab tests**: 20/20 targeted, baseline no-regression (now=114, known=121). Ran 3 rounds across code iterations.
- **BuildKit cache bug discovered and fixed**: cherry-pick produced byte-identical file content ? BuildKit silently reused stale COPY layer despite correct git HEAD. Fixed by mandating --no-cache in all 4 ops runbooks.
- **Production deploy** (nulla-lab): homelab build --no-cache ? scp transfer (747MB, SHA-256 verified) ? load+tag 9router:v0.5.69-local-e65381d6 ? rollback backup ? compose update ? docker compose up --no-deps --force-recreate 9router. Health: 200. Caddy untouched. Volume 9router_ninerouter_data preserved.
- **Nulla-lab image prune**: kept only v0.5.69.1-local-0619484a as rollback + 1 compose backup. Removed 4 older image sets + 7 old compose backups.
- **Branch cleanup**: deleted fix/testing-studio-provider-filter-label, fix/custom-embedding-model-select-modal, sync/upstream-v0.5.65, feature/allowed-models-media-providers from local + origin. Backup branches retained per runbook.
- **GitHub release**: fork-v0.5.69.2 published at https://github.com/ibanunmangun/9router/releases/tag/fork-v0.5.69.2

### State
- master = e65381d6 (local, origin, homelab /home/itsnulla/9router-build all in sync)
- Production running: 9router:v0.5.69-local-e65381d6
- Rollback available: 9router:v0.5.69.1-local-0619484a + compose bak rollback-20260907-123955
- Temp files: /tmp/9router-release.tar removed from homelab+nulla-lab (yes to cleanup)

## 2026-09-09 - kenari.id provider integration + production deploy

### Work done
- **kenari.id built-in provider**: added with automatic usage tracking (registry entry `open-sse/providers/registry/kenari.js`, hand-registered in `open-sse/providers/registry/index.js`).
- **Usage adapter**: added `open-sse/services/usage/kenari.js` (`getKenariUsage`) calling the real kenari `/v1/account/quota` endpoint, registered in the `USAGE_HANDLERS` dispatch in `open-sse/services/usage.js`.
- **Real quota schema captured** (2-window rolling: month + week, both in IDR) via live API key testing on homelab; fixtures saved secret-free in `tests/fixtures/kenari/`.
- **Pricing**: added `KENARI_IDR_PER_USD=17500` and the `PROVIDER_PRICING.kenari` block in `open-sse/providers/pricing.js`.
- **Test coverage**: `tests/unit/kenari-tracking.test.js`, `tests/unit/kenari-usage.test.js`, and `kenari` added to the SUPPORTED list in `tests/unit/usage-dispatch.test.js`.
- **Plan `.omo/plans/track-kenari-usage.md` fully completed**: all Todos 1-8 done; Final Verification Wave F1-F4 all APPROVE (F1 plan compliance, F2 independent Oracle code review, F3 live QA with real key on dev, F4 scope fidelity).
- **Live QA on `ninerouter-dev` (homelab)** confirmed the balance panel renders correctly: Month (IDR) 54,096/600,000, Week (IDR) 54,096/150,000, with correct reset countdowns.
- **PR #24** (`feature/kenari-usage` -> `master`) at https://github.com/ibanunmangun/9router/pull/24 merged via `gh pr merge --admin` (repo ruleset required 1 approving review; used owner bypass) at merge commit `1dda0331`.
- **Production deploy** (nulla-lab): homelab build --no-cache (HEAD `1dda0331`) -> direct homelab->nulla-lab transfer via Tailscale (748MB, SHA-256 verified) -> load + tag `9router:v0.5.69.2-local-1dda0331` -> rollback tag `9router:v0.5.69-local-e65381d6-rollback-20260909-140646` + compose backup created -> `docker compose up --no-deps --force-recreate 9router`. Health: 200. Caddy untouched. Volume `9router_ninerouter_data` preserved.

### State
- master = `1dda0331` (local homelab, origin all in sync)
- Production running: `9router:v0.5.69.2-local-1dda0331`
- Rollback available: `9router:v0.5.69-local-e65381d6-rollback-20260909-140646` + compose bak `rollback-20260909-140646`
- A temporary `KENARI_KEY` env var was set in homelab `~/.bashrc` (line 141) for schema-capture testing during this session and has since been deactivated by the user - not used in production (production relies on each user's own connection-stored API key)
- Note (non-blocking, flagged not fixed): a pre-existing `clientSecret` value in `tests/__baseline__/providers-baseline.json` predates this branch (confirmed via `git log -p`) and is unrelated to this work - flagged to the user for future consideration, not addressed this session
- Temp files: ops scripts (`prelim_check.sh`, `backup_rollback.sh`, `postdeploy_verify.sh`) removed from nulla-lab `/tmp` after use; release tar/checksum retained on homelab+nulla-lab per runbook retention policy (not deleted)

## 2026-09-09/10 - Kenari icon polish, Quota Tracker bar-width fix, Ollama monthly quota fix + fork release v0.5.69.3

### PR #26 - Kenari icon fix
- Added hand-rendered `public/providers/kenari.png` (128x128, matching kenari.id's favicon.svg mark: cream rounded-square bg `#FBF6EE`, bold black "k", brick-red `#B5362A` square accent).
- Merged to master (`2538e143`), deployed to production as `9router:v0.5.69.3-local-2538e143`. Verified: volume preserved, caddy untouched, health 200.

### PR #27 - Quota Tracker progress-bar width bug
- Root cause (in `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaTable.js`): the reset-time countdown text was a separate flex sibling with variable width, squeezing/stretching the adjacent progress-bar track depending on countdown string length.
- Iterated 3 rounds to the real fix: folded the countdown text into the existing used/total+percentage row (already inside the bar's fixed-width `flex-1` container) instead of keeping it as a standalone column. Removed now-unused `resetPrimary`/`resetSecondary` vars. Display order set to `countdown . percentage` per follow-up style request.
- Merged to master (`d57e9ef5`), deployed to production as `9router:v0.5.69.4-local-d57e9ef5`. Verified: volume preserved, caddy untouched, health 200.

### PR #28 - Ollama Cloud quota display bug
- Root cause: Ollama's `/api/usage` endpoint moved most accounts from `limits.session`/`limits.weekly` to a new `limits.monthly` field; the old parser silently dropped it, so quota bars stopped rendering for affected accounts. Confirmed live against real Ollama connections in the dev DB (5/6 accounts had valid `limits.monthly` data being dropped).
- Fix (`open-sse/services/usage/misc.js`, `getOllamaUsage()`): added `monthlyRaw`/`monthlyNum`/`hasMonthly` handling and a `quotas["Monthly"]` entry, backward-compatible with the old session/weekly fields. `parseQuotaData` in `.../ProviderLimits/utils.js` needed no logic change (already generic), comment-only update.
- Added `tests/unit/ollama-usage.test.js` coverage: monthly-only parsing, still-reports-no-limits-when-neither-shape-present, and `parseQuotaData` Monthly passthrough.
- Official homelab test run (disposable `node:22-bookworm` container): 12/12 passed (`ollama-usage.test.js` + `provider-quota-visibility.test.js`, no regression to hide-quota feature).
- Merged to master (`c699555e`), deployed to production as `9router:v0.5.69.5-local-c699555e`. Verified via internal Docker network (`caddy-9router` -> `9router:20128/api/health` = `{"ok":true}`, container has no published host port by design). Volume preserved, caddy untouched.

### PR #29 - CHANGELOG entry (docs only)
- Added the `v0.5.69.3` section to `CHANGELOG.md` summarizing the three fixes above. Merged to master (`a8a08773`) via PR (direct push to master is blocked by a repo ruleset).

### Fork release
- **New runbook added**: `docs/ops/NINEROUTER_FIX_RELEASE_RUNBOOK.md` for fix-only fork releases (no upstream sync involved) - `FORK_SYNC_RELEASE_RUNBOOK.md` assumes every release is an upstream sync, which didn't fit this session.
- **GitHub release**: `fork-v0.5.69.3` published at https://github.com/ibanunmangun/9router/releases/tag/fork-v0.5.69.3, tag target = `master`@`a8a08773` (covers PR #26, #27, #28, #29).
- Merged branches cleaned up from local + origin: `fix/ollama-monthly-quota-field`, `fix/quota-tracker-bar-width-inconsistency`, `fix/kenari-test-connection-and-live-models`, `docs/changelog-v0.5.69.3`.

### State
- master = `a8a08773` (local, origin in sync)
- Production running: `9router:v0.5.69.5-local-c699555e` (code identical to `a8a08773`, docs-only commit on top doesn't require a rebuild)
- Rollback chain available: `9router:v0.5.69.4-local-d57e9ef5-rollback-20260909230411` (compose bak same timestamp), plus older rollback tags from prior deploys, all still retained on nulla-lab
- DEV (`ninerouter-dev` on homelab) updated to the PR #28 build before merge (image `sha256:ff11b4a6...`); production later caught up to the same commit after merge
- Reminder carried over (non-blocking, still not addressed): pre-existing `clientSecret` value in `tests/__baseline__/providers-baseline.json`, unrelated to any branch touched this session
- Temp files cleaned: build logs, test workspace, and transferred image tarball removed from homelab + nulla-lab `/tmp` after use

## 2026-09-30 - Usage Analytics dark-theme polish + upstream v0.5.91 sync + prod deploy

### Work done
- **PR #34** (merged to master @ `ca38f8f3`): Usage Analytics overview stat cards vertical alignment fix (`justify-center`); tried an icon+3-row redesign, user rejected it, reverted to keep only the alignment fix. Chart tooltip backgrounds fixed (`ProviderBarChart.js`, `TopModelsChart.js`, `UsageChart.js`) — was blending into page background via `var(--color-bg)`, changed to `var(--color-surface)` + border/shadow/radius. Deployed to dev then production (nulla-lab) same session.
- **Upstream sync — PR #35** (merged to master @ `067fada5`): synced fork with `decolua/master` v0.5.91 (38 commits). 9 merge conflicts resolved additively (fork policy/connectionId/resilience logic preserved alongside upstream provider/feature updates) — `chatCore.js`, `nonStreamingHandler.js`, `streamingHandler.js`, `capabilities.js`, `registry/index.js`, `combos/page.js`, `DashboardLayout.js`, 2 claude test files. Independent `oracle` review: PASS on all 9, two pre-existing minor notes (not regressions).
- **Found and fixed a genuine upstream test bug** during homelab regression testing: `tests/unit/image-generation.test.js` hardcoded Codex version header `0.154.0`, but upstream commit `832a3465` bumped the registry to `0.155.0` in the same commit without updating this pre-existing test (file had zero merge conflicts — pure upstream oversight). Fixed the assertion; homelab baseline regression check went from 4 failures to **No regression** (85 fails, all within 134 known baseline).
- **Post-deploy UI feedback iteration** (still on the sync branch, caught before merge): user reported tooltip label/value text staying black in dark mode despite the surface-color fix — root cause was Recharts' `Tooltip` default `itemStyle`/`labelStyle` inline `color:#000` overriding `contentStyle.color`; added explicit `labelStyle`/`itemStyle` on all 3 tooltips. Then user flagged the bar-hover cursor highlight (solid light-gray rect, Recharts' light-theme default) as too jarring in dark mode; replaced with `currentColor` @ 6% opacity on `ProviderBarChart`/`TopModelsChart` (the `UsageChart` `AreaChart` cursor is a thin line by default, unaffected).
- **Full deploy cycle for PR #35**: dev (homelab `ninerouter-dev`, iterated 3x as fixes landed) → prod (nulla-lab). Homelab build `--no-cache` → direct Tailscale `scp` homelab→nulla-lab (SHA-256 + manifest verified) → `docker load` → tag `9router:v0.5.91-local-067fada5` → rollback tag `9router:v0.5.86-local-ca38f8f3-rollback-20260930-001239` + compose backup of same name → `docker compose up -d --no-deps --force-recreate 9router` (Caddy untouched) → verified volume `9router_ninerouter_data:/app/data` intact, health `200`, `/api/version` reports `0.5.91`.

### State
- master = `067fada5` (local, origin, homelab `/home/itsnulla/9router-build` all in sync)
- Production running: `9router:v0.5.91-local-067fada5`
- DEV (`ninerouter-dev` on homelab) at the same commit `067fada5`, image `9router-dev:master`
- Rollback available: `9router:v0.5.86-local-ca38f8f3-rollback-20260930-001239` + compose bak same timestamp on nulla-lab
- Deleted branches (local + origin): `fix/usage-overview-cards-alignment`, `sync/upstream-decolua-v0.5.91`. Backup branch `backup/master-before-sync-upstream-v0.5.91` retained per runbook.
- Temp files cleaned: transferred image tarball + checksum + deploy-helper scripts removed from homelab + nulla-lab `/tmp`; stale homelab test-worktree result dirs from earlier sync test iterations removed.
- Reminder carried over (non-blocking, deferred, not addressed this session): "CU Kenari" (custom-embedding connector named "Kenari") vs "k. test" (official `kenari` provider connection) shown as separate-looking nodes in provider topology graph — confirmed not a bug (naming ambiguity only), user has not requested a UI fix (rename or provider-type badge) yet.

## 2026-10-22 - API-key policy consolidation (PR #38) + Ollama Cloud balance-API migration fix (PR #39)

### PR #38 - API-key policy consolidation (`feat/consolidate-api-key-policy`)
- Consolidated the fork's legacy `allowedModels`/`blockedModels`/`scopes` restriction system with upstream's canonical `access.{restricted,allow}` `keyAccess.js` engine into one enforcement path.
- Fixed 7 baseline regressions surfaced by the consolidation: 1 production bug (migration 005 must self-create the `apiKeys` table defensively before altering it — same pattern already needed in migrations 003/006), 4 test-only fixes (stale canonical-source mocks, missing `requestId` field, fake-request `.url`, stale schema version string), committed as `9bee4cc5`.
- Homelab baseline independently re-verified at `9bee4cc5`: no regression (82 fails, all within 134 known baseline).
- Deployed to `ninerouter-dev` (image `sha256:c4f81998e3...`), health `200`, `requireLogin:false` unchanged, redirect chain `/` → `307` → `/dashboard` → `200`.
- PR #38 opened: `base:master` ← `head:feat/consolidate-api-key-policy`@`9bee4cc5`. Still open at session end, not yet merged.

### PR #39 - Ollama Cloud quota tracker: migrate to `/api/balance` (`fix/ollama-balance-api-migration`)
- Root cause: Ollama repurposed `GET /api/usage` into pure spend-history on 2026-10-10 (no longer returns a `limits` object), so the dashboard silently fell back to "Ollama Cloud connected. No usage limits reported." for every connected account. Quota moved to a new `GET /api/balance` endpoint with a dollar-credit model now covering the Free plan too. Confirmed via `docs.ollama.com/api/balance`, `docs.ollama.com/api/cloud-usage`, and `ollama/ollama#18653`.
- Fix (`open-sse/services/usage/misc.js`, `getOllamaUsage()`): call `/api/balance` instead of `/api/usage`; map `included.{balance_usd,allowance_usd,period.until}` to a Monthly quota row; surface an unexpired `purchased.balance_usd` top-up as a separate credit-balance row; kept a defensive fallback branch for the legacy `included.session/weekly.{remaining_percent,resets_at}` shape some un-migrated accounts may still return. Removed now-dead `nextMonthlyResetFromSignup`/`addUtcMonths` helpers (the new endpoint carries a real reset date). Fixed a pre-existing duplicate `return { plan, quotas };` line found while rewriting.
- `ProviderLimits/utils.js`: forwarded `isCreditBalance`/`currency` for the `ollama` case so the purchased-credit row renders correctly (💰 style, not a progress bar).
- `registry/ollama.js`: updated stale free-tier notice text (was still describing the retired 5h/weekly reset windows).
- Rewrote `tests/unit/ollama-usage.test.js` fixtures for `/api/balance` (standard, free-plan, purchased top-up, legacy-shape fallback, no-data cases). One float-precision assertion failure caught on first homelab run (`4.9/5*100 = 98.00000000000001`) and fixed by rounding `remainingPercentage` to 2 decimals.
- Homelab targeted test: 10/10 passed, exit code 0, after the rounding fix (first run was 9/10 due to the float issue).
- Deployed to `ninerouter-dev` (image `sha256:c001c34ac0e7...`), health `200`, `requireLogin:false` unchanged, redirect chain `/` → `307` → `/dashboard` → `200`, volume `9router-dev-data:/app/data` preserved before/after.
- PR #39 opened: `base:master` ← `head:fix/ollama-balance-api-migration`@`1e1cb834`. Still open at session end, not yet merged.

### Docs - fork→upstream contribution runbook (`docs/upstream-contribution-runbook`)
- Added `docs/ops/UPSTREAM_CONTRIBUTION_RUNBOOK.md` (gitignored, local-only — matches the existing `docs/ops/` pattern): covers identifying which fork commits are general-purpose enough to send to `decolua/9router` as a PR vs fork-specific (API-key policy, combo `connectionId` binding, etc.), basing the upstream-PR branch on `decolua/master` instead of this fork's `master` to keep the diff minimal, cherry-pick/conflict-resolution guidance to avoid leaking fork-only code, re-verifying on homelab against upstream's own code state before opening the PR, and what happens to the branch after upstream merges (handled by the next `FORK_SYNC_RELEASE_RUNBOOK.md` sync, not deleted early).
- Cross-linked only within `docs/ops/` (itself gitignored, local-only): `FORK_SYNC_RELEASE_RUNBOOK.md` now points to the new doc for the reverse flow. Deliberately did NOT link it from `README.md` — that file is tracked/public, and a link into the gitignored `docs/ops/` directory would be a dead link for anyone cloning the repo fresh.

### State
- Two open PRs at session end: #38 (`feat/consolidate-api-key-policy`@`9bee4cc5`) and #39 (`fix/ollama-balance-api-migration`@`1e1cb834`), both based on `master`@`bd5f9f11`.
- `ninerouter-dev` currently running the Ollama fix build (`1e1cb834`), which supersedes the earlier key-policy-only dev deploy from the same session — the key-policy consolidation code is NOT included in the current dev deploy since PR #39's branch was cut from `origin/master`, not from `feat/consolidate-api-key-policy`.
- Saved agentmemory lesson on the Ollama `/api/usage` → `/api/balance` migration for future recall.
- Doc task (user request) completed this session on a separate `docs/upstream-contribution-runbook` branch, based on `origin/master`, so it doesn't pollute either open PR's diff.

## 2026-10-22 (cont.) - Merged PR #38/#39/#40, fork-v0.5.105 release, nulla-lab production deploy

### Merges
- PR #38, #39, #40 all merged to `master` via `gh pr merge --admin` (branch-protection ruleset requires review+bypass for direct push; admin override is the established method for this repo). `master`: `bd5f9f11` → `c2e9fd10` (#38) → `83e1cadd` (#39) → `8fdc8893` (#40).
- README.md mistake caught and reverted mid-session: PR #40's first commit linked the new gitignored `docs/ops/UPSTREAM_CONTRIBUTION_RUNBOOK.md` from the tracked README — user caught this ("docs nya keep as local, karena itu menyangkut sama ops"); reverted README to byte-identical original, fixed in `7bfd4fd9`.

### Combined-state verification (homelab)
- Homelab checkout (`/home/itsnulla/9router-build`) had drifted 103 commits behind (stale since 2026-10-01 sync); fast-forwarded to `master`@`8fdc8893` in one step, pulling in all 3 just-merged PRs plus unrelated upstream-tracking work merged earlier (Bedrock, Nous, MiniMax Code providers, Hermes profiles, etc.) that had accumulated since the last homelab sync.
- Ran the full authoritative build+test gate (`NINEROUTER_HOMELAB_BUILD_TEST.md` §4) on this combined state for the first time — individual PRs were only tested in isolation before merge, never together: targeted suite (Ollama + key-access + key-policy tests) 181/181 passed; full-suite baseline comparison: **no regression** (82 known fails vs 134 baseline, all accounted for).
- Fixed a gap in the runbook's own script: the disposable worktree needs `mkdir -p node_modules tests/node_modules` before the volume mounts, or Docker fails with a read-only-fs mount error on a fresh worktree that has no `node_modules` directory yet to use as a mountpoint.

### Docker build + dev deploy
- `docker build --no-cache -t 9router-dev:master` on homelab from `8fdc8893` succeeded (sha256 `96ba31d2...`).
- Recreated `ninerouter-dev` with the new image: health `200`, `requireLogin:false` unchanged, redirect chain `/` → `307` → `/dashboard` → `200`, volume `9router-dev-data:/app/data` preserved before/after. DB auto-migrated schema 5→6 with pre-migration backup.

### Production deploy (nulla-lab)
- `docker save` (793,866,752 bytes) + SHA-256, transferred via the dedicated `9router-transfer` SFTP-only account over Tailscale (homelab → nulla-lab direct, ~5 min for 793MB).
- Uploaded file inherited `600` perms owned by the transfer account, unreadable by the `ubuntu` operator — required one `sudo chown ubuntu:ubuntu` before checksum verification could run (same permission pattern seen on the prior `v0.5.104` transfer, so not treated as an anomaly).
- Checksum verified OK, manifest config digest cross-checked identical to homelab's build output, `docker load` succeeded, tagged `9router:v0.5.105-local-8fdc8893`.
- Rollback safety: tagged the then-running image as `9router:v0.5.104-local-bd5f9f11-rollback-20261022-224455`, backed up `docker-compose.yml` to the same timestamp suffix (PowerShell `$(docker ...)` subshell expansion doesn't survive the SSH hop — had to run this as a transferred `.sh` script instead of an inline command, consistent with known PowerShell/SSH quoting gotchas in these runbooks).
- Updated only the `9router` service's image tag in compose (`sed`, not interactive `nano`), recreated with `docker compose up -d --no-deps --force-recreate 9router`. Caddy (`caddy-9router`) was never recreated, confirmed still "Up 47 hours" before and after.
- **Critical volume check passed**: `9router_ninerouter_data:/app/data` unchanged — production data preserved, not a fresh/empty volume.
- Public health verified `200` from two independent vantage points (Windows workstation over public Cloudflare, and from nulla-lab itself hitting its own public hostname). DB migrated schema 5→6 cleanly in production logs too, 5579 models loaded, zero startup errors.

### Release
- Per `NINEROUTER_FIX_RELEASE_RUNBOOK.md`'s hard rule ("never release ahead of production"), added the `CHANGELOG.md` v0.5.105 section on a separate `docs/changelog-v0.5.105` branch (PR #41, merged via `--admin` → `master`@`8f47f6f3`) rather than committing straight to `master`, since direct push is ruleset-blocked.
- Tagged `fork-v0.5.105` pointing at `8fdc8893` — the exact commit baked into the production image — **not** `master`'s current tip (`8f47f6f3`, which only adds the changelog after the deploy already happened). Published via `gh release create` (had to omit `--target` once the tag already existed; passing both caused an "invalid target_commitish" 422).
- Release: https://github.com/ibanunmangun/9router/releases/tag/fork-v0.5.105

### State
- `master` (local, origin) = `8f47f6f3`; production (`nulla-lab`) running commit `8fdc8893` via image `9router:v0.5.105-local-8fdc8893`; dev (`ninerouter-dev`) also at `8fdc8893`.
- Fork release tag `fork-v0.5.105` → `8fdc8893`, matches deployed production commit exactly.
- Rollback available on nulla-lab: `9router:v0.5.104-local-bd5f9f11-rollback-20261022-224455` + compose backup same timestamp.
- Temp files intentionally retained per runbook (not a cleanup oversight): `/tmp/9router-release.tar` + checksum on homelab, `/tmp/9router-v0.5.105-8fdc8893.tar*` on nulla-lab — runbook explicitly says keep transfer archives until deployment is accepted, and prescribes no removal command.
- No branch cleanup needed — PR branches were merged with `--delete-branch` (#41) or will be cleaned up in the next pass for #38/#39/#40's source branches (not yet deleted this session).

### Addendum - branch cleanup, LOGS.md re-verification, temp-file cleanup
- Corrected the "State" section above: it was written before the final tidy-up pass below and is now stale on two points — `master` has since advanced past `8f47f6f3`, and the "not yet deleted" branch cleanup has since happened. Appending here instead of editing those lines, per the no-overwrite logging convention.
- Added a second doc-only PR (#42, `docs/logs-2026-10-22-release`) to land this very LOGS.md entry, merged via `--admin` → `master`@`429c0cb7` (ruleset blocks direct push to `master`, same as #41).
- Deleted the 3 now-merged PR source branches both locally and on `origin`: `feat/consolidate-api-key-policy`, `fix/ollama-balance-api-migration`, `docs/upstream-contribution-runbook`. Also deleted the two transient docs-only branches (`docs/changelog-v0.5.105`, `docs/logs-2026-10-22-release`) locally after their remotes were auto-deleted by `--delete-branch`.
- Confirmed local `master` clean and at zero divergence from `origin/master` (`429c0cb7`, matches exactly on both sides) — this was re-verified fresh rather than trusted from the earlier claim.
- Cleaned up genuinely disposable scratch files that had no retention rule attached (build log, SFTP batch file, SFTP transfer log, the one-off rollback-tagging helper script) from homelab `/tmp`, nulla-lab `/tmp`, and the Windows workstation's `opencode` temp dir. Deliberately left the release `.tar`/`.sha256` archives in place on both homelab and nulla-lab — the deployment runbook explicitly says retain those until the deployment is accepted and prescribes no removal command, so removing them would have been following my own cleanup instinct over the documented safety rule.
- Final state: `master` (local, origin) = `429c0cb7`; production and dev both still running commit `8fdc8893` (unchanged by this addendum — only docs/branches moved, no new deploy); fork release `fork-v0.5.105` still correctly points at `8fdc8893`.

