# Plan 009: Add CI workflow for tests and lint

> **Executor instructions**: Follow step by step. STOP on mismatch.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 001 (worktree exclude — CI tests must be clean)
- **Category**: dx
- **Planned at**: commit `1271db0`, 2026-06-19

## Why this matters

The `.github/workflows/` directory has three workflows (upstream-sync, docker-publish, gitbook-pages) but **none run tests or lint**. Regressions land silently. The only safety net is the manual `tests/__baseline__/known-fails.txt` + `verify-no-regression.mjs` pattern, which requires a human to remember to run it. This plan adds a CI workflow that runs on every push and PR, executing lint + tests with the regression verifier. With plan 001 fixing the worktree pollution, CI will produce clean, actionable results.

## Current state

Existing workflows in `.github/workflows/`:
- `upstream-sync.yml` — daily cron, fast-forwards master from upstream
- `docker-publish.yml` — builds Docker image on tag push
- `gitbook-pages.yml` — builds gitbook docs

No workflow runs `npm run build`, `npx vitest run`, or lint.

Build/test commands (from `package.json` + recon):
- Install: `npm ci`
- Build: `npm run build` (Next.js webpack build, ~30s)
- Lint: `npx next lint` (no `lint` script in package.json, but eslint config exists at `eslint.config.mjs`)
- Tests: `npx vitest run --config tests/vitest.config.js "tests/unit/" "tests/translator/"` (~12s)
- Regression check: `node tests/__baseline__/verify-no-regression.mjs tests/__baseline__/current.json`

Node version: the repo uses Next.js 16, React 19 — Node 20+ required. The `cli/hooks/sqliteRuntime.js` pins better-sqlite3 version.

The repo is a fork (`bloodf/9router`) tracking `decolua/9router`. CI should run on `dev` and `main` branches + PRs.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| YAML syntax check | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` | no exception |
| Workflow file exists | `test -f .github/workflows/ci.yml && echo exists` | `exists` |

## Scope

**In scope**:
- `.github/workflows/ci.yml` (create)

**Out of scope**:
- Do NOT modify existing workflows.
- Do NOT add `lint`/`test` scripts to `package.json` — the CI calls `npx` directly.
- Do NOT add type checking (repo is JS-only, no TypeScript).

## Steps

### Step 1: Create the CI workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [dev, main]
  pull_request:
    branches: [dev, main]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npx next lint
        continue-on-error: true  # lint warnings should not block; fix over time

      - name: Build
        run: npm run build
        env:
          NEXT_TRACING_ROOT_MODE: workspace

      - name: Run unit + translator tests
        run: npx vitest run --config tests/vitest.config.js "tests/unit/" "tests/translator/"

      - name: Verify no regression
        run: node tests/__baseline__/verify-no-regression.mjs tests/__baseline__/current.json
        if: always()
```

Notes on design choices:
- `continue-on-error: true` on lint — the repo has pre-existing lint warnings that shouldn't block PRs. Once cleaned up, remove this flag.
- `NEXT_TRACING_ROOT_MODE: workspace` — matches the standalone build env from the Dockerfile.
- `fetch-depth: 0` — not strictly needed for tests but useful for future git-based checks.
- The regression verifier runs even if tests fail (`if: always()`) to surface the baseline comparison.

**Verify**: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` → no exception.

### Step 2: Verify locally (optional but recommended)

Run the same commands locally to confirm they'll pass in CI:

```bash
cd /home/cortexos/Developer/github.com/bloodf/9router
npx next lint 2>&1 | tail -5
npm run build 2>&1 | tail -5
npx vitest run --config tests/vitest.config.js "tests/unit/" "tests/translator/" 2>&1 | tail -5
```

**Verify**: All exit 0 (or lint exits non-zero but that's caught by continue-on-error).

## Done criteria

- [ ] `.github/workflows/ci.yml` exists with valid YAML
- [ ] Workflow triggers on push/PR to `dev` and `main`
- [ ] Workflow runs lint, build, tests, and regression verifier
- [ ] No existing workflows modified
- [ ] `python3 -c "import yaml; ..."` on the file succeeds

## STOP conditions

- `npm ci` fails in CI because `package-lock.json` is out of sync with `package.json` — run `npm install` locally to regenerate the lockfile before pushing.
- `npx next lint` doesn't work (no `.eslintrc` in the expected location) — the repo uses `eslint.config.mjs` (flat config, ESLint 9). If `next lint` doesn't pick it up, use `npx eslint .` instead.
- The vitest config path `tests/vitest.config.js` doesn't resolve in CI — confirm the relative path from the repo root.

## Maintenance notes

- Once lint warnings are cleaned up, remove `continue-on-error: true` to make lint blocking.
- If the test suite grows significantly, consider splitting unit and translator tests into parallel jobs.
- The regression verifier (`verify-no-regression.mjs`) reads from `tests/__baseline__/current.json` — this file must be kept up to date. Consider adding a step to regenerate it on `main` pushes.
- Node 20 is the minimum for Next.js 16 + React 19. If the project upgrades Node, update the workflow.
