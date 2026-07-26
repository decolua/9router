# Fork maintenance

This repository is a maintained fork of [`decolua/9router`](https://github.com/decolua/9router). The fork keeps upstream history intact and carries a small, reviewable stack of fork-only commits.

## Repository layout

Use these remotes in every maintenance checkout:

```text
origin    https://github.com/loldlm1/9router.git
upstream  https://github.com/decolua/9router.git
```

The default branch is `master`. Do not force-push or rebase published `master`. Feature work uses `agent/*` branches. Upstream synchronization uses `sync/upstream-YYYYMMDD` branches and a pull request into the fork's `master`.

## Initial baseline

The fork was initialized from upstream commit `79918c7830695bbca4a45c9fea4a42c3e9fd73d1` on 2026-07-22. At that point, `master`, `origin/master`, and `upstream/master` were identical.

The baseline was evaluated with Node.js `v24.14.0` and npm `11.9.0`. Upstream declares Node.js 18 or newer for the CLI, while the container currently uses Node.js 22. Re-run release checks on Node.js 22 before publishing.

Baseline results:

| Check | Result | Notes |
| --- | --- | --- |
| `unit/codex-fast-capacity.test.js` | Passed | 4/4 tests passed. |
| Focused Codex unit set | Partial | 22 tests passed; two remote-image tests failed because outbound image fetches are blocked in the isolated runner. |
| Full Vitest suite | Not run | The upstream suite contains live-provider paths. Run only with an explicitly isolated account and authorization to contact those providers. |
| `npx eslint .` | Upstream red | 136 errors and 172 warnings before fork changes. Use changed-file linting to detect fork regressions. |
| `npm run build` | Passed | Requires a writable isolated `DATA_DIR` in restricted environments. |
| CLI build and pack | Passed | Install `cli/` dependencies first; the tarball was 13.6 MB compressed and 47.4 MB unpacked. |

The baseline failures above are not treated as fork regressions. New work must keep focused tests green and must not add changed-file lint failures.

## Reproducing the baseline

Install all three independent dependency sets. In restricted environments, point npm's cache and 9Router data outside the home directory:

```bash
npm ci --cache /tmp/9router-npm-cache-root
(cd tests && npm install --cache /tmp/9router-npm-cache-tests)
(cd cli && npm ci --cache /tmp/9router-npm-cache-cli)
```

For a release-only checkout, the root and CLI sets are sufficient. Use
`--ignore-scripts` so installing the CLI build dependencies does not run its
postinstall hook against the operator's existing `~/.9router` data:

```bash
npm ci --ignore-scripts --no-audit --no-fund
(cd cli && npm ci --ignore-scripts --no-audit --no-fund)
```

Run local-only checks without enabling `RUN_REAL`:

```bash
(cd tests && npx vitest run unit/codex-fast-capacity.test.js)
npx eslint <changed-files>
HOME=/tmp/9router-home DATA_DIR=/tmp/9router-build-data npm run build
HOME=/tmp/9router-home DATA_DIR=/tmp/9router-pack-data npm_config_cache=/tmp/9router-npm-cache-pack npm run cli:pack
```

Never point baseline or smoke tests at the only copy of `~/.9router`. Use a disposable `DATA_DIR` and a non-critical account for live tests.

## Synchronizing upstream

1. Start from a clean fork `master`.
2. Fetch upstream and tags.
3. Create a dated sync branch from the fork's current `master`.
4. Merge `upstream/master` without rewriting history.
5. Resolve conflicts while preserving upstream behavior first.
6. Run the focused fork checks, build, and pack.
7. Open a pull request from the sync branch into `loldlm1/9router:master`.
8. Merge only after reviewing workflow and dependency changes.

Representative commands:

```bash
git switch master
git fetch origin
git fetch upstream --tags
git switch -c sync/upstream-YYYYMMDD
git merge --no-ff upstream/master
```

Do not use `git reset --hard`, force-push, or automatic merge-to-main workflows for synchronization.

## Keeping changes upstreamable

Keep protocol changes separate from fork distribution changes:

- Reasoning capability and request-shaping commits may be proposed to upstream.
- Fork package names, updater policy, release workflows, and deployment configuration stay fork-only.
- Each sprint produces one focused conventional commit and records its rollback point.
- Upstream pull requests are created separately and only with explicit approval.

Before preparing an upstream patch, branch directly from `upstream/master` and cherry-pick only the relevant protocol commit. Verify the resulting diff does not contain scoped package names, fork URLs, updater policy, or private workflow configuration.

## Release and rollback policy

Publishing npm packages, container images, or deployments always requires a protected manual approval. Upstream detection in the dashboard must never replace an installed fork build with the official unscoped package.

Rollback by installing a previously validated package version or reverting the single sprint commit. Preserve `~/.9router`; do not delete databases, runtime directories, or volumes as part of a routine rollback.
