# Installing and rolling back the maintained fork

The maintained package is `@loldlm1/9router`. It keeps the executable name
`9router` and reuses the existing data directory (`~/.9router`). Fork releases
use `<upstream>-fork.<build>`, for example `0.5.40-fork.1`.

## Local release artifact

Build a non-publishing tarball with an explicit build identifier:

```sh
NINEROUTER_FORK_BUILD=1 npm run cli:pack
```

The release wrapper temporarily applies the fork version to both package
manifests, builds and packs the CLI, then restores the tracked upstream version.
Publishing additionally requires an explicit build identifier and npm approval:

```sh
NINEROUTER_FORK_BUILD=1 npm run cli:publish
```

The scoped package is not considered installable until an approved release is
visible through `npm view @loldlm1/9router version`. The Sprint 5 smoke test uses
the generated tarball and a temporary npm prefix; it does not alter the real
global installation or `~/.9router`.

## Recoverable migration from the official package

Do not remove `~/.9router`. Back it up before the first migration, stop the
running instance, and pin both the new and rollback versions:

```sh
cp -a ~/.9router ~/.9router.backup-before-fork
npm uninstall -g 9router
FORK_VERSION=0.5.40-fork.0 # replace with the approved published version
npm install -g "@loldlm1/9router@$FORK_VERSION"
9router --version
```

Verify that `which 9router` and `npm list -g --depth=0` identify only the scoped
package, then check the dashboard, `/api/health`, and `/v1/models` before normal
use. The updater will only offer scoped fork releases. A newer official release
is shown as “awaiting fork integration” until a corresponding fork build exists.

## Rollback

The pre-fork rollback point is official `9router@0.5.40` (commit/tag `v0.5.40`).
Keep healthy data in place during a package rollback:

```sh
npm uninstall -g @loldlm1/9router
npm install -g 9router@0.5.40
```

Restore the backup only if a data-integrity check finds corruption; do not
overwrite healthy, newer data as a routine rollback step.
